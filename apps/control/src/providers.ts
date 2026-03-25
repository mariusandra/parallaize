import { spawn, spawnSync } from "node:child_process";
import { connect as connectTcp } from "node:net";
import { cpus, freemem, loadavg, totalmem } from "node:os";

import { slugify } from "../../../packages/shared/src/helpers.js";
import type {
  EnvironmentTemplate,
  ProviderKind,
  ProviderState,
  ResourceSpec,
  Snapshot,
  VmInstance,
  VmSession,
  VmWindow,
} from "../../../packages/shared/src/types.js";

const DEFAULT_GUEST_VNC_PORT = 5900;
const DEFAULT_GUEST_INOTIFY_MAX_USER_WATCHES = 1_048_576;
const DEFAULT_GUEST_INOTIFY_MAX_USER_INSTANCES = 2_048;
const DEFAULT_GUEST_WORKSPACE = "/root";
const DEFAULT_VM_CREATE_HEARTBEAT_MS = 4000;
const VM_CREATE_ALLOCATION_START_PERCENT = 18;
const VM_CREATE_ALLOCATION_COMPLETE_PERCENT = 58;
const VM_CREATE_CONFIGURE_PERCENT = 64;
const VM_CREATE_GUEST_AGENT_PERCENT = 70;
const VM_CREATE_BOOT_START_PERCENT = 76;
const VM_CREATE_DESKTOP_WAIT_START_PERCENT = 84;
const VM_CREATE_READY_PERCENT = 96;
const DEFAULT_TEMPLATE_PUBLISH_HEARTBEAT_MS = 4000;
const TEMPLATE_PUBLISH_START_PERCENT = 58;
const TEMPLATE_PUBLISH_EXPORT_COMPLETE_PERCENT = 78;
const TEMPLATE_PUBLISH_COMPLETE_PERCENT = 92;
const BYTES_PER_GIB = 1024 ** 3;
const INCUS_PROBE_TIMEOUT_MS = 1_000;
const HOST_NETWORK_PROBE_CACHE_MS = 60_000;
const HOST_NETWORK_PROBE_TIMEOUT_MS = 2_500;

export interface CaptureTemplateTarget {
  templateId: string;
  name: string;
}

export interface CreateProviderOptions {
  project?: string;
  storagePool?: string;
  guestVncPort?: number;
  guestInotifyMaxUserWatches?: number;
  guestInotifyMaxUserInstances?: number;
  commandRunner?: IncusCommandRunner;
  guestPortProbe?: GuestPortProbe;
  hostNetworkProbe?: HostNetworkProbe;
  templatePublishHeartbeatMs?: number;
  templateCompression?: IncusImageCompression;
}

export type CaptureTemplateProgressReporter = (
  message: string,
  progressPercent: number | null,
) => void;

export type ProviderProgressReporter = (
  message: string,
  progressPercent: number | null,
) => void;

export type IncusImageCompression =
  | "bzip2"
  | "gzip"
  | "lz4"
  | "lzma"
  | "xz"
  | "zstd"
  | "none";

export interface DesktopProvider {
  state: ProviderState;
  refreshState(): ProviderState;
  sampleHostTelemetry(): ProviderTelemetrySample | null;
  sampleVmTelemetry(vm: VmInstance): ProviderTelemetrySample | null;
  observeVmPowerState(vm: VmInstance): ProviderVmPowerState | null;
  refreshVmSession(vm: VmInstance): Promise<VmSession | null>;
  createVm(
    vm: VmInstance,
    template: EnvironmentTemplate,
    report?: ProviderProgressReporter,
  ): Promise<ProviderMutation>;
  cloneVm(
    sourceVm: VmInstance,
    targetVm: VmInstance,
    template: EnvironmentTemplate,
  ): Promise<ProviderMutation>;
  startVm(vm: VmInstance): Promise<ProviderMutation>;
  stopVm(vm: VmInstance): Promise<ProviderMutation>;
  deleteVm(vm: VmInstance): Promise<ProviderMutation>;
  resizeVm(vm: VmInstance, resources: ResourceSpec): Promise<ProviderMutation>;
  setDisplayResolution(vm: VmInstance, width: number, height: number): Promise<void>;
  snapshotVm(vm: VmInstance, label: string): Promise<ProviderSnapshot>;
  launchVmFromSnapshot(
    snapshot: Snapshot,
    targetVm: VmInstance,
    template: EnvironmentTemplate,
  ): Promise<ProviderMutation>;
  restoreVmToSnapshot(
    vm: VmInstance,
    snapshot: Snapshot,
  ): Promise<ProviderMutation>;
  captureTemplate(
    vm: VmInstance,
    target: CaptureTemplateTarget,
    report?: CaptureTemplateProgressReporter,
  ): Promise<ProviderSnapshot>;
  injectCommand(vm: VmInstance, command: string): Promise<ProviderMutation>;
  tickVm(vm: VmInstance, template: EnvironmentTemplate): ProviderTick | null;
  renderFrame(
    vm: VmInstance,
    template: EnvironmentTemplate | null,
    mode: "tile" | "detail",
  ): string;
}

export interface ProviderMutation {
  lastAction: string;
  activity: string[];
  activeWindow?: VmWindow;
  workspacePath?: string;
  session?: VmSession | null;
  commandResult?: ProviderCommandResult;
}

export interface ProviderSnapshot {
  providerRef: string;
  summary: string;
  launchSource?: string;
}

export interface ProviderTick {
  activity?: string;
  activeWindow?: VmWindow;
}

interface ProviderCommandResult {
  command: string;
  output: string[];
  workspacePath: string;
}

export interface ProviderTelemetrySample {
  cpuPercent: number | null;
  ramPercent: number | null;
}

export interface ProviderVmPowerState {
  status: "running" | "stopped";
}

interface IncusCommandRunner {
  execute(args: string[], options?: CommandExecutionOptions): CommandResult;
  executeStreaming?(
    args: string[],
    listeners?: CommandStreamListeners,
  ): Promise<CommandResult>;
}

interface CommandResult {
  args: string[];
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

interface CommandExecutionOptions {
  timeoutMs?: number;
}

interface CommandStreamListeners {
  onStdout?(chunk: string): void;
  onStderr?(chunk: string): void;
}

interface GuestPortProbe {
  probe(host: string, port: number): Promise<boolean>;
}

interface HostNetworkProbe {
  probe(): HostNetworkDiagnostic;
}

interface HostNetworkDiagnostic {
  status: "ready" | "unreachable" | "unknown";
  detail: string | null;
  nextSteps: string[];
}

interface IncusListInstance {
  name?: string;
  status?: string;
  devices?: Record<string, IncusInstanceDevice>;
  expanded_devices?: Record<string, IncusInstanceDevice>;
  state?: {
    status?: string;
    network?: Record<
      string,
      {
        host_name?: string;
        type?: string;
        addresses?: Array<{
          family?: string;
          address?: string;
          scope?: string;
        }>;
      }
    >;
    memory?: {
      usage?: number;
      total?: number;
    };
    cpu?: {
      usage?: number;
      allocated_time?: number;
    };
  };
}

interface IncusInstanceDevice {
  path?: string;
  pool?: string;
  source?: string;
  type?: string;
}

interface IncusOperationProgressMetadata {
  percent?: string;
  processed?: string;
  speed?: string;
  stage?: string;
}

interface IncusOperation {
  id?: string;
  created_at?: string;
  metadata?: {
    create_image_from_container_pack_progress?: string;
    progress?: IncusOperationProgressMetadata;
  };
}

interface IncusOperationListResponse {
  running?: IncusOperation[];
}

type TemplatePublishProgressSample =
  | {
      kind: "export";
      percent: number;
      detail: string;
    }
  | {
      kind: "pack";
      processedBytes: number;
      speedBytesPerSecond: number | null;
      detail: string;
    };

export function createProvider(
  kind: ProviderKind,
  incusBinary: string,
  options: CreateProviderOptions = {},
): DesktopProvider {
  if (kind === "incus") {
    return new IncusProvider(incusBinary, options);
  }

  return new MockProvider();
}

class MockProvider implements DesktopProvider {
  state: ProviderState = buildMockProviderState();

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
    if (vm.status === "running" || vm.status === "stopped") {
      return {
        status: vm.status,
      };
    }

    return null;
  }

  async refreshVmSession(): Promise<VmSession> {
    return buildSyntheticSession();
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
        `workspace: /srv/workspaces/${slugify(vm.name)}`,
      ],
      activeWindow: "editor",
      workspacePath: `/srv/workspaces/${slugify(vm.name)}`,
      session: buildSyntheticSession(),
    };
  }

  async cloneVm(
    vm: VmInstance,
    targetVm: VmInstance,
    template: EnvironmentTemplate,
  ): Promise<ProviderMutation> {
    return {
      lastAction: `Cloned from ${vm.name}`,
      activity: [
        `clone: copied disks and metadata from ${vm.name}`,
        `template: ${template.name}`,
        `workspace: /srv/workspaces/${slugify(targetVm.name)}`,
      ],
      activeWindow: vm.activeWindow,
      workspacePath: `/srv/workspaces/${slugify(targetVm.name)}`,
      session: buildSyntheticSession(),
    };
  }

  async startVm(): Promise<ProviderMutation> {
    return {
      lastAction: "Workspace resumed",
      activity: [
        "resume: desktop compositor restarted",
        "agent: session heartbeat restored",
      ],
      activeWindow: "terminal",
      session: buildSyntheticSession(),
    };
  }

  async stopVm(): Promise<ProviderMutation> {
    return {
      lastAction: "Workspace stopped",
      activity: [
        "stop: VM state checkpoint saved",
        "session: desktop marked inactive",
      ],
      activeWindow: "logs",
      session: buildSyntheticSession(),
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
      session: buildSyntheticSession(),
    };
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

  async snapshotVm(vm: VmInstance, label: string): Promise<ProviderSnapshot> {
    return {
      providerRef: `mock://snapshots/${slugify(vm.name)}-${slugify(label)}`,
      summary: `Snapshot ${label} captured from ${vm.name}.`,
    };
  }

  async launchVmFromSnapshot(
    snapshot: Snapshot,
    targetVm: VmInstance,
    template: EnvironmentTemplate,
  ): Promise<ProviderMutation> {
    return {
      lastAction: `Launched from snapshot ${snapshot.label}`,
      activity: [
        `snapshot launch: ${snapshot.label}`,
        `template: ${template.name}`,
        `workspace: /srv/workspaces/${slugify(targetVm.name)}`,
      ],
      activeWindow: "terminal",
      workspacePath: `/srv/workspaces/${slugify(targetVm.name)}`,
      session: buildSyntheticSession(),
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
      session: buildSyntheticSession(),
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
      session: buildSyntheticSession(),
      commandResult: {
        command: trimmed,
        output: [reply],
        workspacePath: nextWorkspacePath,
      },
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
}

class IncusProvider implements DesktopProvider {
  state: ProviderState;
  private readonly guestVncPort: number;
  private readonly guestInotifyMaxUserWatches: number;
  private readonly guestInotifyMaxUserInstances: number;
  private readonly runner: IncusCommandRunner;
  private readonly project: string | null;
  private readonly storagePool: string | null;
  private readonly guestPortProbe: GuestPortProbe;
  private readonly hostNetworkProbe: HostNetworkProbe;
  private readonly templatePublishHeartbeatMs: number;
  private readonly templateCompression: IncusImageCompression | null;
  private telemetrySnapshotAt = 0;
  private telemetryInstances = new Map<string, IncusListInstance>();
  private readonly vmCpuUsage = new Map<string, { capturedAt: number; usage: number }>();
  private hostNetworkDiagnosticAt = 0;
  private hostNetworkDiagnostic: HostNetworkDiagnostic = {
    status: "unknown",
    detail: null,
    nextSteps: [],
  };

  constructor(
    private readonly incusBinary: string,
    options: CreateProviderOptions,
  ) {
    this.guestVncPort = options.guestVncPort ?? DEFAULT_GUEST_VNC_PORT;
    this.guestInotifyMaxUserWatches =
      options.guestInotifyMaxUserWatches ?? DEFAULT_GUEST_INOTIFY_MAX_USER_WATCHES;
    this.guestInotifyMaxUserInstances =
      options.guestInotifyMaxUserInstances ?? DEFAULT_GUEST_INOTIFY_MAX_USER_INSTANCES;
    this.project = options.project ?? null;
    this.storagePool = options.storagePool ?? null;
    this.runner =
      options.commandRunner ??
      new SpawnIncusCommandRunner(this.incusBinary, options.project);
    this.guestPortProbe = options.guestPortProbe ?? new TcpGuestPortProbe();
    this.hostNetworkProbe =
      options.hostNetworkProbe ??
      (options.commandRunner ? new NoopHostNetworkProbe() : new ShellHostNetworkProbe());
    this.templatePublishHeartbeatMs = Math.max(
      options.templatePublishHeartbeatMs ?? DEFAULT_TEMPLATE_PUBLISH_HEARTBEAT_MS,
      50,
    );
    this.templateCompression = options.templateCompression ?? null;
    this.state = this.probeState();
  }

  refreshState(): ProviderState {
    this.state = this.probeState();
    return this.state;
  }

  sampleHostTelemetry(): ProviderTelemetrySample {
    const cpuCount = Math.max(cpus().length, 1);
    const normalizedLoad = (loadavg()[0] / cpuCount) * 100;
    const memoryPercent = ((totalmem() - freemem()) / totalmem()) * 100;

    return {
      cpuPercent: normalizedLoad,
      ramPercent: memoryPercent,
    };
  }

  sampleVmTelemetry(vm: VmInstance): ProviderTelemetrySample | null {
    try {
      const info = this.getTelemetryInstanceInfo(vm.providerRef);

      if (!info || normalizeStatus(info.status ?? info.state?.status) !== "running") {
        this.vmCpuUsage.delete(vm.providerRef);
        return null;
      }

      const ramUsageBytes = info.state?.memory?.usage ?? null;
      const ramPercent =
        ramUsageBytes === null
          ? null
          : (ramUsageBytes / (Math.max(vm.resources.ramMb, 1) * 1024 * 1024)) * 100;
      const cpuUsage = info.state?.cpu?.usage;
      const capturedAt = Date.now();
      let cpuPercent: number | null = null;

      if (typeof cpuUsage === "number") {
        const previous = this.vmCpuUsage.get(vm.providerRef);

        if (previous && capturedAt > previous.capturedAt) {
          const elapsedNs = (capturedAt - previous.capturedAt) * 1_000_000;
          cpuPercent = ((cpuUsage - previous.usage) / elapsedNs / Math.max(vm.resources.cpu, 1)) * 100;
        }

        this.vmCpuUsage.set(vm.providerRef, {
          capturedAt,
          usage: cpuUsage,
        });
      }

      return {
        cpuPercent,
        ramPercent,
      };
    } catch {
      return null;
    }
  }

  observeVmPowerState(vm: VmInstance): ProviderVmPowerState | null {
    if (!this.state.available) {
      return null;
    }

    try {
      const info = this.getTelemetryInstanceInfo(vm.providerRef);

      if (!info) {
        return null;
      }

      const status = normalizeStatus(info.status ?? info.state?.status);

      if (status === "running" || status === "stopped") {
        return {
          status,
        };
      }
    } catch {
      return null;
    }

    return null;
  }

  async refreshVmSession(vm: VmInstance): Promise<VmSession | null> {
    if (!this.state.available || vm.status !== "running") {
      return null;
    }

    const info = await this.inspectInstanceAsync(vm.providerRef);

    if (normalizeStatus(info.status ?? info.state?.status) !== "running") {
      return null;
    }

    return this.probeReachableSession(info);
  }

  async createVm(
    vm: VmInstance,
    template: EnvironmentTemplate,
    report?: ProviderProgressReporter,
  ): Promise<ProviderMutation> {
    this.assertAvailable();
    this.assertLaunchSource(template);

    const initArgs = [
      "init",
      template.launchSource,
      vm.providerRef,
      "--vm",
    ];

    if (this.storagePool) {
      initArgs.push("-s", this.storagePool);
    }

    initArgs.push(
      "-c",
      `limits.cpu=${vm.resources.cpu}`,
      "-c",
      `limits.memory=${formatMemoryLimit(vm.resources.ramMb)}`,
    );

    const emitCreateProgress = buildProgressEmitter(report);
    const allocationStartedAt = Date.now();
    let sawAllocationSample = false;
    const allocationHeartbeat = setInterval(() => {
      if (sawAllocationSample) {
        return;
      }

      emitCreateProgress(
        "Allocating workspace",
        estimateVmCreateAllocationProgress(allocationStartedAt, vm.resources.diskGb),
      );
    }, DEFAULT_VM_CREATE_HEARTBEAT_MS);

    emitCreateProgress("Allocating workspace", VM_CREATE_ALLOCATION_START_PERCENT);

    const handleCreateStreamChunk = (chunk: string) => {
      const sample = parseVmCreateProgressChunk(chunk);

      if (!sample) {
        return;
      }

      if (sample.percent !== null) {
        sawAllocationSample = true;
      }

      emitCreateProgress(
        sample.detail ? `Allocating workspace (${sample.detail})` : "Allocating workspace",
        sample.percent === null
          ? estimateVmCreateAllocationProgress(allocationStartedAt, vm.resources.diskGb)
          : mapPercentToRange(
              sample.percent,
              VM_CREATE_ALLOCATION_START_PERCENT,
              VM_CREATE_ALLOCATION_COMPLETE_PERCENT,
            ),
      );
    };

    try {
      await this.runAsync(initArgs, {
        onStdout: handleCreateStreamChunk,
        onStderr: handleCreateStreamChunk,
      });
    } finally {
      clearInterval(allocationHeartbeat);
    }

    await this.setRootDiskSizeAsync(vm.providerRef, vm.resources.diskGb);
    emitCreateProgress("Configuring guest", VM_CREATE_CONFIGURE_PERCENT);
    await this.runAsync([
      "config",
      "set",
      vm.providerRef,
      "cloud-init.user-data",
      buildGuestVncCloudInit(this.guestVncPort, {
        maxUserWatches: this.guestInotifyMaxUserWatches,
        maxUserInstances: this.guestInotifyMaxUserInstances,
      }),
    ]);
    emitCreateProgress("Preparing guest agent", VM_CREATE_GUEST_AGENT_PERCENT);
    await this.ensureAgentDeviceAsync(vm.providerRef);
    emitCreateProgress("Starting workspace", VM_CREATE_BOOT_START_PERCENT);
    await this.runAsync(["start", vm.providerRef]);

    const session = await this.resolveSession(vm.providerRef, emitCreateProgress);

    return {
      lastAction: `Provisioned from ${template.name}`,
      activity: [
        `incus: launched ${vm.providerRef} from ${template.launchSource}`,
        `resources: ${vm.resources.cpu} CPU / ${formatMemoryLimit(vm.resources.ramMb)} / ${formatDiskSize(vm.resources.diskGb)}`,
        session ? `vnc: ${session.display}` : "vnc: guest network pending",
      ],
      activeWindow: "terminal",
      workspacePath: DEFAULT_GUEST_WORKSPACE,
      session,
    };
  }

  async cloneVm(
    sourceVm: VmInstance,
    targetVm: VmInstance,
    template: EnvironmentTemplate,
  ): Promise<ProviderMutation> {
    this.assertAvailable();

    const copyArgs = [
      "copy",
      sourceVm.providerRef,
      targetVm.providerRef,
      "--instance-only",
    ];

    if (this.storagePool) {
      copyArgs.push("-s", this.storagePool);
    }

    copyArgs.push(
      "-c",
      `limits.cpu=${targetVm.resources.cpu}`,
      "-c",
      `limits.memory=${formatMemoryLimit(targetVm.resources.ramMb)}`,
    );

    await this.runAsync(copyArgs);
    await this.setRootDiskSizeAsync(targetVm.providerRef, targetVm.resources.diskGb);
    await this.ensureAgentDeviceAsync(targetVm.providerRef);
    await this.runAsync(["start", targetVm.providerRef]);

    const session = await this.resolveSession(targetVm.providerRef);

    return {
      lastAction: `Cloned from ${sourceVm.name}`,
      activity: [
        `incus: cloned ${sourceVm.providerRef} to ${targetVm.providerRef}`,
        `template: ${template.name}`,
        session ? `vnc: ${session.display}` : "vnc: guest network pending",
      ],
      activeWindow: "terminal",
      workspacePath: sourceVm.workspacePath || DEFAULT_GUEST_WORKSPACE,
      session,
    };
  }

  async startVm(vm: VmInstance): Promise<ProviderMutation> {
    this.assertAvailable();
    await this.ensureAgentDeviceAsync(vm.providerRef);
    const startArgs = ["start", vm.providerRef];
    const startResult = await this.executeAsync(startArgs);

    if (startResult.status !== 0) {
      const failure = formatCommandFailure(startArgs, startResult);

      if (!isAlreadyRunningFailure(failure)) {
        throw new Error(failure);
      }
    }

    const session = await this.resolveSession(vm.providerRef);

    return {
      lastAction: "Workspace resumed",
      activity: [
        `incus: started ${vm.providerRef}`,
        session ? `vnc: ${session.display}` : "vnc: guest network pending",
      ],
      activeWindow: "terminal",
      workspacePath: vm.workspacePath || DEFAULT_GUEST_WORKSPACE,
      session,
    };
  }

  async stopVm(vm: VmInstance): Promise<ProviderMutation> {
    this.assertAvailable();
    await this.stopInstanceAsync(vm.providerRef);

    return {
      lastAction: "Workspace stopped",
      activity: [`incus: stopped ${vm.providerRef}`],
      activeWindow: "logs",
      session: null,
    };
  }

  async deleteVm(vm: VmInstance): Promise<ProviderMutation> {
    this.assertAvailable();
    const deleteArgs = ["delete", vm.providerRef, "--force"];
    const deleteResult = await this.executeAsync(deleteArgs);

    if (deleteResult.status !== 0) {
      const failure = formatCommandFailure(deleteArgs, deleteResult);

      if (!isMissingInstanceFailure(failure)) {
        throw new Error(failure);
      }
    }

    return {
      lastAction: `Workspace ${vm.name} deleted`,
      activity: [`incus: deleted ${vm.providerRef}`],
      activeWindow: "logs",
      session: null,
    };
  }

  async resizeVm(
    vm: VmInstance,
    resources: ResourceSpec,
  ): Promise<ProviderMutation> {
    this.assertAvailable();
    const changedLimitArgs: string[] = [];
    const changedResources: string[] = [];

    if (resources.cpu !== vm.resources.cpu) {
      changedLimitArgs.push(`limits.cpu=${resources.cpu}`);
      changedResources.push(`cpu=${resources.cpu}`);
    }

    if (resources.ramMb !== vm.resources.ramMb) {
      const nextMemoryLimit = formatMemoryLimit(resources.ramMb);
      changedLimitArgs.push(`limits.memory=${nextMemoryLimit}`);
      changedResources.push(`ram=${nextMemoryLimit}`);
    }

    if (changedLimitArgs.length > 0) {
      await this.runAsync(["config", "set", vm.providerRef, ...changedLimitArgs]);
    }

    if (resources.diskGb !== vm.resources.diskGb) {
      const nextDiskSize = formatDiskSize(resources.diskGb);
      await this.setRootDiskSizeAsync(vm.providerRef, resources.diskGb);
      changedResources.push(`disk=${nextDiskSize}`);
    }

    if (changedResources.length === 0) {
      return {
        lastAction: `Resources already matched ${vm.name}`,
        activity: [`incus: resource resize skipped for ${vm.providerRef}`],
        activeWindow: "logs",
        session: vm.session,
      };
    }

    return {
      lastAction: `Resources updated for ${vm.name}`,
      activity: [
        `incus: resized ${vm.providerRef}`,
        `limits: ${changedResources.join(" ")}`,
      ],
      activeWindow: "logs",
      // Resource limit changes do not require a fresh VNC probe. Preserve the
      // current desktop session instead of blocking the job on port polling.
      session: vm.session,
    };
  }

  async setDisplayResolution(
    vm: VmInstance,
    width: number,
    height: number,
  ): Promise<void> {
    this.assertAvailable();
    validateDisplayResolution(width, height);

    await this.runAsync([
      "exec",
      vm.providerRef,
      "--",
      "sh",
      "-lc",
      buildSetDisplayResolutionScript(width, height, this.guestVncPort),
    ]);
  }

  async snapshotVm(vm: VmInstance, label: string): Promise<ProviderSnapshot> {
    this.assertAvailable();
    const snapshotName = buildSnapshotName(label);

    await this.runAsync(["snapshot", "create", vm.providerRef, snapshotName]);

    return {
      providerRef: `${vm.providerRef}/${snapshotName}`,
      summary: `Snapshot ${label} captured from ${vm.name}.`,
    };
  }

  async launchVmFromSnapshot(
    snapshot: Snapshot,
    targetVm: VmInstance,
    template: EnvironmentTemplate,
  ): Promise<ProviderMutation> {
    this.assertAvailable();
    this.assertLaunchSource(template);

    const copyArgs = [
      "copy",
      snapshot.providerRef,
      targetVm.providerRef,
    ];

    if (this.storagePool) {
      copyArgs.push("-s", this.storagePool);
    }

    copyArgs.push(
      "-c",
      `limits.cpu=${targetVm.resources.cpu}`,
      "-c",
      `limits.memory=${formatMemoryLimit(targetVm.resources.ramMb)}`,
    );

    await this.runAsync(copyArgs);
    await this.setRootDiskSizeAsync(targetVm.providerRef, targetVm.resources.diskGb);
    await this.ensureAgentDeviceAsync(targetVm.providerRef);
    await this.runAsync(["start", targetVm.providerRef]);

    const session = await this.resolveSession(targetVm.providerRef);

    return {
      lastAction: `Launched from snapshot ${snapshot.label}`,
      activity: [
        `incus: launched ${targetVm.providerRef} from ${snapshot.providerRef}`,
        `template: ${template.name}`,
        session ? `vnc: ${session.display}` : "vnc: guest network pending",
      ],
      activeWindow: "terminal",
      workspacePath: DEFAULT_GUEST_WORKSPACE,
      session,
    };
  }

  async restoreVmToSnapshot(
    vm: VmInstance,
    snapshot: Snapshot,
  ): Promise<ProviderMutation> {
    this.assertAvailable();

    const snapshotName = parseSnapshotName(snapshot.providerRef, vm.providerRef);
    const wasRunning = vm.status === "running";

    if (wasRunning) {
      await this.stopInstanceAsync(vm.providerRef);
    }

    await this.runAsync(["snapshot", "restore", vm.providerRef, snapshotName]);
    await this.ensureAgentDeviceAsync(vm.providerRef);

    let session: VmSession | null = null;

    if (wasRunning) {
      await this.runAsync(["start", vm.providerRef]);
      session = await this.resolveSession(vm.providerRef);
    }

    return {
      lastAction: `Restored ${vm.name} to ${snapshot.label}`,
      activity: [
        `incus: restored ${vm.providerRef} to ${snapshotName}`,
        wasRunning
          ? session
            ? `vnc: ${session.display}`
            : "vnc: guest network pending"
          : "workspace remains stopped after restore",
      ],
      activeWindow: "terminal",
      workspacePath: vm.workspacePath || DEFAULT_GUEST_WORKSPACE,
      session,
    };
  }

  async captureTemplate(
    vm: VmInstance,
    target: CaptureTemplateTarget,
    report?: CaptureTemplateProgressReporter,
  ): Promise<ProviderSnapshot> {
    this.assertAvailable();
    const snapshotName = buildTemplateSnapshotName(target.templateId);
    const alias = buildTemplateAlias(target.templateId);

    report?.("Creating source snapshot", 34);
    await this.runAsync(["snapshot", "create", vm.providerRef, snapshotName]);
    report?.("Publishing template image", TEMPLATE_PUBLISH_START_PERCENT);

    const publishStartedAt = Date.now();
    const knownPublishOperationIds = this.listTemplatePublishOperationIds();
    let publishOperationId: string | null = null;
    let lastReportedPercent = TEMPLATE_PUBLISH_START_PERCENT;
    let lastPublishDetail: string | undefined;
    let lastPublishSample: TemplatePublishProgressSample | null = null;
    const applyPublishSample = (sample: TemplatePublishProgressSample | null) => {
      if (!sample) {
        return;
      }

      lastPublishSample = sample;
      lastPublishDetail = sample.detail;
      lastReportedPercent = mapTemplatePublishProgress(sample, vm.resources.diskGb);
    };
    const pollOperationProgress = () => {
      const operationProgress = this.inspectTemplatePublishOperationProgress(
        publishStartedAt,
        knownPublishOperationIds,
        publishOperationId,
      );

      if (!operationProgress) {
        return;
      }

      publishOperationId = operationProgress.operationId;
      applyPublishSample(operationProgress.sample);
    };
    const reportPublishProgress = (percent: number | null, detail?: string) => {
      const elapsedSeconds = Math.max(
        1,
        Math.round((Date.now() - publishStartedAt) / 1000),
      );
      const message = detail
        ? `Publishing template image (${detail}, ${elapsedSeconds}s elapsed)`
        : `Publishing template image (${describeTemplatePublishActivity(this.templateCompression)}, ${elapsedSeconds}s elapsed)`;
      report?.(message, percent);
    };
    const heartbeat = setInterval(() => {
      pollOperationProgress();

      if (!lastPublishSample) {
        lastReportedPercent = estimateTemplatePublishProgress(
          publishStartedAt,
          this.templatePublishHeartbeatMs,
          vm.resources.diskGb,
        );
        lastPublishDetail = undefined;
      }

      reportPublishProgress(lastReportedPercent, lastPublishDetail);
    }, this.templatePublishHeartbeatMs);

    try {
      const publishArgs = [
        "publish",
        `${vm.providerRef}/${snapshotName}`,
        "--alias",
        alias,
        "--reuse",
      ];

      if (this.templateCompression) {
        publishArgs.push("--compression", this.templateCompression);
      }

      await this.runStreaming(
        publishArgs,
        {
          onStdout: (chunk) => {
            applyPublishSample(parseTemplatePublishProgressChunk(chunk));
            reportPublishProgress(lastReportedPercent, lastPublishDetail);
          },
          onStderr: (chunk) => {
            applyPublishSample(parseTemplatePublishProgressChunk(chunk));
            reportPublishProgress(lastReportedPercent, lastPublishDetail);
          },
        },
      );
    } finally {
      clearInterval(heartbeat);
    }

    report?.("Template image published", TEMPLATE_PUBLISH_COMPLETE_PERCENT);

    return {
      providerRef: `${vm.providerRef}/${snapshotName}`,
      summary: `Template ${target.name} published as ${alias}.`,
      launchSource: alias,
    };
  }

  async injectCommand(
    vm: VmInstance,
    command: string,
  ): Promise<ProviderMutation> {
    this.assertAvailable();
    const workspacePath = vm.workspacePath || DEFAULT_GUEST_WORKSPACE;
    const cdMatch = command.match(/^cd(?:\s+(.+))?$/);

    if (cdMatch) {
      const result = await this.runAsync([
        "exec",
        vm.providerRef,
        "--cwd",
        workspacePath,
        "--",
        "sh",
        "-lc",
        `${command} && pwd`,
      ]);
      const nextWorkspacePath = result.stdout.trim() || workspacePath;

      return {
        lastAction: `Changed directory for ${vm.name}`,
        activity: [`$ ${command}`, `cwd: ${nextWorkspacePath}`],
        activeWindow: "terminal",
        workspacePath: nextWorkspacePath,
        session: vm.session,
        commandResult: {
          command,
          output: [`cwd: ${nextWorkspacePath}`],
          workspacePath: nextWorkspacePath,
        },
      };
    }

    const result = await this.runAsync([
      "exec",
      vm.providerRef,
      "--cwd",
      workspacePath,
      "--",
      "sh",
      "-lc",
      command,
    ]);
    const output = collectCommandOutput(result);
    const activity = [`$ ${command}`, ...summarizeCommandOutput(output)];

    return {
      lastAction: `Executed: ${command}`,
      activity,
      activeWindow: "terminal",
      workspacePath,
      session: vm.session,
      commandResult: {
        command,
        output,
        workspacePath,
      },
    };
  }

  tickVm(): ProviderTick | null {
    return null;
  }

  renderFrame(
    vm: VmInstance,
    template: EnvironmentTemplate | null,
    mode: "tile" | "detail",
  ): string {
    const providerLine =
      vm.session?.kind === "vnc"
        ? `VNC ${vm.session.display}`
        : this.state.detail;

    return renderSyntheticFrame(vm, template, mode, providerLine);
  }

  private assertAvailable(): void {
    const state = this.refreshState();

    if (!state.available) {
      throw new Error(state.detail);
    }
  }

  private probeState(): ProviderState {
    const probe = this.runner.execute(["list", "--format", "json"], {
      timeoutMs: INCUS_PROBE_TIMEOUT_MS,
    });

    if (probe.status === 0) {
      this.captureTelemetrySnapshot(probe.stdout);
    }

    return buildIncusProviderState(
      this.incusBinary,
      this.project,
      probe,
      this.getHostNetworkDiagnostic(),
    );
  }

  private getHostNetworkDiagnostic(): HostNetworkDiagnostic {
    const now = Date.now();

    if (now - this.hostNetworkDiagnosticAt < HOST_NETWORK_PROBE_CACHE_MS) {
      return this.hostNetworkDiagnostic;
    }

    this.hostNetworkDiagnosticAt = now;

    try {
      this.hostNetworkDiagnostic = this.hostNetworkProbe.probe();
    } catch {
      this.hostNetworkDiagnostic = {
        status: "unknown",
        detail: null,
        nextSteps: [],
      };
    }

    return this.hostNetworkDiagnostic;
  }

  private assertLaunchSource(template: EnvironmentTemplate): void {
    if (template.launchSource.startsWith("mock://")) {
      throw new Error(
        `Template ${template.name} was captured in mock mode and cannot be launched with Incus.`,
      );
    }
  }

  private ensureAgentDevice(instanceName: string): void {
    const addArgs = [
      "config",
      "device",
      "add",
      instanceName,
      "agent",
      "disk",
      "source=agent:config",
    ];
    const result = this.runner.execute(addArgs);

    if (result.status === 0) {
      return;
    }

    const detail = `${result.stderr}\n${result.stdout}`;

    if (!detail.includes("already exists")) {
      throw new Error(formatCommandFailure(addArgs, result));
    }

    this.run(["config", "device", "remove", instanceName, "agent"]);
    this.run(addArgs);
  }

  private async ensureAgentDeviceAsync(instanceName: string): Promise<void> {
    const addArgs = [
      "config",
      "device",
      "add",
      instanceName,
      "agent",
      "disk",
      "source=agent:config",
    ];
    const result = await this.executeAsync(addArgs);

    if (result.status === 0) {
      return;
    }

    const detail = `${result.stderr}\n${result.stdout}`;

    if (!detail.includes("already exists")) {
      throw new Error(formatCommandFailure(addArgs, result));
    }

    await this.runAsync(["config", "device", "remove", instanceName, "agent"]);
    await this.runAsync(addArgs);
  }

  private stopInstance(instanceName: string): void {
    const stopArgs = ["stop", instanceName, "--timeout", "30"];
    const stopResult = this.runner.execute(stopArgs);

    if (stopResult.status !== 0 && !this.instanceMatchesStatus(instanceName, "stopped")) {
      const forceArgs = ["stop", instanceName, "--force"];
      const forceResult = this.runner.execute(forceArgs);

      if (forceResult.status !== 0 && !this.instanceMatchesStatus(instanceName, "stopped")) {
        throw new Error(
          [formatCommandFailure(stopArgs, stopResult), formatCommandFailure(forceArgs, forceResult)]
            .filter(Boolean)
            .join("\n"),
        );
      }
    }
  }

  private async stopInstanceAsync(instanceName: string): Promise<void> {
    const stopArgs = ["stop", instanceName, "--timeout", "30"];
    const stopResult = await this.executeAsync(stopArgs);

    if (stopResult.status !== 0 && !this.instanceMatchesStatus(instanceName, "stopped")) {
      const forceArgs = ["stop", instanceName, "--force"];
      const forceResult = await this.executeAsync(forceArgs);

      if (forceResult.status !== 0 && !this.instanceMatchesStatus(instanceName, "stopped")) {
        throw new Error(
          [formatCommandFailure(stopArgs, stopResult), formatCommandFailure(forceArgs, forceResult)]
            .filter(Boolean)
            .join("\n"),
        );
      }
    }
  }

  private async resolveSession(
    instanceName: string,
    report?: ProviderProgressReporter,
  ): Promise<VmSession | null> {
    let address: string | null = null;
    const waitStartedAt = Date.now();
    const emitProgress = report;
    let bootstrapTriggered = false;

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const info = await this.inspectInstanceAsync(instanceName);
      const addresses = findGuestAddressCandidates(info);
      address = addresses[0] ?? null;
      const session = await this.probeReachableSessionForAddresses(addresses);

      if (session) {
        emitProgress?.("Desktop session ready", VM_CREATE_READY_PERCENT);
        return session;
      }

      if (!bootstrapTriggered) {
        bootstrapTriggered = await this.ensureGuestDesktopBootstrapAsync(instanceName);
      }

      if (normalizeStatus(info.status ?? info.state?.status) !== "running") {
        break;
      }

      emitProgress?.(
        address ? "Waiting for desktop" : "Waiting for guest network",
        estimateVmCreateDesktopWaitProgress(waitStartedAt),
      );
      await sleep(5000);
    }

    return address ? buildVncSession(address, this.guestVncPort) : null;
  }

  private async ensureGuestDesktopBootstrapAsync(instanceName: string): Promise<boolean> {
    const args = [
      "exec",
      instanceName,
      "--",
      "sh",
      "-lc",
      buildEnsureGuestDesktopBootstrapScript(this.guestVncPort, false),
    ];
    const result = await this.executeAsync(args);

    return result.status === 0;
  }

  private async probeReachableSession(instance: IncusListInstance): Promise<VmSession | null> {
    return this.probeReachableSessionForAddresses(findGuestAddressCandidates(instance));
  }

  private async probeReachableSessionForAddresses(addresses: string[]): Promise<VmSession | null> {
    for (const address of addresses) {
      if (await this.guestPortProbe.probe(address, this.guestVncPort)) {
        return buildVncSession(address, this.guestVncPort);
      }
    }

    return null;
  }

  private inspectInstance(instanceName: string): IncusListInstance {
    const match = this.inspectInstanceSafe(instanceName);

    if (!match) {
      throw new Error(`Incus did not return instance metadata for ${instanceName}.`);
    }

    return match;
  }

  private inspectInstanceSafe(instanceName: string): IncusListInstance | null {
    const result = this.run(["list", instanceName, "--format", "json"]);
    const instances = parseJson<IncusListInstance[]>(result.stdout);
    const match =
      instances.find((entry) => entry.name === instanceName) ?? instances[0] ?? null;

    return match;
  }

  private async inspectInstanceAsync(instanceName: string): Promise<IncusListInstance> {
    const match = await this.inspectInstanceSafeAsync(instanceName);

    if (!match) {
      throw new Error(`Incus did not return instance metadata for ${instanceName}.`);
    }

    return match;
  }

  private async inspectInstanceSafeAsync(instanceName: string): Promise<IncusListInstance | null> {
    const result = await this.runAsync(["list", instanceName, "--format", "json"]);
    const instances = parseJson<IncusListInstance[]>(result.stdout);
    const match =
      instances.find((entry) => entry.name === instanceName) ?? instances[0] ?? null;

    return match;
  }

  private async inspectInstanceExpandedDevicesAsync(
    instanceName: string,
  ): Promise<Record<string, IncusInstanceDevice>> {
    const result = await this.runAsync([
      "query",
      `/1.0/instances/${encodeURIComponent(instanceName)}`,
    ]);
    const instance = parseJson<IncusListInstance>(result.stdout);
    const devices = instance.expanded_devices ?? instance.devices ?? null;

    if (!devices || Object.keys(devices).length === 0) {
      throw new Error(`Incus did not expose expanded devices for ${instanceName}.`);
    }

    return devices;
  }

  private async resolveRootDiskDeviceNameAsync(instanceName: string): Promise<string> {
    const devices = await this.inspectInstanceExpandedDevicesAsync(instanceName);
    const match = Object.entries(devices).find(
      ([, device]) => device.type === "disk" && device.path === "/",
    );

    if (!match) {
      throw new Error(`Incus did not expose a root disk device for ${instanceName}.`);
    }

    return match[0];
  }

  private async setRootDiskSizeAsync(instanceName: string, diskGb: number): Promise<void> {
    const rootDeviceName = await this.resolveRootDiskDeviceNameAsync(instanceName);
    const sizeArg = `size=${formatDiskSize(diskGb)}`;
    const overrideArgs = [
      "config",
      "device",
      "override",
      instanceName,
      rootDeviceName,
      sizeArg,
    ];
    const result = await this.executeAsync(overrideArgs);

    if (result.status === 0) {
      return;
    }

    const detail = `${result.stderr}\n${result.stdout}`;

    if (!detail.includes("already exists")) {
      throw new Error(formatCommandFailure(overrideArgs, result));
    }

    await this.runAsync([
      "config",
      "device",
      "set",
      instanceName,
      rootDeviceName,
      sizeArg,
    ]);
  }

  private getTelemetryInstanceInfo(instanceName: string): IncusListInstance | null {
    const now = Date.now();

    if (now - this.telemetrySnapshotAt > 1000 || this.telemetryInstances.size === 0) {
      const result = this.run(["list", "--format", "json"]);
      this.captureTelemetrySnapshot(result.stdout, now);
    }

    return this.telemetryInstances.get(instanceName) ?? null;
  }

  private listTemplatePublishOperationIds(): Set<string> {
    return new Set(
      this.listRunningOperations()
        .map((operation) => operation.id)
        .filter((operationId): operationId is string => typeof operationId === "string"),
    );
  }

  private inspectTemplatePublishOperationProgress(
    publishStartedAt: number,
    knownOperationIds: Set<string>,
    activeOperationId: string | null,
  ): { operationId: string; sample: TemplatePublishProgressSample } | null {
    const operations = this.listRunningOperations();
    const activeOperation =
      activeOperationId
        ? operations.find((operation) => operation.id === activeOperationId) ?? null
        : null;
    const operation =
      activeOperation ??
      pickTemplatePublishOperation(operations, publishStartedAt, knownOperationIds);

    if (!operation?.id) {
      return null;
    }

    const sample = parseTemplatePublishOperation(operation);

    if (!sample) {
      return null;
    }

    return {
      operationId: operation.id,
      sample,
    };
  }

  private captureTelemetrySnapshot(rawInstances: string, capturedAt = Date.now()): void {
    const instances = parseJson<IncusListInstance[]>(rawInstances);
    this.telemetryInstances = new Map(
      instances
        .filter((entry): entry is IncusListInstance & { name: string } => typeof entry.name === "string")
        .map((entry) => [entry.name, entry]),
    );
    this.telemetrySnapshotAt = capturedAt;
  }

  private listRunningOperations(): IncusOperation[] {
    const result = this.runner.execute(["query", "/1.0/operations?recursion=1"]);

    if (result.status !== 0) {
      return [];
    }

    try {
      const response = parseJson<IncusOperationListResponse>(result.stdout);
      return Array.isArray(response.running)
        ? response.running
        : [];
    } catch {
      return [];
    }
  }

  private instanceMatchesStatus(
    instanceName: string,
    expectedStatus: "running" | "stopped",
  ): boolean {
    const info = this.inspectInstanceSafe(instanceName);
    return normalizeStatus(info?.status ?? info?.state?.status) === expectedStatus;
  }

  private run(args: string[]): CommandResult {
    const result = this.runner.execute(args);

    if (result.status === 0) {
      return result;
    }

    throw new Error(formatCommandFailure(args, result));
  }

  private async executeAsync(
    args: string[],
    listeners?: CommandStreamListeners,
  ): Promise<CommandResult> {
    return this.runner.executeStreaming
      ? this.runner.executeStreaming(args, listeners)
      : this.runner.execute(args);
  }

  private async runAsync(
    args: string[],
    listeners?: CommandStreamListeners,
  ): Promise<CommandResult> {
    const result = await this.executeAsync(args, listeners);

    if (result.status === 0) {
      return result;
    }

    throw new Error(formatCommandFailure(args, result));
  }

  private async runStreaming(
    args: string[],
    listeners?: CommandStreamListeners,
  ): Promise<CommandResult> {
    const result = this.runner.executeStreaming
      ? await this.runner.executeStreaming(args, listeners)
      : this.runner.execute(args);

    if (result.status === 0) {
      return result;
    }

    throw new Error(formatCommandFailure(args, result));
  }
}

class SpawnIncusCommandRunner implements IncusCommandRunner {
  constructor(
    private readonly incusBinary: string,
    private readonly project?: string,
  ) {}

  execute(args: string[], options?: CommandExecutionOptions): CommandResult {
    const fullArgs = this.project
      ? ["--project", this.project, ...args]
      : args;
    const result = spawnSync(this.incusBinary, fullArgs, {
      encoding: "utf8",
      timeout: options?.timeoutMs,
    });

    return {
      args: fullArgs,
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      error: result.error ?? undefined,
    };
  }

  async executeStreaming(
    args: string[],
    listeners: CommandStreamListeners = {},
  ): Promise<CommandResult> {
    const fullArgs = this.project
      ? ["--project", this.project, ...args]
      : args;

    return new Promise((resolve) => {
      const child = spawn(this.incusBinary, fullArgs, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (result: CommandResult) => {
        if (settled) {
          return;
        }

        settled = true;
        resolve(result);
      };

      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
        listeners.onStdout?.(chunk);
      });

      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
        listeners.onStderr?.(chunk);
      });

      child.on("error", (error) => {
        finish({
          args: fullArgs,
          status: null,
          stdout,
          stderr,
          error,
        });
      });

      child.on("close", (status) => {
        finish({
          args: fullArgs,
          status,
          stdout,
          stderr,
        });
      });
    });
  }
}

class TcpGuestPortProbe implements GuestPortProbe {
  async probe(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      let stage: "banner" | "security" = "banner";
      let buffer = Buffer.alloc(0);
      const socket = connectTcp({
        host,
        port,
      });
      const finish = (result: boolean) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(result);
      };
      const timer = setTimeout(() => {
        finish(false);
      }, 2000);

      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);

        if (stage === "banner") {
          if (buffer.length < 12) {
            return;
          }

          const banner = buffer.subarray(0, 12).toString("latin1");

          if (!banner.startsWith("RFB ")) {
            finish(false);
            return;
          }

          stage = "security";
          buffer = Buffer.alloc(0);
          socket.write(Buffer.from("RFB 003.008\n", "ascii"));
          return;
        }

        if (buffer.length > 0) {
          finish(true);
        }
      });

      socket.once("error", () => {
        finish(false);
      });

      socket.once("close", () => {
        if (stage === "security" && buffer.length > 0) {
          finish(true);
          return;
        }

        finish(false);
      });
    });
  }
}

class NoopHostNetworkProbe implements HostNetworkProbe {
  probe(): HostNetworkDiagnostic {
    return {
      status: "unknown",
      detail: null,
      nextSteps: [],
    };
  }
}

class ShellHostNetworkProbe implements HostNetworkProbe {
  probe(): HostNetworkDiagnostic {
    const hostEgress = this.runCheck("exec 3<>/dev/tcp/1.1.1.1/443");
    const ubuntuMirror = this.runCheck(
      "getent ahostsv4 archive.ubuntu.com >/dev/null 2>&1 && exec 3<>/dev/tcp/archive.ubuntu.com/80",
    );

    if (hostEgress === "unknown" || ubuntuMirror === "unknown") {
      return {
        status: "unknown",
        detail: null,
        nextSteps: [],
      };
    }

    if (hostEgress === "ok" && ubuntuMirror === "ok") {
      return {
        status: "ready",
        detail: null,
        nextSteps: [],
      };
    }

    const failures: string[] = [];

    if (hostEgress !== "ok") {
      failures.push("host TCP egress to 1.1.1.1:443 failed");
    }

    if (ubuntuMirror !== "ok") {
      failures.push("Ubuntu mirror resolution/connectivity to archive.ubuntu.com:80 failed");
    }

    return {
      status: "unreachable",
      detail: `Incus is reachable, but outbound internet checks failed: ${failures.join("; ")}. New guests may fail to install x11vnc or other packages until connectivity is restored.`,
      nextSteps: [
        "Verify outbound IPv4 and DNS from the control-plane host, especially access to archive.ubuntu.com.",
        "If Docker is installed, ensure FORWARD rules still allow traffic from incusbr0; packaged installs ship parallaize-network-fix.service for this case.",
        "If a guest still boots without VNC, inspect `journalctl -u parallaize-desktop-bootstrap.service` inside the VM for the current bootstrap failure.",
      ],
    };
  }

  private runCheck(script: string): "ok" | "failed" | "unknown" {
    const result = spawnSync("bash", ["-lc", script], {
      encoding: "utf8",
      timeout: HOST_NETWORK_PROBE_TIMEOUT_MS,
    });

    if (result.error?.message.includes("ENOENT")) {
      return "unknown";
    }

    return result.status === 0 ? "ok" : "failed";
  }
}

function buildCommandReply(command: string, currentWorkspace: string): string {
  if (command.startsWith("cd ")) {
    return `cwd: ${command.slice(3).trim() || currentWorkspace}`;
  }

  if (command === "pwd") {
    return currentWorkspace;
  }

  if (command === "ls" || command === "ls -la") {
    return "src/  packages/  infra/  README.md  TODO.md";
  }

  if (command.startsWith("git status")) {
    return "working tree clean except for generated mock activity";
  }

  if (command.startsWith("pnpm build")) {
    return "build: compiled control-plane and dashboard successfully";
  }

  if (command.startsWith("pnpm test")) {
    return "test: synthetic provider checks passed";
  }

  if (command.startsWith("incus list")) {
    return "incus: unavailable in demo mode";
  }

  return `completed: ${command}`;
}

function buildMockProviderState(): ProviderState {
  return {
    kind: "mock",
    available: true,
    detail:
      "Demo mode is active. Actions update persisted state and synthetic desktop frames.",
    hostStatus: "ready",
    binaryPath: null,
    project: null,
    desktopTransport: "synthetic",
    nextSteps: [],
  };
}

function buildIncusProviderState(
  incusBinary: string,
  project: string | null,
  result: CommandResult,
  hostNetworkDiagnostic: HostNetworkDiagnostic,
): ProviderState {
  if (result.status === 0) {
    if (hostNetworkDiagnostic.status === "unreachable") {
      return {
        kind: "incus",
        available: true,
        detail:
          hostNetworkDiagnostic.detail ??
          "Incus is reachable, but outbound internet checks failed for the host.",
        hostStatus: "network-unreachable",
        binaryPath: incusBinary,
        project,
        desktopTransport: "novnc",
        nextSteps: hostNetworkDiagnostic.nextSteps,
      };
    }

    return {
      kind: "incus",
      available: true,
      detail:
        "Incus is reachable. Browser sessions use the built-in noVNC bridge when the guest VNC server is reachable.",
      hostStatus: "ready",
      binaryPath: incusBinary,
      project,
      desktopTransport: "novnc",
      nextSteps: [
        "Ensure the guest image starts a VNC server on the configured guest port so the browser bridge can connect.",
      ],
    };
  }

  return {
    kind: "incus",
    available: false,
    detail: describeProbeFailure(result),
    hostStatus: classifyProbeFailure(result),
    binaryPath: incusBinary,
    project,
    desktopTransport: "novnc",
    nextSteps: buildProbeNextSteps(classifyProbeFailure(result)),
  };
}

function collectCommandOutput(result: CommandResult): string[] {
  const combined = [result.stdout, result.stderr]
    .filter((chunk) => chunk.length > 0)
    .join(result.stdout && result.stderr && !result.stdout.endsWith("\n") ? "\n" : "")
    .replace(/\r/g, "");
  const lines = combined
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return ["command completed without output"];
  }

  if (lines.length <= 12) {
    return lines;
  }

  const hiddenLineCount = lines.length - 11;
  return [
    ...lines.slice(0, 11),
    `… ${hiddenLineCount} more line${hiddenLineCount === 1 ? "" : "s"}`,
  ];
}

function summarizeCommandOutput(lines: string[]): string[] {
  return lines.slice(0, 6);
}

function parseSnapshotName(providerRef: string, instanceName: string): string {
  const prefix = `${instanceName}/`;

  if (providerRef.startsWith(prefix)) {
    return providerRef.slice(prefix.length);
  }

  const slashIndex = providerRef.lastIndexOf("/");

  if (slashIndex >= 0 && slashIndex < providerRef.length - 1) {
    return providerRef.slice(slashIndex + 1);
  }

  throw new Error(`Snapshot provider ref ${providerRef} is not attached to ${instanceName}.`);
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

function renderSyntheticFrame(
  vm: VmInstance,
  template: EnvironmentTemplate | null,
  mode: "tile" | "detail",
  providerLine: string,
): string {
  const width = mode === "detail" ? 1280 : 640;
  const height = mode === "detail" ? 800 : 360;
  const hue = vm.screenSeed % 360;
  const statusColor = statusAccent(vm.status);
  const logLines = vm.activityLog.slice(-5);
  const title = escapeXml(vm.name);
  const templateName = escapeXml(template?.name ?? "Unknown template");
  const workspacePath = escapeXml(vm.workspacePath);
  const lastAction = escapeXml(vm.lastAction);
  const activeWindow = vm.activeWindow;
  const windowTitles: VmWindow[] = ["editor", "terminal", "browser", "logs"];

  const windowMarkup = windowTitles
    .map((window, index) => {
      const x = index % 2 === 0 ? 32 : width / 2 + 16;
      const y = index < 2 ? 112 : height / 2 + 8;
      const panelWidth = width / 2 - 48;
      const panelHeight = height / 2 - 96;
      const isActive = window === activeWindow;
      const label = window.toUpperCase();

      return `
        <g transform="translate(${x} ${y})">
          <rect width="${panelWidth}" height="${panelHeight}" rx="20"
            fill="${isActive ? `hsla(${hue}, 58%, 14%, 0.9)` : "rgba(10, 16, 22, 0.76)"}"
            stroke="${isActive ? statusColor : "rgba(255,255,255,0.08)"}"
            stroke-width="${isActive ? 2 : 1}" />
          <rect x="16" y="18" width="${panelWidth - 32}" height="28" rx="14"
            fill="rgba(255,255,255,0.06)" />
          <text x="30" y="38" fill="#f4f7f9" font-size="${mode === "detail" ? 20 : 14}"
            font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${label}</text>
          <text x="30" y="72" fill="rgba(255,255,255,0.72)"
            font-size="${mode === "detail" ? 18 : 12}"
            font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${escapeXml(panelCopy(window, logLines))}</text>
        </g>
      `;
    })
    .join("");

  const activityMarkup = logLines
    .map(
      (line, index) => `
        <text x="44" y="${height - 116 + index * (mode === "detail" ? 28 : 18)}"
          fill="rgba(244,247,249,0.82)"
          font-size="${mode === "detail" ? 18 : 12}"
          font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${escapeXml(line)}</text>
      `,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="hsl(${hue}, 66%, 16%)" />
      <stop offset="50%" stop-color="hsl(${(hue + 28) % 360}, 64%, 11%)" />
      <stop offset="100%" stop-color="#081117" />
    </linearGradient>
    <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
      <path d="M 28 0 L 0 0 0 28" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="1" />
    </pattern>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)" />
  <rect width="${width}" height="${height}" fill="url(#grid)" opacity="0.45" />
  <rect x="20" y="18" width="${width - 40}" height="74" rx="24" fill="rgba(5, 9, 14, 0.82)" stroke="rgba(255,255,255,0.08)" />
  <circle cx="48" cy="54" r="8" fill="#ff7b5b" />
  <circle cx="74" cy="54" r="8" fill="#ffc857" />
  <circle cx="100" cy="54" r="8" fill="#5ed388" />
  <text x="128" y="48" fill="#f4f7f9" font-size="${mode === "detail" ? 26 : 18}" font-family="Georgia, Cambria, serif">${title}</text>
  <text x="128" y="72" fill="rgba(244,247,249,0.72)" font-size="${mode === "detail" ? 18 : 12}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${templateName} • ${vm.resources.cpu} CPU • ${(vm.resources.ramMb / 1024).toFixed(1)} GB RAM • ${vm.resources.diskGb} GB disk</text>
  <rect x="${width - 220}" y="30" width="176" height="40" rx="20" fill="rgba(255,255,255,0.08)" />
  <text x="${width - 196}" y="56" fill="${statusColor}" font-size="${mode === "detail" ? 18 : 12}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${vm.status.toUpperCase()}</text>
  ${windowMarkup}
  <rect x="24" y="${height - 144}" width="${width - 48}" height="116" rx="24" fill="rgba(5, 9, 14, 0.82)" stroke="rgba(255,255,255,0.08)" />
  <text x="44" y="${height - 118}" fill="${statusColor}" font-size="${mode === "detail" ? 18 : 12}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">ACTIVITY FEED</text>
  ${activityMarkup}
  <text x="${width - 480}" y="${height - 20}" fill="rgba(244,247,249,0.66)" font-size="${mode === "detail" ? 16 : 11}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">workspace: ${workspacePath} • ${escapeXml(providerLine)} • last action: ${lastAction}</text>
</svg>`;
}

function panelCopy(window: VmWindow, logLines: string[]): string {
  switch (window) {
    case "editor":
      return "queue.ts | provider adapter | dashboard state";
    case "terminal":
      return logLines.at(-1) ?? "terminal idle";
    case "browser":
      return "grid view | template notes | docs";
    case "logs":
      return "actions healthy • no crash loops";
    default:
      return "panel idle";
  }
}

function statusAccent(status: VmInstance["status"]): string {
  switch (status) {
    case "running":
      return "#5ed388";
    case "stopped":
      return "#ffb02e";
    case "creating":
      return "#5bbcff";
    case "deleting":
      return "#ff7b5b";
    case "error":
      return "#ff4d73";
    default:
      return "#f4f7f9";
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildSyntheticSession(): VmSession {
  return {
    kind: "synthetic",
    host: null,
    port: null,
    webSocketPath: null,
    browserPath: null,
    display: "Synthetic frame stream",
  };
}

function buildVncSession(
  host: string | null,
  port: number,
): VmSession {
  return {
    kind: "vnc",
    host,
    port,
    webSocketPath: null,
    browserPath: null,
    display: host ? `${formatNetworkEndpoint(host, port)}` : `guest VNC on port ${port} pending DHCP`,
  };
}

function validateDisplayResolution(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error("Display resolution width and height must be integers.");
  }

  if (width < 320 || width > 8192 || height < 200 || height > 8192) {
    throw new Error("Display resolution is outside the supported range.");
  }
}

function buildGuestGdmCustomConfig(): string {
  return `[daemon]
AutomaticLoginEnable=true
AutomaticLogin=ubuntu
WaylandEnable=false`;
}

function buildEnsureGuestDesktopBootstrapScript(
  port: number,
  strictStart: boolean,
): string {
  return `BOOTSTRAP_FILE="/usr/local/bin/parallaize-desktop-bootstrap"
BOOTSTRAP_SERVICE_FILE="/etc/systemd/system/parallaize-desktop-bootstrap.service"
CURRENT_BOOTSTRAP="$(cat "$BOOTSTRAP_FILE" 2>/dev/null || true)"
DESIRED_BOOTSTRAP="$(cat <<'SCRIPT'
${buildGuestDesktopBootstrapScript(port)}
SCRIPT
)"
CURRENT_BOOTSTRAP_SERVICE="$(cat "$BOOTSTRAP_SERVICE_FILE" 2>/dev/null || true)"
DESIRED_BOOTSTRAP_SERVICE="$(cat <<'UNIT'
${buildGuestDesktopBootstrapServiceUnit()}
UNIT
)"
if [ "$CURRENT_BOOTSTRAP" != "$DESIRED_BOOTSTRAP" ] || [ "$CURRENT_BOOTSTRAP_SERVICE" != "$DESIRED_BOOTSTRAP_SERVICE" ]; then
  mkdir -p /usr/local/bin /etc/systemd/system
  cat > "$BOOTSTRAP_FILE" <<'SCRIPT'
${buildGuestDesktopBootstrapScript(port)}
SCRIPT
  chmod 0755 "$BOOTSTRAP_FILE"
  cat > "$BOOTSTRAP_SERVICE_FILE" <<'UNIT'
${buildGuestDesktopBootstrapServiceUnit()}
UNIT
fi
systemctl daemon-reload
systemctl enable parallaize-desktop-bootstrap.service >/dev/null 2>&1 || true
systemctl restart parallaize-desktop-bootstrap.service${strictStart ? "" : " || true"}`;
}

function buildSetDisplayResolutionScript(
  width: number,
  height: number,
  port: number,
): string {
  return `set -eu
WIDTH=${width}
HEIGHT=${height}
${buildEnsureGuestDesktopBootstrapScript(port, true)}
${buildGuestDisplayDiscoveryScript()}
ATTEMPT=0
AUTH_FILE=""
DISPLAY_NUMBER=":0"
while [ "$ATTEMPT" -lt 30 ]; do
  DISPLAY_NUMBER="$(find_guest_display_number)"
  AUTH_FILE="$(find_guest_auth_file || true)"
  if [ -n "$AUTH_FILE" ] && [ -f "$AUTH_FILE" ]; then
    break
  fi
  ATTEMPT=$((ATTEMPT + 1))
  sleep 2
done
if [ -z "$AUTH_FILE" ] || [ ! -f "$AUTH_FILE" ]; then
  echo "Unable to locate an Xauthority file for the desktop session." >&2
  exit 1
fi
export DISPLAY="$DISPLAY_NUMBER"
export XAUTHORITY="$AUTH_FILE"
ATTEMPT=0
OUTPUT=""
while [ "$ATTEMPT" -lt 15 ]; do
  OUTPUT="$(xrandr --query | awk '/ connected/ { print $1; exit }')"
  if [ -n "$OUTPUT" ]; then
    break
  fi
  ATTEMPT=$((ATTEMPT + 1))
  sleep 2
done
if [ -z "$OUTPUT" ]; then
  echo "No connected XRANDR output was found." >&2
  exit 1
fi
TARGET_MODE="${width}x${height}"
MODE_TO_APPLY="$(xrandr --query | awk -v target="$TARGET_MODE" '$1 == target || $1 ~ ("^" target "(_|R|$)") { print $1; exit }')"
if [ -n "$MODE_TO_APPLY" ]; then
  xrandr --output "$OUTPUT" --mode "$MODE_TO_APPLY"
else
  if ! command -v cvt >/dev/null 2>&1; then
    echo "cvt is required to generate a display mode for $TARGET_MODE." >&2
    exit 1
  fi
  MODELINE="$(cvt "$WIDTH" "$HEIGHT" 60)"
  MODE_NAME="$(printf '%s\n' "$MODELINE" | awk -F'"' '/^Modeline / { print $2; exit }')"
  MODE_ARGS="$(printf '%s\n' "$MODELINE" | sed -n 's/^Modeline "[^"]*" //p')"
  if [ -z "$MODE_NAME" ] || [ -z "$MODE_ARGS" ]; then
    echo "Failed to generate an XRANDR modeline for $TARGET_MODE." >&2
    exit 1
  fi
  xrandr --newmode "$MODE_NAME" $MODE_ARGS 2>/dev/null || true
  xrandr --addmode "$OUTPUT" "$MODE_NAME" 2>/dev/null || true
  MODE_TO_APPLY="$MODE_NAME"
  xrandr --output "$OUTPUT" --mode "$MODE_TO_APPLY"
fi`;
}

function buildGuestDisplayDiscoveryScript(): string {
  return `find_guest_display_number() {
  CURRENT_DISPLAY="$(ps -C x11vnc -o args= 2>/dev/null | sed -n 's/.* -display \\([^ ]*\\).*/\\1/p' | head -n 1)"
  if [ -n "$CURRENT_DISPLAY" ]; then
    printf '%s\\n' "$CURRENT_DISPLAY"
    return 0
  fi
  CURRENT_DISPLAY="$(ps -C Xorg -o args= 2>/dev/null | sed -n 's/.* \\(:[0-9][0-9]*\\)\\( \\|$\\).*/\\1/p' | head -n 1)"
  if [ -n "$CURRENT_DISPLAY" ]; then
    printf '%s\\n' "$CURRENT_DISPLAY"
    return 0
  fi
  CURRENT_DISPLAY="$(ps -C Xwayland -o args= 2>/dev/null | sed -n 's/.* \\(:[0-9][0-9]*\\)\\( \\|$\\).*/\\1/p' | head -n 1)"
  if [ -n "$CURRENT_DISPLAY" ]; then
    printf '%s\\n' "$CURRENT_DISPLAY"
    return 0
  fi
  printf '%s\\n' ':0'
}

find_guest_auth_file() {
  CURRENT_AUTH_FILE="$(ps -C x11vnc -o args= 2>/dev/null | sed -n 's/.* -auth \\([^ ]*\\).*/\\1/p' | head -n 1)"
  if [ -n "$CURRENT_AUTH_FILE" ] && [ -f "$CURRENT_AUTH_FILE" ]; then
    printf '%s\\n' "$CURRENT_AUTH_FILE"
    return 0
  fi
  for CURRENT_AUTH_FILE in $(ps -C Xorg -o args= 2>/dev/null | sed -n 's/.* -auth \\([^ ]*\\).*/\\1/p'; ps -C Xwayland -o args= 2>/dev/null | sed -n 's/.* -auth \\([^ ]*\\).*/\\1/p'); do
    if [ -f "$CURRENT_AUTH_FILE" ]; then
      printf '%s\\n' "$CURRENT_AUTH_FILE"
      return 0
    fi
  done
  if command -v loginctl >/dev/null 2>&1; then
    for CURRENT_SESSION in $(loginctl list-sessions --no-legend 2>/dev/null | awk '{print $1}'); do
      CURRENT_UID="$(loginctl show-session "$CURRENT_SESSION" -p User --value 2>/dev/null || true)"
      CURRENT_NAME="$(loginctl show-session "$CURRENT_SESSION" -p Name --value 2>/dev/null || true)"
      CURRENT_TYPE="$(loginctl show-session "$CURRENT_SESSION" -p Type --value 2>/dev/null || true)"
      CURRENT_STATE="$(loginctl show-session "$CURRENT_SESSION" -p State --value 2>/dev/null || true)"
      CURRENT_REMOTE="$(loginctl show-session "$CURRENT_SESSION" -p Remote --value 2>/dev/null || true)"
      if [ -z "$CURRENT_UID" ] || [ "$CURRENT_REMOTE" = "yes" ]; then
        continue
      fi
      if [ "$CURRENT_STATE" != "active" ] && [ "$CURRENT_TYPE" != "x11" ] && [ "$CURRENT_TYPE" != "wayland" ]; then
        continue
      fi
      for CURRENT_AUTH_FILE in \
        /run/user/"$CURRENT_UID"/gdm/Xauthority \
        /run/user/"$CURRENT_UID"/Xauthority \
        /run/user/"$CURRENT_UID"/.Xauthority \
        /run/user/"$CURRENT_UID"/.mutter-Xwaylandauth.* \
        /run/user/"$CURRENT_UID"/gdm/.mutter-Xwaylandauth.* \
        /home/"$CURRENT_NAME"/.Xauthority; do
        if [ -f "$CURRENT_AUTH_FILE" ]; then
          printf '%s\\n' "$CURRENT_AUTH_FILE"
          return 0
        fi
      done
    done
  fi
  for CURRENT_AUTH_FILE in \
    /run/user/*/gdm/Xauthority \
    /run/user/*/Xauthority \
    /run/user/*/.Xauthority \
    /run/user/*/.mutter-Xwaylandauth.* \
    /run/user/*/gdm/.mutter-Xwaylandauth.* \
    /var/run/gdm3/auth-for-*/database \
    /var/lib/gdm3/.local/share/xorg/Xauthority \
    /home/*/.Xauthority; do
    if [ -f "$CURRENT_AUTH_FILE" ]; then
      printf '%s\\n' "$CURRENT_AUTH_FILE"
      return 0
    fi
  done
  return 1
}`;
}

function buildGuestVncLauncherScript(port: number): string {
  return `#!/bin/sh
set -eu
${buildGuestDisplayDiscoveryScript()}
ATTEMPT=0
AUTH_FILE=""
DISPLAY_NUMBER=":0"
while [ "$ATTEMPT" -lt 45 ]; do
  DISPLAY_NUMBER="$(find_guest_display_number)"
  AUTH_FILE="$(find_guest_auth_file || true)"
  if [ -n "$AUTH_FILE" ] && [ -f "$AUTH_FILE" ]; then
    break
  fi
  ATTEMPT=$((ATTEMPT + 1))
  sleep 2
done
if [ -z "$AUTH_FILE" ]; then
  echo "Unable to locate an Xauthority file for the desktop session." >&2
  exit 1
fi
export DISPLAY="$DISPLAY_NUMBER"
export XAUTHORITY="$AUTH_FILE"
export HOME="\${HOME:-/root}"
xset r on || true
exec /usr/bin/x11vnc -display "$DISPLAY_NUMBER" -auth "$AUTH_FILE" -forever -shared -xrandr newfbsize -noshm -nopw -repeat -rfbport ${port} -o /var/log/x11vnc.log`;
}

function buildGuestVncServiceUnit(): string {
  return `[Unit]
Description=Parallaize x11vnc bridge
After=display-manager.service parallaize-desktop-bootstrap.service
Wants=display-manager.service
ConditionPathExists=/usr/bin/x11vnc

[Service]
Type=simple
ExecStart=/usr/local/bin/parallaize-x11vnc
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target`;
}

function buildGuestDesktopBootstrapScript(port: number): string {
  return `#!/bin/sh
set -eu
GDM_FILE="/etc/gdm3/custom.conf"
LAUNCHER_FILE="/usr/local/bin/parallaize-x11vnc"
SERVICE_FILE="/etc/systemd/system/parallaize-x11vnc.service"
CURRENT_GDM="$(cat "$GDM_FILE" 2>/dev/null || true)"
DESIRED_GDM="$(cat <<'CONF'
${buildGuestGdmCustomConfig()}
CONF
)"
CURRENT_LAUNCHER="$(cat "$LAUNCHER_FILE" 2>/dev/null || true)"
DESIRED_LAUNCHER="$(cat <<'SCRIPT'
${buildGuestVncLauncherScript(port)}
SCRIPT
)"
CURRENT_SERVICE="$(cat "$SERVICE_FILE" 2>/dev/null || true)"
DESIRED_SERVICE="$(cat <<'UNIT'
${buildGuestVncServiceUnit()}
UNIT
)"
RESTART_GDM=0
if [ "$CURRENT_GDM" != "$DESIRED_GDM" ]; then
  mkdir -p /etc/gdm3
  cat > "$GDM_FILE" <<'CONF'
${buildGuestGdmCustomConfig()}
CONF
  RESTART_GDM=1
fi
if [ "$CURRENT_LAUNCHER" != "$DESIRED_LAUNCHER" ]; then
  mkdir -p /usr/local/bin
  cat > "$LAUNCHER_FILE" <<'SCRIPT'
${buildGuestVncLauncherScript(port)}
SCRIPT
  chmod 0755 "$LAUNCHER_FILE"
fi
if [ "$CURRENT_SERVICE" != "$DESIRED_SERVICE" ]; then
  mkdir -p /etc/systemd/system
  cat > "$SERVICE_FILE" <<'UNIT'
${buildGuestVncServiceUnit()}
UNIT
fi
if ! command -v x11vnc >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=0 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 update
  apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=0 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 install -y x11vnc
fi
systemctl daemon-reload
systemctl enable parallaize-x11vnc.service >/dev/null 2>&1 || true
if [ "$RESTART_GDM" -eq 1 ]; then
  systemctl restart gdm3 || true
  sleep 2
fi
systemctl restart parallaize-x11vnc.service`;
}

function buildGuestDesktopBootstrapServiceUnit(): string {
  return `[Unit]
Description=Parallaize desktop bootstrap
After=network-online.target display-manager.service
Wants=network-online.target display-manager.service
StartLimitIntervalSec=0

[Service]
Type=oneshot
ExecStart=/usr/local/bin/parallaize-desktop-bootstrap
Restart=on-failure
RestartSec=15

[Install]
WantedBy=multi-user.target`;
}

interface GuestInotifySettings {
  maxUserWatches: number;
  maxUserInstances: number;
}

function buildGuestInotifySysctlConfig(settings: GuestInotifySettings): string {
  return `# Raised inotify limits for Node/Vite-style dev watchers inside the guest.
fs.inotify.max_user_watches=${settings.maxUserWatches}
fs.inotify.max_user_instances=${settings.maxUserInstances}`;
}

function buildGuestVncCloudInit(
  port: number,
  inotifySettings: GuestInotifySettings,
): string {
  return `#cloud-config
write_files:
  - path: /etc/gdm3/custom.conf
    permissions: '0644'
    content: |
${indentBlock(buildGuestGdmCustomConfig(), "      ")}
  - path: /usr/local/bin/parallaize-x11vnc
    permissions: '0755'
    content: |
${indentBlock(buildGuestVncLauncherScript(port), "      ")}
  - path: /etc/systemd/system/parallaize-x11vnc.service
    permissions: '0644'
    content: |
${indentBlock(buildGuestVncServiceUnit(), "      ")}
  - path: /usr/local/bin/parallaize-desktop-bootstrap
    permissions: '0755'
    content: |
${indentBlock(buildGuestDesktopBootstrapScript(port), "      ")}
  - path: /etc/systemd/system/parallaize-desktop-bootstrap.service
    permissions: '0644'
    content: |
${indentBlock(buildGuestDesktopBootstrapServiceUnit(), "      ")}
  - path: /etc/sysctl.d/60-parallaize-inotify.conf
    permissions: '0644'
    content: |
${indentBlock(buildGuestInotifySysctlConfig(inotifySettings), "      ")}
runcmd:
  - sysctl --load /etc/sysctl.d/60-parallaize-inotify.conf || true
  - systemctl daemon-reload
  - systemctl disable --now gnome-remote-desktop.service || true
  - systemctl mask gnome-remote-desktop.service || true
  - mkdir -p /etc/systemd/user
  - ln -sf /dev/null /etc/systemd/user/gnome-remote-desktop.service
  - ln -sf /dev/null /etc/systemd/user/gnome-remote-desktop-handover.service
  - ln -sf /dev/null /etc/systemd/user/gnome-remote-desktop-headless.service
  - mkdir -p /mnt/incus-agent
  - |
      if mount /dev/disk/by-label/incus-agent /mnt/incus-agent; then
        (
          cd /mnt/incus-agent
          ./install.sh || true
        )
        umount /mnt/incus-agent || true
        agent_target=""
        for candidate in /usr/lib /lib /etc; do
          if [ -f "$candidate/systemd/system/incus-agent.service" ]; then
            agent_target="$candidate"
            break
          fi
        done
        if [ -n "$agent_target" ]; then
          mkdir -p /etc/systemd/system/multi-user.target.wants
          ln -sf "$agent_target/systemd/system/incus-agent.service" /etc/systemd/system/multi-user.target.wants/incus-agent.service
        fi
        systemctl start incus-agent.service || true
      fi
  - systemctl enable parallaize-desktop-bootstrap.service
  - systemctl restart gdm3 || true
  - systemctl start parallaize-desktop-bootstrap.service || true
`;
}

function indentBlock(value: string, prefix: string): string {
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

const PRIMARY_GUEST_INTERFACE_PATTERN = /^(en|eth|wl|ww|ib)/;
const GUEST_BRIDGE_INTERFACE_PATTERN =
  /^(lo|docker\d*|br[-\w]*|veth[\w-]*|virbr\d*|cni\d+|flannel\.\d+|incusbr\d*|lxcbr\d*|tun\d+|tap\d+)$/;

function findGuestAddressCandidates(instance: IncusListInstance): string[] {
  const networks = instance.state?.network ?? {};
  const candidates: Array<{
    address: string;
    family: "inet" | "inet6";
    score: number;
  }> = [];

  for (const [name, network] of Object.entries(networks)) {
    for (const address of network.addresses ?? []) {
      if (
        address.scope !== "global" ||
        !address.address ||
        (address.family !== "inet" && address.family !== "inet6")
      ) {
        continue;
      }

      candidates.push({
        address: address.address,
        family: address.family,
        score: scoreGuestAddressCandidate(name, network, address.family),
      });
    }
  }

  candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    if (left.family !== right.family) {
      return left.family === "inet" ? -1 : 1;
    }

    return left.address.localeCompare(right.address);
  });

  return [...new Set(candidates.map((candidate) => candidate.address))];
}

function scoreGuestAddressCandidate(
  interfaceName: string,
  network: { host_name?: string; type?: string },
  family: "inet" | "inet6",
): number {
  let score = family === "inet" ? 200 : 100;

  if (network.host_name) {
    score += 400;
  }

  if (network.type === "broadcast") {
    score += 40;
  }

  if (PRIMARY_GUEST_INTERFACE_PATTERN.test(interfaceName)) {
    score += 30;
  }

  if (GUEST_BRIDGE_INTERFACE_PATTERN.test(interfaceName)) {
    score -= 300;
  }

  return score;
}

function formatNetworkEndpoint(host: string, port: number): string {
  return host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
}

function formatMemoryLimit(ramMb: number): string {
  return `${ramMb}MiB`;
}

function formatDiskSize(diskGb: number): string {
  return `${diskGb}GiB`;
}

function buildSnapshotName(label: string): string {
  const slug = slugify(label) || "snapshot";
  return `parallaize-${Date.now().toString(36)}-${slug}`;
}

function buildTemplateSnapshotName(templateId: string): string {
  return `parallaize-template-${slugify(templateId)}-${Date.now().toString(36)}`;
}

function buildTemplateAlias(templateId: string): string {
  return `parallaize-template-${slugify(templateId)}`;
}

function describeTemplatePublishActivity(
  compression: IncusImageCompression | null,
): string {
  switch (compression) {
    case "bzip2":
    case "gzip":
    case "lz4":
    case "lzma":
    case "xz":
    case "zstd":
      return `${compression} compression in progress`;
    case "none":
    case null:
    default:
      return "uncompressed export in progress";
  }
}

function estimateTemplatePublishProgress(
  startedAt: number,
  heartbeatMs: number,
  diskGb: number,
): number {
  const elapsedMs = Date.now() - startedAt;
  const durationMs = estimateTemplatePublishDurationMs(diskGb);
  const span = TEMPLATE_PUBLISH_EXPORT_COMPLETE_PERCENT - TEMPLATE_PUBLISH_START_PERCENT;
  const estimatedByDuration = Math.round((elapsedMs / Math.max(durationMs, 1)) * span);
  const heartbeatFloor =
    elapsedMs >= heartbeatMs
      ? 1
      : 0;

  return Math.min(
    TEMPLATE_PUBLISH_START_PERCENT + Math.max(estimatedByDuration, heartbeatFloor),
    TEMPLATE_PUBLISH_EXPORT_COMPLETE_PERCENT - 1,
  );
}

function estimateTemplatePublishDurationMs(diskGb: number): number {
  const safeDiskGb = Math.max(diskGb, 1);
  return 15_000 + safeDiskGb * 2_000;
}

function parseTemplatePublishProgressChunk(chunk: string): TemplatePublishProgressSample | null {
  const normalized = stripAnsi(chunk).replace(/\r/g, "\n");
  const packMatches = [...normalized.matchAll(
    /Image pack:\s*([0-9]+(?:\.[0-9]+)?)\s*([KMGTPE]i?B)(?:\s*\(([0-9]+(?:\.[0-9]+)?)\s*([KMGTPE]i?B)\/s\))?/gi,
  )];
  const packMatch = packMatches.at(-1);

  if (packMatch) {
    const processedBytes = parseByteSize(packMatch[1], packMatch[2]);

    if (processedBytes !== null) {
      const speedBytesPerSecond =
        packMatch[3] && packMatch[4]
          ? parseByteSize(packMatch[3], packMatch[4])
          : null;

      return {
        kind: "pack",
        processedBytes,
        speedBytesPerSecond,
        detail: buildTemplatePackDetail(processedBytes, speedBytesPerSecond),
      };
    }
  }

  const exportMatches = [...normalized.matchAll(/Exporting:\s*(\d{1,3})%/gi)];
  const rawValue = exportMatches.at(-1)?.[1];

  if (!rawValue) {
    return null;
  }

  const percent = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(percent)) {
    return null;
  }

  return {
    kind: "export",
    percent: Math.min(Math.max(percent, 0), 100),
    detail: `Exporting: ${Math.min(Math.max(percent, 0), 100)}%`,
  };
}

function mapTemplatePublishProgress(
  sample: TemplatePublishProgressSample,
  diskGb: number,
): number {
  if (sample.kind === "export") {
    return mapTemplatePublishExportPercent(sample.percent);
  }

  return mapTemplatePublishPackProgress(sample.processedBytes, diskGb);
}

function mapTemplatePublishExportPercent(percent: number): number {
  const bounded = Math.min(Math.max(percent, 0), 100);
  const span = TEMPLATE_PUBLISH_EXPORT_COMPLETE_PERCENT - TEMPLATE_PUBLISH_START_PERCENT;
  return TEMPLATE_PUBLISH_START_PERCENT + Math.round((bounded / 100) * span);
}

function mapTemplatePublishPackProgress(processedBytes: number, diskGb: number): number {
  const estimatedTotalBytes = Math.max(Math.round(Math.max(diskGb, 1) * BYTES_PER_GIB), 1);
  const completedFraction = Math.min(Math.max(processedBytes / estimatedTotalBytes, 0), 0.95);
  const span = TEMPLATE_PUBLISH_COMPLETE_PERCENT - TEMPLATE_PUBLISH_EXPORT_COMPLETE_PERCENT;
  return TEMPLATE_PUBLISH_EXPORT_COMPLETE_PERCENT + Math.round(completedFraction * span);
}

function buildTemplatePackDetail(
  processedBytes: number,
  speedBytesPerSecond: number | null,
): string {
  const processedLabel = formatByteCount(processedBytes);

  if (speedBytesPerSecond && speedBytesPerSecond > 0) {
    return `Image pack: ${processedLabel} (${formatByteCount(speedBytesPerSecond)}/s)`;
  }

  return `Image pack: ${processedLabel}`;
}

function formatByteCount(bytes: number): string {
  const absBytes = Math.max(bytes, 0);
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let unitIndex = 0;
  let value = absBytes;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const fractionDigits = value >= 100 || unitIndex === 0
    ? 0
    : value >= 10
      ? 1
      : 2;

  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

function parseByteSize(rawValue: string, rawUnit: string): number | null {
  const value = Number.parseFloat(rawValue);

  if (!Number.isFinite(value) || value < 0) {
    return null;
  }

  const normalizedUnit = rawUnit.trim().toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1000,
    MB: 1000 ** 2,
    GB: 1000 ** 3,
    TB: 1000 ** 4,
    PB: 1000 ** 5,
    KIB: 1024,
    MIB: 1024 ** 2,
    GIB: 1024 ** 3,
    TIB: 1024 ** 4,
    PIB: 1024 ** 5,
  };
  const multiplier = multipliers[normalizedUnit];

  if (!multiplier) {
    return null;
  }

  return Math.round(value * multiplier);
}

function buildProgressEmitter(
  report?: ProviderProgressReporter,
): ProviderProgressReporter {
  let lastKey = "";

  return (message, progressPercent) => {
    if (!report) {
      return;
    }

    const normalizedPercent =
      progressPercent === null || !Number.isFinite(progressPercent)
        ? null
        : Math.min(Math.max(Math.round(progressPercent), 0), 100);
    const key = `${message}\u0000${normalizedPercent ?? "null"}`;

    if (key === lastKey) {
      return;
    }

    lastKey = key;
    report(message, normalizedPercent);
  };
}

function parseVmCreateProgressChunk(
  chunk: string,
): { detail: string | null; percent: number | null } | null {
  const detail = stripAnsi(chunk)
    .split(/[\r\n]+/u)
    .map((line) => line.trim().replace(/\s+/gu, " "))
    .filter((line) => line.length > 0)
    .at(-1);

  if (!detail) {
    return null;
  }

  const percentMatch = detail.match(/(\d{1,3})%/u);

  return {
    detail,
    percent:
      percentMatch && Number.isFinite(Number(percentMatch[1]))
        ? Math.min(Math.max(Number(percentMatch[1]), 0), 100)
        : null,
  };
}

function estimateVmCreateAllocationProgress(
  startedAt: number,
  diskGb: number,
): number {
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const estimatedDurationMs = Math.max(45_000, 15_000 + diskGb * 2_250);
  const fraction = Math.min(elapsedMs / estimatedDurationMs, 0.92);

  return VM_CREATE_ALLOCATION_START_PERCENT + (
    fraction * (VM_CREATE_ALLOCATION_COMPLETE_PERCENT - VM_CREATE_ALLOCATION_START_PERCENT)
  );
}

function estimateVmCreateDesktopWaitProgress(startedAt: number): number {
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const fraction = Math.min(elapsedMs / (60 * 5_000), 0.96);

  return VM_CREATE_DESKTOP_WAIT_START_PERCENT + (
    fraction * (VM_CREATE_READY_PERCENT - VM_CREATE_DESKTOP_WAIT_START_PERCENT)
  );
}

function mapPercentToRange(percent: number, start: number, end: number): number {
  const clampedPercent = Math.min(Math.max(percent, 0), 100);
  return start + (((end - start) * clampedPercent) / 100);
}

function pickTemplatePublishOperation(
  operations: IncusOperation[],
  publishStartedAt: number,
  knownOperationIds: Set<string>,
): IncusOperation | null {
  const candidates = operations
    .filter((operation) => {
      if (!operation.id || knownOperationIds.has(operation.id)) {
        return false;
      }

      if (!parseTemplatePublishOperation(operation)) {
        return false;
      }

      const createdAt = parseTimestamp(operation.created_at);

      if (createdAt === null) {
        return true;
      }

      return createdAt >= publishStartedAt - 5_000;
    })
    .sort((left, right) => {
      const leftCreatedAt = parseTimestamp(left.created_at) ?? Number.POSITIVE_INFINITY;
      const rightCreatedAt = parseTimestamp(right.created_at) ?? Number.POSITIVE_INFINITY;
      return Math.abs(leftCreatedAt - publishStartedAt) - Math.abs(rightCreatedAt - publishStartedAt);
    });

  return candidates[0] ?? null;
}

function parseTemplatePublishOperation(
  operation: IncusOperation,
): TemplatePublishProgressSample | null {
  const progress = operation.metadata?.progress;
  const detail = operation.metadata?.create_image_from_container_pack_progress;

  if (progress?.stage !== "create_image_from_container_pack") {
    return null;
  }

  const percent = parseInteger(progress.percent);

  if (percent !== null) {
    return {
      kind: "export",
      percent: Math.min(Math.max(percent, 0), 100),
      detail: typeof detail === "string" && detail.trim().length > 0
        ? detail.trim()
        : `Exporting: ${Math.min(Math.max(percent, 0), 100)}%`,
    };
  }

  const processedBytes = parseInteger(progress.processed);

  if (processedBytes === null) {
    return null;
  }

  const speedBytesPerSecond = parseInteger(progress.speed);

  return {
    kind: "pack",
    processedBytes,
    speedBytesPerSecond,
    detail: typeof detail === "string" && detail.trim().length > 0
      ? detail.trim()
      : buildTemplatePackDetail(processedBytes, speedBytesPerSecond),
  };
}

function parseInteger(value: string | undefined): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function parseTimestamp(value: string | undefined): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
}

function normalizeStatus(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function describeProbeFailure(result: CommandResult): string {
  if (result.error?.message.includes("ENOENT")) {
    return "Incus mode requested, but the incus CLI was not found on this host.";
  }

  if (isCommandTimeout(result)) {
    return "Incus CLI was found, but the daemon did not answer before the readiness probe timed out.";
  }

  const detail = result.stderr.trim() || result.error?.message || "Unknown Incus error.";
  return `Incus CLI was found, but the daemon is unavailable: ${detail}`;
}

function classifyProbeFailure(result: CommandResult): ProviderState["hostStatus"] {
  if (result.error?.message.includes("ENOENT")) {
    return "missing-cli";
  }

  if (isCommandTimeout(result)) {
    return "daemon-unreachable";
  }

  const detail = `${result.stderr} ${result.stdout}`.trim().toLowerCase();

  if (
    detail.includes("daemon doesn't appear to be started") ||
    detail.includes("server version: unreachable") ||
    detail.includes("unix.socket")
  ) {
    return "daemon-unreachable";
  }

  return "error";
}

function buildProbeNextSteps(status: ProviderState["hostStatus"]): string[] {
  switch (status) {
    case "network-unreachable":
      return [
        "Verify outbound IPv4 and DNS from the control-plane host, especially access to archive.ubuntu.com.",
        "If Docker is installed, ensure FORWARD rules still allow traffic from incusbr0; packaged installs ship parallaize-network-fix.service for this case.",
        "Inspect `journalctl -u parallaize-desktop-bootstrap.service` inside the guest if VNC still never appears after host connectivity is restored.",
      ];
    case "missing-cli":
      return [
        "Run the control plane inside Flox or set PARALLAIZE_INCUS_BIN to a valid Incus binary.",
        "Install the package with `flox install -d . incus` if this environment still lacks Incus.",
        "Initialize the daemon after install with `flox activate -d . -- incus admin init --minimal`.",
      ];
    case "daemon-unreachable":
      return [
        "Start the daemon with your service manager or `flox activate -d . -- incusd` on the target Linux host.",
        "Initialize storage and networking with `flox activate -d . -- incus admin init --minimal` if this is the first run.",
        "Restart the dashboard with PARALLAIZE_PROVIDER=incus once `incus list --format json` succeeds.",
      ];
    case "error":
      return [
        "Run `flox activate -d . -- incus list --format json` on the host and resolve the reported error.",
        "Check any configured Incus project value and host permissions before retrying.",
      ];
    case "ready":
    default:
      return [];
  }
}

function formatCommandFailure(args: string[], result: CommandResult): string {
  if (result.error?.message.includes("ENOENT")) {
    return "Incus mode requested, but the incus CLI was not found on this host.";
  }

  if (isCommandTimeout(result)) {
    return `incus ${args.join(" ")} timed out before the host daemon answered.`;
  }

  const detail =
    result.stderr.trim() ||
    result.error?.message ||
    `Command exited with status ${result.status ?? "unknown"}.`;

  return `incus ${args.join(" ")} failed: ${detail}`;
}

function isCommandTimeout(result: CommandResult): boolean {
  const errorWithCode = result.error as (Error & { code?: string }) | undefined;
  return errorWithCode?.code === "ETIMEDOUT";
}

function isMissingInstanceFailure(message: string): boolean {
  return (
    message.includes("Instance not found") ||
    message.includes("Failed to fetch instance")
  );
}

function isAlreadyRunningFailure(message: string): boolean {
  return message.includes("already running");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
