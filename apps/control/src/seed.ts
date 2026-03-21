import {
  type AppState,
  type EnvironmentTemplate,
  type ProviderState,
  type Snapshot,
  type VmInstance,
} from "../../../packages/shared/src/types.js";

export function createSeedState(provider: ProviderState): AppState {
  const now = new Date().toISOString();

  const templates: EnvironmentTemplate[] = [
    {
      id: "tpl-0001",
      name: "Ubuntu Agent Forge",
      description:
        "Balanced Ubuntu desktop for coding agents, shell tasks, and browser-based reviews.",
      baseImage: "ubuntu-desktop-24.04",
      defaultResources: {
        cpu: 6,
        ramMb: 12288,
        diskGb: 80,
      },
      tags: ["coding", "agents", "ubuntu"],
      notes: [
        "GNOME desktop with terminal and editor workspace layout.",
        "Base image is intended for iterative snapshotting during development.",
      ],
      snapshotIds: ["snap-0001"],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "tpl-0002",
      name: "Research Bench",
      description:
        "Heavier desktop profile for docs, browser automation, and parallel review sessions.",
      baseImage: "ubuntu-desktop-24.04",
      defaultResources: {
        cpu: 10,
        ramMb: 24576,
        diskGb: 140,
      },
      tags: ["research", "browser", "analysis"],
      notes: [
        "Configured for large-browser workloads and long-running analysis tasks.",
      ],
      snapshotIds: ["snap-0002"],
      createdAt: now,
      updatedAt: now,
    },
  ];

  const vms: VmInstance[] = [
    {
      id: "vm-0001",
      name: "alpha-workbench",
      templateId: "tpl-0001",
      provider: provider.kind,
      status: "running",
      resources: {
        cpu: 8,
        ramMb: 16384,
        diskGb: 120,
      },
      createdAt: now,
      updatedAt: now,
      liveSince: now,
      lastAction: "Booted from Ubuntu Agent Forge",
      snapshotIds: ["snap-0003"],
      frameRevision: 1,
      screenSeed: 38,
      activeWindow: "editor",
      workspacePath: "/srv/workspaces/alpha-workbench",
      activityLog: [
        "boot: desktop session resumed",
        "workspace: /srv/workspaces/alpha-workbench",
        "agent: waiting for operator input",
      ],
    },
    {
      id: "vm-0002",
      name: "research-orbit",
      templateId: "tpl-0002",
      provider: provider.kind,
      status: "stopped",
      resources: {
        cpu: 12,
        ramMb: 32768,
        diskGb: 160,
      },
      createdAt: now,
      updatedAt: now,
      liveSince: null,
      lastAction: "Stopped after last review session",
      snapshotIds: [],
      frameRevision: 1,
      screenSeed: 212,
      activeWindow: "browser",
      workspacePath: "/srv/workspaces/research-orbit",
      activityLog: [
        "boot: session checkpoint saved",
        "browser: 16 tabs pinned for ongoing research",
      ],
    },
  ];

  const snapshots: Snapshot[] = [
    {
      id: "snap-0001",
      vmId: "seed-template-agent-forge",
      templateId: "tpl-0001",
      label: "Base agent forge image",
      summary: "Initial Ubuntu Agent Forge template snapshot.",
      providerRef: "seed://tpl-0001/base",
      resources: templates[0].defaultResources,
      createdAt: now,
    },
    {
      id: "snap-0002",
      vmId: "seed-template-research-bench",
      templateId: "tpl-0002",
      label: "Base research bench image",
      summary: "Initial Research Bench template snapshot.",
      providerRef: "seed://tpl-0002/base",
      resources: templates[1].defaultResources,
      createdAt: now,
    },
    {
      id: "snap-0003",
      vmId: "vm-0001",
      templateId: "tpl-0001",
      label: "alpha checkpoint",
      summary: "Saved state before opening the POC dashboard.",
      providerRef: "seed://vm-0001/checkpoint",
      resources: vms[0].resources,
      createdAt: now,
    },
  ];

  return {
    sequence: 4,
    provider,
    templates,
    vms,
    snapshots,
    jobs: [],
    lastUpdated: now,
  };
}
