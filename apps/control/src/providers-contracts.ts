import type {
  EnvironmentTemplate,
  ProviderState,
  ResourceSpec,
  Snapshot,
  VmDesktopBridgeVersion,
  VmDiskUsageSnapshot,
  VmFileBrowserSnapshot,
  VmFileEntry,
  VmInstance,
  VmLogsSnapshot,
  VmNetworkMode,
  VmSession,
  VmTouchedFile,
  VmTouchedFileReason,
  VmTouchedFilesSnapshot,
  VmWindow,
} from "../../../packages/shared/src/types.js";
import type { MockDesktopTransport } from "./mock-selkies.js";
import {
  DEFAULT_GUEST_HOME,
  type GuestDesktopBootstrapRepairProfile,
  type GuestSelkiesRtcConfig,
} from "./ubuntu-guest-init.js";

export const DEFAULT_GUEST_VNC_PORT = 5900;
export const DEFAULT_GUEST_SELKIES_PORT = 6080;
export const DEFAULT_GUEST_INOTIFY_MAX_USER_WATCHES = 1_048_576;
export const DEFAULT_GUEST_INOTIFY_MAX_USER_INSTANCES = 2_048;
export const DEFAULT_GUEST_DESKTOP_BOOTSTRAP_RETRY_MS = 30_000;
export const REUSED_DISK_GUEST_DESKTOP_BOOTSTRAP_RETRY_MS = 5_000;
export const DEFAULT_GUEST_AGENT_RETRY_MS = 5_000;
export const DEFAULT_GUEST_AGENT_RETRY_TIMEOUT_MS = 60_000;
export const DEFAULT_GUEST_WORKSPACE = "/root";
export const DEFAULT_GUEST_INIT_LOG_PATH = "/var/log/parallaize-template-init.log";
export const DEFAULT_VM_CREATE_HEARTBEAT_MS = 4000;
export const VM_CREATE_ALLOCATION_START_PERCENT = 18;
export const VM_CREATE_ALLOCATION_COMPLETE_PERCENT = 58;
export const VM_CREATE_CONFIGURE_PERCENT = 64;
export const VM_CREATE_GUEST_AGENT_PERCENT = 70;
export const VM_CREATE_BOOT_START_PERCENT = 76;
export const VM_CREATE_DESKTOP_WAIT_START_PERCENT = 84;
export const VM_CREATE_READY_PERCENT = 96;
export const VM_CLONE_COPY_START_PERCENT = 52;
export const VM_CLONE_CONFIGURE_PERCENT = 60;
export const VM_CLONE_NETWORK_PERCENT = 68;
export const SNAPSHOT_LAUNCH_COPY_START_PERCENT = 48;
export const SNAPSHOT_LAUNCH_CONFIGURE_PERCENT = 58;
export const SNAPSHOT_LAUNCH_NETWORK_PERCENT = 68;
export const DEFAULT_TEMPLATE_PUBLISH_HEARTBEAT_MS = 4000;
export const TEMPLATE_PUBLISH_START_PERCENT = 58;
export const TEMPLATE_PUBLISH_EXPORT_COMPLETE_PERCENT = 78;
export const TEMPLATE_PUBLISH_COMPLETE_PERCENT = 92;
export const BYTES_PER_GIB = 1024 ** 3;
export const VM_DISK_WARNING_FREE_BYTES = 4 * BYTES_PER_GIB;
export const VM_DISK_CRITICAL_FREE_BYTES = BYTES_PER_GIB;
export const INCUS_PROBE_TIMEOUT_MS = 1_000;
export const HOST_NETWORK_PROBE_CACHE_MS = 60_000;
export const HOST_DAEMON_PROBE_CACHE_MS = 60_000;
export const HOST_NETWORK_PROBE_TIMEOUT_MS = 2_500;
export const PARALLAIZE_DMZ_ACL_NAME = "parallaize-dmz";
export const LEGACY_PARALLAIZE_DMZ_ACL_NAME = "parallaize-airgap";
export const PARALLAIZE_DMZ_GUEST_DNS_DROPIN_PATH =
  "/etc/systemd/resolved.conf.d/60-parallaize-dmz.conf";
export const PARALLAIZE_DMZ_PUBLIC_DNS_SERVERS = [
  "1.1.1.1",
  "1.0.0.1",
  "2606:4700:4700::1111",
  "2606:4700:4700::1001",
] as const;

export interface CaptureTemplateTarget {
  templateId: string;
  name: string;
}

export interface CreateProviderOptions {
  project?: string;
  storagePool?: string;
  selkiesHostCacheDir?: string;
  mockDesktopTransport?: MockDesktopTransport;
  streamHealthSecret?: string;
  controlPlanePort?: number;
  guestVncPort?: number;
  guestSelkiesPort?: number;
  guestSelkiesRtcConfig?: GuestSelkiesRtcConfig;
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

export interface VmPreviewImage {
  content: Buffer;
  contentType: string;
  generatedAt: string;
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
    options?: ProviderCloneOptions,
  ): Promise<ProviderMutation>;
  startVm(vm: VmInstance): Promise<ProviderMutation>;
  pauseVm(vm: VmInstance): Promise<ProviderMutation>;
  stopVm(vm: VmInstance): Promise<ProviderMutation>;
  deleteVm(vm: VmInstance): Promise<ProviderMutation>;
  resizeVm(vm: VmInstance, resources: ResourceSpec): Promise<ProviderMutation>;
  setNetworkMode(vm: VmInstance, networkMode: VmNetworkMode): Promise<ProviderMutation>;
  syncVmHostname(vm: VmInstance): Promise<string | null>;
  setDisplayResolution(vm: VmInstance, width: number, height: number): Promise<void>;
  snapshotVm(
    vm: VmInstance,
    label: string,
    options?: ProviderSnapshotOptions,
  ): Promise<ProviderSnapshot>;
  deleteVmSnapshot(vm: VmInstance, snapshot: Snapshot): Promise<void>;
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
  readVmDesktopBridgeVersion?(vm: VmInstance): Promise<VmDesktopBridgeVersion | null>;
  repairVmDesktopBridge?(vm: VmInstance): Promise<ProviderMutation>;
  restartVmDesktopService?(vm: VmInstance): Promise<ProviderMutation>;
  readVmDiskUsage?(vm: VmInstance): Promise<VmDiskUsageSnapshot>;
  browseVmFiles(vm: VmInstance, path?: string | null): Promise<VmFileBrowserSnapshot>;
  readVmFile(vm: VmInstance, path: string): Promise<VmFileContent>;
  readVmPreviewImage?(vm: VmInstance): Promise<VmPreviewImage>;
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
  desktopReadyAt?: string | null;
  desktopReadyMs?: number | null;
  commandResult?: ProviderCommandResult;
}

export interface ProviderCloneOptions {
  stateful?: boolean;
}

export interface ProviderSnapshot {
  providerRef: string;
  summary: string;
  stateful: boolean;
  launchSource?: string;
}

export interface ProviderSnapshotOptions {
  stateful?: boolean;
}

export interface ProviderTick {
  activity?: string;
  activeWindow?: VmWindow;
}

export interface ProviderCommandResult {
  command: string;
  output: string[];
  workspacePath: string;
}

export interface ProviderTelemetrySample {
  cpuPercent: number | null;
  ramPercent: number | null;
}

export interface ProviderVmPowerState {
  status: "running" | "paused" | "stopped";
}

export interface ResolveSessionOptions {
  requireBootstrapRepairBeforeReady?: boolean;
  guestWallpaperName?: string;
  bootstrapRepairProfile?: GuestDesktopBootstrapRepairProfile;
  bootstrapRepairRetryMs?: number;
}

export interface IncusCommandRunner {
  execute(args: string[], options?: CommandExecutionOptions): CommandResult;
  executeStreaming?(
    args: string[],
    listeners?: CommandStreamListeners,
    options?: CommandExecutionOptions,
  ): Promise<CommandResult>;
  startStreaming?(
    args: string[],
    listeners?: CommandStreamListeners,
    options?: CommandExecutionOptions,
  ): CommandStreamHandle;
}

export interface CommandResult {
  args: string[];
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export interface CommandExecutionOptions {
  timeoutMs?: number;
  input?: Buffer | string;
}

export interface CommandStreamListeners {
  onStdout?(chunk: string): void;
  onStderr?(chunk: string): void;
}

export interface CommandStreamHandle {
  close(): void;
  completed: Promise<CommandResult>;
}

export interface GuestPortProbe {
  probe(host: string, port: number): Promise<boolean>;
}

export interface HostNetworkProbe {
  probe(): HostNetworkDiagnostic;
}

export interface HostNetworkDiagnostic {
  status: "ready" | "unreachable" | "unknown";
  detail: string | null;
  nextSteps: string[];
}

export interface HostDaemonProbe {
  probe(): HostDaemonDiagnostic;
}

export interface HostDaemonDiagnostic {
  status: "ready" | "conflict" | "unknown";
  detail: string | null;
  nextSteps: string[];
}

export interface IncusDaemonOwnershipSnapshot {
  processLines: string[];
  socketActive: boolean | null;
  socketEnabled: boolean | null;
  serviceActive: boolean | null;
  serviceEnabled: boolean | null;
}

export interface IncusListInstance {
  name?: string;
  status?: string;
  stateful?: boolean;
  config?: Record<string, string>;
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

export interface IncusInstanceDevice {
  path?: string;
  network?: string;
  parent?: string;
  pool?: string;
  source?: string;
  type?: string;
}

export interface IncusNetwork {
  config?: Record<string, string>;
  managed?: boolean;
  name?: string;
  type?: string;
}

export interface IncusNetworkAclRule {
  action: "allow" | "drop";
  destination?: string;
  destination_port?: string;
  protocol?: string;
  source?: string;
  state: "enabled";
}

export interface IncusNetworkAclPayload {
  config: Record<string, string>;
  description: string;
  egress: IncusNetworkAclRule[];
  ingress: IncusNetworkAclRule[];
}

export interface IncusOperationProgressMetadata {
  percent?: string;
  processed?: string;
  speed?: string;
  stage?: string;
}

export interface IncusOperation {
  id?: string;
  created_at?: string;
  metadata?: {
    create_image_from_container_pack_progress?: string;
    progress?: IncusOperationProgressMetadata;
  };
}

export interface IncusOperationListResponse {
  running?: IncusOperation[];
}

export type TemplatePublishProgressSample =
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

export { DEFAULT_GUEST_HOME };
