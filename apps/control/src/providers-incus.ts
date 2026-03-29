import { spawn, spawnSync } from "node:child_process";
import { connect as connectTcp } from "node:net";
import { cpus, freemem, loadavg, networkInterfaces, totalmem } from "node:os";

import { slugify } from "../../../packages/shared/src/helpers.js";
import type {
  EnvironmentTemplate,
  ProviderKind,
  ProviderState,
  ResourceSpec,
  Snapshot,
  VmDiskUsageSnapshot,
  VmFileBrowserSnapshot,
  VmFileEntry,
  VmFileEntryKind,
  VmTouchedFile,
  VmTouchedFileReason,
  VmTouchedFilesSnapshot,
  VmInstance,
  VmLogsSnapshot,
  VmNetworkMode,
  VmSession,
  VmWindow,
} from "../../../packages/shared/src/types.js";
import {
  buildEnsureGuestDesktopBootstrapScript,
  buildGuestDisplayDiscoveryScript,
  buildGuestVncCloudInit,
  DEFAULT_GUEST_HOME,
  type GuestDesktopBootstrapRepairProfile,
} from "./ubuntu-guest-init.js";

const DEFAULT_GUEST_VNC_PORT = 5900;
const DEFAULT_GUEST_INOTIFY_MAX_USER_WATCHES = 1_048_576;
const DEFAULT_GUEST_INOTIFY_MAX_USER_INSTANCES = 2_048;
const DEFAULT_GUEST_DESKTOP_BOOTSTRAP_RETRY_MS = 30_000;
const REUSED_DISK_GUEST_DESKTOP_BOOTSTRAP_RETRY_MS = 5_000;
const DEFAULT_GUEST_AGENT_RETRY_MS = 5_000;
const DEFAULT_GUEST_AGENT_RETRY_TIMEOUT_MS = 60_000;
const DEFAULT_GUEST_WORKSPACE = "/root";
const DEFAULT_GUEST_INIT_LOG_PATH = "/var/log/parallaize-template-init.log";
const DEFAULT_VM_CREATE_HEARTBEAT_MS = 4000;
const VM_CREATE_ALLOCATION_START_PERCENT = 18;
const VM_CREATE_ALLOCATION_COMPLETE_PERCENT = 58;
const VM_CREATE_CONFIGURE_PERCENT = 64;
const VM_CREATE_GUEST_AGENT_PERCENT = 70;
const VM_CREATE_BOOT_START_PERCENT = 76;
const VM_CREATE_DESKTOP_WAIT_START_PERCENT = 84;
const VM_CREATE_READY_PERCENT = 96;
const VM_CLONE_COPY_START_PERCENT = 52;
const VM_CLONE_CONFIGURE_PERCENT = 60;
const VM_CLONE_NETWORK_PERCENT = 68;
const SNAPSHOT_LAUNCH_COPY_START_PERCENT = 48;
const SNAPSHOT_LAUNCH_CONFIGURE_PERCENT = 58;
const SNAPSHOT_LAUNCH_NETWORK_PERCENT = 68;
const DEFAULT_TEMPLATE_PUBLISH_HEARTBEAT_MS = 4000;
const TEMPLATE_PUBLISH_START_PERCENT = 58;
const TEMPLATE_PUBLISH_EXPORT_COMPLETE_PERCENT = 78;
const TEMPLATE_PUBLISH_COMPLETE_PERCENT = 92;
const BYTES_PER_GIB = 1024 ** 3;
const VM_DISK_WARNING_FREE_BYTES = 4 * BYTES_PER_GIB;
const VM_DISK_CRITICAL_FREE_BYTES = BYTES_PER_GIB;
const INCUS_PROBE_TIMEOUT_MS = 1_000;
const HOST_NETWORK_PROBE_CACHE_MS = 60_000;
const HOST_DAEMON_PROBE_CACHE_MS = 60_000;
const HOST_NETWORK_PROBE_TIMEOUT_MS = 2_500;
const PARALLAIZE_DMZ_ACL_NAME = "parallaize-dmz";
const LEGACY_PARALLAIZE_DMZ_ACL_NAME = "parallaize-airgap";
const PARALLAIZE_DMZ_GUEST_DNS_DROPIN_PATH =
  "/etc/systemd/resolved.conf.d/60-parallaize-dmz.conf";
const PARALLAIZE_DMZ_PUBLIC_DNS_SERVERS = [
  "1.1.1.1",
  "1.0.0.1",
  "2606:4700:4700::1111",
  "2606:4700:4700::1001",
];

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
  guestDesktopBootstrapRetryMs?: number;
  guestAgentRetryMs?: number;
  guestAgentRetryTimeoutMs?: number;
  commandRunner?: IncusCommandRunner;
  guestPortProbe?: GuestPortProbe;
  hostNetworkProbe?: HostNetworkProbe;
  hostDaemonProbe?: HostDaemonProbe;
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

export interface VmLogsStreamListeners {
  onAppend?(chunk: string): void;
  onClose?(): void;
  onError?(error: Error): void;
}

export interface VmLogsStreamHandle {
  close(): void;
}

export interface VmFileContent {
  content: Buffer;
  name: string;
  path: string;
}

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
    report?: ProviderProgressReporter,
  ): Promise<ProviderMutation>;
  startVm(vm: VmInstance): Promise<ProviderMutation>;
  stopVm(vm: VmInstance): Promise<ProviderMutation>;
  deleteVm(vm: VmInstance): Promise<ProviderMutation>;
  resizeVm(vm: VmInstance, resources: ResourceSpec): Promise<ProviderMutation>;
  setNetworkMode(vm: VmInstance, networkMode: VmNetworkMode): Promise<ProviderMutation>;
  setDisplayResolution(vm: VmInstance, width: number, height: number): Promise<void>;
  snapshotVm(vm: VmInstance, label: string): Promise<ProviderSnapshot>;
  launchVmFromSnapshot(
    snapshot: Snapshot,
    targetVm: VmInstance,
    template: EnvironmentTemplate,
    report?: ProviderProgressReporter,
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
  readVmLogs(vm: VmInstance): Promise<VmLogsSnapshot>;
  streamVmLogs?(
    vm: VmInstance,
    listeners: VmLogsStreamListeners,
  ): VmLogsStreamHandle;
  readVmDiskUsage?(vm: VmInstance): Promise<VmDiskUsageSnapshot>;
  browseVmFiles(vm: VmInstance, path?: string | null): Promise<VmFileBrowserSnapshot>;
  readVmFile(vm: VmInstance, path: string): Promise<VmFileContent>;
  readVmTouchedFiles(vm: VmInstance): Promise<VmTouchedFilesSnapshot>;
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

interface ResolveSessionOptions {
  requireBootstrapRepairBeforeReady?: boolean;
  guestWallpaperName?: string;
  bootstrapRepairProfile?: GuestDesktopBootstrapRepairProfile;
  bootstrapRepairRetryMs?: number;
}

interface IncusCommandRunner {
  execute(args: string[], options?: CommandExecutionOptions): CommandResult;
  executeStreaming?(
    args: string[],
    listeners?: CommandStreamListeners,
  ): Promise<CommandResult>;
  startStreaming?(
    args: string[],
    listeners?: CommandStreamListeners,
  ): CommandStreamHandle;
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

interface CommandStreamHandle {
  close(): void;
  completed: Promise<CommandResult>;
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

interface HostDaemonProbe {
  probe(): HostDaemonDiagnostic;
}

interface HostDaemonDiagnostic {
  status: "ready" | "conflict" | "unknown";
  detail: string | null;
  nextSteps: string[];
}

interface IncusDaemonOwnershipSnapshot {
  processLines: string[];
  socketActive: boolean | null;
  socketEnabled: boolean | null;
  serviceActive: boolean | null;
  serviceEnabled: boolean | null;
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
  network?: string;
  parent?: string;
  pool?: string;
  source?: string;
  type?: string;
}

interface IncusNetwork {
  config?: Record<string, string>;
  managed?: boolean;
  name?: string;
  type?: string;
}

interface IncusNetworkAclRule {
  action: "allow" | "drop";
  destination?: string;
  destination_port?: string;
  protocol?: string;
  source?: string;
  state: "enabled";
}

interface IncusNetworkAclPayload {
  config: Record<string, string>;
  description: string;
  egress: IncusNetworkAclRule[];
  ingress: IncusNetworkAclRule[];
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

export class MockProvider implements DesktopProvider {
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
      session: buildSyntheticSession(),
    };
  }

  async cloneVm(
    vm: VmInstance,
    targetVm: VmInstance,
    template: EnvironmentTemplate,
    report?: ProviderProgressReporter,
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
        `template: ${template.name}`,
        `network: ${describeVmNetworkMode(targetVm.networkMode)}`,
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

  async setNetworkMode(
    vm: VmInstance,
    networkMode: VmNetworkMode,
  ): Promise<ProviderMutation> {
    return {
      lastAction: `Network mode updated for ${vm.name}`,
      activity: [`network: ${describeVmNetworkMode(networkMode)}`],
      activeWindow: "logs",
      session: vm.session,
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

  async readVmTouchedFiles(vm: VmInstance): Promise<VmTouchedFilesSnapshot> {
    return buildMockVmTouchedFilesSnapshot(vm);
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

export class IncusProvider implements DesktopProvider {
  state: ProviderState;
  private readonly guestVncPort: number;
  private readonly guestInotifyMaxUserWatches: number;
  private readonly guestInotifyMaxUserInstances: number;
  private readonly guestDesktopBootstrapRetryMs: number;
  private readonly guestAgentRetryMs: number;
  private readonly guestAgentRetryTimeoutMs: number;
  private readonly runner: IncusCommandRunner;
  private readonly project: string | null;
  private readonly storagePool: string | null;
  private readonly guestPortProbe: GuestPortProbe;
  private readonly hostNetworkProbe: HostNetworkProbe;
  private readonly hostDaemonProbe: HostDaemonProbe;
  private readonly templatePublishHeartbeatMs: number;
  private readonly templateCompression: IncusImageCompression | null;
  private telemetrySnapshotAt = 0;
  private telemetryInstances = new Map<string, IncusListInstance>();
  private readonly vmCpuUsage = new Map<string, { capturedAt: number; usage: number }>();
  private readonly guestDesktopBootstrapAttemptAt = new Map<string, number>();
  private hostNetworkDiagnosticAt = 0;
  private hostNetworkDiagnostic: HostNetworkDiagnostic = {
    status: "unknown",
    detail: null,
    nextSteps: [],
  };
  private hostDaemonDiagnosticAt = 0;
  private hostDaemonDiagnostic: HostDaemonDiagnostic = {
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
    this.guestDesktopBootstrapRetryMs = Math.max(
      options.guestDesktopBootstrapRetryMs ?? DEFAULT_GUEST_DESKTOP_BOOTSTRAP_RETRY_MS,
      0,
    );
    this.guestAgentRetryMs = Math.max(
      options.guestAgentRetryMs ?? DEFAULT_GUEST_AGENT_RETRY_MS,
      0,
    );
    this.guestAgentRetryTimeoutMs = Math.max(
      options.guestAgentRetryTimeoutMs ?? DEFAULT_GUEST_AGENT_RETRY_TIMEOUT_MS,
      0,
    );
    this.project = options.project ?? null;
    this.storagePool = options.storagePool ?? null;
    this.runner =
      options.commandRunner ??
      new SpawnIncusCommandRunner(this.incusBinary, options.project);
    this.guestPortProbe = options.guestPortProbe ?? new TcpGuestPortProbe();
    this.hostNetworkProbe =
      options.hostNetworkProbe ??
      (options.commandRunner ? new NoopHostNetworkProbe() : new ShellHostNetworkProbe());
    this.hostDaemonProbe =
      options.hostDaemonProbe ??
      (options.commandRunner ? new NoopHostDaemonProbe() : new ShellHostDaemonProbe());
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

    const session = await this.probeReachableSession(info);

    if (session) {
      this.guestDesktopBootstrapAttemptAt.delete(vm.providerRef);
      return session;
    }

    const bootstrapped = await this.maybeEnsureGuestDesktopBootstrapAsync(
      vm.providerRef,
      resolveGuestWallpaperName(vm),
    );

    if (!bootstrapped) {
      return null;
    }

    const refreshedInfo = await this.inspectInstanceAsync(vm.providerRef);

    if (normalizeStatus(refreshedInfo.status ?? refreshedInfo.state?.status) !== "running") {
      return null;
    }

    const refreshedSession = await this.probeReachableSession(refreshedInfo);

    if (refreshedSession) {
      this.guestDesktopBootstrapAttemptAt.delete(vm.providerRef);
    }

    return refreshedSession;
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
      }, resolveGuestWallpaperName(vm)),
    ]);
    emitCreateProgress("Preparing guest agent", VM_CREATE_GUEST_AGENT_PERCENT);
    await this.ensureAgentDeviceAsync(vm.providerRef);
    const networkMode = normalizeVmNetworkMode(vm.networkMode);
    const networkActivity =
      networkMode === "dmz"
        ? await this.ensureInstanceNetworkModeAsync(vm.providerRef, networkMode)
        : `network: ${describeVmNetworkMode(networkMode)}`;
    emitCreateProgress("Starting workspace", VM_CREATE_BOOT_START_PERCENT);
    await this.runAsync(["start", vm.providerRef]);

    const requireBootstrapRepairBeforeReady = shouldRequireGuestBootstrapRepairBeforeReady(template);
    const session = await this.resolveSession(vm.providerRef, emitCreateProgress, {
      guestWallpaperName: resolveGuestWallpaperName(vm),
      requireBootstrapRepairBeforeReady,
      ...(requireBootstrapRepairBeforeReady
        ? {
            bootstrapRepairProfile: "aggressive" as const,
            bootstrapRepairRetryMs: REUSED_DISK_GUEST_DESKTOP_BOOTSTRAP_RETRY_MS,
          }
        : {}),
    });
    await this.syncGuestDnsProfileAsync(vm.providerRef, networkMode);

    if (template.initCommands.length > 0) {
      emitCreateProgress("Running init commands", 98);
      await this.runGuestInitCommandsAsync(vm.providerRef, template.initCommands);
    }

    return {
      lastAction: `Provisioned from ${template.name}`,
      activity: [
        `incus: launched ${vm.providerRef} from ${template.launchSource}`,
        `resources: ${vm.resources.cpu} CPU / ${formatMemoryLimit(vm.resources.ramMb)} / ${formatDiskSize(vm.resources.diskGb)}`,
        ...(template.initCommands.length > 0
          ? [
              `init: ${template.initCommands.length} first-boot command${template.initCommands.length === 1 ? "" : "s"} completed`,
              `init-log: ${DEFAULT_GUEST_INIT_LOG_PATH}`,
            ]
          : []),
        networkActivity,
        ...(networkMode === "dmz" ? [describeGuestDnsProfileActivity(networkMode)] : []),
        session ? `vnc: ${session.display}` : "vnc: guest network pending",
      ].filter((entry): entry is string => Boolean(entry)),
      activeWindow: "terminal",
      workspacePath: DEFAULT_GUEST_WORKSPACE,
      session,
    };
  }

  async cloneVm(
    sourceVm: VmInstance,
    targetVm: VmInstance,
    template: EnvironmentTemplate,
    report?: ProviderProgressReporter,
  ): Promise<ProviderMutation> {
    this.assertAvailable();
    const emitProgress = buildProgressEmitter(report);

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

    emitProgress("Cloning disks", VM_CLONE_COPY_START_PERCENT);
    await this.runAsync(copyArgs);
    emitProgress("Configuring clone", VM_CLONE_CONFIGURE_PERCENT);
    await this.setRootDiskSizeAsync(targetVm.providerRef, targetVm.resources.diskGb);
    await this.ensureAgentDeviceAsync(targetVm.providerRef);
    emitProgress("Applying network", VM_CLONE_NETWORK_PERCENT);
    const networkMode = normalizeVmNetworkMode(targetVm.networkMode);
    const networkActivity =
      networkMode === "dmz"
        ? await this.ensureInstanceNetworkModeAsync(targetVm.providerRef, networkMode)
        : `network: ${describeVmNetworkMode(networkMode)}`;
    emitProgress("Starting workspace", VM_CREATE_BOOT_START_PERCENT);
    await this.runAsync(["start", targetVm.providerRef]);

    const session = await this.resolveSession(targetVm.providerRef, emitProgress, {
      guestWallpaperName: resolveGuestWallpaperName(targetVm),
      // Clones boot from an existing disk image, so cloud-init will not rewrite stale guest services.
      requireBootstrapRepairBeforeReady: true,
      bootstrapRepairProfile: "aggressive",
      bootstrapRepairRetryMs: REUSED_DISK_GUEST_DESKTOP_BOOTSTRAP_RETRY_MS,
    });
    await this.syncGuestDnsProfileAsync(targetVm.providerRef, networkMode);

    return {
      lastAction: `Cloned from ${sourceVm.name}`,
      activity: [
        `incus: cloned ${sourceVm.providerRef} to ${targetVm.providerRef}`,
        `template: ${template.name}`,
        networkActivity,
        ...(networkMode === "dmz" ? [describeGuestDnsProfileActivity(networkMode)] : []),
        session ? `vnc: ${session.display}` : "vnc: guest network pending",
      ].filter((entry): entry is string => Boolean(entry)),
      activeWindow: "terminal",
      workspacePath: sourceVm.workspacePath || DEFAULT_GUEST_WORKSPACE,
      session,
    };
  }

  async startVm(vm: VmInstance): Promise<ProviderMutation> {
    this.assertAvailable();
    await this.ensureAgentDeviceAsync(vm.providerRef);
    const networkMode = normalizeVmNetworkMode(vm.networkMode);
    const networkActivity =
      networkMode === "dmz"
        ? await this.ensureInstanceNetworkModeAsync(vm.providerRef, networkMode)
        : `network: ${describeVmNetworkMode(networkMode)}`;
    const startArgs = ["start", vm.providerRef];
    const startResult = await this.executeAsync(startArgs);

    if (startResult.status !== 0) {
      const failure = formatCommandFailure(startArgs, startResult);

      if (!isAlreadyRunningFailure(failure)) {
        throw new Error(failure);
      }
    }

    const session = await this.resolveSession(vm.providerRef, undefined, {
      guestWallpaperName: resolveGuestWallpaperName(vm),
    });
    await this.syncGuestDnsProfileAsync(vm.providerRef, networkMode);

    return {
      lastAction: "Workspace resumed",
      activity: [
        `incus: started ${vm.providerRef}`,
        networkActivity,
        ...(networkMode === "dmz" ? [describeGuestDnsProfileActivity(networkMode)] : []),
        session ? `vnc: ${session.display}` : "vnc: guest network pending",
      ].filter((entry): entry is string => Boolean(entry)),
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
    await this.deleteInstanceIgnoringMissingAsync(vm.providerRef);

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

  async setNetworkMode(
    vm: VmInstance,
    networkMode: VmNetworkMode,
  ): Promise<ProviderMutation> {
    this.assertAvailable();
    const nextNetworkMode = normalizeVmNetworkMode(networkMode);
    let networkActivity: string;
    let dnsActivity: string;

    if (vm.status === "running" && nextNetworkMode === "dmz") {
      await this.syncGuestDnsProfileAsync(vm.providerRef, nextNetworkMode);
      networkActivity = await this.ensureInstanceNetworkModeAsync(vm.providerRef, nextNetworkMode);
      dnsActivity = describeGuestDnsProfileActivity(nextNetworkMode);
    } else {
      networkActivity = await this.ensureInstanceNetworkModeAsync(vm.providerRef, nextNetworkMode);

      if (vm.status === "running") {
        await this.syncGuestDnsProfileAsync(vm.providerRef, nextNetworkMode);
        dnsActivity = describeGuestDnsProfileActivity(nextNetworkMode);
      } else {
        dnsActivity = describePendingGuestDnsProfileActivity(nextNetworkMode);
      }
    }

    return {
      lastAction: `Network mode updated for ${vm.name}`,
      activity:
        nextNetworkMode === "dmz"
          ? [dnsActivity, networkActivity]
          : [networkActivity, dnsActivity],
      activeWindow: "logs",
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
      buildSetDisplayResolutionScript(
        width,
        height,
        this.guestVncPort,
        resolveGuestWallpaperName(vm),
      ),
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
    report?: ProviderProgressReporter,
  ): Promise<ProviderMutation> {
    this.assertAvailable();
    this.assertLaunchSource(template);
    const emitProgress = buildProgressEmitter(report);

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

    emitProgress("Cloning snapshot", SNAPSHOT_LAUNCH_COPY_START_PERCENT);
    await this.runAsync(copyArgs);
    emitProgress("Configuring snapshot launch", SNAPSHOT_LAUNCH_CONFIGURE_PERCENT);
    await this.setRootDiskSizeAsync(targetVm.providerRef, targetVm.resources.diskGb);
    await this.ensureAgentDeviceAsync(targetVm.providerRef);
    emitProgress("Applying network", SNAPSHOT_LAUNCH_NETWORK_PERCENT);
    const networkMode = normalizeVmNetworkMode(targetVm.networkMode);
    const networkActivity =
      networkMode === "dmz"
        ? await this.ensureInstanceNetworkModeAsync(targetVm.providerRef, networkMode)
        : `network: ${describeVmNetworkMode(networkMode)}`;
    emitProgress("Starting workspace", VM_CREATE_BOOT_START_PERCENT);
    await this.runAsync(["start", targetVm.providerRef]);

    const session = await this.resolveSession(targetVm.providerRef, emitProgress, {
      guestWallpaperName: resolveGuestWallpaperName(targetVm),
      // Snapshot launches also reuse an existing filesystem and need an in-guest bootstrap repair.
      requireBootstrapRepairBeforeReady: true,
      bootstrapRepairProfile: "aggressive",
      bootstrapRepairRetryMs: REUSED_DISK_GUEST_DESKTOP_BOOTSTRAP_RETRY_MS,
    });
    await this.syncGuestDnsProfileAsync(targetVm.providerRef, networkMode);

    return {
      lastAction: `Launched from snapshot ${snapshot.label}`,
      activity: [
        `incus: launched ${targetVm.providerRef} from ${snapshot.providerRef}`,
        `template: ${template.name}`,
        networkActivity,
        ...(networkMode === "dmz" ? [describeGuestDnsProfileActivity(networkMode)] : []),
        session ? `vnc: ${session.display}` : "vnc: guest network pending",
      ].filter((entry): entry is string => Boolean(entry)),
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
    const networkMode = normalizeVmNetworkMode(vm.networkMode);

    if (wasRunning) {
      await this.runAsync(["start", vm.providerRef]);
      session = await this.resolveSession(vm.providerRef, undefined, {
        guestWallpaperName: resolveGuestWallpaperName(vm),
      });
      await this.syncGuestDnsProfileAsync(vm.providerRef, networkMode);
    }

    return {
      lastAction: `Restored ${vm.name} to ${snapshot.label}`,
      activity: [
        `incus: restored ${vm.providerRef} to ${snapshotName}`,
        ...(wasRunning && networkMode === "dmz"
          ? [describeGuestDnsProfileActivity(networkMode)]
          : []),
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
    const publisherInstanceName = buildTemplatePublisherInstanceName(target.templateId);

    report?.("Creating source snapshot", 34);
    await this.runAsync(["snapshot", "create", vm.providerRef, snapshotName]);
    report?.("Preparing publish workspace", 46);

    const copyArgs = [
      "copy",
      `${vm.providerRef}/${snapshotName}`,
      publisherInstanceName,
    ];

    if (this.storagePool) {
      copyArgs.push("-s", this.storagePool);
    }

    await this.runAsync(copyArgs);
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

    let captureFailure: unknown = null;

    try {
      const publishArgs = [
        "publish",
        publisherInstanceName,
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
    } catch (error) {
      captureFailure = error;
    } finally {
      clearInterval(heartbeat);

      try {
        await this.deleteInstanceIgnoringMissingAsync(publisherInstanceName);
      } catch (cleanupError) {
        if (captureFailure) {
          captureFailure = new Error(
            `${errorMessage(captureFailure)}\nCleanup failed after template publish: ${errorMessage(cleanupError)}`,
          );
        } else {
          throw cleanupError;
        }
      }
    }

    if (captureFailure) {
      throw captureFailure;
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

  async readVmLogs(vm: VmInstance): Promise<VmLogsSnapshot> {
    this.assertAvailable();
    const consoleArgs = ["console", vm.providerRef, "--show-log"];
    const consoleResult = await this.executeAsync(consoleArgs);
    const consoleContent = normalizeVmLogContent(consoleResult.stdout);

    if (consoleResult.status === 0 && consoleContent.trim().length > 0) {
      return {
        provider: "incus",
        providerRef: vm.providerRef,
        source: "incus console --show-log",
        content: consoleContent,
        fetchedAt: new Date().toISOString(),
      };
    }

    const infoArgs = ["info", vm.providerRef, "--show-log"];
    const infoResult = await this.executeAsync(infoArgs);
    const infoContent = normalizeVmLogContent(infoResult.stdout);

    if (infoResult.status === 0 && infoContent.trim().length > 0) {
      return {
        provider: "incus",
        providerRef: vm.providerRef,
        source: "incus info --show-log",
        content: infoContent,
        fetchedAt: new Date().toISOString(),
      };
    }

    if (consoleResult.status === 0) {
      return {
        provider: "incus",
        providerRef: vm.providerRef,
        source: "incus console --show-log",
        content: consoleContent,
        fetchedAt: new Date().toISOString(),
      };
    }

    if (infoResult.status === 0) {
      return {
        provider: "incus",
        providerRef: vm.providerRef,
        source: "incus info --show-log",
        content: infoContent,
        fetchedAt: new Date().toISOString(),
      };
    }

    throw new Error(
      [
        formatCommandFailure(consoleArgs, consoleResult),
        formatCommandFailure(infoArgs, infoResult),
      ].filter(Boolean).join("\n"),
    );
  }

  streamVmLogs(
    vm: VmInstance,
    listeners: VmLogsStreamListeners,
  ): VmLogsStreamHandle {
    this.assertAvailable();

    if (!this.runner.startStreaming) {
      queueMicrotask(() => {
        listeners.onError?.(
          new Error("Live VM log streaming is unavailable for the configured Incus runner."),
        );
      });

      return {
        close() {},
      };
    }

    const args = ["console", vm.providerRef];
    let closed = false;
    const stream = this.runner.startStreaming(args, {
      onStdout: (chunk) => {
        const normalizedChunk = normalizeVmLogContent(chunk);

        if (closed || normalizedChunk.length === 0) {
          return;
        }

        listeners.onAppend?.(normalizedChunk);
      },
    });

    void stream.completed.then((result) => {
      if (closed) {
        return;
      }

      if (result.status !== 0) {
        listeners.onError?.(new Error(formatCommandFailure(args, result)));
        return;
      }

      listeners.onClose?.();
    });

    return {
      close() {
        if (closed) {
          return;
        }

        closed = true;
        stream.close();
      },
    };
  }

  async readVmDiskUsage(vm: VmInstance): Promise<VmDiskUsageSnapshot> {
    this.assertAvailable();
    const workspacePath = vm.workspacePath || DEFAULT_GUEST_WORKSPACE;
    const result = await this.runAsync([
      "exec",
      vm.providerRef,
      "--cwd",
      "/",
      "--",
      "sh",
      "-lc",
      buildReadVmDiskUsageScript(workspacePath),
    ]);
    const payload = parseJson<{
      root: VmDiskUsageSnapshot["root"];
      workspace: VmDiskUsageSnapshot["workspace"];
    }>(result.stdout);

    return buildVmDiskUsageSnapshot(vm, payload.root, payload.workspace);
  }

  async browseVmFiles(
    vm: VmInstance,
    path?: string | null,
  ): Promise<VmFileBrowserSnapshot> {
    this.assertAvailable();
    const workspacePath = vm.workspacePath || DEFAULT_GUEST_WORKSPACE;
    const requestedPath = path ? normalizeGuestPath(path) : null;
    const result = await this.runAsync([
      "exec",
      vm.providerRef,
      "--cwd",
      "/",
      "--",
      "sh",
      "-lc",
      buildBrowseVmFilesScript(workspacePath, requestedPath),
    ]);
    const payload = parseJson<{
      homePath: string | null;
      currentPath: string;
      entries: VmFileEntry[];
    }>(result.stdout);

    return {
      vmId: vm.id,
      workspacePath,
      homePath: payload.homePath,
      currentPath: payload.currentPath,
      parentPath: resolveGuestParentPath(payload.currentPath),
      entries: payload.entries,
      generatedAt: new Date().toISOString(),
    };
  }

  async readVmFile(vm: VmInstance, path: string): Promise<VmFileContent> {
    this.assertAvailable();
    const normalizedPath = normalizeGuestPath(path);
    const result = await this.runAsync([
      "exec",
      vm.providerRef,
      "--cwd",
      "/",
      "--",
      "sh",
      "-lc",
      buildReadVmFileScript(normalizedPath),
    ]);
    const payload = parseJson<{
      contentBase64: string;
      name: string;
      path: string;
    }>(result.stdout);

    return {
      content: Buffer.from(payload.contentBase64, "base64"),
      name: payload.name,
      path: payload.path,
    };
  }

  async readVmTouchedFiles(vm: VmInstance): Promise<VmTouchedFilesSnapshot> {
    this.assertAvailable();
    const workspacePath = vm.workspacePath || DEFAULT_GUEST_WORKSPACE;
    const baselineStartedAt = vm.liveSince ?? vm.createdAt ?? null;
    const result = await this.runAsync([
      "exec",
      vm.providerRef,
      "--cwd",
      "/",
      "--",
      "sh",
      "-lc",
      buildReadVmTouchedFilesScript(workspacePath, baselineStartedAt),
    ]);
    const payload = parseJson<{
      entries: VmTouchedFile[];
      scanPath: string;
      truncated: boolean;
    }>(result.stdout);
    const ignoredTouchedSummarySuffix =
      payload.scanPath === DEFAULT_GUEST_HOME ? ` ${DEFAULT_GUEST_HOME}/.cache is ignored.` : "";

    return {
      vmId: vm.id,
      workspacePath,
      scanPath: payload.scanPath,
      baselineStartedAt,
      baselineLabel:
        vm.liveSince !== null
          ? "Best effort since the VM last started."
          : "Best effort since the workspace was first created.",
      limitationSummary: payload.truncated
        ? `Uses mtime/ctime under ${payload.scanPath} plus command-history directories. Large trees are capped at 5,000 scanned paths and 200 returned entries.${ignoredTouchedSummarySuffix}`
        : `Uses mtime/ctime under ${payload.scanPath} plus command-history directories. Shell commands are not parsed deeply, so edits can be missed or over-reported.${ignoredTouchedSummarySuffix}`,
      entries: mergeTouchedFilesWithCommandHistory(
        payload.entries,
        vm.commandHistory ?? [],
        payload.scanPath,
      ),
      generatedAt: new Date().toISOString(),
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
      this.getHostDaemonDiagnostic(),
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

  private getHostDaemonDiagnostic(): HostDaemonDiagnostic {
    const now = Date.now();

    if (now - this.hostDaemonDiagnosticAt < HOST_DAEMON_PROBE_CACHE_MS) {
      return this.hostDaemonDiagnostic;
    }

    this.hostDaemonDiagnosticAt = now;

    try {
      this.hostDaemonDiagnostic = this.hostDaemonProbe.probe();
    } catch {
      this.hostDaemonDiagnostic = {
        status: "unknown",
        detail: null,
        nextSteps: [],
      };
    }

    return this.hostDaemonDiagnostic;
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

  private async ensureInstanceNetworkModeAsync(
    instanceName: string,
    networkMode: VmNetworkMode,
  ): Promise<string> {
    const nic = await this.resolvePrimaryNetworkDeviceAsync(instanceName);

    if (!nic) {
      return `network: ${describeVmNetworkMode(networkMode)}`;
    }

    if (networkMode !== "dmz") {
      await this.clearNicSecurityOverridesAsync(instanceName, nic.deviceName);
      return `network: ${describeVmNetworkMode(networkMode)}`;
    }

    const aclName = await this.ensureManagedDmzAclAsync(nic.networkName);
    await this.applyNicSecurityOverridesAsync(instanceName, nic.deviceName, [
      `security.acls=${aclName}`,
      "security.acls.default.egress.action=reject",
      "security.acls.default.ingress.action=reject",
      "security.port_isolation=true",
      "security.mac_filtering=true",
    ]);

    return `network: ${describeVmNetworkMode(networkMode)} via ${aclName}`;
  }

  private async resolvePrimaryNetworkDeviceAsync(
    instanceName: string,
  ): Promise<{ deviceName: string; networkName: string } | null> {
    const devices = await this.inspectInstanceExpandedDevicesAsync(instanceName);
    const match = Object.entries(devices).find(([, device]) => {
      const networkName = device.network ?? device.parent;
      return device.type === "nic" && typeof networkName === "string" && networkName.length > 0;
    });

    if (!match) {
      return null;
    }

    return {
      deviceName: match[0],
      networkName: match[1].network ?? match[1].parent ?? "",
    };
  }

  private async inspectNetworkAsync(networkName: string): Promise<IncusNetwork> {
    const result = await this.runAsync([
      "query",
      `/1.0/networks/${encodeURIComponent(networkName)}`,
    ]);

    return parseJson<IncusNetwork>(result.stdout);
  }

  private async ensureManagedDmzAclAsync(networkName: string): Promise<string> {
    const network = await this.inspectNetworkAsync(networkName);

    if (network.managed !== true || network.type !== "bridge") {
      throw new Error(
        `DMZ mode requires a managed bridge network, but ${networkName} is not a managed bridge.`,
      );
    }

    const bridgeIpv4 = normalizeAclHostAddress(network.config?.["ipv4.address"]);
    const bridgeIpv6 = normalizeAclHostAddress(network.config?.["ipv6.address"]);

    if (!bridgeIpv4 && !bridgeIpv6) {
      throw new Error(`Managed bridge ${networkName} does not expose an IPv4 or IPv6 address.`);
    }

    const aclName = await this.resolveManagedDmzAclNameAsync();
    await this.upsertNetworkAclAsync(
      aclName,
      buildDmzAclPayload({
        bridgeIpv4,
        bridgeIpv6,
        hostAddresses: collectHostAclAddresses(),
      }),
    );

    return aclName;
  }

  private async resolveManagedDmzAclNameAsync(): Promise<string> {
    const primary = await this.inspectNetworkAclAsync(PARALLAIZE_DMZ_ACL_NAME);

    if (primary) {
      return PARALLAIZE_DMZ_ACL_NAME;
    }

    const legacy = await this.inspectNetworkAclAsync(LEGACY_PARALLAIZE_DMZ_ACL_NAME);

    if (legacy?.config["user.parallaize.managed"] === "true") {
      return LEGACY_PARALLAIZE_DMZ_ACL_NAME;
    }

    return PARALLAIZE_DMZ_ACL_NAME;
  }

  private async inspectNetworkAclAsync(
    aclName: string,
  ): Promise<IncusNetworkAclPayload | null> {
    const result = await this.executeAsync([
      "query",
      `/1.0/network-acls/${encodeURIComponent(aclName)}`,
    ]);

    if (result.status !== 0) {
      return null;
    }

    return parseJson<IncusNetworkAclPayload>(result.stdout);
  }

  private async upsertNetworkAclAsync(
    aclName: string,
    payload: IncusNetworkAclPayload,
  ): Promise<void> {
    if (!(await this.inspectNetworkAclAsync(aclName))) {
      await this.runAsync([
        "network",
        "acl",
        "create",
        aclName,
        "--description",
        payload.description,
      ]);
    }

    await this.runAsync([
      "query",
      "-X",
      "PUT",
      "--wait",
      "-d",
      JSON.stringify(payload),
      `/1.0/network-acls/${encodeURIComponent(aclName)}`,
    ]);
  }

  private async applyNicSecurityOverridesAsync(
    instanceName: string,
    deviceName: string,
    values: string[],
  ): Promise<void> {
    const overrideArgs = [
      "config",
      "device",
      "override",
      instanceName,
      deviceName,
      ...values,
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
      deviceName,
      ...values,
    ]);
  }

  private async clearNicSecurityOverridesAsync(
    instanceName: string,
    deviceName: string,
  ): Promise<void> {
    for (const key of [
      "security.acls",
      "security.acls.default.egress.action",
      "security.acls.default.ingress.action",
      "security.port_isolation",
      "security.mac_filtering",
    ]) {
      const args = [
        "config",
        "device",
        "unset",
        instanceName,
        deviceName,
        key,
      ];
      const result = await this.executeAsync(args);

      if (result.status === 0) {
        continue;
      }

      const failure = formatCommandFailure(args, result);

      if (!isMissingDeviceConfigFailure(failure)) {
        throw new Error(failure);
      }
    }
  }

  private async syncGuestDnsProfileAsync(
    instanceName: string,
    networkMode: VmNetworkMode,
  ): Promise<void> {
    await this.runGuestExecWithRetryAsync([
      "exec",
      instanceName,
      "--",
      "sh",
      "-lc",
      buildGuestDnsProfileScript(networkMode),
    ]);
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
    options?: ResolveSessionOptions,
  ): Promise<VmSession | null> {
    this.guestDesktopBootstrapAttemptAt.delete(instanceName);
    let address: string | null = null;
    const waitStartedAt = Date.now();
    const emitProgress = report;
    let bootstrapConfirmed = !options?.requireBootstrapRepairBeforeReady;
    const bootstrapRepairProfile = options?.bootstrapRepairProfile ?? "standard";
    const bootstrapRepairRetryMs =
      options?.bootstrapRepairRetryMs ?? this.guestDesktopBootstrapRetryMs;

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const info = await this.inspectInstanceAsync(instanceName);
      const addresses = findGuestAddressCandidates(info);
      address = addresses[0] ?? null;

      if (!bootstrapConfirmed) {
        bootstrapConfirmed = await this.ensureGuestDesktopBootstrapAsync(
          instanceName,
          options?.guestWallpaperName,
          bootstrapRepairProfile,
        );
      }

      const session = await this.probeReachableSessionForAddresses(addresses);

      if (session && bootstrapConfirmed) {
        this.guestDesktopBootstrapAttemptAt.delete(instanceName);
        emitProgress?.("Desktop session ready", VM_CREATE_READY_PERCENT);
        return session;
      }

      if (bootstrapConfirmed) {
        await this.maybeEnsureGuestDesktopBootstrapAsync(
          instanceName,
          options?.guestWallpaperName,
          bootstrapRepairProfile,
          bootstrapRepairRetryMs,
        );
      }

      if (normalizeStatus(info.status ?? info.state?.status) !== "running") {
        break;
      }

      emitProgress?.(
        bootstrapConfirmed
          ? address
            ? "Waiting for desktop"
            : "Waiting for guest network"
          : "Preparing desktop bridge",
        estimateVmCreateDesktopWaitProgress(waitStartedAt),
      );
      await sleep(5000);
    }

    return buildVncSession(address, this.guestVncPort, false);
  }

  private async maybeEnsureGuestDesktopBootstrapAsync(
    instanceName: string,
    guestWallpaperName?: string,
    bootstrapRepairProfile: GuestDesktopBootstrapRepairProfile = "standard",
    bootstrapRetryMs: number = this.guestDesktopBootstrapRetryMs,
  ): Promise<boolean> {
    const now = Date.now();
    const lastAttemptAt = this.guestDesktopBootstrapAttemptAt.get(instanceName) ?? 0;

    if (now - lastAttemptAt < bootstrapRetryMs) {
      return false;
    }

    this.guestDesktopBootstrapAttemptAt.set(instanceName, now);
    return this.ensureGuestDesktopBootstrapAsync(
      instanceName,
      guestWallpaperName,
      bootstrapRepairProfile,
    );
  }

  private async ensureGuestDesktopBootstrapAsync(
    instanceName: string,
    guestWallpaperName?: string,
    bootstrapRepairProfile: GuestDesktopBootstrapRepairProfile = "standard",
  ): Promise<boolean> {
    const args = [
      "exec",
      instanceName,
      "--",
      "sh",
      "-lc",
      buildEnsureGuestDesktopBootstrapScript(
        this.guestVncPort,
        false,
        guestWallpaperName,
        bootstrapRepairProfile,
      ),
    ];
    const result = await this.executeGuestExecWithRetryAsync(args);

    if (result.status !== 0 && isGuestAgentUnavailableExecFailure(args, result)) {
      throw new Error(formatCommandFailure(args, result));
    }

    return result.status === 0;
  }

  private async runGuestInitCommandsAsync(
    instanceName: string,
    initCommands: string[],
  ): Promise<void> {
    if (initCommands.length === 0) {
      return;
    }

    await this.runGuestExecWithRetryAsync([
      "exec",
      instanceName,
      "--cwd",
      DEFAULT_GUEST_WORKSPACE,
      "--",
      "sh",
      "-lc",
      buildGuestInitCommandsScript(initCommands),
    ]);
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

  private async executeGuestExecWithRetryAsync(
    args: string[],
    listeners?: CommandStreamListeners,
  ): Promise<CommandResult> {
    const deadlineAt = Date.now() + this.guestAgentRetryTimeoutMs;

    while (true) {
      const result = await this.executeAsync(args, listeners);

      if (result.status === 0 || !isGuestAgentUnavailableExecFailure(args, result)) {
        return result;
      }

      if (Date.now() >= deadlineAt) {
        return result;
      }

      await sleep(this.guestAgentRetryMs);
    }
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

  private async runGuestExecWithRetryAsync(
    args: string[],
    listeners?: CommandStreamListeners,
  ): Promise<CommandResult> {
    const result = await this.executeGuestExecWithRetryAsync(args, listeners);

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

  private async deleteInstanceIgnoringMissingAsync(instanceName: string): Promise<void> {
    const deleteArgs = ["delete", instanceName, "--force"];
    const deleteResult = await this.executeAsync(deleteArgs);

    if (deleteResult.status !== 0) {
      const failure = formatCommandFailure(deleteArgs, deleteResult);

      if (!isMissingInstanceFailure(failure)) {
        throw new Error(failure);
      }
    }
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
    return this.startStreaming(args, listeners).completed;
  }

  startStreaming(
    args: string[],
    listeners: CommandStreamListeners = {},
  ): CommandStreamHandle {
    const fullArgs = this.project
      ? ["--project", this.project, ...args]
      : args;
    const child = spawn(this.incusBinary, fullArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const completed = new Promise<CommandResult>((resolve) => {
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

    return {
      close() {
        if (child.killed) {
          return;
        }

        child.kill();
      },
      completed,
    };
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

class NoopHostDaemonProbe implements HostDaemonProbe {
  probe(): HostDaemonDiagnostic {
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

class ShellHostDaemonProbe implements HostDaemonProbe {
  probe(): HostDaemonDiagnostic {
    const processResult = spawnSync("bash", ["-lc", "pgrep -af '[i]ncusd' || true"], {
      encoding: "utf8",
      timeout: HOST_NETWORK_PROBE_TIMEOUT_MS,
    });

    return diagnoseIncusDaemonConflict({
      processLines: parseIncusdProcessLines(processResult.stdout),
      socketActive: readSystemdUnitState("incus.socket", "ActiveState"),
      socketEnabled: readSystemdUnitState("incus.socket", "UnitFileState"),
      serviceActive: readSystemdUnitState("incus.service", "ActiveState"),
      serviceEnabled: readSystemdUnitState("incus.service", "UnitFileState"),
    });
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
  hostDaemonDiagnostic: HostDaemonDiagnostic,
): ProviderState {
  if (hostDaemonDiagnostic.status === "conflict") {
    return {
      kind: "incus",
      available: result.status === 0,
      detail:
        hostDaemonDiagnostic.detail ??
        "Mixed Incus daemon ownership detected on the host.",
      hostStatus: "daemon-conflict",
      binaryPath: incusBinary,
      project,
      desktopTransport: "novnc",
      nextSteps: hostDaemonDiagnostic.nextSteps,
    };
  }

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
  reachable = true,
): VmSession {
  return {
    kind: "vnc",
    host,
    port,
    reachable,
    webSocketPath: null,
    browserPath: null,
    display: host
      ? reachable
        ? `${formatNetworkEndpoint(host, port)}`
        : `${formatNetworkEndpoint(host, port)} pending VNC`
      : `guest VNC on port ${port} pending DHCP`,
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

function buildSetDisplayResolutionScript(
  width: number,
  height: number,
  port: number,
  guestWallpaperName?: string,
): string {
  return `set -eu
WIDTH=${width}
HEIGHT=${height}
${buildEnsureGuestDesktopBootstrapScript(port, true, guestWallpaperName)}
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

function buildGuestInitCommandsScript(initCommands: string[]): string {
  return `set -eu
LOG_FILE="${DEFAULT_GUEST_INIT_LOG_PATH}"
mkdir -p "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"
TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM
run_init_command() {
  command_index="$1"
  script_path="$2"
  printf '%s\\n' "==> init command $command_index started" >> "$LOG_FILE"
  sh "$script_path" >> "$LOG_FILE" 2>&1
  printf '%s\\n' "==> init command $command_index finished" >> "$LOG_FILE"
}
${initCommands.map((command, index) => {
  const scriptName = `"$TMP_DIR/${String(index + 1).padStart(2, "0")}.sh"`;
  const marker = `PARALLAIZE_INIT_${String(index + 1).padStart(2, "0")}`;
  return `cat > ${scriptName} <<'${marker}'
${command}
${marker}
run_init_command ${index + 1} ${scriptName}`;
}).join("\n")}`;
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

function buildTemplatePublisherInstanceName(templateId: string): string {
  return `parallaize-template-publish-${slugify(templateId)}-${Date.now().toString(36)}`;
}

function resolveGuestWallpaperName(vm: Pick<VmInstance, "name" | "wallpaperName">): string {
  const wallpaperName =
    typeof vm.wallpaperName === "string" ? vm.wallpaperName.trim() : "";

  return wallpaperName || vm.name;
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

function normalizeVmLogContent(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

function shouldRequireGuestBootstrapRepairBeforeReady(
  template: EnvironmentTemplate,
): boolean {
  return template.launchSource.startsWith("parallaize-template-");
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

function buildMockVmFileBrowserSnapshot(
  vm: VmInstance,
  path?: string | null,
): VmFileBrowserSnapshot {
  const currentPath = normalizeGuestPath(path ?? resolveMockVmBrowsePath(vm));
  const generatedAt = new Date().toISOString();
  const entries = buildMockVmFileEntries(vm, currentPath, generatedAt);

  return {
    vmId: vm.id,
    workspacePath: vm.workspacePath,
    homePath: resolveMockVmHomePath(),
    currentPath,
    parentPath: resolveGuestParentPath(currentPath),
    entries,
    generatedAt,
  };
}

function buildMockVmFileEntries(
  vm: VmInstance,
  currentPath: string,
  generatedAt: string,
): VmFileEntry[] {
  const workspacePath = normalizeGuestPath(vm.workspacePath || DEFAULT_GUEST_WORKSPACE);
  const workspaceLeaf = workspacePath.split("/").pop() ?? "workspace";
  const buildEntry = (
    name: string,
    kind: VmFileEntryKind,
    sizeBytes: number | null,
  ): VmFileEntry => ({
    name,
    path: currentPath === "/" ? `/${name}` : `${currentPath}/${name}`,
    kind,
    sizeBytes,
    modifiedAt: generatedAt,
    changedAt: generatedAt,
  });

  if (currentPath === "/") {
    return [
      buildEntry("etc", "directory", null),
      buildEntry("home", "directory", null),
      buildEntry("srv", "directory", null),
      buildEntry("var", "directory", null),
    ];
  }

  if (currentPath === "/etc") {
    return [
      buildEntry("hosts", "file", 188),
      buildEntry("ssh", "directory", null),
    ];
  }

  if (currentPath === "/home") {
    return [buildEntry("ubuntu", "directory", null)];
  }

  if (currentPath === "/home/ubuntu") {
    return [
      buildEntry(".bashrc", "file", 3771),
      buildEntry("Desktop", "directory", null),
      buildEntry("Downloads", "directory", null),
      buildEntry("notes.txt", "file", 184),
    ];
  }

  if (currentPath === "/home/ubuntu/Desktop") {
    return [buildEntry("Parralaize.url", "file", 92)];
  }

  if (currentPath === "/home/ubuntu/Downloads") {
    return [buildEntry("session.log", "file", 4096)];
  }

  if (currentPath === "/srv") {
    return [buildEntry("workspaces", "directory", null)];
  }

  if (currentPath === "/srv/workspaces") {
    return [buildEntry(workspaceLeaf, "directory", null)];
  }

  if (currentPath.endsWith("/src")) {
    return [
      buildEntry("main.ts", "file", 1324),
      buildEntry("DashboardApp.tsx", "file", 8421),
      buildEntry("styles.css", "file", 2440),
    ];
  }

  if (currentPath.endsWith("/.config")) {
    return [buildEntry("settings.json", "file", 612)];
  }

  if (currentPath.endsWith("/logs")) {
    return [buildEntry("session.log", "file", 4096)];
  }

  if (currentPath === workspacePath) {
    return [
      buildEntry("src", "directory", null),
      buildEntry(".config", "directory", null),
      buildEntry("logs", "directory", null),
      buildEntry("README.md", "file", 1902),
    ];
  }

  return [
    buildEntry("src", "directory", null),
    buildEntry(".config", "directory", null),
    buildEntry("logs", "directory", null),
    buildEntry("README.md", "file", 1902),
  ];
}

function buildMockVmFileContent(vm: VmInstance, path: string): VmFileContent {
  const normalizedPath = normalizeGuestPath(path);

  if (isMockDirectoryPath(vm, normalizedPath)) {
    throw new Error(`${normalizedPath} is a directory.`);
  }

  const contentByPath = new Map<string, string>([
    ["/home/ubuntu/.bashrc", "export EDITOR=vim\nalias ll='ls -alF'\n"],
    ["/home/ubuntu/notes.txt", "Remember to collect logs before deleting this workspace.\n"],
    ["/home/ubuntu/Desktop/Parralaize.url", "[InternetShortcut]\nURL=https://parallaize.local/\n"],
    ["/home/ubuntu/Downloads/session.log", "mock session log\n"],
    ["/etc/hosts", "127.0.0.1 localhost\n127.0.1.1 ubuntu\n"],
  ]);

  const workspacePath = normalizeGuestPath(vm.workspacePath || DEFAULT_GUEST_WORKSPACE);
  contentByPath.set(`${workspacePath}/README.md`, "# Mock workspace\n");
  contentByPath.set(`${workspacePath}/src/main.ts`, "console.log('mock workspace');\n");
  contentByPath.set(
    `${workspacePath}/src/DashboardApp.tsx`,
    "export function DashboardApp() {\n  return null;\n}\n",
  );
  contentByPath.set(`${workspacePath}/src/styles.css`, ".workspace {}\n");
  contentByPath.set(
    `${workspacePath}/.config/settings.json`,
    JSON.stringify({ theme: "light", autosave: true }, null, 2),
  );
  contentByPath.set(`${workspacePath}/logs/session.log`, "mock workspace log\n");

  return {
    content: Buffer.from(contentByPath.get(normalizedPath) ?? "mock file\n", "utf8"),
    name: normalizedPath.split("/").pop() ?? "download",
    path: normalizedPath,
  };
}

function buildMockVmTouchedFilesSnapshot(vm: VmInstance): VmTouchedFilesSnapshot {
  const generatedAt = new Date().toISOString();
  const baselineStartedAt = vm.liveSince ?? vm.createdAt ?? null;
  const workspacePath = vm.workspacePath;
  const commandPaths = Array.from(
    new Set((vm.commandHistory ?? []).map((entry) => normalizeGuestPath(entry.workspacePath))),
  ).filter((path) => !isIgnoredTouchedFilesPath(workspacePath, path));
  const entries: VmTouchedFile[] =
    commandPaths.length > 0
      ? commandPaths.map((path) => ({
          name: path === workspacePath ? "." : path.split("/").pop() ?? path,
          path,
          kind: "directory",
          sizeBytes: null,
          modifiedAt: generatedAt,
          changedAt: generatedAt,
          reasons: ["command-history"],
        }))
      : [
          {
            name: "README.md",
            path: `${workspacePath}/README.md`,
            kind: "file",
            sizeBytes: 1902,
            modifiedAt: generatedAt,
            changedAt: generatedAt,
            reasons: ["mtime"],
          },
        ];

  return {
    vmId: vm.id,
    workspacePath,
    scanPath: workspacePath,
    baselineStartedAt,
    baselineLabel:
      vm.liveSince !== null
        ? "Best effort since the VM last started."
        : "Best effort since the workspace was first created.",
    limitationSummary:
      "Mock mode uses command history and synthetic timestamps only. It is a UI stand-in for the real guest scan.",
    entries,
    generatedAt,
  };
}

function buildMockVmDiskUsageSnapshot(vm: VmInstance): VmDiskUsageSnapshot {
  const workspacePath = normalizeGuestPath(vm.workspacePath || DEFAULT_GUEST_WORKSPACE);
  const sizeBytes = Math.max(vm.resources.diskGb, 1) * BYTES_PER_GIB;
  const usedPercent = Math.min(96, 68 + (vm.screenSeed % 25));
  const usedBytes = Math.round((sizeBytes * usedPercent) / 100);
  const availableBytes = Math.max(0, sizeBytes - usedBytes);
  const sharedMount = {
    mountPath: "/",
    filesystem: "mockfs",
    sizeBytes,
    usedBytes,
    availableBytes,
    usedPercent,
  };

  return buildVmDiskUsageSnapshot(
    vm,
    {
      path: "/",
      ...sharedMount,
    },
    {
      path: workspacePath,
      ...sharedMount,
    },
  );
}

function buildReadVmDiskUsageScript(workspacePath: string): string {
  return `python3 - <<'PY'
import json
import os
import subprocess

workspace_path = ${JSON.stringify(workspacePath)}

def resolve_existing_path(candidate: str) -> str:
  current = os.path.abspath(candidate or "/")
  while not os.path.exists(current):
    parent = os.path.dirname(current)
    if parent == current:
      return "/"
    current = parent
  return current

def read_usage(target_path: str):
  existing_path = resolve_existing_path(target_path)
  output = subprocess.check_output(["df", "-B1", "-P", existing_path], text=True)
  lines = [line for line in output.splitlines() if line.strip()]
  if len(lines) < 2:
    raise RuntimeError(f"Unexpected df output for {existing_path}: {output!r}")
  parts = lines[-1].split()
  if len(parts) < 6:
    raise RuntimeError(f"Unexpected df row for {existing_path}: {lines[-1]!r}")
  filesystem = parts[0]
  size_bytes = int(parts[1])
  used_bytes = int(parts[2])
  available_bytes = int(parts[3])
  used_percent = int(parts[4].rstrip("%")) if parts[4].endswith("%") else None
  mount_path = " ".join(parts[5:])
  return {
    "path": os.path.abspath(target_path),
    "mountPath": mount_path,
    "filesystem": filesystem,
    "sizeBytes": size_bytes,
    "usedBytes": used_bytes,
    "availableBytes": available_bytes,
    "usedPercent": used_percent,
  }

print(json.dumps({
  "root": read_usage("/"),
  "workspace": read_usage(workspace_path),
}))
PY`;
}

function buildBrowseVmFilesScript(
  workspacePath: string,
  requestedPath: string | null,
): string {
  const requestedPathLiteral = requestedPath === null
    ? "None"
    : JSON.stringify(requestedPath);

  return `python3 - <<'PY'
import datetime
import json
import os
import stat

workspace_path = ${JSON.stringify(workspacePath)}
requested_path = ${requestedPathLiteral}
home_path = "/home/ubuntu" if os.path.isdir("/home/ubuntu") else None

def isoformat(timestamp: float) -> str:
  return datetime.datetime.fromtimestamp(
    timestamp,
    datetime.timezone.utc,
  ).isoformat().replace("+00:00", "Z")

def entry_kind(mode: int) -> str:
  if stat.S_ISDIR(mode):
    return "directory"
  if stat.S_ISREG(mode):
    return "file"
  if stat.S_ISLNK(mode):
    return "symlink"
  return "other"

if requested_path is not None:
  browse_path = requested_path
else:
  browse_path = next(
    (
      candidate
      for candidate in (home_path, workspace_path, "/")
      if candidate is not None and os.path.isdir(candidate)
    ),
    "/",
  )

if not os.path.isdir(browse_path):
  raise NotADirectoryError(f"{browse_path} is not a directory")

os.chdir(browse_path)
current_path = os.getcwd()
entries = []

for entry in sorted(
  os.scandir(current_path),
  key=lambda item: (not item.is_dir(follow_symlinks=False), item.name.lower(), item.name),
):
  stats = entry.stat(follow_symlinks=False)
  kind = entry_kind(stats.st_mode)
  entries.append({
    "name": entry.name,
    "path": entry.path,
    "kind": kind,
    "sizeBytes": None if kind == "directory" else int(stats.st_size),
    "modifiedAt": isoformat(stats.st_mtime),
    "changedAt": isoformat(stats.st_ctime),
  })

print(json.dumps({
  "homePath": home_path,
  "currentPath": current_path,
  "entries": entries,
}))
PY`;
}

function buildReadVmFileScript(path: string): string {
  return `python3 - <<'PY'
import base64
import json
import os

file_path = ${JSON.stringify(path)}

if not os.path.exists(file_path):
  raise FileNotFoundError(file_path)

if os.path.isdir(file_path):
  raise IsADirectoryError(file_path)

with open(file_path, "rb") as handle:
  content = handle.read()

print(json.dumps({
  "contentBase64": base64.b64encode(content).decode("ascii"),
  "name": os.path.basename(file_path) or "download",
  "path": os.path.abspath(file_path),
}))
PY`;
}

function buildReadVmTouchedFilesScript(
  workspacePath: string,
  baselineStartedAt: string | null,
): string {
  const parsedBaselineMs = baselineStartedAt ? Date.parse(baselineStartedAt) : Number.NaN;
  const baselineSeconds = Number.isFinite(parsedBaselineMs)
    ? Math.max(0, parsedBaselineMs / 1000)
    : 0;

  return `python3 - <<'PY'
import datetime
import json
import os
import stat

workspace_path = ${JSON.stringify(workspacePath)}
scan_path = ${JSON.stringify(DEFAULT_GUEST_HOME)} if os.path.isdir(${JSON.stringify(DEFAULT_GUEST_HOME)}) else workspace_path
ignored_paths = {
  os.path.normpath(${JSON.stringify(`${DEFAULT_GUEST_HOME}/.cache`)})
} if scan_path == ${JSON.stringify(DEFAULT_GUEST_HOME)} else set()
baseline = ${baselineSeconds}
max_scanned = 5000
max_returned = 200
scanned = 0
truncated = False
entries = []

def isoformat(timestamp: float) -> str:
  return datetime.datetime.fromtimestamp(
    timestamp,
    datetime.timezone.utc,
  ).isoformat().replace("+00:00", "Z")

def entry_kind(mode: int) -> str:
  if stat.S_ISDIR(mode):
    return "directory"
  if stat.S_ISREG(mode):
    return "file"
  if stat.S_ISLNK(mode):
    return "symlink"
  return "other"

for root, dirnames, filenames in os.walk(scan_path):
  dirnames.sort()
  filenames.sort()
  dirnames[:] = [
    name
    for name in dirnames
    if os.path.normpath(os.path.join(root, name)) not in ignored_paths
  ]
  for name in [*dirnames, *filenames]:
    path = os.path.join(root, name)
    try:
      stats = os.lstat(path)
    except OSError:
      continue
    scanned += 1
    reasons = []
    if stats.st_mtime >= baseline:
      reasons.append("mtime")
    if stats.st_ctime >= baseline:
      reasons.append("ctime")
    if reasons:
      entries.append({
        "name": name,
        "path": path,
        "kind": entry_kind(stats.st_mode),
        "sizeBytes": None if stat.S_ISDIR(stats.st_mode) else int(stats.st_size),
        "modifiedAt": isoformat(stats.st_mtime),
        "changedAt": isoformat(stats.st_ctime),
        "reasons": reasons,
        "_sort": max(stats.st_mtime, stats.st_ctime),
      })
    if scanned >= max_scanned:
      truncated = True
      break
  if truncated:
    break

entries.sort(key=lambda item: item["_sort"], reverse=True)
for entry in entries:
  del entry["_sort"]

print(json.dumps({
  "entries": entries[:max_returned],
  "scanPath": scan_path,
  "truncated": truncated,
}))
PY`;
}

function mergeTouchedFilesWithCommandHistory(
  entries: VmTouchedFile[],
  commandHistory: VmInstance["commandHistory"],
  workspacePath: string,
): VmTouchedFile[] {
  const merged = new Map<string, VmTouchedFile>();

  for (const entry of entries) {
    merged.set(entry.path, {
      ...entry,
      reasons: sortTouchedFileReasons(entry.reasons),
    });
  }

  for (const commandEntry of commandHistory ?? []) {
    const candidatePath = normalizeGuestPath(commandEntry.workspacePath);

    if (!isWithinGuestWorkspacePath(workspacePath, candidatePath)) {
      continue;
    }

    if (isIgnoredTouchedFilesPath(workspacePath, candidatePath)) {
      continue;
    }

    const existing = merged.get(candidatePath);

    if (existing) {
      if (!existing.reasons.includes("command-history")) {
        existing.reasons = sortTouchedFileReasons([
          ...existing.reasons,
          "command-history",
        ]);
      }
      continue;
    }

    merged.set(candidatePath, {
      name: candidatePath === workspacePath ? "." : candidatePath.split("/").pop() ?? candidatePath,
      path: candidatePath,
      kind: "directory",
      sizeBytes: null,
      modifiedAt: null,
      changedAt: null,
      reasons: ["command-history"],
    });
  }

  return [...merged.values()]
    .sort((left, right) => touchedFileSortValue(right) - touchedFileSortValue(left))
    .slice(0, 200);
}

function isIgnoredTouchedFilesPath(scanPath: string, candidatePath: string): boolean {
  const normalizedScanPath = normalizeGuestPath(scanPath);
  const normalizedCandidatePath = normalizeGuestPath(candidatePath);

  if (normalizedScanPath !== DEFAULT_GUEST_HOME) {
    return false;
  }

  const ignoredPath = `${DEFAULT_GUEST_HOME}/.cache`;
  return (
    normalizedCandidatePath === ignoredPath ||
    normalizedCandidatePath.startsWith(`${ignoredPath}/`)
  );
}

function touchedFileSortValue(entry: VmTouchedFile): number {
  const modifiedAt = entry.modifiedAt ? Date.parse(entry.modifiedAt) : 0;
  const changedAt = entry.changedAt ? Date.parse(entry.changedAt) : 0;
  return Math.max(
    Number.isFinite(modifiedAt) ? modifiedAt : 0,
    Number.isFinite(changedAt) ? changedAt : 0,
  );
}

function sortTouchedFileReasons(
  reasons: VmTouchedFileReason[],
): VmTouchedFileReason[] {
  return [...reasons].sort((left, right) => left.localeCompare(right));
}

function buildVmDiskUsageSnapshot(
  vm: VmInstance,
  root: VmDiskUsageSnapshot["root"],
  workspace: VmDiskUsageSnapshot["workspace"],
): VmDiskUsageSnapshot {
  const focus = pickVmDiskUsageFocus(root, workspace);
  const status = resolveVmDiskUsageStatus(root, workspace);

  return {
    vmId: vm.id,
    workspacePath: vm.workspacePath || DEFAULT_GUEST_WORKSPACE,
    checkedAt: new Date().toISOString(),
    status,
    detail: describeVmDiskUsageStatus(status, focus),
    warningThresholdBytes: VM_DISK_WARNING_FREE_BYTES,
    criticalThresholdBytes: VM_DISK_CRITICAL_FREE_BYTES,
    root,
    workspace,
  };
}

function pickVmDiskUsageFocus(
  root: VmDiskUsageSnapshot["root"],
  workspace: VmDiskUsageSnapshot["workspace"],
): VmDiskUsageSnapshot["root"] {
  if (!root) {
    return workspace;
  }

  if (!workspace) {
    return root;
  }

  const rootAvailable = root.availableBytes ?? Number.POSITIVE_INFINITY;
  const workspaceAvailable = workspace.availableBytes ?? Number.POSITIVE_INFINITY;

  return workspaceAvailable <= rootAvailable ? workspace : root;
}

function resolveVmDiskUsageStatus(
  root: VmDiskUsageSnapshot["root"],
  workspace: VmDiskUsageSnapshot["workspace"],
): VmDiskUsageSnapshot["status"] {
  const entries = [workspace, root].filter(
    (entry): entry is NonNullable<VmDiskUsageSnapshot["root"]> => entry !== null,
  );

  if (entries.length === 0) {
    return "unavailable";
  }

  if (
    entries.some(
      (entry) =>
        entry.availableBytes !== null &&
        entry.availableBytes <= VM_DISK_CRITICAL_FREE_BYTES,
    )
  ) {
    return "critical";
  }

  if (
    entries.some(
      (entry) =>
        entry.availableBytes !== null &&
        entry.availableBytes <= VM_DISK_WARNING_FREE_BYTES,
    )
  ) {
    return "warning";
  }

  return "ready";
}

function describeVmDiskUsageStatus(
  status: VmDiskUsageSnapshot["status"],
  focus: VmDiskUsageSnapshot["root"],
): string {
  if (!focus || focus.availableBytes === null) {
    return "Parallaize could not inspect guest disk usage from the running VM.";
  }

  const freeLabel = formatByteCount(focus.availableBytes);
  const locationLabel =
    focus.path === "/"
      ? `root filesystem at ${focus.mountPath}`
      : `workspace path ${focus.path} on ${focus.mountPath}`;

  switch (status) {
    case "critical":
      return `Only ${freeLabel} free on the ${locationLabel}. Resize or clean the guest before writes fail.`;
    case "warning":
      return `${freeLabel} free on the ${locationLabel}. Resize or clean the guest before it drops under 1 GB free.`;
    case "ready":
      return `${freeLabel} free on the ${locationLabel}.`;
    case "unavailable":
    default:
      return "Parallaize could not inspect guest disk usage from the running VM.";
  }
}

function resolveGuestParentPath(currentPath: string): string | null {
  const normalizedCurrentPath = normalizeGuestPath(currentPath);

  if (normalizedCurrentPath === "/") {
    return null;
  }

  return normalizeGuestPath(
    normalizedCurrentPath.slice(0, normalizedCurrentPath.lastIndexOf("/")) || "/",
  );
}

function resolveMockVmHomePath(): string {
  return "/home/ubuntu";
}

function resolveMockVmBrowsePath(vm: VmInstance): string {
  const workspacePath = normalizeGuestPath(vm.workspacePath || DEFAULT_GUEST_WORKSPACE);
  const homePath = resolveMockVmHomePath();

  return homePath || workspacePath || "/";
}

function isMockDirectoryPath(vm: VmInstance, path: string): boolean {
  const workspacePath = normalizeGuestPath(vm.workspacePath || DEFAULT_GUEST_WORKSPACE);
  const directoryPaths = new Set([
    "/",
    "/etc",
    "/home",
    "/home/ubuntu",
    "/home/ubuntu/Desktop",
    "/home/ubuntu/Downloads",
    "/srv",
    "/srv/workspaces",
    workspacePath,
    `${workspacePath}/src`,
    `${workspacePath}/.config`,
    `${workspacePath}/logs`,
  ]);

  return directoryPaths.has(path);
}

function normalizeGuestPath(path: string): string {
  const normalized = path.replace(/\/+/g, "/");

  if (!normalized.startsWith("/")) {
    return `/${normalized}`;
  }

  return normalized.length > 1 && normalized.endsWith("/")
    ? normalized.slice(0, -1)
    : normalized;
}

function isWithinGuestWorkspacePath(
  workspacePath: string,
  candidatePath: string,
): boolean {
  const normalizedWorkspacePath = normalizeGuestPath(workspacePath);
  const normalizedCandidatePath = normalizeGuestPath(candidatePath);

  if (normalizedWorkspacePath === "/") {
    return normalizedCandidatePath.startsWith("/");
  }

  return (
    normalizedCandidatePath === normalizedWorkspacePath ||
    normalizedCandidatePath.startsWith(`${normalizedWorkspacePath}/`)
  );
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
    case "daemon-conflict":
      return [
        "Pick one owner for `/var/lib/incus/unix.socket`: either the distro `incus` units or a manual Flox `incusd`, not both.",
        "If this host should stay distro-managed, stop the Flox daemon and remove any manual startup wrapper.",
        "If this host should stay Flox-managed, disable `incus.socket` and `incus.service` before starting `incusd` manually.",
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

function diagnoseIncusDaemonConflict(
  snapshot: IncusDaemonOwnershipSnapshot,
): HostDaemonDiagnostic {
  const ownerKinds = new Set(
    snapshot.processLines.map(classifyIncusdOwner).filter((owner) => owner !== "unknown"),
  );
  const systemdIncusManaged =
    snapshot.socketActive === true ||
    snapshot.socketEnabled === true ||
    snapshot.serviceActive === true ||
    snapshot.serviceEnabled === true;
  const hasFloxProcess = snapshot.processLines.some(
    (line) => classifyIncusdOwner(line) === "flox",
  );

  if (ownerKinds.size > 1 || (systemdIncusManaged && hasFloxProcess)) {
    const systemdState = [
      snapshot.socketActive === true ? "incus.socket active" : null,
      snapshot.socketEnabled === true ? "incus.socket enabled" : null,
      snapshot.serviceActive === true ? "incus.service active" : null,
      snapshot.serviceEnabled === true ? "incus.service enabled" : null,
    ].filter((entry): entry is string => entry !== null);
    const systemdSummary =
      systemdState.length > 0
        ? systemdState.join(", ")
        : "no active or enabled incus systemd units";
    const ownerSummary =
      snapshot.processLines.length > 0
        ? snapshot.processLines
            .map((line) => `${describeIncusdOwner(line)}: ${summarizeProcessCommand(line)}`)
            .join("; ")
        : "no running incusd process was detected";

    return {
      status: "conflict",
      detail:
        `Mixed Incus daemon ownership detected. ${systemdSummary}; ${ownerSummary}. ` +
        "Pick one owner for `/var/lib/incus/unix.socket` before treating this host as supported.",
      nextSteps: [
        "If this host should stay distro-managed, stop any manual Flox `incusd` process and remove its startup wrapper.",
        "If this host should stay Flox-managed, disable `incus.socket` and `incus.service` before starting `incusd` manually.",
        "Re-run `systemctl status incus.socket incus.service --no-pager`, `pgrep -af incusd`, and `ss -lx | grep /var/lib/incus/unix.socket` to confirm a single owner.",
      ],
    };
  }

  return {
    status: "ready",
    detail: null,
    nextSteps: [],
  };
}

function parseIncusdProcessLines(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function readSystemdUnitState(
  unit: string,
  property: "ActiveState" | "UnitFileState",
): boolean | null {
  const result = spawnSync("systemctl", ["show", "--property", property, "--value", unit], {
    encoding: "utf8",
    timeout: HOST_NETWORK_PROBE_TIMEOUT_MS,
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  const value = result.stdout.trim();

  if (property === "ActiveState") {
    return value === "active";
  }

  return value === "enabled" || value === "enabled-runtime";
}

function classifyIncusdOwner(commandLine: string): "flox" | "distro" | "other" | "unknown" {
  const normalized = commandLine.toLowerCase();

  if (!normalized.includes("incusd")) {
    return "unknown";
  }

  if (normalized.includes("/.flox/") || normalized.includes("/flox/")) {
    return "flox";
  }

  if (
    normalized.includes("/usr/") ||
    normalized.includes("/snap/") ||
    normalized.includes("/var/lib/snapd/")
  ) {
    return "distro";
  }

  return "other";
}

function describeIncusdOwner(commandLine: string): string {
  switch (classifyIncusdOwner(commandLine)) {
    case "flox":
      return "Flox incusd";
    case "distro":
      return "distro incusd";
    case "other":
      return "manual incusd";
    default:
      return "unknown owner";
  }
}

function summarizeProcessCommand(commandLine: string): string {
  const firstSpaceIndex = commandLine.indexOf(" ");
  const command =
    firstSpaceIndex === -1 ? commandLine : commandLine.slice(firstSpaceIndex + 1).trim();

  if (command.length <= 120) {
    return command;
  }

  return `${command.slice(0, 117)}...`;
}

function normalizeVmNetworkMode(mode: VmNetworkMode | undefined): VmNetworkMode {
  return mode === "dmz" ? "dmz" : "default";
}

function describeVmNetworkMode(mode: VmNetworkMode | undefined): string {
  return normalizeVmNetworkMode(mode) === "dmz" ? "dmz" : "default bridge";
}

function describeGuestDnsProfileActivity(mode: VmNetworkMode): string {
  return normalizeVmNetworkMode(mode) === "dmz"
    ? `dns: public resolvers ${PARALLAIZE_DMZ_PUBLIC_DNS_SERVERS.join(", ")}`
    : "dns: guest defaults restored";
}

function describePendingGuestDnsProfileActivity(mode: VmNetworkMode): string {
  return normalizeVmNetworkMode(mode) === "dmz"
    ? `dns: public resolvers ${PARALLAIZE_DMZ_PUBLIC_DNS_SERVERS.join(", ")} will apply on next boot`
    : "dns: guest defaults will restore on next boot";
}

function normalizeAclHostAddress(addressWithPrefix: string | undefined): string | null {
  const value = addressWithPrefix?.trim();

  if (!value || value === "none") {
    return null;
  }

  const [address] = value.split("/", 2);

  if (!address) {
    return null;
  }

  return address.includes(":") ? `${address}/128` : `${address}/32`;
}

function collectHostAclAddresses(): string[] {
  const addresses = new Set<string>();

  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (!entry || entry.internal) {
        continue;
      }

      if (entry.family !== "IPv4" && entry.family !== "IPv6") {
        continue;
      }

      const normalized = normalizeAclHostAddress(entry.cidr ?? entry.address);

      if (!normalized) {
        continue;
      }

      addresses.add(normalized);
    }
  }

  return [...addresses].sort((left, right) => left.localeCompare(right));
}

function buildDmzAclPayload(input: {
  bridgeIpv4: string | null;
  bridgeIpv6: string | null;
  hostAddresses: string[];
}): IncusNetworkAclPayload {
  const egress: IncusNetworkAclRule[] = [];
  const ingress: IncusNetworkAclRule[] = [];
  const seenEgress = new Set<string>();
  const seenIngress = new Set<string>();
  const hostDestinations = new Set(input.hostAddresses);

  if (input.bridgeIpv4) {
    hostDestinations.add(input.bridgeIpv4);
    pushAclRule(
      ingress,
      seenIngress,
      {
        action: "allow",
        source: input.bridgeIpv4,
        protocol: "tcp",
        state: "enabled",
      },
    );
  }

  if (input.bridgeIpv6) {
    hostDestinations.add(input.bridgeIpv6);
    pushAclRule(
      ingress,
      seenIngress,
      {
        action: "allow",
        source: input.bridgeIpv6,
        protocol: "tcp",
        state: "enabled",
      },
    );
  }

  for (const destination of [...hostDestinations].sort((left, right) => left.localeCompare(right))) {
    pushAclRule(
      egress,
      seenEgress,
      {
        action: "drop",
        destination,
        state: "enabled",
      },
    );
  }

  for (const destination of [
    "10.0.0.0/8",
    "100.64.0.0/10",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "198.18.0.0/15",
    "224.0.0.0/4",
    "::1/128",
    "fc00::/7",
    "fe80::/10",
    "ff00::/8",
  ]) {
    pushAclRule(
      egress,
      seenEgress,
      {
        action: "drop",
        destination,
        state: "enabled",
      },
    );
  }

  pushAclRule(
    egress,
    seenEgress,
    {
      action: "allow",
      destination: "0.0.0.0/0",
      state: "enabled",
    },
  );
  pushAclRule(
    egress,
    seenEgress,
    {
      action: "allow",
      destination: "::/0",
      state: "enabled",
    },
  );

  return {
    config: {
      "user.parallaize.managed": "true",
      "user.parallaize.profile": "dmz",
    },
    description:
      "Managed by Parallaize for DMZ VM egress and host-initiated control-plane access.",
    egress,
    ingress,
  };
}

function buildGuestDnsProfileScript(networkMode: VmNetworkMode): string {
  const normalizedMode = normalizeVmNetworkMode(networkMode);
  const publicDnsServers = PARALLAIZE_DMZ_PUBLIC_DNS_SERVERS.join(" ");

  if (normalizedMode === "dmz") {
    return [
      "set -eu",
      "install -d -m 0755 /etc/systemd/resolved.conf.d",
      `cat <<'EOF' > ${PARALLAIZE_DMZ_GUEST_DNS_DROPIN_PATH}`,
      "[Resolve]",
      `DNS=${publicDnsServers}`,
      "Domains=~.",
      "EOF",
      "ln -sf /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf",
      "systemctl restart systemd-resolved.service",
      "resolvectl flush-caches >/dev/null 2>&1 || true",
    ].join("\n");
  }

  return [
    "set -eu",
    `rm -f ${PARALLAIZE_DMZ_GUEST_DNS_DROPIN_PATH}`,
    "ln -sf /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf",
    "systemctl restart systemd-resolved.service",
    "resolvectl flush-caches >/dev/null 2>&1 || true",
  ].join("\n");
}

function pushAclRule(
  rules: IncusNetworkAclRule[],
  seen: Set<string>,
  rule: IncusNetworkAclRule,
): void {
  const key = JSON.stringify(rule);

  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  rules.push(rule);
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

  if (isGuestAgentUnavailableExecFailure(args, result)) {
    return buildGuestAgentUnavailableMessage(args[1]);
  }

  return `incus ${args.join(" ")} failed: ${detail}`;
}

function isCommandTimeout(result: CommandResult): boolean {
  const errorWithCode = result.error as (Error & { code?: string }) | undefined;
  return errorWithCode?.code === "ETIMEDOUT";
}

function buildGuestAgentUnavailableMessage(instanceName: string | undefined): string {
  const instanceLabel =
    typeof instanceName === "string" && instanceName.length > 0
      ? ` for ${instanceName}`
      : "";

  return (
    `Incus guest agent is unavailable${instanceLabel}. ` +
    "The VM may already have booted, but guest command execution is not working. " +
    "Repair the Incus guest-agent payload on the host and retry."
  );
}

function isGuestAgentUnavailableExecFailure(
  args: string[],
  result: CommandResult,
): boolean {
  if (args[0] !== "exec") {
    return false;
  }

  const detail = `${result.stderr}\n${result.stdout}\n${result.error?.message ?? ""}`.toLowerCase();

  return (
    detail.includes("failed connecting to instance agent") ||
    detail.includes("failed to connect to instance agent") ||
    detail.includes("vm agent isn't currently connected") ||
    detail.includes("vm agent is not currently connected") ||
    detail.includes("vm agent isn't currently running") ||
    detail.includes("vm agent is not currently running") ||
    detail.includes("agent isn't currently connected") ||
    detail.includes("agent is not currently connected") ||
    detail.includes("agent isn't currently running") ||
    detail.includes("agent is not currently running")
  );
}

function isMissingInstanceFailure(message: string): boolean {
  return (
    message.includes("Instance not found") ||
    message.includes("Failed to fetch instance")
  );
}

function isMissingDeviceConfigFailure(message: string): boolean {
  return (
    message.includes("The device doesn't exist") ||
    message.includes("Device doesn't exist") ||
    message.includes("Unknown configuration key") ||
    isMissingInstanceFailure(message)
  );
}

function isAlreadyRunningFailure(message: string): boolean {
  return message.includes("already running");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
