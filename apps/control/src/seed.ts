import type {
  AppState,
  EnvironmentTemplate,
  ProviderState,
  Snapshot,
  VmInstance,
} from "../../../packages/shared/src/types.js";
import { buildDefaultWorkspaceProject } from "../../../packages/shared/src/helpers.js";
import {
  buildSeedTemplateRecord,
  buildSystemSeedTemplateDefinitions,
  DEFAULT_TEMPLATE_ID,
  type DefaultTemplateLaunchSourceOptions,
} from "./template-defaults.js";
import { buildMockDesktopSession } from "./mock-selkies.js";

export function createSeedState(
  provider: ProviderState,
  options: DefaultTemplateLaunchSourceOptions = {},
): AppState {
  const now = new Date().toISOString();
  const defaultProject = buildDefaultWorkspaceProject(now);
  const templates: EnvironmentTemplate[] = buildSystemSeedTemplateDefinitions(
    options.defaultTemplateLaunchSource,
  ).map((definition) =>
    buildSeedTemplateRecord(
      definition,
      now,
      provider.kind === "mock" && definition.id === DEFAULT_TEMPLATE_ID
        ? ["snap-0001"]
        : [],
    )
  );

  if (provider.kind === "incus") {
    return {
      sequence: 2,
      provider,
      projects: [defaultProject],
      templates,
      vms: [],
      snapshots: [],
      jobs: [],
      adminSessions: [],
      lastUpdated: now,
    };
  }

  const mockDesktopTransport =
    provider.desktopTransport === "synthetic" ? "synthetic" : "selkies";
  const syntheticSession = buildMockDesktopSession("vm-0001", mockDesktopTransport);

  const vms: VmInstance[] = [
    {
      id: "vm-0001",
      name: "alpha-workbench",
      projectId: defaultProject.id,
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
      lastAction: `Booted from ${templates[0]?.name ?? "Ubuntu Agent Forge"}`,
      snapshotIds: ["snap-0002"],
      frameRevision: 1,
      screenSeed: 38,
      activeWindow: "editor",
      workspacePath: "/srv/workspaces/alpha-workbench",
      desktopTransport: undefined,
      networkMode: "default",
      session: syntheticSession,
      desktopReadyAt: null,
      desktopReadyMs: null,
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
      templateId: DEFAULT_TEMPLATE_ID,
      label: "Base agent forge image",
      summary: `Initial ${templates[0]?.name ?? "Ubuntu Agent Forge"} template snapshot.`,
      providerRef: `seed://${DEFAULT_TEMPLATE_ID}/base`,
      stateful: false,
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
      stateful: false,
      resources: vms[0].resources,
      createdAt: now,
    },
  ];

  return {
    sequence: 3,
    provider,
    projects: [defaultProject],
    templates,
    vms,
    snapshots,
    jobs: [],
    adminSessions: [],
    lastUpdated: now,
  };
}
