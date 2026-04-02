import { slugify } from "../../../packages/shared/src/helpers.js";
import type {
  EnvironmentTemplate,
  ProviderState,
  ResourceSpec,
  Snapshot,
  VmDiskUsageSnapshot,
  VmFileBrowserSnapshot,
  VmInstance,
  VmLogsSnapshot,
  VmNetworkMode,
  VmSession,
  VmWindow,
} from "../../../packages/shared/src/types.js";
import {
  type CreateProviderOptions,
  DEFAULT_GUEST_INIT_LOG_PATH,
  VM_CREATE_ALLOCATION_START_PERCENT,
  SNAPSHOT_LAUNCH_COPY_START_PERCENT,
  TEMPLATE_PUBLISH_START_PERCENT,
  VM_CLONE_COPY_START_PERCENT,
  VM_CREATE_BOOT_START_PERCENT,
  VM_CREATE_READY_PERCENT,
  type CaptureTemplateProgressReporter,
  type CaptureTemplateTarget,
  type DesktopProvider,
  type ProviderCloneOptions,
  type ProviderMutation,
  type ProviderProgressReporter,
  type ProviderSnapshot,
  type ProviderSnapshotOptions,
  type ProviderTelemetrySample,
  type ProviderTick,
  type ProviderVmPowerState,
  type VmFileContent,
  type VmPreviewImage,
} from "./providers-contracts.js";
import {
  buildMockVmDiskUsageSnapshot,
  buildMockVmFileBrowserSnapshot,
  buildMockVmFileContent,
  buildMockVmTouchedFilesSnapshot,
} from "./providers-incus-inspection.js";
import { describeVmNetworkMode } from "./providers-incus-network.js";
import { buildCommandReply, sleep } from "./providers-incus-command.js";
import { renderSyntheticFrame } from "./providers-synthetic.js";
import {
  buildMockDesktopSession,
  type MockDesktopTransport,
} from "./mock-selkies.js";

export class MockProvider implements DesktopProvider {
  state: ProviderState;
  private readonly mockDesktopTransport: MockDesktopTransport;

  constructor(options: Pick<CreateProviderOptions, "mockDesktopTransport"> = {}) {
    this.mockDesktopTransport = options.mockDesktopTransport ?? "synthetic";
    this.state = buildMockProviderState(this.mockDesktopTransport);
  }

  refreshState(): ProviderState {
    return this.state;
  }

  sampleHostTelemetry(): ProviderTelemetrySample {
    const clock = Date.now() / 1000;
    return {
      cpuPercent: 28 + Math.sin(clock / 8) * 12,
      ramPercent: 44 + Math.cos(clock / 11) * 9,
    };
  }

  sampleVmTelemetry(vm: VmInstance): ProviderTelemetrySample {
    const clock = Date.now() / 1000;
    const seed = vm.screenSeed / 37;
    return {
      cpuPercent: 18 + ((Math.sin(clock / 5 + seed) + 1) * 28),
      ramPercent: 32 + ((Math.cos(clock / 7 + seed) + 1) * 18),
    };
  }

  observeVmPowerState(vm: VmInstance): ProviderVmPowerState | null {
    if (vm.status === "running" || vm.status === "paused" || vm.status === "stopped") {
      return {
        status: vm.status,
      };
    }

    return null;
  }

  async refreshVmSession(vm: VmInstance): Promise<VmSession> {
    return this.buildSession(vm.id);
  }

  async createVm(
    vm: VmInstance,
    template: EnvironmentTemplate,
    report?: ProviderProgressReporter,
  ): Promise<ProviderMutation> {
    report?.("Allocating workspace", VM_CREATE_ALLOCATION_START_PERCENT);
    await sleep(40);
    report?.("Starting workspace", VM_CREATE_BOOT_START_PERCENT);
    await sleep(40);
    report?.("Waiting for desktop", VM_CREATE_READY_PERCENT);

    return {
      lastAction: `Provisioned from ${template.name}`,
      activity: [
        `boot: ubuntu desktop launched from ${template.launchSource}`,
        `provider ref: ${vm.providerRef}`,
        `resources: ${vm.resources.cpu} CPU / ${vm.resources.ramMb} MB / ${vm.resources.diskGb} GB`,
        ...(template.initCommands.length > 0
          ? [
              `init: ${template.initCommands.length} first-boot command${template.initCommands.length === 1 ? "" : "s"} completed`,
              `init-log: ${DEFAULT_GUEST_INIT_LOG_PATH}`,
            ]
          : []),
        `network: ${describeVmNetworkMode(vm.networkMode)}`,
        `workspace: /srv/workspaces/${slugify(vm.name)}`,
      ],
      activeWindow: "editor",
      workspacePath: `/srv/workspaces/${slugify(vm.name)}`,
      session: this.buildSession(vm.id),
    };
  }

  async cloneVm(
    vm: VmInstance,
    targetVm: VmInstance,
    template: EnvironmentTemplate,
    report?: ProviderProgressReporter,
    options?: ProviderCloneOptions,
  ): Promise<ProviderMutation> {
    report?.("Cloning disks", VM_CLONE_COPY_START_PERCENT);
    await sleep(40);
    report?.("Starting workspace", VM_CREATE_BOOT_START_PERCENT);
    await sleep(40);
    report?.("Waiting for desktop", VM_CREATE_READY_PERCENT);

    return {
      lastAction: `Cloned from ${vm.name}`,
      activity: [
        `clone: copied disks and metadata from ${vm.name}`,
        ...(options?.stateful ? ["state: resumed source RAM from the running clone"] : []),
        `template: ${template.name}`,
        `network: ${describeVmNetworkMode(targetVm.networkMode)}`,
        `workspace: /srv/workspaces/${slugify(targetVm.name)}`,
      ],
      activeWindow: vm.activeWindow,
      workspacePath: `/srv/workspaces/${slugify(targetVm.name)}`,
      session: this.buildSession(targetVm.id),
    };
  }

  async startVm(vm: VmInstance): Promise<ProviderMutation> {
    return {
      lastAction: "Workspace resumed",
      activity: [
        "resume: desktop compositor restarted",
        "agent: session heartbeat restored",
      ],
      activeWindow: "terminal",
      session: this.buildSession(vm.id),
    };
  }

  async pauseVm(vm: VmInstance): Promise<ProviderMutation> {
    return {
      lastAction: "Workspace paused",
      activity: [
        "pause: VM memory checkpointed to disk",
        "session: desktop state frozen for resume",
      ],
      activeWindow: "logs",
      session: null,
    };
  }

  async stopVm(vm: VmInstance): Promise<ProviderMutation> {
    return {
      lastAction: "Workspace stopped",
      activity: [
        "stop: VM state checkpoint saved",
        "session: desktop marked inactive",
      ],
      activeWindow: "logs",
      session: this.buildSession(vm.id),
    };
  }

  async deleteVm(vm: VmInstance): Promise<ProviderMutation> {
    return {
      lastAction: `Workspace ${vm.name} deleted`,
      activity: ["delete: disks and metadata released"],
      activeWindow: "logs",
      session: null,
    };
  }

  async resizeVm(
    vm: VmInstance,
    resources: ResourceSpec,
  ): Promise<ProviderMutation> {
    return {
      lastAction: `Resources updated for ${vm.name}`,
      activity: [
        `limits: cpu=${resources.cpu} ram=${resources.ramMb}MB disk=${resources.diskGb}GB`,
      ],
      activeWindow: "logs",
      session: this.buildSession(vm.id),
    };
  }

  async setNetworkMode(
    vm: VmInstance,
    networkMode: VmNetworkMode,
  ): Promise<ProviderMutation> {
    return {
      lastAction: `Network mode updated for ${vm.name}`,
      activity: [`network: ${describeVmNetworkMode(networkMode)}`],
      activeWindow: "logs",
      session: vm.session ?? this.buildSession(vm.id),
    };
  }

  async syncVmHostname(vm: VmInstance): Promise<string | null> {
    void vm;
    return null;
  }

  async setDisplayResolution(
    vm: VmInstance,
    width: number,
    height: number,
  ): Promise<void> {
    void vm;
    void width;
    void height;
  }

  async snapshotVm(
    vm: VmInstance,
    label: string,
    options?: ProviderSnapshotOptions,
  ): Promise<ProviderSnapshot> {
    const stateful = options?.stateful === true;

    return {
      providerRef: `mock://snapshots/${slugify(vm.name)}-${slugify(label)}`,
      summary: stateful
        ? `Stateful snapshot ${label} captured from ${vm.name}.`
        : `Snapshot ${label} captured from ${vm.name}.`,
      stateful,
    };
  }

  async deleteVmSnapshot(vm: VmInstance, snapshot: Snapshot): Promise<void> {
    void vm;
    void snapshot;
  }

  async launchVmFromSnapshot(
    snapshot: Snapshot,
    targetVm: VmInstance,
    template: EnvironmentTemplate,
    report?: ProviderProgressReporter,
  ): Promise<ProviderMutation> {
    report?.("Cloning snapshot", SNAPSHOT_LAUNCH_COPY_START_PERCENT);
    await sleep(40);
    report?.("Starting workspace", VM_CREATE_BOOT_START_PERCENT);
    await sleep(40);
    report?.("Waiting for desktop", VM_CREATE_READY_PERCENT);

    return {
      lastAction: `Launched from snapshot ${snapshot.label}`,
      activity: [
        `snapshot launch: ${snapshot.label}`,
        `template: ${template.name}`,
        `workspace: /srv/workspaces/${slugify(targetVm.name)}`,
      ],
      activeWindow: "terminal",
      workspacePath: `/srv/workspaces/${slugify(targetVm.name)}`,
      session: this.buildSession(targetVm.id),
    };
  }

  async restoreVmToSnapshot(
    vm: VmInstance,
    snapshot: Snapshot,
  ): Promise<ProviderMutation> {
    return {
      lastAction: `Restored ${vm.name} to ${snapshot.label}`,
      activity: [
        `snapshot restore: ${snapshot.label}`,
        `workspace: ${vm.workspacePath}`,
      ],
      activeWindow: "terminal",
      workspacePath: vm.workspacePath,
      session: this.buildSession(vm.id),
    };
  }

  async captureTemplate(
    vm: VmInstance,
    target: CaptureTemplateTarget,
    report?: CaptureTemplateProgressReporter,
  ): Promise<ProviderSnapshot> {
    report?.("Publishing template image", TEMPLATE_PUBLISH_START_PERCENT);

    return {
      providerRef: `mock://snapshots/${target.templateId}`,
      summary: `Template ${target.name} captured from ${vm.name}.`,
      stateful: false,
      launchSource: `mock://templates/${slugify(target.name)}`,
    };
  }

  async injectCommand(
    vm: VmInstance,
    command: string,
  ): Promise<ProviderMutation> {
    const trimmed = command.trim();
    const reply = buildCommandReply(trimmed, vm.workspacePath);
    const nextWorkspacePath = reply.startsWith("cwd:")
      ? reply.replace("cwd: ", "")
      : vm.workspacePath;

    return {
      lastAction: `Executed: ${trimmed}`,
      activity: [`$ ${trimmed}`, reply],
      activeWindow: "terminal",
      workspacePath: nextWorkspacePath,
      session: this.buildSession(vm.id),
      commandResult: {
        command: trimmed,
        output: [reply],
        workspacePath: nextWorkspacePath,
      },
    };
  }

  async repairVmDesktopBridge(vm: VmInstance): Promise<ProviderMutation> {
    return {
      lastAction: "Desktop bridge repaired",
      activity: [
        "desktop-bridge: mock Selkies runtime reconciled",
        "session: mock desktop heartbeat restored",
      ],
      activeWindow: "logs",
      session: this.buildSession(vm.id),
      desktopReadyAt: new Date().toISOString(),
      desktopReadyMs: 0,
    };
  }

  async readVmLogs(vm: VmInstance): Promise<VmLogsSnapshot> {
    const commandSections = (vm.commandHistory ?? []).flatMap((entry) => [
      "",
      `$ ${entry.command}`,
      `cwd: ${entry.workspacePath}`,
      ...entry.output,
    ]);
    const content = [
      "provider: mock",
      `provider ref: ${vm.providerRef}`,
      `status: ${vm.status}`,
      `workspace: ${vm.workspacePath}`,
      "",
      "activity:",
      ...(vm.activityLog.length > 0 ? vm.activityLog : ["(no activity yet)"]),
      ...(commandSections.length > 0 ? ["", "commands:", ...commandSections] : []),
    ].join("\n");

    return {
      provider: "mock",
      providerRef: vm.providerRef,
      source: "mock activity log",
      content,
      fetchedAt: new Date().toISOString(),
    };
  }

  async readVmDiskUsage(vm: VmInstance): Promise<VmDiskUsageSnapshot> {
    return buildMockVmDiskUsageSnapshot(vm);
  }

  async browseVmFiles(
    vm: VmInstance,
    path?: string | null,
  ): Promise<VmFileBrowserSnapshot> {
    return buildMockVmFileBrowserSnapshot(vm, path);
  }

  async readVmFile(vm: VmInstance, path: string): Promise<VmFileContent> {
    return buildMockVmFileContent(vm, path);
  }

  async readVmTouchedFiles(vm: VmInstance): Promise<
    import("../../../packages/shared/src/types.js").VmTouchedFilesSnapshot
  > {
    return buildMockVmTouchedFilesSnapshot(vm);
  }

  async readVmPreviewImage(vm: VmInstance): Promise<VmPreviewImage> {
    return {
      content: Buffer.from(this.renderFrame(vm, null, "tile"), "utf8"),
      contentType: "image/svg+xml; charset=utf-8",
      generatedAt: new Date().toISOString(),
    };
  }

  tickVm(vm: VmInstance, template: EnvironmentTemplate): ProviderTick | null {
    if (vm.status !== "running") {
      return null;
    }

    const sequence = (vm.frameRevision + vm.screenSeed) % 8;

    const windows: VmWindow[] = ["editor", "terminal", "browser", "logs"];
    const activeWindow = windows[sequence % windows.length];
    const activity = selectActivityLine(activeWindow, template.name, vm.name, sequence);

    return {
      activeWindow,
      activity,
    };
  }

  renderFrame(
    vm: VmInstance,
    template: EnvironmentTemplate | null,
    mode: "tile" | "detail",
  ): string {
    return renderSyntheticFrame(vm, template, mode, this.state.detail);
  }

  private buildSession(vmId: string): VmSession {
    return buildMockDesktopSession(vmId, this.mockDesktopTransport);
  }
}

function buildMockProviderState(
  desktopTransport: MockDesktopTransport,
): ProviderState {
  return {
    kind: "mock",
    available: true,
    detail:
      desktopTransport === "selkies"
        ? "Demo mode is active. Actions update persisted state and mock Selkies browser sessions."
        : "Demo mode is active. Actions update persisted state and synthetic desktop frames.",
    hostStatus: "ready",
    binaryPath: null,
    project: null,
    desktopTransport: desktopTransport === "selkies" ? "novnc" : "synthetic",
    nextSteps: [],
  };
}

function selectActivityLine(
  window: VmWindow,
  templateName: string,
  vmName: string,
  sequence: number,
): string {
  const pools: Record<VmWindow, string[]> = {
    editor: [
      `editor: refining control-plane routes for ${vmName}`,
      `editor: updating template metadata derived from ${templateName}`,
      "editor: checkpointing UI changes before snapshot",
    ],
    terminal: [
      "terminal: pnpm build completed in 1.3s",
      "terminal: action worker heartbeat green",
      "terminal: no pending shell tasks",
    ],
    browser: [
      "browser: reviewing host resource telemetry",
      "browser: docs pinned for snapshot and clone flow",
      "browser: dashboard detail view refreshed",
    ],
    logs: [
      "logs: stream idle",
      "logs: background job queue healthy",
      "logs: provider heartbeat acknowledged",
    ],
  };

  const entries = pools[window];
  return entries[sequence % entries.length];
}
