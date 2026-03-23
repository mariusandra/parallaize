import {
  type AppState,
  type ProviderState,
  type Snapshot,
  type VmInstance,
  type VmSession,
} from "../../../packages/shared/src/types.js";
import { buildSeedTemplates } from "./template-catalog.js";

export function createSeedState(provider: ProviderState): AppState {
  const now = new Date().toISOString();
  const templates = buildSeedTemplates(provider.kind, now);

  if (provider.kind === "incus") {
    return {
      sequence: 3,
      provider,
      templates,
      vms: [],
      snapshots: [],
      jobs: [],
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
      snapshotIds: ["snap-0003"],
      frameRevision: 1,
      screenSeed: 38,
      activeWindow: "editor",
      workspacePath: "/srv/workspaces/alpha-workbench",
      session: syntheticSession,
      forwardedPorts: [],
      activityLog: [
        "boot: desktop session resumed",
        "workspace: /srv/workspaces/alpha-workbench",
        "agent: waiting for operator input",
      ],
      commandHistory: [],
    },
    {
      id: "vm-0002",
      name: "research-orbit",
      templateId: "tpl-0002",
      provider: provider.kind,
      providerRef: "research-orbit",
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
      session: syntheticSession,
      forwardedPorts: [],
      activityLog: [
        "boot: session checkpoint saved",
        "browser: 16 tabs pinned for ongoing research",
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
