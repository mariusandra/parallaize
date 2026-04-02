import { cpus, totalmem } from "node:os";

import type {
  ActionJob,
  CaptureTemplateInput,
  CloneVmInput,
  CreateTemplateInput,
  CreateVmInput,
  DashboardSummary,
  EnvironmentTemplate,
  ProviderState,
  ReorderVmsInput,
  ResizeVmInput,
  ResourceTelemetry,
  SetVmResolutionInput,
  SnapshotInput,
  UpdateTemplateInput,
  VmDesktopBridgeVersion,
  UpdateVmForwardedPortsInput,
  UpdateVmInput,
  UpdateVmNetworkInput,
  VmDetail,
  VmDiskUsageSnapshot,
  VmFileBrowserSnapshot,
  VmInstance,
  VmLogsSnapshot,
  VmTouchedFilesSnapshot,
} from "../../../packages/shared/src/types.js";
import type {
  DesktopProvider,
  ProviderMutation,
  VmFileContent,
  VmPreviewImage,
} from "./providers.js";
import type { StateStore } from "./store.js";
import {
  appendActivity,
  appendTelemetrySample,
  applyProviderMutation,
  detectHostDiskGb,
  emptyResourceTelemetry,
  errorMessage,
  nowIso,
  resolveVmSessionMaintenanceRefreshMs,
  requireVm,
  normalizeProgressPercent,
  resolveTemplateCreateFallbackSnapshot,
  type DesktopManagerOptions,
  type DesktopManagerRuntime,
  type JobProgressReporter,
  type VmSessionRefreshMode,
} from "./manager-core.js";
import {
  captureTemplate,
  cloneVm,
  createTemplate,
  createVm,
  deleteTemplate,
  deleteVm,
  deleteVmSnapshot,
  injectCommand,
  launchVmFromSnapshot,
  reorderVms,
  pauseVm,
  resizeVm,
  restartVm,
  restoreVmSnapshot,
  setVmNetworkMode,
  setVmResolution,
  snapshotVm,
  startVm,
  stopVm,
  updateTemplate,
  updateVm,
  updateVmForwardedPorts,
} from "./manager-commands.js";
import {
  browseVmFiles,
  getProviderState,
  getSummary,
  getVmDetail,
  getVmDiskUsage,
  getVmFrame,
  getVmLogs,
  getVmPreviewImage,
  getVmTouchedFiles,
  readVmFile,
} from "./manager-read-models.js";
import {
  performManagerTick,
  reconcileDefaultTemplateLaunchSource,
  reconcileFailedProvisioningJobs,
  reconcileInterruptedJobs,
  recoverInterruptedBootVms,
  requestVmSessionRefresh,
  syncProviderState,
} from "./manager-workers.js";
import {
  buildVmStreamHealthToken,
  sameVmStreamHealthToken,
  type VmGuestStreamHealthSample,
} from "./stream-health.js";
import { resolveDefaultTemplateLaunchSource } from "./template-defaults.js";

const DEFAULT_SELKIES_STREAM_HEALTH_DEGRADED_REPAIR_MS = 30_000;
const DEFAULT_SELKIES_STREAM_HEALTH_STALE_REPAIR_MS = 60_000;
const DEFAULT_SELKIES_STREAM_HEALTH_REPAIR_COOLDOWN_MS = 5 * 60_000;

interface VmStreamHealthRecord {
  connected: boolean;
  desktopHealthy: boolean;
  lastDisconnectAtMs: number | null;
  lastHeartbeatAtMs: number | null;
  localReachable: boolean;
  nonReadySinceMs: number | null;
  reason: string | null;
  sampledAt: string | null;
  serviceActive: boolean;
  source: string | null;
  status: VmGuestStreamHealthSample["status"] | null;
}

export class DesktopManager {
  private readonly listeners = new Set<(summary: DashboardSummary) => void>();
  private ticker: NodeJS.Timeout | null = null;
  private hostTelemetry: ResourceTelemetry = emptyResourceTelemetry();
  private readonly vmTelemetry = new Map<string, ResourceTelemetry>();
  private readonly hostCpuCount = cpus().length;
  private readonly hostRamMb = Math.round(totalmem() / (1024 * 1024));
  private readonly hostDiskGb = detectHostDiskGb();
  private readonly defaultTemplateLaunchSource: string;
  private readonly vmSessionMaintenanceRefreshMs: number;
  private readonly streamHealthSecret: string;
  private readonly selkiesStreamHealthDegradedRepairMs: number;
  private readonly selkiesStreamHealthStaleRepairMs: number;
  private readonly selkiesStreamHealthRepairCooldownMs: number;
  private readonly vmStreamHealth = new Map<string, VmStreamHealthRecord>();
  private readonly vmStreamHealthTimers = new Map<string, NodeJS.Timeout>();
  private readonly vmStreamHealthRepairAttemptAt = new Map<string, number>();
  private readonly vmStreamHealthRepairInFlight = new Set<string>();
  private lastFullVmSessionRefreshRequestAt = 0;
  private sessionRefreshMode: VmSessionRefreshMode = "none";
  private sessionRefreshInFlight = false;
  private readonly runtime: DesktopManagerRuntime;

  constructor(
    private readonly store: StateStore,
    private readonly provider: DesktopProvider,
    private readonly options: DesktopManagerOptions = {},
  ) {
    this.defaultTemplateLaunchSource = resolveDefaultTemplateLaunchSource(
      this.options.defaultTemplateLaunchSource,
    );
    this.streamHealthSecret = this.options.streamHealthSecret ?? "";
    this.vmSessionMaintenanceRefreshMs = resolveVmSessionMaintenanceRefreshMs(
      this.options.vmSessionMaintenanceRefreshMs,
    );
    this.selkiesStreamHealthDegradedRepairMs = resolvePositiveDelay(
      this.options.selkiesStreamHealthDegradedRepairMs,
      DEFAULT_SELKIES_STREAM_HEALTH_DEGRADED_REPAIR_MS,
    );
    this.selkiesStreamHealthStaleRepairMs = resolvePositiveDelay(
      this.options.selkiesStreamHealthStaleRepairMs,
      DEFAULT_SELKIES_STREAM_HEALTH_STALE_REPAIR_MS,
    );
    this.selkiesStreamHealthRepairCooldownMs = resolvePositiveDelay(
      this.options.selkiesStreamHealthRepairCooldownMs,
      DEFAULT_SELKIES_STREAM_HEALTH_REPAIR_COOLDOWN_MS,
    );
    this.runtime = this.createRuntime();
    reconcileDefaultTemplateLaunchSource(this.runtime);
    syncProviderState(this.runtime);
    reconcileInterruptedJobs(this.runtime);
    reconcileFailedProvisioningJobs(this.runtime);
    recoverInterruptedBootVms(this.runtime);
    this.hostTelemetry = appendTelemetrySample(
      emptyResourceTelemetry(),
      this.provider.sampleHostTelemetry(),
    );
    requestVmSessionRefresh(this.runtime, "all");
  }

  start(): void {
    if (this.ticker) {
      return;
    }

    this.ticker = setInterval(() => {
      performManagerTick(this.runtime);
    }, 2400);
  }

  stop(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }

    for (const timer of this.vmStreamHealthTimers.values()) {
      clearTimeout(timer);
    }

    this.vmStreamHealthTimers.clear();
  }

  getProviderState(): ProviderState {
    return getProviderState(this.runtime);
  }

  getSummary(): DashboardSummary {
    return getSummary(this.runtime);
  }

  getVmDetail(vmId: string): VmDetail {
    return getVmDetail(this.runtime, vmId);
  }

  async getVmLogs(vmId: string): Promise<VmLogsSnapshot> {
    return getVmLogs(this.runtime, vmId);
  }

  async browseVmFiles(
    vmId: string,
    requestedPath?: string | null,
  ): Promise<VmFileBrowserSnapshot> {
    return browseVmFiles(this.runtime, vmId, requestedPath);
  }

  async readVmFile(vmId: string, requestedPath: string): Promise<VmFileContent> {
    return readVmFile(this.runtime, vmId, requestedPath);
  }

  async getVmTouchedFiles(vmId: string): Promise<VmTouchedFilesSnapshot> {
    return getVmTouchedFiles(this.runtime, vmId);
  }

  async getVmDiskUsage(vmId: string): Promise<VmDiskUsageSnapshot> {
    return getVmDiskUsage(this.runtime, vmId);
  }

  async getVmPreviewImage(vmId: string): Promise<VmPreviewImage> {
    return getVmPreviewImage(this.runtime, vmId);
  }

  async getVmDesktopBridgeVersion(
    vmId: string,
  ): Promise<VmDesktopBridgeVersion | null> {
    const state = this.runtime.store.load();
    const vm = requireVm(state, vmId);
    this.runtime.ensureActiveProvider(vm);

    return this.provider.readVmDesktopBridgeVersion
      ? this.provider.readVmDesktopBridgeVersion(vm)
      : null;
  }

  async repairVmDesktopBridge(vmId: string): Promise<VmDetail> {
    return this.repairVmDesktopBridgeInternal(vmId);
  }

  async restartVmDesktopService(vmId: string): Promise<VmDetail> {
    return this.restartVmDesktopServiceInternal(vmId);
  }

  getVmFrame(vmId: string, mode: "tile" | "detail"): string {
    return getVmFrame(this.runtime, vmId, mode);
  }

  validateVmStreamHealthToken(vmId: string, token: string): boolean {
    if (!this.streamHealthSecret) {
      return false;
    }

    const vm = this.runtime.store.load().vms.find((entry) => entry.id === vmId);

    if (!vm || !this.isVmEligibleForStreamHealth(vm)) {
      return false;
    }

    return sameVmStreamHealthToken(
      token,
      buildVmStreamHealthToken(this.streamHealthSecret, vmId),
    );
  }

  handleVmStreamHealthConnected(vmId: string): void {
    const vm = this.runtime.store.load().vms.find((entry) => entry.id === vmId);

    if (!vm || !this.isVmEligibleForStreamHealth(vm)) {
      this.clearVmStreamHealth(vmId);
      return;
    }

    const record = this.vmStreamHealth.get(vmId) ?? createVmStreamHealthRecord();
    record.connected = true;
    record.lastDisconnectAtMs = null;
    this.vmStreamHealth.set(vmId, record);
    this.syncVmStreamHealthTimer(vmId);
  }

  handleVmStreamHealthHeartbeat(vmId: string, sample: VmGuestStreamHealthSample): void {
    const vm = this.runtime.store.load().vms.find((entry) => entry.id === vmId);

    if (!vm || !this.isVmEligibleForStreamHealth(vm)) {
      this.clearVmStreamHealth(vmId);
      return;
    }

    const record = this.vmStreamHealth.get(vmId) ?? createVmStreamHealthRecord();
    const now = Date.now();
    const wasNonReady = record.status !== null && record.status !== "ready";

    record.connected = true;
    record.desktopHealthy = sample.desktopHealthy;
    record.lastDisconnectAtMs = null;
    record.lastHeartbeatAtMs = now;
    record.localReachable = sample.localReachable;
    record.reason = sample.reason;
    record.sampledAt = sample.sampledAt;
    record.serviceActive = sample.serviceActive;
    record.source = sample.source;
    record.status = sample.status;

    if (sample.status === "ready") {
      record.nonReadySinceMs = null;
    } else if (!wasNonReady) {
      record.nonReadySinceMs = now;
    } else if (record.nonReadySinceMs === null) {
      record.nonReadySinceMs = now;
    }

    this.vmStreamHealth.set(vmId, record);
    this.syncVmStreamHealthTimer(vmId);
  }

  handleVmStreamHealthDisconnected(vmId: string): void {
    const record = this.vmStreamHealth.get(vmId);

    if (!record) {
      return;
    }

    record.connected = false;
    record.lastDisconnectAtMs = Date.now();
    this.syncVmStreamHealthTimer(vmId);
  }

  subscribe(listener: (summary: DashboardSummary) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSummary());

    return () => {
      this.listeners.delete(listener);
    };
  }

  createVm(input: CreateVmInput): VmInstance {
    return createVm(this.runtime, input);
  }

  cloneVm(input: CloneVmInput): VmInstance {
    return cloneVm(this.runtime, input);
  }

  startVm(vmId: string): void {
    startVm(this.runtime, vmId);
  }

  pauseVm(vmId: string): void {
    pauseVm(this.runtime, vmId);
  }

  stopVm(vmId: string): void {
    stopVm(this.runtime, vmId);
  }

  restartVm(vmId: string): void {
    restartVm(this.runtime, vmId);
  }

  reorderVms(input: ReorderVmsInput): DashboardSummary {
    return reorderVms(this.runtime, input);
  }

  deleteVm(vmId: string): void {
    deleteVm(this.runtime, vmId);
  }

  deleteVmSnapshot(vmId: string, snapshotId: string): void {
    deleteVmSnapshot(this.runtime, vmId, snapshotId);
  }

  resizeVm(vmId: string, input: ResizeVmInput): void {
    resizeVm(this.runtime, vmId, input);
  }

  snapshotVm(vmId: string, input: SnapshotInput): void {
    snapshotVm(this.runtime, vmId, input);
  }

  launchVmFromSnapshot(vmId: string, snapshotId: string, input: CloneVmInput): VmInstance {
    return launchVmFromSnapshot(this.runtime, vmId, snapshotId, input);
  }

  restoreVmSnapshot(vmId: string, snapshotId: string): void {
    restoreVmSnapshot(this.runtime, vmId, snapshotId);
  }

  captureTemplate(vmId: string, input: CaptureTemplateInput): void {
    captureTemplate(this.runtime, vmId, input);
  }

  createTemplate(input: CreateTemplateInput): EnvironmentTemplate {
    return createTemplate(this.runtime, input);
  }

  updateTemplate(templateId: string, input: UpdateTemplateInput): EnvironmentTemplate {
    return updateTemplate(this.runtime, templateId, input);
  }

  async updateVm(vmId: string, input: UpdateVmInput): Promise<VmInstance> {
    return updateVm(this.runtime, vmId, input);
  }

  deleteTemplate(templateId: string): void {
    deleteTemplate(this.runtime, templateId);
  }

  injectCommand(vmId: string, command: string): void {
    injectCommand(this.runtime, vmId, command);
  }

  async setVmResolution(vmId: string, input: SetVmResolutionInput): Promise<void> {
    await setVmResolution(this.runtime, vmId, input);
  }

  async setVmNetworkMode(vmId: string, input: UpdateVmNetworkInput): Promise<void> {
    await setVmNetworkMode(this.runtime, vmId, input);
  }

  updateVmForwardedPorts(vmId: string, input: UpdateVmForwardedPortsInput): void {
    updateVmForwardedPorts(this.runtime, vmId, input);
  }

  private createRuntime(): DesktopManagerRuntime {
    const self = this;

    return {
      store: self.store,
      provider: self.provider,
      options: self.options,
      vmTelemetry: self.vmTelemetry,
      get defaultTemplateLaunchSource() {
        return self.defaultTemplateLaunchSource;
      },
      get vmSessionMaintenanceRefreshMs() {
        return self.vmSessionMaintenanceRefreshMs;
      },
      get hostCpuCount() {
        return self.hostCpuCount;
      },
      get hostDiskGb() {
        return self.hostDiskGb;
      },
      get hostRamMb() {
        return self.hostRamMb;
      },
      get hostTelemetry() {
        return self.hostTelemetry;
      },
      set hostTelemetry(value) {
        self.hostTelemetry = value;
      },
      get lastFullVmSessionRefreshRequestAt() {
        return self.lastFullVmSessionRefreshRequestAt;
      },
      set lastFullVmSessionRefreshRequestAt(value) {
        self.lastFullVmSessionRefreshRequestAt = value;
      },
      get sessionRefreshInFlight() {
        return self.sessionRefreshInFlight;
      },
      set sessionRefreshInFlight(value) {
        self.sessionRefreshInFlight = value;
      },
      get sessionRefreshMode() {
        return self.sessionRefreshMode;
      },
      set sessionRefreshMode(value) {
        self.sessionRefreshMode = value;
      },
      createVmWithTemplateRecovery: (vm, template, report) =>
        self.createVmWithTemplateRecovery(vm, template, report),
      ensureActiveProvider: (vm) => self.ensureActiveProvider(vm),
      getSummary: () => getSummary(self.runtime),
      getVmDetail: (vmId) => getVmDetail(self.runtime, vmId),
      markVmFailed: (vmId, error) => self.markVmFailed(vmId, error),
      markVmRunning: (vmId, mutation) => self.markVmRunning(vmId, mutation),
      markVmStopped: (vmId, mutation) => self.markVmStopped(vmId, mutation),
      publish: () => self.publish(),
      requestVmSessionRefresh: (mode) => requestVmSessionRefresh(self.runtime, mode),
      requireVm: (state, vmId) => requireVm(state, vmId),
      runJob: (jobId, runner) => self.runJob(jobId, runner),
      syncProviderState: () => syncProviderState(self.runtime),
      updateJob: (jobId, status, message, progressPercent) =>
        self.updateJob(jobId, status, message, progressPercent),
    };
  }

  private async runJob(
    jobId: string,
    runner: (report: JobProgressReporter) => Promise<string>,
  ): Promise<void> {
    this.updateJob(jobId, "running", "Action in progress", 14);

    try {
      const report: JobProgressReporter = (message, progressPercent) => {
        this.updateJob(jobId, "running", message, progressPercent);
      };
      const message = await runner(report);
      this.updateJob(jobId, "succeeded", message, 100);
    } catch (error) {
      this.updateJob(jobId, "failed", errorMessage(error), null);
    }
  }

  private updateJob(
    jobId: string,
    status: ActionJob["status"],
    message: string,
    progressPercent?: number | null,
  ): void {
    this.store.update((draft) => {
      const job = draft.jobs.find((entry) => entry.id === jobId);

      if (!job) {
        return false;
      }

      job.status = status;
      job.message = message;
      if (progressPercent !== undefined) {
        job.progressPercent = normalizeProgressPercent(progressPercent);
      }
      job.updatedAt = nowIso();
      return true;
    });

    this.publish();
  }

  private markVmRunning(vmId: string, mutation: ProviderMutation): void {
    this.store.update((draft) => {
      const current = requireVm(draft, vmId);
      current.status = "running";
      current.liveSince = nowIso();
      applyProviderMutation(current, mutation);
    });

    this.publish();
  }

  private markVmStopped(vmId: string, mutation: ProviderMutation): void {
    this.store.update((draft) => {
      const current = requireVm(draft, vmId);
      current.status = "stopped";
      current.liveSince = null;
      applyProviderMutation(current, mutation);
    });

    this.publish();
  }

  private markVmFailed(vmId: string, error: unknown): void {
    const message = errorMessage(error);
    const currentVm = this.store.load().vms.find((entry) => entry.id === vmId) ?? null;
    const observedPowerState =
      currentVm && currentVm.provider === this.provider.state.kind
        ? this.provider.observeVmPowerState(currentVm)
        : null;
    const guestStillRunning = observedPowerState?.status === "running";

    this.store.update((draft) => {
      const vm = draft.vms.find((entry) => entry.id === vmId);

      if (!vm) {
        return false;
      }

      vm.status = guestStillRunning ? "running" : "error";
      vm.liveSince = guestStillRunning ? (vm.liveSince ?? nowIso()) : null;
      vm.lastAction = message;
      vm.updatedAt = nowIso();
      vm.frameRevision += 1;

      if (guestStillRunning) {
        vm.activeWindow = "logs";
        vm.session = null;
      }

      appendActivity(vm, `error: ${message}`);
      return true;
    });

    this.publish();
  }

  private ensureActiveProvider(vm: VmInstance): void {
    if (vm.provider === this.provider.state.kind) {
      return;
    }

    throw new Error(
      `VM ${vm.name} belongs to ${vm.provider} data, but the server is running in ${this.provider.state.kind} mode.`,
    );
  }

  private publish(): void {
    const summary = getSummary(this.runtime);

    for (const listener of this.listeners) {
      listener(summary);
    }
  }

  private async createVmWithTemplateRecovery(
    vm: VmInstance,
    template: EnvironmentTemplate,
    report?: JobProgressReporter,
  ): Promise<ProviderMutation> {
    try {
      return await this.provider.createVm(vm, template, report);
    } catch (error) {
      const fallbackSnapshot = resolveTemplateCreateFallbackSnapshot(
        this.store.load(),
        template,
        vm,
        error,
      );

      if (!fallbackSnapshot) {
        throw error;
      }

      report?.(`Recovering from template snapshot ${fallbackSnapshot.label}`, 28);
      const mutation = await this.provider.launchVmFromSnapshot(
        fallbackSnapshot,
        vm,
        template,
      );

      return {
        ...mutation,
        activity: [
          `template image missing: recovered from snapshot ${fallbackSnapshot.label}`,
          ...mutation.activity,
        ],
      };
    }
  }

  private clearVmStreamHealth(vmId: string): void {
    const timer = this.vmStreamHealthTimers.get(vmId);

    if (timer) {
      clearTimeout(timer);
      this.vmStreamHealthTimers.delete(vmId);
    }

    this.vmStreamHealth.delete(vmId);
    this.vmStreamHealthRepairAttemptAt.delete(vmId);
    this.vmStreamHealthRepairInFlight.delete(vmId);
  }

  private syncVmStreamHealthTimer(vmId: string): void {
    const existingTimer = this.vmStreamHealthTimers.get(vmId);

    if (existingTimer) {
      clearTimeout(existingTimer);
      this.vmStreamHealthTimers.delete(vmId);
    }

    const vm = this.runtime.store.load().vms.find((entry) => entry.id === vmId);
    const record = this.vmStreamHealth.get(vmId);

    if (!vm || !record || !this.isVmEligibleForStreamHealth(vm)) {
      this.clearVmStreamHealth(vmId);
      return;
    }

    const delayMs = this.resolveVmStreamHealthRepairDelay(vmId, record);

    if (delayMs === null) {
      return;
    }

    const timer = setTimeout(() => {
      this.vmStreamHealthTimers.delete(vmId);
      this.evaluateVmStreamHealth(vmId);
    }, delayMs);
    this.vmStreamHealthTimers.set(vmId, timer);
  }

  private resolveVmStreamHealthRepairDelay(
    vmId: string,
    record: VmStreamHealthRecord,
  ): number | null {
    if (this.vmStreamHealthRepairInFlight.has(vmId)) {
      return null;
    }

    const now = Date.now();
    const repairAllowedAt =
      (this.vmStreamHealthRepairAttemptAt.get(vmId) ?? 0) +
      this.selkiesStreamHealthRepairCooldownMs;
    const cooldownDelay = Math.max(0, repairAllowedAt - now);

    if (record.status === "unhealthy") {
      return cooldownDelay;
    }

    if (record.status === "degraded" && record.nonReadySinceMs !== null) {
      const degradedDelay = Math.max(
        0,
        record.nonReadySinceMs + this.selkiesStreamHealthDegradedRepairMs - now,
      );
      return Math.max(cooldownDelay, degradedDelay);
    }

    if (record.lastHeartbeatAtMs !== null) {
      const staleDelay = Math.max(
        0,
        record.lastHeartbeatAtMs + this.selkiesStreamHealthStaleRepairMs - now,
      );
      return Math.max(cooldownDelay, staleDelay);
    }

    return null;
  }

  private evaluateVmStreamHealth(vmId: string): void {
    const vm = this.runtime.store.load().vms.find((entry) => entry.id === vmId);
    const record = this.vmStreamHealth.get(vmId);

    if (!vm || !record || !this.isVmEligibleForStreamHealth(vm)) {
      this.clearVmStreamHealth(vmId);
      return;
    }

    if (this.vmStreamHealthRepairInFlight.has(vmId)) {
      return;
    }

    const reason = this.resolveVmStreamHealthRepairReason(record);

    if (!reason) {
      this.syncVmStreamHealthTimer(vmId);
      return;
    }

    this.vmStreamHealthRepairAttemptAt.set(vmId, Date.now());
    this.vmStreamHealthRepairInFlight.add(vmId);
    void this.autoRepairVmDesktopBridge(vmId, reason);
  }

  private resolveVmStreamHealthRepairReason(
    record: VmStreamHealthRecord,
  ): string | null {
    if (record.status === "unhealthy") {
      return record.reason ?? buildStreamHealthFailureReason(record);
    }

    if (record.status === "degraded") {
      return record.reason ?? buildStreamHealthFailureReason(record);
    }

    if (record.lastHeartbeatAtMs !== null) {
      const now = Date.now();

      if (now - record.lastHeartbeatAtMs >= this.selkiesStreamHealthStaleRepairMs) {
        return record.connected
          ? "guest stream-health heartbeat went stale"
          : "guest stream-health heartbeat went stale after disconnect";
      }
    }

    return null;
  }

  private async autoRepairVmDesktopBridge(vmId: string, reason: string): Promise<void> {
    try {
      await this.repairVmDesktopBridgeInternal(vmId, {
        automaticReason: reason,
      });
    } catch (error) {
      const message = errorMessage(error);

      this.runtime.store.update((draft) => {
        const vm = draft.vms.find((entry) => entry.id === vmId);

        if (!vm) {
          return false;
        }

        appendActivity(vm, `stream-health: automatic repair failed: ${message}`);
        vm.updatedAt = nowIso();
        vm.frameRevision += 1;
        return true;
      });
      this.runtime.publish();
    } finally {
      const record = this.vmStreamHealth.get(vmId);

      if (record) {
        record.connected = false;
        record.lastDisconnectAtMs = Date.now();
        record.lastHeartbeatAtMs = null;
        record.nonReadySinceMs = null;
        record.reason = null;
        record.status = null;
      }

      this.vmStreamHealthRepairInFlight.delete(vmId);
      this.syncVmStreamHealthTimer(vmId);
    }
  }

  private async repairVmDesktopBridgeInternal(
    vmId: string,
    options: {
      automaticReason?: string | null;
    } = {},
  ): Promise<VmDetail> {
    const state = this.runtime.store.load();
    const vm = requireVm(state, vmId);
    this.runtime.ensureActiveProvider(vm);

    if (!this.provider.repairVmDesktopBridge) {
      throw new Error("The active provider does not support desktop bridge repair.");
    }

    const mutation = await this.provider.repairVmDesktopBridge(vm);
    const automaticReason = options.automaticReason?.trim() || null;

    this.runtime.store.update((draft) => {
      const current = requireVm(draft, vmId);
      applyProviderMutation(current, {
        ...mutation,
        activity:
          automaticReason === null
            ? mutation.activity
            : [
                ...mutation.activity,
                `stream-health: automatic desktop bridge repair (${automaticReason})`,
              ],
        lastAction:
          automaticReason === null
            ? mutation.lastAction
            : "Desktop bridge auto-repaired",
      });
    });
    this.runtime.publish();
    this.runtime.requestVmSessionRefresh("missing");
    return getVmDetail(this.runtime, vmId);
  }

  private async restartVmDesktopServiceInternal(vmId: string): Promise<VmDetail> {
    const state = this.runtime.store.load();
    const vm = requireVm(state, vmId);
    this.runtime.ensureActiveProvider(vm);

    if (!this.provider.restartVmDesktopService) {
      throw new Error("The active provider does not support desktop service restarts.");
    }

    const mutation = await this.provider.restartVmDesktopService(vm);

    this.runtime.store.update((draft) => {
      const current = requireVm(draft, vmId);
      applyProviderMutation(current, mutation);
    });
    this.runtime.publish();
    this.runtime.requestVmSessionRefresh("missing");
    return getVmDetail(this.runtime, vmId);
  }

  private isVmEligibleForStreamHealth(vm: VmInstance): boolean {
    return (
      vm.provider === this.provider.state.kind &&
      vm.status === "running" &&
      (vm.desktopTransport === "selkies" || vm.session?.kind === "selkies")
    );
  }
}

function createVmStreamHealthRecord(): VmStreamHealthRecord {
  return {
    connected: false,
    desktopHealthy: false,
    lastDisconnectAtMs: null,
    lastHeartbeatAtMs: null,
    localReachable: false,
    nonReadySinceMs: null,
    reason: null,
    sampledAt: null,
    serviceActive: false,
    source: null,
    status: null,
  };
}

function buildStreamHealthFailureReason(record: VmStreamHealthRecord): string {
  if (!record.serviceActive) {
    return "guest desktop bridge service is inactive";
  }

  if (!record.desktopHealthy) {
    return "guest desktop health check is failing";
  }

  if (!record.localReachable) {
    return "guest Selkies endpoint is not reachable locally";
  }

  return "guest stream-health heartbeat reported a non-ready state";
}

function resolvePositiveDelay(value: number | null | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value == null || value <= 0) {
    return fallback;
  }

  return Math.max(1, Math.round(value));
}
