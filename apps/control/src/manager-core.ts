import { statfsSync } from "node:fs";
import { posix as pathPosix } from "node:path";

import {
  describeVmNetworkMode,
  minimumCreateDiskGb,
  normalizeTemplateDesktopTransport,
  normalizeVmDesktopTransport,
  normalizeVmNetworkMode,
  slugify,
} from "../../../packages/shared/src/helpers.js";
import type {
  ActionJob,
  AppState,
  CreateVmInput,
  DashboardSummary,
  EnvironmentTemplate,
  JobKind,
  ProviderState,
  ResourceTelemetry,
  Snapshot,
  TemplatePortForward,
  TemplateHistoryEntry,
  TemplateProvenance,
  VmCommandResult,
  VmDesktopTransport,
  VmDetail,
  VmInstance,
  VmNetworkMode,
  VmPortForward,
} from "../../../packages/shared/src/types.js";
import type {
  DesktopProvider,
  ProviderMutation,
  ProviderTelemetrySample,
} from "./providers.js";
import { buildSyntheticSession } from "./providers-synthetic.js";
import type { StateStore } from "./store.js";
import { FALLBACK_DEFAULT_TEMPLATE_LAUNCH_SOURCE } from "./template-defaults.js";

const MAX_ACTIVITY_LINES = 8;
const MAX_COMMAND_RESULTS = 6;
const MAX_JOBS = 20;
const MAX_TELEMETRY_SAMPLES = 72;
const QUEUED_PROGRESS_PERCENT = 6;
export const DEFAULT_VM_SESSION_MAINTENANCE_REFRESH_MS = 60_000;

export type VmSessionRefreshMode = "none" | "missing" | "all";

export interface DesktopManagerOptions {
  forwardedServiceHostBase?: string | null;
  defaultTemplateLaunchSource?: string | null;
  vmSessionMaintenanceRefreshMs?: number | null;
  streamHealthSecret?: string | null;
  selkiesStreamHealthDegradedRepairMs?: number | null;
  selkiesStreamHealthStaleRepairMs?: number | null;
  selkiesStreamHealthRepairCooldownMs?: number | null;
}

export type JobProgressReporter = (message: string, progressPercent: number | null) => void;

export interface DesktopManagerRuntime {
  readonly defaultTemplateLaunchSource: string;
  readonly hostCpuCount: number;
  readonly hostDiskGb: number;
  readonly hostRamMb: number;
  readonly options: DesktopManagerOptions;
  readonly provider: DesktopProvider;
  readonly store: StateStore;
  readonly vmSessionMaintenanceRefreshMs: number;
  readonly vmTelemetry: Map<string, ResourceTelemetry>;
  hostTelemetry: ResourceTelemetry;
  lastFullVmSessionRefreshRequestAt: number;
  sessionRefreshInFlight: boolean;
  sessionRefreshMode: VmSessionRefreshMode;
  createVmWithTemplateRecovery(
    vm: VmInstance,
    template: EnvironmentTemplate,
    report?: JobProgressReporter,
  ): Promise<ProviderMutation>;
  ensureActiveProvider(vm: VmInstance): void;
  getSummary(): DashboardSummary;
  getVmDetail(vmId: string): VmDetail;
  markVmFailed(vmId: string, error: unknown): void;
  markVmRunning(vmId: string, mutation: ProviderMutation): void;
  markVmStopped(vmId: string, mutation: ProviderMutation): void;
  publish(): void;
  requestVmSessionRefresh(mode?: Exclude<VmSessionRefreshMode, "none">): void;
  requireVm(state: AppState, vmId: string): VmInstance;
  runJob(
    jobId: string,
    runner: (report: JobProgressReporter) => Promise<string>,
  ): Promise<void>;
  syncProviderState(): boolean;
  updateJob(
    jobId: string,
    status: ActionJob["status"],
    message: string,
    progressPercent?: number | null,
  ): void;
}

export function buildVmRecord(
  state: AppState,
  template: EnvironmentTemplate,
  name: string,
  wallpaperName: string,
  resources: CreateVmInput["resources"],
  forwardedPorts: TemplatePortForward[],
  networkMode: VmNetworkMode,
  desktopTransport: VmDesktopTransport | null | undefined,
  provider: ProviderState["kind"],
  status: VmInstance["status"],
  forwardedServiceHostBase: string | null,
): VmInstance {
  const now = nowIso();
  const id = nextId(state, "vm");
  const defaultDesktopTransport = normalizeTemplateDesktopTransport(
    template.defaultDesktopTransport,
  );
  const resolvedDesktopTransport =
    provider === "mock"
      ? null
      : normalizeVmDesktopTransport(desktopTransport ?? defaultDesktopTransport);

  return {
    id,
    name,
    wallpaperName,
    templateId: template.id,
    provider,
    providerRef: buildProviderRef(id, name),
    status,
    resources: { ...resources },
    createdAt: now,
    updatedAt: now,
    liveSince: null,
    lastAction: `Queued from ${template.name}`,
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: state.sequence * 47,
    activeWindow: "editor",
    workspacePath: provider === "mock" ? `/srv/workspaces/${slugify(name)}` : "/root",
    desktopTransport: resolvedDesktopTransport ?? undefined,
    networkMode,
    session: provider === "mock" ? buildSyntheticSession() : null,
    desktopReadyAt: null,
    desktopReadyMs: null,
    forwardedPorts: buildVmForwardedPorts(id, forwardedPorts, forwardedServiceHostBase),
    activityLog: [
      `template: ${template.name}`,
      provider === "mock" ? "desktop: synthetic" : `desktop: ${resolvedDesktopTransport}`,
      `network: ${describeVmNetworkMode(networkMode)}`,
      `status: ${status}`,
    ],
    commandHistory: [],
  };
}

export function buildJob(
  state: AppState,
  kind: JobKind,
  vmId: string | null,
  templateId: string | null,
  message: string,
): ActionJob {
  const now = nowIso();

  return {
    id: nextId(state, "job"),
    kind,
    targetVmId: vmId,
    targetTemplateId: templateId,
    status: "queued",
    message,
    progressPercent: QUEUED_PROGRESS_PERCENT,
    createdAt: now,
    updatedAt: now,
  };
}

export function buildSnapshot(
  state: AppState,
  vm: VmInstance,
  label: string,
  providerRef: string,
  summary: string,
  templateId = vm.templateId,
): Snapshot {
  return {
    id: nextId(state, "snap"),
    vmId: vm.id,
    templateId,
    label,
    summary,
    providerRef,
    resources: { ...vm.resources },
    createdAt: nowIso(),
  };
}

export function normalizeProgressPercent(value: number | null): number | null {
  if (value === null) {
    return null;
  }

  const rounded = Math.round(value);
  return Math.max(0, Math.min(100, rounded));
}

export function resolveVmSessionMaintenanceRefreshMs(
  value: number | null | undefined,
): number {
  if (!Number.isFinite(value) || value == null || value <= 0) {
    return DEFAULT_VM_SESSION_MAINTENANCE_REFRESH_MS;
  }

  return Math.max(1, Math.round(value));
}

export function nextId(state: AppState, prefix: string): string {
  const value = String(state.sequence).padStart(4, "0");
  state.sequence += 1;
  return `${prefix}-${value}`;
}

export function mergeVmSessionRefreshMode(
  current: VmSessionRefreshMode,
  next: Exclude<VmSessionRefreshMode, "none">,
): Exclude<VmSessionRefreshMode, "none"> {
  if (current === "all" || next === "all") {
    return "all";
  }

  return "missing";
}

export function applyProviderMutation(vm: VmInstance, mutation: ProviderMutation): void {
  vm.lastAction = mutation.lastAction;
  vm.updatedAt = nowIso();
  vm.frameRevision += 1;

  if (mutation.activeWindow) {
    vm.activeWindow = mutation.activeWindow;
  }

  if (mutation.workspacePath !== undefined) {
    vm.workspacePath = mutation.workspacePath;
  }

  if ("session" in mutation) {
    vm.session = enrichVmSession(vm.id, mutation.session ?? null);
  }

  if ("desktopReadyAt" in mutation) {
    vm.desktopReadyAt = mutation.desktopReadyAt ?? null;
  }

  if ("desktopReadyMs" in mutation) {
    vm.desktopReadyMs = mutation.desktopReadyMs ?? null;
  }

  appendManyActivity(vm, mutation.activity);

  if (mutation.commandResult) {
    appendCommandResult(vm, {
      command: mutation.commandResult.command,
      output: mutation.commandResult.output,
      workspacePath: mutation.commandResult.workspacePath,
      createdAt: nowIso(),
    });
  }
}

export function appendActivity(vm: VmInstance, line: string): void {
  vm.activityLog.push(line);
  vm.activityLog = vm.activityLog.slice(-MAX_ACTIVITY_LINES);
}

export function appendManyActivity(vm: VmInstance, lines: string[]): void {
  for (const line of lines) {
    appendActivity(vm, line);
  }
}

export function appendCommandResult(vm: VmInstance, entry: VmCommandResult): void {
  const history = [...(vm.commandHistory ?? []), entry];
  vm.commandHistory = history.slice(-MAX_COMMAND_RESULTS);
}

export function hasReachableVncSession(session: VmInstance["session"]): boolean {
  return Boolean(
    session &&
      (session.kind === "vnc" || session.kind === "selkies") &&
      session.reachable !== false &&
      session.host &&
      session.port,
  );
}

export function sameVmSession(
  left: VmInstance["session"],
  right: VmInstance["session"],
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return left === right;
  }

  return (
    left.kind === right.kind &&
    left.host === right.host &&
    left.port === right.port &&
    left.reachable === right.reachable &&
    left.webSocketPath === right.webSocketPath &&
    left.browserPath === right.browserPath &&
    left.display === right.display
  );
}

export function markVmStoppedOutsideControlPlane(vm: VmInstance): void {
  vm.status = "stopped";
  vm.liveSince = null;
  vm.lastAction = "Workspace stopped";
  vm.updatedAt = nowIso();
  vm.frameRevision += 1;
  vm.activeWindow = "logs";
  vm.session = null;
  appendActivity(
    vm,
    `${vm.provider}: detected ${vm.providerRef} stopped outside the dashboard`,
  );
}

export function markVmRunningOutsideControlPlane(vm: VmInstance): void {
  vm.status = "running";
  vm.liveSince = nowIso();
  vm.lastAction = "Workspace resumed";
  vm.updatedAt = nowIso();
  vm.frameRevision += 1;
  vm.activeWindow = "terminal";
  vm.session = null;
  appendActivity(
    vm,
    `${vm.provider}: detected ${vm.providerRef} running outside the dashboard`,
  );
}

export function trimJobs(state: AppState): void {
  state.jobs = state.jobs.slice(0, MAX_JOBS);
}

export function isInterruptedBootJobFailure(job: ActionJob): boolean {
  if (
    job.kind !== "create" &&
    job.kind !== "clone" &&
    job.kind !== "launch-snapshot" &&
    job.kind !== "start" &&
    job.kind !== "restart"
  ) {
    return false;
  }

  return job.message === `Control server restarted before ${job.kind} could finish.`;
}

export function buildCaptureNotes(vm: VmInstance, previousNotes: string[]): string[] {
  const refreshedNotes = [
    `Captured from VM ${vm.name}.`,
    `Workspace path at capture: ${vm.workspacePath}.`,
    ...previousNotes.filter(
      (note) =>
        note !== `Captured from VM ${vm.name}.` &&
        note !== `Workspace path at capture: ${vm.workspacePath}.`,
    ),
  ];

  return refreshedNotes.slice(0, 6);
}

export function buildCapturedTemplateProvenance(
  vm: VmInstance,
  sourceTemplate: EnvironmentTemplate | null,
  snapshot: Snapshot,
): TemplateProvenance {
  return {
    kind: "captured",
    summary: sourceTemplate
      ? `Captured from VM ${vm.name} using template ${sourceTemplate.name}.`
      : `Captured from VM ${vm.name}.`,
    sourceTemplateId: sourceTemplate?.id ?? null,
    sourceTemplateName: sourceTemplate?.name ?? null,
    sourceVmId: vm.id,
    sourceVmName: vm.name,
    sourceSnapshotId: snapshot.id,
    sourceSnapshotLabel: snapshot.label,
  };
}

export function buildClonedTemplateNotes(
  sourceTemplate: EnvironmentTemplate,
  previousNotes: string[],
  initCommands: string[],
): string[] {
  const refreshedNotes = [
    `Cloned from template ${sourceTemplate.name}.`,
    initCommands.length > 0
      ? `First-boot init script runs ${initCommands.length} command${initCommands.length === 1 ? "" : "s"}.`
      : "No first-boot init commands configured.",
    ...previousNotes.filter(
      (note) =>
        note !== `Cloned from template ${sourceTemplate.name}.` &&
        note !== "No first-boot init commands configured." &&
        !note.startsWith("First-boot init script runs "),
    ),
  ];

  return refreshedNotes.slice(0, 6);
}

export function buildClonedTemplateProvenance(
  sourceTemplate: EnvironmentTemplate,
): TemplateProvenance {
  return {
    kind: "cloned",
    summary: `Cloned from template ${sourceTemplate.name}.`,
    sourceTemplateId: sourceTemplate.id,
    sourceTemplateName: sourceTemplate.name,
    sourceVmId: null,
    sourceVmName: null,
    sourceSnapshotId: null,
    sourceSnapshotLabel: null,
  };
}

export function buildTemplateHistoryEntry(
  kind: TemplateHistoryEntry["kind"],
  summary: string,
  createdAt = nowIso(),
): TemplateHistoryEntry {
  return {
    kind,
    summary,
    createdAt,
  };
}

export function appendTemplateHistory(
  history: TemplateHistoryEntry[] | undefined,
  entry: TemplateHistoryEntry,
): TemplateHistoryEntry[] {
  const nextHistory = [
    entry,
    ...(history ?? []).filter(
      (current) =>
        current.kind !== entry.kind ||
        current.summary !== entry.summary ||
        current.createdAt !== entry.createdAt,
    ),
  ];

  return nextHistory.slice(0, 12);
}

export function collectTemplateUpdateFieldLabels(
  template: EnvironmentTemplate,
  nextName: string,
  nextDescription: string,
  nextInitCommands: string[],
): string[] {
  const changedFields: string[] = [];

  if (template.name !== nextName) {
    changedFields.push("name");
  }

  if (template.description !== nextDescription) {
    changedFields.push("description");
  }

  if (!sameStringArray(template.initCommands, nextInitCommands)) {
    changedFields.push("init commands");
  }

  return changedFields.length > 0 ? changedFields : ["template metadata"];
}

export function normalizeTemplateInitCommands(
  initCommands: EnvironmentTemplate["initCommands"] | undefined,
): string[] {
  if (!Array.isArray(initCommands)) {
    return [];
  }

  return initCommands
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0)
    .slice(0, 64);
}

export function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

export function requireTemplate(
  state: AppState,
  templateId: string,
): EnvironmentTemplate {
  const template = state.templates.find((entry) => entry.id === templateId);

  if (!template) {
    throw new Error(`Template ${templateId} was not found.`);
  }

  return template;
}

export function resolveTemplateForSnapshot(
  state: AppState,
  snapshot: Snapshot,
  defaultTemplateLaunchSource = FALLBACK_DEFAULT_TEMPLATE_LAUNCH_SOURCE,
): EnvironmentTemplate {
  return (
    state.templates.find((entry) => entry.id === snapshot.templateId) ??
    buildOrphanedSnapshotTemplate(snapshot, defaultTemplateLaunchSource)
  );
}

export function resolveTemplateCreateFallbackSnapshot(
  state: AppState,
  template: EnvironmentTemplate,
  vm: VmInstance,
  error: unknown,
): Snapshot | null {
  if (!isMissingCapturedTemplateLaunchSourceError(template, error)) {
    return null;
  }

  const candidates = state.snapshots
    .filter(
      (snapshot) =>
        snapshot.templateId === template.id || template.snapshotIds.includes(snapshot.id),
    )
    .sort((left, right) => {
      const rightMs = Date.parse(right.createdAt);
      const leftMs = Date.parse(left.createdAt);
      return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
    });

  return candidates.find((snapshot) => snapshot.resources.diskGb <= vm.resources.diskGb) ?? null;
}

export function isMissingCapturedTemplateLaunchSourceError(
  template: EnvironmentTemplate,
  error: unknown,
): boolean {
  if (!template.launchSource.startsWith("parallaize-template-")) {
    return false;
  }

  const message = errorMessage(error);

  return (
    message.includes(`Image "${template.launchSource}" not found`) ||
    message.includes(`Image '${template.launchSource}' not found`)
  );
}

export function buildOrphanedSnapshotTemplate(
  snapshot: Snapshot,
  defaultTemplateLaunchSource: string,
): EnvironmentTemplate {
  const now = nowIso();

  return {
    id: snapshot.templateId,
    name: "Deleted template",
    description: "Recovered from snapshot metadata after the template record was removed.",
    launchSource: defaultTemplateLaunchSource,
    defaultResources: { ...snapshot.resources },
    defaultForwardedPorts: [],
    defaultDesktopTransport: "selkies",
    initCommands: [],
    tags: ["orphaned"],
    notes: ["Recovered from snapshot metadata after template deletion."],
    snapshotIds: [snapshot.id],
    provenance: {
      kind: "recovered",
      summary: `Recovered from snapshot ${snapshot.label} after template deletion.`,
      sourceTemplateId: snapshot.templateId,
      sourceTemplateName: null,
      sourceVmId: snapshot.vmId,
      sourceVmName: null,
      sourceSnapshotId: snapshot.id,
      sourceSnapshotLabel: snapshot.label,
    },
    history: [
      buildTemplateHistoryEntry(
        "recovered",
        `Recovered from snapshot ${snapshot.label} after template deletion.`,
        now,
      ),
    ],
    createdAt: now,
    updatedAt: now,
  };
}

export function requireVm(state: AppState, vmId: string): VmInstance {
  const vm = state.vms.find((entry) => entry.id === vmId);

  if (!vm) {
    throw new Error(`VM ${vmId} was not found.`);
  }

  return vm;
}

export function requireSnapshot(state: AppState, snapshotId: string): Snapshot {
  const snapshot = state.snapshots.find((entry) => entry.id === snapshotId);

  if (!snapshot) {
    throw new Error(`Snapshot ${snapshotId} was not found.`);
  }

  return snapshot;
}

export function requireVmSnapshot(
  state: AppState,
  vmId: string,
  snapshotId: string,
): Snapshot {
  const snapshot = requireSnapshot(state, snapshotId);

  if (snapshot.vmId !== vmId) {
    throw new Error(`Snapshot ${snapshotId} does not belong to VM ${vmId}.`);
  }

  return snapshot;
}

export function failMissingCreateTemplateId(): never {
  throw new Error("Template launch source is required.");
}

export function validateResources(resources: CreateVmInput["resources"]): void {
  if (
    resources.cpu < 1 ||
    resources.cpu > 96 ||
    resources.ramMb < 1024 ||
    resources.ramMb > 262144 ||
    resources.diskGb < 10 ||
    resources.diskGb > 4096
  ) {
    throw new Error(
      "Resources must be within sane ranges: cpu 1-96, ram 1-256 GB, disk 10-4096 GB.",
    );
  }
}

export function validateTemplateCreateResources(
  template: EnvironmentTemplate,
  resources: CreateVmInput["resources"],
): void {
  const minimumDiskGb = minimumCreateDiskGb(template);

  if (minimumDiskGb !== null && resources.diskGb < minimumDiskGb) {
    throw new Error(
      `Template ${template.name} requires at least ${minimumDiskGb} GB disk because it was captured from a ${minimumDiskGb} GB workspace.`,
    );
  }
}

export function validateSnapshotCreateResources(
  snapshot: Snapshot,
  resources: CreateVmInput["resources"],
): void {
  if (resources.diskGb < snapshot.resources.diskGb) {
    throw new Error(
      `Snapshot ${snapshot.label} requires at least ${snapshot.resources.diskGb} GB disk because shrinking a saved filesystem is not supported.`,
    );
  }
}

export function validateVmCloneResources(
  sourceVm: VmInstance,
  resources: CreateVmInput["resources"],
): void {
  if (resources.diskGb < sourceVm.resources.diskGb) {
    throw new Error(
      `VM ${sourceVm.name} needs at least ${sourceVm.resources.diskGb} GB disk because shrinking a cloned filesystem is not supported.`,
    );
  }
}

export { describeVmNetworkMode, normalizeVmNetworkMode };

export function buildProviderRef(vmId: string, name: string): string {
  const slug = slugify(name) || "workspace";
  return `parallaize-${vmId}-${slug}`;
}

export function validateForwardedPorts(forwardedPorts: TemplatePortForward[]): void {
  const seenNames = new Set<string>();

  for (const forwardedPort of forwardedPorts) {
    const name = forwardedPort.name.trim();

    if (!name) {
      throw new Error("Forwarded port names are required.");
    }

    if (seenNames.has(name.toLowerCase())) {
      throw new Error(`Forwarded port name ${name} is duplicated.`);
    }

    seenNames.add(name.toLowerCase());

    if (forwardedPort.guestPort < 1 || forwardedPort.guestPort > 65535) {
      throw new Error("Forwarded guest ports must be between 1 and 65535.");
    }
  }
}

export function buildVmForwardedPorts(
  vmId: string,
  forwardedPorts: TemplatePortForward[],
  forwardedServiceHostBase: string | null,
): VmPortForward[] {
  return forwardedPorts.map((forwardedPort, index) => {
    const id = `port-${String(index + 1).padStart(2, "0")}`;

    return {
      name: forwardedPort.name.trim(),
      guestPort: forwardedPort.guestPort,
      protocol: forwardedPort.protocol,
      description: forwardedPort.description.trim(),
      id,
      publicPath: buildVmForwardPath(vmId, id),
      publicHostname: buildVmForwardHostname(
        vmId,
        forwardedPort.name,
        forwardedServiceHostBase,
      ),
    };
  });
}

export function resolveVmGuestPath(
  workspacePath: string,
  requestedPath?: string | null,
): string | null {
  const normalizedWorkspacePath = normalizeWorkspaceGuestPath(workspacePath);

  if (!requestedPath || requestedPath.trim().length === 0) {
    return null;
  }

  const candidate = requestedPath.startsWith("/")
    ? requestedPath
    : pathPosix.resolve(normalizedWorkspacePath, requestedPath);
  return normalizeWorkspaceGuestPath(candidate);
}

export function requireVmGuestPath(
  workspacePath: string,
  requestedPath?: string | null,
): string {
  const resolvedPath = resolveVmGuestPath(workspacePath, requestedPath);

  if (!resolvedPath) {
    throw new Error("Guest file path is required.");
  }

  return resolvedPath;
}

export function normalizeWorkspaceGuestPath(path: string): string {
  const normalized = pathPosix.normalize(path || "/");

  if (normalized === ".") {
    return "/";
  }

  return normalized.startsWith("/") ? normalized : pathPosix.resolve("/", normalized);
}

export function copyForwardAsTemplatePort(forwardedPort: VmPortForward): TemplatePortForward {
  return {
    name: forwardedPort.name,
    guestPort: forwardedPort.guestPort,
    protocol: forwardedPort.protocol,
    description: forwardedPort.description,
  };
}

export function copyTemplatePortForward(
  forwardedPort: TemplatePortForward,
): TemplatePortForward {
  return {
    name: forwardedPort.name,
    guestPort: forwardedPort.guestPort,
    protocol: forwardedPort.protocol,
    description: forwardedPort.description,
  };
}

export function enrichVmSession(
  vmId: string,
  session: VmInstance["session"],
): VmInstance["session"] {
  if (!session) {
    return null;
  }

  if (session.kind === "synthetic") {
    return {
      ...session,
      browserPath: null,
      webSocketPath: null,
    };
  }

  if (session.kind === "selkies") {
    return {
      ...session,
      browserPath:
        session.browserPath ??
        (session.reachable !== false && session.host && session.port
          ? buildSelkiesBrowserPath(vmId)
          : null),
      webSocketPath: null,
    };
  }

  return {
    ...session,
    webSocketPath:
      session.reachable !== false && session.host && session.port
        ? buildVncSocketPath(vmId)
        : null,
    browserPath:
      session.reachable !== false && session.host && session.port
        ? buildVmBrowserPath(vmId)
        : null,
  };
}

export function cloneVmSession(session: VmInstance["session"]): VmInstance["session"] {
  if (!session) {
    return null;
  }

  if (session.kind === "vnc" || session.kind === "selkies") {
    return null;
  }

  return {
    ...session,
    browserPath: null,
    webSocketPath: null,
  };
}

export function appendTelemetrySample(
  current: ResourceTelemetry,
  sample: ProviderTelemetrySample | null,
): ResourceTelemetry {
  if (!sample) {
    return {
      ...current,
      cpuPercent: null,
      ramPercent: null,
    };
  }

  const cpuPercent =
    sample.cpuPercent === null ? null : normalizeTelemetryPercent(sample.cpuPercent);
  const ramPercent =
    sample.ramPercent === null ? null : normalizeTelemetryPercent(sample.ramPercent);

  return {
    cpuPercent,
    ramPercent,
    cpuHistory:
      cpuPercent === null ? current.cpuHistory : appendTelemetryPoint(current.cpuHistory, cpuPercent),
    ramHistory:
      ramPercent === null ? current.ramHistory : appendTelemetryPoint(current.ramHistory, ramPercent),
  };
}

export function appendTelemetryPoint(history: number[], value: number): number[] {
  return [...history, value].slice(-MAX_TELEMETRY_SAMPLES);
}

export function emptyResourceTelemetry(): ResourceTelemetry {
  return {
    cpuHistory: [],
    cpuPercent: null,
    ramHistory: [],
    ramPercent: null,
  };
}

export function normalizeTelemetryPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function sameTelemetry(
  left: ResourceTelemetry | null,
  right: ResourceTelemetry | null,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return (
    left.cpuPercent === right.cpuPercent &&
    left.ramPercent === right.ramPercent &&
    left.cpuHistory.length === right.cpuHistory.length &&
    left.ramHistory.length === right.ramHistory.length &&
    left.cpuHistory.every((value, index) => value === right.cpuHistory[index]) &&
    left.ramHistory.every((value, index) => value === right.ramHistory[index])
  );
}

export function sameProviderState(left: ProviderState, right: ProviderState): boolean {
  return (
    left.kind === right.kind &&
    left.available === right.available &&
    left.detail === right.detail &&
    left.hostStatus === right.hostStatus &&
    left.binaryPath === right.binaryPath &&
    left.project === right.project &&
    left.desktopTransport === right.desktopTransport &&
    left.nextSteps.length === right.nextSteps.length &&
    left.nextSteps.every((step, index) => step === right.nextSteps[index])
  );
}

export function buildVncSocketPath(vmId: string): string {
  return `/api/vms/${vmId}/vnc`;
}

export function buildSelkiesBrowserPath(vmId: string): string {
  return `/selkies-${vmId}/`;
}

export function buildVmBrowserPath(vmId: string): string {
  return `/?vm=${vmId}`;
}

export function buildVmForwardPath(vmId: string, forwardId: string): string {
  return `/vm/${vmId}/forwards/${forwardId}/`;
}

export function buildVmForwardHostname(
  vmId: string,
  forwardName: string,
  forwardedServiceHostBase: string | null,
): string | null {
  const normalizedBase = forwardedServiceHostBase
    ?.trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, "");

  if (!normalizedBase) {
    return null;
  }

  return `${slugify(forwardName) || "forward"}--${vmId}.${normalizedBase}`;
}

export function detectHostDiskGb(): number {
  for (const path of ["/var/lib/incus", process.cwd(), "/"]) {
    try {
      const stats = statfsSync(path);
      const totalBytes = stats.bsize * stats.blocks;

      if (Number.isFinite(totalBytes) && totalBytes > 0) {
        return Math.round(totalBytes / (1024 ** 3));
      }
    } catch {
      continue;
    }
  }

  return 0;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
