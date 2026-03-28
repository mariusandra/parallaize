import {
  type AppState,
  type EnvironmentTemplate,
  type ProviderState,
  type Snapshot,
  type VmInstance,
  type VmSession,
} from "../../../packages/shared/src/types.js";
import {
  buildSeedTemplateSummary,
  type DefaultTemplateLaunchSourceOptions,
  resolveDefaultTemplateLaunchSource,
} from "./template-defaults.js";

export function createSeedState(
  provider: ProviderState,
  options: DefaultTemplateLaunchSourceOptions = {},
): AppState {
  const now = new Date().toISOString();
  const defaultLaunchSource = resolveDefaultTemplateLaunchSource(
    options.defaultTemplateLaunchSource,
  );

  const templates: EnvironmentTemplate[] = [
    {
      id: "tpl-0001",
      name: "Ubuntu Agent Forge",
      description:
        "Balanced Ubuntu desktop for coding agents, shell tasks, and browser-based reviews.",
      launchSource: defaultLaunchSource,
      defaultResources: {
        cpu: 6,
        ramMb: 12288,
        diskGb: 80,
      },
      defaultForwardedPorts: [],
      defaultNetworkMode: "default",
      initCommands: [],
      tags: ["coding", "agents", "ubuntu"],
      notes: [
        "GNOME desktop with terminal and editor workspace layout.",
        "Base image is intended for iterative snapshotting during development.",
      ],
      snapshotIds: provider.kind === "mock" ? ["snap-0001"] : [],
      provenance: {
        kind: "seed",
        summary: buildSeedTemplateSummary(defaultLaunchSource),
        sourceTemplateId: null,
        sourceTemplateName: null,
        sourceVmId: null,
        sourceVmName: null,
        sourceSnapshotId: null,
        sourceSnapshotLabel: null,
      },
      history: [
        {
          kind: "created",
          summary: buildSeedTemplateSummary(defaultLaunchSource),
          createdAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    },
  ];

  if (provider.kind === "incus") {
    return {
      sequence: 2,
      provider,
      templates,
      vms: [],
      snapshots: [],
      jobs: [],
      adminSessions: [],
      lastUpdated: now,
    };
  }

  const syntheticSession = createSyntheticSession();

  const vms: VmInstance[] = [
    {
      id: "vm-0001",
      name: "alpha-workbench",
      templateId: "tpl-0001",
      provider: provider.kind,
      providerRef: "alpha-workbench",
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
      snapshotIds: ["snap-0002"],
      frameRevision: 1,
      screenSeed: 38,
      activeWindow: "editor",
      workspacePath: "/srv/workspaces/alpha-workbench",
      networkMode: "default",
      session: syntheticSession,
      forwardedPorts: [],
      activityLog: [
        "boot: desktop session resumed",
        "workspace: /srv/workspaces/alpha-workbench",
        "agent: waiting for operator input",
      ],
      commandHistory: [],
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
    sequence: 3,
    provider,
    templates,
    vms,
    snapshots,
    jobs: [],
    adminSessions: [],
    lastUpdated: now,
  };
}

function createSyntheticSession(): VmSession {
  return {
    kind: "synthetic",
    host: null,
    port: null,
    webSocketPath: null,
    browserPath: null,
    display: "Synthetic frame stream",
  };
}
