import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { Pool } from "pg";

import { slugify } from "../../../packages/shared/src/helpers.js";
import type {
  ActionJob,
  AppState,
  EnvironmentTemplate,
  ProviderState,
  ProviderKind,
  Snapshot,
  TemplatePortForward,
  VmCommandResult,
  VmInstance,
  VmSession,
  VmPortForward,
} from "../../../packages/shared/src/types.js";

const DEFAULT_LAUNCH_SOURCE = "images:ubuntu/noble/desktop";
const POSTGRES_STORE_KEY = "singleton";

type StateMutator = (state: AppState) => boolean | void;
type StateMutationResult = {
  state: AppState;
  changed: boolean;
};

type LegacyTemplate = Partial<EnvironmentTemplate> & {
  baseImage?: string;
};

type LegacyVm = Partial<VmInstance>;
type LegacyProviderState = Partial<ProviderState>;
type LegacySnapshot = Partial<Snapshot>;
type LegacyJob = Partial<ActionJob>;

type LegacyAppState = Partial<Omit<AppState, "provider" | "templates" | "vms">> & {
  provider?: LegacyProviderState;
  templates?: LegacyTemplate[];
  vms?: LegacyVm[];
  snapshots?: LegacySnapshot[];
  jobs?: LegacyJob[];
};

export interface StateStore {
  load(): AppState;
  update(mutator: StateMutator): StateMutationResult;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export interface StateStoreConfig {
  kind: "json" | "postgres";
  dataFile: string;
  databaseUrl: string | null;
}

export async function createStateStore(
  config: StateStoreConfig,
  createSeed: () => AppState,
): Promise<StateStore> {
  if (config.kind === "postgres") {
    if (!config.databaseUrl) {
      throw new Error("PostgreSQL persistence requires a database URL.");
    }

    return PostgresStateStore.create(config.databaseUrl, createSeed);
  }

  return new JsonStateStore(config.dataFile, createSeed);
}

export class JsonStateStore implements StateStore {
  constructor(
    private readonly filePath: string,
    private readonly createSeed: () => AppState,
  ) {}

  load(): AppState {
    if (!existsSync(this.filePath)) {
      const state = this.createSeed();
      this.save(state);
      return cloneState(state);
    }

    const raw = readFileSync(this.filePath, "utf8");
    const parsed = JSON.parse(raw) as LegacyAppState;
    const normalized = normalizeState(parsed);

    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      this.save(normalized);
    }

    return cloneState(normalized);
  }

  save(state: AppState): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  update(mutator: StateMutator): StateMutationResult {
    const state = this.load();
    const changed = mutator(state) !== false;

    if (changed) {
      state.lastUpdated = nowIso();
      this.save(state);
    }

    return {
      state: cloneState(state),
      changed,
    };
  }

  async flush(): Promise<void> {}

  async close(): Promise<void> {}
}

export class PostgresStateStore implements StateStore {
  private readonly pool: Pool;
  private currentState: AppState;
  private pendingPersist: Promise<void> = Promise.resolve();
  private lastPersistError: Error | null = null;

  private constructor(
    pool: Pool,
    initialState: AppState,
  ) {
    this.pool = pool;
    this.currentState = cloneState(initialState);
  }

  static async create(
    databaseUrl: string,
    createSeed: () => AppState,
  ): Promise<PostgresStateStore> {
    const pool = new Pool({
      connectionString: databaseUrl,
    });

    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_state (
        store_key TEXT PRIMARY KEY,
        state JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const initialState = await readOrInsertSeedState(pool, createSeed);
    return new PostgresStateStore(pool, initialState);
  }

  load(): AppState {
    this.assertHealthy();
    return cloneState(this.currentState);
  }

  update(mutator: StateMutator): StateMutationResult {
    this.assertHealthy();

    const nextState = cloneState(this.currentState);
    const changed = mutator(nextState) !== false;

    if (changed) {
      nextState.lastUpdated = nowIso();
      this.currentState = nextState;
      this.queuePersist(nextState);
    }

    return {
      state: cloneState(nextState),
      changed,
    };
  }

  async flush(): Promise<void> {
    await this.pendingPersist;
    this.assertHealthy();
  }

  async close(): Promise<void> {
    try {
      await this.flush();
    } finally {
      await this.pool.end();
    }
  }

  private queuePersist(state: AppState): void {
    const snapshot = cloneState(state);
    const persistPromise = this.pendingPersist.then(async () => {
      await this.pool.query(
        `
          INSERT INTO app_state (store_key, state, updated_at)
          VALUES ($1, $2::jsonb, NOW())
          ON CONFLICT (store_key)
          DO UPDATE SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at
        `,
        [POSTGRES_STORE_KEY, JSON.stringify(snapshot)],
      );
    });

    this.pendingPersist = persistPromise.catch((error: unknown) => {
      const normalizedError =
        error instanceof Error
          ? new Error(`PostgreSQL persistence failed: ${error.message}`)
          : new Error("PostgreSQL persistence failed.");

      this.lastPersistError = normalizedError;
      console.error(normalizedError);
    });
  }

  private assertHealthy(): void {
    if (this.lastPersistError) {
      throw this.lastPersistError;
    }
  }
}

async function readOrInsertSeedState(
  pool: Pool,
  createSeed: () => AppState,
): Promise<AppState> {
  const existing = await pool.query<{ state: LegacyAppState }>(
    "SELECT state FROM app_state WHERE store_key = $1",
    [POSTGRES_STORE_KEY],
  );

  if (existing.rowCount && existing.rows[0]?.state) {
    return normalizeState(existing.rows[0].state);
  }

  const seed = createSeed();
  await pool.query(
    `
      INSERT INTO app_state (store_key, state, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (store_key)
      DO NOTHING
    `,
    [POSTGRES_STORE_KEY, JSON.stringify(seed)],
  );

  const seeded = await pool.query<{ state: LegacyAppState }>(
    "SELECT state FROM app_state WHERE store_key = $1",
    [POSTGRES_STORE_KEY],
  );

  if (!seeded.rowCount || !seeded.rows[0]?.state) {
    throw new Error("Failed to initialize PostgreSQL app state.");
  }

  return normalizeState(seeded.rows[0].state);
}

function cloneState<T>(value: T): T {
  return structuredClone(value);
}

function normalizeState(rawState: LegacyAppState): AppState {
  return {
    sequence:
      typeof rawState.sequence === "number" && Number.isFinite(rawState.sequence)
        ? Math.max(1, Math.trunc(rawState.sequence))
        : 1,
    provider: normalizeProviderState(rawState.provider),
    templates: Array.isArray(rawState.templates)
      ? rawState.templates.map(normalizeTemplate)
      : [],
    vms: Array.isArray(rawState.vms) ? rawState.vms.map(normalizeVm) : [],
    snapshots: Array.isArray(rawState.snapshots)
      ? rawState.snapshots
          .map(normalizeSnapshot)
          .filter((snapshot): snapshot is Snapshot => snapshot !== null)
      : [],
    jobs: Array.isArray(rawState.jobs)
      ? rawState.jobs
          .map(normalizeJob)
          .filter((job): job is ActionJob => job !== null)
      : [],
    lastUpdated:
      typeof rawState.lastUpdated === "string" && rawState.lastUpdated
        ? rawState.lastUpdated
        : nowIso(),
  };
}

function normalizeProviderState(
  provider: LegacyProviderState | undefined,
): ProviderState {
  const kind = provider?.kind === "incus" ? "incus" : "mock";
  const available = provider?.available ?? kind === "mock";
  const hostStatus =
    provider?.hostStatus ??
    (kind === "mock"
      ? "ready"
      : available
        ? "ready"
        : "daemon-unreachable");

  return {
    kind,
    available,
    detail:
      provider?.detail ??
      (kind === "mock"
        ? "Demo mode is active. Actions update persisted state and synthetic desktop frames."
        : "Incus host readiness has not been refreshed yet."),
    hostStatus,
    binaryPath:
      typeof provider?.binaryPath === "string"
        ? provider.binaryPath
        : kind === "incus"
          ? "incus"
          : null,
    project:
      typeof provider?.project === "string" && provider.project
        ? provider.project
        : null,
    desktopTransport:
      provider?.desktopTransport ?? (kind === "incus" ? "novnc" : "synthetic"),
    nextSteps:
      Array.isArray(provider?.nextSteps) &&
      provider.nextSteps.every((step) => typeof step === "string")
        ? provider.nextSteps
        : [],
  };
}

function normalizeTemplate(template: LegacyTemplate): EnvironmentTemplate {
  return {
    id: template.id ?? "tpl-missing",
    name: template.name ?? "Recovered template",
    description: template.description ?? "Recovered from persisted state.",
    launchSource:
      template.launchSource ?? template.baseImage ?? DEFAULT_LAUNCH_SOURCE,
    defaultResources: {
      cpu: template.defaultResources?.cpu ?? 4,
      ramMb: template.defaultResources?.ramMb ?? 8192,
      diskGb: template.defaultResources?.diskGb ?? 60,
    },
    defaultForwardedPorts: normalizeTemplateForwardedPorts(
      template.defaultForwardedPorts,
    ),
    tags: Array.isArray(template.tags) ? template.tags : [],
    notes: Array.isArray(template.notes) ? template.notes : [],
    snapshotIds: Array.isArray(template.snapshotIds) ? template.snapshotIds : [],
    createdAt: template.createdAt ?? nowIso(),
    updatedAt: template.updatedAt ?? template.createdAt ?? nowIso(),
  };
}

function normalizeVm(vm: LegacyVm): VmInstance {
  const provider = normalizeProviderKind(vm.provider);
  const name = vm.name ?? "recovered-vm";
  const workspacePath =
    typeof vm.workspacePath === "string" && vm.workspacePath
      ? vm.workspacePath
      : provider === "mock"
        ? `/srv/workspaces/${slugify(name)}`
        : "/root";

  return {
    id: vm.id ?? "vm-missing",
    name,
    templateId: vm.templateId ?? "tpl-missing",
    provider,
    providerRef: vm.providerRef ?? buildProviderRef(vm.id ?? "vm-missing", name),
    status: vm.status ?? "stopped",
    resources: {
      cpu: vm.resources?.cpu ?? 4,
      ramMb: vm.resources?.ramMb ?? 8192,
      diskGb: vm.resources?.diskGb ?? 60,
    },
    createdAt: vm.createdAt ?? nowIso(),
    updatedAt: vm.updatedAt ?? vm.createdAt ?? nowIso(),
    liveSince: vm.liveSince ?? null,
    lastAction: vm.lastAction ?? "Recovered from persisted state",
    snapshotIds: Array.isArray(vm.snapshotIds) ? vm.snapshotIds : [],
    frameRevision: vm.frameRevision ?? 1,
    screenSeed: vm.screenSeed ?? 1,
    activeWindow: vm.activeWindow ?? "editor",
    workspacePath,
    session: normalizeSession(vm.id ?? "vm-missing", vm.session, provider),
    forwardedPorts: normalizeVmForwardedPorts(
      vm.id ?? "vm-missing",
      vm.forwardedPorts,
    ),
    activityLog: Array.isArray(vm.activityLog) ? vm.activityLog : [],
    commandHistory: normalizeCommandHistory(vm.commandHistory),
  };
}

function normalizeSnapshot(snapshot: LegacySnapshot): Snapshot | null {
  if (!snapshot) {
    return null;
  }

  return {
    id: snapshot.id ?? "snap-missing",
    vmId: snapshot.vmId ?? "vm-missing",
    templateId: snapshot.templateId ?? "tpl-missing",
    label: snapshot.label ?? "Recovered snapshot",
    summary: snapshot.summary ?? "Recovered from persisted state.",
    providerRef: snapshot.providerRef ?? "unknown",
    resources: {
      cpu: snapshot.resources?.cpu ?? 4,
      ramMb: snapshot.resources?.ramMb ?? 8192,
      diskGb: snapshot.resources?.diskGb ?? 60,
    },
    createdAt: snapshot.createdAt ?? nowIso(),
  };
}

function normalizeJob(job: LegacyJob): ActionJob | null {
  if (!job) {
    return null;
  }

  return {
    id: job.id ?? "job-missing",
    kind: normalizeJobKind(job.kind),
    targetVmId: typeof job.targetVmId === "string" ? job.targetVmId : null,
    targetTemplateId:
      typeof job.targetTemplateId === "string" ? job.targetTemplateId : null,
    status: normalizeJobStatus(job.status),
    message: job.message ?? "Recovered job",
    progressPercent:
      typeof job.progressPercent === "number" && Number.isFinite(job.progressPercent)
        ? job.progressPercent
        : null,
    createdAt: job.createdAt ?? nowIso(),
    updatedAt: job.updatedAt ?? job.createdAt ?? nowIso(),
  };
}

function normalizeJobKind(value: ActionJob["kind"] | undefined): ActionJob["kind"] {
  switch (value) {
    case "create":
    case "clone":
    case "launch-snapshot":
    case "start":
    case "stop":
    case "delete":
    case "snapshot":
    case "restore-snapshot":
    case "resize":
    case "capture-template":
    case "inject-command":
      return value;
    default:
      return "create";
  }
}

function normalizeJobStatus(
  value: ActionJob["status"] | undefined,
): ActionJob["status"] {
  switch (value) {
    case "queued":
    case "running":
    case "succeeded":
    case "failed":
      return value;
    default:
      return "failed";
  }
}

function normalizeCommandHistory(
  commandHistory: VmInstance["commandHistory"] | undefined,
): VmCommandResult[] {
  if (!Array.isArray(commandHistory)) {
    return [];
  }

  return commandHistory
    .filter(
      (entry): entry is VmCommandResult =>
        Boolean(entry) &&
        typeof entry.command === "string" &&
        Array.isArray(entry.output) &&
        typeof entry.workspacePath === "string" &&
        typeof entry.createdAt === "string",
    )
    .map((entry) => ({
      command: entry.command,
      output: entry.output.filter((line): line is string => typeof line === "string"),
      workspacePath: entry.workspacePath,
      createdAt: entry.createdAt,
    }));
}

function normalizeSession(
  vmId: string,
  session: VmInstance["session"] | undefined,
  provider: ProviderKind,
): VmSession | null {
  if (session) {
    return {
      kind: session.kind,
      host: session.host ?? null,
      port: session.port ?? null,
      webSocketPath:
        session.kind === "vnc"
          ? buildVncSocketPath(vmId)
          : null,
      browserPath:
        session.kind === "vnc"
          ? buildVmBrowserPath(vmId)
          : null,
      display:
        session.display ??
        (session.host && session.port
          ? `${session.host}:${session.port}`
          : provider === "mock"
            ? "Synthetic frame stream"
            : "Guest VNC pending"),
    };
  }

  if (provider === "mock") {
    return {
      kind: "synthetic",
      host: null,
      port: null,
      webSocketPath: null,
      browserPath: null,
      display: "Synthetic frame stream",
    };
  }

  return null;
}

function normalizeProviderKind(value: VmInstance["provider"] | undefined): ProviderKind {
  return value === "incus" ? "incus" : "mock";
}

function normalizeTemplateForwardedPorts(
  forwardedPorts: EnvironmentTemplate["defaultForwardedPorts"] | undefined,
): TemplatePortForward[] {
  if (!Array.isArray(forwardedPorts)) {
    return [];
  }

  return forwardedPorts
    .map((entry) => normalizeTemplateForwardedPort(entry))
    .filter((entry): entry is TemplatePortForward => entry !== null);
}

function normalizeTemplateForwardedPort(
  forwardedPort: Partial<TemplatePortForward> | undefined,
): TemplatePortForward | null {
  const name = forwardedPort?.name?.trim();
  const guestPort = Number(forwardedPort?.guestPort);

  if (!name || !Number.isFinite(guestPort) || guestPort < 1 || guestPort > 65535) {
    return null;
  }

  return {
    name,
    guestPort,
    protocol: forwardedPort?.protocol === "http" ? "http" : "http",
    description: forwardedPort?.description?.trim() ?? "",
  };
}

function normalizeVmForwardedPorts(
  vmId: string,
  forwardedPorts: VmInstance["forwardedPorts"] | undefined,
): VmPortForward[] {
  if (!Array.isArray(forwardedPorts)) {
    return [];
  }

  return forwardedPorts
    .map((entry, index) => normalizeVmForwardedPort(vmId, entry, index))
    .filter((entry): entry is VmPortForward => entry !== null);
}

function normalizeVmForwardedPort(
  vmId: string,
  forwardedPort: Partial<VmPortForward> | undefined,
  index: number,
): VmPortForward | null {
  const normalized = normalizeTemplateForwardedPort(forwardedPort);

  if (!normalized) {
    return null;
  }

  const id = forwardedPort?.id?.trim() || `port-${String(index + 1).padStart(2, "0")}`;

  return {
    ...normalized,
    id,
    publicPath:
      forwardedPort?.publicPath?.trim() || buildVmForwardPath(vmId, id),
  };
}

function buildProviderRef(vmId: string, name: string): string {
  const slug = slugify(name) || "workspace";
  return `parallaize-${vmId}-${slug}`;
}

function buildVmBrowserPath(vmId: string): string {
  return `/?vm=${vmId}`;
}

function buildVncSocketPath(vmId: string): string {
  return `/api/vms/${vmId}/vnc`;
}

function buildVmForwardPath(vmId: string, forwardId: string): string {
  return `/vm/${vmId}/forwards/${forwardId}/`;
}

function nowIso(): string {
  return new Date().toISOString();
}
