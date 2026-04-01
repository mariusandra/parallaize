import {
  formatTimestamp,
  minimumCreateDiskGb,
  normalizeTemplateDesktopTransport,
  normalizeVmDesktopTransport,
  normalizeVmNetworkMode,
} from "../../../packages/shared/src/helpers.js";
import {
  formatDesktopTransportLabel as formatSharedDesktopTransportLabel,
  providerSupportsBrowserDesktopSessions,
} from "../../../packages/shared/src/desktopTransport.js";
import type {
  DashboardSummary,
  EnvironmentTemplate,
  HealthStatus,
  Snapshot,
  TemplatePortForward,
  VmDetail,
  VmDesktopTransport,
  VmDiskUsageSnapshot,
  VmFileEntry,
  VmInstance,
  VmNetworkMode,
  VmPortForward,
  VmTouchedFile,
  VmTouchedFilesSnapshot,
} from "../../../packages/shared/src/types.js";
import {
  hasBrowserDesktopSession,
} from "./desktopSession.js";
import { buildRandomVmName } from "./vmNames.js";

export type CreateSourceKind = "template" | "snapshot" | "vm";
export type CreateSourceCategory =
  | "system-templates"
  | "my-templates"
  | "snapshots"
  | "existing-vms";

export interface CreateDraft {
  launchSource: string;
  name: string;
  wallpaperName: string;
  cpu: string;
  ramGb: string;
  diskGb: string;
  desktopTransport: VmDesktopTransport;
  networkMode: VmNetworkMode;
  initCommands: string;
  shutdownSourceBeforeClone: boolean;
}

export interface CreateSourceSelection {
  category: CreateSourceCategory;
  kind: CreateSourceKind;
  label: string;
  snapshot: Snapshot | null;
  sourceVm: VmInstance | null;
  template: EnvironmentTemplate;
  value: string;
}

export interface CreateSourceGroup {
  label: string;
  options: CreateSourceSelection[];
}

export interface CaptureDraft {
  mode: "existing" | "new";
  templateId: string;
  name: string;
  description: string;
}

export interface TemplateCloneDraft {
  sourceTemplateId: string;
  name: string;
  description: string;
  initCommands: string;
}

export interface TemplateEditDraft {
  templateId: string;
  name: string;
  description: string;
  initCommands: string;
}

export interface DesktopBootState {
  label: string;
  message: string;
  progressPercent: number | null;
  timingCopy: string | null;
}

export const activeCpuThresholdDefault = 2;

export function syncCreateDraft(
  current: CreateDraft,
  templates: EnvironmentTemplate[],
  snapshots: Snapshot[],
  vms: VmInstance[],
  preserveInput: boolean,
): CreateDraft {
  const selectedSource = resolveCreateSourceSelection(
    templates,
    snapshots,
    vms,
    current.launchSource,
  );
  const nextSource = selectedSource ?? firstCreateSourceSelection(templates, snapshots, vms);

  if (!nextSource) {
    return current;
  }

  if (preserveInput && current.launchSource) {
    return current;
  }

  return buildCreateDraftFromSource(
    nextSource,
    current.name,
    current.wallpaperName,
  );
}

export function buildCreateDraftFromSource(
  source: CreateSourceSelection,
  name = "",
  wallpaperName = "",
): CreateDraft {
  if (source.kind === "snapshot" && source.snapshot) {
    return buildCreateDraftFromSnapshot(
      source.snapshot,
      source.template,
      source.sourceVm,
      name,
      wallpaperName,
    );
  }

  if (source.kind === "vm" && source.sourceVm) {
    return buildCreateDraftFromVm(source.sourceVm, source.template, name, wallpaperName);
  }

  return buildCreateDraftFromTemplate(source.template, name, wallpaperName);
}

export function buildTemplateCloneDraft(template: EnvironmentTemplate): TemplateCloneDraft {
  return {
    sourceTemplateId: template.id,
    name: `${template.name} Custom`,
    description: template.description,
    initCommands: formatInitCommandsDraft(template.initCommands),
  };
}

export function buildTemplateEditDraft(template: EnvironmentTemplate): TemplateEditDraft {
  return {
    templateId: template.id,
    name: template.name,
    description: template.description,
    initCommands: formatInitCommandsDraft(template.initCommands),
  };
}

export function parseInitCommandsDraft(value: string): string[] {
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
export { normalizeVmNetworkMode };

export function formatVmNetworkModeLabel(networkMode: VmNetworkMode): string {
  return networkMode === "dmz" ? "DMZ" : "Default bridge";
}

export function describeVmNetworkMode(networkMode: VmNetworkMode): string {
  if (networkMode === "dmz") {
    return "DMZ keeps guest internet and public DNS working, but blocks access into the host and private ranges except for the managed allowances the workspace stack needs.";
  }

  return "Default bridge keeps the VM on the normal network profile, including the usual host and LAN reachability.";
}

export function firstCreateSourceSelection(
  templates: EnvironmentTemplate[],
  snapshots: Snapshot[],
  vms: VmInstance[],
): CreateSourceSelection | null {
  return buildCreateSourceGroups(templates, snapshots, vms)[0]?.options[0] ?? null;
}

export function buildCreateSourceGroups(
  templates: EnvironmentTemplate[],
  snapshots: Snapshot[],
  vms: VmInstance[],
): CreateSourceGroup[] {
  const systemTemplates = templates
    .filter((template) => isSystemTemplate(template))
    .map((template) => buildTemplateCreateSourceSelection(template));
  const myTemplates = templates
    .filter((template) => !isSystemTemplate(template))
    .map((template) => buildTemplateCreateSourceSelection(template));
  const snapshotOptions = snapshots
    .map((snapshot) => buildSnapshotCreateSourceSelection(snapshot, templates, vms));
  const vmOptions = vms
    .map((vm) => buildVmCreateSourceSelection(vm, templates));

  return [
    systemTemplates.length > 0
      ? {
          label: "System templates",
          options: systemTemplates,
        }
      : null,
    myTemplates.length > 0
      ? {
          label: "My templates",
          options: myTemplates,
        }
      : null,
    snapshotOptions.length > 0
      ? {
          label: "Snapshots",
          options: snapshotOptions,
        }
      : null,
    vmOptions.length > 0
      ? {
          label: "Clone existing VM",
          options: vmOptions,
        }
      : null,
  ].filter((group): group is CreateSourceGroup => group !== null);
}

export function resolveCreateSourceSelection(
  templates: EnvironmentTemplate[],
  snapshots: Snapshot[],
  vms: VmInstance[],
  value: string,
): CreateSourceSelection | null {
  const parsed = parseCreateSourceValue(value);

  if (!parsed) {
    return null;
  }

  if (parsed.kind === "template") {
    const template = templates.find((entry) => entry.id === parsed.id);
    return template ? buildTemplateCreateSourceSelection(template) : null;
  }

  if (parsed.kind === "snapshot") {
    const snapshot = snapshots.find((entry) => entry.id === parsed.id);
    return snapshot ? buildSnapshotCreateSourceSelection(snapshot, templates, vms) : null;
  }

  const vm = vms.find((entry) => entry.id === parsed.id);
  return vm ? buildVmCreateSourceSelection(vm, templates) : null;
}

export function buildCreateLaunchValidationError(
  source: CreateSourceSelection | null,
  diskGbInput: string,
): string | null {
  if (!source) {
    return null;
  }

  const requestedDiskGb = Number(diskGbInput);

  if (!Number.isFinite(requestedDiskGb)) {
    return null;
  }

  if (source.kind === "snapshot" && source.snapshot) {
    const minimumSnapshotDiskGb = source.snapshot.resources.diskGb;

    if (requestedDiskGb < minimumSnapshotDiskGb) {
      return `Snapshot ${source.snapshot.label} needs at least ${minimumSnapshotDiskGb} GB disk because shrinking a saved filesystem is not supported.`;
    }
  }

  if (source.kind === "vm" && source.sourceVm) {
    const minimumVmDiskGb = source.sourceVm.resources.diskGb;

    if (requestedDiskGb < minimumVmDiskGb) {
      return `${source.sourceVm.name} needs at least ${minimumVmDiskGb} GB disk because shrinking a cloned filesystem is not supported.`;
    }
  }

  const minimumTemplateDiskGb = minimumCreateDiskGb(source.template);

  if (minimumTemplateDiskGb === null || requestedDiskGb >= minimumTemplateDiskGb) {
    return null;
  }

  return `${source.template.name} was captured from a ${minimumTemplateDiskGb} GB workspace and needs at least ${minimumTemplateDiskGb} GB disk to launch cleanly.`;
}

export function createSourceSupportsDesktopTransportChoice(
  source: CreateSourceSelection | null,
): boolean {
  return source?.kind === "template" && isSystemTemplate(source.template);
}

export function formatRamDraftValue(ramMb: number): string {
  return trimTrailingZeros((ramMb / 1024).toFixed(3));
}

export function parseRamDraftValue(ramGb: string): number {
  const parsed = Number(ramGb);
  return Number.isFinite(parsed)
    ? Math.round(parsed * 1024)
    : Number.NaN;
}

export function reorderVmIds(
  currentVmIds: string[],
  draggedVmId: string,
  targetVmId: string,
): string[] {
  if (draggedVmId === targetVmId) {
    return currentVmIds;
  }

  const nextVmIds = currentVmIds.filter((vmId) => vmId !== draggedVmId);
  const targetIndex = nextVmIds.indexOf(targetVmId);

  if (targetIndex === -1) {
    return currentVmIds;
  }

  nextVmIds.splice(targetIndex, 0, draggedVmId);
  return nextVmIds;
}

export function sameIdOrder(left: string[], right: string[]): boolean {
  return left.length === right.length &&
    left.every((id, index) => id === right[index]);
}

export function normalizeActiveCpuThreshold(value: number): number {
  if (!Number.isFinite(value)) {
    return activeCpuThresholdDefault;
  }

  return Math.min(100, Math.max(0, Number(value.toFixed(2))));
}

export function formatThresholdPercent(value: number): string {
  return `${trimTrailingZeros(value.toFixed(2))}%`;
}

export function buildCaptureDraft(
  template: EnvironmentTemplate | null,
  vm: VmInstance,
): CaptureDraft {
  if (template) {
    return {
      mode: "existing",
      templateId: template.id,
      name: template.name,
      description: template.description,
    };
  }

  return {
    mode: "new",
    templateId: "",
    name: `Captured ${vm.name}`,
    description: `Captured from workspace ${vm.name}.`,
  };
}

export function formatTemplateProvenanceKindLabel(
  kind: NonNullable<EnvironmentTemplate["provenance"]>["kind"],
): string {
  switch (kind) {
    case "seed":
      return "Seed";
    case "cloned":
      return "Clone";
    case "captured":
      return "Captured";
    case "recovered":
      return "Recovered";
  }
}

export function resolveRecentTemplateSnapshots(
  template: EnvironmentTemplate,
  snapshots: Snapshot[],
  limit: number,
): Snapshot[] {
  const snapshotIds = new Set(template.snapshotIds);

  return snapshots
    .filter((snapshot) => snapshotIds.has(snapshot.id))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, limit);
}

export function isDiskUsageAlert(snapshot: VmDiskUsageSnapshot): boolean {
  return snapshot.status === "warning" || snapshot.status === "critical";
}

export function diskUsageChipLabel(snapshot: VmDiskUsageSnapshot): string {
  switch (snapshot.status) {
    case "warning":
      return "Disk low";
    case "critical":
      return "Disk critical";
    default:
      return "Disk notice";
  }
}

export function diskUsageSummaryText(snapshot: VmDiskUsageSnapshot): string {
  const focus = resolveDiskUsageFocus(snapshot);

  if (!focus || focus.availableBytes === null) {
    return snapshot.detail;
  }

  const subject = focus.path === "/" ? "root filesystem" : focus.path;
  return `${formatBytes(focus.availableBytes)} free on ${subject}`;
}

export function formatVmFileBrowserRowMeta(entry: VmFileEntry): string | null {
  switch (entry.kind) {
    case "directory":
      return null;
    case "file":
      return formatVmFileSize(entry.sizeBytes);
    case "symlink":
      return "symlink";
    case "other":
      return "other";
  }
}

export function formatVmFileBrowserKindToken(kind: VmFileEntry["kind"]): string {
  switch (kind) {
    case "directory":
      return "dir";
    case "file":
      return "file";
    case "symlink":
      return "link";
    case "other":
      return "other";
  }
}

export function buildVmFileBrowserBreadcrumbs(
  currentPath: string,
): Array<{ label: string; path: string }> {
  if (currentPath === "/") {
    return [{ label: "/", path: "/" }];
  }

  let path = "";
  return [
    { label: "/", path: "/" },
    ...currentPath.split("/").filter(Boolean).map((segment) => {
      path = `${path}/${segment}`;
      return {
        label: segment,
        path,
      };
    }),
  ];
}

export function buildVmFileBrowserEntryTitle(entry: VmFileEntry): string {
  const lines = [entry.path];

  if (entry.kind === "file") {
    lines.push(`Size: ${formatVmFileSize(entry.sizeBytes)}`);
  }

  if (entry.modifiedAt) {
    lines.push(`Modified: ${formatTimestamp(entry.modifiedAt)}`);
  }

  return lines.join("\n");
}

export function buildVmFileDownloadHref(vmId: string, path: string): string {
  return `/api/vms/${encodeURIComponent(vmId)}/files/download?path=${encodeURIComponent(path)}`;
}

export function formatTouchedFileRowMeta(entry: VmTouchedFile): string {
  const reasonsLabel = entry.reasons.map(formatTouchedFileReasonLabel).join(", ");

  if (entry.kind === "file") {
    return `${reasonsLabel} · ${formatVmFileSize(entry.sizeBytes)}`;
  }

  return reasonsLabel;
}

export function buildTouchedFileEntryTitle(entry: VmTouchedFile): string {
  const lines = [
    entry.path,
    `Reasons: ${entry.reasons.map(formatTouchedFileReasonLabel).join(", ")}`,
  ];

  if (entry.kind === "file") {
    lines.push(`Size: ${formatVmFileSize(entry.sizeBytes)}`);
  }

  if (entry.modifiedAt) {
    lines.push(`Modified: ${formatTimestamp(entry.modifiedAt)}`);
  }

  if (entry.changedAt) {
    lines.push(`Changed: ${formatTimestamp(entry.changedAt)}`);
  }

  return lines.join("\n");
}

export function buildForwardBrowserHref(forward: VmPortForward): string {
  if (!forward.publicHostname || typeof window === "undefined") {
    return forward.publicPath;
  }

  const current = new URL(window.location.href);
  current.hostname = forward.publicHostname;
  current.pathname = "/";
  current.search = "";
  current.hash = "";
  return current.toString();
}

export function toTemplatePortForward(forward: VmPortForward): TemplatePortForward {
  return {
    name: forward.name,
    guestPort: forward.guestPort,
    protocol: forward.protocol,
    description: forward.description,
  };
}

export function persistenceBackendLabel(kind: HealthStatus["persistence"]["kind"]): string {
  return kind === "postgres" ? "PostgreSQL" : "JSON file";
}

export function persistenceStatusLabel(persistence: HealthStatus["persistence"]): string {
  return persistence.status === "ready" ? "Ready" : "Degraded";
}

export function persistenceChipLabel(persistence: HealthStatus["persistence"]): string {
  return `${persistenceBackendLabel(persistence.kind)} ${persistenceStatusLabel(persistence)}`;
}

export function persistenceLocationLabel(persistence: HealthStatus["persistence"]): string {
  if (persistence.kind === "json") {
    return persistence.dataFile ?? "Unknown JSON path";
  }

  return persistence.databaseConfigured
    ? "Database URL configured"
    : "Database URL missing";
}

export function incusStorageStatusLabel(
  incusStorage: NonNullable<HealthStatus["incusStorage"]>,
): string {
  switch (incusStorage.status) {
    case "ready":
      return "Ready";
    case "warning":
      return "Needs attention";
    case "unavailable":
    default:
      return "Unavailable";
  }
}

export function incusStorageChipLabel(
  incusStorage: NonNullable<HealthStatus["incusStorage"]>,
): string {
  return `Incus storage ${incusStorageStatusLabel(incusStorage)}`;
}

export function incusStoragePoolLabel(
  incusStorage: NonNullable<HealthStatus["incusStorage"]>,
): string {
  return (
    incusStorage.selectedPool ??
    incusStorage.defaultProfilePool ??
    (incusStorage.configuredPool ? `${incusStorage.configuredPool} (missing)` : "Unpinned")
  );
}

export function providerStatusTitle(provider: DashboardSummary["provider"]): string {
  const status =
    provider.hostStatus === "ready"
      ? "Ready"
      : provider.hostStatus === "network-unreachable"
        ? "Internet unreachable"
        : provider.hostStatus === "missing-cli"
          ? "CLI missing"
          : provider.hostStatus === "daemon-unreachable"
            ? "Daemon unreachable"
            : provider.hostStatus === "daemon-conflict"
              ? "Daemon conflict"
              : "Error";

  return `${capitalizeWord(provider.kind)} ${status}. ${provider.detail}`;
}

export function providerStatusDotClassName(provider: DashboardSummary["provider"]): string {
  switch (provider.hostStatus) {
    case "ready":
      return "workspace-rail__status-dot--ready";
    case "network-unreachable":
    case "missing-cli":
    case "daemon-unreachable":
      return "workspace-rail__status-dot--warning";
    case "daemon-conflict":
      return "workspace-rail__status-dot--error";
    default:
      return "workspace-rail__status-dot--error";
  }
}

export function findProminentJob(
  summary: DashboardSummary,
  selectedVmId: string | null,
): {
  activeCount: number;
  job: DashboardSummary["jobs"][number];
  vmName: string;
} | null {
  const activeJobs = summary.jobs.filter(isActiveJob);

  if (activeJobs.length === 0) {
    return null;
  }

  const job =
    activeJobs.find((entry) => entry.targetVmId === selectedVmId) ?? activeJobs[0];
  const vmName =
    summary.vms.find((vm) => vm.id === job.targetVmId)?.name ??
    (job.targetVmId ? job.targetVmId : "System");

  return {
    activeCount: activeJobs.length,
    job,
    vmName,
  };
}

export function pruneDismissedProminentJobIds(
  dismissedJobIds: Record<string, true>,
  jobs: DashboardSummary["jobs"] | null | undefined,
): Record<string, true> {
  const dismissedIds = Object.keys(dismissedJobIds);

  if (dismissedIds.length === 0) {
    return dismissedJobIds;
  }

  const activeJobIds = new Set((jobs ?? []).filter(isActiveJob).map((job) => job.id));
  let changed = false;
  const next: Record<string, true> = {};

  for (const jobId of dismissedIds) {
    if (!activeJobIds.has(jobId)) {
      changed = true;
      continue;
    }

    next[jobId] = true;
  }

  return changed ? next : dismissedJobIds;
}

export function formatJobKindLabel(kind: DashboardSummary["jobs"][number]["kind"]): string {
  switch (kind) {
    case "launch-snapshot":
      return "Launch snapshot";
    case "restore-snapshot":
      return "Restore snapshot";
    case "capture-template":
      return "Capture template";
    case "inject-command":
      return "Run command";
    default:
      return `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
  }
}

export function formatActiveJobTiming(
  job: Pick<DashboardSummary["jobs"][number], "createdAt">,
  nowMs = Date.now(),
): string | null {
  const createdAt = Date.parse(job.createdAt);

  if (!Number.isFinite(createdAt)) {
    return null;
  }

  const elapsedMs = Math.max(0, nowMs - createdAt);
  return `Elapsed ${formatDurationShort(elapsedMs)}`;
}

export function getVmDesktopBootState(
  detail: VmDetail,
  nowMs = Date.now(),
): DesktopBootState | null {
  const failedBootJob = detail.recentJobs.find(
    (job) => isDesktopBootJobKind(job.kind) && job.status === "failed",
  );

  if (failedBootJob) {
    return null;
  }

  const activeJob = detail.recentJobs.find(
    (job) =>
      isDesktopBootJobKind(job.kind) &&
      (job.status === "queued" || job.status === "running"),
  );

  if (!activeJob && detail.vm.status !== "creating") {
    return null;
  }

  if (activeJob?.kind === "start" || activeJob?.kind === "restart") {
    return {
      label: activeJob.kind === "restart" ? "Restarting workspace" : "Booting workspace",
      message:
        activeJob.message ||
        (activeJob.kind === "restart"
          ? "Restarting the VM and waiting for the desktop."
          : "Starting the VM and waiting for the desktop."),
      progressPercent: activeJob.progressPercent ?? null,
      timingCopy: formatActiveJobTiming(activeJob, nowMs),
    };
  }

  if (activeJob?.kind === "clone") {
    return {
      label: "Cloning workspace",
      message: activeJob.message || "Cloning the workspace and preparing the desktop.",
      progressPercent: activeJob.progressPercent ?? null,
      timingCopy: formatActiveJobTiming(activeJob, nowMs),
    };
  }

  if (activeJob?.kind === "launch-snapshot") {
    return {
      label: "Launching snapshot",
      message:
        activeJob.message || "Launching the workspace from a snapshot and waiting for the desktop.",
      progressPercent: activeJob.progressPercent ?? null,
      timingCopy: formatActiveJobTiming(activeJob, nowMs),
    };
  }

  return {
    label: "Creating workspace",
    message: activeJob?.message || "Provisioning the VM and waiting for the desktop.",
    progressPercent: activeJob?.progressPercent ?? null,
    timingCopy: activeJob ? formatActiveJobTiming(activeJob, nowMs) : null,
  };
}

export function desktopFallbackBadge(detail: VmDetail): string {
  const failedBootJob = detail.recentJobs.find(
    (job) => isDesktopBootJobKind(job.kind) && job.status === "failed",
  );

  if (failedBootJob) {
    return "Launch failed";
  }

  if (
    detail.provider.desktopTransport === "synthetic" ||
    detail.vm.session?.kind === "synthetic"
  ) {
    return "Synthetic preview";
  }

  if (detail.vm.status !== "running") {
    return `${capitalizeWord(detail.vm.status)} desktop`;
  }

  return `Waiting for guest ${resolveDesktopTransportLabel(detail.vm)}`;
}

export function shouldShowWorkspaceLogsSurface(detail: VmDetail): boolean {
  return providerSupportsBrowserDesktopSessions(detail.provider.desktopTransport) &&
    detail.vm.status === "running" &&
    !hasBrowserDesktopSession(detail.vm.session);
}

export function workspaceLogsTitle(detail: VmDetail): string {
  const failedBootJob = detail.recentJobs.find(
    (job) => isDesktopBootJobKind(job.kind) && job.status === "failed",
  );

  return failedBootJob
    ? "Desktop bridge failed"
    : `Waiting for guest ${resolveDesktopTransportLabel(detail.vm)}`;
}

export function workspaceLogsMessage(detail: VmDetail): string {
  const failedBootJob = detail.recentJobs.find(
    (job) => isDesktopBootJobKind(job.kind) && job.status === "failed",
  );

  if (failedBootJob) {
    return `${failedBootJob.message} Showing the latest runtime logs while the running VM stays attached to the host.`;
  }

  return `This VM is running, but the browser ${resolveDesktopTransportLabel(detail.vm)} session is not ready yet. Showing the latest runtime logs until the desktop attaches.`;
}

export function desktopFallbackMessage(detail: VmDetail): string {
  const failedBootJob = detail.recentJobs.find(
    (job) => isDesktopBootJobKind(job.kind) && job.status === "failed",
  );

  if (failedBootJob) {
    return failedBootJob.message;
  }

  if (
    detail.provider.desktopTransport === "synthetic" ||
    detail.vm.session?.kind === "synthetic"
  ) {
    return "This server is running the mock provider, so the dashboard renders generated desktop frames instead of a live browser desktop session.";
  }

  if (detail.vm.status !== "running") {
    return "Start the VM to attach a browser desktop.";
  }

  return `This VM does not have a browser ${resolveDesktopTransportLabel(detail.vm)} session yet. The synthetic frame stays here until the guest publishes a reachable desktop endpoint.`;
}

export function workspaceFallbackTitle(detail: VmDetail): string {
  if (
    detail.provider.desktopTransport === "synthetic" ||
    detail.vm.session?.kind === "synthetic"
  ) {
    return "Synthetic desktop preview";
  }

  if (detail.vm.status !== "running") {
    return "Desktop offline";
  }

  return "Desktop not attached";
}

export function vmTilePreviewLabel(
  vm: VmInstance,
  showLivePreview: boolean,
  selected = false,
): string {
  if (vm.session?.kind === "synthetic") {
    return "Synthetic preview";
  }

  if (vm.status !== "running") {
    return capitalizeWord(vm.status);
  }

  if (
    showLivePreview &&
    (vm.session?.kind === "selkies" || vm.desktopTransport === "selkies")
  ) {
    return selected ? "Live on stage" : "Connecting preview";
  }

  if (showLivePreview) {
    return `Waiting for ${resolveDesktopTransportLabel(vm)}`;
  }

  if (vm.desktopTransport || vm.session?.kind) {
    return `${resolveDesktopTransportLabel(vm)} desktop`;
  }

  return "Static preview";
}

export function formatDesktopTransportLabel(
  vm: Pick<VmInstance, "desktopTransport" | "session">,
): string {
  if (vm.session?.kind === "synthetic") {
    return "Synthetic";
  }

  return resolveDesktopTransportLabel(vm);
}

export function formatDesktopReadyMs(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Pending";
  }

  if (value < 1000) {
    return `${Math.max(0, Math.round(value))} ms`;
  }

  if (value < 60_000) {
    return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} s`;
  }

  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function buildCreateDraftFromTemplate(
  template: EnvironmentTemplate,
  name = "",
  wallpaperName = "",
): CreateDraft {
  const nextWallpaperName = wallpaperName || buildRandomVmName();

  return {
    launchSource: buildCreateSourceValue("template", template.id),
    name: name || nextWallpaperName,
    wallpaperName: nextWallpaperName,
    cpu: String(template.defaultResources.cpu),
    ramGb: formatRamDraftValue(template.defaultResources.ramMb),
    diskGb: String(template.defaultResources.diskGb),
    desktopTransport: normalizeTemplateDesktopTransport(template.defaultDesktopTransport),
    networkMode: template.defaultNetworkMode ?? "default",
    initCommands: formatInitCommandsDraft(template.initCommands),
    shutdownSourceBeforeClone: false,
  };
}

export function buildCreateDraftFromSnapshot(
  snapshot: Snapshot,
  template: EnvironmentTemplate,
  sourceVm: VmInstance | null,
  name = "",
  wallpaperName = "",
): CreateDraft {
  const nextWallpaperName = wallpaperName || buildRandomVmName();

  return {
    launchSource: buildCreateSourceValue("snapshot", snapshot.id),
    name: name || nextWallpaperName,
    wallpaperName: nextWallpaperName,
    cpu: String(snapshot.resources.cpu),
    ramGb: formatRamDraftValue(snapshot.resources.ramMb),
    diskGb: String(snapshot.resources.diskGb),
    desktopTransport: resolveCreateDraftDesktopTransport(template, sourceVm),
    networkMode: normalizeVmNetworkMode(sourceVm?.networkMode ?? template.defaultNetworkMode),
    initCommands: "",
    shutdownSourceBeforeClone: false,
  };
}

export function buildCreateDraftFromVm(
  sourceVm: VmInstance,
  template: EnvironmentTemplate,
  name = "",
  wallpaperName = "",
): CreateDraft {
  const nextWallpaperName = wallpaperName || buildRandomVmName();

  return {
    launchSource: buildCreateSourceValue("vm", sourceVm.id),
    name: name || nextWallpaperName,
    wallpaperName: nextWallpaperName,
    cpu: String(sourceVm.resources.cpu),
    ramGb: formatRamDraftValue(sourceVm.resources.ramMb),
    diskGb: String(sourceVm.resources.diskGb),
    desktopTransport: resolveCreateDraftDesktopTransport(template, sourceVm),
    networkMode: normalizeVmNetworkMode(sourceVm.networkMode ?? template.defaultNetworkMode),
    initCommands: "",
    shutdownSourceBeforeClone: sourceVm.status === "running",
  };
}

function formatInitCommandsDraft(commands: string[]): string {
  return commands.join("\n");
}

function resolveCreateDraftDesktopTransport(
  template: EnvironmentTemplate,
  sourceVm?: VmInstance | null,
): VmDesktopTransport {
  if (sourceVm) {
    return normalizeVmDesktopTransport(
      sourceVm.desktopTransport ?? template.defaultDesktopTransport,
    );
  }

  return normalizeTemplateDesktopTransport(template.defaultDesktopTransport);
}

function buildCreateSourceValue(kind: CreateSourceKind, id: string): string {
  return `${kind}:${id}`;
}

function parseCreateSourceValue(
  value: string,
): { id: string; kind: CreateSourceKind } | null {
  const separatorIndex = value.indexOf(":");

  if (separatorIndex === -1) {
    return null;
  }

  const kind = value.slice(0, separatorIndex);
  const id = value.slice(separatorIndex + 1);

  if ((kind !== "template" && kind !== "snapshot" && kind !== "vm") || id.length === 0) {
    return null;
  }

  return {
    id,
    kind,
  };
}

function buildTemplateCreateSourceSelection(
  template: EnvironmentTemplate,
): CreateSourceSelection {
  return {
    category: isSystemTemplate(template) ? "system-templates" : "my-templates",
    kind: "template",
    label: template.name,
    snapshot: null,
    sourceVm: null,
    template,
    value: buildCreateSourceValue("template", template.id),
  };
}

function buildSnapshotCreateSourceSelection(
  snapshot: Snapshot,
  templates: EnvironmentTemplate[],
  vms: VmInstance[],
): CreateSourceSelection {
  const template = resolveCreateSourceTemplate(templates, snapshot);
  const sourceVm = vms.find((entry) => entry.id === snapshot.vmId) ?? null;

  return {
    category: "snapshots",
    kind: "snapshot",
    label: `${snapshot.label} - ${sourceVm?.name ?? template.name}`,
    snapshot,
    sourceVm,
    template,
    value: buildCreateSourceValue("snapshot", snapshot.id),
  };
}

function buildVmCreateSourceSelection(
  vm: VmInstance,
  templates: EnvironmentTemplate[],
): CreateSourceSelection {
  const template =
    templates.find((entry) => entry.id === vm.templateId) ??
    buildRecoveredCreateSourceTemplateFromVm(vm);

  return {
    category: "existing-vms",
    kind: "vm",
    label: `${vm.name} - ${vm.status}`,
    snapshot: null,
    sourceVm: vm,
    template,
    value: buildCreateSourceValue("vm", vm.id),
  };
}

function resolveCreateSourceTemplate(
  templates: EnvironmentTemplate[],
  snapshot: Snapshot,
): EnvironmentTemplate {
  return (
    templates.find((entry) => entry.id === snapshot.templateId) ??
    buildRecoveredCreateSourceTemplate(snapshot)
  );
}

function buildRecoveredCreateSourceTemplate(
  snapshot: Snapshot,
): EnvironmentTemplate {
  return {
    id: snapshot.templateId,
    name: "Deleted template",
    description: "Recovered from snapshot metadata after the template record was removed.",
    launchSource: "images:ubuntu/noble/desktop",
    defaultResources: { ...snapshot.resources },
    defaultForwardedPorts: [],
    defaultNetworkMode: "default",
    initCommands: [],
    tags: ["orphaned"],
    notes: ["Recovered from snapshot metadata after template deletion."],
    snapshotIds: [snapshot.id],
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.createdAt,
  };
}

function buildRecoveredCreateSourceTemplateFromVm(
  vm: VmInstance,
): EnvironmentTemplate {
  return {
    id: vm.templateId,
    name: "Deleted template",
    description: "Recovered from VM metadata after the template record was removed.",
    launchSource: "images:ubuntu/noble/desktop",
    defaultResources: { ...vm.resources },
    defaultForwardedPorts: [],
    defaultNetworkMode: normalizeVmNetworkMode(vm.networkMode),
    initCommands: [],
    tags: ["orphaned"],
    notes: ["Recovered from VM metadata after template deletion."],
    snapshotIds: [],
    createdAt: vm.createdAt,
    updatedAt: vm.updatedAt,
  };
}

function isSystemTemplate(template: EnvironmentTemplate): boolean {
  return template.provenance?.kind === "seed";
}

function trimTrailingZeros(value: string): string {
  return value.replace(/(?:\.0+|(\.\d*?[1-9])0+)$/, "$1");
}

function resolveDiskUsageFocus(
  snapshot: VmDiskUsageSnapshot,
): VmDiskUsageSnapshot["root"] {
  if (!snapshot.root) {
    return snapshot.workspace;
  }

  if (!snapshot.workspace) {
    return snapshot.root;
  }

  const rootAvailable = snapshot.root.availableBytes ?? Number.POSITIVE_INFINITY;
  const workspaceAvailable = snapshot.workspace.availableBytes ?? Number.POSITIVE_INFINITY;
  return workspaceAvailable <= rootAvailable ? snapshot.workspace : snapshot.root;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return "Unknown";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 ** 2) {
    return `${trimTrailingZeros((value / 1024).toFixed(1))} KiB`;
  }

  if (value < 1024 ** 3) {
    return `${trimTrailingZeros((value / (1024 ** 2)).toFixed(1))} MiB`;
  }

  if (value < 1024 ** 4) {
    return `${trimTrailingZeros((value / (1024 ** 3)).toFixed(1))} GiB`;
  }

  return `${trimTrailingZeros((value / (1024 ** 4)).toFixed(1))} TiB`;
}

function formatVmFileSize(sizeBytes: number | null): string {
  if (sizeBytes === null) {
    return "n/a";
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${trimTrailingZeros((sizeBytes / 1024).toFixed(1))} KB`;
  }

  return `${trimTrailingZeros((sizeBytes / (1024 * 1024)).toFixed(1))} MB`;
}

function formatTouchedFileReasonLabel(
  reason: VmTouchedFilesSnapshot["entries"][number]["reasons"][number],
): string {
  switch (reason) {
    case "mtime":
      return "mtime";
    case "ctime":
      return "ctime";
    case "command-history":
      return "command history";
  }
}

function isActiveJob(job: DashboardSummary["jobs"][number]): boolean {
  return job.status === "queued" || job.status === "running";
}

function isDesktopBootJobKind(kind: DashboardSummary["jobs"][number]["kind"]): boolean {
  return (
    kind === "create" ||
    kind === "clone" ||
    kind === "launch-snapshot" ||
    kind === "start" ||
    kind === "restart"
  );
}

function formatDurationShort(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return minutes > 0
      ? `${hours}h ${minutes}m`
      : `${hours}h`;
  }

  if (minutes > 0) {
    return seconds > 0
      ? `${minutes}m ${seconds}s`
      : `${minutes}m`;
  }

  return `${seconds}s`;
}

function resolveDesktopTransportLabel(
  vm: Pick<VmInstance, "desktopTransport" | "session">,
): string {
  return formatSharedDesktopTransportLabel(
    vm.session?.kind ?? vm.desktopTransport ?? "vnc",
  );
}

function capitalizeWord(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
