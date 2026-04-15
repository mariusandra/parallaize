import assert from "node:assert/strict";
import test from "node:test";

import { createRef, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { DashboardSummary, WorkspaceProject, VmInstance } from "../packages/shared/src/types.js";
import { collectRunningWorkspaceUsage, DashboardWorkspaceRail } from "../apps/web/src/dashboardWorkspaceRail.js";

function buildVm(id: string, overrides: Partial<VmInstance> = {}): VmInstance {
  return {
    id,
    name: `vm-${id}`,
    templateId: "template-1",
    provider: "mock",
    providerRef: `mock://${id}`,
    status: "stopped",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 80,
    },
    createdAt: "2026-03-29T10:00:00.000Z",
    updatedAt: "2026-03-29T10:00:00.000Z",
    liveSince: null,
    lastAction: "Created",
    snapshotIds: [],
    frameRevision: 0,
    screenSeed: 1,
    activeWindow: "terminal",
    workspacePath: "/workspace",
    session: null,
    forwardedPorts: [],
    activityLog: [],
    ...overrides,
  };
}

test("collectRunningWorkspaceUsage only counts running VMs", () => {
  const usage = collectRunningWorkspaceUsage([
    buildVm("running-1", {
      status: "running",
      resources: {
        cpu: 16,
        ramMb: 65536,
        diskGb: 120,
      },
    }),
    buildVm("stopped-1", {
      status: "stopped",
      resources: {
        cpu: 48,
        ramMb: 131072,
        diskGb: 200,
      },
    }),
    buildVm("creating-1", {
      status: "creating",
      resources: {
        cpu: 8,
        ramMb: 16384,
        diskGb: 100,
      },
    }),
  ]);

  assert.deepEqual(usage, {
    cpu: 16,
    ramMb: 65536,
  });
});

function buildProject(overrides: Partial<WorkspaceProject> = {}): WorkspaceProject {
  return {
    id: "project-1",
    name: "Client Alpha",
    githubUrl: "",
    status: "active",
    createdAt: "2026-03-29T10:00:00.000Z",
    updatedAt: "2026-03-29T10:00:00.000Z",
    ...overrides,
  };
}

function buildSummary(projects: WorkspaceProject[], vms: VmInstance[]): DashboardSummary {
  return {
    hostTelemetry: {
      cpuHistory: [],
      cpuPercent: null,
      ramHistory: [],
      ramPercent: null,
    },
    provider: {
      kind: "mock",
      available: true,
      detail: "ready",
      hostStatus: "ready",
      binaryPath: null,
      project: null,
      desktopTransport: "synthetic",
      nextSteps: [],
    },
    projects,
    templates: [],
    vms,
    snapshots: [],
    jobs: [],
    metrics: {
      totalVmCount: vms.length,
      runningVmCount: vms.filter((vm) => vm.status === "running").length,
      totalCpu: 0,
      hostCpuCount: 16,
      totalRamMb: 0,
      hostRamMb: 32768,
      totalDiskGb: 0,
      hostDiskGb: 512,
    },
    generatedAt: "2026-03-29T10:00:00.000Z",
  };
}

function renderWorkspaceRail(
  projects: WorkspaceProject[],
  vms: VmInstance[],
  overrides: Partial<Parameters<typeof DashboardWorkspaceRail>[0]> = {},
): string {
  return renderToStaticMarkup(
    createElement(DashboardWorkspaceRail, {
      summary: buildSummary(projects, vms),
      appVersionLabel: "v0.0.1",
      authEnabled: false,
      collapsedProjects: {},
      compactRail: false,
      draggedVmId: null,
      effectiveSidePanelCollapsed: false,
      fullscreenActive: false,
      isBusy: false,
      latestReleaseHref: null,
      newerReleaseAvailable: false,
      openProjectMenuId: null,
      openVmMenuId: null,
      railRef: createRef<HTMLElement>(),
      railResizeActive: false,
      railWidth: 320,
      releaseIndicatorSeverity: null,
      renderedVms: vms,
      selectedVmId: null,
      shellMenuButtonRef: createRef<HTMLButtonElement>(),
      shellMenuOpen: false,
      showLivePreviews: false,
      supportsLiveDesktop: false,
      themeMode: "dark",
      wideShellLayout: true,
      onClone: async () => {},
      onDelete: async () => {},
      onHideInspector: () => {},
      onLogout: () => {},
      onOpenCreateDialog: () => {},
      onOpenCreateProjectDialog: () => {},
      onEditProject: () => {},
      onOpenHomepage: () => {},
      onOpenLogs: () => {},
      onPasteLocal: () => {},
      onInspectVm: () => {},
      onProjectAction: async () => {},
      onProjectDragOver: () => {},
      onProjectDrop: () => {},
      onProjectVmListDragOver: () => {},
      onProjectVmListDrop: () => {},
      onProjectMenuToggle: () => {},
      onRename: async () => {},
      onResizeKeyDown: () => {},
      onResizePointerDown: () => {},
      onToggleCompactRail: () => {},
      onToggleProjectCollapsed: () => {},
      onSelectVm: () => {},
      onSetActiveCpuThreshold: () => {},
      onSnapshot: async () => {},
      onToggleFullscreen: () => {},
      onToggleLivePreviews: () => {},
      onToggleShellMenu: () => {},
      onCloseShellMenu: () => {},
      onToggleTheme: () => {},
      onVmMenuToggle: () => {},
      onPowerAction: async () => {},
      onVmTileDragEnd: () => {},
      onVmTileDragOver: () => {},
      onVmTileDragStart: () => {},
      onVmTileDrop: () => {},
      onVmStripDragOver: () => {},
      onVmStripDrop: () => {},
      resolveActiveCpuThreshold: () => 0,
      resolveMirroredStageFrameRef: () => null,
      ...overrides,
    }),
  );
}

test("DashboardWorkspaceRail shows plain project counts instead of a VMs pill label", () => {
  const project = buildProject();
  const html = renderWorkspaceRail(
    [project],
    [
      buildVm("running-1", { projectId: project.id, status: "running" }),
      buildVm("stopped-1", { projectId: project.id, status: "stopped" }),
    ],
  );

  assert.match(html, /\(1\/2\)/);
  assert.doesNotMatch(html, /VMs \(1\/2\)/);
});

test("DashboardWorkspaceRail only shows a prominent New VM action for empty projects", () => {
  const project = buildProject();

  const populatedHtml = renderWorkspaceRail(
    [project],
    [buildVm("running-1", { projectId: project.id, status: "running" })],
  );
  const emptyHtml = renderWorkspaceRail([project], []);

  assert.doesNotMatch(populatedHtml, />New VM<\/button>/);
  assert.match(emptyHtml, /No VMs in Client Alpha/);
  assert.match(emptyHtml, /<button[^>]*>New VM<\/button>/);
});
