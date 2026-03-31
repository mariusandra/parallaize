import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { cpus, freemem, loadavg, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type {
  EnvironmentTemplate,
  ProviderState,
  ResourceSpec,
  Snapshot,
  VmDesktopBridgeVersion,
  VmDiskUsageSnapshot,
  VmFileBrowserSnapshot,
  VmFileEntry,
  VmTouchedFile,
  VmTouchedFilesSnapshot,
  VmInstance,
  VmLogsSnapshot,
  VmNetworkMode,
  VmDesktopTransport,
  VmSession,
} from "../../../packages/shared/src/types.js";
import {
  buildExpectedGuestDesktopBridgeVersionRecord,
  buildEnsureGuestDesktopBootstrapScript,
  DEFAULT_GUEST_DESKTOP_BRIDGE_VERSION_FILE,
  DEFAULT_GUEST_SELKIES_ARCHIVE_URL,
  DEFAULT_GUEST_SELKIES_VERSION,
  buildGuestSelkiesCloudInit,
  buildGuestVncCloudInit,
  type GuestDesktopBootstrapRepairProfile,
} from "./ubuntu-guest-init.js";
import {
  DEFAULT_GUEST_AGENT_RETRY_MS,
  DEFAULT_GUEST_AGENT_RETRY_TIMEOUT_MS,
  DEFAULT_GUEST_DESKTOP_BOOTSTRAP_RETRY_MS,
  DEFAULT_GUEST_HOME,
  DEFAULT_GUEST_INIT_LOG_PATH,
  DEFAULT_GUEST_INOTIFY_MAX_USER_INSTANCES,
  DEFAULT_GUEST_INOTIFY_MAX_USER_WATCHES,
  DEFAULT_GUEST_SELKIES_PORT,
  DEFAULT_GUEST_VNC_PORT,
  DEFAULT_GUEST_WORKSPACE,
  DEFAULT_TEMPLATE_PUBLISH_HEARTBEAT_MS,
  DEFAULT_VM_CREATE_HEARTBEAT_MS,
  HOST_DAEMON_PROBE_CACHE_MS,
  HOST_NETWORK_PROBE_CACHE_MS,
  INCUS_PROBE_TIMEOUT_MS,
  LEGACY_PARALLAIZE_DMZ_ACL_NAME,
  PARALLAIZE_DMZ_ACL_NAME,
  REUSED_DISK_GUEST_DESKTOP_BOOTSTRAP_RETRY_MS,
  SNAPSHOT_LAUNCH_CONFIGURE_PERCENT,
  SNAPSHOT_LAUNCH_COPY_START_PERCENT,
  SNAPSHOT_LAUNCH_NETWORK_PERCENT,
  TEMPLATE_PUBLISH_COMPLETE_PERCENT,
  TEMPLATE_PUBLISH_START_PERCENT,
  VM_CLONE_CONFIGURE_PERCENT,
  VM_CLONE_COPY_START_PERCENT,
  VM_CLONE_NETWORK_PERCENT,
  VM_CREATE_ALLOCATION_COMPLETE_PERCENT,
  VM_CREATE_ALLOCATION_START_PERCENT,
  VM_CREATE_BOOT_START_PERCENT,
  VM_CREATE_CONFIGURE_PERCENT,
  VM_CREATE_DESKTOP_WAIT_START_PERCENT,
  VM_CREATE_GUEST_AGENT_PERCENT,
  VM_CREATE_READY_PERCENT,
} from "./providers-contracts.js";
import type {
  CaptureTemplateProgressReporter,
  CaptureTemplateTarget,
  CommandExecutionOptions,
  CommandResult,
  CommandStreamListeners,
  CreateProviderOptions,
  DesktopProvider,
  GuestPortProbe,
  HostDaemonDiagnostic,
  HostDaemonProbe,
  HostNetworkDiagnostic,
  HostNetworkProbe,
  IncusCommandRunner,
  IncusInstanceDevice,
  IncusImageCompression,
  IncusListInstance,
  IncusNetwork,
  IncusNetworkAclPayload,
  IncusOperation,
  IncusOperationListResponse,
  ProviderMutation,
  ProviderProgressReporter,
  ProviderSnapshot,
  ProviderTelemetrySample,
  ProviderTick,
  ProviderVmPowerState,
  ResolveSessionOptions,
  TemplatePublishProgressSample,
  VmFileContent,
  VmLogsStreamHandle,
  VmLogsStreamListeners,
  VmPreviewImage,
} from "./providers-contracts.js";
import { buildVmStreamHealthToken } from "./stream-health.js";
import {
  buildIncusProviderState,
  NoopHostDaemonProbe,
  NoopHostNetworkProbe,
  ShellHostDaemonProbe,
  ShellHostNetworkProbe,
} from "./providers-incus-host.js";
import {
  buildBrowseVmFilesScript,
  buildReadVmPreviewImageScript,
  buildReadVmDiskUsageScript,
  buildReadVmFileScript,
  buildReadVmTouchedFilesScript,
  buildVmDiskUsageSnapshot,
  mergeTouchedFilesWithCommandHistory,
  normalizeGuestPath,
  resolveGuestParentPath,
} from "./providers-incus-inspection.js";
import {
  buildGuestInitCommandsScript,
  buildSetDisplayResolutionScript,
  buildSnapshotName,
  buildTemplateAlias,
  buildTemplatePublisherInstanceName,
  buildTemplateSnapshotName,
  formatDiskSize,
  formatMemoryLimit,
  parseSnapshotName,
  resolveGuestWallpaperName,
  validateDisplayResolution,
} from "./providers-incus-lifecycle.js";
import {
  buildDmzAclPayload,
  buildGuestDnsProfileScript,
  buildSelkiesSession,
  buildVncSession,
  collectHostAclAddresses,
  describeGuestDnsProfileActivity,
  describePendingGuestDnsProfileActivity,
  describeVmNetworkMode,
  findGuestAddressCandidates,
  normalizeAclHostAddress,
  normalizeVmNetworkMode,
  TcpGuestPortProbe,
} from "./providers-incus-network.js";
import {
  buildProgressEmitter,
  describeTemplatePublishActivity,
  estimateTemplatePublishProgress,
  estimateVmCreateAllocationProgress,
  estimateVmCreateDesktopWaitProgress,
  mapPercentToRange,
  mapTemplatePublishProgress,
  normalizeStatus,
  normalizeVmLogContent,
  parseTemplatePublishOperation,
  parseTemplatePublishProgressChunk,
  parseVmCreateProgressChunk,
  pickTemplatePublishOperation,
  shouldRequireGuestBootstrapRepairBeforeReady,
} from "./providers-incus-progress.js";
import {
  collectCommandOutput,
  isDeleteAlreadySucceededFailure,
  errorMessage,
  formatCommandFailure,
  isAlreadyRunningFailure,
  isGuestAgentUnavailableFailure,
  isGuestAgentUnavailableExecFailure,
  isMissingDeviceConfigFailure,
  isMissingInstanceFailure,
  parseJson,
  sleep,
  summarizeCommandOutput,
} from "./providers-incus-command.js";
import { SpawnIncusCommandRunner } from "./providers-incus-runtime.js";
import { renderSyntheticFrame } from "./providers-synthetic.js";

const REACHABLE_SELKIES_BOOTSTRAP_RETRY_MS = 5 * 60_000;

interface ResolvedGuestSession {
  activity: string[];
  readyMs: number | null;
  session: VmSession | null;
}

interface GuestBootstrapAttempt {
  activity: string[];
  ok: boolean;
}

interface HostSelkiesArchiveCacheResult {
  durationMs: number;
  hostPath: string;
  status: "downloaded" | "hit";
}

export class IncusProvider implements DesktopProvider {
  state: ProviderState;
  private readonly selkiesHostCacheDir: string | null;
  private readonly streamHealthSecret: string | null;
  private readonly controlPlanePort: number;
  private readonly guestVncPort: number;
  private readonly guestSelkiesPort: number;
  private readonly guestSelkiesRtcConfig: CreateProviderOptions["guestSelkiesRtcConfig"] | null;
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
  private readonly reachableSelkiesBootstrapAttemptAt = new Map<string, number>();
  private readonly previewImageCache = new Map<
    string,
    {
      capturedAt: number;
      image: VmPreviewImage;
    }
  >();
  private readonly previewImageInFlight = new Map<string, Promise<VmPreviewImage>>();
  private selkiesHostArchivePromise: Promise<HostSelkiesArchiveCacheResult> | null = null;
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
    this.selkiesHostCacheDir = options.selkiesHostCacheDir ?? null;
    this.streamHealthSecret = options.streamHealthSecret?.trim() || null;
    this.controlPlanePort = Math.max(1, Math.round(options.controlPlanePort ?? 3000));
    this.guestVncPort = options.guestVncPort ?? DEFAULT_GUEST_VNC_PORT;
    this.guestSelkiesPort = options.guestSelkiesPort ?? DEFAULT_GUEST_SELKIES_PORT;
    this.guestSelkiesRtcConfig = options.guestSelkiesRtcConfig ?? null;
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

    const session = await this.probeReachableSession(
      info,
      this.resolveVmDesktopTransport(vm),
    );

    if (session) {
      this.guestDesktopBootstrapAttemptAt.delete(vm.providerRef);
      if (this.resolveVmDesktopTransport(vm) === "selkies") {
        await this.maybeEnsureReachableSelkiesBootstrapAsync(
          vm.id,
          vm.providerRef,
          resolveGuestWallpaperName(vm),
        );
      }
      return session;
    }

    const bootstrapped = await this.maybeEnsureGuestDesktopBootstrapAsync(
      vm.id,
      vm.providerRef,
      resolveGuestWallpaperName(vm),
      "standard",
      this.guestDesktopBootstrapRetryMs,
      this.resolveVmDesktopTransport(vm),
    );

    if (!bootstrapped) {
      return null;
    }

    const refreshedInfo = await this.inspectInstanceAsync(vm.providerRef);

    if (normalizeStatus(refreshedInfo.status ?? refreshedInfo.state?.status) !== "running") {
      return null;
    }

    const refreshedSession = await this.probeReachableSession(
      refreshedInfo,
      this.resolveVmDesktopTransport(vm),
    );

    if (refreshedSession) {
      this.guestDesktopBootstrapAttemptAt.delete(vm.providerRef);
    }

    return refreshedSession;
  }

  async readVmDesktopBridgeVersion(
    vm: VmInstance,
  ): Promise<VmDesktopBridgeVersion | null> {
    if (!this.state.available || vm.status !== "running") {
      return null;
    }

    const transport = this.resolveVmDesktopTransport(vm);
    const result = await this.runGuestExecWithRetryAsync([
      "exec",
      vm.providerRef,
      "--cwd",
      "/",
      "--",
      "sh",
      "-lc",
      buildReadVmDesktopBridgeVersionScript(transport),
    ]);
    const payload = parseJson<{
      bridge: {
        label?: string | null;
      } | null;
      selkiesPatchLevel: string | null;
      selkiesVersion: string | null;
    }>(result.stdout);
    const expected = buildExpectedGuestDesktopBridgeVersionRecord(transport);
    const currentLabel =
      typeof payload.bridge?.label === "string" && payload.bridge.label.trim()
        ? payload.bridge.label.trim()
        : payload.selkiesVersion && payload.selkiesPatchLevel
          ? `bridge:unknown;selkies:${payload.selkiesVersion}+${payload.selkiesPatchLevel}`
          : null;

    return {
      checkedAt: new Date().toISOString(),
      currentLabel,
      expectedLabel: expected.label,
      runtimePatchLevel: payload.selkiesPatchLevel,
      runtimeVersion: payload.selkiesVersion,
      status:
        currentLabel === expected.label
          ? "current"
          : currentLabel === null
            ? "unknown"
            : "outdated",
      transport,
    };
  }

  async repairVmDesktopBridge(vm: VmInstance): Promise<ProviderMutation> {
    if (vm.status !== "running") {
      throw new Error(`VM ${vm.name} must be running to repair the desktop bridge.`);
    }

    const transport = this.resolveVmDesktopTransport(vm);
    await this.ensureGuestDesktopBootstrapAsync(
      vm.id,
      vm.providerRef,
      resolveGuestWallpaperName(vm),
      "aggressive",
      transport,
    );

    const info = await this.inspectInstanceAsync(vm.providerRef);
    const session =
      normalizeStatus(info.status ?? info.state?.status) === "running"
        ? await this.probeReachableSession(info, transport)
        : null;
    const expected = buildExpectedGuestDesktopBridgeVersionRecord(transport);

    return {
      lastAction: "Desktop bridge repaired",
      activity: [
        `desktop-bridge: reconciled ${transport} guest runtime to ${expected.label}`,
      ],
      ...(session
        ? {
            desktopReadyAt: new Date().toISOString(),
            session,
          }
        : {}),
    };
  }

  async createVm(
    vm: VmInstance,
    template: EnvironmentTemplate,
    report?: ProviderProgressReporter,
  ): Promise<ProviderMutation> {
    this.assertAvailable();
    this.assertLaunchSource(template);
    const desktopTransport = this.resolveVmDesktopTransport(vm);
    const emitCreateProgress = buildProgressEmitter(report);

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
    const cloudInitUserData =
      desktopTransport === "selkies"
        ? buildGuestSelkiesCloudInit(
            this.guestSelkiesPort,
            {
              maxUserWatches: this.guestInotifyMaxUserWatches,
              maxUserInstances: this.guestInotifyMaxUserInstances,
            },
            resolveGuestWallpaperName(vm),
            this.guestSelkiesRtcConfig,
            vm.id,
            this.buildStreamHealthToken(vm.id),
            this.controlPlanePort,
          )
        : buildGuestVncCloudInit(
            this.guestVncPort,
            {
              maxUserWatches: this.guestInotifyMaxUserWatches,
              maxUserInstances: this.guestInotifyMaxUserInstances,
            },
            resolveGuestWallpaperName(vm),
          );
    await this.runAsync(
      ["config", "set", vm.providerRef, "cloud-init.user-data", "-"],
      undefined,
      {
        input: cloudInitUserData,
      },
    );
    emitCreateProgress("Preparing guest agent", VM_CREATE_GUEST_AGENT_PERCENT);
    await this.ensureAgentDeviceAsync(vm.providerRef);
    const networkMode = normalizeVmNetworkMode(vm.networkMode);
    const networkActivity =
      networkMode === "dmz"
        ? await this.ensureInstanceNetworkModeAsync(vm.providerRef, networkMode)
        : `network: ${describeVmNetworkMode(networkMode)}`;
    emitCreateProgress("Starting workspace", VM_CREATE_BOOT_START_PERCENT);
    await this.runAsync(["start", vm.providerRef]);

    const requireBootstrapRepairBeforeReady =
      shouldRequireGuestBootstrapRepairBeforeReady(template);
    const { activity: sessionActivity, readyMs, session } = await this.resolveSession(vm, emitCreateProgress, {
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
        ...sessionActivity,
        this.describeSessionActivity(session, desktopTransport),
        ...(readyMs === null
          ? []
          : [`desktop-ready: ${desktopTransport} in ${formatReadyMs(readyMs)}`]),
      ].filter((entry): entry is string => Boolean(entry)),
      activeWindow: "terminal",
      workspacePath: DEFAULT_GUEST_WORKSPACE,
      session,
      desktopReadyAt: readyMs === null ? null : new Date().toISOString(),
      desktopReadyMs: readyMs,
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

    const desktopTransport = this.resolveVmDesktopTransport(targetVm);
    const { activity: sessionActivity, readyMs, session } = await this.resolveSession(targetVm, emitProgress, {
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
        ...sessionActivity,
        this.describeSessionActivity(session, desktopTransport),
        ...(readyMs === null
          ? []
          : [`desktop-ready: ${desktopTransport} in ${formatReadyMs(readyMs)}`]),
      ].filter((entry): entry is string => Boolean(entry)),
      activeWindow: "terminal",
      workspacePath: sourceVm.workspacePath || DEFAULT_GUEST_WORKSPACE,
      session,
      desktopReadyAt: readyMs === null ? null : new Date().toISOString(),
      desktopReadyMs: readyMs,
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

    const desktopTransport = this.resolveVmDesktopTransport(vm);
    const { activity: sessionActivity, readyMs, session } = await this.resolveSession(vm, undefined, {
      guestWallpaperName: resolveGuestWallpaperName(vm),
    });
    await this.syncGuestDnsProfileAsync(vm.providerRef, networkMode);

    return {
      lastAction: "Workspace resumed",
      activity: [
        `incus: started ${vm.providerRef}`,
        networkActivity,
        ...(networkMode === "dmz" ? [describeGuestDnsProfileActivity(networkMode)] : []),
        ...sessionActivity,
        this.describeSessionActivity(session, desktopTransport),
        ...(readyMs === null
          ? []
          : [`desktop-ready: ${desktopTransport} in ${formatReadyMs(readyMs)}`]),
      ].filter((entry): entry is string => Boolean(entry)),
      activeWindow: "terminal",
      workspacePath: vm.workspacePath || DEFAULT_GUEST_WORKSPACE,
      session,
      desktopReadyAt: readyMs === null ? null : new Date().toISOString(),
      desktopReadyMs: readyMs,
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
        this.resolveVmDesktopTransport(vm),
        this.guestSelkiesPort,
        this.guestSelkiesRtcConfig,
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

  async deleteVmSnapshot(vm: VmInstance, snapshot: Snapshot): Promise<void> {
    this.assertAvailable();
    const snapshotName = parseSnapshotName(snapshot.providerRef, vm.providerRef);
    await this.runAsync(["delete", `${vm.providerRef}/${snapshotName}`]);
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

    const desktopTransport = this.resolveVmDesktopTransport(targetVm);
    const { activity: sessionActivity, readyMs, session } = await this.resolveSession(targetVm, emitProgress, {
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
        ...sessionActivity,
        this.describeSessionActivity(session, desktopTransport),
        ...(readyMs === null
          ? []
          : [`desktop-ready: ${desktopTransport} in ${formatReadyMs(readyMs)}`]),
      ].filter((entry): entry is string => Boolean(entry)),
      activeWindow: "terminal",
      workspacePath: DEFAULT_GUEST_WORKSPACE,
      session,
      desktopReadyAt: readyMs === null ? null : new Date().toISOString(),
      desktopReadyMs: readyMs,
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

    let sessionActivity: string[] = [];
    let readyMs: number | null = null;
    let session: VmSession | null = null;
    const networkMode = normalizeVmNetworkMode(vm.networkMode);

    if (wasRunning) {
      await this.runAsync(["start", vm.providerRef]);
      ({ activity: sessionActivity, readyMs, session } = await this.resolveSession(vm, undefined, {
        guestWallpaperName: resolveGuestWallpaperName(vm),
      }));
      await this.syncGuestDnsProfileAsync(vm.providerRef, networkMode);
    }

    const desktopTransport = this.resolveVmDesktopTransport(vm);

    return {
      lastAction: `Restored ${vm.name} to ${snapshot.label}`,
      activity: [
        `incus: restored ${vm.providerRef} to ${snapshotName}`,
        ...(wasRunning && networkMode === "dmz"
          ? [describeGuestDnsProfileActivity(networkMode)]
          : []),
        ...(wasRunning ? sessionActivity : []),
        wasRunning
          ? this.describeSessionActivity(session, desktopTransport)
          : "workspace remains stopped after restore",
        ...(wasRunning && readyMs !== null
          ? [`desktop-ready: ${desktopTransport} in ${formatReadyMs(readyMs)}`]
          : []),
      ],
      activeWindow: "terminal",
      workspacePath: vm.workspacePath || DEFAULT_GUEST_WORKSPACE,
      session,
      desktopReadyAt: readyMs === null ? null : new Date().toISOString(),
      desktopReadyMs: readyMs,
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
        const failure = formatCommandFailure(args, result);

        if (isNonFatalVmLogStreamFailure(failure)) {
          listeners.onClose?.();
          return;
        }

        listeners.onError?.(new Error(failure));
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

  async readVmPreviewImage(vm: VmInstance): Promise<VmPreviewImage> {
    this.assertAvailable();

    if (vm.status !== "running") {
      throw new Error(`Workspace ${vm.name} must be running to capture a live preview.`);
    }

    const cacheKey = vm.providerRef;
    const cached = this.previewImageCache.get(cacheKey);

    if (cached && Date.now() - cached.capturedAt < 5_000) {
      return cached.image;
    }

    const inFlight = this.previewImageInFlight.get(cacheKey);

    if (inFlight) {
      return inFlight;
    }

    const capturePromise = this.captureVmPreviewImageWithRetry(vm)
      .then((image) => {
        this.previewImageCache.set(cacheKey, {
          capturedAt: Date.now(),
          image,
        });
        return image;
      })
      .finally(() => {
        this.previewImageInFlight.delete(cacheKey);
      });

    this.previewImageInFlight.set(cacheKey, capturePromise);
    return capturePromise;
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
    vm: Pick<VmInstance, "id" | "providerRef" | "desktopTransport">,
    report?: ProviderProgressReporter,
    options?: ResolveSessionOptions,
  ): Promise<ResolvedGuestSession> {
    const instanceName = vm.providerRef;
    const vmId = vm.id;
    const desktopTransport = this.resolveVmDesktopTransport(vm);
    this.guestDesktopBootstrapAttemptAt.delete(instanceName);
    const activity: string[] = [];
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
        const bootstrapAttempt = await this.ensureGuestDesktopBootstrapAsync(
          vmId,
          instanceName,
          options?.guestWallpaperName,
          bootstrapRepairProfile,
          desktopTransport,
        );
        mergeUniqueActivity(activity, bootstrapAttempt.activity);
        bootstrapConfirmed = bootstrapAttempt.ok;
      }

      const session = await this.probeReachableSessionForAddresses(
        addresses,
        desktopTransport,
      );

      if (session && bootstrapConfirmed) {
        this.guestDesktopBootstrapAttemptAt.delete(instanceName);
        emitProgress?.("Desktop session ready", VM_CREATE_READY_PERCENT);
        return {
          activity,
          readyMs: Date.now() - waitStartedAt,
          session,
        };
      }

      if (bootstrapConfirmed) {
        const bootstrapAttempt = await this.maybeEnsureGuestDesktopBootstrapAsync(
          vmId,
          instanceName,
          options?.guestWallpaperName,
          bootstrapRepairProfile,
          bootstrapRepairRetryMs,
          desktopTransport,
        );
        mergeUniqueActivity(activity, bootstrapAttempt.activity);
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

    return {
      activity,
      readyMs: null,
      session: this.buildPendingSession(address, desktopTransport),
    };
  }

  private async maybeEnsureGuestDesktopBootstrapAsync(
    vmId: string,
    instanceName: string,
    guestWallpaperName?: string,
    bootstrapRepairProfile: GuestDesktopBootstrapRepairProfile = "standard",
    bootstrapRetryMs: number = this.guestDesktopBootstrapRetryMs,
    desktopTransport: VmDesktopTransport = "vnc",
  ): Promise<GuestBootstrapAttempt> {
    const now = Date.now();
    const lastAttemptAt = this.guestDesktopBootstrapAttemptAt.get(instanceName) ?? 0;

    if (now - lastAttemptAt < bootstrapRetryMs) {
      return {
        activity: [],
        ok: false,
      };
    }

    this.guestDesktopBootstrapAttemptAt.set(instanceName, now);
    return this.ensureGuestDesktopBootstrapAsync(
      vmId,
      instanceName,
      guestWallpaperName,
      bootstrapRepairProfile,
      desktopTransport,
    );
  }

  private async ensureGuestDesktopBootstrapAsync(
    vmId: string,
    instanceName: string,
    guestWallpaperName?: string,
    bootstrapRepairProfile: GuestDesktopBootstrapRepairProfile = "standard",
    desktopTransport: VmDesktopTransport = "vnc",
  ): Promise<GuestBootstrapAttempt> {
    const activity: string[] = [];

    if (desktopTransport === "selkies") {
      mergeUniqueActivity(
        activity,
        await this.ensureGuestSelkiesArchiveAsync(instanceName),
      );
    }

    const args = [
      "exec",
      instanceName,
      "--",
      "sh",
      "-s",
    ];
    const result = await this.executeGuestExecWithRetryAsync(args, undefined, {
      input: buildEnsureGuestDesktopBootstrapScript(
        this.guestVncPort,
        false,
        guestWallpaperName,
        bootstrapRepairProfile,
        desktopTransport,
        this.guestSelkiesPort,
        this.guestSelkiesRtcConfig,
        vmId,
        this.buildStreamHealthToken(vmId),
        this.controlPlanePort,
      ),
    });

    if (result.status !== 0 && isGuestAgentUnavailableExecFailure(args, result)) {
      throw new Error(formatCommandFailure(args, result));
    }

    return {
      activity,
      ok: result.status === 0,
    };
  }

  private async maybeEnsureReachableSelkiesBootstrapAsync(
    vmId: string,
    instanceName: string,
    guestWallpaperName?: string,
  ): Promise<void> {
    const now = Date.now();
    const lastAttemptAt = this.reachableSelkiesBootstrapAttemptAt.get(instanceName) ?? 0;

    if (now - lastAttemptAt < REACHABLE_SELKIES_BOOTSTRAP_RETRY_MS) {
      return;
    }

    this.reachableSelkiesBootstrapAttemptAt.set(instanceName, now);

    try {
      await this.ensureGuestDesktopBootstrapAsync(
        vmId,
        instanceName,
        guestWallpaperName,
        "standard",
        "selkies",
      );
    } catch {
      // Keep the current session usable even if the maintenance repair fails.
    }
  }

  private async ensureGuestSelkiesArchiveAsync(instanceName: string): Promise<string[]> {
    if (!this.selkiesHostCacheDir) {
      return [];
    }

    const guestArchiveCheckArgs = [
      "exec",
      instanceName,
      "--",
      "test",
      "-s",
      `/var/cache/parallaize/selkies/v${DEFAULT_GUEST_SELKIES_VERSION}.tar.gz`,
    ];
    const guestArchiveCheckResult =
      await this.executeGuestExecWithRetryAsync(guestArchiveCheckArgs);

    if (
      guestArchiveCheckResult.status !== 0 &&
      isGuestAgentUnavailableExecFailure(guestArchiveCheckArgs, guestArchiveCheckResult)
    ) {
      throw new Error(formatCommandFailure(guestArchiveCheckArgs, guestArchiveCheckResult));
    }

    if (guestArchiveCheckResult.status === 0) {
      return [];
    }

    const hostArchive = await this.ensureSelkiesArchiveCachedOnHostAsync();
    const pushStartedAt = Date.now();
    const pushArgs = [
      "file",
      "push",
      "--create-dirs",
      hostArchive.hostPath,
      `${instanceName}/var/cache/parallaize/selkies/v${DEFAULT_GUEST_SELKIES_VERSION}.tar.gz`,
    ];
    const pushResult = await this.executeGuestFilePushWithRetryAsync(pushArgs);

    if (pushResult.status !== 0) {
      throw new Error(formatCommandFailure(pushArgs, pushResult));
    }

    return [
      hostArchive.status === "downloaded"
        ? `selkies-cache: downloaded v${DEFAULT_GUEST_SELKIES_VERSION} to host in ${formatReadyMs(hostArchive.durationMs)}`
        : `selkies-cache: host cache hit in ${formatReadyMs(hostArchive.durationMs)}`,
      `selkies-cache: uploaded archive to guest in ${formatReadyMs(Date.now() - pushStartedAt)}`,
    ];
  }

  private async ensureSelkiesArchiveCachedOnHostAsync(): Promise<HostSelkiesArchiveCacheResult> {
    if (!this.selkiesHostCacheDir) {
      throw new Error("Selkies host cache directory is not configured.");
    }

    if (this.selkiesHostArchivePromise) {
      return this.selkiesHostArchivePromise;
    }

    const hostPath = join(
      this.selkiesHostCacheDir,
      `v${DEFAULT_GUEST_SELKIES_VERSION}.tar.gz`,
    );
    const promise = (async (): Promise<HostSelkiesArchiveCacheResult> => {
      const startedAt = Date.now();
      const existingStat = await stat(hostPath).catch(() => null);

      if (existingStat?.isFile() && existingStat.size > 0) {
        return {
          durationMs: Date.now() - startedAt,
          hostPath,
          status: "hit",
        };
      }

      await mkdir(dirname(hostPath), { recursive: true });
      const tempPath = `${hostPath}.tmp-${process.pid}-${Date.now()}`;

      try {
        const response = await fetch(DEFAULT_GUEST_SELKIES_ARCHIVE_URL);

        if (!response.ok || !response.body) {
          throw new Error(
            `Failed to download Selkies archive from ${DEFAULT_GUEST_SELKIES_ARCHIVE_URL} (${response.status}).`,
          );
        }

        await pipeline(
          Readable.fromWeb(response.body as any),
          createWriteStream(tempPath),
        );
        await rename(tempPath, hostPath);
      } catch (error) {
        await rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
      }

      return {
        durationMs: Date.now() - startedAt,
        hostPath,
        status: "downloaded",
      };
    })();

    this.selkiesHostArchivePromise = promise;

    try {
      return await promise;
    } finally {
      if (this.selkiesHostArchivePromise === promise) {
        this.selkiesHostArchivePromise = null;
      }
    }
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

  private async captureVmPreviewImageWithRetry(vm: VmInstance): Promise<VmPreviewImage> {
    try {
      return await this.captureVmPreviewImage(vm);
    } catch (error) {
      if (!shouldRetryVmPreviewCapture(error)) {
        throw error;
      }

      await this.ensureGuestDesktopBootstrapAsync(
        vm.id,
        vm.providerRef,
        resolveGuestWallpaperName(vm),
        "standard",
        this.resolveVmDesktopTransport(vm),
      );
      return this.captureVmPreviewImage(vm);
    }
  }

  private async captureVmPreviewImage(vm: VmInstance): Promise<VmPreviewImage> {
    const result = await this.runGuestExecWithRetryAsync([
      "exec",
      vm.providerRef,
      "--cwd",
      "/",
      "--",
      "sh",
      "-lc",
      buildReadVmPreviewImageScript(),
    ]);
    const payload = parseJson<{
      contentBase64: string;
      contentType: string;
    }>(result.stdout);

    return {
      content: Buffer.from(payload.contentBase64, "base64"),
      contentType: payload.contentType,
      generatedAt: new Date().toISOString(),
    };
  }

  private async probeReachableSession(
    instance: IncusListInstance,
    desktopTransport: VmDesktopTransport = "vnc",
  ): Promise<VmSession | null> {
    return this.probeReachableSessionForAddresses(
      findGuestAddressCandidates(instance),
      desktopTransport,
    );
  }

  private async probeReachableSessionForAddresses(
    addresses: string[],
    desktopTransport: VmDesktopTransport,
  ): Promise<VmSession | null> {
    if (desktopTransport === "selkies") {
      for (const address of addresses) {
        if (await this.probeSelkiesHealth(address, this.guestSelkiesPort)) {
          return buildSelkiesSession(address, this.guestSelkiesPort);
        }
      }

      return null;
    }

    for (const address of addresses) {
      if (await this.guestPortProbe.probe(address, this.guestVncPort)) {
        return buildVncSession(address, this.guestVncPort);
      }
    }

    return null;
  }

  private buildPendingSession(
    address: string | null,
    desktopTransport: VmDesktopTransport,
  ): VmSession {
    return desktopTransport === "selkies"
      ? buildSelkiesSession(address, this.guestSelkiesPort, false)
      : buildVncSession(address, this.guestVncPort, false);
  }

  private describeSessionActivity(
    session: VmSession | null,
    desktopTransport: VmDesktopTransport,
  ): string {
    if (!session) {
      return desktopTransport === "selkies"
        ? "selkies: guest network pending"
        : "vnc: guest network pending";
    }

    return `${desktopTransport}: ${session.display}`;
  }

  private resolveVmDesktopTransport(
    vm: Pick<VmInstance, "desktopTransport">,
  ): VmDesktopTransport {
    return vm.desktopTransport === "selkies" ? "selkies" : "vnc";
  }

  private buildStreamHealthToken(vmId: string): string | null {
    return this.streamHealthSecret
      ? buildVmStreamHealthToken(this.streamHealthSecret, vmId)
      : null;
  }

  private async probeSelkiesHealth(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const request = httpRequest(
        {
          host,
          method: "GET",
          path: "/",
          port,
          timeout: 2000,
        },
        (response) => {
          response.resume();
          const statusCode = response.statusCode ?? 500;
          resolve(statusCode >= 200 && statusCode < 400);
        },
      );

      request.on("error", () => {
        resolve(false);
      });
      request.on("timeout", () => {
        request.destroy();
        resolve(false);
      });
      request.end();
    });
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
    options?: CommandExecutionOptions,
  ): Promise<CommandResult> {
    return this.runner.executeStreaming
      ? this.runner.executeStreaming(args, listeners, options)
      : this.runner.execute(args, options);
  }

  private async executeGuestExecWithRetryAsync(
    args: string[],
    listeners?: CommandStreamListeners,
    options?: CommandExecutionOptions,
  ): Promise<CommandResult> {
    const deadlineAt = Date.now() + this.guestAgentRetryTimeoutMs;

    while (true) {
      const result = await this.executeAsync(args, listeners, options);

      if (result.status === 0 || !isGuestAgentUnavailableExecFailure(args, result)) {
        return result;
      }

      if (Date.now() >= deadlineAt) {
        return result;
      }

      await sleep(this.guestAgentRetryMs);
    }
  }

  private async executeGuestFilePushWithRetryAsync(
    args: string[],
    listeners?: CommandStreamListeners,
    options?: CommandExecutionOptions,
  ): Promise<CommandResult> {
    const deadlineAt = Date.now() + this.guestAgentRetryTimeoutMs;

    while (true) {
      const result = await this.executeAsync(args, listeners, options);

      if (result.status === 0 || !isGuestAgentUnavailableFailure(result)) {
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
    options?: CommandExecutionOptions,
  ): Promise<CommandResult> {
    const result = await this.executeAsync(args, listeners, options);

    if (result.status === 0) {
      return result;
    }

    throw new Error(formatCommandFailure(args, result));
  }

  private async runGuestExecWithRetryAsync(
    args: string[],
    listeners?: CommandStreamListeners,
    options?: CommandExecutionOptions,
  ): Promise<CommandResult> {
    const result = await this.executeGuestExecWithRetryAsync(args, listeners, options);

    if (result.status === 0) {
      return result;
    }

    throw new Error(formatCommandFailure(args, result));
  }

  private async runStreaming(
    args: string[],
    listeners?: CommandStreamListeners,
    options?: CommandExecutionOptions,
  ): Promise<CommandResult> {
    const result = this.runner.executeStreaming
      ? await this.runner.executeStreaming(args, listeners, options)
      : this.runner.execute(args, options);

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

      if (isMissingInstanceFailure(failure)) {
        return;
      }

      if (isDeleteAlreadySucceededFailure(failure)) {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          if ((await this.inspectInstanceSafeAsync(instanceName)) === null) {
            return;
          }
          await sleep(500);
        }
      }

      throw new Error(failure);
    }
  }
}

function buildReadVmDesktopBridgeVersionScript(
  transport: VmDesktopTransport,
): string {
  return `python3 - <<'PY'
import json
from pathlib import Path

bridge_path = Path(${JSON.stringify(DEFAULT_GUEST_DESKTOP_BRIDGE_VERSION_FILE)})
selkies_version_path = Path("/opt/parallaize/selkies-gstreamer/.parallaize-selkies-version")
selkies_patch_path = Path("/opt/parallaize/selkies-gstreamer/.parallaize-selkies-patch-level")

bridge = None
if bridge_path.is_file():
    try:
        bridge = json.loads(bridge_path.read_text())
    except json.JSONDecodeError:
        bridge = {
            "label": bridge_path.read_text().strip() or None,
        }

payload = {
    "bridge": bridge,
    "selkiesPatchLevel": selkies_patch_path.read_text().strip() if selkies_patch_path.is_file() else None,
    "selkiesVersion": selkies_version_path.read_text().strip() if selkies_version_path.is_file() else None,
    "transport": ${JSON.stringify(transport)},
}
print(json.dumps(payload))
PY`;
}

function formatReadyMs(value: number): string {
  if (value < 1000) {
    return `${Math.max(0, Math.round(value))} ms`;
  }

  if (value < 60_000) {
    return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} s`;
  }

  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function mergeUniqueActivity(target: string[], additions: readonly string[]): void {
  for (const entry of additions) {
    if (!target.includes(entry)) {
      target.push(entry);
    }
  }
}

function isNonFatalVmLogStreamFailure(message: string): boolean {
  return message.toLowerCase().includes("inappropriate ioctl for device");
}

function shouldRetryVmPreviewCapture(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();

  return (
    message.includes("xauthority") ||
    message.includes("preview capture requires imagemagick import") ||
    message.includes("unable to open x server") ||
    message.includes("can't open display") ||
    message.includes("cannot open display")
  );
}
