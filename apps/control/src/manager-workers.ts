import { normalizeVmDesktopTransport } from "../../../packages/shared/src/helpers.js";
import type {
  EnvironmentTemplate,
  ProviderState,
  VmInstance,
} from "../../../packages/shared/src/types.js";
import {
  appendActivity,
  appendTelemetrySample,
  buildTemplateHistoryEntry,
  emptyResourceTelemetry,
  hasReachableVncSession,
  isInterruptedBootJobFailure,
  markVmPausedOutsideControlPlane,
  markVmRunningOutsideControlPlane,
  markVmStoppedOutsideControlPlane,
  mergeVmSessionRefreshMode,
  nowIso,
  sameProviderState,
  sameTelemetry,
  sameVmSession,
  type DesktopManagerRuntime,
  type VmSessionRefreshMode,
} from "./manager-core.js";
import { enrichVmSession } from "./desktop-session.js";
import {
  buildSeedTemplateRecord,
  buildSeedTemplateSummary,
  buildSystemSeedTemplateDefinitions,
  DEFAULT_TEMPLATE_ID,
  UBUNTU_24_04_TEMPLATE_LAUNCH_SOURCE,
  UBUNTU_26_04_TEMPLATE_LAUNCH_SOURCE,
  isAutoSeedTemplateDescription,
  isAutoSeedTemplateName,
  isAutoSeedTemplateSummary,
} from "./template-defaults.js";

export function performManagerTick(runtime: DesktopManagerRuntime): void {
  const providerChanged = syncProviderState(runtime);
  let telemetryChanged = false;
  const nextHostTelemetry = appendTelemetrySample(
    runtime.hostTelemetry,
    runtime.provider.sampleHostTelemetry(),
  );

  if (!sameTelemetry(nextHostTelemetry, runtime.hostTelemetry)) {
    runtime.hostTelemetry = nextHostTelemetry;
    telemetryChanged = true;
  }

  const activeTelemetryVmIds = new Set<string>();
  const { changed } = runtime.store.update((state) => {
    let dirty = false;

    for (const vm of state.vms) {
      if (vm.status !== "running") {
        continue;
      }

      activeTelemetryVmIds.add(vm.id);

      const nextVmTelemetry = appendTelemetrySample(
        runtime.vmTelemetry.get(vm.id) ?? emptyResourceTelemetry(),
        runtime.provider.sampleVmTelemetry(vm),
      );

      if (!sameTelemetry(nextVmTelemetry, runtime.vmTelemetry.get(vm.id) ?? null)) {
        runtime.vmTelemetry.set(vm.id, nextVmTelemetry);
        telemetryChanged = true;
      }

      const template = state.templates.find((entry) => entry.id === vm.templateId);

      if (!template) {
        continue;
      }

      const tick = runtime.provider.tickVm(vm, template);

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

  for (const vmId of [...runtime.vmTelemetry.keys()]) {
    if (!activeTelemetryVmIds.has(vmId)) {
      runtime.vmTelemetry.delete(vmId);
      telemetryChanged = true;
    }
  }

  if (shouldRequestFullVmSessionMaintenanceRefresh(runtime)) {
    runtime.requestVmSessionRefresh("all");
  } else {
    runtime.requestVmSessionRefresh();
  }

  if (changed) {
    runtime.publish();
    return;
  }

  if (providerChanged || telemetryChanged) {
    runtime.publish();
  }
}

export function reconcileFailedProvisioningJobs(runtime: DesktopManagerRuntime): void {
  runtime.store.update((draft) => {
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

export function reconcileDefaultTemplateLaunchSource(
  runtime: DesktopManagerRuntime,
): void {
  runtime.store.update((draft) => {
    let dirty = false;
    const desiredTemplates = buildSystemSeedTemplateDefinitions(
      runtime.defaultTemplateLaunchSource,
    );
    const desiredTemplateIds = new Set(
      desiredTemplates.map((template) => template.id),
    );

    for (const definition of desiredTemplates) {
      const template = draft.templates.find((entry) => entry.id === definition.id);

      if (!template) {
        draft.templates.push(buildSeedTemplateRecord(definition, nowIso()));
        dirty = true;
        continue;
      }

      if (
        !reconcileSeedTemplateRecord(
          template,
          definition,
          runtime.options.defaultTemplateLaunchSource != null,
        )
      ) {
        continue;
      }

      dirty = true;
    }

    for (let index = draft.templates.length - 1; index >= 0; index -= 1) {
      const template = draft.templates[index];

      if (
        !template ||
        template.id === DEFAULT_TEMPLATE_ID ||
        desiredTemplateIds.has(template.id) ||
        template.provenance?.kind !== "seed" ||
        !template.id.startsWith("tpl-system-ubuntu-")
      ) {
        continue;
      }

      const hasLinkedVm = draft.vms.some((vm) => vm.templateId === template.id);
      const hasLinkedSnapshot = draft.snapshots.some(
        (snapshot) => snapshot.templateId === template.id,
      );

      if (hasLinkedVm || hasLinkedSnapshot) {
        continue;
      }

      draft.templates.splice(index, 1);
      dirty = true;
    }

    return dirty;
  });
}

function reconcileSeedTemplateRecord(
  template: EnvironmentTemplate,
  definition: ReturnType<typeof buildSystemSeedTemplateDefinitions>[number],
  forcePrimaryLaunchSourceUpdate: boolean,
): boolean {
  const provenance = template.provenance ?? {
    kind: "seed",
    summary: "",
    sourceTemplateId: null,
    sourceTemplateName: null,
    sourceVmId: null,
    sourceVmName: null,
    sourceSnapshotId: null,
    sourceSnapshotLabel: null,
  };
  let dirty = false;

  if (!template.provenance) {
    template.provenance = provenance;
    dirty = true;
  }

  if (provenance.kind !== "seed") {
    return false;
  }

  const history = template.history ?? [];

  if (!template.history) {
    template.history = history;
    dirty = true;
  }

  const shouldUpdateLaunchSource =
    template.id !== DEFAULT_TEMPLATE_ID ||
    forcePrimaryLaunchSourceUpdate ||
    isAutoManagedSeedLaunchSource(template.launchSource);

  if (shouldUpdateLaunchSource && template.launchSource !== definition.launchSource) {
    template.launchSource = definition.launchSource;
    dirty = true;
  }

  if (isAutoSeedTemplateName(template.name) && template.name !== definition.name) {
    template.name = definition.name;
    dirty = true;
  }

  if (
    isAutoSeedTemplateDescription(template.description) &&
    template.description !== definition.description
  ) {
    template.description = definition.description;
    dirty = true;
  }

  if (
    sameStringArray(template.tags, definition.tags) === false &&
    isAutoManagedSeedTags(template.tags)
  ) {
    template.tags = [...definition.tags];
    dirty = true;
  }

  if (
    sameStringArray(template.notes, definition.notes) === false &&
    isAutoManagedSeedNotes(template.notes)
  ) {
    template.notes = [...definition.notes];
    dirty = true;
  }

  const seededSummary = buildSeedTemplateSummary(definition.launchSource);

  if (isAutoSeedTemplateSummary(provenance.summary)) {
    if (provenance.summary !== seededSummary) {
      provenance.summary = seededSummary;
      dirty = true;
    }
  }

  const createdHistoryEntry = history.find((entry) => entry.kind === "created");

  if (!createdHistoryEntry) {
    history.unshift(buildTemplateHistoryEntry("created", seededSummary, template.createdAt));
    dirty = true;
  }

  if (createdHistoryEntry && isAutoSeedTemplateSummary(createdHistoryEntry.summary)) {
    if (createdHistoryEntry.summary !== seededSummary) {
      createdHistoryEntry.summary = seededSummary;
      dirty = true;
    }
  }

  if (!dirty) {
    return false;
  }

  template.updatedAt = nowIso();
  return true;
}

function isAutoManagedSeedTags(tags: string[]): boolean {
  return sameStringArray(tags, ["coding", "agents", "ubuntu"]) ||
    sameStringArray(tags, ["coding", "agents", "ubuntu", "ubuntu-24.04"]) ||
    sameStringArray(tags, ["coding", "agents", "ubuntu", "ubuntu-26.04"]);
}

function isAutoManagedSeedLaunchSource(launchSource: string): boolean {
  return launchSource === UBUNTU_24_04_TEMPLATE_LAUNCH_SOURCE ||
    launchSource === UBUNTU_26_04_TEMPLATE_LAUNCH_SOURCE;
}

function isAutoManagedSeedNotes(notes: string[]): boolean {
  return sameStringArray(notes, [
    "GNOME desktop with terminal and editor workspace layout.",
    "Base image is intended for iterative snapshotting during development.",
  ]) ||
    sameStringArray(notes, [
      "GNOME desktop with terminal and editor workspace layout.",
      "Ubuntu 24.04 base image is intended for iterative snapshotting during development.",
    ]) ||
    sameStringArray(notes, [
      "GNOME desktop with terminal and editor workspace layout.",
      "Ubuntu 26.04 base image is intended for iterative snapshotting during development.",
    ]);
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

export function reconcileInterruptedJobs(runtime: DesktopManagerRuntime): void {
  runtime.store.update((draft) => {
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

export function recoverInterruptedBootVms(runtime: DesktopManagerRuntime): void {
  runtime.store.update((draft) => {
    let dirty = false;

    if (!draft.provider.available) {
      return false;
    }

    for (const vm of draft.vms) {
      if (vm.provider !== draft.provider.kind) {
        continue;
      }

      const interruptedBootJob = draft.jobs.find(
        (job) =>
          job.targetVmId === vm.id &&
          job.status === "failed" &&
          isInterruptedBootJobFailure(job),
      );

      if (!interruptedBootJob) {
        continue;
      }

      const observedPowerState = runtime.provider.observeVmPowerState(vm);

      if (observedPowerState?.status !== "running") {
        continue;
      }

      vm.status = "running";
      vm.liveSince = vm.liveSince ?? nowIso();
      vm.lastAction = "Workspace recovered after control server restart.";
      vm.updatedAt = nowIso();
      vm.session = null;

      const recoveredLine = `${vm.provider}: recovered ${vm.providerRef} after interrupted ${interruptedBootJob.kind}`;
      if (!vm.activityLog.includes(recoveredLine)) {
        appendActivity(vm, recoveredLine);
      }

      dirty = true;
    }

    return dirty;
  });
}

export function syncProviderState(runtime: DesktopManagerRuntime): boolean {
  const nextProviderState = runtime.provider.refreshState();
  const { changed } = runtime.store.update((draft) => {
    let dirty = !sameProviderState(draft.provider, nextProviderState);

    if (dirty) {
      draft.provider = nextProviderState;
    }

    if (!nextProviderState.available) {
      return dirty;
    }

    for (const vm of draft.vms) {
      if (vm.provider !== nextProviderState.kind) {
        continue;
      }

      const observedPowerState = runtime.provider.observeVmPowerState(vm);

      if (vm.status === "running") {
        if (observedPowerState?.status !== "stopped" && observedPowerState?.status !== "paused") {
          continue;
        }

        if (observedPowerState.status === "paused") {
          markVmPausedOutsideControlPlane(vm);
        } else {
          markVmStoppedOutsideControlPlane(vm);
        }
        runtime.vmTelemetry.delete(vm.id);
        dirty = true;
        continue;
      }

      if (vm.status === "paused") {
        if (observedPowerState?.status === "running") {
          markVmRunningOutsideControlPlane(vm);
          dirty = true;
          continue;
        }

        if (observedPowerState?.status === "stopped") {
          markVmStoppedOutsideControlPlane(vm);
          dirty = true;
        }

        continue;
      }

      if (vm.status === "stopped" && observedPowerState?.status === "running") {
        markVmRunningOutsideControlPlane(vm);
        dirty = true;
      }
    }

    return dirty;
  });

  if (nextProviderState.available) {
    runtime.requestVmSessionRefresh();
  }

  return changed;
}

export function requestVmSessionRefresh(
  runtime: DesktopManagerRuntime,
  mode: Exclude<VmSessionRefreshMode, "none"> = "missing",
): void {
  if (mode === "all") {
    runtime.lastFullVmSessionRefreshRequestAt = Date.now();
  }

  runtime.sessionRefreshMode = mergeVmSessionRefreshMode(runtime.sessionRefreshMode, mode);

  if (runtime.sessionRefreshInFlight) {
    return;
  }

  runtime.sessionRefreshInFlight = true;
  void runVmSessionRefreshLoop(runtime);
}

async function runVmSessionRefreshLoop(runtime: DesktopManagerRuntime): Promise<void> {
  try {
    while (runtime.sessionRefreshMode !== "none") {
      const mode = runtime.sessionRefreshMode;
      runtime.sessionRefreshMode = "none";
      await refreshRunningVmSessions(runtime, mode);
    }
  } finally {
    runtime.sessionRefreshInFlight = false;

    if (runtime.sessionRefreshMode !== "none") {
      requestVmSessionRefresh(runtime, runtime.sessionRefreshMode);
    }
  }
}

async function refreshRunningVmSessions(
  runtime: DesktopManagerRuntime,
  mode: Exclude<VmSessionRefreshMode, "none">,
): Promise<void> {
  const state = runtime.store.load();

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
    const current = runtime.store.load().vms.find((entry) => entry.id === vmId);

    if (!current || !shouldRefreshVmSession(current, state.provider.kind, mode)) {
      continue;
    }

    const expectedDesktopTransport = normalizeVmDesktopTransport(current.desktopTransport);

    try {
      const nextSession = enrichVmSession(
        vmId,
        await runtime.provider.refreshVmSession(current),
      );

      const result = runtime.store.update((draft) => {
        const vm = draft.vms.find((entry) => entry.id === vmId);

        if (!vm || !shouldRefreshVmSession(vm, draft.provider.kind, mode)) {
          return false;
        }

        if (normalizeVmDesktopTransport(vm.desktopTransport) !== expectedDesktopTransport) {
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
    runtime.publish();
  }
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

function shouldRequestFullVmSessionMaintenanceRefresh(
  runtime: DesktopManagerRuntime,
): boolean {
  return (
    Date.now() - runtime.lastFullVmSessionRefreshRequestAt >=
    runtime.vmSessionMaintenanceRefreshMs
  );
}
