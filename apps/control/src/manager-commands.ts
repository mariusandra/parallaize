import { slugify } from "../../../packages/shared/src/helpers.js";

import type {
  ActionJob,
  CaptureTemplateInput,
  CloneVmInput,
  CreateTemplateInput,
  CreateVmInput,
  DashboardSummary,
  EnvironmentTemplate,
  JobKind,
  ReorderVmsInput,
  ResizeVmInput,
  SetVmResolutionInput,
  Snapshot,
  SnapshotInput,
  UpdateTemplateInput,
  UpdateVmForwardedPortsInput,
  UpdateVmInput,
  UpdateVmNetworkInput,
  VmInstance,
} from "../../../packages/shared/src/types.js";
import {
  appendActivity,
  appendTemplateHistory,
  applyProviderMutation,
  buildCaptureNotes,
  buildCapturedTemplateProvenance,
  buildClonedTemplateNotes,
  buildClonedTemplateProvenance,
  buildJob,
  buildSnapshot,
  buildTemplateHistoryEntry,
  buildVmForwardedPorts,
  buildVmRecord,
  cloneVmSession,
  collectTemplateUpdateFieldLabels,
  copyForwardAsTemplatePort,
  copyTemplatePortForward,
  failMissingCreateTemplateId,
  nextId,
  normalizeTemplateInitCommands,
  normalizeVmNetworkMode,
  nowIso,
  requireSnapshot,
  requireTemplate,
  requireVm,
  requireVmSnapshot,
  resolveTemplateForSnapshot,
  sameStringArray,
  sleep,
  trimJobs,
  validateForwardedPorts,
  validateResources,
  validateSnapshotCreateResources,
  validateTemplateCreateResources,
  validateVmCloneResources,
  type DesktopManagerRuntime,
  type JobProgressReporter,
} from "./manager-core.js";

export function createVm(
  runtime: DesktopManagerRuntime,
  input: CreateVmInput,
): VmInstance {
  let createdVm: VmInstance | null = null;
  let createdJob: ActionJob | null = null;
  let launchTemplate: EnvironmentTemplate | null = null;
  let launchSnapshot: Snapshot | null = null;
  const requestedTemplateId = input.templateId?.trim() || null;
  const requestedSnapshotId = input.snapshotId?.trim() || null;
  const name = input.name.trim();
  const wallpaperName = input.wallpaperName?.trim() || name;

  if ((requestedTemplateId === null) === (requestedSnapshotId === null)) {
    throw new Error("Exactly one launch source is required.");
  }

  if (!name) {
    throw new Error("VM name is required.");
  }

  validateResources(input.resources);

  if (requestedSnapshotId && input.initCommands !== undefined) {
    throw new Error("Init commands are only supported when launching from a template.");
  }

  runtime.store.update((draft) => {
    if (requestedSnapshotId) {
      const snapshot = requireSnapshot(draft, requestedSnapshotId);
      const template = resolveTemplateForSnapshot(
        draft,
        snapshot,
        runtime.defaultTemplateLaunchSource,
      );
      const sourceVm = draft.vms.find((entry) => entry.id === snapshot.vmId) ?? null;
      const forwardedPorts =
        input.forwardedPorts ??
        (sourceVm
          ? sourceVm.forwardedPorts.map(copyForwardAsTemplatePort)
          : template.defaultForwardedPorts);

      validateTemplateCreateResources(template, input.resources);
      validateSnapshotCreateResources(snapshot, input.resources);
      validateForwardedPorts(forwardedPorts);

      const vm = buildVmRecord(
        draft,
        template,
        name,
        wallpaperName,
        input.resources,
        forwardedPorts,
        normalizeVmNetworkMode(
          input.networkMode ?? sourceVm?.networkMode ?? template.defaultNetworkMode,
        ),
        draft.provider.kind,
        "creating",
        runtime.options.forwardedServiceHostBase ?? null,
      );
      vm.lastAction = `Queued from snapshot ${snapshot.label}`;

      if (sourceVm) {
        vm.activeWindow = sourceVm.activeWindow;
      }

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

      launchTemplate = template;
      launchSnapshot = snapshot;
      createdVm = vm;
      createdJob = job;
      return;
    }

    const template = requireTemplate(
      draft,
      requestedTemplateId ?? failMissingCreateTemplateId(),
    );
    validateTemplateCreateResources(template, input.resources);
    validateForwardedPorts(input.forwardedPorts ?? template.defaultForwardedPorts);

    const vm = buildVmRecord(
      draft,
      template,
      name,
      wallpaperName,
      input.resources,
      input.forwardedPorts ?? template.defaultForwardedPorts,
      normalizeVmNetworkMode(input.networkMode ?? template.defaultNetworkMode),
      draft.provider.kind,
      "creating",
      runtime.options.forwardedServiceHostBase ?? null,
    );
    launchTemplate =
      input.initCommands !== undefined
        ? {
            ...template,
            initCommands: normalizeTemplateInitCommands(input.initCommands),
          }
        : template;
    const job = buildJob(draft, "create", vm.id, template.id, `Queued create for ${name}`);

    draft.vms.unshift(vm);
    draft.jobs.unshift(job);
    trimJobs(draft);

    createdVm = vm;
    createdJob = job;
  });

  runtime.publish();

  if (!createdVm || !createdJob) {
    throw new Error("Failed to queue VM creation.");
  }

  const vmRecord = createdVm as VmInstance;
  const jobRecord = createdJob as ActionJob;

  void runtime.runJob(jobRecord.id, async (report) => {
    try {
      if (launchSnapshot) {
        report("Preparing snapshot launch", 18);
        await sleep(350);
        const snapshot = launchSnapshot;
        const template =
          launchTemplate ??
          resolveTemplateForSnapshot(
            runtime.store.load(),
            snapshot,
            runtime.defaultTemplateLaunchSource,
          );
        const mutation = await runtime.provider.launchVmFromSnapshot(
          snapshot,
          vmRecord,
          template,
          report,
        );

        runtime.store.update((draft) => {
          const vm = runtime.requireVm(draft, vmRecord.id);
          vm.status = "running";
          vm.liveSince = nowIso();
          applyProviderMutation(vm, mutation);
        });

        runtime.publish();

        return `${vmRecord.name} launched from ${snapshot.label}`;
      }

      const templateRecord = requireTemplate(runtime.store.load(), vmRecord.templateId);
      const template = launchTemplate
        ? {
            ...templateRecord,
            ...launchTemplate,
            snapshotIds: [...templateRecord.snapshotIds],
          }
        : templateRecord;
      const mutation = await runtime.createVmWithTemplateRecovery(vmRecord, template, report);

      runtime.store.update((draft) => {
        const vm = runtime.requireVm(draft, vmRecord.id);
        vm.status = "running";
        vm.liveSince = nowIso();
        applyProviderMutation(vm, mutation);
      });

      runtime.publish();

      return `${vmRecord.name} is running`;
    } catch (error) {
      runtime.markVmFailed(vmRecord.id, error);
      throw error;
    }
  });

  return vmRecord;
}

export function cloneVm(
  runtime: DesktopManagerRuntime,
  input: CloneVmInput,
): VmInstance {
  let createdVm: VmInstance | null = null;
  let createdJob: ActionJob | null = null;
  const requestedResources = input.resources ?? null;
  const shutdownSourceBeforeClone = input.shutdownSourceBeforeClone === true;

  runtime.store.update((draft) => {
    const source = runtime.requireVm(draft, input.sourceVmId);
    runtime.ensureActiveProvider(source);
    const template = requireTemplate(draft, source.templateId);
    const cloneResources = requestedResources ?? source.resources;
    validateResources(cloneResources);
    validateVmCloneResources(source, cloneResources);
    const cloneName =
      input.name?.trim() ||
      `${source.name}-clone-${String(draft.sequence).padStart(2, "0")}`;
    const wallpaperName = input.wallpaperName?.trim() || cloneName;

    const vm = buildVmRecord(
      draft,
      template,
      cloneName,
      wallpaperName,
      cloneResources,
      source.forwardedPorts.map(copyForwardAsTemplatePort),
      normalizeVmNetworkMode(
        input.networkMode ?? source.networkMode ?? template.defaultNetworkMode,
      ),
      draft.provider.kind,
      "creating",
      runtime.options.forwardedServiceHostBase ?? null,
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

  runtime.publish();

  if (!createdVm || !createdJob) {
    throw new Error("Failed to queue VM clone.");
  }

  const vmRecord = createdVm as VmInstance;
  const jobRecord = createdJob as ActionJob;

  void runtime.runJob(jobRecord.id, async (report) => {
    try {
      report("Preparing clone", 18);
      await sleep(500);
      const target = runtime.getVmDetail(vmRecord.id).vm;
      const source = runtime.getVmDetail(input.sourceVmId).vm;
      const template = runtime.getVmDetail(vmRecord.id).template;

      runtime.ensureActiveProvider(source);

      if (!template) {
        throw new Error("Template for clone target was not found.");
      }

      if (shutdownSourceBeforeClone && source.status === "running") {
        report("Stopping source VM", 32);
        const stopMutation = await runtime.provider.stopVm(source);
        runtime.markVmStopped(source.id, stopMutation);
      }

      const mutation = await runtime.provider.cloneVm(source, target, template, report);

      runtime.store.update((draft) => {
        const vm = runtime.requireVm(draft, vmRecord.id);
        vm.status = "running";
        vm.liveSince = nowIso();
        applyProviderMutation(vm, mutation);
      });

      runtime.publish();

      return `${vmRecord.name} cloned successfully`;
    } catch (error) {
      runtime.markVmFailed(vmRecord.id, error);
      throw error;
    }
  });

  return vmRecord;
}

export function startVm(runtime: DesktopManagerRuntime, vmId: string): void {
  queueVmAction(runtime, vmId, "start", async (vm, report) => {
    if (vm.status === "running") {
      return `${vm.name} is already running`;
    }

    report("Preparing boot", 24);
    await sleep(350);
    report("Starting VM", 58);
    const mutation = await runtime.provider.startVm(vm);
    report("Waiting for desktop", 88);
    runtime.markVmRunning(vmId, mutation);

    return `${vm.name} started`;
  });
}

export function stopVm(runtime: DesktopManagerRuntime, vmId: string): void {
  queueVmAction(runtime, vmId, "stop", async (vm) => {
    if (vm.status === "stopped") {
      return `${vm.name} is already stopped`;
    }

    const mutation = await runtime.provider.stopVm(vm);
    runtime.markVmStopped(vmId, mutation);

    return `${vm.name} stopped`;
  });
}

export function restartVm(runtime: DesktopManagerRuntime, vmId: string): void {
  queueVmAction(runtime, vmId, "restart", async (vm, report) => {
    const wasRunning = vm.status !== "stopped";

    if (wasRunning) {
      report("Stopping workspace", 24);
      const stopMutation = await runtime.provider.stopVm(vm);
      runtime.markVmStopped(vmId, stopMutation);
    }

    const currentVm = runtime.getVmDetail(vmId).vm;
    report("Preparing boot", wasRunning ? 42 : 24);
    await sleep(350);
    report("Starting VM", wasRunning ? 66 : 58);
    const startMutation = await runtime.provider.startVm(currentVm);
    report("Waiting for desktop", 92);
    runtime.markVmRunning(vmId, startMutation);

    return wasRunning ? `${vm.name} restarted` : `${vm.name} started`;
  });
}

export function reorderVms(
  runtime: DesktopManagerRuntime,
  input: ReorderVmsInput,
): DashboardSummary {
  const requestedVmIds = input.vmIds.filter(
    (vmId, index, vmIds) => vmId.trim().length > 0 && vmIds.indexOf(vmId) === index,
  );

  runtime.store.update((draft) => {
    const byId = new Map(draft.vms.map((vm) => [vm.id, vm]));
    const nextVms = requestedVmIds
      .map((vmId) => byId.get(vmId) ?? null)
      .filter((vm): vm is VmInstance => vm !== null);
    const pinnedIds = new Set(nextVms.map((vm) => vm.id));

    draft.vms = [...nextVms, ...draft.vms.filter((vm) => !pinnedIds.has(vm.id))];

    return true;
  });

  runtime.publish();
  return runtime.getSummary();
}

export function deleteVm(runtime: DesktopManagerRuntime, vmId: string): void {
  let deletedName = "";

  queueVmAction(runtime, vmId, "delete", async (vm) => {
    deletedName = vm.name;
    runtime.store.update((draft) => {
      const current = runtime.requireVm(draft, vmId);
      current.status = "deleting";
      current.lastAction = "Delete requested";
      current.updatedAt = nowIso();
    });
    runtime.publish();

    await sleep(450);
    await runtime.provider.deleteVm(vm);

    runtime.store.update((draft) => {
      draft.vms = draft.vms.filter((entry) => entry.id !== vmId);
    });
    runtime.publish();

    return `${deletedName} deleted`;
  });
}

export function resizeVm(
  runtime: DesktopManagerRuntime,
  vmId: string,
  input: ResizeVmInput,
): void {
  validateResources(input.resources);

  queueVmAction(runtime, vmId, "resize", async (vm) => {
    await sleep(300);
    const mutation = await runtime.provider.resizeVm(vm, input.resources);

    runtime.store.update((draft) => {
      const current = runtime.requireVm(draft, vmId);
      current.resources = input.resources;
      applyProviderMutation(current, mutation);
    });
    runtime.publish();

    return `${vm.name} resized`;
  });
}

export function snapshotVm(
  runtime: DesktopManagerRuntime,
  vmId: string,
  input: SnapshotInput,
): void {
  queueVmAction(runtime, vmId, "snapshot", async (vm) => {
    const label = input.label?.trim() || `Snapshot ${new Date().toLocaleTimeString("en-US")}`;
    await sleep(400);
    const snapshotData = await runtime.provider.snapshotVm(vm, label);

    runtime.store.update((draft) => {
      const current = runtime.requireVm(draft, vmId);
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
    runtime.publish();

    return `${vm.name} snapshotted`;
  });
}

export function launchVmFromSnapshot(
  runtime: DesktopManagerRuntime,
  vmId: string,
  snapshotId: string,
  input: CloneVmInput,
): VmInstance {
  let createdVm: VmInstance | null = null;
  let createdJob: ActionJob | null = null;

  runtime.store.update((draft) => {
    const source = runtime.requireVm(draft, vmId);
    runtime.ensureActiveProvider(source);
    const snapshot = requireVmSnapshot(draft, vmId, snapshotId);
    const template = resolveTemplateForSnapshot(
      draft,
      snapshot,
      runtime.defaultTemplateLaunchSource,
    );
    const name =
      input.name?.trim() ||
      `${source.name}-${slugify(snapshot.label) || "snapshot"}-${String(draft.sequence).padStart(2, "0")}`;
    const wallpaperName = input.wallpaperName?.trim() || name;

    const vm = buildVmRecord(
      draft,
      template,
      name,
      wallpaperName,
      snapshot.resources,
      source.forwardedPorts.map(copyForwardAsTemplatePort),
      normalizeVmNetworkMode(source.networkMode ?? template.defaultNetworkMode),
      draft.provider.kind,
      "creating",
      runtime.options.forwardedServiceHostBase ?? null,
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

  runtime.publish();

  if (!createdVm || !createdJob) {
    throw new Error("Failed to queue snapshot launch.");
  }

  const vmRecord = createdVm as VmInstance;
  const jobRecord = createdJob as ActionJob;

  void runtime.runJob(jobRecord.id, async (report) => {
    try {
      report("Preparing snapshot launch", 18);
      await sleep(350);
      const detail = runtime.getVmDetail(vmId);
      const snapshot = requireVmSnapshot(runtime.store.load(), vmId, snapshotId);
      const template = resolveTemplateForSnapshot(
        runtime.store.load(),
        snapshot,
        runtime.defaultTemplateLaunchSource,
      );

      runtime.ensureActiveProvider(detail.vm);

      const mutation = await runtime.provider.launchVmFromSnapshot(
        snapshot,
        vmRecord,
        template,
        report,
      );

      runtime.store.update((draft) => {
        const current = runtime.requireVm(draft, vmRecord.id);
        current.status = "running";
        current.liveSince = nowIso();
        applyProviderMutation(current, mutation);
      });

      runtime.publish();

      return `${vmRecord.name} launched from ${snapshot.label}`;
    } catch (error) {
      runtime.markVmFailed(vmRecord.id, error);
      throw error;
    }
  });

  return vmRecord;
}

export function restoreVmSnapshot(
  runtime: DesktopManagerRuntime,
  vmId: string,
  snapshotId: string,
): void {
  queueVmAction(runtime, vmId, "restore-snapshot", async (vm, report) => {
    const snapshot = requireVmSnapshot(runtime.store.load(), vmId, snapshotId);

    report("Preparing snapshot restore", 22);
    await sleep(250);
    report("Restoring VM state", 56);
    const mutation = await runtime.provider.restoreVmToSnapshot(vm, snapshot);

    runtime.store.update((draft) => {
      const current = runtime.requireVm(draft, vmId);
      current.status = vm.status === "running" ? "running" : "stopped";
      current.liveSince = current.status === "running" ? nowIso() : null;
      applyProviderMutation(current, mutation);
    });

    runtime.publish();

    return `${vm.name} restored to ${snapshot.label}`;
  });
}

export function captureTemplate(
  runtime: DesktopManagerRuntime,
  vmId: string,
  input: CaptureTemplateInput,
): void {
  const captureName = input.name.trim();
  const captureDescription = input.description.trim();
  const requestedTemplateId = input.templateId?.trim() || null;

  if (!captureName) {
    throw new Error("Template name is required.");
  }

  let jobId = "";
  let targetTemplateId = requestedTemplateId;

  runtime.store.update((draft) => {
    const vm = runtime.requireVm(draft, vmId);
    runtime.ensureActiveProvider(vm);

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

  runtime.publish();

  if (!targetTemplateId) {
    throw new Error("Failed to reserve a template target.");
  }

  const reservedTemplateId = targetTemplateId;

  void runtime.runJob(jobId, async (report) => {
    report("Preparing template capture", 18);
    await sleep(180);
    const detail = runtime.getVmDetail(vmId);
    runtime.ensureActiveProvider(detail.vm);

    const providerSnapshot = await runtime.provider.captureTemplate(
      detail.vm,
      {
        templateId: reservedTemplateId,
        name: captureName,
      },
      report,
    );
    report("Updating template metadata", 96);
    const launchSource =
      providerSnapshot.launchSource ??
      detail.template?.launchSource ??
      runtime.defaultTemplateLaunchSource;
    let updatedExistingTemplate = false;

    runtime.store.update((draft) => {
      const current = runtime.requireVm(draft, vmId);
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
      const captureNotes = buildCaptureNotes(current, existingTemplate?.notes ?? []);
      const provenance = buildCapturedTemplateProvenance(current, detail.template, snapshot);
      const captureHistoryEntry = buildTemplateHistoryEntry(
        "captured",
        existingTemplate
          ? `Refreshed from VM ${current.name} via snapshot ${snapshot.label}.`
          : `Captured from VM ${current.name} via snapshot ${snapshot.label}.`,
        snapshot.createdAt,
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
        existingTemplate.defaultNetworkMode = normalizeVmNetworkMode(current.networkMode);
        existingTemplate.snapshotIds.unshift(snapshot.id);
        existingTemplate.tags = Array.from(
          new Set(["captured", slugify(current.name), ...existingTemplate.tags]),
        );
        existingTemplate.notes = captureNotes;
        existingTemplate.provenance = provenance;
        existingTemplate.history = appendTemplateHistory(
          existingTemplate.history,
          captureHistoryEntry,
        );
        existingTemplate.updatedAt = nowIso();
      } else {
        const template: EnvironmentTemplate = {
          id: reservedTemplateId,
          name: captureName,
          description: captureDescription || `Captured from ${current.name}`,
          launchSource,
          defaultResources: { ...current.resources },
          defaultForwardedPorts: current.forwardedPorts.map(copyForwardAsTemplatePort),
          defaultNetworkMode: normalizeVmNetworkMode(current.networkMode),
          initCommands: [...(detail.template?.initCommands ?? [])],
          tags: ["captured", slugify(current.name)],
          notes: captureNotes,
          snapshotIds: [snapshot.id],
          provenance,
          history: [captureHistoryEntry],
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
    runtime.publish();

    return updatedExistingTemplate
      ? `${captureName} template updated`
      : `${captureName} template created`;
  });
}

export function createTemplate(
  runtime: DesktopManagerRuntime,
  input: CreateTemplateInput,
): EnvironmentTemplate {
  const nextName = input.name.trim();

  if (!nextName) {
    throw new Error("Template name is required.");
  }

  const nextDescription = input.description.trim();
  const nextInitCommands = normalizeTemplateInitCommands(input.initCommands);
  let createdTemplate: EnvironmentTemplate | null = null;

  runtime.store.update((draft) => {
    const sourceTemplate = requireTemplate(draft, input.sourceTemplateId);
    const now = nowIso();

    createdTemplate = {
      id: nextId(draft, "tpl"),
      name: nextName,
      description: nextDescription || sourceTemplate.description,
      launchSource: sourceTemplate.launchSource,
      defaultResources: { ...sourceTemplate.defaultResources },
      defaultForwardedPorts: sourceTemplate.defaultForwardedPorts.map(copyTemplatePortForward),
      defaultNetworkMode: normalizeVmNetworkMode(sourceTemplate.defaultNetworkMode),
      initCommands: nextInitCommands,
      tags: Array.from(
        new Set([
          ...sourceTemplate.tags,
          "cloned",
          ...(nextInitCommands.length > 0 ? ["init-script"] : []),
        ]),
      ),
      notes: buildClonedTemplateNotes(
        sourceTemplate,
        sourceTemplate.notes,
        nextInitCommands,
      ),
      snapshotIds: [],
      provenance: buildClonedTemplateProvenance(sourceTemplate),
      history: [
        buildTemplateHistoryEntry(
          "cloned",
          `Cloned from template ${sourceTemplate.name}${nextInitCommands.length > 0 ? ` with ${nextInitCommands.length} first-boot init command${nextInitCommands.length === 1 ? "" : "s"}` : ""}.`,
          now,
        ),
      ],
      createdAt: now,
      updatedAt: now,
    };

    draft.templates.unshift(createdTemplate);
    return true;
  });

  runtime.publish();

  if (!createdTemplate) {
    throw new Error("Failed to create template.");
  }

  return createdTemplate;
}

export function updateTemplate(
  runtime: DesktopManagerRuntime,
  templateId: string,
  input: UpdateTemplateInput,
): EnvironmentTemplate {
  const nextName = input.name.trim();

  if (!nextName) {
    throw new Error("Template name is required.");
  }

  let updatedTemplate: EnvironmentTemplate | null = null;

  runtime.store.update((draft) => {
    const template = requireTemplate(draft, templateId);
    const nextDescription =
      input.description !== undefined ? input.description.trim() : template.description;
    const nextInitCommands =
      input.initCommands !== undefined
        ? normalizeTemplateInitCommands(input.initCommands)
        : template.initCommands;
    const changedFields = collectTemplateUpdateFieldLabels(
      template,
      nextName,
      nextDescription,
      nextInitCommands,
    );

    if (
      template.name === nextName &&
      template.description === nextDescription &&
      sameStringArray(template.initCommands, nextInitCommands)
    ) {
      updatedTemplate = template;
      return false;
    }

    template.name = nextName;
    template.description = nextDescription;
    template.initCommands = nextInitCommands;
    template.history = appendTemplateHistory(
      template.history,
      buildTemplateHistoryEntry("updated", `Updated ${changedFields.join(", ")}.`),
    );
    template.updatedAt = nowIso();
    updatedTemplate = template;
    return true;
  });

  runtime.publish();

  if (!updatedTemplate) {
    throw new Error(`Template ${templateId} was not found.`);
  }

  return updatedTemplate;
}

export function updateVm(
  runtime: DesktopManagerRuntime,
  vmId: string,
  input: UpdateVmInput,
): VmInstance {
  const nextName = input.name.trim();

  if (!nextName) {
    throw new Error("VM name is required.");
  }

  let updatedVm: VmInstance | null = null;

  runtime.store.update((draft) => {
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

  runtime.publish();

  if (!updatedVm) {
    throw new Error(`VM ${vmId} was not found.`);
  }

  return updatedVm;
}

export function deleteTemplate(
  runtime: DesktopManagerRuntime,
  templateId: string,
): void {
  let removed = false;

  runtime.store.update((draft) => {
    const template = requireTemplate(draft, templateId);
    const linkedVm = draft.vms.find((entry) => entry.templateId === templateId);

    if (linkedVm) {
      throw new Error(`Template ${template.name} is still attached to VM ${linkedVm.name}.`);
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

  runtime.publish();
}

export function injectCommand(
  runtime: DesktopManagerRuntime,
  vmId: string,
  command: string,
): void {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("Command is required.");
  }

  queueVmAction(runtime, vmId, "inject-command", async (vm) => {
    if (vm.status !== "running") {
      throw new Error("VM must be running before commands can be injected.");
    }

    await sleep(150);
    const mutation = await runtime.provider.injectCommand(vm, trimmed);

    runtime.store.update((draft) => {
      const current = runtime.requireVm(draft, vmId);
      applyProviderMutation(current, mutation);
    });
    runtime.publish();

    return `${vm.name} command completed`;
  });
}

export async function setVmResolution(
  runtime: DesktopManagerRuntime,
  vmId: string,
  input: SetVmResolutionInput,
): Promise<void> {
  const width = Math.round(input.width);
  const height = Math.round(input.height);

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error("Display resolution width and height are required.");
  }

  const vm = runtime.getVmDetail(vmId).vm;
  runtime.ensureActiveProvider(vm);

  if (vm.status !== "running") {
    throw new Error("VM must be running before the display resolution can be changed.");
  }

  if (vm.session?.kind !== "vnc") {
    throw new Error("Display resolution changes require a live VNC-backed desktop.");
  }

  await runtime.provider.setDisplayResolution(vm, width, height);
}

export async function setVmNetworkMode(
  runtime: DesktopManagerRuntime,
  vmId: string,
  input: UpdateVmNetworkInput,
): Promise<void> {
  const vm = runtime.getVmDetail(vmId).vm;
  runtime.ensureActiveProvider(vm);
  const nextNetworkMode = normalizeVmNetworkMode(input.networkMode);
  const currentNetworkMode = normalizeVmNetworkMode(vm.networkMode);

  if (currentNetworkMode === nextNetworkMode) {
    return;
  }

  const mutation = await runtime.provider.setNetworkMode(vm, nextNetworkMode);

  runtime.store.update((draft) => {
    const current = runtime.requireVm(draft, vmId);
    current.networkMode = nextNetworkMode;
    applyProviderMutation(current, mutation);
  });

  runtime.publish();
}

export function updateVmForwardedPorts(
  runtime: DesktopManagerRuntime,
  vmId: string,
  input: UpdateVmForwardedPortsInput,
): void {
  validateForwardedPorts(input.forwardedPorts);

  runtime.store.update((draft) => {
    const vm = runtime.requireVm(draft, vmId);
    vm.forwardedPorts = buildVmForwardedPorts(
      vm.id,
      input.forwardedPorts,
      runtime.options.forwardedServiceHostBase ?? null,
    );
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

  runtime.publish();
}

function queueVmAction(
  runtime: DesktopManagerRuntime,
  vmId: string,
  kind: JobKind,
  runner: (vm: VmInstance, report: JobProgressReporter) => Promise<string>,
): void {
  let jobId = "";

  runtime.store.update((draft) => {
    const vm = runtime.requireVm(draft, vmId);
    runtime.ensureActiveProvider(vm);
    const job = buildJob(draft, kind, vm.id, vm.templateId, `Queued ${kind} for ${vm.name}`);
    draft.jobs.unshift(job);
    trimJobs(draft);
    jobId = job.id;
  });

  runtime.publish();

  void runtime.runJob(jobId, async (report) => {
    const vm = runtime.getVmDetail(vmId).vm;
    runtime.ensureActiveProvider(vm);
    return runner(vm, report);
  });
}
