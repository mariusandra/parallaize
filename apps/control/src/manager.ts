import { collectMetrics, slugify } from "../../../packages/shared/src/helpers.js";
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
  ResizeVmInput,
  Snapshot,
  SnapshotInput,
  VmDetail,
  VmInstance,
} from "../../../packages/shared/src/types.js";
import type { DesktopProvider } from "./providers.js";
import type { JsonStateStore } from "./store.js";

const MAX_ACTIVITY_LINES = 8;
const MAX_JOBS = 20;

export class DesktopManager {
  private readonly listeners = new Set<(summary: DashboardSummary) => void>();
  private ticker: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: JsonStateStore,
    private readonly provider: DesktopProvider,
  ) {}

  start(): void {
    if (this.ticker) {
      return;
    }

    this.ticker = setInterval(() => {
      const { changed } = this.store.update((state) => {
        let dirty = false;

        for (const vm of state.vms) {
          if (vm.status !== "running") {
            continue;
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

      if (changed) {
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
    return this.store.load().provider;
  }

  getSummary(): DashboardSummary {
    const state = this.store.load();

    return {
      provider: state.provider,
      templates: state.templates,
      vms: state.vms,
      snapshots: state.snapshots,
      jobs: state.jobs,
      metrics: collectMetrics(state.vms),
      generatedAt: nowIso(),
    };
  }

  getVmDetail(vmId: string): VmDetail {
    const state = this.store.load();
    const vm = this.requireVm(state, vmId);

    return {
      provider: state.provider,
      vm,
      template: state.templates.find((template) => template.id === vm.templateId) ?? null,
      snapshots: state.snapshots.filter((snapshot) => snapshot.vmId === vm.id),
      recentJobs: state.jobs.filter((job) => job.targetVmId === vm.id).slice(0, 8),
      generatedAt: nowIso(),
    };
  }

  getVmFrame(vmId: string, mode: "tile" | "detail"): string {
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
      const name = input.name.trim();

      if (!name) {
        throw new Error("VM name is required.");
      }

      const vm = buildVmRecord(
        draft,
        template,
        name,
        input.resources,
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

    void this.runJob(jobRecord.id, async () => {
      await sleep(550);
      const template = requireTemplate(state, vmRecord.templateId);
      const mutation = await this.provider.createVm(
        template,
        vmRecord.name,
        vmRecord.resources,
      );

      this.store.update((draft) => {
        const vm = this.requireVm(draft, vmRecord.id);
        vm.status = "running";
        vm.liveSince = nowIso();
        vm.lastAction = mutation.lastAction;
        vm.frameRevision += 1;
        vm.updatedAt = nowIso();
        vm.activeWindow = mutation.activeWindow ?? vm.activeWindow;
        vm.workspacePath = mutation.workspacePath ?? vm.workspacePath;
        appendManyActivity(vm, mutation.activity);
      });

      this.publish();

      return `${vmRecord.name} is running`;
    });

    return vmRecord;
  }

  cloneVm(input: CloneVmInput): VmInstance {
    let createdVm: VmInstance | null = null;
    let createdJob: ActionJob | null = null;

    this.store.update((draft) => {
      const source = this.requireVm(draft, input.sourceVmId);
      const template = requireTemplate(draft, source.templateId);
      const cloneName =
        input.name?.trim() ||
        `${source.name}-clone-${String(draft.sequence).padStart(2, "0")}`;

      const vm = buildVmRecord(
        draft,
        template,
        cloneName,
        source.resources,
        draft.provider.kind,
        "creating",
      );
      vm.activeWindow = source.activeWindow;
      vm.activityLog = [...source.activityLog];

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

    void this.runJob(jobRecord.id, async () => {
      await sleep(500);
      const current = this.getVmDetail(vmRecord.id).vm;
      const source = this.getVmDetail(input.sourceVmId).vm;
      const template = this.getVmDetail(vmRecord.id).template;

      if (!template) {
        throw new Error("Template for clone target was not found.");
      }

      const mutation = await this.provider.cloneVm(source, template, current.name);

      this.store.update((draft) => {
        const vm = this.requireVm(draft, vmRecord.id);
        vm.status = "running";
        vm.liveSince = nowIso();
        vm.lastAction = mutation.lastAction;
        vm.frameRevision += 1;
        vm.updatedAt = nowIso();
        vm.activeWindow = mutation.activeWindow ?? vm.activeWindow;
        vm.workspacePath = mutation.workspacePath ?? vm.workspacePath;
        appendManyActivity(vm, mutation.activity);
      });

      this.publish();

      return `${vmRecord.name} cloned successfully`;
    });

    return vmRecord;
  }

  startVm(vmId: string): void {
    this.queueVmAction(vmId, "start", async (vm) => {
      if (vm.status === "running") {
        return `${vm.name} is already running`;
      }

      await sleep(350);
      const mutation = await this.provider.startVm(vm);

      this.store.update((draft) => {
        const current = this.requireVm(draft, vmId);
        current.status = "running";
        current.liveSince = nowIso();
        current.lastAction = mutation.lastAction;
        current.frameRevision += 1;
        current.updatedAt = nowIso();
        current.activeWindow = mutation.activeWindow ?? current.activeWindow;
        appendManyActivity(current, mutation.activity);
      });

      this.publish();

      return `${vm.name} started`;
    });
  }

  stopVm(vmId: string): void {
    this.queueVmAction(vmId, "stop", async (vm) => {
      if (vm.status === "stopped") {
        return `${vm.name} is already stopped`;
      }

      await sleep(350);
      const mutation = await this.provider.stopVm(vm);

      this.store.update((draft) => {
        const current = this.requireVm(draft, vmId);
        current.status = "stopped";
        current.liveSince = null;
        current.lastAction = mutation.lastAction;
        current.frameRevision += 1;
        current.updatedAt = nowIso();
        current.activeWindow = mutation.activeWindow ?? current.activeWindow;
        appendManyActivity(current, mutation.activity);
      });

      this.publish();

      return `${vm.name} stopped`;
    });
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
        current.lastAction = mutation.lastAction;
        current.updatedAt = nowIso();
        current.frameRevision += 1;
        current.activeWindow = mutation.activeWindow ?? current.activeWindow;
        appendManyActivity(current, mutation.activity);
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

  captureTemplate(vmId: string, input: CaptureTemplateInput): void {
    const captureName = input.name.trim();
    const captureDescription = input.description.trim();

    if (!captureName) {
      throw new Error("Template name is required.");
    }

    this.queueVmAction(vmId, "capture-template", async (vm) => {
      await sleep(450);
      const providerSnapshot = await this.provider.captureTemplate(vm, captureName);
      let updatedExistingTemplate = false;

      this.store.update((draft) => {
        const current = this.requireVm(draft, vmId);
        const existingTemplate = input.templateId
          ? requireTemplate(draft, input.templateId)
          : null;
        const templateId = existingTemplate?.id ?? nextId(draft, "tpl");
        const snapshot = buildSnapshot(
          draft,
          current,
          `Template capture: ${captureName}`,
          providerSnapshot.providerRef,
          providerSnapshot.summary,
          templateId,
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
          existingTemplate.defaultResources = { ...current.resources };
          existingTemplate.snapshotIds.unshift(snapshot.id);
          existingTemplate.tags = Array.from(
            new Set(["captured", slugify(current.name), ...existingTemplate.tags]),
          );
          existingTemplate.notes = captureNotes;
          existingTemplate.updatedAt = nowIso();
        } else {
          const template: EnvironmentTemplate = {
            id: templateId,
            name: captureName,
            description: captureDescription || `Captured from ${current.name}`,
            baseImage: "ubuntu-desktop-24.04",
            defaultResources: { ...current.resources },
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
        current.lastAction = mutation.lastAction;
        current.updatedAt = nowIso();
        current.frameRevision += 1;
        current.activeWindow = mutation.activeWindow ?? current.activeWindow;
        current.workspacePath = mutation.workspacePath ?? current.workspacePath;
        appendManyActivity(current, mutation.activity);
      });
      this.publish();

      return `${vm.name} command completed`;
    });
  }

  private queueVmAction(
    vmId: string,
    kind: JobKind,
    runner: (vm: VmInstance) => Promise<string>,
  ): void {
    let jobId = "";

    this.store.update((draft) => {
      const vm = this.requireVm(draft, vmId);
      const job = buildJob(draft, kind, vm.id, vm.templateId, `Queued ${kind} for ${vm.name}`);
      draft.jobs.unshift(job);
      trimJobs(draft);
      jobId = job.id;
    });

    this.publish();

    void this.runJob(jobId, async () => {
      const vm = this.getVmDetail(vmId).vm;
      return runner(vm);
    });
  }

  private async runJob(
    jobId: string,
    runner: () => Promise<string>,
  ): Promise<void> {
    this.updateJob(jobId, "running", "Action in progress");

    try {
      const message = await runner();
      this.updateJob(jobId, "succeeded", message);
    } catch (error) {
      this.updateJob(jobId, "failed", errorMessage(error));
    }
  }

  private updateJob(
    jobId: string,
    status: ActionJob["status"],
    message: string,
  ): void {
    this.store.update((draft) => {
      const job = draft.jobs.find((entry) => entry.id === jobId);

      if (!job) {
        return false;
      }

      job.status = status;
      job.message = message;
      job.updatedAt = nowIso();
      return true;
    });

    this.publish();
  }

  private requireVm(state: AppState, vmId: string): VmInstance {
    return requireVm(state, vmId);
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
  provider: ProviderState["kind"],
  status: VmInstance["status"],
): VmInstance {
  const now = nowIso();

  return {
    id: nextId(state, "vm"),
    name,
    templateId: template.id,
    provider,
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
    workspacePath: `/srv/workspaces/${slugify(name)}`,
    activityLog: [
      `template: ${template.name}`,
      `status: ${status}`,
    ],
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
    createdAt: now,
    updatedAt: now,
  };
}

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

function nextId(state: AppState, prefix: string): string {
  const value = String(state.sequence).padStart(4, "0");
  state.sequence += 1;
  return `${prefix}-${value}`;
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

function requireVm(state: AppState, vmId: string): VmInstance {
  const vm = state.vms.find((entry) => entry.id === vmId);

  if (!vm) {
    throw new Error(`VM ${vmId} was not found.`);
  }

  return vm;
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
      "Resources must be within sane ranges: cpu 1-96, ram 1024-262144 MB, disk 10-4096 GB.",
    );
  }
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
