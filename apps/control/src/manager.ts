import {
  collectMetrics,
  minimumCreateDiskGb,
  slugify,
} from "../../../packages/shared/src/helpers.js";
import { statfsSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import type {
  ActionJob,
  AppState,
  CaptureTemplateInput,
  CloneVmInput,
  CreateVmInput,
  DashboardSummary,
  EnvironmentTemplate,
  JobKind,
  ProviderState,
  ReorderVmsInput,
  ResizeVmInput,
  ResourceTelemetry,
  SetVmResolutionInput,
  Snapshot,
  SnapshotInput,
  TemplatePortForward,
  UpdateTemplateInput,
  UpdateVmInput,
  UpdateVmForwardedPortsInput,
  VmDetail,
  VmCommandResult,
  VmInstance,
  VmPortForward,
} from "../../../packages/shared/src/types.js";
import type {
  CaptureTemplateTarget,
  DesktopProvider,
  ProviderTelemetrySample,
  ProviderMutation,
} from "./providers.js";
import type { StateStore } from "./store.js";

const DEFAULT_TEMPLATE_LAUNCH_SOURCE = "images:ubuntu/noble/desktop";
const MAX_ACTIVITY_LINES = 8;
const MAX_COMMAND_RESULTS = 6;
const MAX_JOBS = 20;
const MAX_TELEMETRY_SAMPLES = 72;
const QUEUED_PROGRESS_PERCENT = 6;
const RUNNING_PROGRESS_PERCENT = 14;

type VmSessionRefreshMode = "none" | "missing" | "all";

export class DesktopManager {
  private readonly listeners = new Set<(summary: DashboardSummary) => void>();
  private ticker: NodeJS.Timeout | null = null;
  private hostTelemetry: ResourceTelemetry = emptyResourceTelemetry();
  private readonly vmTelemetry = new Map<string, ResourceTelemetry>();
  private readonly hostCpuCount = cpus().length;
  private readonly hostRamMb = Math.round(totalmem() / (1024 * 1024));
  private readonly hostDiskGb = detectHostDiskGb();
  private sessionRefreshMode: VmSessionRefreshMode = "none";
  private sessionRefreshInFlight = false;

  constructor(
    private readonly store: StateStore,
    private readonly provider: DesktopProvider,
  ) {
    this.syncProviderState();
    this.reconcileInterruptedJobs();
    this.reconcileFailedProvisioningJobs();
    this.hostTelemetry = appendTelemetrySample(
      emptyResourceTelemetry(),
      this.provider.sampleHostTelemetry(),
    );
    this.requestVmSessionRefresh("all");
  }

  start(): void {
    if (this.ticker) {
      return;
    }

    this.ticker = setInterval(() => {
      const providerChanged = this.syncProviderState();
      let telemetryChanged = false;
      const nextHostTelemetry = appendTelemetrySample(
        this.hostTelemetry,
        this.provider.sampleHostTelemetry(),
      );

      if (!sameTelemetry(nextHostTelemetry, this.hostTelemetry)) {
        this.hostTelemetry = nextHostTelemetry;
        telemetryChanged = true;
      }

      const activeTelemetryVmIds = new Set<string>();
      const { changed } = this.store.update((state) => {
        let dirty = false;

        for (const vm of state.vms) {
          if (vm.status !== "running") {
            continue;
          }

          activeTelemetryVmIds.add(vm.id);

          const nextVmTelemetry = appendTelemetrySample(
            this.vmTelemetry.get(vm.id) ?? emptyResourceTelemetry(),
            this.provider.sampleVmTelemetry(vm),
          );

          if (!sameTelemetry(nextVmTelemetry, this.vmTelemetry.get(vm.id) ?? null)) {
            this.vmTelemetry.set(vm.id, nextVmTelemetry);
            telemetryChanged = true;
          }

          const template = state.templates.find(
            (entry) => entry.id === vm.templateId,
          );

          if (!template) {
            continue;
          }

          const tick = this.provider.tickVm(vm, template);

          if (!tick) {
            continue;
          }

          vm.frameRevision += 1;
          vm.updatedAt = nowIso();

          if (tick.activeWindow) {
            vm.activeWindow = tick.activeWindow;
          }

          if (tick.activity) {
            appendActivity(vm, tick.activity);
          }

          dirty = true;
        }

        return dirty;
      });

      for (const vmId of [...this.vmTelemetry.keys()]) {
        if (!activeTelemetryVmIds.has(vmId)) {
          this.vmTelemetry.delete(vmId);
          telemetryChanged = true;
        }
      }

      this.requestVmSessionRefresh();

      if (changed) {
        this.publish();
        return;
      }

      if (providerChanged || telemetryChanged) {
        this.publish();
      }
    }, 2400);
  }

  stop(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  getProviderState(): ProviderState {
    this.syncProviderState();
    return this.store.load().provider;
  }

  getSummary(): DashboardSummary {
    this.syncProviderState();
    const state = this.store.load();
    const metrics = collectMetrics(state.vms);
    metrics.hostCpuCount = this.hostCpuCount;
    metrics.hostRamMb = this.hostRamMb;
    metrics.hostDiskGb = this.hostDiskGb;

    return {
      hostTelemetry: this.hostTelemetry,
      provider: state.provider,
      templates: state.templates,
      vms: state.vms.map((vm) => ({
        ...vm,
        telemetry: this.vmTelemetry.get(vm.id) ?? emptyResourceTelemetry(),
      })),
      snapshots: state.snapshots,
      jobs: state.jobs,
      metrics,
      generatedAt: nowIso(),
    };
  }

  getVmDetail(vmId: string): VmDetail {
    this.syncProviderState();
    const state = this.store.load();
    const vm = this.requireVm(state, vmId);

    return {
      provider: state.provider,
      vm: {
        ...vm,
        telemetry: this.vmTelemetry.get(vm.id) ?? emptyResourceTelemetry(),
      },
      template: state.templates.find((template) => template.id === vm.templateId) ?? null,
      snapshots: state.snapshots.filter((snapshot) => snapshot.vmId === vm.id),
      recentJobs: state.jobs.filter((job) => job.targetVmId === vm.id).slice(0, 8),
      generatedAt: nowIso(),
    };
  }

  getVmFrame(vmId: string, mode: "tile" | "detail"): string {
    this.syncProviderState();
    const state = this.store.load();
    const vm = this.requireVm(state, vmId);
    const template =
      state.templates.find((entry) => entry.id === vm.templateId) ?? null;

    return this.provider.renderFrame(vm, template, mode);
  }

  subscribe(listener: (summary: DashboardSummary) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSummary());

    return () => {
      this.listeners.delete(listener);
    };
  }

  createVm(input: CreateVmInput): VmInstance {
    let createdVm: VmInstance | null = null;
    let createdJob: ActionJob | null = null;

    const { state } = this.store.update((draft) => {
      const template = requireTemplate(draft, input.templateId);
      validateResources(input.resources);
      validateTemplateCreateResources(template, input.resources);
      validateForwardedPorts(input.forwardedPorts ?? template.defaultForwardedPorts);
      const name = input.name.trim();

      if (!name) {
        throw new Error("VM name is required.");
      }

      const vm = buildVmRecord(
        draft,
        template,
        name,
        input.resources,
        input.forwardedPorts ?? template.defaultForwardedPorts,
        draft.provider.kind,
        "creating",
      );
      const job = buildJob(draft, "create", vm.id, template.id, `Queued create for ${name}`);

      draft.vms.unshift(vm);
      draft.jobs.unshift(job);
      trimJobs(draft);

      createdVm = vm;
      createdJob = job;
    });

    this.publish();

    if (!createdVm || !createdJob) {
      throw new Error("Failed to queue VM creation.");
    }

    const vmRecord = createdVm as VmInstance;
    const jobRecord = createdJob as ActionJob;

    void this.runJob(jobRecord.id, async (report) => {
      try {
        const template = requireTemplate(state, vmRecord.templateId);
        const mutation = await this.provider.createVm(vmRecord, template, report);

        this.store.update((draft) => {
          const vm = this.requireVm(draft, vmRecord.id);
          vm.status = "running";
          vm.liveSince = nowIso();
          applyProviderMutation(vm, mutation);
        });

        this.publish();

        return `${vmRecord.name} is running`;
      } catch (error) {
        this.markVmFailed(vmRecord.id, error);
        throw error;
      }
    });

    return vmRecord;
  }

  cloneVm(input: CloneVmInput): VmInstance {
    let createdVm: VmInstance | null = null;
    let createdJob: ActionJob | null = null;

    this.store.update((draft) => {
      const source = this.requireVm(draft, input.sourceVmId);
      this.ensureActiveProvider(source);
      const template = requireTemplate(draft, source.templateId);
      const cloneName =
        input.name?.trim() ||
        `${source.name}-clone-${String(draft.sequence).padStart(2, "0")}`;

      const vm = buildVmRecord(
        draft,
        template,
        cloneName,
        source.resources,
        source.forwardedPorts.map(copyForwardAsTemplatePort),
        draft.provider.kind,
        "creating",
      );
      vm.activeWindow = source.activeWindow;
      vm.activityLog = [...source.activityLog];
      vm.session = cloneVmSession(source.session);

      const job = buildJob(draft, "clone", vm.id, template.id, `Queued clone from ${source.name}`);

      draft.vms.unshift(vm);
      draft.jobs.unshift(job);
      trimJobs(draft);

      createdVm = vm;
      createdJob = job;
    });

    this.publish();

    if (!createdVm || !createdJob) {
      throw new Error("Failed to queue VM clone.");
    }

    const vmRecord = createdVm as VmInstance;
    const jobRecord = createdJob as ActionJob;

    void this.runJob(jobRecord.id, async (report) => {
      try {
        report("Preparing clone", 18);
        await sleep(500);
        report("Cloning disks", 46);
        const target = this.getVmDetail(vmRecord.id).vm;
        const source = this.getVmDetail(input.sourceVmId).vm;
        const template = this.getVmDetail(vmRecord.id).template;

        this.ensureActiveProvider(source);

        if (!template) {
          throw new Error("Template for clone target was not found.");
        }

        const mutation = await this.provider.cloneVm(source, target, template);
        report("Booting desktop", 86);

        this.store.update((draft) => {
          const vm = this.requireVm(draft, vmRecord.id);
          vm.status = "running";
          vm.liveSince = nowIso();
          applyProviderMutation(vm, mutation);
        });

        this.publish();

        return `${vmRecord.name} cloned successfully`;
      } catch (error) {
        this.markVmFailed(vmRecord.id, error);
        throw error;
      }
    });

    return vmRecord;
  }

  startVm(vmId: string): void {
    this.queueVmAction(vmId, "start", async (vm, report) => {
      if (vm.status === "running") {
        return `${vm.name} is already running`;
      }

      report("Preparing boot", 24);
      await sleep(350);
      report("Starting VM", 58);
      const mutation = await this.provider.startVm(vm);
      report("Waiting for desktop", 88);
      this.markVmRunning(vmId, mutation);

      return `${vm.name} started`;
    });
  }

  stopVm(vmId: string): void {
    this.queueVmAction(vmId, "stop", async (vm, report) => {
      if (vm.status === "stopped") {
        return `${vm.name} is already stopped`;
      }

      report("Stopping workspace", 58);
      const mutation = await this.provider.stopVm(vm);
      this.markVmStopped(vmId, mutation);

      return `${vm.name} stopped`;
    });
  }

  restartVm(vmId: string): void {
    this.queueVmAction(vmId, "restart", async (vm, report) => {
      const wasRunning = vm.status !== "stopped";

      if (wasRunning) {
        report("Stopping workspace", 24);
        const stopMutation = await this.provider.stopVm(vm);
        this.markVmStopped(vmId, stopMutation);
      }

      const currentVm = this.getVmDetail(vmId).vm;
      report("Preparing boot", wasRunning ? 42 : 24);
      await sleep(350);
      report("Starting VM", wasRunning ? 66 : 58);
      const startMutation = await this.provider.startVm(currentVm);
      report("Waiting for desktop", 92);
      this.markVmRunning(vmId, startMutation);

      return wasRunning
        ? `${vm.name} restarted`
        : `${vm.name} started`;
    });
  }

  reorderVms(input: ReorderVmsInput): DashboardSummary {
    const requestedVmIds = input.vmIds.filter(
      (vmId, index, vmIds) => vmId.trim().length > 0 && vmIds.indexOf(vmId) === index,
    );

    this.store.update((draft) => {
      const byId = new Map(draft.vms.map((vm) => [vm.id, vm]));
      const nextVms = requestedVmIds
        .map((vmId) => byId.get(vmId) ?? null)
        .filter((vm): vm is VmInstance => vm !== null);
      const pinnedIds = new Set(nextVms.map((vm) => vm.id));

      draft.vms = [
        ...nextVms,
        ...draft.vms.filter((vm) => !pinnedIds.has(vm.id)),
      ];

      return true;
    });

    this.publish();
    return this.getSummary();
  }

  deleteVm(vmId: string): void {
    let deletedName = "";

    this.queueVmAction(vmId, "delete", async (vm) => {
      deletedName = vm.name;
      this.store.update((draft) => {
        const current = this.requireVm(draft, vmId);
        current.status = "deleting";
        current.lastAction = "Delete requested";
        current.updatedAt = nowIso();
      });
      this.publish();

      await sleep(450);
      await this.provider.deleteVm(vm);

      this.store.update((draft) => {
        draft.vms = draft.vms.filter((entry) => entry.id !== vmId);
      });
      this.publish();

      return `${deletedName} deleted`;
    });
  }

  resizeVm(vmId: string, input: ResizeVmInput): void {
    validateResources(input.resources);

    this.queueVmAction(vmId, "resize", async (vm) => {
      await sleep(300);
      const mutation = await this.provider.resizeVm(vm, input.resources);

      this.store.update((draft) => {
        const current = this.requireVm(draft, vmId);
        current.resources = input.resources;
        applyProviderMutation(current, mutation);
      });
      this.publish();

      return `${vm.name} resized`;
    });
  }

  snapshotVm(vmId: string, input: SnapshotInput): void {
    this.queueVmAction(vmId, "snapshot", async (vm) => {
      const label = input.label?.trim() || `Snapshot ${new Date().toLocaleTimeString("en-US")}`;
      await sleep(400);
      const snapshotData = await this.provider.snapshotVm(vm, label);

      this.store.update((draft) => {
        const current = this.requireVm(draft, vmId);
        const snapshot = buildSnapshot(
          draft,
          current,
          label,
          snapshotData.providerRef,
          snapshotData.summary,
        );
        const template = requireTemplate(draft, current.templateId);

        current.snapshotIds.unshift(snapshot.id);
        current.lastAction = `Snapshot captured: ${label}`;
        current.updatedAt = nowIso();
        current.frameRevision += 1;
        template.snapshotIds.unshift(snapshot.id);
        template.updatedAt = nowIso();
        draft.snapshots.unshift(snapshot);
        appendActivity(current, `snapshot: ${label}`);
      });
      this.publish();

      return `${vm.name} snapshotted`;
    });
  }

  launchVmFromSnapshot(vmId: string, snapshotId: string, input: CloneVmInput): VmInstance {
    let createdVm: VmInstance | null = null;
    let createdJob: ActionJob | null = null;

    this.store.update((draft) => {
      const source = this.requireVm(draft, vmId);
      this.ensureActiveProvider(source);
      const snapshot = requireVmSnapshot(draft, vmId, snapshotId);
      const template = resolveTemplateForSnapshot(draft, snapshot);
      const name =
        input.name?.trim() ||
        `${source.name}-${slugify(snapshot.label) || "snapshot"}-${String(draft.sequence).padStart(2, "0")}`;

      const vm = buildVmRecord(
        draft,
        template,
        name,
        snapshot.resources,
        source.forwardedPorts.map(copyForwardAsTemplatePort),
        draft.provider.kind,
        "creating",
      );
      vm.activeWindow = source.activeWindow;
      appendActivity(vm, `snapshot: ${snapshot.label}`);

      const job = buildJob(
        draft,
        "launch-snapshot",
        vm.id,
        template.id,
        `Queued snapshot launch from ${snapshot.label}`,
      );

      draft.vms.unshift(vm);
      draft.jobs.unshift(job);
      trimJobs(draft);

      createdVm = vm;
      createdJob = job;
    });

    this.publish();

    if (!createdVm || !createdJob) {
      throw new Error("Failed to queue snapshot launch.");
    }

    const vmRecord = createdVm as VmInstance;
    const jobRecord = createdJob as ActionJob;

    void this.runJob(jobRecord.id, async (report) => {
      try {
        report("Preparing snapshot launch", 18);
        await sleep(350);
        report("Cloning snapshot", 48);
        const detail = this.getVmDetail(vmId);
        const snapshot = requireVmSnapshot(this.store.load(), vmId, snapshotId);
        const template = resolveTemplateForSnapshot(this.store.load(), snapshot);

        this.ensureActiveProvider(detail.vm);

        const mutation = await this.provider.launchVmFromSnapshot(
          snapshot,
          vmRecord,
          template,
        );
        report("Booting desktop", 86);

        this.store.update((draft) => {
          const current = this.requireVm(draft, vmRecord.id);
          current.status = "running";
          current.liveSince = nowIso();
          applyProviderMutation(current, mutation);
        });

        this.publish();

        return `${vmRecord.name} launched from ${snapshot.label}`;
      } catch (error) {
        this.markVmFailed(vmRecord.id, error);
        throw error;
      }
    });

    return vmRecord;
  }

  restoreVmSnapshot(vmId: string, snapshotId: string): void {
    this.queueVmAction(vmId, "restore-snapshot", async (vm, report) => {
      const snapshot = requireVmSnapshot(this.store.load(), vmId, snapshotId);

      report("Preparing snapshot restore", 22);
      await sleep(250);
      report("Restoring VM state", 56);
      const mutation = await this.provider.restoreVmToSnapshot(vm, snapshot);

      this.store.update((draft) => {
        const current = this.requireVm(draft, vmId);
        current.status = vm.status === "running" ? "running" : "stopped";
        current.liveSince = current.status === "running" ? nowIso() : null;
        applyProviderMutation(current, mutation);
      });

      this.publish();

      return `${vm.name} restored to ${snapshot.label}`;
    });
  }

  captureTemplate(vmId: string, input: CaptureTemplateInput): void {
    const captureName = input.name.trim();
    const captureDescription = input.description.trim();
    const requestedTemplateId = input.templateId?.trim() || null;

    if (!captureName) {
      throw new Error("Template name is required.");
    }

    let jobId = "";
    let targetTemplateId = requestedTemplateId;

    this.store.update((draft) => {
      const vm = this.requireVm(draft, vmId);
      this.ensureActiveProvider(vm);

      if (targetTemplateId) {
        requireTemplate(draft, targetTemplateId);
      } else {
        targetTemplateId = nextId(draft, "tpl");
      }

      const job = buildJob(
        draft,
        "capture-template",
        vm.id,
        targetTemplateId,
        `Queued capture-template for ${vm.name}`,
      );

      draft.jobs.unshift(job);
      trimJobs(draft);
      jobId = job.id;
    });

    this.publish();

    if (!targetTemplateId) {
      throw new Error("Failed to reserve a template target.");
    }

    const reservedTemplateId = targetTemplateId;

    void this.runJob(jobId, async (report) => {
      report("Preparing template capture", 18);
      await sleep(180);
      const detail = this.getVmDetail(vmId);
      this.ensureActiveProvider(detail.vm);

      const providerSnapshot = await this.provider.captureTemplate(detail.vm, {
        templateId: reservedTemplateId,
        name: captureName,
      }, report);
      report("Updating template metadata", 96);
      const launchSource =
        providerSnapshot.launchSource ??
        detail.template?.launchSource ??
        DEFAULT_TEMPLATE_LAUNCH_SOURCE;
      let updatedExistingTemplate = false;

      this.store.update((draft) => {
        const current = this.requireVm(draft, vmId);
        const existingTemplate = requestedTemplateId
          ? requireTemplate(draft, requestedTemplateId)
          : null;
        const snapshot = buildSnapshot(
          draft,
          current,
          `Template capture: ${captureName}`,
          providerSnapshot.providerRef,
          providerSnapshot.summary,
          reservedTemplateId,
        );
        const captureNotes = buildCaptureNotes(
          current,
          existingTemplate?.notes ?? [],
        );

        current.snapshotIds.unshift(snapshot.id);
        current.lastAction = `Captured template ${captureName}`;
        current.updatedAt = nowIso();
        current.frameRevision += 1;
        draft.snapshots.unshift(snapshot);

        if (existingTemplate) {
          updatedExistingTemplate = true;
          existingTemplate.name = captureName;
          existingTemplate.description =
            captureDescription || existingTemplate.description || `Captured from ${current.name}`;
          existingTemplate.launchSource = launchSource;
          existingTemplate.defaultResources = { ...current.resources };
          existingTemplate.defaultForwardedPorts = current.forwardedPorts.map(
            copyForwardAsTemplatePort,
          );
          existingTemplate.snapshotIds.unshift(snapshot.id);
          existingTemplate.tags = Array.from(
            new Set(["captured", slugify(current.name), ...existingTemplate.tags]),
          );
          existingTemplate.notes = captureNotes;
          existingTemplate.updatedAt = nowIso();
        } else {
          const template: EnvironmentTemplate = {
            id: reservedTemplateId,
            name: captureName,
            description: captureDescription || `Captured from ${current.name}`,
            launchSource,
            defaultResources: { ...current.resources },
            defaultForwardedPorts: current.forwardedPorts.map(copyForwardAsTemplatePort),
            tags: ["captured", slugify(current.name)],
            notes: captureNotes,
            snapshotIds: [snapshot.id],
            createdAt: nowIso(),
            updatedAt: nowIso(),
          };

          draft.templates.unshift(template);
        }

        appendActivity(
          current,
          updatedExistingTemplate
            ? `template: ${captureName} updated`
            : `template: ${captureName} captured`,
        );
      });
      this.publish();

      return updatedExistingTemplate
        ? `${captureName} template updated`
        : `${captureName} template created`;
    });
  }

  updateTemplate(templateId: string, input: UpdateTemplateInput): EnvironmentTemplate {
    const nextName = input.name.trim();

    if (!nextName) {
      throw new Error("Template name is required.");
    }

    let updatedTemplate: EnvironmentTemplate | null = null;

    this.store.update((draft) => {
      const template = requireTemplate(draft, templateId);
      const nextDescription =
        input.description !== undefined ? input.description.trim() : template.description;

      if (template.name === nextName && template.description === nextDescription) {
        updatedTemplate = template;
        return false;
      }

      template.name = nextName;
      template.description = nextDescription;
      template.updatedAt = nowIso();
      updatedTemplate = template;
      return true;
    });

    this.publish();

    if (!updatedTemplate) {
      throw new Error(`Template ${templateId} was not found.`);
    }

    return updatedTemplate;
  }

  updateVm(vmId: string, input: UpdateVmInput): VmInstance {
    const nextName = input.name.trim();

    if (!nextName) {
      throw new Error("VM name is required.");
    }

    let updatedVm: VmInstance | null = null;

    this.store.update((draft) => {
      const vm = requireVm(draft, vmId);

      if (vm.name === nextName) {
        updatedVm = vm;
        return false;
      }

      const previousName = vm.name;
      vm.name = nextName;
      vm.lastAction = `Renamed workspace to ${nextName}`;
      vm.updatedAt = nowIso();
      appendActivity(vm, `rename: ${previousName} -> ${nextName}`);
      updatedVm = vm;
      return true;
    });

    this.publish();

    if (!updatedVm) {
      throw new Error(`VM ${vmId} was not found.`);
    }

    return updatedVm;
  }

  deleteTemplate(templateId: string): void {
    let removed = false;

    this.store.update((draft) => {
      const template = requireTemplate(draft, templateId);
      const linkedVm = draft.vms.find((entry) => entry.templateId === templateId);

      if (linkedVm) {
        throw new Error(
          `Template ${template.name} is still attached to VM ${linkedVm.name}.`,
        );
      }

      const nextTemplates = draft.templates.filter((entry) => entry.id !== templateId);

      if (nextTemplates.length === draft.templates.length) {
        return false;
      }

      draft.templates = nextTemplates;
      removed = true;
      return true;
    });

    if (!removed) {
      throw new Error(`Template ${templateId} was not found.`);
    }

    this.publish();
  }

  injectCommand(vmId: string, command: string): void {
    const trimmed = command.trim();
    if (!trimmed) {
      throw new Error("Command is required.");
    }

    this.queueVmAction(vmId, "inject-command", async (vm) => {
      if (vm.status !== "running") {
        throw new Error("VM must be running before commands can be injected.");
      }

      await sleep(150);
      const mutation = await this.provider.injectCommand(vm, trimmed);

      this.store.update((draft) => {
        const current = this.requireVm(draft, vmId);
        applyProviderMutation(current, mutation);
      });
      this.publish();

      return `${vm.name} command completed`;
    });
  }

  async setVmResolution(vmId: string, input: SetVmResolutionInput): Promise<void> {
    const width = Math.round(input.width);
    const height = Math.round(input.height);

    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      throw new Error("Display resolution width and height are required.");
    }

    const vm = this.getVmDetail(vmId).vm;
    this.ensureActiveProvider(vm);

    if (vm.status !== "running") {
      throw new Error("VM must be running before the display resolution can be changed.");
    }

    if (vm.session?.kind !== "vnc") {
      throw new Error("Display resolution changes require a live VNC-backed desktop.");
    }

    await this.provider.setDisplayResolution(vm, width, height);
  }

  updateVmForwardedPorts(vmId: string, input: UpdateVmForwardedPortsInput): void {
    validateForwardedPorts(input.forwardedPorts);

    this.store.update((draft) => {
      const vm = this.requireVm(draft, vmId);
      vm.forwardedPorts = buildVmForwardedPorts(vm.id, input.forwardedPorts);
      vm.updatedAt = nowIso();
      vm.frameRevision += 1;
      vm.lastAction =
        vm.forwardedPorts.length > 0
          ? `Updated ${vm.forwardedPorts.length} forwarded service port${vm.forwardedPorts.length === 1 ? "" : "s"}`
          : "Cleared forwarded service ports";
      appendActivity(
        vm,
        vm.forwardedPorts.length > 0
          ? `forwarding: ${vm.forwardedPorts.map((entry) => `${entry.name}:${entry.guestPort}`).join(", ")}`
          : "forwarding: cleared",
      );
    });

    this.publish();
  }

  private queueVmAction(
    vmId: string,
    kind: JobKind,
    runner: (vm: VmInstance, report: JobProgressReporter) => Promise<string>,
  ): void {
    let jobId = "";

    this.store.update((draft) => {
      const vm = this.requireVm(draft, vmId);
      this.ensureActiveProvider(vm);
      const job = buildJob(draft, kind, vm.id, vm.templateId, `Queued ${kind} for ${vm.name}`);
      draft.jobs.unshift(job);
      trimJobs(draft);
      jobId = job.id;
    });

    this.publish();

    void this.runJob(jobId, async (report) => {
      const vm = this.getVmDetail(vmId).vm;
      this.ensureActiveProvider(vm);
      return runner(vm, report);
    });
  }

  private async runJob(
    jobId: string,
    runner: (report: JobProgressReporter) => Promise<string>,
  ): Promise<void> {
    this.updateJob(jobId, "running", "Action in progress", RUNNING_PROGRESS_PERCENT);

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

  private requireVm(state: AppState, vmId: string): VmInstance {
    return requireVm(state, vmId);
  }

  private markVmRunning(vmId: string, mutation: ProviderMutation): void {
    this.store.update((draft) => {
      const current = this.requireVm(draft, vmId);
      current.status = "running";
      current.liveSince = nowIso();
      applyProviderMutation(current, mutation);
    });

    this.publish();
  }

  private markVmStopped(vmId: string, mutation: ProviderMutation): void {
    this.store.update((draft) => {
      const current = this.requireVm(draft, vmId);
      current.status = "stopped";
      current.liveSince = null;
      applyProviderMutation(current, mutation);
    });

    this.publish();
  }

  private markVmFailed(vmId: string, error: unknown): void {
    const message = errorMessage(error);

    this.store.update((draft) => {
      const vm = draft.vms.find((entry) => entry.id === vmId);

      if (!vm) {
        return false;
      }

      vm.status = "error";
      vm.liveSince = null;
      vm.lastAction = message;
      vm.updatedAt = nowIso();
      appendActivity(vm, `error: ${message}`);
      return true;
    });

    this.publish();
  }

  private reconcileFailedProvisioningJobs(): void {
    this.store.update((draft) => {
      let dirty = false;

      for (const vm of draft.vms) {
        if (vm.status !== "creating") {
          continue;
        }

        const failedJob = draft.jobs.find(
          (job) =>
            job.targetVmId === vm.id &&
            job.status === "failed" &&
            (job.kind === "create" ||
              job.kind === "clone" ||
              job.kind === "launch-snapshot"),
        );

        if (!failedJob) {
          continue;
        }

        vm.status = "error";
        vm.liveSince = null;
        vm.lastAction = failedJob.message;
        vm.updatedAt = nowIso();

        const errorLine = `error: ${failedJob.message}`;
        if (!vm.activityLog.includes(errorLine)) {
          appendActivity(vm, errorLine);
        }

        dirty = true;
      }

      return dirty;
    });
  }

  private reconcileInterruptedJobs(): void {
    this.store.update((draft) => {
      let dirty = false;

      for (const job of draft.jobs) {
        if (job.status !== "queued" && job.status !== "running") {
          continue;
        }

        const message = `Control server restarted before ${job.kind} could finish.`;
        job.status = "failed";
        job.message = message;
        job.progressPercent = null;
        job.updatedAt = nowIso();
        dirty = true;

        const vm =
          job.targetVmId
            ? draft.vms.find((entry) => entry.id === job.targetVmId) ?? null
            : null;

        if (!vm) {
          continue;
        }

        if (vm.status === "creating" || vm.status === "deleting") {
          vm.status = "error";
        }

        vm.liveSince = vm.status === "running" ? vm.liveSince : null;
        vm.lastAction = message;
        vm.updatedAt = nowIso();

        const errorLine = `error: ${message}`;
        if (!vm.activityLog.includes(errorLine)) {
          appendActivity(vm, errorLine);
        }
      }

      return dirty;
    });
  }

  private ensureActiveProvider(vm: VmInstance): void {
    if (vm.provider === this.provider.state.kind) {
      return;
    }

    throw new Error(
      `VM ${vm.name} belongs to ${vm.provider} data, but the server is running in ${this.provider.state.kind} mode.`,
    );
  }

  private syncProviderState(): boolean {
    const nextProviderState = this.provider.refreshState();
    const { changed } = this.store.update((draft) => {
      let dirty = !sameProviderState(draft.provider, nextProviderState);

      if (dirty) {
        draft.provider = nextProviderState;
      }

      if (!nextProviderState.available) {
        return dirty;
      }

      for (const vm of draft.vms) {
        if (vm.status !== "running" || vm.provider !== nextProviderState.kind) {
          continue;
        }

        const observedPowerState = this.provider.observeVmPowerState(vm);

        if (observedPowerState?.status !== "stopped") {
          continue;
        }

        markVmStoppedOutsideControlPlane(vm);
        this.vmTelemetry.delete(vm.id);
        dirty = true;
      }

      return dirty;
    });

    if (nextProviderState.available) {
      this.requestVmSessionRefresh();
    }

    return changed;
  }

  private requestVmSessionRefresh(mode: Exclude<VmSessionRefreshMode, "none"> = "missing"): void {
    this.sessionRefreshMode = mergeVmSessionRefreshMode(this.sessionRefreshMode, mode);

    if (this.sessionRefreshInFlight) {
      return;
    }

    this.sessionRefreshInFlight = true;
    void this.runVmSessionRefreshLoop();
  }

  private async runVmSessionRefreshLoop(): Promise<void> {
    try {
      while (this.sessionRefreshMode !== "none") {
        const mode = this.sessionRefreshMode;
        this.sessionRefreshMode = "none";
        await this.refreshRunningVmSessions(mode);
      }
    } finally {
      this.sessionRefreshInFlight = false;

      if (this.sessionRefreshMode !== "none") {
        this.requestVmSessionRefresh(this.sessionRefreshMode);
      }
    }
  }

  private async refreshRunningVmSessions(mode: Exclude<VmSessionRefreshMode, "none">): Promise<void> {
    const state = this.store.load();

    if (!state.provider.available) {
      return;
    }

    const candidateVmIds = state.vms
      .filter((vm) => shouldRefreshVmSession(vm, state.provider.kind, mode))
      .map((vm) => vm.id);

    if (candidateVmIds.length === 0) {
      return;
    }

    let changed = false;

    for (const vmId of candidateVmIds) {
      const current = this.store.load().vms.find((entry) => entry.id === vmId);

      if (!current || !shouldRefreshVmSession(current, state.provider.kind, mode)) {
        continue;
      }

      try {
        const nextSession = enrichVmSession(
          vmId,
          await this.provider.refreshVmSession(current),
        );
        const result = this.store.update((draft) => {
          const vm = draft.vms.find((entry) => entry.id === vmId);

          if (!vm || !shouldRefreshVmSession(vm, draft.provider.kind, mode)) {
            return false;
          }

          if (sameVmSession(vm.session, nextSession)) {
            return false;
          }

          vm.session = nextSession;
          vm.updatedAt = nowIso();
          vm.frameRevision += 1;
          return true;
        });

        changed = changed || result.changed;
      } catch {
        continue;
      }
    }

    if (changed) {
      this.publish();
    }
  }

  private publish(): void {
    const summary = this.getSummary();

    for (const listener of this.listeners) {
      listener(summary);
    }
  }
}

function buildVmRecord(
  state: AppState,
  template: EnvironmentTemplate,
  name: string,
  resources: CreateVmInput["resources"],
  forwardedPorts: TemplatePortForward[],
  provider: ProviderState["kind"],
  status: VmInstance["status"],
): VmInstance {
  const now = nowIso();
  const id = nextId(state, "vm");

  return {
    id,
    name,
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
    session:
      provider === "mock"
        ? buildSyntheticSession()
        : null,
    forwardedPorts: buildVmForwardedPorts(id, forwardedPorts),
    activityLog: [
      `template: ${template.name}`,
      `status: ${status}`,
    ],
    commandHistory: [],
  };
}

function buildJob(
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

type JobProgressReporter = (message: string, progressPercent: number | null) => void;

function buildSnapshot(
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

function normalizeProgressPercent(value: number | null): number | null {
  if (value === null) {
    return null;
  }

  const rounded = Math.round(value);
  return Math.max(0, Math.min(100, rounded));
}

function nextId(state: AppState, prefix: string): string {
  const value = String(state.sequence).padStart(4, "0");
  state.sequence += 1;
  return `${prefix}-${value}`;
}

function mergeVmSessionRefreshMode(
  current: VmSessionRefreshMode,
  next: Exclude<VmSessionRefreshMode, "none">,
): Exclude<VmSessionRefreshMode, "none"> {
  if (current === "all" || next === "all") {
    return "all";
  }

  return "missing";
}

function applyProviderMutation(vm: VmInstance, mutation: ProviderMutation): void {
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

function appendActivity(vm: VmInstance, line: string): void {
  vm.activityLog.push(line);
  vm.activityLog = vm.activityLog.slice(-MAX_ACTIVITY_LINES);
}

function appendManyActivity(vm: VmInstance, lines: string[]): void {
  for (const line of lines) {
    appendActivity(vm, line);
  }
}

function appendCommandResult(vm: VmInstance, entry: VmCommandResult): void {
  const history = [...(vm.commandHistory ?? []), entry];
  vm.commandHistory = history.slice(-MAX_COMMAND_RESULTS);
}

function shouldRefreshVmSession(
  vm: VmInstance,
  providerKind: ProviderState["kind"],
  mode: Exclude<VmSessionRefreshMode, "none">,
): boolean {
  if (vm.status !== "running" || vm.provider !== providerKind) {
    return false;
  }

  if (mode === "all") {
    return true;
  }

  return !hasReachableVncSession(vm.session);
}

function hasReachableVncSession(session: VmInstance["session"]): boolean {
  return Boolean(session && session.kind === "vnc" && session.host && session.port);
}

function sameVmSession(
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
    left.webSocketPath === right.webSocketPath &&
    left.browserPath === right.browserPath &&
    left.display === right.display
  );
}

function markVmStoppedOutsideControlPlane(vm: VmInstance): void {
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

function trimJobs(state: AppState): void {
  state.jobs = state.jobs.slice(0, MAX_JOBS);
}

function buildCaptureNotes(
  vm: VmInstance,
  previousNotes: string[],
): string[] {
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

function requireTemplate(
  state: AppState,
  templateId: string,
): EnvironmentTemplate {
  const template = state.templates.find((entry) => entry.id === templateId);

  if (!template) {
    throw new Error(`Template ${templateId} was not found.`);
  }

  return template;
}

function resolveTemplateForSnapshot(
  state: AppState,
  snapshot: Snapshot,
): EnvironmentTemplate {
  return (
    state.templates.find((entry) => entry.id === snapshot.templateId) ??
    buildOrphanedSnapshotTemplate(snapshot)
  );
}

function buildOrphanedSnapshotTemplate(snapshot: Snapshot): EnvironmentTemplate {
  const now = nowIso();

  return {
    id: snapshot.templateId,
    name: "Deleted template",
    description: "Recovered from snapshot metadata after the template record was removed.",
    launchSource: DEFAULT_TEMPLATE_LAUNCH_SOURCE,
    defaultResources: { ...snapshot.resources },
    defaultForwardedPorts: [],
    tags: ["orphaned"],
    notes: ["Recovered from snapshot metadata after template deletion."],
    snapshotIds: [snapshot.id],
    createdAt: now,
    updatedAt: now,
  };
}

function requireVm(state: AppState, vmId: string): VmInstance {
  const vm = state.vms.find((entry) => entry.id === vmId);

  if (!vm) {
    throw new Error(`VM ${vmId} was not found.`);
  }

  return vm;
}

function requireSnapshot(state: AppState, snapshotId: string): Snapshot {
  const snapshot = state.snapshots.find((entry) => entry.id === snapshotId);

  if (!snapshot) {
    throw new Error(`Snapshot ${snapshotId} was not found.`);
  }

  return snapshot;
}

function requireVmSnapshot(
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

function validateResources(resources: CreateVmInput["resources"]): void {
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

function validateTemplateCreateResources(
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

function buildProviderRef(vmId: string, name: string): string {
  const slug = slugify(name) || "workspace";
  return `parallaize-${vmId}-${slug}`;
}

function buildSyntheticSession(): VmInstance["session"] {
  return {
    kind: "synthetic",
    host: null,
    port: null,
    webSocketPath: null,
    browserPath: null,
    display: "Synthetic frame stream",
  };
}

function validateForwardedPorts(forwardedPorts: TemplatePortForward[]): void {
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

function buildVmForwardedPorts(
  vmId: string,
  forwardedPorts: TemplatePortForward[],
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
    };
  });
}

function copyForwardAsTemplatePort(forwardedPort: VmPortForward): TemplatePortForward {
  return {
    name: forwardedPort.name,
    guestPort: forwardedPort.guestPort,
    protocol: forwardedPort.protocol,
    description: forwardedPort.description,
  };
}

function enrichVmSession(
  vmId: string,
  session: VmInstance["session"],
): VmInstance["session"] {
  if (!session) {
    return null;
  }

  if (session.kind !== "vnc") {
    return {
      ...session,
      browserPath: null,
      webSocketPath: null,
    };
  }

  return {
    ...session,
    webSocketPath: buildVncSocketPath(vmId),
    browserPath: buildVmBrowserPath(vmId),
  };
}

function cloneVmSession(
  session: VmInstance["session"],
): VmInstance["session"] {
  if (!session) {
    return null;
  }

  if (session.kind === "vnc") {
    return null;
  }

  return {
    ...session,
    browserPath: null,
    webSocketPath: null,
  };
}

function appendTelemetrySample(
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

function appendTelemetryPoint(history: number[], value: number): number[] {
  return [...history, value].slice(-MAX_TELEMETRY_SAMPLES);
}

function emptyResourceTelemetry(): ResourceTelemetry {
  return {
    cpuHistory: [],
    cpuPercent: null,
    ramHistory: [],
    ramPercent: null,
  };
}

function normalizeTelemetryPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function sameTelemetry(
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

function sameProviderState(left: ProviderState, right: ProviderState): boolean {
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

function buildVncSocketPath(vmId: string): string {
  return `/api/vms/${vmId}/vnc`;
}

function buildVmBrowserPath(vmId: string): string {
  return `/?vm=${vmId}`;
}

function buildVmForwardPath(vmId: string, forwardId: string): string {
  return `/vm/${vmId}/forwards/${forwardId}/`;
}

function detectHostDiskGb(): number {
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
