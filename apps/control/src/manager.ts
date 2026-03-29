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
  injectCommand,
  launchVmFromSnapshot,
  reorderVms,
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
import { resolveDefaultTemplateLaunchSource } from "./template-defaults.js";

export class DesktopManager {
  private readonly listeners = new Set<(summary: DashboardSummary) => void>();
  private ticker: NodeJS.Timeout | null = null;
  private hostTelemetry: ResourceTelemetry = emptyResourceTelemetry();
  private readonly vmTelemetry = new Map<string, ResourceTelemetry>();
  private readonly hostCpuCount = cpus().length;
  private readonly hostRamMb = Math.round(totalmem() / (1024 * 1024));
  private readonly hostDiskGb = detectHostDiskGb();
  private readonly defaultTemplateLaunchSource: string;
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

  getVmFrame(vmId: string, mode: "tile" | "detail"): string {
    return getVmFrame(this.runtime, vmId, mode);
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

  updateVm(vmId: string, input: UpdateVmInput): VmInstance {
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
}
