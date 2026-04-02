import assert from "node:assert/strict";
import test from "node:test";

import type {
  ActionJob,
  DashboardSummary,
  EnvironmentTemplate,
  ProviderState,
  Snapshot,
  VmDetail,
  VmDiskUsageSnapshot,
  VmInstance,
} from "../packages/shared/src/types.js";
import {
  buildCreateLaunchValidationError,
  buildCreateDraftFromTemplate,
  buildCreateDraftFromVm,
  buildCreateSourceGroups,
  createSourceSupportsDesktopTransportChoice,
  diskUsageSummaryText,
  findProminentJob,
  getVmDesktopBootState,
  normalizeActiveCpuThreshold,
  shouldShowWorkspaceLogsSurface,
} from "../apps/web/src/dashboardHelpers.js";

test("buildCreateSourceGroups keeps system templates ahead of user templates and clones", () => {
  const seedTemplate = buildTemplate("template-seed", {
    name: "Ubuntu Seed",
    provenance: {
      kind: "seed",
      summary: "Seeded image",
    },
  });
  const customTemplate = buildTemplate("template-custom", {
    name: "Custom Base",
    provenance: {
      kind: "captured",
      summary: "Captured from a workspace",
    },
  });
  const vm = buildVm("vm-1", {
    name: "Alpha",
    templateId: customTemplate.id,
  });
  const snapshot = buildSnapshot("snap-1", {
    label: "Checkpoint",
    templateId: customTemplate.id,
    vmId: vm.id,
  });

  const groups = buildCreateSourceGroups(
    [customTemplate, seedTemplate],
    [snapshot],
    [vm],
  );

  assert.deepEqual(
    groups.map((group) => group.label),
    ["System templates", "My templates", "Snapshots", "Clone existing VM"],
  );
  assert.equal(groups[0]?.options[0]?.label, "Ubuntu Seed");
  assert.equal(groups[2]?.options[0]?.label, "Checkpoint - Alpha");
});

test("buildCreateLaunchValidationError blocks shrinking snapshot disks", () => {
  const template = buildTemplate("template-1");
  const vm = buildVm("vm-1", {
    name: "Alpha",
    templateId: template.id,
  });
  const snapshot = buildSnapshot("snap-1", {
    label: "Release candidate",
    templateId: template.id,
    vmId: vm.id,
    resources: {
      cpu: 2,
      ramMb: 4096,
      diskGb: 80,
    },
  });

  const selection = buildCreateSourceGroups([template], [snapshot], [vm])[1]?.options[0] ?? null;

  assert.equal(
    buildCreateLaunchValidationError(selection, "4", "40"),
    "Snapshot Release candidate needs at least 80 GB disk because shrinking a saved filesystem is not supported.",
  );
});

test("buildCreateLaunchValidationError allows launching a new VM from a stateful snapshot without matching RAM", () => {
  const template = buildTemplate("template-1");
  const vm = buildVm("vm-1", {
    name: "Alpha",
    templateId: template.id,
  });
  const snapshot = buildSnapshot("snap-2", {
    label: "Live checkpoint",
    stateful: true,
    templateId: template.id,
    vmId: vm.id,
    resources: {
      cpu: 2,
      ramMb: 8192,
      diskGb: 80,
    },
  });

  const selection = buildCreateSourceGroups([template], [snapshot], [vm])[1]?.options[0] ?? null;

  assert.equal(buildCreateLaunchValidationError(selection, "4", "80"), null);
});

test("buildCreateLaunchValidationError blocks cloning live RAM state below the source RAM", () => {
  const template = buildTemplate("template-1");
  const vm = buildVm("vm-1", {
    name: "Alpha",
    status: "running",
    templateId: template.id,
    resources: {
      cpu: 2,
      ramMb: 8192,
      diskGb: 40,
    },
  });

  const selection = buildCreateSourceGroups([template], [], [vm])[1]?.options[0] ?? null;

  assert.equal(
    buildCreateLaunchValidationError(selection, "4", "40", {
      statefulClone: true,
    }),
    "Alpha needs at least 8192 MB RAM for a clone that includes saved memory state.",
  );
});

test("buildCreateLaunchValidationError blocks launching captured templates below their captured size", () => {
  const template = buildTemplate("template-1", {
    name: "Captured Template",
    launchSource: "parallaize-template-template-1",
    defaultResources: {
      cpu: 2,
      ramMb: 4096,
      diskGb: 64,
    },
    provenance: {
      kind: "captured",
      summary: "Captured from workspace Alpha",
    },
  });
  const selection = buildCreateSourceGroups([template], [], [])[0]?.options[0] ?? null;

  assert.equal(
    buildCreateLaunchValidationError(selection, "4", "32"),
    "Captured Template was captured from a 64 GB workspace and needs at least 64 GB disk to launch cleanly.",
  );
});

test("system template launches default to VNC and expose the transport choice", () => {
  const template = buildTemplate("template-seed", {
    provenance: {
      kind: "seed",
      summary: "Seeded image",
    },
  });
  const selection = buildCreateSourceGroups([template], [], [])[0]?.options[0] ?? null;
  const draft = buildCreateDraftFromTemplate(template);

  assert.equal(draft.desktopTransport, "vnc");
  assert.equal(createSourceSupportsDesktopTransportChoice(selection), true);
});

test("clone drafts preserve the source VM desktop transport", () => {
  const template = buildTemplate("template-1", {
    defaultDesktopTransport: "selkies",
  });
  const sourceVm = buildVm("vm-1", {
    desktopTransport: "vnc",
    templateId: template.id,
  });
  const draft = buildCreateDraftFromVm(sourceVm, template);

  assert.equal(draft.desktopTransport, "vnc");
});

test("running clone drafts default to a cold clone until RAM is requested", () => {
  const template = buildTemplate("template-1");
  const sourceVm = buildVm("vm-1", {
    status: "running",
    templateId: template.id,
  });
  const draft = buildCreateDraftFromVm(sourceVm, template);

  assert.equal(draft.shutdownSourceBeforeClone, true);
  assert.equal(draft.statefulClone, false);
});

test("normalizeActiveCpuThreshold clamps and rounds to two decimals", () => {
  assert.equal(normalizeActiveCpuThreshold(Number.NaN), 2);
  assert.equal(normalizeActiveCpuThreshold(-5), 0);
  assert.equal(normalizeActiveCpuThreshold(150), 100);
  assert.equal(normalizeActiveCpuThreshold(12.3456), 12.35);
});

test("diskUsageSummaryText prefers the tighter workspace filesystem when both are present", () => {
  const snapshot: VmDiskUsageSnapshot = {
    vmId: "vm-1",
    workspacePath: "/srv/workspaces/alpha",
    checkedAt: "2026-03-29T10:00:00.000Z",
    status: "warning",
    detail: "Disk space is getting low.",
    warningThresholdBytes: 1,
    criticalThresholdBytes: 1,
    root: {
      path: "/",
      mountPath: "/",
      filesystem: "/dev/root",
      sizeBytes: 10 * 1024 ** 3,
      usedBytes: 7 * 1024 ** 3,
      availableBytes: 3 * 1024 ** 3,
      usedPercent: 70,
    },
    workspace: {
      path: "/srv/workspaces/alpha",
      mountPath: "/",
      filesystem: "/dev/root",
      sizeBytes: 10 * 1024 ** 3,
      usedBytes: 9.5 * 1024 ** 3,
      availableBytes: 512 * 1024 ** 2,
      usedPercent: 95,
    },
  };

  assert.equal(
    diskUsageSummaryText(snapshot),
    "512 MiB free on /srv/workspaces/alpha",
  );
});

test("findProminentJob prefers the selected VM's active job", () => {
  const summary = buildSummary({
    jobs: [
      buildJob("job-1", {
        kind: "create",
        targetVmId: "vm-1",
        status: "running",
      }),
      buildJob("job-2", {
        kind: "restart",
        targetVmId: "vm-2",
        status: "running",
      }),
    ],
    vms: [
      buildVm("vm-1", { name: "Alpha" }),
      buildVm("vm-2", { name: "Beta" }),
    ],
  });

  const prominent = findProminentJob(summary, "vm-2");

  assert.equal(prominent?.job.id, "job-2");
  assert.equal(prominent?.vmName, "Beta");
  assert.equal(prominent?.activeCount, 2);
});

test("getVmDesktopBootState describes restart progress for an in-flight boot job", () => {
  const detail = buildDetail(buildVm("vm-1", { status: "running" }), {
    recentJobs: [
      buildJob("job-1", {
        kind: "restart",
        status: "running",
        message: "Restarting guest services.",
        progressPercent: 58,
      }),
    ],
  });

  assert.deepEqual(getVmDesktopBootState(detail, Date.parse("2026-03-29T10:05:00.000Z")), {
    label: "Restarting workspace",
    message: "Restarting guest services.",
    progressPercent: 58,
    timingCopy: "Elapsed 5m",
  });
});

test("shouldShowWorkspaceLogsSurface waits for guest VNC when novnc transport is active", () => {
  const detail = buildDetail(
    buildVm("vm-1", {
      status: "running",
      session: null,
    }),
    {
      provider: {
        ...buildProvider(),
        desktopTransport: "novnc",
      },
    },
  );

  assert.equal(shouldShowWorkspaceLogsSurface(detail), true);
});

function buildTemplate(
  id: string,
  overrides: Partial<EnvironmentTemplate> = {},
): EnvironmentTemplate {
  return {
    id,
    name: `Template ${id}`,
    description: "Template description",
    launchSource: "images:ubuntu/noble/desktop",
    defaultResources: {
      cpu: 2,
      ramMb: 4096,
      diskGb: 40,
    },
    defaultForwardedPorts: [],
    defaultNetworkMode: "default",
    initCommands: [],
    tags: [],
    notes: [],
    snapshotIds: [],
    createdAt: "2026-03-29T10:00:00.000Z",
    updatedAt: "2026-03-29T10:00:00.000Z",
    ...overrides,
  };
}

function buildVm(
  id: string,
  overrides: Partial<VmInstance> = {},
): VmInstance {
  return {
    id,
    name: `VM ${id}`,
    wallpaperName: "alpha",
    templateId: "template-1",
    provider: "mock",
    providerRef: `provider-${id}`,
    status: "stopped",
    resources: {
      cpu: 2,
      ramMb: 4096,
      diskGb: 40,
    },
    createdAt: "2026-03-29T10:00:00.000Z",
    updatedAt: "2026-03-29T10:00:00.000Z",
    liveSince: null,
    lastAction: "Created",
    snapshotIds: [],
    frameRevision: 0,
    screenSeed: 12,
    activeWindow: "editor",
    workspacePath: "/srv/workspaces/alpha",
    networkMode: "default",
    session: {
      kind: "vnc",
      host: "10.0.0.5",
      port: 5900,
      reachable: true,
      webSocketPath: "/api/vms/vm-1/vnc",
      browserPath: "/?vm=vm-1",
      display: "10.0.0.5:5900",
    },
    forwardedPorts: [],
    activityLog: [],
    commandHistory: [],
    telemetry: {
      cpuHistory: [],
      cpuPercent: null,
      ramHistory: [],
      ramPercent: null,
    },
    ...overrides,
  };
}

function buildSnapshot(
  id: string,
  overrides: Partial<Snapshot> = {},
): Snapshot {
  return {
    id,
    vmId: "vm-1",
    templateId: "template-1",
    label: `Snapshot ${id}`,
    summary: "Snapshot summary",
    providerRef: `snapshot-${id}`,
    stateful: false,
    resources: {
      cpu: 2,
      ramMb: 4096,
      diskGb: 40,
    },
    createdAt: "2026-03-29T10:00:00.000Z",
    ...overrides,
  };
}

function buildProvider(overrides: Partial<ProviderState> = {}): ProviderState {
  return {
    kind: "mock",
    available: true,
    detail: "Mock provider ready.",
    hostStatus: "ready",
    binaryPath: null,
    project: null,
    desktopTransport: "synthetic",
    nextSteps: [],
    ...overrides,
  };
}

function buildJob(
  id: string,
  overrides: Partial<ActionJob> = {},
): ActionJob {
  return {
    id,
    kind: "create",
    targetVmId: "vm-1",
    targetTemplateId: null,
    status: "queued",
    message: "Queued",
    progressPercent: null,
    createdAt: "2026-03-29T10:00:00.000Z",
    updatedAt: "2026-03-29T10:00:00.000Z",
    ...overrides,
  };
}

function buildSummary(
  overrides: Partial<DashboardSummary> = {},
): DashboardSummary {
  return {
    hostTelemetry: {
      cpuHistory: [],
      cpuPercent: null,
      ramHistory: [],
      ramPercent: null,
    },
    provider: buildProvider(),
    templates: [],
    vms: [],
    snapshots: [],
    jobs: [],
    metrics: {
      totalVmCount: 0,
      runningVmCount: 0,
      totalCpu: 0,
      hostCpuCount: 0,
      totalRamMb: 0,
      hostRamMb: 0,
      totalDiskGb: 0,
      hostDiskGb: 0,
    },
    generatedAt: "2026-03-29T10:00:00.000Z",
    ...overrides,
  };
}

function buildDetail(
  vm: VmInstance,
  overrides: Partial<VmDetail> = {},
): VmDetail {
  return {
    provider: buildProvider(),
    vm,
    template: buildTemplate(vm.templateId),
    snapshots: [],
    recentJobs: [],
    generatedAt: "2026-03-29T10:00:00.000Z",
    ...overrides,
  };
}
