import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { slugify } from "../../../packages/shared/src/helpers.js";
import type {
  AppState,
  EnvironmentTemplate,
  ProviderState,
  ProviderKind,
  TemplatePortForward,
  VmInstance,
  VmPortForward,
  VmSession,
} from "../../../packages/shared/src/types.js";

const DEFAULT_LAUNCH_SOURCE = "images:ubuntu/noble/desktop";

type LegacyTemplate = Partial<EnvironmentTemplate> & {
  baseImage?: string;
};

type LegacyVm = Partial<VmInstance>;
type LegacyProviderState = Partial<ProviderState>;

type LegacyAppState = Omit<AppState, "provider" | "templates" | "vms"> & {
  provider?: LegacyProviderState;
  templates: LegacyTemplate[];
  vms: LegacyVm[];
};

export class JsonStateStore {
  constructor(
    private readonly filePath: string,
    private readonly createSeed: () => AppState,
  ) {}

  load(): AppState {
    if (!existsSync(this.filePath)) {
      const state = this.createSeed();
      this.save(state);
      return state;
    }

    const raw = readFileSync(this.filePath, "utf8");
    const parsed = JSON.parse(raw) as LegacyAppState;
    const normalized = normalizeState(parsed);

    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      this.save(normalized);
    }

    return normalized;
  }

  save(state: AppState): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  update(mutator: (state: AppState) => boolean | void): {
    state: AppState;
    changed: boolean;
  } {
    const state = this.load();
    const changed = mutator(state) !== false;

    if (changed) {
      state.lastUpdated = new Date().toISOString();
      this.save(state);
    }

    return {
      state,
      changed,
    };
  }
}

function normalizeState(rawState: LegacyAppState): AppState {
  return {
    ...rawState,
    provider: normalizeProviderState(rawState.provider),
    templates: rawState.templates.map(normalizeTemplate),
    vms: rawState.vms.map(normalizeVm),
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
      Array.isArray(provider?.nextSteps) && provider.nextSteps.every((step) => typeof step === "string")
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
    createdAt: template.createdAt ?? new Date().toISOString(),
    updatedAt: template.updatedAt ?? template.createdAt ?? new Date().toISOString(),
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
    createdAt: vm.createdAt ?? new Date().toISOString(),
    updatedAt: vm.updatedAt ?? vm.createdAt ?? new Date().toISOString(),
    liveSince: vm.liveSince ?? null,
    lastAction: vm.lastAction ?? "Recovered from persisted state",
    snapshotIds: Array.isArray(vm.snapshotIds) ? vm.snapshotIds : [],
    frameRevision: vm.frameRevision ?? 1,
    screenSeed: vm.screenSeed ?? 1,
    activeWindow: vm.activeWindow ?? "editor",
    workspacePath,
    session: normalizeSession(vm.id ?? "vm-missing", vm.session, provider),
    forwardedPorts: normalizeVmForwardedPorts(vm.id ?? "vm-missing", vm.forwardedPorts),
    activityLog: Array.isArray(vm.activityLog) ? vm.activityLog : [],
  };
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
