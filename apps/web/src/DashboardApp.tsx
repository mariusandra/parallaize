import {
  Fragment,
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

declare const __PARALLAIZE_VERSION__: string;

import {
  formatRam,
  formatResources,
  formatTimestamp,
  minimumCreateDiskGb,
} from "../../../packages/shared/src/helpers.js";
import type {
  AuthStatus,
  ApiResponse,
  CaptureTemplateInput,
  CreateTemplateInput,
  CreateVmInput,
  DashboardSummary,
  EnvironmentTemplate,
  HealthStatus,
  InjectCommandInput,
  ReorderVmsInput,
  ResizeVmInput,
  ResourceTelemetry,
  SetVmResolutionInput,
  Snapshot,
  SnapshotLaunchInput,
  SnapshotInput,
  SyncVmResolutionControlInput,
  TemplatePortForward,
  UpdateTemplateInput,
  UpdateVmInput,
  UpdateVmNetworkInput,
  VmDetail,
  VmDiskUsageSnapshot,
  VmFileBrowserSnapshot,
  VmFileEntry,
  VmInstance,
  VmLogsSnapshot,
  LatestReleaseMetadata,
  VmNetworkMode,
  VmPowerAction,
  VmPortForward,
  VmResolutionControlSnapshot,
  VmStatus,
  VmTouchedFile,
  VmTouchedFilesSnapshot,
} from "../../../packages/shared/src/types.js";
import {
  applyViewportBoundsToResolution,
  buildResolutionControlLeaseStorageKey,
  canClaimResolutionControlLease,
  createResolutionControlLease,
  emptyResolutionRequestQueue,
  emptyViewportBounds,
  enqueueResolutionRequest,
  parseResolutionControlLease,
  resolveResolutionRequest,
  resolutionControlLeaseTtlMs,
  shouldScheduleResolutionRepair,
  type ResolutionRequest,
  type ViewportBounds,
} from "./desktopResolution.js";
import {
  canUseDeferredIdentifiedCollection,
  orderIdentifiedCollectionByIds,
} from "./deferredCollections.js";
import { parseAnsiText, resolveAnsiSegmentStyle } from "./ansi.js";
import { NoVncViewport } from "./NoVncViewport.js";
import {
  appPackageReleaseLabel,
  classifyAvailableRelease,
  hasNewerReleaseAvailable,
} from "./releaseVersion.js";

type CreateSourceKind = "template" | "snapshot" | "vm";
type CreateSourceCategory =
  | "system-templates"
  | "my-templates"
  | "snapshots"
  | "existing-vms";

interface CreateDraft {
  launchSource: string;
  name: string;
  cpu: string;
  ramGb: string;
  diskGb: string;
  networkMode: VmNetworkMode;
  initCommands: string;
  shutdownSourceBeforeClone: boolean;
}

interface CreateSourceSelection {
  category: CreateSourceCategory;
  kind: CreateSourceKind;
  label: string;
  snapshot: Snapshot | null;
  sourceVm: VmInstance | null;
  template: EnvironmentTemplate;
  value: string;
}

interface CreateSourceGroup {
  label: string;
  options: CreateSourceSelection[];
}

interface ResourceDraft {
  cpu: string;
  ramGb: string;
  diskGb: string;
}

interface ResolutionDraft {
  mode: DesktopResolutionMode;
  scale: string;
  width: string;
  height: string;
}

interface DesktopResolutionPreference {
  mode: DesktopResolutionMode;
  scale: number;
  width: number;
  height: number;
}

interface ForwardDraft {
  name: string;
  guestPort: string;
  description: string;
}

interface CaptureDraft {
  mode: "existing" | "new";
  templateId: string;
  name: string;
  description: string;
}

interface TemplateCloneDraft {
  sourceTemplateId: string;
  name: string;
  description: string;
  initCommands: string;
}

interface TemplateEditDraft {
  templateId: string;
  name: string;
  description: string;
  initCommands: string;
}

interface Notice {
  tone: "error" | "info" | "success";
  message: string;
}

interface LoginDraft {
  username: string;
  password: string;
}

type ThemeMode = "light" | "dark";
type DesktopResolutionMode = "viewport" | "fixed";
type ResolutionControlOwner = "none" | "self" | "other";
type ResolutionControlSource = "none" | "local" | "remote";

interface DesktopResolutionState {
  clientHeight: number | null;
  clientWidth: number | null;
  remoteHeight: number | null;
  remoteWidth: number | null;
}

interface PendingManualResolutionSync {
  token: number;
  vmId: string;
}

interface ResolutionControlStatus {
  controllerClientId: string | null;
  owner: ResolutionControlOwner;
  source: ResolutionControlSource;
  vmId: string | null;
}

const appVersionLabel = __PARALLAIZE_VERSION__;
const githubReleaseTagBaseUrl = "https://github.com/mariusandra/parallaize/releases/tag/v";

interface DesktopResolutionTarget {
  height: number;
  key: string;
  vmId: string;
  width: number;
}

interface ResolutionRetryState {
  attempts: number;
  key: string;
}

type RenameDialogState =
  | {
      kind: "vm";
      id: string;
      currentName: string;
    }
  | {
      kind: "template";
      id: string;
      currentName: string;
      description: string;
    };

interface VmLogsDialogState {
  error: string | null;
  loading: boolean;
  logs: VmLogsSnapshot | null;
  refreshing: boolean;
  vmId: string;
  vmName: string;
}

interface VmLogsViewState {
  error: string | null;
  loading: boolean;
  logs: VmLogsSnapshot | null;
  refreshing: boolean;
}

interface CloneVmDialogState {
  sourceVmId: string;
  sourceVmName: string;
}

const emptyCreateDraft: CreateDraft = {
  launchSource: "",
  name: "",
  cpu: "",
  ramGb: "",
  diskGb: "",
  networkMode: "default",
  initCommands: "",
  shutdownSourceBeforeClone: false,
};

const emptyResourceDraft: ResourceDraft = {
  cpu: "",
  ramGb: "",
  diskGb: "",
};

const emptyResolutionState: DesktopResolutionState = {
  clientHeight: null,
  clientWidth: null,
  remoteHeight: null,
  remoteWidth: null,
};

const emptyForwardDraft: ForwardDraft = {
  name: "",
  guestPort: "",
  description: "",
};

const emptyCaptureDraft: CaptureDraft = {
  mode: "existing",
  templateId: "",
  name: "",
  description: "",
};

const emptyVmLogsViewState: VmLogsViewState = {
  error: null,
  loading: false,
  logs: null,
  refreshing: false,
};

const defaultLoginDraft: LoginDraft = {
  username: "admin",
  password: "",
};

const quickCommands = ["pwd", "ls -la", "pnpm build", "pnpm test", "incus list"];
const railWidthStorageKey = "parallaize.rail-width";
const activeCpuThresholdsByVmStorageKey = "parallaize.active-cpu-thresholds-by-vm";
const overviewSidepanelCollapsedStorageKey = "parallaize.overview-sidepanel-collapsed";
const railCompactWidth = 48;
const railExpandedMinWidth = 248;
const railCompactSnapWidth = Math.round((railCompactWidth + railExpandedMinWidth) / 2);
const railDefaultWidth = 320;
const railMinWidth = railCompactWidth;
const railMaxWidth = 420;
const activeCpuThresholdDefault = 2;
const desktopViewportScaleDefault = 1;
const desktopViewportScaleMin = 0.5;
const desktopViewportScaleMax = 3;
const desktopViewportScaleStep = 0.25;
const liveCaptureWarningCopy =
  "This is fine, but you might capture inconsistent state or leave lockfiles open. Shut the VM down first if you need a clean checkpoint.";
const desktopFixedWidthDefault = 1280;
const desktopFixedHeightDefault = 800;
const desktopFixedWidthMin = 640;
const desktopFixedWidthMax = 3840;
const desktopFixedHeightMin = 480;
const desktopFixedHeightMax = 2160;
const guestDisplayWidthMin = 320;
const guestDisplayWidthMax = 8192;
const guestDisplayWidthStep = 8;
const guestDisplayHeightMin = 200;
const guestDisplayHeightMax = 8192;
const desktopResolutionRetryDelayMs = 900;
const desktopResolutionRetryMaxAttempts = 4;
const desktopResolutionByVmStorageKey = "parallaize.desktop-resolution-by-vm";
const resolutionControlClientIdStorageKey = "parallaize.resolution-control-client-id";
const resolutionControlHeartbeatMs = 1_500;
const sidepanelWidthStorageKey = "parallaize.sidepanel-width";
const sidepanelCollapsedByVmStorageKey = "parallaize.sidepanel-collapsed-vms";
const sidepanelClosedWidth = 0;
const sidepanelDefaultWidth = 380;
const sidepanelMinWidth = 320;
const sidepanelMaxWidth = 560;
const sidepanelCollapseSnapWidth = Math.round(sidepanelMinWidth / 2);
const sidepanelCompactBreakpoint = 1120;
const vmLogsPollIntervalMs = 4000;
const vmDiskUsagePollIntervalMs = 30_000;

const defaultDesktopResolutionPreference: DesktopResolutionPreference = {
  mode: "viewport",
  scale: desktopViewportScaleDefault,
  width: desktopFixedWidthDefault,
  height: desktopFixedHeightDefault,
};

export function DashboardApp(): JSX.Element {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [showInitialLoadingShell, setShowInitialLoadingShell] = useState(false);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [latestRelease, setLatestRelease] = useState<LatestReleaseMetadata | null>(null);
  const [selectedVmId, setSelectedVmId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VmDetail | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [dismissedProminentJobIds, setDismissedProminentJobIds] = useState<
    Record<string, true>
  >({});
  const [createDraft, setCreateDraft] = useState<CreateDraft>(emptyCreateDraft);
  const [createDirty, setCreateDirty] = useState(false);
  const [resourceDraft, setResourceDraft] = useState<ResourceDraft>(emptyResourceDraft);
  const [commandDraft, setCommandDraft] = useState("");
  const [forwardDraft, setForwardDraft] = useState<ForwardDraft>(emptyForwardDraft);
  const [captureDraft, setCaptureDraft] = useState<CaptureDraft>(emptyCaptureDraft);
  const [templateEditDraft, setTemplateEditDraft] = useState<TemplateEditDraft | null>(null);
  const [templateCloneDraft, setTemplateCloneDraft] = useState<TemplateCloneDraft | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [cloneVmDialog, setCloneVmDialog] = useState<CloneVmDialogState | null>(null);
  const [cloneVmDraft, setCloneVmDraft] = useState("");
  const [renameDialog, setRenameDialog] = useState<RenameDialogState | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [vmLogsDialog, setVmLogsDialog] = useState<VmLogsDialogState | null>(null);
  const [workspaceLogs, setWorkspaceLogs] = useState<VmLogsViewState>(emptyVmLogsViewState);
  const [vmLogsRefreshTick, setVmLogsRefreshTick] = useState(0);
  const [vmFileBrowser, setVmFileBrowser] = useState<VmFileBrowserSnapshot | null>(null);
  const [vmFileBrowserLoading, setVmFileBrowserLoading] = useState(false);
  const [vmFileBrowserError, setVmFileBrowserError] = useState<string | null>(null);
  const [vmTouchedFiles, setVmTouchedFiles] = useState<VmTouchedFilesSnapshot | null>(null);
  const [vmTouchedFilesLoading, setVmTouchedFilesLoading] = useState(false);
  const [vmTouchedFilesError, setVmTouchedFilesError] = useState<string | null>(null);
  const [vmDiskUsage, setVmDiskUsage] = useState<VmDiskUsageSnapshot | null>(null);
  const [vmDiskUsageLoading, setVmDiskUsageLoading] = useState(false);
  const [vmDiskUsageError, setVmDiskUsageError] = useState<string | null>(null);
  const [sidepanelCollapsedByVm, setSidepanelCollapsedByVm] = useState<
    Record<string, true>
  >(() => readSidepanelCollapsedByVm());
  const [overviewSidepanelCollapsed, setOverviewSidepanelCollapsed] = useState(() =>
    readStoredBoolean(overviewSidepanelCollapsedStorageKey, false),
  );
  const [desktopResolutionByVm, setDesktopResolutionByVm] = useState<
    Record<string, DesktopResolutionPreference>
  >(() => readDesktopResolutionByVm());
  const [openVmMenuId, setOpenVmMenuId] = useState<string | null>(null);
  const [vmRailOrderIds, setVmRailOrderIds] = useState<string[] | null>(null);
  const [draggedVmId, setDraggedVmId] = useState<string | null>(null);
  const [vmReorderBusy, setVmReorderBusy] = useState(false);
  const [openTemplateMenuId, setOpenTemplateMenuId] = useState<string | null>(null);
  const [shellMenuOpen, setShellMenuOpen] = useState(false);
  const [fullscreenActive, setFullscreenActive] = useState(() => readFullscreenActive());
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readThemeMode());
  const [activeCpuThresholdsByVm, setActiveCpuThresholdsByVm] = useState<
    Record<string, number>
  >(() => readActiveCpuThresholdsByVm());
  const [resolutionDraft, setResolutionDraft] = useState<ResolutionDraft>(() =>
    buildResolutionDraft(
      defaultDesktopResolutionPreference.mode,
      defaultDesktopResolutionPreference.scale,
      defaultDesktopResolutionPreference.width,
      defaultDesktopResolutionPreference.height,
    ),
  );
  const [showLivePreviews, setShowLivePreviews] = useState(() =>
    readStoredBoolean("parallaize.live-previews", true),
  );
  const [viewportWidth, setViewportWidth] = useState(() => readViewportWidth());
  const [railWidthPreference, setRailWidthPreference] = useState(() =>
    clampRailWidthPreference(readStoredNumber(railWidthStorageKey) ?? railDefaultWidth),
  );
  const [sidepanelWidthPreference, setSidepanelWidthPreference] = useState(() =>
    clampSidepanelWidthPreference(
      readStoredNumber(sidepanelWidthStorageKey) ?? sidepanelDefaultWidth,
    ),
  );
  const [authState, setAuthState] = useState<"checking" | "ready" | "required">("checking");
  const [authEnabled, setAuthEnabled] = useState(false);
  const [loginDraft, setLoginDraft] = useState<LoginDraft>(defaultLoginDraft);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [desktopResolution, setDesktopResolution] =
    useState<DesktopResolutionState>(emptyResolutionState);
  const [documentVisible, setDocumentVisible] = useState(() => readDocumentVisible());
  const [resolutionControlStatus, setResolutionControlStatus] =
    useState<ResolutionControlStatus>({
      controllerClientId: null,
      owner: "none",
      source: "none",
      vmId: null,
    });
  const [resolutionControlTakeoverBusy, setResolutionControlTakeoverBusy] = useState(false);
  const [jobTimingNowMs, setJobTimingNowMs] = useState(() => Date.now());
  const [railResizeActive, setRailResizeActive] = useState(false);
  const [sidepanelResizeActive, setSidepanelResizeActive] = useState(false);
  const selectedVmIdRef = useRef<string | null>(null);
  const liveResolutionVmIdRef = useRef<string | null>(null);
  const vmDragDropCommittedRef = useRef(false);
  const clientIdRef = useRef<string>(readOrCreateResolutionControlClientId());
  const tabIdRef = useRef<string>(createTabId());
  const shellMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const railRef = useRef<HTMLElement | null>(null);
  const railResizeRef = useRef<{ panelLeft: number } | null>(null);
  const sidepanelRef = useRef<HTMLElement | null>(null);
  const sidepanelResizeRef = useRef<{
    anchorClientX: number;
    anchorWidth: number;
    pendingClosedOpen: boolean;
  } | null>(null);
  const stageViewportShellRef = useRef<HTMLDivElement | null>(null);
  const stageViewportFrameRef = useRef<HTMLDivElement | null>(null);
  const lastResolutionRequestKeyRef = useRef<string | null>(null);
  const resolutionRequestSequenceRef = useRef(0);
  const resolutionRequestQueueRef = useRef(emptyResolutionRequestQueue);
  const currentResolutionTargetRef = useRef<DesktopResolutionTarget | null>(null);
  const currentRemoteResolutionKeyRef = useRef<string | null>(null);
  const resolutionControlStatusRef = useRef<ResolutionControlStatus>({
    controllerClientId: null,
    owner: "none",
    source: "none",
    vmId: null,
  });
  const resolutionRetryStateRef = useRef<ResolutionRetryState | null>(null);
  const resolutionRetryTimerRef = useRef<number | null>(null);
  const [availableViewportBounds, setAvailableViewportBounds] =
    useState<ViewportBounds>(emptyViewportBounds);
  const [observedViewportBounds, setObservedViewportBounds] =
    useState<ViewportBounds>(emptyViewportBounds);
  const [pendingManualResolutionSync, setPendingManualResolutionSync] =
    useState<PendingManualResolutionSync | null>(null);

  const deferredVms = useDeferredValue(summary?.vms ?? []);
  const deferredTemplates = useDeferredValue(summary?.templates ?? []);
  const displayedVms = canUseDeferredIdentifiedCollection(
    summary?.vms ?? [],
    deferredVms,
  )
    ? deferredVms
    : summary?.vms ?? [];
  const displayedTemplates = canUseDeferredIdentifiedCollection(
    summary?.templates ?? [],
    deferredTemplates,
  )
    ? deferredTemplates
    : summary?.templates ?? [];
  const renderedVms = orderIdentifiedCollectionByIds(displayedVms, vmRailOrderIds);
  const selectedVm =
    summary?.vms.find((entry) => entry.id === selectedVmId) ?? detail?.vm ?? null;
  const selectedDesktopResolutionPreference =
    selectedVmId !== null
      ? desktopResolutionByVm[selectedVmId] ?? defaultDesktopResolutionPreference
      : defaultDesktopResolutionPreference;
  const wideShellLayout = viewportWidth > sidepanelCompactBreakpoint;
  const compactSidepanelLayout = viewportWidth <= sidepanelCompactBreakpoint;
  const sidePanelCollapsed =
    selectedVmId !== null
      ? sidepanelCollapsedByVm[selectedVmId] === true
      : overviewSidepanelCollapsed;
  const effectiveSidePanelCollapsed =
    selectedVmId !== null ? sidePanelCollapsed : wideShellLayout && sidePanelCollapsed;
  const isBusy = busyLabel !== null || vmReorderBusy;
  const currentDetail = selectedVm && detail?.vm.id === selectedVm.id ? detail : null;
  const showWorkspaceLogs =
    currentDetail !== null && shouldShowWorkspaceLogsSurface(currentDetail);
  const liveResolutionVmId =
    currentDetail?.vm.status === "running" &&
    hasBrowserDesktopSession(currentDetail.vm.session)
      ? currentDetail.vm.id
      : null;
  const ownsLiveResolutionControl =
    liveResolutionVmId !== null &&
    resolutionControlStatus.vmId === liveResolutionVmId &&
    resolutionControlStatus.owner === "self";
  const blocksLiveResolutionControl =
    liveResolutionVmId !== null &&
    resolutionControlStatus.vmId === liveResolutionVmId &&
    resolutionControlStatus.owner === "other";
  const resolutionControlHeading = blocksLiveResolutionControl
    ? resolutionControlStatus.source === "remote"
      ? "Controlled on another machine"
      : "Controlled in another window"
    : null;
  const resolutionControlMessage = blocksLiveResolutionControl
    ? resolutionControlStatus.source === "remote"
      ? "This VM is being controlled by another machine. Take over to move live control here."
      : "Another window is currently controlling this VM. Take over here to move live control into this window."
    : null;
  const resolutionControlTakeoverLabel =
    resolutionControlStatus.source === "remote"
      ? "Take over control"
      : "Take over here";
  const supportsLiveDesktop = summary?.provider.desktopTransport === "novnc";
  const newerReleaseAvailable = hasNewerReleaseAvailable(
    appVersionLabel,
    appPackageReleaseLabel,
    latestRelease,
  );
  const releaseIndicatorSeverity = classifyAvailableRelease(
    appVersionLabel,
    appPackageReleaseLabel,
    latestRelease,
  );
  const persistence = health?.persistence ?? null;
  const incusStorage = health?.incusStorage ?? null;
  const desktopResolutionMode = selectedDesktopResolutionPreference.mode;
  const appliedDesktopViewportScale = clampDesktopViewportScale(
    selectedDesktopResolutionPreference.scale,
  );
  const appliedDesktopWidth = clampDesktopFixedWidth(
    selectedDesktopResolutionPreference.width,
  );
  const appliedDesktopHeight = clampDesktopFixedHeight(
    selectedDesktopResolutionPreference.height,
  );
  const sidepanelWidth = clampDisplayedSidepanelWidth(
    sidepanelWidthPreference,
    viewportWidth,
  );
  const displayedSidepanelWidth = effectiveSidePanelCollapsed ? sidepanelClosedWidth : sidepanelWidth;
  const railWidth = clampDisplayedRailWidth(
    railWidthPreference,
    viewportWidth,
    displayedSidepanelWidth,
  );
  const compactRail = wideShellLayout && railWidth <= railCompactWidth;
  const sidepanelStyle = compactSidepanelLayout ? undefined : { width: displayedSidepanelWidth };
  const viewportFrameBounds =
    desktopResolutionMode === "viewport" &&
    availableViewportBounds.width &&
    availableViewportBounds.height
      ? normalizeGuestDisplayResolution(
          availableViewportBounds.width,
          availableViewportBounds.height,
        )
      : null;
  const stageViewportFrameStyle = viewportFrameBounds
    ? ({
        width: `${viewportFrameBounds.width}px`,
        height: `${viewportFrameBounds.height}px`,
      } satisfies CSSProperties)
    : undefined;
  const effectiveDesktopResolution = applyViewportBoundsToResolution(
    desktopResolution,
    observedViewportBounds,
  );
  const desiredDesktopResolutionTarget =
    liveResolutionVmId &&
    (desktopResolutionMode === "fixed" ||
      (effectiveDesktopResolution.clientWidth && effectiveDesktopResolution.clientHeight))
      ? buildDesktopResolutionTarget(
          liveResolutionVmId,
          desktopResolutionMode === "fixed"
            ? appliedDesktopWidth
            : scaleViewportResolutionValue(
                effectiveDesktopResolution.clientWidth,
                appliedDesktopViewportScale,
              ) ?? 0,
          desktopResolutionMode === "fixed"
            ? appliedDesktopHeight
            : scaleViewportResolutionValue(
                effectiveDesktopResolution.clientHeight,
                appliedDesktopViewportScale,
              ) ?? 0,
        )
      : null;
  const currentRemoteResolutionKey =
    liveResolutionVmId &&
    effectiveDesktopResolution.remoteWidth &&
    effectiveDesktopResolution.remoteHeight
      ? buildDesktopResolutionRequestKey(
          liveResolutionVmId,
          effectiveDesktopResolution.remoteWidth,
          effectiveDesktopResolution.remoteHeight,
        )
      : null;
  const workspaceShellStyle = wideShellLayout
    ? ({
        gridTemplateColumns: `${railWidth}px minmax(0, 1fr) ${displayedSidepanelWidth}px`,
      } satisfies CSSProperties)
    : undefined;

  useEffect(() => {
    selectedVmIdRef.current = selectedVmId;
  }, [selectedVmId]);

  useEffect(() => {
    liveResolutionVmIdRef.current = liveResolutionVmId;
  }, [liveResolutionVmId]);

  useEffect(() => {
    resolutionControlStatusRef.current = resolutionControlStatus;
  }, [resolutionControlStatus]);

  useEffect(() => {
    function handleVisibilityChange(): void {
      setDocumentVisible(readDocumentVisible());
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleVisibilityChange);
    window.addEventListener("blur", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleVisibilityChange);
      window.removeEventListener("blur", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    function handleViewportResize(): void {
      setViewportWidth(readViewportWidth());
    }

    window.addEventListener("resize", handleViewportResize);
    return () => {
      window.removeEventListener("resize", handleViewportResize);
    };
  }, []);

  useEffect(() => {
    function handleFullscreenChange(): void {
      setFullscreenActive(readFullscreenActive());
      void syncFullscreenKeyboardLock();
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    void syncFullscreenKeyboardLock();
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      releaseFullscreenKeyboardLock();
    };
  }, []);

  useEffect(() => {
    if (!liveResolutionVmId || !documentVisible) {
      setResolutionControlStatus({
        controllerClientId: null,
        owner: "none",
        source: "none",
        vmId: liveResolutionVmId,
      });
      suspendResolutionControl();
      return;
    }

    const vmId = liveResolutionVmId;
    let cancelled = false;

    async function syncResolutionControl(force = false): Promise<void> {
      try {
        const snapshot = await postJson<
          VmResolutionControlSnapshot,
          SyncVmResolutionControlInput
        >(`/api/vms/${vmId}/resolution-control/claim`, {
          clientId: clientIdRef.current,
          force,
        });

        if (cancelled) {
          return;
        }

        applyResolutionControlSnapshot(snapshot, force);
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (error instanceof AuthRequiredError) {
          requireLogin();
          return;
        }

        setNotice({
          tone: "error",
          message: errorMessage(error),
        });
      }
    }

    void syncResolutionControl();
    const heartbeat = window.setInterval(() => {
      void syncResolutionControl();
    }, resolutionControlHeartbeatMs);
    const leaseKey = buildResolutionControlLeaseStorageKey(vmId);

    const releaseLease = () => {
      releaseResolutionControlLease(vmId, tabIdRef.current);
    };

    function handleStorage(event: StorageEvent): void {
      if (event.key !== null && event.key !== leaseKey) {
        return;
      }

      const currentStatus = resolutionControlStatusRef.current;

      if (
        currentStatus.vmId !== vmId ||
        currentStatus.controllerClientId !== clientIdRef.current
      ) {
        return;
      }

      applyLocalResolutionControl(vmId);
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener("beforeunload", releaseLease);
    window.addEventListener("pagehide", releaseLease);

    return () => {
      cancelled = true;
      window.clearInterval(heartbeat);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("beforeunload", releaseLease);
      window.removeEventListener("pagehide", releaseLease);
      releaseLease();
    };
  }, [documentVisible, liveResolutionVmId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setShowInitialLoadingShell(true);
    }, 1_000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    const vmId = new URL(window.location.href).searchParams.get("vm");
    if (vmId) {
      setSelectedVmId(vmId);
    }

    void (async () => {
      try {
        const status = await fetchJson<AuthStatus>("/api/auth/status");
        setAuthEnabled(status.authEnabled);
        if (status.authEnabled) {
          setLoginDraft((current) => ({
            ...current,
            username: status.username ?? current.username,
          }));
        }

        if (status.authEnabled && !status.authenticated) {
          setAuthState("required");
          return;
        }

        await refreshSummary();
        await refreshHealth(true);
      } catch (error: unknown) {
        setNotice({
          tone: "error",
          message: errorMessage(error),
        });
      }
    })();
  }, []);

  useEffect(() => {
    if (authState !== "ready") {
      return;
    }

    const eventSource = new EventSource("/events");

    eventSource.addEventListener("summary", (event) => {
      const nextSummary = JSON.parse((event as MessageEvent<string>).data) as DashboardSummary;

      startTransition(() => {
        setSummary(nextSummary);
      });

      const currentVmId = selectedVmIdRef.current;

      if (currentVmId && !nextSummary.vms.some((vm) => vm.id === currentVmId)) {
        setSelectedVmId(null);
        setDetail(null);
      }
    });

    eventSource.addEventListener("resolution-control", (event) => {
      const snapshot = JSON.parse(
        (event as MessageEvent<string>).data,
      ) as VmResolutionControlSnapshot;

      if (
        !readDocumentVisible() ||
        !liveResolutionVmIdRef.current ||
        snapshot.vmId !== liveResolutionVmIdRef.current
      ) {
        return;
      }

      applyResolutionControlSnapshot(snapshot);
    });

    eventSource.addEventListener("error", () => {
      setNotice({
        tone: "info",
        message: "Live updates disconnected. The dashboard is retrying automatically.",
      });
    });

    return () => {
      eventSource.close();
    };
  }, [authState]);

  useEffect(() => {
    if (authState !== "ready") {
      setLatestRelease(null);
      setHealth(null);
      return;
    }

    void refreshHealth(true);
    const interval = window.setInterval(() => {
      void refreshHealth(true);
    }, 10_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [authState]);

  useEffect(() => {
    if (authState !== "ready") {
      setLatestRelease(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const releaseMetadata = await fetchJson<LatestReleaseMetadata | null>("/api/version/latest");

        if (!cancelled) {
          setLatestRelease(releaseMetadata);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (error instanceof AuthRequiredError) {
          requireLogin();
          return;
        }

        setLatestRelease(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authState]);

  useEffect(() => {
    const hasActiveJobs =
      summary?.jobs.some((job) => job.status === "queued" || job.status === "running") ?? false;

    if (!hasActiveJobs) {
      return;
    }

    setJobTimingNowMs(Date.now());
    const interval = window.setInterval(() => {
      setJobTimingNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [summary?.jobs]);

  useEffect(() => {
    if (!summary || (summary.templates.length === 0 && summary.snapshots.length === 0)) {
      return;
    }

    setCreateDraft((current) =>
      syncCreateDraft(current, summary.templates, summary.snapshots, summary.vms, createDirty)
    );
  }, [summary?.templates, summary?.snapshots, summary?.vms, createDirty]);

  useEffect(() => {
    if (!openTemplateMenuId || summary?.templates.some((template) => template.id === openTemplateMenuId)) {
      return;
    }

    setOpenTemplateMenuId(null);
  }, [openTemplateMenuId, summary?.templates]);

  useEffect(() => {
    if (!selectedVmId) {
      setDetail(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const nextDetail = await fetchJson<VmDetail>(`/api/vms/${selectedVmId}`);

        if (!cancelled) {
          setDetail(nextDetail);
        }
      } catch (error) {
        if (error instanceof AuthRequiredError) {
          requireLogin();
          return;
        }

        if (!cancelled) {
          setNotice({
            tone: "error",
            message: errorMessage(error),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedVmId, summary?.generatedAt]);

  useEffect(() => {
    if (authState !== "ready" || !detail) {
      setVmFileBrowser(null);
      setVmFileBrowserError(null);
      setVmFileBrowserLoading(false);
      setVmTouchedFiles(null);
      setVmTouchedFilesError(null);
      setVmTouchedFilesLoading(false);
      setVmDiskUsage(null);
      setVmDiskUsageError(null);
      setVmDiskUsageLoading(false);
      return;
    }

    let cancelled = false;
    let refreshTimer: number | null = null;
    const vmId = detail.vm.id;

    setVmFileBrowserLoading(true);
    setVmFileBrowserError(null);
    setVmTouchedFilesLoading(true);
    setVmTouchedFilesError(null);
    setVmDiskUsageLoading(true);
    setVmDiskUsageError(null);

    const loadSnapshots = async (): Promise<void> => {
      try {
        const [browserSnapshot, touchedSnapshot, diskUsageSnapshot] = await Promise.all([
          fetchJson<VmFileBrowserSnapshot>(`/api/vms/${vmId}/files`),
          fetchJson<VmTouchedFilesSnapshot>(`/api/vms/${vmId}/files/touched`),
          fetchJson<VmDiskUsageSnapshot>(`/api/vms/${vmId}/disk-usage`),
        ]);

        if (cancelled) {
          return;
        }

        setVmFileBrowser(browserSnapshot);
        setVmTouchedFiles(touchedSnapshot);
        setVmDiskUsage(diskUsageSnapshot);
        setVmFileBrowserError(null);
        setVmTouchedFilesError(null);
        setVmDiskUsageError(null);
      } catch (error) {
        if (error instanceof AuthRequiredError) {
          requireLogin();
          return;
        }

        if (cancelled) {
          return;
        }

        const message = errorMessage(error);
        setVmFileBrowserError(message);
        setVmTouchedFilesError(message);
        setVmDiskUsageError(message);
      } finally {
        if (cancelled) {
          return;
        }

        setVmFileBrowserLoading(false);
        setVmTouchedFilesLoading(false);
        setVmDiskUsageLoading(false);
      }
    };

    const refreshDiskUsage = async (): Promise<void> => {
      setVmDiskUsageLoading(true);

      try {
        const diskUsageSnapshot = await fetchJson<VmDiskUsageSnapshot>(`/api/vms/${vmId}/disk-usage`);

        if (cancelled) {
          return;
        }

        setVmDiskUsage(diskUsageSnapshot);
        setVmDiskUsageError(null);
      } catch (error) {
        if (error instanceof AuthRequiredError) {
          requireLogin();
          return;
        }

        if (cancelled) {
          return;
        }

        setVmDiskUsageError(errorMessage(error));
      } finally {
        if (cancelled) {
          return;
        }

        setVmDiskUsageLoading(false);
      }

      if (!cancelled && detail.vm.status === "running") {
        refreshTimer = window.setTimeout(() => {
          void refreshDiskUsage();
        }, vmDiskUsagePollIntervalMs);
      }
    };

    void loadSnapshots().then(() => {
      if (!cancelled && detail.vm.status === "running") {
        refreshTimer = window.setTimeout(() => {
          void refreshDiskUsage();
        }, vmDiskUsagePollIntervalMs);
      }
    });

    return () => {
      cancelled = true;

      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
    };
  }, [authState, detail?.vm.id, detail?.vm.workspacePath, detail?.vm.status]);

  useEffect(() => {
    if (authState !== "ready" || !vmLogsDialog) {
      return;
    }

    let cancelled = false;
    let refreshTimer: number | null = null;
    const vmId = vmLogsDialog.vmId;

    const loadLogs = async (mode: "initial" | "refresh"): Promise<void> => {
      setVmLogsDialog((current) => {
        if (!current || current.vmId !== vmId) {
          return current;
        }

        return {
          ...current,
          loading: mode === "initial" && current.logs === null,
          refreshing: mode === "refresh" && current.logs !== null,
        };
      });

      try {
        const logs = await fetchJson<VmLogsSnapshot>(`/api/vms/${vmId}/logs`);

        if (cancelled) {
          return;
        }

        setVmLogsDialog((current) =>
          current && current.vmId === vmId
            ? {
                ...current,
                error: null,
                loading: false,
                logs,
                refreshing: false,
              }
            : current,
        );
      } catch (error) {
        if (error instanceof AuthRequiredError) {
          requireLogin();
          return;
        }

        if (cancelled) {
          return;
        }

        setVmLogsDialog((current) =>
          current && current.vmId === vmId
            ? {
                ...current,
                error: errorMessage(error),
                loading: false,
                refreshing: false,
              }
            : current,
        );
      }

      if (!cancelled) {
        refreshTimer = window.setTimeout(() => {
          void loadLogs("refresh");
        }, vmLogsPollIntervalMs);
      }
    };

    void loadLogs(vmLogsDialog.logs ? "refresh" : "initial");

    return () => {
      cancelled = true;

      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
    };
  }, [authState, vmLogsDialog?.vmId, vmLogsRefreshTick]);

  useEffect(() => {
    if (!summary || !vmLogsDialog) {
      return;
    }

    const matchingVm = summary.vms.find((entry) => entry.id === vmLogsDialog.vmId);

    if (!matchingVm || matchingVm.name === vmLogsDialog.vmName) {
      return;
    }

    setVmLogsDialog((current) =>
      current && current.vmId === matchingVm.id
        ? {
            ...current,
            vmName: matchingVm.name,
          }
      : current,
    );
  }, [summary?.generatedAt, vmLogsDialog?.vmId, vmLogsDialog?.vmName]);

  useEffect(() => {
    if (authState !== "ready" || !currentDetail || !showWorkspaceLogs) {
      setWorkspaceLogs(emptyVmLogsViewState);
      return;
    }

    let cancelled = false;
    let refreshTimer: number | null = null;
    const vmId = currentDetail.vm.id;

    setWorkspaceLogs(emptyVmLogsViewState);

    const loadLogs = async (mode: "initial" | "refresh"): Promise<void> => {
      setWorkspaceLogs((current) => ({
        ...current,
        loading: mode === "initial" && current.logs === null,
        refreshing: mode === "refresh" && current.logs !== null,
      }));

      try {
        const logs = await fetchJson<VmLogsSnapshot>(`/api/vms/${vmId}/logs`);

        if (cancelled) {
          return;
        }

        setWorkspaceLogs({
          error: null,
          loading: false,
          logs,
          refreshing: false,
        });
      } catch (error) {
        if (error instanceof AuthRequiredError) {
          requireLogin();
          return;
        }

        if (cancelled) {
          return;
        }

        setWorkspaceLogs((current) => ({
          ...current,
          error: errorMessage(error),
          loading: false,
          refreshing: false,
        }));
      }

      if (!cancelled) {
        refreshTimer = window.setTimeout(() => {
          void loadLogs("refresh");
        }, vmLogsPollIntervalMs);
      }
    };

    void loadLogs("initial");

    return () => {
      cancelled = true;

      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
    };
  }, [authState, currentDetail?.vm.id, showWorkspaceLogs]);

  useEffect(() => {
    if (!detail) {
      setResourceDraft(emptyResourceDraft);
      return;
    }

    setResourceDraft({
      cpu: String(detail.vm.resources.cpu),
      ramGb: formatRamDraftValue(detail.vm.resources.ramMb),
      diskGb: String(detail.vm.resources.diskGb),
    });
  }, [
    detail?.vm.id,
    detail?.vm.resources.cpu,
    detail?.vm.resources.ramMb,
    detail?.vm.resources.diskGb,
  ]);

  useEffect(() => {
    if (!detail) {
      setCaptureDraft(emptyCaptureDraft);
      return;
    }

    setCaptureDraft(buildCaptureDraft(detail.template, detail.vm));
  }, [
    detail?.vm.id,
    detail?.template?.id,
    detail?.template?.name,
    detail?.template?.description,
  ]);

  useEffect(() => {
    if (!detail) {
      setForwardDraft(emptyForwardDraft);
      return;
    }

    setForwardDraft(emptyForwardDraft);
  }, [detail?.vm.id]);

  useEffect(() => {
    if (!selectedVmId) {
      const url = new URL(window.location.href);
      url.searchParams.delete("vm");
      window.history.replaceState({}, "", url);
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.set("vm", selectedVmId);
    window.history.replaceState({}, "", url);
  }, [selectedVmId]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setNotice((current) => (current === notice ? null : current));
    }, notice.tone === "error" ? 6_500 : 3_600);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [notice]);

  useEffect(() => {
    setDismissedProminentJobIds((current) =>
      pruneDismissedProminentJobIds(current, summary?.jobs),
    );
  }, [summary?.jobs]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    writeStoredString("parallaize.theme", themeMode);
  }, [themeMode]);

  useEffect(() => {
    writeStoredString(
      "parallaize.live-previews",
      showLivePreviews ? "true" : "false",
    );
  }, [showLivePreviews]);

  useEffect(() => {
    writeStoredString(
      activeCpuThresholdsByVmStorageKey,
      JSON.stringify(activeCpuThresholdsByVm),
    );
  }, [activeCpuThresholdsByVm]);

  useEffect(() => {
    writeStoredString(railWidthStorageKey, String(railWidthPreference));
  }, [railWidthPreference]);

  useEffect(() => {
    writeStoredString(sidepanelWidthStorageKey, String(sidepanelWidthPreference));
  }, [sidepanelWidthPreference]);

  useEffect(() => {
    writeStoredString(
      overviewSidepanelCollapsedStorageKey,
      overviewSidepanelCollapsed ? "true" : "false",
    );
  }, [overviewSidepanelCollapsed]);

  useEffect(() => {
    writeStoredString(
      sidepanelCollapsedByVmStorageKey,
      JSON.stringify(sidepanelCollapsedByVm),
    );
  }, [sidepanelCollapsedByVm]);

  useEffect(() => {
    writeStoredString(
      desktopResolutionByVmStorageKey,
      JSON.stringify(desktopResolutionByVm),
    );
  }, [desktopResolutionByVm]);

  useEffect(() => {
    if (
      !currentDetail ||
      currentDetail.vm.session?.kind !== "vnc" ||
      !currentDetail.vm.session.webSocketPath
    ) {
      setDesktopResolution(emptyResolutionState);
      setAvailableViewportBounds(emptyViewportBounds);
      setObservedViewportBounds(emptyViewportBounds);
    }
  }, [currentDetail?.vm.id, currentDetail?.vm.session?.kind, currentDetail?.vm.session?.webSocketPath]);

  useEffect(() => {
    clearResolutionRetryTimer();
    lastResolutionRequestKeyRef.current = null;
    resolutionRequestQueueRef.current = emptyResolutionRequestQueue;
    currentResolutionTargetRef.current = null;
    currentRemoteResolutionKeyRef.current = null;
    resolutionRetryStateRef.current = null;
    setPendingManualResolutionSync(null);
  }, [currentDetail?.vm.id]);

  useEffect(() => {
    const shellNode = stageViewportShellRef.current;

    if (!shellNode) {
      setAvailableViewportBounds(emptyViewportBounds);
      return;
    }

    const observedShellNode: HTMLDivElement = shellNode;

    function reportAvailableBounds(): void {
      const bounds = observedShellNode.getBoundingClientRect();
      setAvailableViewportBounds({
        height: bounds.height > 0 ? Math.round(bounds.height) : null,
        width: bounds.width > 0 ? Math.round(bounds.width) : null,
      });
    }

    reportAvailableBounds();

    const observer = new ResizeObserver(() => {
      reportAvailableBounds();
    });
    observer.observe(observedShellNode);

    return () => {
      observer.disconnect();
      setAvailableViewportBounds(emptyViewportBounds);
    };
  }, [
    currentDetail?.vm.id,
    currentDetail?.vm.session?.kind,
    currentDetail?.vm.session?.webSocketPath,
  ]);

  useEffect(() => {
    const frameNode = stageViewportFrameRef.current;

    if (!frameNode) {
      setObservedViewportBounds(emptyViewportBounds);
      return;
    }

    const observedFrameNode: HTMLDivElement = frameNode;

    function reportBounds(): void {
      const bounds = observedFrameNode.getBoundingClientRect();
      setObservedViewportBounds({
        height: bounds.height > 0 ? Math.round(bounds.height) : null,
        width: bounds.width > 0 ? Math.round(bounds.width) : null,
      });
    }

    reportBounds();

    const observer = new ResizeObserver(() => {
      reportBounds();
    });
    observer.observe(observedFrameNode);

    return () => {
      observer.disconnect();
      setObservedViewportBounds(emptyViewportBounds);
    };
  }, [
    currentDetail?.vm.id,
    currentDetail?.vm.session?.kind,
    currentDetail?.vm.session?.webSocketPath,
    desktopResolutionMode,
  ]);

  useEffect(() => {
    currentResolutionTargetRef.current = desiredDesktopResolutionTarget;
    currentRemoteResolutionKeyRef.current = currentRemoteResolutionKey;

    if (!ownsLiveResolutionControl) {
      clearResolutionRetryTimer();
      resolutionRetryStateRef.current = null;
      return;
    }

    if (!desiredDesktopResolutionTarget) {
      clearResolutionRetryTimer();
      resolutionRetryStateRef.current = null;
      return;
    }

    if (currentRemoteResolutionKey === desiredDesktopResolutionTarget.key) {
      clearResolutionRetryTimer();
      resolutionRetryStateRef.current = {
        attempts: 0,
        key: desiredDesktopResolutionTarget.key,
      };
      return;
    }

    if (resolutionRetryStateRef.current?.key !== desiredDesktopResolutionTarget.key) {
      clearResolutionRetryTimer();
      resolutionRetryStateRef.current = {
        attempts: 0,
        key: desiredDesktopResolutionTarget.key,
      };
    }
  }, [currentRemoteResolutionKey, desiredDesktopResolutionTarget?.key, ownsLiveResolutionControl]);

  useEffect(() => {
    if (!ownsLiveResolutionControl) {
      return;
    }

    if (!desiredDesktopResolutionTarget) {
      return;
    }

    if (
      desktopResolutionMode === "viewport" &&
      (railResizeActive || sidepanelResizeActive)
    ) {
      return;
    }

    const attempts =
      resolutionRetryStateRef.current?.key === desiredDesktopResolutionTarget.key
        ? resolutionRetryStateRef.current.attempts
        : 0;

    if (
      !shouldScheduleResolutionRepair({
        attempts,
        currentRemoteKey: currentRemoteResolutionKey,
        maxAttempts: desktopResolutionRetryMaxAttempts,
        queue: resolutionRequestQueueRef.current,
        targetKey: desiredDesktopResolutionTarget.key,
      }) ||
      resolutionRetryTimerRef.current !== null
    ) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const currentTarget = currentResolutionTargetRef.current;

      if (
        !currentTarget ||
        currentTarget.key !== desiredDesktopResolutionTarget.key ||
        resolutionRetryTimerRef.current !== null
      ) {
        return;
      }

      const nextAttempts =
        resolutionRetryStateRef.current?.key === currentTarget.key
          ? resolutionRetryStateRef.current.attempts
          : 0;

      if (
        !shouldScheduleResolutionRepair({
          attempts: nextAttempts,
          currentRemoteKey: currentRemoteResolutionKeyRef.current,
          maxAttempts: desktopResolutionRetryMaxAttempts,
          queue: resolutionRequestQueueRef.current,
          targetKey: currentTarget.key,
        })
      ) {
        return;
      }

      resolutionRetryStateRef.current = {
        attempts: nextAttempts + 1,
        key: currentTarget.key,
      };
      lastResolutionRequestKeyRef.current = null;
      syncVmResolution(currentTarget.vmId, currentTarget.width, currentTarget.height, true);
    }, desktopResolutionRetryDelayMs);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    currentRemoteResolutionKey,
    desiredDesktopResolutionTarget?.key,
    desktopResolutionMode,
    ownsLiveResolutionControl,
    railResizeActive,
    sidepanelResizeActive,
  ]);

  useEffect(() => {
    return () => {
      clearResolutionRetryTimer();
    };
  }, []);

  useEffect(() => {
    setResolutionDraft(
      buildResolutionDraft(
        desktopResolutionMode,
        appliedDesktopViewportScale,
        appliedDesktopWidth,
        appliedDesktopHeight,
      ),
    );
  }, [
    appliedDesktopHeight,
    appliedDesktopViewportScale,
    appliedDesktopWidth,
    desktopResolutionMode,
    selectedVmId,
  ]);

  useEffect(() => {
    if (!ownsLiveResolutionControl) {
      return;
    }

    if (!desiredDesktopResolutionTarget) {
      return;
    }

    if (
      desktopResolutionMode === "viewport" &&
      (railResizeActive || sidepanelResizeActive)
    ) {
      return;
    }

    const manualResolutionSyncForVm =
      pendingManualResolutionSync?.vmId === desiredDesktopResolutionTarget.vmId
        ? pendingManualResolutionSync
        : null;
    const timeout = window.setTimeout(() => {
      syncVmResolution(
        desiredDesktopResolutionTarget.vmId,
        desiredDesktopResolutionTarget.width,
        desiredDesktopResolutionTarget.height,
        manualResolutionSyncForVm === null,
      );

      if (manualResolutionSyncForVm) {
        setPendingManualResolutionSync((current) =>
          current?.token === manualResolutionSyncForVm.token ? null : current,
        );
      }
    }, manualResolutionSyncForVm ? 0 : desktopResolutionMode === "viewport" ? 220 : 0);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    desktopResolutionMode,
    desiredDesktopResolutionTarget?.key,
    ownsLiveResolutionControl,
    pendingManualResolutionSync?.token,
    pendingManualResolutionSync?.vmId,
    railResizeActive,
    sidepanelResizeActive,
  ]);

  useEffect(() => {
    if (!railResizeActive) {
      return;
    }

    function stopResize(): void {
      railResizeRef.current = null;
      setRailResizeActive(false);
    }

    function handlePointerMove(event: PointerEvent): void {
      const panelLeft = railResizeRef.current?.panelLeft;

      if (panelLeft === undefined) {
        return;
      }

      setRailWidthPreference(
        clampRailWidthPreference(event.clientX - panelLeft),
      );
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        stopResize();
      }
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("blur", stopResize);
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", stopResize);
    document.addEventListener("pointercancel", stopResize);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("blur", stopResize);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", stopResize);
      document.removeEventListener("pointercancel", stopResize);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [railResizeActive]);

  useEffect(() => {
    if (!sidepanelResizeActive) {
      return;
    }

    function stopResize(): void {
      sidepanelResizeRef.current = null;
      setSidepanelResizeActive(false);
    }

    function handlePointerMove(event: PointerEvent): void {
      const resizeState = sidepanelResizeRef.current;

      if (resizeState === null) {
        return;
      }

      if (resizeState.pendingClosedOpen) {
        const openingWidth = resizeState.anchorClientX - event.clientX;

        if (openingWidth < sidepanelMinWidth) {
          setCurrentSidepanelCollapsed(true);
          return;
        }

        const activatedWidth = clampDisplayedSidepanelWidth(openingWidth, viewportWidth);
        resizeState.anchorClientX = event.clientX;
        resizeState.anchorWidth = activatedWidth;
        resizeState.pendingClosedOpen = false;
        setCurrentSidepanelCollapsed(false);
        setSidepanelWidthPreference(activatedWidth);
        return;
      }

      const rawWidth =
        resizeState.anchorWidth + (resizeState.anchorClientX - event.clientX);

      const nextWidth = clampDisplayedSidepanelWidth(rawWidth, viewportWidth);

      if (nextWidth === sidepanelClosedWidth) {
        resizeState.anchorClientX =
          sidepanelRef.current?.getBoundingClientRect().right ?? event.clientX;
        resizeState.anchorWidth = sidepanelClosedWidth;
        resizeState.pendingClosedOpen = true;
        setCurrentSidepanelCollapsed(true);
        return;
      }

      setCurrentSidepanelCollapsed(false);
      setSidepanelWidthPreference(nextWidth);
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        stopResize();
      }
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("blur", stopResize);
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", stopResize);
    document.addEventListener("pointercancel", stopResize);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("blur", stopResize);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", stopResize);
      document.removeEventListener("pointercancel", stopResize);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [sidepanelResizeActive, viewportWidth]);

  async function refreshSummary(): Promise<DashboardSummary> {
    const nextSummary = await fetchJson<DashboardSummary>("/api/summary");
    startTransition(() => {
      setSummary(nextSummary);
    });
    setAuthState("ready");
    return nextSummary;
  }

  async function refreshHealth(silent: boolean): Promise<HealthStatus | null> {
    try {
      const nextHealth = await fetchJson<HealthStatus>("/api/health");
      setHealth(nextHealth);
      return nextHealth;
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        requireLogin();
        return null;
      }

      if (!silent) {
        setNotice({
          tone: "error",
          message: errorMessage(error),
        });
      }

      return null;
    }
  }

  async function refreshDetail(vmId: string): Promise<void> {
    setDetail(await fetchJson<VmDetail>(`/api/vms/${vmId}`));
  }

  async function refreshVmFileBrowserSnapshot(
    vmId: string,
    path?: string,
  ): Promise<void> {
    setVmFileBrowserLoading(true);
    setVmFileBrowserError(null);

    try {
      const query = path && path.trim().length > 0
        ? `?path=${encodeURIComponent(path)}`
        : "";
      const snapshot = await fetchJson<VmFileBrowserSnapshot>(
        `/api/vms/${vmId}/files${query}`,
      );
      setVmFileBrowser(snapshot);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        requireLogin();
        return;
      }

      setVmFileBrowserError(errorMessage(error));
    } finally {
      setVmFileBrowserLoading(false);
    }
  }

  async function refreshVmTouchedFilesSnapshot(vmId: string): Promise<void> {
    setVmTouchedFilesLoading(true);
    setVmTouchedFilesError(null);

    try {
      const snapshot = await fetchJson<VmTouchedFilesSnapshot>(`/api/vms/${vmId}/files/touched`);
      setVmTouchedFiles(snapshot);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        requireLogin();
        return;
      }

      setVmTouchedFilesError(errorMessage(error));
    } finally {
      setVmTouchedFilesLoading(false);
    }
  }

  function requireLogin(): void {
    setAuthState("required");
    setHealth(null);
    setSummary(null);
    setDetail(null);
    setVmFileBrowser(null);
    setVmFileBrowserError(null);
    setVmFileBrowserLoading(false);
    setVmTouchedFiles(null);
    setVmTouchedFilesError(null);
    setVmTouchedFilesLoading(false);
    setVmDiskUsage(null);
    setVmDiskUsageError(null);
    setVmDiskUsageLoading(false);
    setNotice(null);
    setBusyLabel(null);
    setShellMenuOpen(false);
    setOpenVmMenuId(null);
    setOpenTemplateMenuId(null);
    setVmLogsDialog(null);
  }

  async function handleLogout(): Promise<void> {
    try {
      await postJson<AuthStatus>("/api/auth/logout", {});
    } finally {
      requireLogin();
    }
  }

  async function runMutation(
    label: string,
    task: () => Promise<void>,
    successMessage?: string,
  ): Promise<void> {
    setBusyLabel(label);

    try {
      await task();
      if (successMessage) {
        setNotice({
          tone: "success",
          message: successMessage,
        });
      }
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        requireLogin();
        return;
      }

      setNotice({
        tone: "error",
        message: errorMessage(error),
      });
    } finally {
      setBusyLabel(null);
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const selectedSource =
      summary
        ? resolveCreateSourceSelection(
            summary.templates,
            summary.snapshots,
            summary.vms,
            createDraft.launchSource,
          )
        : null;
    const createValidationError = buildCreateLaunchValidationError(
      selectedSource,
      createDraft.diskGb,
    );

    if (!selectedSource) {
      setNotice({
        tone: "error",
        message: "Choose a template, snapshot, or existing VM before launching a workspace.",
      });
      return;
    }

    if (createValidationError) {
      setNotice({
        tone: "error",
        message: createValidationError,
      });
      return;
    }

    const requestedName = createDraft.name.trim();
    const requestedResources = {
      cpu: Number(createDraft.cpu),
      ramMb: parseRamDraftValue(createDraft.ramGb),
      diskGb: Number(createDraft.diskGb),
    };
    const pendingLabel =
      requestedName ||
      (selectedSource.kind === "vm" && selectedSource.sourceVm
        ? `${selectedSource.sourceVm.name}-clone`
        : "workspace");

    await runMutation(
      `Creating ${pendingLabel}`,
      async () => {
        const createdVm =
          selectedSource.kind === "vm" && selectedSource.sourceVm
            ? await postJson<VmInstance>(`/api/vms/${selectedSource.sourceVm.id}/clone`, {
                sourceVmId: selectedSource.sourceVm.id,
                name: requestedName,
                resources: requestedResources,
                networkMode: createDraft.networkMode,
                shutdownSourceBeforeClone: createDraft.shutdownSourceBeforeClone,
              })
            : await postJson<VmInstance>("/api/vms", {
                name: requestedName,
                resources: requestedResources,
                networkMode: createDraft.networkMode,
                ...(selectedSource.kind === "snapshot"
                  ? { snapshotId: selectedSource.snapshot?.id }
                  : {
                      templateId: selectedSource.template.id,
                      initCommands: parseInitCommandsDraft(createDraft.initCommands),
                    }),
              } satisfies CreateVmInput);
        setCreateDirty(false);
        if (selectedSource.kind === "snapshot" && selectedSource.snapshot) {
          setCreateDraft(
            buildCreateDraftFromSnapshot(
              selectedSource.snapshot,
              selectedSource.template,
              selectedSource.sourceVm,
            ),
          );
        } else if (selectedSource.kind === "vm" && selectedSource.sourceVm) {
          setCreateDraft(
            buildCreateDraftFromVm(
              selectedSource.sourceVm,
              selectedSource.template,
            ),
          );
        } else {
          setCreateDraft(buildCreateDraftFromTemplate(selectedSource.template));
        }
        setVmSidepanelCollapsed(createdVm.id, false);
        setSelectedVmId(createdVm.id);
        setShowCreateDialog(false);
        await refreshSummary();
        await refreshDetail(createdVm.id);
      },
      selectedSource.kind === "snapshot"
        ? `Queued snapshot launch for ${pendingLabel}.`
        : selectedSource.kind === "vm"
          ? `Queued clone for ${pendingLabel}.`
          : `Queued create for ${pendingLabel}.`,
    );
  }

  function handleCreateField(field: keyof CreateDraft, value: string): void {
    setCreateDirty(true);
    setCreateDraft((current) => {
      switch (field) {
        case "launchSource":
          return {
            ...current,
            launchSource: value,
          };
        case "name":
          return {
            ...current,
            name: value,
          };
        case "cpu":
          return {
            ...current,
            cpu: value,
          };
        case "ramGb":
          return {
            ...current,
            ramGb: value,
          };
        case "diskGb":
          return {
            ...current,
            diskGb: value,
          };
        case "networkMode":
          return {
            ...current,
            networkMode: normalizeVmNetworkMode(value),
          };
        case "initCommands":
          return {
            ...current,
            initCommands: value,
          };
        case "shutdownSourceBeforeClone":
          return current;
      }
    });
  }

  function handleCreateShutdownBeforeCloneChange(checked: boolean): void {
    setCreateDirty(true);
    setCreateDraft((current) => ({
      ...current,
      shutdownSourceBeforeClone: checked,
    }));
  }

  function handleCreateSourceChange(event: ChangeEvent<HTMLSelectElement>): void {
    if (!summary) {
      return;
    }

    const selectedSource = resolveCreateSourceSelection(
      summary.templates,
      summary.snapshots,
      summary.vms,
      event.target.value,
    );

    if (!selectedSource) {
      return;
    }

    setCreateDirty(false);
    setCreateDraft(buildCreateDraftFromSource(selectedSource, createDraft.name));
  }

  function openCreateDialog(): void {
    setOpenTemplateMenuId(null);
    setOpenVmMenuId(null);
    setShellMenuOpen(false);
    setShowCreateDialog(true);
  }

  function openCreateDialogForTemplate(template: EnvironmentTemplate): void {
    setCreateDirty(false);
    setCreateDraft(buildCreateDraftFromTemplate(template));
    setOpenTemplateMenuId(null);
    setOpenVmMenuId(null);
    setShellMenuOpen(false);
    setShowCreateDialog(true);
  }

  function openTemplateCloneDialog(template: EnvironmentTemplate): void {
    setOpenTemplateMenuId(null);
    setOpenVmMenuId(null);
    setShellMenuOpen(false);
    setTemplateCloneDraft(buildTemplateCloneDraft(template));
  }

  function openTemplateEditDialog(template: EnvironmentTemplate): void {
    setOpenTemplateMenuId(null);
    setOpenVmMenuId(null);
    setShellMenuOpen(false);
    setTemplateEditDraft(buildTemplateEditDraft(template));
  }

  function closeTemplateEditDialog(): void {
    setTemplateEditDraft(null);
  }

  function handleTemplateEditField(
    field: keyof TemplateEditDraft,
    value: string,
  ): void {
    setTemplateEditDraft((current) =>
      current
        ? {
            ...current,
            [field]: value,
          }
        : current,
    );
  }

  function closeTemplateCloneDialog(): void {
    setTemplateCloneDraft(null);
  }

  function handleTemplateCloneField(
    field: keyof TemplateCloneDraft,
    value: string,
  ): void {
    setTemplateCloneDraft((current) =>
      current
        ? {
            ...current,
            [field]: value,
          }
        : current,
    );
  }

  function openVmLogsDialog(vm: VmInstance): void {
    setOpenVmMenuId(null);
    setShellMenuOpen(false);
    setVmLogsDialog({
      error: null,
      loading: true,
      logs: null,
      refreshing: false,
      vmId: vm.id,
      vmName: vm.name,
    });
  }

  function closeVmLogsDialog(): void {
    setVmLogsDialog(null);
  }

  function refreshVmLogsDialog(): void {
    setVmLogsRefreshTick((current) => current + 1);
  }

  function closeCloneVmDialog(): void {
    setCloneVmDialog(null);
    setCloneVmDraft("");
  }

  function closeRenameDialog(): void {
    setRenameDialog(null);
    setRenameDraft("");
  }

  async function handleRenameVm(vm: VmInstance): Promise<void> {
    setOpenVmMenuId(null);
    setShellMenuOpen(false);
    setRenameDialog({
      kind: "vm",
      id: vm.id,
      currentName: vm.name,
    });
    setRenameDraft(vm.name);
  }

  async function handleRenameTemplate(template: EnvironmentTemplate): Promise<void> {
    openTemplateEditDialog(template);
  }

  async function handleRenameSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!renameDialog) {
      return;
    }

    const name = renameDraft.trim();

    if (!name || name === renameDialog.currentName) {
      return;
    }

    if (renameDialog.kind === "vm") {
      await runMutation(
        `Renaming ${renameDialog.currentName}`,
        async () => {
          await postJson<VmInstance>(
            `/api/vms/${renameDialog.id}/update`,
            {
              name,
            } satisfies UpdateVmInput,
          );
          closeRenameDialog();
          await refreshSummary();
          if (selectedVmIdRef.current === renameDialog.id) {
            await refreshDetail(renameDialog.id);
          }
        },
        `Renamed workspace to ${name}.`,
      );
      return;
    }

    await runMutation(
      `Renaming ${renameDialog.currentName}`,
      async () => {
        await postJson<EnvironmentTemplate>(
          `/api/templates/${renameDialog.id}/update`,
          {
            name,
            description: renameDialog.description,
          } satisfies UpdateTemplateInput,
        );
        closeRenameDialog();
        await refreshSummary();
      },
      `Renamed template to ${name}.`,
    );
  }

  function activeCpuThresholdForVm(vmId: string): number {
    return normalizeActiveCpuThreshold(
      activeCpuThresholdsByVm[vmId] ?? activeCpuThresholdDefault,
    );
  }

  function handleSetActiveCpuThreshold(vm: VmInstance): void {
    const nextValue = window.prompt(
      "Active threshold (%)",
      String(activeCpuThresholdForVm(vm.id)),
    );

    if (nextValue === null) {
      return;
    }

    const parsed = Number(nextValue.replace(/%/gu, "").trim());

    if (!Number.isFinite(parsed)) {
      setNotice({
        tone: "error",
        message: "Active threshold must be a number between 0 and 100.",
      });
      return;
    }

    const nextThreshold = normalizeActiveCpuThreshold(parsed);
    setActiveCpuThresholdsByVm((current) => {
      if (nextThreshold === activeCpuThresholdDefault) {
        if (!(vm.id in current)) {
          return current;
        }

        const next = { ...current };
        delete next[vm.id];
        return next;
      }

      if (current[vm.id] === nextThreshold) {
        return current;
      }

      return {
        ...current,
        [vm.id]: nextThreshold,
      };
    });
  }

  async function handleEditTemplateSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    if (!templateEditDraft) {
      return;
    }

    const name = templateEditDraft.name.trim();

    if (!name) {
      return;
    }

    await runMutation(
      `Updating ${templateEditDraft.name.trim() || "template"}`,
      async () => {
        await postJson<EnvironmentTemplate>(
          `/api/templates/${templateEditDraft.templateId}/update`,
          {
            name,
            description: templateEditDraft.description.trim(),
            initCommands: parseInitCommandsDraft(templateEditDraft.initCommands),
          } satisfies UpdateTemplateInput,
        );
        closeTemplateEditDialog();
        await refreshSummary();
      },
      `Updated template ${name}.`,
    );
  }

  async function handleTemplateCloneSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    if (!templateCloneDraft) {
      return;
    }

    const payload: CreateTemplateInput = {
      sourceTemplateId: templateCloneDraft.sourceTemplateId,
      name: templateCloneDraft.name.trim(),
      description: templateCloneDraft.description.trim(),
      initCommands: parseInitCommandsDraft(templateCloneDraft.initCommands),
    };

    await runMutation(
      `Saving template ${payload.name || "template"}`,
      async () => {
        const createdTemplate = await postJson<EnvironmentTemplate>("/api/templates", payload);
        closeTemplateCloneDialog();
        await refreshSummary();
        setCreateDirty(false);
        setCreateDraft(buildCreateDraftFromTemplate(createdTemplate));
      },
      `Saved template ${payload.name}.`,
    );
  }

  async function handleDeleteTemplate(template: EnvironmentTemplate): Promise<void> {
    setOpenTemplateMenuId(null);

    const linkedVmCount =
      summary?.vms.filter((entry) => entry.templateId === template.id).length ?? 0;

    if (linkedVmCount > 0) {
      setNotice({
        tone: "error",
        message:
          `${template.name} is still attached to ${linkedVmCount} ` +
          `VM${linkedVmCount === 1 ? "" : "s"}. Delete those workspaces first.`,
      });
      return;
    }

    if (!window.confirm(`Delete template ${template.name}?`)) {
      return;
    }

    await runMutation(
      `Deleting ${template.name}`,
      async () => {
        await postJson(`/api/templates/${template.id}/delete`, {});
        await refreshSummary();
      },
      `Deleted template ${template.name}.`,
    );
  }

  function setVmSidepanelCollapsed(vmId: string, collapsed: boolean): void {
    setSidepanelCollapsedByVm((current) => {
      if (collapsed) {
        if (current[vmId]) {
          return current;
        }

        return {
          ...current,
          [vmId]: true,
        };
      }

      if (!current[vmId]) {
        return current;
      }

      const next = { ...current };
      delete next[vmId];
      return next;
    });
  }

  function setCurrentSidepanelCollapsed(collapsed: boolean): void {
    const activeVmId = selectedVmIdRef.current;

    if (activeVmId) {
      setVmSidepanelCollapsed(activeVmId, collapsed);
      return;
    }

    setOverviewSidepanelCollapsed(collapsed);
  }

  function setVmDesktopResolutionPreference(
    vmId: string,
    preference: DesktopResolutionPreference,
  ): void {
    const normalized = normalizeDesktopResolutionPreference(preference);

    setDesktopResolutionByVm((current) => {
      const existing = current[vmId];

      if (
        existing &&
        existing.mode === normalized.mode &&
        existing.scale === normalized.scale &&
        existing.width === normalized.width &&
        existing.height === normalized.height
      ) {
        return current;
      }

      return {
        ...current,
        [vmId]: normalized,
      };
    });
  }

  function applyViewportScalePreference(vmId: string, scaleValue: number): void {
    const requestedScale = Number.isFinite(scaleValue)
      ? scaleValue
      : appliedDesktopViewportScale;
    const nextScale = clampDesktopViewportScale(requestedScale);

    setVmDesktopResolutionPreference(vmId, {
      mode: "viewport",
      scale: nextScale,
      width: appliedDesktopWidth,
      height: appliedDesktopHeight,
    });
    setResolutionDraft((current) => ({
      ...current,
      mode: "viewport",
      scale: formatViewportScale(nextScale),
    }));
    lastResolutionRequestKeyRef.current = null;
  }

  function applyResolutionMode(vmId: string, mode: DesktopResolutionMode): void {
    if (mode === "viewport") {
      applyViewportScalePreference(vmId, Number(resolutionDraft.scale));
      return;
    }

    const requestedWidth = Number(resolutionDraft.width);
    const requestedHeight = Number(resolutionDraft.height);
    const nextWidth = Number.isFinite(requestedWidth)
      ? clampDesktopFixedWidth(requestedWidth)
      : appliedDesktopWidth;
    const nextHeight = Number.isFinite(requestedHeight)
      ? clampDesktopFixedHeight(requestedHeight)
      : appliedDesktopHeight;
    const normalizedFixedResolution = normalizeGuestDisplayResolution(
      nextWidth,
      nextHeight,
    );

    setVmDesktopResolutionPreference(vmId, {
      mode: "fixed",
      scale: appliedDesktopViewportScale,
      width: normalizedFixedResolution.width,
      height: normalizedFixedResolution.height,
    });
    setResolutionDraft(
      buildResolutionDraft(
        "fixed",
        appliedDesktopViewportScale,
        normalizedFixedResolution.width,
        normalizedFixedResolution.height,
      ),
    );
    lastResolutionRequestKeyRef.current = null;
  }

  function selectVm(vmId: string): void {
    setSelectedVmId(vmId);
    setOpenVmMenuId(null);
    setOpenTemplateMenuId(null);
    setShellMenuOpen(false);
  }

  function openHomepage(): void {
    setSelectedVmId(null);
    setOpenVmMenuId(null);
    setOpenTemplateMenuId(null);
    setShellMenuOpen(false);
  }

  async function toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (error) {
      setNotice({
        tone: "error",
        message: errorMessage(error),
      });
    }
  }

  function inspectVm(vmId: string): void {
    setSelectedVmId(vmId);
    setVmSidepanelCollapsed(vmId, false);
    setOpenVmMenuId(null);
    setOpenTemplateMenuId(null);
    setShellMenuOpen(false);
  }

  function currentVmRailIds(): string[] {
    return (summary?.vms ?? displayedVms).map((vm) => vm.id);
  }

  async function persistVmRailOrder(vmIds: string[]): Promise<void> {
    setVmReorderBusy(true);

    try {
      const nextSummary = await postJson<DashboardSummary>(
        "/api/vms/reorder",
        {
          vmIds,
        } satisfies ReorderVmsInput,
      );
      startTransition(() => {
        setSummary(nextSummary);
      });
      setVmRailOrderIds(null);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        requireLogin();
        return;
      }

      setNotice({
        tone: "error",
        message: errorMessage(error),
      });
      setVmRailOrderIds(null);
      await refreshSummary();
    } finally {
      setVmReorderBusy(false);
    }
  }

  function handleVmTileDragStart(
    vmId: string,
    event: ReactDragEvent<HTMLElement>,
  ): void {
    if (vmReorderBusy) {
      event.preventDefault();
      return;
    }

    vmDragDropCommittedRef.current = false;
    setDraggedVmId(vmId);
    setVmRailOrderIds(currentVmRailIds());
    setOpenVmMenuId(null);
    setOpenTemplateMenuId(null);
    setShellMenuOpen(false);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", vmId);
  }

  function handleVmTileDragOver(
    targetVmId: string,
    event: ReactDragEvent<HTMLElement>,
  ): void {
    if (!draggedVmId || draggedVmId === targetVmId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setVmRailOrderIds((current) =>
      reorderVmIds(current ?? currentVmRailIds(), draggedVmId, targetVmId),
    );
  }

  function commitVmRailOrder(nextOrder: string[]): void {
    vmDragDropCommittedRef.current = true;
    setDraggedVmId(null);

    if (sameIdOrder(nextOrder, currentVmRailIds())) {
      setVmRailOrderIds(null);
      return;
    }

    setVmRailOrderIds(nextOrder);
    void persistVmRailOrder(nextOrder);
  }

  function handleVmStripDragOver(event: ReactDragEvent<HTMLDivElement>): void {
    if (!draggedVmId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function handleVmStripDrop(event: ReactDragEvent<HTMLDivElement>): void {
    if (!draggedVmId) {
      return;
    }

    event.preventDefault();
    commitVmRailOrder(vmRailOrderIds ?? currentVmRailIds());
  }

  function handleVmTileDragEnd(): void {
    if (!vmDragDropCommittedRef.current) {
      setVmRailOrderIds(null);
    }

    setDraggedVmId(null);
  }

  function handleVmTileDrop(
    targetVmId: string,
    event: ReactDragEvent<HTMLElement>,
  ): void {
    if (!draggedVmId) {
      return;
    }

    event.preventDefault();
    const nextOrder = reorderVmIds(vmRailOrderIds ?? currentVmRailIds(), draggedVmId, targetVmId);
    event.stopPropagation();
    commitVmRailOrder(nextOrder);
  }

  function handleRailResizeStart(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!wideShellLayout || event.button !== 0) {
      return;
    }

    const panelLeft = railRef.current?.getBoundingClientRect().left;

    if (panelLeft === undefined) {
      return;
    }

    event.preventDefault();
    railResizeRef.current = { panelLeft };
    setRailResizeActive(true);
  }

  function handleRailResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (!wideShellLayout) {
      return;
    }

    const currentWidth = railWidth;
    let nextWidth: number | null = null;

    switch (event.key) {
      case "ArrowLeft":
        nextWidth =
          currentWidth <= railExpandedMinWidth ? railCompactWidth : currentWidth - 16;
        break;
      case "ArrowRight":
        nextWidth =
          currentWidth <= railCompactWidth ? railExpandedMinWidth : currentWidth + 16;
        break;
      case "Home":
        nextWidth = railCompactWidth;
        break;
      case "End":
        nextWidth = railMaxWidth;
        break;
      default:
        return;
    }

    event.preventDefault();
    setRailWidthPreference(clampRailWidthPreference(nextWidth));
  }

  function handleSidepanelResizeStart(event: ReactPointerEvent<HTMLDivElement>): void {
    if (compactSidepanelLayout || event.button !== 0) {
      return;
    }

    const handleBounds = event.currentTarget.getBoundingClientRect();
    const handleCenterX = handleBounds.left + handleBounds.width / 2;

    event.preventDefault();
    sidepanelResizeRef.current = {
      anchorClientX:
        displayedSidepanelWidth <= sidepanelClosedWidth ? handleCenterX : event.clientX,
      anchorWidth: displayedSidepanelWidth,
      pendingClosedOpen: displayedSidepanelWidth <= sidepanelClosedWidth,
    };
    setSidepanelResizeActive(true);
  }

  function handleSidepanelClosedResizeStart(
    pointerClientX: number,
    handleCenterX: number,
  ): void {
    if (compactSidepanelLayout) {
      return;
    }

    const openingWidth = handleCenterX - pointerClientX;

    if (openingWidth >= sidepanelMinWidth) {
      const activatedWidth = clampDisplayedSidepanelWidth(openingWidth, viewportWidth);
      sidepanelResizeRef.current = {
        anchorClientX: pointerClientX,
        anchorWidth: activatedWidth,
        pendingClosedOpen: false,
      };
      setCurrentSidepanelCollapsed(false);
      setSidepanelWidthPreference(activatedWidth);
      setSidepanelResizeActive(true);
      return;
    }

    sidepanelResizeRef.current = {
      anchorClientX: handleCenterX,
      anchorWidth: sidepanelClosedWidth,
      pendingClosedOpen: true,
    };
    setCurrentSidepanelCollapsed(true);
    setSidepanelResizeActive(true);
  }

  function handleSidepanelResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (compactSidepanelLayout) {
      return;
    }

    const currentWidth = displayedSidepanelWidth;
    let nextWidth: number | null = null;

    switch (event.key) {
      case "ArrowLeft":
        nextWidth =
          currentWidth <= sidepanelClosedWidth ? sidepanelMinWidth : currentWidth + 24;
        break;
      case "ArrowRight":
        nextWidth =
          currentWidth <= sidepanelMinWidth ? sidepanelClosedWidth : currentWidth - 24;
        break;
      case "Home":
        nextWidth = sidepanelClosedWidth;
        break;
      case "End":
        nextWidth = sidepanelMaxWidth;
        break;
      default:
        break;
    }

    if (nextWidth === null) {
      return;
    }

    event.preventDefault();
    const normalizedWidth = clampSidepanelWidthPreference(nextWidth);
    setCurrentSidepanelCollapsed(normalizedWidth === sidepanelClosedWidth);

    if (normalizedWidth > sidepanelClosedWidth) {
      setSidepanelWidthPreference(normalizedWidth);
    }
  }

  async function handleVmAction(
    vmId: string,
    action: VmPowerAction,
  ): Promise<void> {
    const vmName = summary?.vms.find((vm) => vm.id === vmId)?.name ?? vmId;

    await runMutation(
      `${action} ${vmName}`,
      async () => {
        await postJson(`/api/vms/${vmId}/${action}`, {});
        await refreshSummary();
        if (selectedVmIdRef.current === vmId) {
          await refreshDetail(vmId);
        }
      },
      `Queued ${action} for ${vmName}.`,
    );
  }

  async function handleClone(vm: VmInstance): Promise<void> {
    setOpenVmMenuId(null);
    setOpenTemplateMenuId(null);
    setShellMenuOpen(false);
    setCloneVmDialog({
      sourceVmId: vm.id,
      sourceVmName: vm.name,
    });
    setCloneVmDraft(`${vm.name}-clone`);
  }

  async function handleCloneVmSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!cloneVmDialog) {
      return;
    }

    const name = cloneVmDraft.trim();

    if (!name) {
      return;
    }

    await runMutation(
      `Cloning ${cloneVmDialog.sourceVmName}`,
      async () => {
        const clone = await postJson<VmInstance>(`/api/vms/${cloneVmDialog.sourceVmId}/clone`, {
          sourceVmId: cloneVmDialog.sourceVmId,
          name,
        });
        closeCloneVmDialog();
        setVmSidepanelCollapsed(clone.id, false);
        setSelectedVmId(clone.id);
        await refreshSummary();
        await refreshDetail(clone.id);
      },
      `Queued clone for ${cloneVmDialog.sourceVmName}.`,
    );
  }

  async function handleSnapshot(vm: VmInstance): Promise<void> {
    const label = window.prompt(
      vm.status === "running"
        ? `Snapshot label\n\n${liveCaptureWarningCopy}`
        : "Snapshot label",
      `snapshot-${new Date().toISOString().slice(0, 16)}`,
    );

    if (label === null) {
      return;
    }

    const payload: SnapshotInput = {
      label: label.trim() || undefined,
    };

    await runMutation(
      `Snapshotting ${vm.name}`,
      async () => {
        await postJson(`/api/vms/${vm.id}/snapshot`, payload);
        await refreshSummary();
        await refreshDetail(vm.id);
      },
      `Queued snapshot for ${vm.name}.`,
    );
  }

  async function handleDelete(vm: VmInstance): Promise<void> {
    if (!window.confirm(`Delete ${vm.name}?`)) {
      return;
    }

    await runMutation(
      `Deleting ${vm.name}`,
      async () => {
        await postJson(`/api/vms/${vm.id}/delete`, {});
        if (selectedVmIdRef.current === vm.id) {
          setSelectedVmId(null);
          setDetail(null);
        }
        await refreshSummary();
      },
      `Queued delete for ${vm.name}.`,
    );
  }

  function canDriveResolutionForVm(vmId: string): boolean {
    return (
      resolutionControlStatusRef.current.owner === "self" &&
      resolutionControlStatusRef.current.vmId === vmId
    );
  }

  function setResolutionControlState(next: ResolutionControlStatus): void {
    setResolutionControlStatus((current) =>
      current.vmId === next.vmId &&
      current.owner === next.owner &&
      current.source === next.source &&
      current.controllerClientId === next.controllerClientId
        ? current
        : next,
    );
  }

  function suspendResolutionControl(): void {
    clearResolutionRetryTimer();
    lastResolutionRequestKeyRef.current = null;
    resolutionRequestQueueRef.current = emptyResolutionRequestQueue;
    resolutionRetryStateRef.current = null;
    setPendingManualResolutionSync(null);
  }

  function applyLocalResolutionControl(vmId: string, force = false): void {
    const localOwner = claimResolutionControlLease(vmId, tabIdRef.current, force);

    setResolutionControlState({
      controllerClientId: clientIdRef.current,
      owner: localOwner,
      source: localOwner === "other" ? "local" : "none",
      vmId,
    });

    if (localOwner !== "self") {
      suspendResolutionControl();
    }
  }

  function applyResolutionControlSnapshot(
    snapshot: VmResolutionControlSnapshot,
    forceLocal = false,
  ): void {
    const controllerClientId = snapshot.controller?.clientId ?? null;

    if (controllerClientId !== clientIdRef.current) {
      releaseResolutionControlLease(snapshot.vmId, tabIdRef.current);
      setResolutionControlState({
        controllerClientId,
        owner: controllerClientId ? "other" : "none",
        source: controllerClientId ? "remote" : "none",
        vmId: snapshot.vmId,
      });
      suspendResolutionControl();
      return;
    }

    applyLocalResolutionControl(snapshot.vmId, forceLocal);
  }

  function clearResolutionRetryTimer(): void {
    if (resolutionRetryTimerRef.current !== null) {
      window.clearTimeout(resolutionRetryTimerRef.current);
      resolutionRetryTimerRef.current = null;
    }
  }

  function scheduleResolutionRetry(request: ResolutionRequest): void {
    if (!canDriveResolutionForVm(request.vmId)) {
      return;
    }

    const currentTarget = currentResolutionTargetRef.current;

    if (!currentTarget || currentTarget.key !== request.key) {
      return;
    }

    if (currentRemoteResolutionKeyRef.current === request.key) {
      return;
    }

    const attempts =
      resolutionRetryStateRef.current?.key === request.key
        ? resolutionRetryStateRef.current.attempts
        : 0;

    if (attempts >= desktopResolutionRetryMaxAttempts) {
      return;
    }

    clearResolutionRetryTimer();
    resolutionRetryStateRef.current = {
      attempts: attempts + 1,
      key: request.key,
    };
    resolutionRetryTimerRef.current = window.setTimeout(() => {
      resolutionRetryTimerRef.current = null;

      if (currentResolutionTargetRef.current?.key !== request.key) {
        return;
      }

      if (currentRemoteResolutionKeyRef.current === request.key) {
        return;
      }

      lastResolutionRequestKeyRef.current = null;
      syncVmResolution(request.vmId, request.width, request.height, request.silent);
    }, desktopResolutionRetryDelayMs);
  }

  function startResolutionRequest(request: ResolutionRequest): void {
    void (async () => {
      if (!canDriveResolutionForVm(request.vmId)) {
        resolutionRequestQueueRef.current = emptyResolutionRequestQueue;
        return;
      }

      try {
        await postJson(`/api/vms/${request.vmId}/resolution`, {
          height: request.height,
          width: request.width,
        } satisfies SetVmResolutionInput);
      } catch (error) {
        if (
          resolutionRequestQueueRef.current.inFlight?.requestId !== request.requestId ||
          request.silent
        ) {
          return;
        }

        setNotice({
          tone: "error",
          message: errorMessage(error),
        });
      } finally {
        if (!canDriveResolutionForVm(request.vmId)) {
          resolutionRequestQueueRef.current = emptyResolutionRequestQueue;
          return;
        }

        const { nextQueue, requestToStart } = resolveResolutionRequest(
          resolutionRequestQueueRef.current,
          request.requestId,
        );
        resolutionRequestQueueRef.current = nextQueue;

        if (requestToStart) {
          void startResolutionRequest(requestToStart);
          return;
        }

        scheduleResolutionRetry(request);
      }
    })();
  }

  function syncVmResolution(
    vmId: string,
    width: number,
    height: number,
    silent: boolean,
  ): void {
    if (!canDriveResolutionForVm(vmId)) {
      return;
    }

    clearResolutionRetryTimer();

    const payload = normalizeGuestDisplayResolution(width, height);
    const requestKey = buildDesktopResolutionRequestKey(
      vmId,
      payload.width,
      payload.height,
    );

    if (
      lastResolutionRequestKeyRef.current === requestKey &&
      resolutionRequestQueueRef.current.inFlight === null &&
      resolutionRequestQueueRef.current.queued === null
    ) {
      return;
    }

    const requestId = resolutionRequestSequenceRef.current + 1;
    resolutionRequestSequenceRef.current = requestId;
    const request: ResolutionRequest = {
      height: payload.height,
      key: requestKey,
      requestId,
      silent,
      vmId,
      width: payload.width,
    };
    const { nextQueue, requestToStart } = enqueueResolutionRequest(
      resolutionRequestQueueRef.current,
      request,
    );
    resolutionRequestQueueRef.current = nextQueue;

    if (!requestToStart && nextQueue.queued?.key !== requestKey) {
      return;
    }

    lastResolutionRequestKeyRef.current = requestKey;

    if (requestToStart) {
      void startResolutionRequest(requestToStart);
    }
  }

  function queueManualResolutionSync(vmId: string): void {
    if (!canDriveResolutionForVm(vmId)) {
      return;
    }

    clearResolutionRetryTimer();
    resolutionRetryStateRef.current = null;
    setPendingManualResolutionSync((current) => ({
      token: (current?.token ?? 0) + 1,
      vmId,
    }));
  }

  async function handleTakeOverResolutionControl(vm: VmInstance): Promise<void> {
    setResolutionControlTakeoverBusy(true);

    try {
      const snapshot = await postJson<
        VmResolutionControlSnapshot,
        SyncVmResolutionControlInput
      >(`/api/vms/${vm.id}/resolution-control/claim`, {
        clientId: clientIdRef.current,
        force: true,
      });

      applyResolutionControlSnapshot(snapshot, true);
      queueManualResolutionSync(vm.id);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        requireLogin();
        return;
      }

      setNotice({
        tone: "error",
        message: errorMessage(error),
      });
    } finally {
      setResolutionControlTakeoverBusy(false);
    }
  }

  async function handleResize(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!detail) {
      return;
    }

    const payload: ResizeVmInput = {
      resources: {
        cpu: Number(resourceDraft.cpu),
        ramMb: parseRamDraftValue(resourceDraft.ramGb),
        diskGb: Number(resourceDraft.diskGb),
      },
    };

    await runMutation(
      `Resizing ${detail.vm.name}`,
      async () => {
        await postJson(`/api/vms/${detail.vm.id}/resize`, payload);
        await refreshSummary();
        await refreshDetail(detail.vm.id);
      },
      `Queued resize for ${detail.vm.name}.`,
    );
  }

  async function handleApplyResolution(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!selectedVmId) {
      return;
    }

    if (resolutionDraft.mode === "viewport") {
      const requestedScale = Number(resolutionDraft.scale);

      if (!Number.isFinite(requestedScale)) {
        setNotice({
          tone: "error",
          message: "Viewport scale must be numeric.",
        });
        return;
      }

      const nextScale = clampDesktopViewportScale(requestedScale);
      setVmDesktopResolutionPreference(selectedVmId, {
        mode: "viewport",
        scale: nextScale,
        width: appliedDesktopWidth,
        height: appliedDesktopHeight,
      });
      setResolutionDraft((current) => ({
        ...current,
        mode: "viewport",
        scale: formatViewportScale(nextScale),
      }));

      lastResolutionRequestKeyRef.current = null;
      if (liveResolutionVmId) {
        queueManualResolutionSync(liveResolutionVmId);
      }

      return;
    }

    const requestedWidth = Number(resolutionDraft.width);
    const requestedHeight = Number(resolutionDraft.height);

    if (!Number.isFinite(requestedWidth) || !Number.isFinite(requestedHeight)) {
      setNotice({
        tone: "error",
        message: "Fixed resolution must use numeric width and height.",
      });
      return;
    }

    const nextWidth = clampDesktopFixedWidth(requestedWidth);
    const nextHeight = clampDesktopFixedHeight(requestedHeight);
    const normalizedFixedResolution = normalizeGuestDisplayResolution(nextWidth, nextHeight);

    setVmDesktopResolutionPreference(selectedVmId, {
      mode: "fixed",
      scale: appliedDesktopViewportScale,
      width: normalizedFixedResolution.width,
      height: normalizedFixedResolution.height,
    });
    setResolutionDraft(
      buildResolutionDraft(
        "fixed",
        appliedDesktopViewportScale,
        normalizedFixedResolution.width,
        normalizedFixedResolution.height,
      ),
    );
    lastResolutionRequestKeyRef.current = null;

    if (liveResolutionVmId) {
      queueManualResolutionSync(liveResolutionVmId);
    }
  }

  async function handleCommand(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!detail || !commandDraft.trim()) {
      return;
    }

    const payload: InjectCommandInput = {
      command: commandDraft.trim(),
    };

    await runMutation(
      `Running command on ${detail.vm.name}`,
      async () => {
        await postJson(`/api/vms/${detail.vm.id}/input`, payload);
        setCommandDraft("");
        await refreshSummary();
        await refreshDetail(detail.vm.id);
      },
      `Queued command for ${detail.vm.name}.`,
    );
  }

  async function handleLaunchFromSnapshot(
    vm: VmInstance,
    snapshot: Snapshot,
  ): Promise<void> {
    const name = window.prompt(
      "VM name",
      defaultSnapshotLaunchName(vm, snapshot),
    )?.trim();

    if (!name) {
      return;
    }

    const payload: SnapshotLaunchInput = {
      name,
    };

    await runMutation(
      `Launching ${name} from ${snapshot.label}`,
      async () => {
        const createdVm = await postJson<VmInstance>(
          `/api/vms/${vm.id}/snapshots/${snapshot.id}/launch`,
          payload,
        );
        setVmSidepanelCollapsed(createdVm.id, false);
        setSelectedVmId(createdVm.id);
        await refreshSummary();
        await refreshDetail(createdVm.id);
      },
      `Queued ${name} from ${snapshot.label}.`,
    );
  }

  async function handleRestoreSnapshot(
    vm: VmInstance,
    snapshot: Snapshot,
  ): Promise<void> {
    const confirmed = window.confirm(
      `Reset ${vm.name} to snapshot "${snapshot.label}"?${vm.status === "running" ? " The VM will restart." : ""}`,
    );

    if (!confirmed) {
      return;
    }

    await runMutation(
      `Restoring ${vm.name} to ${snapshot.label}`,
      async () => {
        await postJson(`/api/vms/${vm.id}/snapshots/${snapshot.id}/restore`, {});
        await refreshSummary();
        await refreshDetail(vm.id);
      },
      `Queued restore to ${snapshot.label}.`,
    );
  }

  async function handleCaptureTemplate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!detail) {
      return;
    }

    const payload: CaptureTemplateInput = {
      templateId:
        captureDraft.mode === "existing" && captureDraft.templateId
          ? captureDraft.templateId
          : undefined,
      name: captureDraft.name.trim(),
      description: captureDraft.description.trim(),
    };

    await runMutation(
      `Capturing template from ${detail.vm.name}`,
      async () => {
        await postJson(`/api/vms/${detail.vm.id}/template`, payload);
        await refreshSummary();
        await refreshDetail(detail.vm.id);
      },
      captureDraft.mode === "existing"
        ? `Queued template refresh for ${captureDraft.name.trim()}.`
        : `Queued new template capture for ${captureDraft.name.trim()}.`,
    );
  }

  async function handleSaveForwards(nextForwards: TemplatePortForward[]): Promise<void> {
    if (!detail) {
      return;
    }

    await runMutation(
      `Updating forwards on ${detail.vm.name}`,
      async () => {
        await postJson(`/api/vms/${detail.vm.id}/forwards`, {
          forwardedPorts: nextForwards,
        });
        setForwardDraft(emptyForwardDraft);
        await refreshSummary();
        await refreshDetail(detail.vm.id);
      },
      nextForwards.length > 0
        ? `Saved ${nextForwards.length} forwarded service ports.`
        : "Removed forwarded service ports.",
    );
  }

  async function handleSetNetworkMode(networkMode: VmNetworkMode): Promise<void> {
    if (!detail) {
      return;
    }

    const currentNetworkMode = detail.vm.networkMode ?? "default";

    if (currentNetworkMode === networkMode) {
      return;
    }

    const payload = {
      networkMode,
    } satisfies UpdateVmNetworkInput;

    await runMutation(
      `${networkMode === "dmz" ? "Enabling DMZ on" : "Restoring default networking for"} ${detail.vm.name}`,
      async () => {
        await postJson(`/api/vms/${detail.vm.id}/network`, payload);
        await refreshSummary();
        await refreshDetail(detail.vm.id);
      },
      networkMode === "dmz"
        ? `${detail.vm.name} is now using the DMZ profile.`
        : `${detail.vm.name} is back on the default bridge.`,
    );
  }

  async function handleAddForward(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!detail) {
      return;
    }

    const nextForward: TemplatePortForward = {
      name: forwardDraft.name.trim(),
      guestPort: Number(forwardDraft.guestPort),
      protocol: "http",
      description: forwardDraft.description.trim(),
    };

    const nextForwards = [
      ...detail.vm.forwardedPorts.map(toTemplatePortForward),
      nextForward,
    ];

    await handleSaveForwards(nextForwards);
  }

  async function handleRemoveForward(forwardId: string): Promise<void> {
    if (!detail) {
      return;
    }

    const nextForwards = detail.vm.forwardedPorts
      .filter((entry) => entry.id !== forwardId)
      .map(toTemplatePortForward);

    await handleSaveForwards(nextForwards);
  }

  if (!summary) {
    if (authState === "required") {
      return (
        <LoginShell
          busy={loginBusy}
          error={loginError}
          loginDraft={loginDraft}
          onFieldChange={(field, value) =>
            setLoginDraft((current) => ({
              ...current,
              [field]: value,
            }))
          }
          onSubmit={async (event) => {
            event.preventDefault();
            setLoginBusy(true);
            setLoginError(null);

            try {
              const status = await postJson<AuthStatus>("/api/auth/login", loginDraft);
              setAuthEnabled(status.authEnabled);
              setAuthState("ready");
              setLoginDraft((current) => ({
                ...current,
                password: "",
              }));
              await refreshSummary();
            } catch (error) {
              setLoginError(errorMessage(error));
            } finally {
              setLoginBusy(false);
            }
          }}
        />
      );
    }

    return <LoadingShell showContent={showInitialLoadingShell} />;
  }

  const workspaceFocused = selectedVm !== null;
  const prominentJob = findProminentJob(summary, selectedVmId);
  const visibleProminentJob =
    prominentJob && dismissedProminentJobIds[prominentJob.job.id] !== true
      ? prominentJob
      : null;
  const visibleProminentJobTiming = visibleProminentJob
    ? formatActiveJobTiming(visibleProminentJob.job, jobTimingNowMs)
    : null;

  return (
    <>
      <main
        className="app-shell"
        onClick={() => {
          setOpenVmMenuId(null);
          setOpenTemplateMenuId(null);
          setShellMenuOpen(false);
        }}
      >
        {notice || busyLabel || visibleProminentJob ? (
          <div
            className="app-shell__notice-stack"
            onClick={(event) => event.stopPropagation()}
          >
            {notice || busyLabel ? (
              <div
                className={joinClassNames(
                  "notice-bar",
                  notice ? noticeToneClassName(notice.tone) : "notice-bar--info",
                )}
              >
                <span>{notice?.message ?? "Working..."}</span>
                {busyLabel ? (
                  <span className="surface-pill surface-pill--busy mono-font">{busyLabel}</span>
                ) : null}
              </div>
            ) : null}

            {visibleProminentJob ? (
              <div className="notice-bar notice-bar--info">
                <div className="notice-bar__copy">
                  <strong className="notice-bar__title">
                    {visibleProminentJob.vmName} · {formatJobKindLabel(visibleProminentJob.job.kind)}
                  </strong>
                  <span>{visibleProminentJob.job.message || "Action in progress"}</span>
                  {visibleProminentJobTiming ? (
                    <span className="notice-bar__meta">{visibleProminentJobTiming}</span>
                  ) : null}
                </div>

                <div className="notice-bar__actions">
                  <div className="chip-row">
                    <span className="surface-pill">{visibleProminentJob.job.status}</span>
                    {visibleProminentJob.job.progressPercent !== null &&
                    visibleProminentJob.job.progressPercent !== undefined ? (
                      <span className="surface-pill">{visibleProminentJob.job.progressPercent}%</span>
                    ) : null}
                    {visibleProminentJob.activeCount > 1 ? (
                      <span className="surface-pill">
                        {visibleProminentJob.activeCount} active
                      </span>
                    ) : null}
                  </div>
                  <button
                    className="button button--ghost notice-bar__dismiss"
                    type="button"
                    onClick={() =>
                      setDismissedProminentJobIds((current) =>
                        current[visibleProminentJob.job.id]
                          ? current
                          : {
                              ...current,
                              [visibleProminentJob.job.id]: true,
                            },
                      )
                    }
                  >
                    Hide
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <section
          style={workspaceShellStyle}
          className="workspace-shell"
          data-focused={workspaceFocused ? "true" : "false"}
          onClick={(event) => event.stopPropagation()}
        >
          <aside
            ref={railRef}
            className={joinClassNames(
              "workspace-rail",
              compactRail ? "workspace-rail--compact" : "",
              railResizeActive ? "workspace-rail--resizing" : "",
            )}
          >
            <RailResizeHandle
              resizable={wideShellLayout}
              resizing={railResizeActive}
              width={railWidth}
              onResizeKeyDown={handleRailResizeKeyDown}
              onResizePointerDown={handleRailResizeStart}
            />

            <div className="workspace-rail__header">
              <div className="workspace-rail__brand">
                {compactRail ? (
                  <div className="workspace-rail__compact-actions">
                    <button
                      className="workspace-rail__icon-button"
                      type="button"
                      aria-label="Home"
                      title={`Home · ${providerStatusTitle(summary.provider)}`}
                      onClick={openHomepage}
                    >
                      <span className="workspace-rail__icon-shell">
                        <RailHomeIcon />
                        <span
                          className={joinClassNames(
                            "workspace-rail__status-dot",
                            "workspace-rail__status-dot--compact",
                            providerStatusDotClassName(summary.provider),
                          )}
                          aria-hidden="true"
                        />
                      </span>
                    </button>
                    <button
                      className="workspace-rail__icon-button"
                      type="button"
                      aria-label="New VM"
                      title="New VM"
                      onClick={openCreateDialog}
                    >
                      <RailCreateIcon />
                    </button>
                    <button
                      ref={shellMenuButtonRef}
                      className={joinClassNames(
                        "workspace-rail__icon-button",
                        "workspace-rail__menu-button",
                        shellMenuOpen ? "workspace-rail__icon-button--open" : "",
                      )}
                      type="button"
                      aria-expanded={shellMenuOpen}
                      aria-label="Display and theme options"
                      title="Display and theme options"
                      onClick={() => {
                        setOpenVmMenuId(null);
                        setOpenTemplateMenuId(null);
                        setShellMenuOpen((current) => !current);
                      }}
                    >
                      <RailSettingsIcon />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="workspace-rail__topbar">
                      <div className="workspace-rail__home-link-group">
                        <button
                          className="workspace-shell__eyebrow workspace-rail__home-link"
                          type="button"
                          title={providerStatusTitle(summary.provider)}
                          onClick={openHomepage}
                        >
                          <span
                            className={joinClassNames(
                              "workspace-rail__status-dot",
                              providerStatusDotClassName(summary.provider),
                            )}
                            aria-hidden="true"
                          />
                          <span className="brand-wordmark" aria-label="Parallaize">
                            <span>Parall</span>
                            <span className="brand-wordmark__accent">ai</span>
                            <span>ze</span>
                          </span>
                        </button>
                        <span
                          className="workspace-rail__brand-lockup"
                          aria-label={`Version ${appVersionLabel}`}
                        >
                          <span className="workspace-rail__brand-version">{appVersionLabel}</span>
                          {newerReleaseAvailable && latestRelease ? (
                            <a
                              className={`workspace-rail__brand-release-indicator${releaseIndicatorSeverity ? ` workspace-rail__brand-release-indicator--${releaseIndicatorSeverity}` : ""}`}
                              href={buildLatestReleaseTagUrl(latestRelease.version)}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label="New version available!"
                              title="New version available!"
                            >
                              !
                            </a>
                          ) : null}
                        </span>
                      </div>
                      <button
                        ref={shellMenuButtonRef}
                        className={joinClassNames(
                          "menu-button",
                          "workspace-rail__menu-button",
                          shellMenuOpen ? "menu-button--open" : "",
                        )}
                        type="button"
                        aria-expanded={shellMenuOpen}
                        aria-label="Display and theme options"
                        onClick={() => {
                          setOpenVmMenuId(null);
                          setOpenTemplateMenuId(null);
                          setShellMenuOpen((current) => !current);
                        }}
                      >
                        ...
                      </button>
                    </div>

                    <div className="chip-row workspace-rail__chips">
                      <span className="surface-pill">
                        {summary.metrics.totalCpu}/{summary.metrics.hostCpuCount} CPU
                      </span>
                      <span className="surface-pill">
                        {formatRamUsage(summary.metrics.totalRamMb, summary.metrics.hostRamMb)}
                      </span>
                    </div>

                    <TelemetryPanel
                      activeCpuThresholdPercent={activeCpuThresholdDefault}
                      label="Host"
                      telemetry={summary.hostTelemetry}
                    />
                  </>
                )}
              </div>
            </div>

            <PortalPopover
              anchorPlacement={compactRail ? "bottom-start" : "bottom-end"}
              anchorRef={shellMenuButtonRef}
              className="workspace-rail__popover"
              open={shellMenuOpen}
              onClose={() => setShellMenuOpen(false)}
            >
              {supportsLiveDesktop ? (
                <button
                  className={joinClassNames(
                    "menu-action",
                    "menu-action--split",
                    showLivePreviews ? "menu-action--selected" : "",
                  )}
                  type="button"
                  onClick={() => {
                    setShowLivePreviews((current) => !current);
                    setShellMenuOpen(false);
                  }}
                >
                  <span>Live previews</span>
                  <span className="menu-action__state">{showLivePreviews ? "On" : "Off"}</span>
                </button>
              ) : (
                <button className="menu-action menu-action--split" type="button" disabled>
                  <span>Live previews</span>
                  <span className="menu-action__state">Unavailable</span>
                </button>
              )}

              <button
                className="menu-action menu-action--split"
                type="button"
                onClick={() => {
                  setThemeMode((current) => (current === "dark" ? "light" : "dark"));
                  setShellMenuOpen(false);
                }}
              >
                <span>Theme</span>
                <span className="menu-action__state">
                  {themeMode === "dark" ? "Dark" : "Light"}
                </span>
              </button>

              <button
                className="menu-action menu-action--split"
                type="button"
                onClick={() => {
                  setShellMenuOpen(false);
                  void toggleFullscreen();
                }}
              >
                <span>Fullscreen</span>
                <span className="menu-action__state">{fullscreenActive ? "On" : "Off"}</span>
              </button>

              {authEnabled ? (
                <button
                  className="menu-action"
                  type="button"
                  onClick={() => {
                    setShellMenuOpen(false);
                    void handleLogout();
                  }}
                >
                  Log out
                </button>
              ) : null}
            </PortalPopover>

            {!compactRail ? (
              <div className="workspace-rail__list-head">
                <p className="workspace-shell__eyebrow">
                  VMs ({summary.metrics.runningVmCount}/{summary.metrics.totalVmCount})
                </p>
                <button
                  className="button button--secondary workspace-rail__create-button"
                  type="button"
                  onClick={openCreateDialog}
                >
                  New VM
                </button>
              </div>
            ) : null}

            <div
              className="vm-strip"
              onDragOver={handleVmStripDragOver}
              onDrop={handleVmStripDrop}
            >
              {renderedVms.map((vm) => (
                <VmTile
                  key={vm.id}
                  activeCpuThresholdPercent={activeCpuThresholdForVm(vm.id)}
                  busy={isBusy}
                  compact={compactRail}
                  dragging={draggedVmId === vm.id}
                  inspectorVisible={vm.id === selectedVmId && !effectiveSidePanelCollapsed}
                  menuOpen={openVmMenuId === vm.id}
                  selected={vm.id === selectedVmId}
                  showLivePreview={showLivePreviews}
                  vm={vm}
                  onDragEnd={handleVmTileDragEnd}
                  onDragOver={handleVmTileDragOver}
                  onDragStart={handleVmTileDragStart}
                  onDrop={handleVmTileDrop}
                  onClone={handleClone}
                  onDelete={handleDelete}
                  onHideInspector={() => setVmSidepanelCollapsed(vm.id, true)}
                  onOpen={selectVm}
                  onInspect={inspectVm}
                  onOpenLogs={openVmLogsDialog}
                  onRename={handleRenameVm}
                  onSetActiveCpuThreshold={handleSetActiveCpuThreshold}
                  onSnapshot={handleSnapshot}
                  onPowerAction={handleVmAction}
                  onToggleMenu={(vmId) => {
                    setShellMenuOpen(false);
                    setOpenTemplateMenuId(null);
                    setOpenVmMenuId((current) => (current === vmId ? null : vmId));
                  }}
                />
              ))}

              {renderedVms.length === 0 && !compactRail ? (
                <div className="empty-state">
                  <p className="empty-state__eyebrow">No VMs yet</p>
                  <h3 className="empty-state__title">Launch a workspace to populate the rail.</h3>
                  <p className="empty-state__copy">
                    Each workspace stays selectable here with a preview, so the center stage can
                    remain dedicated to the live desktop.
                  </p>
                </div>
              ) : null}
            </div>
          </aside>

          <section className="workspace-stage">
            <div
              className={joinClassNames(
                "workspace-stage__surface",
                selectedVm ? "" : "workspace-stage__surface--idle",
              )}
            >
              {selectedVm ? (
                !currentDetail ? (
                  <div className="workspace-stage__placeholder">
                    <div className="workspace-stage__placeholder-block skeleton-shell" />
                  </div>
                ) : getVmDesktopBootState(currentDetail, jobTimingNowMs) ? (
                  <WorkspaceBootSurface state={getVmDesktopBootState(currentDetail, jobTimingNowMs)!} />
                ) : hasBrowserDesktopSession(currentDetail.vm.session) ? (
                  <div
                    ref={stageViewportShellRef}
                    className={joinClassNames(
                      "workspace-stage__viewport-shell",
                      desktopResolutionMode === "fixed"
                        ? "workspace-stage__viewport-shell--fixed"
                        : "workspace-stage__viewport-shell--viewport",
                    )}
                  >
                    <div
                      ref={stageViewportFrameRef}
                      className={joinClassNames(
                        "workspace-stage__viewport-frame",
                        desktopResolutionMode === "fixed"
                          ? "workspace-stage__viewport-frame--fixed"
                          : "",
                      )}
                      style={stageViewportFrameStyle}
                    >
                      <NoVncViewport
                        className="workspace-stage__viewport"
                        hideConnectedOverlayStatus
                        onResolutionChange={setDesktopResolution}
                        surfaceClassName="workspace-stage__canvas"
                        viewOnly={blocksLiveResolutionControl}
                        viewportMode={
                          desktopResolutionMode === "viewport" ? "scale" : "fit"
                        }
                        webSocketPath={currentDetail.vm.session!.webSocketPath!}
                        showHeader={false}
                        statusMode="overlay"
                      />
                      {blocksLiveResolutionControl && resolutionControlHeading && resolutionControlMessage ? (
                        <WorkspaceControlLockOverlay
                          disabled={isBusy || resolutionControlTakeoverBusy}
                          message={resolutionControlMessage}
                          takeOverLabel={resolutionControlTakeoverLabel}
                          takeoverBusy={resolutionControlTakeoverBusy}
                          title={resolutionControlHeading}
                          onTakeOver={() => void handleTakeOverResolutionControl(currentDetail.vm)}
                        />
                      ) : null}
                    </div>
                  </div>
                ) : showWorkspaceLogs ? (
                  <WorkspaceLogsSurface
                    detail={currentDetail}
                    logsState={workspaceLogs}
                  />
                ) : (
                  <WorkspaceFallbackSurface detail={currentDetail} />
                )
              ) : (
                <EmptyWorkspaceStage
                  summary={summary}
                  onCreate={openCreateDialog}
                />
              )}

            </div>
          </section>

          {selectedVm ? (
            wideShellLayout || !effectiveSidePanelCollapsed ? (
              <WorkspaceSidepanel
                busy={isBusy}
                captureDraft={captureDraft}
                collapsed={effectiveSidePanelCollapsed}
                commandDraft={commandDraft}
                detail={currentDetail}
                diskUsage={vmDiskUsage}
                diskUsageError={vmDiskUsageError}
                diskUsageLoading={vmDiskUsageLoading}
                fileBrowser={vmFileBrowser}
                fileBrowserError={vmFileBrowserError}
                fileBrowserLoading={vmFileBrowserLoading}
                forwardDraft={forwardDraft}
                resolutionControlBlocked={blocksLiveResolutionControl}
                resolutionControlTakeoverBusy={resolutionControlTakeoverBusy}
                resolutionControlTakeoverLabel={resolutionControlTakeoverLabel}
                resolutionControlMessage={resolutionControlMessage}
                resolutionDraft={resolutionDraft}
                resolutionState={effectiveDesktopResolution}
                resourceDraft={resourceDraft}
                summary={summary}
                touchedFiles={vmTouchedFiles}
                touchedFilesError={vmTouchedFilesError}
                touchedFilesLoading={vmTouchedFilesLoading}
                vm={selectedVm}
                onCaptureDraftChange={setCaptureDraft}
                onBrowsePath={(path) => refreshVmFileBrowserSnapshot(selectedVm.id, path)}
                onClone={handleClone}
                onCommandDraftChange={setCommandDraft}
                onDelete={handleDelete}
                onForwardDraftChange={setForwardDraft}
                onResolutionModeChange={(mode) => applyResolutionMode(selectedVm.id, mode)}
                onResolutionDraftChange={setResolutionDraft}
                onTakeOverResolutionControl={handleTakeOverResolutionControl}
                onViewportScaleChange={(scale) =>
                  applyViewportScalePreference(selectedVm.id, scale)}
                onRefreshTouchedFiles={() => refreshVmTouchedFilesSnapshot(selectedVm.id)}
                onRemoveForward={handleRemoveForward}
                onResourceDraftChange={setResourceDraft}
                onRename={handleRenameVm}
                onSetNetworkMode={handleSetNetworkMode}
                onApplyResolution={handleApplyResolution}
                onResize={handleResize}
                onSaveForward={handleAddForward}
                onLaunchFromSnapshot={handleLaunchFromSnapshot}
                onSnapshot={handleSnapshot}
                onPowerAction={handleVmAction}
                onClosedResizeStart={handleSidepanelClosedResizeStart}
                onSubmitCapture={handleCaptureTemplate}
                onSubmitCommand={handleCommand}
                onRestoreSnapshot={handleRestoreSnapshot}
                onOpenCollapsed={() => setVmSidepanelCollapsed(selectedVm.id, false)}
                onToggleCollapsed={() => setVmSidepanelCollapsed(selectedVm.id, true)}
                panelRef={sidepanelRef}
                resizing={sidepanelResizeActive}
                resizable={!compactSidepanelLayout}
                style={sidepanelStyle}
                width={displayedSidepanelWidth}
                onResizeKeyDown={handleSidepanelResizeKeyDown}
                onResizePointerDown={handleSidepanelResizeStart}
              />
            ) : null
          ) : (
            wideShellLayout || !effectiveSidePanelCollapsed ? (
              <OverviewSidepanel
                busy={isBusy}
                collapsed={effectiveSidePanelCollapsed}
                incusStorage={incusStorage}
                openTemplateMenuId={openTemplateMenuId}
                persistence={persistence}
                summary={summary}
                onCreate={openCreateDialog}
                onCloneTemplate={openTemplateCloneDialog}
                onCreateFromTemplate={openCreateDialogForTemplate}
                onClosedResizeStart={handleSidepanelClosedResizeStart}
                onDeleteTemplate={handleDeleteTemplate}
                onOpenCollapsed={() => setOverviewSidepanelCollapsed(false)}
                onRenameTemplate={handleRenameTemplate}
                onToggleTemplateMenu={(templateId) => {
                  setOpenVmMenuId(null);
                  setShellMenuOpen(false);
                  setOpenTemplateMenuId((current) =>
                    current === templateId ? null : templateId,
                  );
                }}
                onToggleCollapsed={() => setOverviewSidepanelCollapsed(true)}
                panelRef={sidepanelRef}
                resizing={sidepanelResizeActive}
                resizable={!compactSidepanelLayout}
                style={sidepanelStyle}
                width={displayedSidepanelWidth}
                onResizeKeyDown={handleSidepanelResizeKeyDown}
                onResizePointerDown={handleSidepanelResizeStart}
              />
            ) : null
          )}
        </section>
      </main>

      {showCreateDialog ? (
        <CreateVmDialog
          busy={isBusy}
          createDraft={createDraft}
          selectedSource={
            summary
              ? resolveCreateSourceSelection(
                  summary.templates,
                  summary.snapshots,
                  summary.vms,
                  createDraft.launchSource,
                )
              : null
          }
          sourceGroups={
            summary
              ? buildCreateSourceGroups(summary.templates, summary.snapshots, summary.vms)
              : []
          }
          validationError={buildCreateLaunchValidationError(
            summary
              ? resolveCreateSourceSelection(
                  summary.templates,
                  summary.snapshots,
                  summary.vms,
                  createDraft.launchSource,
                )
              : null,
            createDraft.diskGb,
          )}
          onClose={() => setShowCreateDialog(false)}
          onFieldChange={handleCreateField}
          onShutdownBeforeCloneChange={handleCreateShutdownBeforeCloneChange}
          onSubmit={handleCreate}
          onSourceChange={handleCreateSourceChange}
        />
      ) : null}
      {templateCloneDraft ? (
        <TemplateCloneDialog
          busy={isBusy}
          draft={templateCloneDraft}
          sourceTemplate={
            displayedTemplates.find(
              (entry) => entry.id === templateCloneDraft.sourceTemplateId,
            ) ?? null
          }
          onClose={closeTemplateCloneDialog}
          onFieldChange={handleTemplateCloneField}
          onSubmit={handleTemplateCloneSubmit}
        />
      ) : null}
      {templateEditDraft ? (
        <TemplateEditDialog
          busy={isBusy}
          draft={templateEditDraft}
          onClose={closeTemplateEditDialog}
          onFieldChange={handleTemplateEditField}
          onSubmit={handleEditTemplateSubmit}
        />
      ) : null}
      {cloneVmDialog ? (
        <CloneVmDialog
          busy={isBusy}
          draft={cloneVmDraft}
          sourceVmName={cloneVmDialog.sourceVmName}
          onClose={closeCloneVmDialog}
          onDraftChange={setCloneVmDraft}
          onSubmit={handleCloneVmSubmit}
        />
      ) : null}
      {renameDialog ? (
        <RenameDialog
          busy={isBusy}
          currentName={renameDialog.currentName}
          draft={renameDraft}
          entityLabel={renameDialog.kind === "vm" ? "Workspace" : "Template"}
          onClose={closeRenameDialog}
          onDraftChange={setRenameDraft}
          onSubmit={handleRenameSubmit}
        />
      ) : null}
      {vmLogsDialog ? (
        <VmLogsDialog
          error={vmLogsDialog.error}
          loading={vmLogsDialog.loading}
          logs={vmLogsDialog.logs}
          refreshing={vmLogsDialog.refreshing}
          vmName={vmLogsDialog.vmName}
          onClose={closeVmLogsDialog}
          onRefresh={refreshVmLogsDialog}
        />
      ) : null}
    </>
  );
}

interface CreateVmDialogProps {
  busy: boolean;
  createDraft: CreateDraft;
  selectedSource: CreateSourceSelection | null;
  sourceGroups: CreateSourceGroup[];
  validationError: string | null;
  onClose: () => void;
  onFieldChange: (field: keyof CreateDraft, value: string) => void;
  onShutdownBeforeCloneChange: (checked: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSourceChange: (event: ChangeEvent<HTMLSelectElement>) => void;
}

interface TemplateCloneDialogProps {
  busy: boolean;
  draft: TemplateCloneDraft;
  sourceTemplate: EnvironmentTemplate | null;
  onClose: () => void;
  onFieldChange: (field: keyof TemplateCloneDraft, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

interface TemplateEditDialogProps {
  busy: boolean;
  draft: TemplateEditDraft;
  onClose: () => void;
  onFieldChange: (field: keyof TemplateEditDraft, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

interface CloneVmDialogProps {
  busy: boolean;
  draft: string;
  sourceVmName: string;
  onClose: () => void;
  onDraftChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

interface RenameDialogProps {
  busy: boolean;
  currentName: string;
  draft: string;
  entityLabel: string;
  onClose: () => void;
  onDraftChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

interface VmLogsDialogProps {
  error: string | null;
  loading: boolean;
  logs: VmLogsSnapshot | null;
  refreshing: boolean;
  vmName: string;
  onClose: () => void;
  onRefresh: () => void;
}

function VmLogOutput({
  className,
  content,
}: {
  className?: string;
  content: string;
}): JSX.Element {
  const outputRef = useRef<HTMLPreElement | null>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const output = outputRef.current;

    if (!output || !stickToBottomRef.current) {
      return;
    }

    output.scrollTop = output.scrollHeight;
  }, [content]);

  return (
    <pre
      ref={outputRef}
      className={className}
      onScroll={(event) => {
        stickToBottomRef.current = isNearScrollBottom(event.currentTarget);
      }}
    >
      {parseAnsiText(content).map((segment, index) => (
        <span key={index} style={resolveAnsiSegmentStyle(segment)}>
          {segment.text}
        </span>
      ))}
    </pre>
  );
}

function RenameDialog({
  busy,
  currentName,
  draft,
  entityLabel,
  onClose,
  onDraftChange,
  onSubmit,
}: RenameDialogProps): JSX.Element {
  const normalizedDraft = draft.trim();
  const unchanged = normalizedDraft.length === 0 || normalizedDraft === currentName;

  return (
    <div
      className="dialog-backdrop"
      onClick={() => {
        if (!busy) {
          onClose();
        }
      }}
    >
      <section className="dialog-panel" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-panel__header">
          <div>
            <p className="workspace-shell__eyebrow">{entityLabel}</p>
            <h2 className="dialog-panel__title">Rename {entityLabel.toLowerCase()}</h2>
            <p className="dialog-panel__copy">
              This stays inside the dashboard, so browser fullscreen remains active.
            </p>
          </div>
          <button
            className="button button--ghost"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Close
          </button>
        </div>

        <form className="dialog-panel__form" onSubmit={onSubmit}>
          <label className="field-shell">
            <span>Name</span>
            <input
              className="field-input"
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder={currentName}
              disabled={busy}
              autoFocus
            />
          </label>

          <button
            className="button button--primary button--full"
            type="submit"
            disabled={busy || unchanged}
          >
            Save name
          </button>
        </form>
      </section>
    </div>
  );
}

function VmLogsDialog({
  error,
  loading,
  logs,
  refreshing,
  vmName,
  onClose,
  onRefresh,
}: VmLogsDialogProps): JSX.Element {
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <section
        className="dialog-panel dialog-panel--logs"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-panel__header">
          <div>
            <p className="workspace-shell__eyebrow">Workspace logs</p>
            <h2 className="dialog-panel__title">Logs for {vmName}</h2>
            <p className="dialog-panel__copy">
              Polls {logs?.source ?? "the VM log stream"} every {vmLogsPollIntervalMs / 1000}s
              while this modal stays open.
            </p>
          </div>
          <div className="chip-row">
            <button
              className="button button--ghost"
              type="button"
              onClick={onRefresh}
              disabled={loading || refreshing}
            >
              {loading || refreshing ? "Refreshing..." : "Refresh"}
            </button>
            <button className="button button--ghost" type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="chip-row vm-logs__meta">
          {logs ? <span className="surface-pill mono-font">{logs.providerRef}</span> : null}
          <span className="surface-pill">{logs?.source ?? "Loading logs..."}</span>
          {logs ? (
            <span className="surface-pill">Updated {formatTimestamp(logs.fetchedAt)}</span>
          ) : null}
        </div>

        {error ? <p className="empty-copy">Last refresh failed: {error}</p> : null}

        {loading && !logs ? <p className="empty-copy">Loading logs...</p> : null}

        {logs && logs.content.trim().length > 0 ? (
          <VmLogOutput className="vm-logs__output mono-font" content={logs.content} />
        ) : null}

        {!loading && logs && logs.content.trim().length === 0 ? (
          <p className="empty-copy">No VM log output is available yet.</p>
        ) : null}
      </section>
    </div>
  );
}

function CreateVmDialog({
  busy,
  createDraft,
  selectedSource,
  sourceGroups,
  validationError,
  onClose,
  onFieldChange,
  onShutdownBeforeCloneChange,
  onSubmit,
  onSourceChange,
}: CreateVmDialogProps): JSX.Element {
  const snapshotSelected = selectedSource?.kind === "snapshot";
  const cloneVmSelected = selectedSource?.kind === "vm";
  const cloneSourceRunning = cloneVmSelected && selectedSource.sourceVm?.status === "running";
  const reuseExistingDiskState = snapshotSelected || cloneVmSelected;
  const lanAccessDisabled = createDraft.networkMode === "dmz";
  const sourceSummary =
    selectedSource?.kind === "snapshot" && selectedSource.snapshot
      ? `Snapshot ${selectedSource.snapshot.label} from ${selectedSource.sourceVm?.name ?? selectedSource.template.name}.`
      : selectedSource?.kind === "vm" && selectedSource.sourceVm
        ? `Clone the current workspace state from ${selectedSource.sourceVm.name}.`
      : selectedSource
        ? `Template ${selectedSource.template.name} will provision a fresh workspace.`
        : "Choose a template, snapshot, or existing VM to define the initial workspace state.";

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <section className="dialog-panel" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-panel__header">
          <div>
            <p className="workspace-shell__eyebrow">Create workspace</p>
            <h2 className="dialog-panel__title">Launch a VM</h2>
            <p className="dialog-panel__copy">
              Keep the rail lean. Launch from a template, saved snapshot, or existing VM here,
              then manage the rest in the sidepanel.
            </p>
          </div>
          <button className="button button--ghost" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <form className="dialog-panel__form" onSubmit={onSubmit}>
          <label className="field-shell">
            <span>Source</span>
            <select
              className="field-input"
              value={createDraft.launchSource}
              onChange={onSourceChange}
              disabled={busy}
            >
              {sourceGroups.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <p className="empty-copy">{sourceSummary}</p>

          {cloneSourceRunning ? (
            <label
              className="field-shell"
              style={{ alignItems: "center", gap: "0.6rem", gridAutoFlow: "column", justifyContent: "start" }}
            >
              <input
                checked={createDraft.shutdownSourceBeforeClone}
                disabled={busy}
                onChange={(event) => onShutdownBeforeCloneChange(event.target.checked)}
                type="checkbox"
              />
              <span>Shutdown the VM before cloning</span>
            </label>
          ) : null}

          {cloneSourceRunning && !createDraft.shutdownSourceBeforeClone ? (
            <InlineWarningNote title="Running clone source">
              Some apps might have stale state and lockfiles when you clone a running VM. Shut it
              down first if you need a cleaner copy.
            </InlineWarningNote>
          ) : null}

          <label className="field-shell">
            <span>Name</span>
            <input
              className="field-input"
              value={createDraft.name}
              onChange={(event) => onFieldChange("name", event.target.value)}
              placeholder="agent-lab-01"
              disabled={busy}
            />
          </label>

          <div className="compact-grid compact-grid--triple">
            <NumberField
              disabled={busy}
              label="CPU"
              value={createDraft.cpu}
              onChange={(value) => onFieldChange("cpu", value)}
            />
            <NumberField
              disabled={busy}
              allowDecimal
              label="RAM GB"
              value={createDraft.ramGb}
              onChange={(value) => onFieldChange("ramGb", value)}
            />
            <NumberField
              disabled={busy}
              label="Disk GB"
              value={createDraft.diskGb}
              onChange={(value) => onFieldChange("diskGb", value)}
            />
          </div>

          <label
            className="field-shell"
            style={{
              alignItems: "center",
              gap: "0.6rem",
              gridAutoFlow: "column",
              justifyContent: "start",
            }}
          >
            <input
              checked={lanAccessDisabled}
              disabled={busy}
              onChange={(event) =>
                onFieldChange("networkMode", event.target.checked ? "dmz" : "default")}
              type="checkbox"
            />
            <span>Disable LAN access</span>
          </label>

          <p className="empty-copy">
            {lanAccessDisabled
              ? "LAN access is disabled. The workspace uses the DMZ profile, which keeps guest internet and public DNS access while restricting host and private-range access unless explicitly allowed."
              : "LAN access is enabled. The workspace uses the default bridge, including normal host and LAN reachability."}
          </p>

          {!reuseExistingDiskState ? (
            <>
              <label className="field-shell">
                <span>Init commands</span>
                <textarea
                  className="field-input field-input--tall field-input--mono"
                  value={createDraft.initCommands}
                  onChange={(event) => onFieldChange("initCommands", event.target.value)}
                  placeholder={"sudo apt-get update\nsudo apt-get install -y ripgrep"}
                  disabled={busy}
                  spellCheck={false}
                />
              </label>

              <p className="empty-copy">
                These run once on first boot for this VM only. Use template edit or clone when
                you want to save them as the default for future launches.
              </p>
            </>
          ) : null}

          {validationError ? (
            <div className="inline-note">
              <strong>Launch blocked</strong>
              <p>{validationError}</p>
            </div>
          ) : null}

          <button
            className="button button--primary button--full"
            type="submit"
            disabled={busy || selectedSource === null || validationError !== null}
          >
            Queue workspace
          </button>
        </form>
      </section>
    </div>
  );
}

function TemplateCloneDialog({
  busy,
  draft,
  sourceTemplate,
  onClose,
  onFieldChange,
  onSubmit,
}: TemplateCloneDialogProps): JSX.Element {
  const normalizedName = draft.name.trim();

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <section className="dialog-panel" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-panel__header">
          <div>
            <p className="workspace-shell__eyebrow">Template clone</p>
            <h2 className="dialog-panel__title">Save a reusable template</h2>
            <p className="dialog-panel__copy">
              Clone the selected base template, then add one command per line for the
              first boot script.
            </p>
          </div>
          <button
            className="button button--ghost"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Close
          </button>
        </div>

        <form className="dialog-panel__form" onSubmit={onSubmit}>
          {sourceTemplate ? (
            <div className="dialog-panel__template">
              <div className="dialog-panel__template-head">
                <strong>{sourceTemplate.name}</strong>
                <span className="surface-pill">
                  {formatResources(sourceTemplate.defaultResources)}
                </span>
              </div>
              <p>{sourceTemplate.description}</p>
            </div>
          ) : null}

          <label className="field-shell">
            <span>Name</span>
            <input
              className="field-input"
              value={draft.name}
              onChange={(event) => onFieldChange("name", event.target.value)}
              placeholder="Ubuntu Agent Forge Custom"
              disabled={busy}
              autoFocus
            />
          </label>

          <label className="field-shell">
            <span>Description</span>
            <textarea
              className="field-input field-input--tall"
              value={draft.description}
              onChange={(event) => onFieldChange("description", event.target.value)}
              disabled={busy}
            />
          </label>

          <label className="field-shell">
            <span>Init commands</span>
            <textarea
              className="field-input field-input--tall field-input--mono"
              value={draft.initCommands}
              onChange={(event) => onFieldChange("initCommands", event.target.value)}
              placeholder={"sudo apt-get update\nsudo apt-get install -y nodejs npm"}
              disabled={busy}
              spellCheck={false}
            />
          </label>

          <p className="empty-copy">
            First-boot commands run once on fresh launches from this template. Leave the list
            empty if you only want a renamed clone of the base template.
          </p>

          <button
            className="button button--primary button--full"
            type="submit"
            disabled={busy || normalizedName.length === 0}
          >
            Save template
          </button>
        </form>
      </section>
    </div>
  );
}

function TemplateEditDialog({
  busy,
  draft,
  onClose,
  onFieldChange,
  onSubmit,
}: TemplateEditDialogProps): JSX.Element {
  const normalizedName = draft.name.trim();

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <section className="dialog-panel" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-panel__header">
          <div>
            <p className="workspace-shell__eyebrow">Template</p>
            <h2 className="dialog-panel__title">Edit template</h2>
            <p className="dialog-panel__copy">
              Update the saved name, description, and first-boot init commands in one place.
            </p>
          </div>
          <button
            className="button button--ghost"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Close
          </button>
        </div>

        <form className="dialog-panel__form" onSubmit={onSubmit}>
          <label className="field-shell">
            <span>Name</span>
            <input
              className="field-input"
              value={draft.name}
              onChange={(event) => onFieldChange("name", event.target.value)}
              disabled={busy}
              autoFocus
            />
          </label>

          <label className="field-shell">
            <span>Description</span>
            <textarea
              className="field-input field-input--tall"
              value={draft.description}
              onChange={(event) => onFieldChange("description", event.target.value)}
              disabled={busy}
            />
          </label>

          <label className="field-shell">
            <span>Init commands</span>
            <textarea
              className="field-input field-input--tall field-input--mono"
              value={draft.initCommands}
              onChange={(event) => onFieldChange("initCommands", event.target.value)}
              placeholder={"sudo apt-get update\nsudo apt-get install -y nodejs npm"}
              disabled={busy}
              spellCheck={false}
            />
          </label>

          <button
            className="button button--primary button--full"
            type="submit"
            disabled={busy || normalizedName.length === 0}
          >
            Save template
          </button>
        </form>
      </section>
    </div>
  );
}

function CloneVmDialog({
  busy,
  draft,
  sourceVmName,
  onClose,
  onDraftChange,
  onSubmit,
}: CloneVmDialogProps): JSX.Element {
  const normalizedDraft = draft.trim();

  return (
    <div
      className="dialog-backdrop"
      onClick={() => {
        if (!busy) {
          onClose();
        }
      }}
    >
      <section className="dialog-panel" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-panel__header">
          <div>
            <p className="workspace-shell__eyebrow">Clone workspace</p>
            <h2 className="dialog-panel__title">Clone {sourceVmName}</h2>
            <p className="dialog-panel__copy">
              Create a new workspace from the current VM without leaving the dashboard UI.
            </p>
          </div>
          <button
            className="button button--ghost"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Close
          </button>
        </div>

        <form className="dialog-panel__form" onSubmit={onSubmit}>
          <label className="field-shell">
            <span>Name</span>
            <input
              className="field-input"
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder={`${sourceVmName}-clone`}
              disabled={busy}
              autoFocus
            />
          </label>

          <button
            className="button button--primary button--full"
            type="submit"
            disabled={busy || normalizedDraft.length === 0}
          >
            Queue clone
          </button>
        </form>
      </section>
    </div>
  );
}

function TemplateInitCommandsPreview({
  commands,
  truncateAfter,
}: {
  commands: string[];
  truncateAfter?: number;
}): JSX.Element {
  const visibleCommands =
    truncateAfter && truncateAfter > 0 ? commands.slice(0, truncateAfter) : commands;
  const hiddenCount = Math.max(0, commands.length - visibleCommands.length);

  return (
    <div className="template-init-preview">
      <div className="template-init-preview__head">
        <strong>First boot</strong>
        <span className="surface-pill">
          {commands.length} init command{commands.length === 1 ? "" : "s"}
        </span>
      </div>
      {commands.length > 0 ? (
        <>
          <pre className="template-init-preview__output mono-font">
            {visibleCommands.join("\n")}
          </pre>
          {hiddenCount > 0 ? (
            <p className="empty-copy">
              +{hiddenCount} more command{hiddenCount === 1 ? "" : "s"}
            </p>
          ) : null}
        </>
      ) : (
        <p className="empty-copy">No first-boot init commands.</p>
      )}
    </div>
  );
}

interface VmTileProps {
  activeCpuThresholdPercent: number;
  busy: boolean;
  compact: boolean;
  dragging: boolean;
  inspectorVisible: boolean;
  menuOpen: boolean;
  selected: boolean;
  showLivePreview: boolean;
  vm: VmInstance;
  onDragEnd: () => void;
  onDragOver: (targetVmId: string, event: ReactDragEvent<HTMLElement>) => void;
  onDragStart: (vmId: string, event: ReactDragEvent<HTMLElement>) => void;
  onDrop: (targetVmId: string, event: ReactDragEvent<HTMLElement>) => void;
  onClone: (vm: VmInstance) => Promise<void>;
  onDelete: (vm: VmInstance) => Promise<void>;
  onHideInspector: () => void;
  onInspect: (vmId: string) => void;
  onOpenLogs: (vm: VmInstance) => void;
  onOpen: (vmId: string) => void;
  onRename: (vm: VmInstance) => Promise<void>;
  onSetActiveCpuThreshold: (vm: VmInstance) => void;
  onSnapshot: (vm: VmInstance) => Promise<void>;
  onPowerAction: (vmId: string, action: VmPowerAction) => Promise<void>;
  onToggleMenu: (vmId: string) => void;
}

function RailHomeIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="workspace-rail__glyph"
      fill="none"
      viewBox="0 0 16 16"
    >
      <path
        d="M3 7.25 8 3l5 4.25V13H9.75V9.75h-3.5V13H3z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function RailCreateIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="workspace-rail__glyph"
      fill="none"
      viewBox="0 0 16 16"
    >
      <path
        d="M8 3.25v9.5M3.25 8h9.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function RailSettingsIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="workspace-rail__glyph"
      fill="none"
      viewBox="0 0 16 16"
    >
      <path
        d="M3 4.5h10M5 8h8M3 11.5h10"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
      <circle cx="6.25" cy="4.5" fill="currentColor" r="1.15" />
      <circle cx="9.75" cy="8" fill="currentColor" r="1.15" />
      <circle cx="5" cy="11.5" fill="currentColor" r="1.15" />
    </svg>
  );
}

function VmTile({
  activeCpuThresholdPercent,
  busy,
  compact,
  dragging,
  inspectorVisible,
  menuOpen,
  selected,
  showLivePreview,
  vm,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onClone,
  onDelete,
  onHideInspector,
  onInspect,
  onOpenLogs,
  onOpen,
  onRename,
  onSetActiveCpuThreshold,
  onSnapshot,
  onPowerAction,
  onToggleMenu,
}: VmTileProps): JSX.Element {
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const canShowLivePreview =
    showLivePreview &&
    vm.status === "running" &&
    vm.session?.kind === "vnc" &&
    Boolean(vm.session.webSocketPath);
  const previewLabel = vmTilePreviewLabel(vm, showLivePreview);
  const compactCpuPercent = compactVmCpuPercent(vm);
  const showMutedPreviewStatus =
    vm.status === "running" && compactCpuPercent <= activeCpuThresholdPercent;
  const previewStatusColor =
    vm.status === "running"
      ? showMutedPreviewStatus
        ? "rgb(34 197 94 / 0.3)"
        : compactVmCpuColor(compactCpuPercent)
      : null;
  const menu = (
    <div className="vm-tile__menu" onClick={(event) => event.stopPropagation()}>
      <button
        ref={menuButtonRef}
        className={joinClassNames("menu-button", menuOpen ? "menu-button--open" : "")}
        type="button"
        aria-expanded={menuOpen}
        aria-label={`Actions for ${vm.name}`}
        onClick={() => onToggleMenu(vm.id)}
      >
        ...
      </button>

      {menuOpen ? (
        <PortalPopover
          anchorPlacement={compact ? "right-start" : "bottom-end"}
          anchorRef={menuButtonRef}
          className="vm-tile__popover"
          open={menuOpen}
          onClose={() => onToggleMenu(vm.id)}
        >
          {compact ? (
            <div className="vm-tile__popover-telemetry">
              <TelemetryPanel
                activeCpuThresholdPercent={activeCpuThresholdPercent}
                compact
                telemetry={vm.telemetry}
              />
            </div>
          ) : null}
          {!selected ? (
            <button
              className="menu-action"
              type="button"
              onClick={() => {
                onToggleMenu(vm.id);
                onOpen(vm.id);
              }}
            >
              Open
            </button>
          ) : null}
          {selected ? (
            <button
              className="menu-action"
              type="button"
              onClick={() => {
                if (inspectorVisible) {
                  onHideInspector();
                } else {
                  onInspect(vm.id);
                }
              }}
            >
              {inspectorVisible ? "Hide inspector" : "Inspector"}
            </button>
          ) : null}
          <button
            className="menu-action"
            type="button"
            onClick={() => {
              onToggleMenu(vm.id);
              void onPowerAction(vm.id, vm.status === "running" ? "stop" : "start");
            }}
            disabled={busy}
          >
            {vm.status === "running" ? "Stop" : "Start"}
          </button>
          <button
            className="menu-action"
            type="button"
            onClick={() => {
              onToggleMenu(vm.id);
              void onPowerAction(vm.id, "restart");
            }}
            disabled={busy || vm.status !== "running"}
          >
            Restart
          </button>
          <button
            className="menu-action"
            type="button"
            onClick={() => {
              onToggleMenu(vm.id);
              void onClone(vm);
            }}
            disabled={busy}
          >
            Clone
          </button>
          <button
            className="menu-action"
            type="button"
            onClick={() => {
              onToggleMenu(vm.id);
              void onRename(vm);
            }}
            disabled={busy}
          >
            Rename
          </button>
          <button
            className="menu-action"
            type="button"
            onClick={() => {
              onToggleMenu(vm.id);
              onOpenLogs(vm);
            }}
          >
            Logs
          </button>
          <button
            className="menu-action menu-action--split"
            type="button"
            onClick={() => {
              onToggleMenu(vm.id);
              onSetActiveCpuThreshold(vm);
            }}
            disabled={busy}
          >
            <span>Set active threshold</span>
            <span className="menu-action__state">
              {formatThresholdPercent(activeCpuThresholdPercent)}
            </span>
          </button>
          <button
            className="menu-action"
            type="button"
            onClick={() => {
              onToggleMenu(vm.id);
              void onSnapshot(vm);
            }}
            disabled={busy}
          >
            Snapshot
          </button>
          <button
            className="menu-action menu-action--danger"
            type="button"
            onClick={() => {
              onToggleMenu(vm.id);
              void onDelete(vm);
            }}
            disabled={busy}
          >
            Delete
          </button>
        </PortalPopover>
      ) : null}
    </div>
  );

  if (compact) {
    const compactStatusTitle =
      vm.status === "running"
        ? `${vm.name} · ${vm.status} · CPU ${formatTelemetryPercent(vm.telemetry?.cpuPercent)}`
        : `${vm.name} · ${vm.status}`;

    return (
      <article
        className={joinClassNames(
          "vm-tile",
          dragging ? "vm-tile--dragging" : "",
          selected ? "vm-tile--active" : "",
          "vm-tile--compact",
        )}
        draggable={!busy}
        onDragEnd={onDragEnd}
        onDragOver={(event) => onDragOver(vm.id, event)}
        onDragStart={(event) => onDragStart(vm.id, event)}
        onDrop={(event) => onDrop(vm.id, event)}
      >
        <button
          className="vm-tile__compact-trigger"
          type="button"
          aria-label={`Open ${vm.name}`}
          title={compactStatusTitle}
          onClick={() => onOpen(vm.id)}
        >
          <div className="vm-tile__compact-preview">
            {canShowLivePreview && vm.session?.webSocketPath ? (
              <NoVncViewport
                className="vm-tile__viewport"
                surfaceClassName="vm-tile__canvas"
                webSocketPath={vm.session.webSocketPath}
                viewportMode="scale"
                viewOnly
                showHeader={false}
                statusMode="hidden"
              />
            ) : (
              <StaticPatternPreview vm={vm} variant="tile" />
            )}
          </div>
          <span
            className={joinClassNames(
              "vm-tile__compact-status",
              statusClassName(vm.status),
              showMutedPreviewStatus ? "vm-tile__compact-status--muted" : "",
            )}
            style={
              {
                "--vm-compact-cpu-color": previewStatusColor ?? undefined,
              } as CSSProperties
            }
            title={
              vm.status === "running"
                ? `CPU ${formatTelemetryPercent(vm.telemetry?.cpuPercent)}`
                : undefined
            }
            aria-hidden="true"
          />
        </button>
        {menu}
      </article>
    );
  }

  return (
    <article
      className={joinClassNames(
        "vm-tile",
        dragging ? "vm-tile--dragging" : "",
        selected ? "vm-tile--active" : "",
      )}
      draggable={!busy}
      onDragEnd={onDragEnd}
      onDragOver={(event) => onDragOver(vm.id, event)}
      onDragStart={(event) => onDragStart(vm.id, event)}
      onDrop={(event) => onDrop(vm.id, event)}
    >
      <button className="vm-tile__open" type="button" onClick={() => onOpen(vm.id)}>
        <div className="vm-tile__preview">
          {canShowLivePreview && vm.session?.webSocketPath ? (
            <>
              <NoVncViewport
                className="vm-tile__viewport"
                hideConnectedOverlayStatus
                surfaceClassName="vm-tile__canvas"
                webSocketPath={vm.session.webSocketPath}
                viewportMode="scale"
                viewOnly
                showHeader={false}
                statusMode="overlay"
              />
              <span
                className={joinClassNames(
                  "vm-tile__compact-status",
                  "vm-tile__preview-status",
                  statusClassName(vm.status),
                  showMutedPreviewStatus ? "vm-tile__compact-status--muted" : "",
                )}
                style={
                  {
                    "--vm-compact-cpu-color": previewStatusColor ?? undefined,
                  } as CSSProperties
                }
                title={
                  vm.status === "running"
                    ? `CPU ${formatTelemetryPercent(vm.telemetry?.cpuPercent)}`
                    : undefined
                }
                aria-hidden="true"
              />
            </>
          ) : (
            <>
              <StaticPatternPreview vm={vm} variant="tile" />
              <span className="vm-tile__preview-note">{previewLabel}</span>
              <span
                className={joinClassNames(
                  "vm-tile__compact-status",
                  "vm-tile__preview-status",
                  statusClassName(vm.status),
                  showMutedPreviewStatus ? "vm-tile__compact-status--muted" : "",
                )}
                style={
                  {
                    "--vm-compact-cpu-color": previewStatusColor ?? undefined,
                  } as CSSProperties
                }
                title={
                  vm.status === "running"
                    ? `CPU ${formatTelemetryPercent(vm.telemetry?.cpuPercent)}`
                    : undefined
                }
                aria-hidden="true"
              />
            </>
          )}
        </div>

        <div className="vm-tile__body">
          <div className="vm-tile__body-head">
            <div className="vm-tile__identity">
              <h3 className="vm-tile__title">{vm.name}</h3>
              <p className="vm-tile__resources">{formatResources(vm.resources)}</p>
            </div>
            <StatusBadge status={vm.status}>{vm.status}</StatusBadge>
          </div>

          <TelemetryPanel
            activeCpuThresholdPercent={activeCpuThresholdPercent}
            telemetry={vm.telemetry}
          />

        </div>
      </button>
      {menu}
    </article>
  );
}

function TelemetryPanel({
  activeCpuThresholdPercent,
  compact = false,
  label,
  telemetry,
}: {
  activeCpuThresholdPercent: number;
  compact?: boolean;
  label?: string;
  telemetry?: ResourceTelemetry;
}): JSX.Element {
  const chartWidth = compact ? 180 : 240;
  const chartHeight = compact ? 20 : 24;
  const cpuHistory = telemetry?.cpuHistory.length ? telemetry.cpuHistory : [0];
  const ramHistory = telemetry?.ramHistory.length ? telemetry.ramHistory : [0];
  const cpuPercent = telemetry?.cpuPercent;
  const showMutedCpuMetric =
    !compact &&
    cpuPercent !== null &&
    cpuPercent !== undefined &&
    Number.isFinite(cpuPercent) &&
    cpuPercent <= activeCpuThresholdPercent;

  return (
    <div className={joinClassNames("telemetry-panel", compact ? "telemetry-panel--compact" : "")}>
      <div className="telemetry-panel__head">
        {label ? <span className="telemetry-panel__label">{label}</span> : <span />}
        <span className="telemetry-panel__stats">
          <span
            className={joinClassNames(
              "telemetry-panel__metric",
              "telemetry-panel__metric--cpu",
              showMutedCpuMetric ? "telemetry-panel__metric--muted" : "",
            )}
          >
            CPU {formatTelemetryPercent(cpuPercent)}
          </span>
          <span className="telemetry-panel__separator">·</span>
          <span className="telemetry-panel__metric telemetry-panel__metric--ram">
            RAM {formatTelemetryPercent(telemetry?.ramPercent)}
          </span>
        </span>
      </div>
      <svg
        aria-hidden="true"
        className="telemetry-panel__chart"
        preserveAspectRatio="none"
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
      >
        <polyline
          className="telemetry-panel__line telemetry-panel__line--cpu"
          points={buildSparklinePoints(cpuHistory, chartWidth, chartHeight)}
        />
        <polyline
          className="telemetry-panel__line telemetry-panel__line--ram"
          points={buildSparklinePoints(ramHistory, chartWidth, chartHeight)}
        />
      </svg>
    </div>
  );
}

function compactVmCpuPercent(vm: VmInstance): number {
  const rawPercent = vm.telemetry?.cpuPercent;

  if (rawPercent === null || rawPercent === undefined || !Number.isFinite(rawPercent)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(rawPercent)));
}

function compactVmCpuColor(percent: number): string {
  const setpoints = [
    {
      color: { b: 94, g: 197, r: 34 },
      percent: 0,
    },
    {
      color: { b: 59, g: 235, r: 251 },
      percent: 55,
    },
    {
      color: { b: 22, g: 115, r: 249 },
      percent: 78,
    },
    {
      color: { b: 68, g: 68, r: 239 },
      percent: 92,
    },
  ];

  if (percent <= setpoints[0].percent) {
    return rgbColorString(setpoints[0].color);
  }

  for (let index = 1; index < setpoints.length; index += 1) {
    const previous = setpoints[index - 1];
    const current = setpoints[index];

    if (percent <= current.percent) {
      return interpolateRgbColor(
        previous.color,
        current.color,
        (percent - previous.percent) / (current.percent - previous.percent),
      );
    }
  }

  return rgbColorString(setpoints.at(-1)?.color ?? { b: 68, g: 68, r: 239 });
}

function interpolateRgbColor(
  from: {
    b: number;
    g: number;
    r: number;
  },
  to: {
    b: number;
    g: number;
    r: number;
  },
  ratio: number,
): string {
  const clampedRatio = Math.max(0, Math.min(1, ratio));

  const r = Math.round(from.r + (to.r - from.r) * clampedRatio);
  const g = Math.round(from.g + (to.g - from.g) * clampedRatio);
  const b = Math.round(from.b + (to.b - from.b) * clampedRatio);

  return rgbColorString({ b, g, r });
}

function rgbColorString(color: {
  b: number;
  g: number;
  r: number;
}): string {
  return `rgb(${color.r} ${color.g} ${color.b})`;
}

interface PortalPopoverProps {
  anchorPlacement?: "bottom-start" | "bottom-end" | "right-start";
  anchorRef: { current: HTMLElement | null };
  children: ReactNode;
  className?: string;
  open: boolean;
  onClose: () => void;
}

const PORTAL_POPOVER_VIEWPORT_PADDING = 12;
const PORTAL_POPOVER_GAP = 8;

function clampPopoverCoordinate(value: number, size: number, viewportSize: number): number {
  const minimum = PORTAL_POPOVER_VIEWPORT_PADDING;
  const maximum = Math.max(
    minimum,
    viewportSize - PORTAL_POPOVER_VIEWPORT_PADDING - Math.min(size, viewportSize),
  );

  return Math.min(Math.max(value, minimum), maximum);
}

function PortalPopover({
  anchorPlacement = "bottom-end",
  anchorRef,
  children,
  className,
  open,
  onClose,
}: PortalPopoverProps): JSX.Element | null {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useEffect(() => {
    if (!open) {
      setStyle(null);
      return;
    }

    function updatePosition(): void {
      const anchor = anchorRef.current;
      const popover = popoverRef.current;

      if (!anchor || !popover) {
        setStyle(null);
        return;
      }

      const anchorBounds = anchor.getBoundingClientRect();
      const popoverBounds = popover.getBoundingClientRect();
      const nextStyle: CSSProperties = {
        position: "fixed",
        zIndex: 80,
        maxHeight: window.innerHeight - PORTAL_POPOVER_VIEWPORT_PADDING * 2,
      };

      if (anchorPlacement === "right-start") {
        const spaceToRight =
          window.innerWidth -
          anchorBounds.right -
          PORTAL_POPOVER_GAP -
          PORTAL_POPOVER_VIEWPORT_PADDING;
        const spaceToLeft =
          anchorBounds.left - PORTAL_POPOVER_GAP - PORTAL_POPOVER_VIEWPORT_PADDING;
        const openToLeft = spaceToRight < popoverBounds.width && spaceToLeft > spaceToRight;
        const desiredLeft = openToLeft
          ? anchorBounds.left - PORTAL_POPOVER_GAP - popoverBounds.width
          : anchorBounds.right + PORTAL_POPOVER_GAP;

        nextStyle.top = clampPopoverCoordinate(
          anchorBounds.top,
          popoverBounds.height,
          window.innerHeight,
        );
        nextStyle.left = clampPopoverCoordinate(
          desiredLeft,
          popoverBounds.width,
          window.innerWidth,
        );
      } else {
        const spaceBelow =
          window.innerHeight -
          anchorBounds.bottom -
          PORTAL_POPOVER_GAP -
          PORTAL_POPOVER_VIEWPORT_PADDING;
        const spaceAbove =
          anchorBounds.top - PORTAL_POPOVER_GAP - PORTAL_POPOVER_VIEWPORT_PADDING;
        const openAbove = spaceBelow < popoverBounds.height && spaceAbove > spaceBelow;
        const desiredTop = openAbove
          ? anchorBounds.top - PORTAL_POPOVER_GAP - popoverBounds.height
          : anchorBounds.bottom + PORTAL_POPOVER_GAP;
        const desiredLeft =
          anchorPlacement === "bottom-start"
            ? anchorBounds.left
            : anchorBounds.right - popoverBounds.width;

        nextStyle.top = clampPopoverCoordinate(
          desiredTop,
          popoverBounds.height,
          window.innerHeight,
        );
        nextStyle.left = clampPopoverCoordinate(
          desiredLeft,
          popoverBounds.width,
          window.innerWidth,
        );
      }

      setStyle(nextStyle);
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorPlacement, anchorRef, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent): void {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (anchorRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return;
      }

      onClose();
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchorRef, onClose, open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      ref={popoverRef}
      className={joinClassNames("portal-popover", className)}
      style={
        style ?? {
          position: "fixed",
          top: PORTAL_POPOVER_VIEWPORT_PADDING,
          left: PORTAL_POPOVER_VIEWPORT_PADDING,
          visibility: "hidden",
          pointerEvents: "none",
          zIndex: 80,
        }
      }
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

interface WorkspaceSidepanelProps {
  busy: boolean;
  captureDraft: CaptureDraft;
  collapsed: boolean;
  commandDraft: string;
  detail: VmDetail | null;
  diskUsage: VmDiskUsageSnapshot | null;
  diskUsageError: string | null;
  diskUsageLoading: boolean;
  forwardDraft: ForwardDraft;
  fileBrowser: VmFileBrowserSnapshot | null;
  fileBrowserError: string | null;
  fileBrowserLoading: boolean;
  resolutionControlBlocked: boolean;
  resolutionControlMessage: string | null;
  resolutionControlTakeoverBusy: boolean;
  resolutionControlTakeoverLabel: string;
  resolutionDraft: ResolutionDraft;
  resolutionState: DesktopResolutionState;
  resourceDraft: ResourceDraft;
  summary: DashboardSummary;
  touchedFiles: VmTouchedFilesSnapshot | null;
  touchedFilesError: string | null;
  touchedFilesLoading: boolean;
  vm: VmInstance;
  onApplyResolution: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onBrowsePath: (path: string) => Promise<void>;
  onCaptureDraftChange: (draft: CaptureDraft) => void;
  onClone: (vm: VmInstance) => Promise<void>;
  onCommandDraftChange: (value: string) => void;
  onDelete: (vm: VmInstance) => Promise<void>;
  onForwardDraftChange: (draft: ForwardDraft) => void;
  onRename: (vm: VmInstance) => Promise<void>;
  onResolutionModeChange: (mode: DesktopResolutionMode) => void;
  onResolutionDraftChange: (draft: ResolutionDraft) => void;
  onTakeOverResolutionControl: (vm: VmInstance) => Promise<void>;
  onViewportScaleChange: (scale: number) => void;
  onRefreshTouchedFiles: () => Promise<void>;
  onRemoveForward: (forwardId: string) => Promise<void>;
  onResourceDraftChange: (draft: ResourceDraft) => void;
  onSetNetworkMode: (networkMode: VmNetworkMode) => Promise<void>;
  onResize: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSaveForward: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSnapshot: (vm: VmInstance) => Promise<void>;
  onPowerAction: (vmId: string, action: VmPowerAction) => Promise<void>;
  onSubmitCapture: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSubmitCommand: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onLaunchFromSnapshot: (vm: VmInstance, snapshot: Snapshot) => Promise<void>;
  onRestoreSnapshot: (vm: VmInstance, snapshot: Snapshot) => Promise<void>;
  onClosedResizeStart: (pointerClientX: number, handleCenterX: number) => void;
  onOpenCollapsed: () => void;
  onToggleCollapsed: () => void;
  panelRef: RefObject<HTMLElement | null>;
  resizable: boolean;
  resizing: boolean;
  style?: CSSProperties;
  width: number;
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

interface WorkspaceControlLockOverlayProps {
  disabled: boolean;
  message: string;
  takeOverLabel: string;
  takeoverBusy: boolean;
  title: string;
  onTakeOver: () => void;
}

interface SidepanelResizeHandleProps {
  collapsed: boolean;
  onClosedResizeStart: (pointerClientX: number, handleCenterX: number) => void;
  onOpenCollapsed: () => void;
  resizable: boolean;
  resizing: boolean;
  width: number;
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

interface RailResizeHandleProps {
  resizable: boolean;
  resizing: boolean;
  width: number;
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

function WorkspaceControlLockOverlay({
  disabled,
  message,
  takeOverLabel,
  takeoverBusy,
  title,
  onTakeOver,
}: WorkspaceControlLockOverlayProps): JSX.Element {
  return (
    <div className="workspace-stage__control-lock">
      <div className="workspace-stage__control-lock-panel">
        <p className="workspace-stage__control-lock-eyebrow">Viewport locked</p>
        <h3 className="workspace-stage__control-lock-title">{title}</h3>
        <p className="workspace-stage__control-lock-copy">{message}</p>
        <button
          className="button button--secondary"
          disabled={disabled}
          type="button"
          onClick={onTakeOver}
        >
          {takeoverBusy ? "Taking over..." : takeOverLabel}
        </button>
      </div>
    </div>
  );
}

function RailResizeHandle({
  resizable,
  resizing,
  width,
  onResizeKeyDown,
  onResizePointerDown,
}: RailResizeHandleProps): JSX.Element | null {
  if (!resizable) {
    return null;
  }

  return (
    <div
      className={joinClassNames(
        "workspace-rail__resize-track",
        resizing ? "workspace-rail__resize-track--active" : "",
      )}
    >
      <div aria-hidden="true" className="workspace-rail__resize-line" />
      <div
        aria-label="Resize workspace rail"
        aria-orientation="vertical"
        aria-valuemax={railMaxWidth}
        aria-valuemin={railMinWidth}
        aria-valuenow={width}
        className={joinClassNames(
          "workspace-rail__resize-handle",
          resizing ? "workspace-rail__resize-handle--active" : "",
        )}
        role="separator"
        tabIndex={0}
        onKeyDown={onResizeKeyDown}
        onPointerDown={onResizePointerDown}
      />
    </div>
  );
}

function SidepanelResizeHandle({
  collapsed,
  onClosedResizeStart,
  onOpenCollapsed,
  resizable,
  resizing,
  width,
  onResizeKeyDown,
  onResizePointerDown,
}: SidepanelResizeHandleProps): JSX.Element | null {
  if (!resizable) {
    return null;
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!collapsed) {
      onResizePointerDown(event);
      return;
    }

    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const handleBounds = event.currentTarget.getBoundingClientRect();
    const handleCenterX = handleBounds.left + handleBounds.width / 2;
    let completed = false;

    function cleanup(): void {
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerCancel);
    }

    function handleBlur(): void {
      cleanup();
    }

    function handlePointerMove(moveEvent: PointerEvent): void {
      if (completed) {
        return;
      }

      if (
        Math.hypot(moveEvent.clientX - startClientX, moveEvent.clientY - startClientY) < 4
      ) {
        return;
      }

      completed = true;
      cleanup();
      onClosedResizeStart(moveEvent.clientX, handleCenterX);
    }

    function handlePointerUp(): void {
      if (completed) {
        cleanup();
        return;
      }

      completed = true;
      cleanup();
      onOpenCollapsed();
    }

    function handlePointerCancel(): void {
      completed = true;
      cleanup();
    }

    window.addEventListener("blur", handleBlur);
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerCancel);
  }

  return (
    <div
      className={joinClassNames(
        "workspace-sidepanel__resize-track",
        resizing ? "workspace-sidepanel__resize-track--active" : "",
      )}
    >
      <div aria-hidden="true" className="workspace-sidepanel__resize-line" />
      <div
        aria-label="Resize inspector"
        aria-orientation="vertical"
        aria-valuemax={sidepanelMaxWidth}
        aria-valuemin={sidepanelClosedWidth}
        aria-valuenow={width}
        className={joinClassNames(
          "workspace-sidepanel__resize-handle",
          resizing ? "workspace-sidepanel__resize-handle--active" : "",
        )}
        role="separator"
        tabIndex={0}
        onKeyDown={onResizeKeyDown}
        onPointerDown={handlePointerDown}
      />
    </div>
  );
}

function WorkspaceSidepanel({
  busy,
  captureDraft,
  collapsed,
  commandDraft,
  detail,
  diskUsage,
  diskUsageError,
  diskUsageLoading,
  fileBrowser,
  fileBrowserError,
  fileBrowserLoading,
  forwardDraft,
  resolutionControlBlocked,
  resolutionControlMessage,
  resolutionControlTakeoverBusy,
  resolutionControlTakeoverLabel,
  resolutionDraft,
  resolutionState,
  resourceDraft,
  summary,
  touchedFiles,
  touchedFilesError,
  touchedFilesLoading,
  vm,
  onApplyResolution,
  onBrowsePath,
  onCaptureDraftChange,
  onClone,
  onCommandDraftChange,
  onDelete,
  onForwardDraftChange,
  onRename,
  onResolutionModeChange,
  onResolutionDraftChange,
  onTakeOverResolutionControl,
  onViewportScaleChange,
  onRefreshTouchedFiles,
  onRemoveForward,
  onResourceDraftChange,
  onSetNetworkMode,
  onResize,
  onSaveForward,
  onLaunchFromSnapshot,
  onSnapshot,
  onPowerAction,
  onClosedResizeStart,
  onOpenCollapsed,
  onSubmitCapture,
  onSubmitCommand,
  onRestoreSnapshot,
  onToggleCollapsed,
  panelRef,
  resizable,
  resizing,
  style,
  width,
  onResizeKeyDown,
  onResizePointerDown,
}: WorkspaceSidepanelProps): JSX.Element {
  const currentNetworkMode = detail?.vm.networkMode ?? "default";

  return (
    <aside
      ref={panelRef}
      className={joinClassNames(
        "workspace-sidepanel",
        collapsed ? "workspace-sidepanel--collapsed" : "",
        resizing ? "workspace-sidepanel--resizing" : "",
      )}
      style={style}
    >
      <SidepanelResizeHandle
        collapsed={collapsed}
        onClosedResizeStart={onClosedResizeStart}
        onOpenCollapsed={onOpenCollapsed}
        resizable={resizable}
        resizing={resizing}
        width={width}
        onResizeKeyDown={onResizeKeyDown}
        onResizePointerDown={onResizePointerDown}
      />

      {!collapsed ? (
        <>
          <button
            aria-label="Hide inspector"
            className="workspace-sidepanel__close"
            type="button"
            onClick={onToggleCollapsed}
          >
            x
          </button>

          <div className="workspace-sidepanel__scroll">
            {!detail ? (
              <div className="workspace-sidepanel__loading">
                <div className="skeleton-shell workspace-sidepanel__loading-block" />
                <div className="skeleton-shell workspace-sidepanel__loading-block" />
                <div className="skeleton-shell workspace-sidepanel__loading-block" />
              </div>
            ) : (
              <>
            <section className="sidepanel-summary">
              <div className="sidepanel-summary__head">
                <div>
                  <p className="workspace-shell__eyebrow">Inspector</p>
                  <h4 className="sidepanel-summary__title">{vm.name}</h4>
                </div>
                <StatusBadge status={vm.status}>{vm.status}</StatusBadge>
              </div>

              <div className="chip-row">
                <span className="surface-pill">{detail.template?.name ?? "Unlinked template"}</span>
                {diskUsage && isDiskUsageAlert(diskUsage) ? (
                  <span
                    className={joinClassNames(
                      "surface-pill",
                      "surface-pill--warning",
                    )}
                  >
                    {diskUsageChipLabel(diskUsage)}
                  </span>
                ) : null}
              </div>
              <div className="sidepanel-summary__toolbar">
                <button
                  className="button button--ghost"
                  type="button"
                  onClick={() => void onRename(vm)}
                  disabled={busy}
                >
                  Rename
                </button>
              </div>
            </section>

            <SidepanelSection title="Actions" defaultOpen>
              <div className="action-grid">
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() => onPowerAction(vm.id, vm.status === "running" ? "stop" : "start")}
                  disabled={busy}
                >
                  {vm.status === "running" ? "Stop" : "Start"}
                </button>
                <button
                  className="button button--ghost"
                  type="button"
                  onClick={() => void onPowerAction(vm.id, "restart")}
                  disabled={busy || vm.status !== "running"}
                >
                  Restart
                </button>
                <button
                  className="button button--ghost"
                  type="button"
                  onClick={() => void onClone(vm)}
                  disabled={busy}
                >
                  Clone
                </button>
                <button
                  className="button button--ghost"
                  type="button"
                  onClick={() => void onSnapshot(vm)}
                  disabled={busy}
                >
                  Snapshot
                </button>
                <button
                  className="button button--danger"
                  type="button"
                  onClick={() => void onDelete(vm)}
                  disabled={busy}
                >
                  Delete
                </button>
              </div>
            </SidepanelSection>

            <SidepanelSection title="Session" defaultOpen>
              <div className="compact-grid">
                <FieldPair label="Resources" value={formatResources(vm.resources)} />
                <FieldPair
                  label="Updated"
                  value={formatTimestamp(vm.updatedAt)}
                />
                <FieldPair
                  label="Workspace path"
                  mono
                  value={vm.workspacePath}
                />
                <FieldPair
                  label="Last action"
                  value={vm.lastAction}
                />
                <FieldPair
                  label="Browser socket"
                  mono
                  value={detail.vm.session?.webSocketPath ?? "Waiting for VNC bridge"}
                />
                <FieldPair
                  label="Guest endpoint"
                  mono
                  value={
                    detail.vm.session?.host && detail.vm.session?.port
                      ? `${detail.vm.session.host}:${detail.vm.session.port}`
                      : "Guest endpoint pending"
                  }
                />
              </div>
            </SidepanelSection>

            <SidepanelSection title="Viewport" defaultOpen>
              <form className="sidepanel-form" onSubmit={onApplyResolution}>
                <label className="field-shell">
                  <span>Mode</span>
                  <select
                    className="field-input"
                    disabled={resolutionControlBlocked}
                    value={resolutionDraft.mode}
                    onChange={(event) =>
                      onResolutionModeChange(
                        event.target.value === "fixed" ? "fixed" : "viewport",
                      )
                    }
                  >
                    <option value="viewport">Match viewport</option>
                    <option value="fixed">Fixed resolution</option>
                  </select>
                </label>

                {resolutionDraft.mode === "fixed" ? (
                  <div className="compact-grid compact-grid--double">
                    <NumberField
                      disabled={resolutionControlBlocked}
                      label="Width"
                      value={resolutionDraft.width}
                      onChange={(value) =>
                        onResolutionDraftChange({
                          ...resolutionDraft,
                          width: value,
                        })
                      }
                    />
                    <NumberField
                      disabled={resolutionControlBlocked}
                      label="Height"
                      value={resolutionDraft.height}
                      onChange={(value) =>
                        onResolutionDraftChange({
                          ...resolutionDraft,
                          height: value,
                        })
                      }
                    />
                  </div>
                ) : (
                  <label className="field-shell">
                    <span>Scale</span>
                    <div className="field-range">
                      <input
                        className="field-range__input"
                        disabled={resolutionControlBlocked}
                        type="range"
                        min={desktopViewportScaleMin}
                        max={desktopViewportScaleMax}
                        step={desktopViewportScaleStep}
                        value={Number(resolutionDraft.scale) || desktopViewportScaleDefault}
                        onChange={(event) =>
                          onViewportScaleChange(Number(event.target.value))
                        }
                      />
                      <span className="field-range__value mono-font">
                        {formatViewportScale(
                          Number(resolutionDraft.scale) || desktopViewportScaleDefault,
                        )}
                        x
                      </span>
                    </div>
                  </label>
                )}

                <div className="compact-grid compact-grid--triple">
                  <FieldPair
                    compact
                    label="Current"
                    mono
                    value={formatCurrentResolution(resolutionState)}
                  />
                  <FieldPair
                    compact
                    label="Viewport"
                    mono
                    value={formatViewportResolution(resolutionState)}
                  />
                  <FieldPair
                    compact
                    label="Target"
                    mono
                    value={formatTargetResolution(resolutionDraft, resolutionState)}
                  />
                </div>

                {resolutionDraft.mode === "fixed" ? (
                  <button
                    className="button button--secondary button--full"
                    disabled={resolutionControlBlocked}
                    type="submit"
                  >
                    Apply fixed size
                  </button>
                ) : null}

                {resolutionControlMessage ? (
                  <div className="stack">
                    <p className="empty-copy">{resolutionControlMessage}</p>
                    <button
                      className="button button--secondary button--full"
                      disabled={busy || resolutionControlTakeoverBusy}
                      type="button"
                      onClick={() => void onTakeOverResolutionControl(vm)}
                    >
                      {resolutionControlTakeoverBusy ? "Taking over..." : resolutionControlTakeoverLabel}
                    </button>
                  </div>
                ) : null}
              </form>
            </SidepanelSection>

            <SidepanelSection title="Network" defaultOpen>
              <div className="stack">
                <div className="compact-grid compact-grid--double">
                  <FieldPair
                    compact
                    label="Mode"
                    value={formatVmNetworkModeLabel(currentNetworkMode)}
                  />
                  <FieldPair
                    compact
                    label="Reachability"
                    value={
                      currentNetworkMode === "dmz"
                        ? "Internet and public DNS"
                        : "Default bridge"
                    }
                  />
                </div>

                <p className="empty-copy">{describeVmNetworkMode(currentNetworkMode)}</p>

                <div className="action-grid">
                  <button
                    className={
                      currentNetworkMode === "default"
                        ? "button button--secondary"
                        : "button button--ghost"
                    }
                    type="button"
                    onClick={() => void onSetNetworkMode("default")}
                    disabled={busy || currentNetworkMode === "default"}
                  >
                    Default bridge
                  </button>
                  <button
                    className={
                      currentNetworkMode === "dmz"
                        ? "button button--secondary"
                        : "button button--ghost"
                    }
                    type="button"
                    onClick={() => void onSetNetworkMode("dmz")}
                    disabled={busy || currentNetworkMode === "dmz"}
                  >
                    DMZ
                  </button>
                </div>
              </div>
            </SidepanelSection>

            <SidepanelSection title="Disk" defaultOpen>
              <div className="disk-usage-panel">
                <div className="disk-usage-panel__copy">
                  <p
                    className={joinClassNames(
                      "disk-usage-panel__summary",
                      diskUsage && isDiskUsageAlert(diskUsage)
                        ? "disk-usage-panel__summary--warning"
                        : "",
                    )}
                  >
                    {diskUsage
                      ? diskUsageSummaryText(diskUsage)
                      : diskUsageLoading
                        ? "Inspecting guest filesystems..."
                        : "Disk usage appears once the guest answers the probe."}
                  </p>
                  {diskUsage ? (
                    <p className="disk-usage-panel__meta">
                      Checked {formatTimestamp(diskUsage.checkedAt)}
                    </p>
                  ) : null}
                </div>

                {diskUsageError ? <p className="empty-copy">{diskUsageError}</p> : null}
              </div>
            </SidepanelSection>

              <SidepanelSection title="Resize">
                <form className="sidepanel-form" onSubmit={onResize}>
                  <div className="compact-grid compact-grid--triple">
                    <NumberField
                      disabled={busy}
                      label="CPU"
                      value={resourceDraft.cpu}
                      onChange={(value) =>
                        onResourceDraftChange({
                          ...resourceDraft,
                          cpu: value,
                        })
                      }
                    />
                    <NumberField
                      disabled={busy}
                      allowDecimal
                      label="RAM GB"
                      value={resourceDraft.ramGb}
                      onChange={(value) =>
                        onResourceDraftChange({
                          ...resourceDraft,
                          ramGb: value,
                        })
                      }
                    />
                    <NumberField
                      disabled={busy}
                      label="Disk GB"
                      value={resourceDraft.diskGb}
                      onChange={(value) =>
                        onResourceDraftChange({
                          ...resourceDraft,
                          diskGb: value,
                        })
                      }
                    />
                  </div>
                  <button className="button button--secondary button--full" type="submit" disabled={busy}>
                    Save resources
                  </button>
                </form>
              </SidepanelSection>

              <SidepanelSection title="Forwarded services">
                <div className="stack">
                  {detail.vm.forwardedPorts.length > 0 ? (
                    detail.vm.forwardedPorts.map((forward) => (
                      <div key={forward.id} className="list-card">
                        <div className="list-card__head">
                          <div>
                            <strong>{forward.name}</strong>
                            <p>{forward.description || "HTTP/WebSocket forward"}</p>
                          </div>
                          <button
                            className="button button--danger"
                            type="button"
                            onClick={() => void onRemoveForward(forward.id)}
                            disabled={busy}
                          >
                            Remove
                          </button>
                        </div>
                        <div className="compact-grid">
                          <FieldPair label="Guest port" mono value={String(forward.guestPort)} />
                          <FieldPair label="Public path" mono value={forward.publicPath} />
                          {forward.publicHostname ? (
                            <FieldPair
                              label="Public host"
                              mono
                              value={forward.publicHostname}
                            />
                          ) : null}
                        </div>
                        {forward.publicHostname ? (
                          <a
                            className="button button--secondary button--full"
                            href={buildForwardBrowserHref(forward)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open via hostname
                          </a>
                        ) : null}
                        <a
                          className="button button--ghost button--full"
                          href={forward.publicPath}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open via path
                        </a>
                      </div>
                    ))
                  ) : (
                    <p className="empty-copy">No forwarded guest services yet.</p>
                  )}

                  <form className="sidepanel-form sidepanel-form--framed" onSubmit={onSaveForward}>
                    <div className="compact-grid compact-grid--double">
                      <label className="field-shell">
                        <span>Name</span>
                        <input
                          className="field-input"
                          value={forwardDraft.name}
                          onChange={(event) =>
                            onForwardDraftChange({
                              ...forwardDraft,
                              name: event.target.value,
                            })
                          }
                          placeholder="app-ui"
                          disabled={busy}
                        />
                      </label>

                      <NumberField
                        disabled={busy}
                        label="Guest port"
                        value={forwardDraft.guestPort}
                        onChange={(value) =>
                          onForwardDraftChange({
                            ...forwardDraft,
                            guestPort: value,
                          })
                        }
                      />
                    </div>

                    <label className="field-shell">
                      <span>Description</span>
                      <input
                        className="field-input"
                        value={forwardDraft.description}
                        onChange={(event) =>
                          onForwardDraftChange({
                            ...forwardDraft,
                            description: event.target.value,
                          })
                        }
                        placeholder="Guest web app on port 3000"
                        disabled={busy}
                      />
                    </label>

                    <button className="button button--secondary button--full" type="submit" disabled={busy}>
                      Save forwarded service
                    </button>
                  </form>
                </div>
              </SidepanelSection>

              <SidepanelSection title="Command console">
                <form className="sidepanel-form" onSubmit={onSubmitCommand}>
                  <label className="field-shell">
                    <span>Shell command</span>
                    <input
                      className="field-input mono-font"
                      value={commandDraft}
                      onChange={(event) => onCommandDraftChange(event.target.value)}
                      placeholder="pnpm test"
                      disabled={busy}
                    />
                  </label>
                  <div className="chip-row">
                    {quickCommands.map((command) => (
                      <button
                        key={command}
                        className="button button--ghost"
                        type="button"
                        onClick={() => onCommandDraftChange(command)}
                      >
                        {command}
                      </button>
                    ))}
                  </div>
                  <button className="button button--secondary button--full" type="submit" disabled={busy}>
                    Queue command
                  </button>
                </form>

                <div className="stack">
                  {(detail.vm.commandHistory ?? []).length > 0 ? (
                    detail.vm.commandHistory!.slice().reverse().map((entry, index) => (
                      <div
                        key={`${entry.createdAt}-${entry.command}-${index}`}
                        className="command-log"
                      >
                        <div className="command-log__head">
                          <strong className="mono-font">$ {entry.command}</strong>
                          <span className="list-card__timestamp">
                            {formatTimestamp(entry.createdAt)}
                          </span>
                        </div>
                        <div className="chip-row">
                          <span className="surface-pill mono-font">{entry.workspacePath}</span>
                        </div>
                        <pre className="command-log__output mono-font">
                          {entry.output.join("\n")}
                        </pre>
                      </div>
                    ))
                  ) : (
                    <p className="empty-copy">Command output shows up here after each run.</p>
                  )}
                </div>
              </SidepanelSection>

              <SidepanelSection title="Files">
                <div className="stack">
                  <div className="vm-file-browser">
                    <div className="vm-file-browser__head">
                      <nav aria-label="Current folder" className="vm-file-browser__breadcrumb">
                        {buildVmFileBrowserBreadcrumbs(
                          fileBrowser?.currentPath ??
                            fileBrowser?.homePath ??
                            detail.vm.workspacePath,
                        ).map((crumb, index, crumbs) => (
                          <Fragment key={crumb.path}>
                            {index > 1 ? (
                              <span aria-hidden="true" className="vm-file-browser__separator">
                                /
                              </span>
                            ) : null}
                            {index === crumbs.length - 1 ? (
                              <span className="mono-font vm-file-browser__breadcrumb-current">
                                {crumb.label}
                              </span>
                            ) : (
                              <button
                                className="mono-font vm-file-browser__breadcrumb-link"
                                type="button"
                                onClick={() => void onBrowsePath(crumb.path)}
                                disabled={busy || fileBrowserLoading}
                              >
                                {crumb.label}
                              </button>
                            )}
                          </Fragment>
                        ))}
                      </nav>

                      <div className="vm-file-browser__actions">
                        <button
                          className="button button--ghost"
                          type="button"
                          onClick={() =>
                            void onBrowsePath(fileBrowser?.homePath ?? detail.vm.workspacePath)}
                          disabled={busy || fileBrowserLoading}
                        >
                          Home
                        </button>
                        <button
                          className="button button--ghost"
                          type="button"
                          onClick={() => void onBrowsePath("/")}
                          disabled={busy || fileBrowserLoading}
                        >
                          Root
                        </button>
                        <button
                          className="button button--ghost"
                          type="button"
                          onClick={() => {
                            if (fileBrowser?.parentPath) {
                              void onBrowsePath(fileBrowser.parentPath);
                            }
                          }}
                          disabled={busy || fileBrowserLoading || !fileBrowser?.parentPath}
                        >
                          Up
                        </button>
                        <button
                          className="button button--secondary"
                          type="button"
                          onClick={() =>
                            void onBrowsePath(
                              fileBrowser?.currentPath ??
                                fileBrowser?.homePath ??
                                detail.vm.workspacePath,
                            )}
                          disabled={busy || fileBrowserLoading}
                        >
                          {fileBrowserLoading ? "Refreshing..." : "Refresh"}
                        </button>
                      </div>
                    </div>

                    {fileBrowserError ? (
                      <p className="empty-copy">{fileBrowserError}</p>
                    ) : null}

                    {fileBrowser && fileBrowser.entries.length > 0 ? (
                      <div className="vm-file-browser__list" role="list">
                        {fileBrowser.entries.map((entry) => {
                          const meta = formatVmFileBrowserRowMeta(entry);
                          const title = buildVmFileBrowserEntryTitle(entry);
                          const row = (
                            <>
                              <span className="vm-file-browser__name-shell">
                                <span className="vm-file-browser__kind">
                                  {formatVmFileBrowserKindToken(entry.kind)}
                                </span>
                                <span className="mono-font vm-file-browser__name" title={title}>
                                  {entry.name}
                                  {entry.kind === "directory" ? "/" : ""}
                                </span>
                              </span>
                              {meta ? <span className="vm-file-browser__meta">{meta}</span> : null}
                            </>
                          );

                          if (entry.kind === "directory") {
                            return (
                              <button
                                key={entry.path}
                                className="vm-file-browser__row"
                                type="button"
                                title={title}
                                onClick={() => void onBrowsePath(entry.path)}
                                disabled={busy || fileBrowserLoading}
                              >
                                {row}
                              </button>
                            );
                          }

                          if (entry.kind === "file") {
                            return (
                              <a
                                key={entry.path}
                                className="vm-file-browser__row"
                                download={entry.name}
                                href={buildVmFileDownloadHref(vm.id, entry.path)}
                                title={title}
                              >
                                {row}
                              </a>
                            );
                          }

                          return (
                            <div
                              key={entry.path}
                              className="vm-file-browser__row vm-file-browser__row--static"
                              title={title}
                            >
                              {row}
                            </div>
                          );
                        })}
                      </div>
                    ) : fileBrowserLoading ? (
                      <p className="empty-copy">Loading files...</p>
                    ) : (
                      <p className="empty-copy">No files in this folder.</p>
                    )}
                  </div>
                </div>
              </SidepanelSection>

              <SidepanelSection title="Touched this session">
                <div className="stack">
                  <p className="empty-copy">
                    {touchedFiles?.baselineLabel ??
                      "Best effort from workspace timestamps and command-history hints."}
                  </p>
                  <p className="empty-copy">
                    {touchedFiles?.limitationSummary ??
                      "This view is intentionally conservative and may miss or over-report edits."}
                  </p>

                  <div className="action-grid">
                    <button
                      className="button button--secondary"
                      type="button"
                      onClick={() => void onRefreshTouchedFiles()}
                      disabled={busy || touchedFilesLoading}
                    >
                      {touchedFilesLoading ? "Refreshing..." : "Refresh touched files"}
                    </button>
                  </div>

                  {touchedFilesError ? (
                    <p className="empty-copy">{touchedFilesError}</p>
                  ) : null}

                  {touchedFiles && touchedFiles.entries.length > 0 ? (
                    <div className="vm-file-browser__list" role="list">
                      {touchedFiles.entries.map((entry) => {
                        const meta = formatTouchedFileRowMeta(entry);
                        const title = buildTouchedFileEntryTitle(entry);
                        const row = (
                          <>
                            <span className="vm-file-browser__name-shell">
                              <span className="vm-file-browser__kind">
                                {formatVmFileBrowserKindToken(entry.kind)}
                              </span>
                              <span className="mono-font vm-file-browser__name" title={title}>
                                {entry.path}
                                {entry.kind === "directory" ? "/" : ""}
                              </span>
                            </span>
                            {meta ? <span className="vm-file-browser__meta">{meta}</span> : null}
                          </>
                        );

                        if (entry.kind === "directory") {
                          return (
                            <button
                              key={entry.path}
                              className="vm-file-browser__row"
                              type="button"
                              title={title}
                              onClick={() => void onBrowsePath(entry.path)}
                              disabled={busy || touchedFilesLoading}
                            >
                              {row}
                            </button>
                          );
                        }

                        if (entry.kind === "file") {
                          return (
                            <a
                              key={entry.path}
                              className="vm-file-browser__row"
                              download={entry.name}
                              href={buildVmFileDownloadHref(vm.id, entry.path)}
                              title={title}
                            >
                              {row}
                            </a>
                          );
                        }

                        return (
                          <div
                            key={entry.path}
                            className="vm-file-browser__row vm-file-browser__row--static"
                            title={title}
                          >
                            {row}
                          </div>
                        );
                      })}
                    </div>
                  ) : touchedFilesLoading ? (
                    <p className="empty-copy">Comparing workspace timestamps...</p>
                  ) : (
                    <p className="empty-copy">No recently touched paths were detected.</p>
                  )}
                </div>
              </SidepanelSection>

              <SidepanelSection title="Capture template">
                <form className="sidepanel-form" onSubmit={onSubmitCapture}>
                  {vm.status === "running" ? (
                    <InlineWarningNote>{liveCaptureWarningCopy}</InlineWarningNote>
                  ) : null}

                  <label className="field-shell">
                    <span>Mode</span>
                    <select
                      className="field-input"
                      value={captureDraft.mode}
                      onChange={(event) => {
                        const mode = event.target.value === "new" ? "new" : "existing";
                        const fallbackTemplate =
                          summary.templates.find((entry) => entry.id === captureDraft.templateId) ??
                          detail.template ??
                          summary.templates[0] ??
                          null;

                        onCaptureDraftChange(
                          mode === "existing"
                            ? buildCaptureDraft(fallbackTemplate, detail.vm)
                            : {
                                mode: "new",
                                templateId: "",
                                name: captureDraft.name || `Captured ${detail.vm.name}`,
                                description:
                                  captureDraft.description ||
                                  `Captured from workspace ${detail.vm.name}.`,
                              },
                        );
                      }}
                      disabled={busy}
                    >
                      <option value="existing">Update existing template</option>
                      <option value="new">Create new template</option>
                    </select>
                  </label>

                  {captureDraft.mode === "existing" ? (
                    <>
                      <label className="field-shell">
                        <span>Template</span>
                        <select
                          className="field-input"
                          value={captureDraft.templateId}
                          onChange={(event) => {
                            const template =
                              summary.templates.find((entry) => entry.id === event.target.value) ?? null;

                            onCaptureDraftChange({
                              mode: "existing",
                              templateId: event.target.value,
                              name: template?.name ?? captureDraft.name,
                              description: template?.description ?? captureDraft.description,
                            });
                          }}
                          disabled={busy}
                        >
                          {summary.templates.map((template) => (
                            <option key={template.id} value={template.id}>
                              {template.name}
                            </option>
                          ))}
                        </select>
                      </label>

                    </>
                  ) : null}

                  <label className="field-shell">
                    <span>Name</span>
                    <input
                      className="field-input"
                      value={captureDraft.name}
                      onChange={(event) =>
                        onCaptureDraftChange({
                          ...captureDraft,
                          name: event.target.value,
                        })
                      }
                      disabled={busy}
                    />
                  </label>

                  <label className="field-shell">
                    <span>Description</span>
                    <textarea
                      className="field-input field-input--tall"
                      value={captureDraft.description}
                      onChange={(event) =>
                        onCaptureDraftChange({
                          ...captureDraft,
                          description: event.target.value,
                        })
                      }
                      disabled={busy}
                    />
                  </label>

                  <p className="empty-copy">
                    {detail.vm.forwardedPorts.length > 0
                      ? `This capture will keep ${detail.vm.forwardedPorts.length} forwarded service default${detail.vm.forwardedPorts.length === 1 ? "" : "s"} with the template.`
                      : "This capture will not add any forwarded service defaults to the template."}
                  </p>

                  <button className="button button--secondary button--full" type="submit" disabled={busy}>
                    Queue capture
                  </button>
                </form>
              </SidepanelSection>

              <SidepanelSection title="Activity">
                <div className="stack">
                  {detail.recentJobs.length > 0 ? (
                    detail.recentJobs.map((job) => (
                      <div key={job.id} className="list-card">
                        <div className="list-card__head">
                          <strong className="mono-font">{job.kind}</strong>
                          <div className="chip-row">
                            <span className="surface-pill">{job.status}</span>
                            {job.progressPercent !== null && job.progressPercent !== undefined ? (
                              <span className="surface-pill">{job.progressPercent}%</span>
                            ) : null}
                          </div>
                        </div>
                        <p>{job.message}</p>
                        <span className="list-card__timestamp">
                          {formatTimestamp(job.updatedAt)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="empty-copy">No recent jobs for this VM.</p>
                  )}

                  {detail.vm.activityLog.length > 0 ? (
                    detail.vm.activityLog.slice().reverse().map((entry, index) => (
                      <div
                        key={`${entry}-${index}`}
                        className="log-line mono-font"
                      >
                        {entry}
                      </div>
                    ))
                  ) : null}
                </div>
              </SidepanelSection>

              <SidepanelSection title="Snapshots">
                <div className="stack">
                  {vm.status === "running" ? (
                    <InlineWarningNote>{liveCaptureWarningCopy}</InlineWarningNote>
                  ) : null}

                  {detail.snapshots.length > 0 ? (
                    detail.snapshots.map((snapshot) => (
                      <div key={snapshot.id} className="list-card">
                        <div className="list-card__head">
                          <div>
                            <strong>{snapshot.label}</strong>
                            <p className="list-card__timestamp">
                              {formatTimestamp(snapshot.createdAt)}
                            </p>
                          </div>
                          <div className="list-card__actions">
                            <button
                              className="button button--ghost"
                              type="button"
                              onClick={() => void onLaunchFromSnapshot(vm, snapshot)}
                              disabled={busy}
                            >
                              Launch VM
                            </button>
                            <button
                              className="button button--secondary"
                              type="button"
                              onClick={() => void onRestoreSnapshot(vm, snapshot)}
                              disabled={busy}
                            >
                              Reset VM
                            </button>
                          </div>
                        </div>
                        <p>{snapshot.summary}</p>
                      </div>
                    ))
                  ) : (
                    <p className="empty-copy">No snapshots recorded yet.</p>
                  )}
                </div>
              </SidepanelSection>
              </>
            )}
          </div>
        </>
      ) : null}
    </aside>
  );
}

function EmptyWorkspaceStage({
  onCreate,
  summary,
}: {
  onCreate: () => void;
  summary: DashboardSummary;
}): JSX.Element {
  const hasWorkspaces = summary.vms.length > 0;
  const runningJobCount = summary.jobs.filter((job) => job.status === "running").length;

  return (
    <div className="workspace-stage__empty">
      <div className="workspace-stage__empty-main">
        <p className="workspace-stage__eyebrow">Operator view</p>
        <h2 className="workspace-stage__empty-title">
          {hasWorkspaces
            ? "Choose a workspace to open its live desktop."
            : "Launch a workspace to claim the stage."}
        </h2>
        <p className="workspace-stage__copy">
          {hasWorkspaces
            ? "The middle column is reserved for the VM itself. Keep switching on the left and leave the inspector on the right for operational detail."
            : "Once a VM is running, its live desktop takes over this full-height stage while the rails stay available for switching and inspection."}
        </p>
        <div className="workspace-stage__header-actions">
          <button className="button button--primary" type="button" onClick={onCreate}>
            {hasWorkspaces ? "Launch another VM" : "Launch a VM"}
          </button>
        </div>
      </div>

      <div className="workspace-stage__empty-stats">
        <StageStat
          label="Running"
          value={`${summary.metrics.runningVmCount}/${summary.metrics.totalVmCount || 0}`}
        />
        <StageStat label="Templates" value={String(summary.templates.length)} />
        <StageStat label="Active jobs" value={String(runningJobCount)} />
      </div>
    </div>
  );
}

interface WorkspaceBootSurfaceProps {
  state: DesktopBootState;
}

function WorkspaceBootSurface({ state }: WorkspaceBootSurfaceProps): JSX.Element {
  return (
    <div className="workspace-boot">
      <div className="workspace-boot__spinner" aria-hidden="true" />
      <div className="workspace-boot__copy">
        <span className="surface-pill surface-pill--busy">{state.label}</span>
        <h2 className="workspace-boot__title">
          {state.progressPercent !== null ? `${state.progressPercent}%` : state.label}
        </h2>
        {state.timingCopy ? (
          <p className="workspace-boot__meta">{state.timingCopy}</p>
        ) : null}
        <p className="workspace-boot__message">{state.message}</p>
      </div>
    </div>
  );
}

function WorkspaceLogsSurface({
  detail,
  logsState,
}: {
  detail: VmDetail;
  logsState: VmLogsViewState;
}): JSX.Element {
  return (
    <div className="workspace-log-surface">
      <div className="workspace-log-surface__header">
        <span className="surface-pill surface-pill--busy">
          {desktopFallbackBadge(detail)}
        </span>
        <h2 className="workspace-log-surface__title">
          {workspaceLogsTitle(detail)}
        </h2>
        <p className="workspace-log-surface__copy">
          {workspaceLogsMessage(detail)}
        </p>
        <div className="chip-row vm-logs__meta">
          {logsState.logs ? (
            <span className="surface-pill mono-font">{logsState.logs.providerRef}</span>
          ) : null}
          <span className="surface-pill">
            {logsState.logs?.source ?? "Loading guest logs..."}
          </span>
          {logsState.logs ? (
            <span className="surface-pill">
              Updated {formatTimestamp(logsState.logs.fetchedAt)}
            </span>
          ) : null}
        </div>
      </div>

      {logsState.error ? (
        <p className="empty-copy">Last refresh failed: {logsState.error}</p>
      ) : null}

      {logsState.loading && !logsState.logs ? (
        <p className="empty-copy">Loading guest logs...</p>
      ) : null}

      {logsState.logs && logsState.logs.content.trim().length > 0 ? (
        <VmLogOutput className="vm-logs__output workspace-log-surface__output mono-font" content={logsState.logs.content} />
      ) : null}

      {!logsState.loading && logsState.logs && logsState.logs.content.trim().length === 0 ? (
        <p className="empty-copy">No guest log output is available yet.</p>
      ) : null}
    </div>
  );
}

function WorkspaceFallbackSurface({ detail }: { detail: VmDetail }): JSX.Element {
  return (
    <div className="workspace-fallback">
      <StaticPatternPreview vm={detail.vm} variant="stage" />
      <div className="workspace-fallback__copy">
        <div className="workspace-fallback__panel">
          <span className="surface-pill surface-pill--busy">
            {desktopFallbackBadge(detail)}
          </span>
          <h2 className="workspace-fallback__title">
            {workspaceFallbackTitle(detail)}
          </h2>
          <p>{desktopFallbackMessage(detail)}</p>
        </div>
      </div>
    </div>
  );
}

interface TemplateCardProps {
  busy: boolean;
  linkedVmCount: number;
  menuOpen: boolean;
  onCloneTemplate: (template: EnvironmentTemplate) => void;
  onCreateVm: (template: EnvironmentTemplate) => void;
  onDelete: (template: EnvironmentTemplate) => Promise<void>;
  onRename: (template: EnvironmentTemplate) => Promise<void>;
  onToggleMenu: (templateId: string) => void;
  recentSnapshots: Snapshot[];
  template: EnvironmentTemplate;
}

function TemplateCard({
  busy,
  linkedVmCount,
  menuOpen,
  onCloneTemplate,
  onCreateVm,
  onDelete,
  onRename,
  onToggleMenu,
  recentSnapshots,
  template,
}: TemplateCardProps): JSX.Element {
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const canDelete = linkedVmCount === 0;

  return (
    <div className="list-card">
      <div className="list-card__head">
        <div className="list-card__title-copy">
          <strong>{template.name}</strong>
          <div className="chip-row list-card__chips">
            <span className="surface-pill">{formatResources(template.defaultResources)}</span>
            <span
              className={joinClassNames(
                "surface-pill",
                linkedVmCount > 0 ? "surface-pill--warning" : "",
              )}
            >
              {linkedVmCount} VM{linkedVmCount === 1 ? "" : "s"}
            </span>
            <span className="surface-pill">
              {template.snapshotIds.length} snapshot{template.snapshotIds.length === 1 ? "" : "s"}
            </span>
            {template.provenance ? (
              <span className="surface-pill">
                {formatTemplateProvenanceKindLabel(template.provenance.kind)}
              </span>
            ) : null}
          </div>
        </div>

        <div className="list-card__menu" onClick={(event) => event.stopPropagation()}>
          <button
            ref={menuButtonRef}
            className={joinClassNames("menu-button", menuOpen ? "menu-button--open" : "")}
            type="button"
            aria-expanded={menuOpen}
            aria-label={`Actions for ${template.name}`}
            onClick={() => onToggleMenu(template.id)}
          >
            ...
          </button>

          {menuOpen ? (
            <PortalPopover
              anchorRef={menuButtonRef}
              className="list-card__popover"
              open={menuOpen}
              onClose={() => onToggleMenu(template.id)}
            >
              <button
                className="menu-action"
                type="button"
                onClick={() => {
                  onToggleMenu(template.id);
                  onCloneTemplate(template);
                }}
                disabled={busy}
              >
                Clone with init...
              </button>
              <button
                className="menu-action"
                type="button"
                onClick={() => {
                  onToggleMenu(template.id);
                  onCreateVm(template);
                }}
                disabled={busy}
              >
                Create VM...
              </button>
              <button
                className="menu-action"
                type="button"
                onClick={() => {
                  onToggleMenu(template.id);
                  void onRename(template);
                }}
                disabled={busy}
              >
                Edit template...
              </button>
              <button
                className="menu-action menu-action--danger"
                type="button"
                onClick={() => {
                  onToggleMenu(template.id);
                  void onDelete(template);
                }}
                disabled={busy || !canDelete}
                title={!canDelete ? "Delete the linked VMs first." : undefined}
              >
                Delete
              </button>
            </PortalPopover>
          ) : null}
        </div>
      </div>

      <p>{template.description || "No description yet."}</p>
      <TemplateLifecyclePreview recentSnapshots={recentSnapshots} template={template} />
      <TemplateInitCommandsPreview commands={template.initCommands} truncateAfter={3} />
    </div>
  );
}

function TemplateLifecyclePreview({
  compact = false,
  recentSnapshots,
  template,
}: {
  compact?: boolean;
  recentSnapshots: Snapshot[];
  template: EnvironmentTemplate;
}): JSX.Element | null {
  const visibleNotes = template.notes
    .filter((note) => note !== template.provenance?.summary)
    .slice(0, compact ? 2 : 3);
  const visibleHistory = (template.history ?? []).slice(0, compact ? 2 : 3);

  if (!template.provenance && visibleNotes.length === 0 && visibleHistory.length === 0) {
    return null;
  }

  return (
    <div className="stack">
      {template.provenance ? (
        <p className="empty-copy">{template.provenance.summary}</p>
      ) : null}

      {recentSnapshots.length > 0 ? (
        <div className="chip-row">
          {recentSnapshots.map((snapshot) => (
            <span key={snapshot.id} className="surface-pill">
              {snapshot.label}
            </span>
          ))}
        </div>
      ) : null}

      {visibleNotes.map((note) => (
        <p key={note} className="empty-copy">
          {note}
        </p>
      ))}

      {visibleHistory.map((entry) => (
        <p
          key={`${entry.kind}-${entry.createdAt}-${entry.summary}`}
          className="list-card__timestamp"
        >
          {formatTimestamp(entry.createdAt)} · {entry.summary}
        </p>
      ))}
    </div>
  );
}

function OverviewSidepanel({
  busy,
  collapsed,
  incusStorage,
  openTemplateMenuId,
  onCreate,
  onCloneTemplate,
  onCreateFromTemplate,
  onClosedResizeStart,
  onDeleteTemplate,
  onOpenCollapsed,
  onRenameTemplate,
  onToggleTemplateMenu,
  onToggleCollapsed,
  persistence,
  summary,
  panelRef,
  resizable,
  resizing,
  style,
  width,
  onResizeKeyDown,
  onResizePointerDown,
}: {
  busy: boolean;
  collapsed: boolean;
  incusStorage: HealthStatus["incusStorage"];
  openTemplateMenuId: string | null;
  onCreate: () => void;
  onCloneTemplate: (template: EnvironmentTemplate) => void;
  onCreateFromTemplate: (template: EnvironmentTemplate) => void;
  onClosedResizeStart: (pointerClientX: number, handleCenterX: number) => void;
  onDeleteTemplate: (template: EnvironmentTemplate) => Promise<void>;
  onOpenCollapsed: () => void;
  onRenameTemplate: (template: EnvironmentTemplate) => Promise<void>;
  onToggleTemplateMenu: (templateId: string) => void;
  onToggleCollapsed: () => void;
  persistence: HealthStatus["persistence"] | null;
  summary: DashboardSummary;
  panelRef: RefObject<HTMLElement | null>;
  resizable: boolean;
  resizing: boolean;
  style?: CSSProperties;
  width: number;
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}): JSX.Element {
  const runningJobCount = summary.jobs.filter((job) => job.status === "running").length;
  const recentJobs = summary.jobs.slice(0, 5);

  return (
    <aside
      ref={panelRef}
      className={joinClassNames(
        "workspace-sidepanel",
        "workspace-sidepanel--overview",
        collapsed ? "workspace-sidepanel--collapsed" : "",
        resizing ? "workspace-sidepanel--resizing" : "",
      )}
      style={style}
    >
      <SidepanelResizeHandle
        collapsed={collapsed}
        onClosedResizeStart={onClosedResizeStart}
        onOpenCollapsed={onOpenCollapsed}
        resizable={resizable}
        resizing={resizing}
        width={width}
        onResizeKeyDown={onResizeKeyDown}
        onResizePointerDown={onResizePointerDown}
      />

      {!collapsed ? (
        <>
          {resizable ? (
            <button
              aria-label="Hide inspector"
              className="workspace-sidepanel__close"
              type="button"
              onClick={onToggleCollapsed}
            >
              x
            </button>
          ) : null}

          <div className="workspace-sidepanel__scroll">
            <section className="sidepanel-summary">
              <div className="sidepanel-summary__head">
                <div>
                  <p className="workspace-shell__eyebrow">Inspector</p>
                  <h4 className="sidepanel-summary__title">
                    {summary.vms.length > 0 ? "Fleet overview" : "No workspace selected"}
                  </h4>
                </div>
                <span
                  className={joinClassNames(
                    "surface-pill",
                    summary.provider.hostStatus === "ready"
                      ? "surface-pill--success"
                      : "surface-pill--warning",
                  )}
                >
                  {summary.provider.hostStatus === "ready"
                    ? "Ready"
                    : summary.provider.hostStatus === "network-unreachable"
                      ? "Warning"
                      : "Blocked"}
                </span>
              </div>

              <p className="empty-copy">{summary.provider.detail}</p>

              <div className="chip-row">
                {persistence ? (
                  <span
                    className={joinClassNames(
                      "surface-pill",
                      persistence.status === "ready"
                        ? "surface-pill--success"
                        : "surface-pill--warning",
                    )}
                  >
                    {persistenceChipLabel(persistence)}
                  </span>
                ) : null}
                {incusStorage ? (
                  <span
                    className={joinClassNames(
                      "surface-pill",
                      incusStorage.status === "ready"
                        ? "surface-pill--success"
                        : "surface-pill--warning",
                    )}
                  >
                    {incusStorageChipLabel(incusStorage)}
                  </span>
                ) : null}
                <span className="surface-pill">
                  {summary.snapshots.length} snapshot{summary.snapshots.length === 1 ? "" : "s"}
                </span>
              </div>

              {persistence ? (
                <div className="compact-grid">
                  <FieldPair label="Backend" value={persistenceBackendLabel(persistence.kind)} />
                  <FieldPair label="Status" value={persistenceStatusLabel(persistence)} />
                  <FieldPair
                    label="Last write"
                    value={persistence.lastPersistedAt ? formatTimestamp(persistence.lastPersistedAt) : "Pending"}
                  />
                  <FieldPair
                    label="Last attempt"
                    value={
                      persistence.lastPersistAttemptAt
                        ? formatTimestamp(persistence.lastPersistAttemptAt)
                        : "Pending"
                    }
                  />
                </div>
              ) : null}
            </section>

            <SidepanelSection title="Fleet" defaultOpen>
              <div className="compact-grid">
                <FieldPair label="VMs" value={String(summary.metrics.totalVmCount)} />
                <FieldPair
                  label="Running"
                  value={`${summary.metrics.runningVmCount}/${summary.metrics.totalVmCount}`}
                />
                <FieldPair
                  label="CPU"
                  value={formatUsageCount(summary.metrics.totalCpu, summary.metrics.hostCpuCount)}
                />
                <FieldPair
                  label="RAM"
                  value={formatRamUsage(summary.metrics.totalRamMb, summary.metrics.hostRamMb)}
                />
                <FieldPair
                  label="Disk"
                  value={formatDiskUsage(summary.metrics.totalDiskGb, summary.metrics.hostDiskGb)}
                />
                <FieldPair label="Active jobs" value={String(runningJobCount)} />
              </div>
              <button className="button button--secondary button--full" type="button" onClick={onCreate}>
                Launch workspace
              </button>
            </SidepanelSection>

            {persistence || incusStorage ? (
              <SidepanelSection title="Persistence & Storage">
                {persistence ? (
                  <div className="compact-grid">
                    <FieldPair
                      label="State backend"
                      value={persistenceBackendLabel(persistence.kind)}
                    />
                    <FieldPair
                      label="State status"
                      value={persistenceStatusLabel(persistence)}
                    />
                    <FieldPair
                      compact
                      label="State location"
                      mono={persistence.kind === "json"}
                      value={persistenceLocationLabel(persistence)}
                    />
                    <FieldPair
                      label="Last write"
                      value={
                        persistence.lastPersistedAt
                          ? formatTimestamp(persistence.lastPersistedAt)
                          : "Pending"
                      }
                    />
                  </div>
                ) : null}

                {incusStorage ? (
                  <>
                    <div className="compact-grid">
                      <FieldPair
                        compact
                        label="Selected pool"
                        mono
                        value={incusStoragePoolLabel(incusStorage)}
                      />
                      <FieldPair
                        label="Pool status"
                        value={incusStorageStatusLabel(incusStorage)}
                      />
                      <FieldPair
                        label="Driver"
                        value={incusStorage.selectedPoolDriver ?? "Unknown"}
                      />
                      <FieldPair
                        compact
                        label="Source"
                        mono
                        value={incusStorage.selectedPoolSource ?? "Managed by Incus"}
                      />
                    </div>

                    {incusStorage.availablePools.length > 0 ? (
                      <div className="chip-row">
                        {incusStorage.availablePools.map((pool) => (
                          <span key={pool.name} className="surface-pill mono-font">
                            {pool.name}
                            {pool.driver ? ` (${pool.driver})` : ""}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </SidepanelSection>
            ) : null}

            <SidepanelSection title="Templates">
              <div className="stack">
                {summary.templates.length > 0 ? (
                  summary.templates.map((template) => (
                    <TemplateCard
                      key={template.id}
                      busy={busy}
                      linkedVmCount={
                        summary.vms.filter((entry) => entry.templateId === template.id).length
                      }
                      menuOpen={openTemplateMenuId === template.id}
                      onCloneTemplate={onCloneTemplate}
                      onCreateVm={onCreateFromTemplate}
                      onDelete={onDeleteTemplate}
                      onRename={onRenameTemplate}
                      onToggleMenu={onToggleTemplateMenu}
                      recentSnapshots={resolveRecentTemplateSnapshots(
                        template,
                        summary.snapshots,
                        3,
                      )}
                      template={template}
                    />
                  ))
                ) : (
                  <p className="empty-copy">No templates available yet.</p>
                )}
              </div>
            </SidepanelSection>

            <SidepanelSection title="Recent jobs">
              <div className="stack">
                {recentJobs.length > 0 ? (
                  recentJobs.map((job) => (
                    <div key={job.id} className="list-card">
                      <div className="list-card__head">
                        <strong className="mono-font">{job.kind}</strong>
                        <span className="surface-pill">{job.status}</span>
                      </div>
                      <p>{job.message}</p>
                      <span className="list-card__timestamp">{formatTimestamp(job.updatedAt)}</span>
                    </div>
                  ))
                ) : (
                  <p className="empty-copy">No jobs have been queued yet.</p>
                )}
              </div>
            </SidepanelSection>
          </div>
        </>
      ) : null}
    </aside>
  );
}

function LoadingShell({ showContent = true }: { showContent?: boolean }): JSX.Element {
  return (
    <main className="loading-shell">
      {showContent ? (
        <div className="loading-shell__panel">
          <p className="workspace-shell__eyebrow">Parallaize Control Plane</p>
          <h1 className="loading-shell__title">Loading dashboard</h1>
          <p className="loading-shell__copy">
            Fetching provider state, templates, workspaces, and recent jobs.
          </p>
        </div>
      ) : null}
    </main>
  );
}

function LoginShell({
  busy,
  error,
  loginDraft,
  onFieldChange,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  loginDraft: LoginDraft;
  onFieldChange: (field: keyof LoginDraft, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}): JSX.Element {
  return (
    <main className="loading-shell">
      <section className="login-shell">
        <div className="login-shell__header">
          <p className="workspace-shell__eyebrow">Parallaize Admin</p>
          <h1 className="loading-shell__title">Sign in</h1>
          <p className="loading-shell__copy">
            Sign in with the shared admin credentials to unlock the dashboard session.
          </p>
        </div>

        <form className="login-shell__form" onSubmit={onSubmit}>
          <label className="field-shell">
            <span>Username</span>
            <input
              className="field-input"
              value={loginDraft.username}
              onChange={(event) => onFieldChange("username", event.target.value)}
              disabled={busy}
              autoComplete="username"
            />
          </label>
          <label className="field-shell">
            <span>Password</span>
            <input
              className="field-input"
              type="password"
              value={loginDraft.password}
              onChange={(event) => onFieldChange("password", event.target.value)}
              disabled={busy}
              autoComplete="current-password"
            />
          </label>
          {error ? <p className="login-shell__error">{error}</p> : null}
          <button className="button button--primary button--full" type="submit" disabled={busy}>
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}

function MiniStat({
  label,
  value,
}: {
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className="mini-stat">
      <span className="mini-stat__label">{label}</span>
      <strong className="mini-stat__value">{value}</strong>
    </div>
  );
}

function StageStat({
  label,
  value,
}: {
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className="workspace-stage__stat">
      <span className="workspace-stage__stat-label">{label}</span>
      <strong className="workspace-stage__stat-value">{value}</strong>
    </div>
  );
}

function SidepanelSection({
  children,
  defaultOpen = false,
  title,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
  title: string;
}): JSX.Element {
  return (
    <details className="sidepanel-section" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="sidepanel-section__body">{children}</div>
    </details>
  );
}

function StaticPatternPreview({
  variant,
  vm,
}: {
  variant: "stage" | "tile";
  vm: VmInstance;
}): JSX.Element {
  return (
    <div
      className={joinClassNames(
        "pattern-preview",
        variant === "stage" ? "pattern-preview--stage" : "pattern-preview--tile",
      )}
      style={buildPatternStyle(vm.screenSeed)}
      aria-hidden="true"
    >
      <div className="pattern-preview__mesh" />
      <div className="pattern-preview__band pattern-preview__band--a" />
      <div className="pattern-preview__band pattern-preview__band--b" />
      <div className="pattern-preview__glow" />
    </div>
  );
}

function NumberField({
  allowDecimal = false,
  disabled,
  label,
  onChange,
  value,
}: {
  allowDecimal?: boolean;
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
}): JSX.Element {
  return (
    <label className="field-shell">
      <span>{label}</span>
      <input
        className="field-input"
        inputMode={allowDecimal ? "decimal" : "numeric"}
        pattern={allowDecimal ? "[0-9]*[.]?[0-9]*" : "[0-9]*"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
    </label>
  );
}

function StatusBadge({
  children,
  status,
}: {
  children: string;
  status: VmStatus;
}): JSX.Element {
  return <span className={`status-badge ${statusClassName(status)}`}>{children}</span>;
}

function FieldPair({
  compact = false,
  label,
  mono = false,
  value,
}: {
  compact?: boolean;
  label: string;
  mono?: boolean;
  value: string;
}): JSX.Element {
  return (
    <div className={joinClassNames("field-pair", compact ? "field-pair--compact" : "")}>
      <p className="field-pair__label">{label}</p>
      <p className={joinClassNames("field-pair__value", mono ? "mono-font" : "")}>{value}</p>
    </div>
  );
}

function InlineWarningNote({
  children,
  title = "Running VM",
}: {
  children: ReactNode;
  title?: string;
}): JSX.Element {
  return (
    <div className="inline-note inline-note--warning">
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}

function syncCreateDraft(
  current: CreateDraft,
  templates: EnvironmentTemplate[],
  snapshots: Snapshot[],
  vms: VmInstance[],
  preserveInput: boolean,
): CreateDraft {
  const selectedSource = resolveCreateSourceSelection(
    templates,
    snapshots,
    vms,
    current.launchSource,
  );
  const nextSource = selectedSource ?? firstCreateSourceSelection(templates, snapshots, vms);

  if (!nextSource) {
    return current;
  }

  if (preserveInput && current.launchSource) {
    return current;
  }

  return buildCreateDraftFromSource(nextSource, current.name);
}

function buildCreateDraftFromSource(
  source: CreateSourceSelection,
  name = "",
): CreateDraft {
  if (source.kind === "snapshot" && source.snapshot) {
    return buildCreateDraftFromSnapshot(source.snapshot, source.template, source.sourceVm, name);
  }

  if (source.kind === "vm" && source.sourceVm) {
    return buildCreateDraftFromVm(source.sourceVm, source.template, name);
  }

  return buildCreateDraftFromTemplate(source.template, name);
}

function buildCreateDraftFromTemplate(
  template: EnvironmentTemplate,
  name = "",
): CreateDraft {
  return {
    launchSource: buildCreateSourceValue("template", template.id),
    name,
    cpu: String(template.defaultResources.cpu),
    ramGb: formatRamDraftValue(template.defaultResources.ramMb),
    diskGb: String(template.defaultResources.diskGb),
    networkMode: template.defaultNetworkMode ?? "default",
    initCommands: formatInitCommandsDraft(template.initCommands),
    shutdownSourceBeforeClone: false,
  };
}

function buildCreateDraftFromSnapshot(
  snapshot: Snapshot,
  template: EnvironmentTemplate,
  sourceVm: VmInstance | null,
  name = "",
): CreateDraft {
  return {
    launchSource: buildCreateSourceValue("snapshot", snapshot.id),
    name,
    cpu: String(snapshot.resources.cpu),
    ramGb: formatRamDraftValue(snapshot.resources.ramMb),
    diskGb: String(snapshot.resources.diskGb),
    networkMode: normalizeVmNetworkMode(sourceVm?.networkMode ?? template.defaultNetworkMode),
    initCommands: "",
    shutdownSourceBeforeClone: false,
  };
}

function buildCreateDraftFromVm(
  sourceVm: VmInstance,
  template: EnvironmentTemplate,
  name = "",
): CreateDraft {
  return {
    launchSource: buildCreateSourceValue("vm", sourceVm.id),
    name,
    cpu: String(sourceVm.resources.cpu),
    ramGb: formatRamDraftValue(sourceVm.resources.ramMb),
    diskGb: String(sourceVm.resources.diskGb),
    networkMode: normalizeVmNetworkMode(sourceVm.networkMode ?? template.defaultNetworkMode),
    initCommands: "",
    shutdownSourceBeforeClone: sourceVm.status === "running",
  };
}

function buildTemplateCloneDraft(template: EnvironmentTemplate): TemplateCloneDraft {
  return {
    sourceTemplateId: template.id,
    name: `${template.name} Custom`,
    description: template.description,
    initCommands: formatInitCommandsDraft(template.initCommands),
  };
}

function buildTemplateEditDraft(template: EnvironmentTemplate): TemplateEditDraft {
  return {
    templateId: template.id,
    name: template.name,
    description: template.description,
    initCommands: formatInitCommandsDraft(template.initCommands),
  };
}

function formatInitCommandsDraft(commands: string[]): string {
  return commands.join("\n");
}

function parseInitCommandsDraft(value: string): string[] {
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeVmNetworkMode(value: string | null | undefined): VmNetworkMode {
  return value === "dmz" ? "dmz" : "default";
}

function formatVmNetworkModeLabel(networkMode: VmNetworkMode): string {
  return networkMode === "dmz" ? "DMZ" : "Default bridge";
}

function describeVmNetworkMode(networkMode: VmNetworkMode): string {
  if (networkMode === "dmz") {
    return "DMZ keeps guest internet and public DNS working, but blocks access into the host and private ranges except for the managed allowances the workspace stack needs.";
  }

  return "Default bridge keeps the VM on the normal network profile, including the usual host and LAN reachability.";
}

function buildCreateSourceValue(kind: CreateSourceKind, id: string): string {
  return `${kind}:${id}`;
}

function parseCreateSourceValue(
  value: string,
): { id: string; kind: CreateSourceKind } | null {
  const separatorIndex = value.indexOf(":");

  if (separatorIndex === -1) {
    return null;
  }

  const kind = value.slice(0, separatorIndex);
  const id = value.slice(separatorIndex + 1);

  if ((kind !== "template" && kind !== "snapshot" && kind !== "vm") || id.length === 0) {
    return null;
  }

  return {
    id,
    kind,
  };
}

function firstCreateSourceSelection(
  templates: EnvironmentTemplate[],
  snapshots: Snapshot[],
  vms: VmInstance[],
): CreateSourceSelection | null {
  return buildCreateSourceGroups(templates, snapshots, vms)[0]?.options[0] ?? null;
}

function buildCreateSourceGroups(
  templates: EnvironmentTemplate[],
  snapshots: Snapshot[],
  vms: VmInstance[],
): CreateSourceGroup[] {
  const systemTemplates = templates
    .filter((template) => isSystemTemplate(template))
    .map((template) => buildTemplateCreateSourceSelection(template));
  const myTemplates = templates
    .filter((template) => !isSystemTemplate(template))
    .map((template) => buildTemplateCreateSourceSelection(template));
  const snapshotOptions = snapshots
    .map((snapshot) => buildSnapshotCreateSourceSelection(snapshot, templates, vms));
  const vmOptions = vms
    .map((vm) => buildVmCreateSourceSelection(vm, templates));

  return [
    systemTemplates.length > 0
      ? {
          label: "System templates",
          options: systemTemplates,
        }
      : null,
    myTemplates.length > 0
      ? {
          label: "My templates",
          options: myTemplates,
        }
      : null,
    snapshotOptions.length > 0
      ? {
          label: "Snapshots",
          options: snapshotOptions,
        }
      : null,
    vmOptions.length > 0
      ? {
          label: "Clone existing VM",
          options: vmOptions,
        }
      : null,
  ].filter((group): group is CreateSourceGroup => group !== null);
}

function resolveCreateSourceSelection(
  templates: EnvironmentTemplate[],
  snapshots: Snapshot[],
  vms: VmInstance[],
  value: string,
): CreateSourceSelection | null {
  const parsed = parseCreateSourceValue(value);

  if (!parsed) {
    return null;
  }

  if (parsed.kind === "template") {
    const template = templates.find((entry) => entry.id === parsed.id);
    return template ? buildTemplateCreateSourceSelection(template) : null;
  }

  if (parsed.kind === "snapshot") {
    const snapshot = snapshots.find((entry) => entry.id === parsed.id);
    return snapshot ? buildSnapshotCreateSourceSelection(snapshot, templates, vms) : null;
  }

  const vm = vms.find((entry) => entry.id === parsed.id);
  return vm ? buildVmCreateSourceSelection(vm, templates) : null;
}

function buildTemplateCreateSourceSelection(
  template: EnvironmentTemplate,
): CreateSourceSelection {
  return {
    category: isSystemTemplate(template) ? "system-templates" : "my-templates",
    kind: "template",
    label: template.name,
    snapshot: null,
    sourceVm: null,
    template,
    value: buildCreateSourceValue("template", template.id),
  };
}

function buildSnapshotCreateSourceSelection(
  snapshot: Snapshot,
  templates: EnvironmentTemplate[],
  vms: VmInstance[],
): CreateSourceSelection {
  const template = resolveCreateSourceTemplate(templates, snapshot);
  const sourceVm = vms.find((entry) => entry.id === snapshot.vmId) ?? null;

  return {
    category: "snapshots",
    kind: "snapshot",
    label: `${snapshot.label} - ${sourceVm?.name ?? template.name}`,
    snapshot,
    sourceVm,
    template,
    value: buildCreateSourceValue("snapshot", snapshot.id),
  };
}

function buildVmCreateSourceSelection(
  vm: VmInstance,
  templates: EnvironmentTemplate[],
): CreateSourceSelection {
  const template =
    templates.find((entry) => entry.id === vm.templateId) ?? buildRecoveredCreateSourceTemplateFromVm(vm);

  return {
    category: "existing-vms",
    kind: "vm",
    label: `${vm.name} - ${vm.status}`,
    snapshot: null,
    sourceVm: vm,
    template,
    value: buildCreateSourceValue("vm", vm.id),
  };
}

function resolveCreateSourceTemplate(
  templates: EnvironmentTemplate[],
  snapshot: Snapshot,
): EnvironmentTemplate {
  return (
    templates.find((entry) => entry.id === snapshot.templateId) ??
    buildRecoveredCreateSourceTemplate(snapshot)
  );
}

function buildRecoveredCreateSourceTemplate(
  snapshot: Snapshot,
): EnvironmentTemplate {
  return {
    id: snapshot.templateId,
    name: "Deleted template",
    description: "Recovered from snapshot metadata after the template record was removed.",
    launchSource: "images:ubuntu/noble/desktop",
    defaultResources: { ...snapshot.resources },
    defaultForwardedPorts: [],
    defaultNetworkMode: "default",
    initCommands: [],
    tags: ["orphaned"],
    notes: ["Recovered from snapshot metadata after template deletion."],
    snapshotIds: [snapshot.id],
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.createdAt,
  };
}

function buildRecoveredCreateSourceTemplateFromVm(
  vm: VmInstance,
): EnvironmentTemplate {
  return {
    id: vm.templateId,
    name: "Deleted template",
    description: "Recovered from VM metadata after the template record was removed.",
    launchSource: "images:ubuntu/noble/desktop",
    defaultResources: { ...vm.resources },
    defaultForwardedPorts: [],
    defaultNetworkMode: normalizeVmNetworkMode(vm.networkMode),
    initCommands: [],
    tags: ["orphaned"],
    notes: ["Recovered from VM metadata after template deletion."],
    snapshotIds: [],
    createdAt: vm.createdAt,
    updatedAt: vm.updatedAt,
  };
}

function isSystemTemplate(template: EnvironmentTemplate): boolean {
  return template.provenance?.kind === "seed";
}

function buildCreateLaunchValidationError(
  source: CreateSourceSelection | null,
  diskGbInput: string,
): string | null {
  if (!source) {
    return null;
  }

  const requestedDiskGb = Number(diskGbInput);

  if (!Number.isFinite(requestedDiskGb)) {
    return null;
  }

  if (source.kind === "snapshot" && source.snapshot) {
    const minimumSnapshotDiskGb = source.snapshot.resources.diskGb;

    if (requestedDiskGb < minimumSnapshotDiskGb) {
      return `Snapshot ${source.snapshot.label} needs at least ${minimumSnapshotDiskGb} GB disk because shrinking a saved filesystem is not supported.`;
    }
  }

  if (source.kind === "vm" && source.sourceVm) {
    const minimumVmDiskGb = source.sourceVm.resources.diskGb;

    if (requestedDiskGb < minimumVmDiskGb) {
      return `${source.sourceVm.name} needs at least ${minimumVmDiskGb} GB disk because shrinking a cloned filesystem is not supported.`;
    }
  }

  const minimumTemplateDiskGb = minimumCreateDiskGb(source.template);

  if (minimumTemplateDiskGb === null || requestedDiskGb >= minimumTemplateDiskGb) {
    return null;
  }

  return `${source.template.name} was captured from a ${minimumTemplateDiskGb} GB workspace and needs at least ${minimumTemplateDiskGb} GB disk to launch cleanly.`;
}

function formatRamDraftValue(ramMb: number): string {
  return trimTrailingZeros((ramMb / 1024).toFixed(3));
}

function parseRamDraftValue(ramGb: string): number {
  const parsed = Number(ramGb);
  return Number.isFinite(parsed)
    ? Math.round(parsed * 1024)
    : Number.NaN;
}

function trimTrailingZeros(value: string): string {
  return value.replace(/(?:\.0+|(\.\d*?[1-9])0+)$/, "$1");
}

function reorderVmIds(
  currentVmIds: string[],
  draggedVmId: string,
  targetVmId: string,
): string[] {
  if (draggedVmId === targetVmId) {
    return currentVmIds;
  }

  const nextVmIds = currentVmIds.filter((vmId) => vmId !== draggedVmId);
  const targetIndex = nextVmIds.indexOf(targetVmId);

  if (targetIndex === -1) {
    return currentVmIds;
  }

  nextVmIds.splice(targetIndex, 0, draggedVmId);
  return nextVmIds;
}

function sameIdOrder(left: string[], right: string[]): boolean {
  return left.length === right.length &&
    left.every((id, index) => id === right[index]);
}

function normalizeActiveCpuThreshold(value: number): number {
  if (!Number.isFinite(value)) {
    return activeCpuThresholdDefault;
  }

  return Math.min(100, Math.max(0, Number(value.toFixed(2))));
}

function formatThresholdPercent(value: number): string {
  return `${trimTrailingZeros(value.toFixed(2))}%`;
}

function buildCaptureDraft(
  template: EnvironmentTemplate | null,
  vm: VmInstance,
): CaptureDraft {
  if (template) {
    return {
      mode: "existing",
      templateId: template.id,
      name: template.name,
      description: template.description,
    };
  }

  return {
    mode: "new",
    templateId: "",
    name: `Captured ${vm.name}`,
    description: `Captured from workspace ${vm.name}.`,
  };
}

function formatTemplateProvenanceKindLabel(
  kind: NonNullable<EnvironmentTemplate["provenance"]>["kind"],
): string {
  switch (kind) {
    case "seed":
      return "Seed";
    case "cloned":
      return "Clone";
    case "captured":
      return "Captured";
    case "recovered":
      return "Recovered";
  }
}

function resolveRecentTemplateSnapshots(
  template: EnvironmentTemplate,
  snapshots: Snapshot[],
  limit: number,
): Snapshot[] {
  const snapshotIds = new Set(template.snapshotIds);

  return snapshots
    .filter((snapshot) => snapshotIds.has(snapshot.id))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, limit);
}

function formatVmFileEntryKindLabel(kind: VmFileEntry["kind"]): string {
  switch (kind) {
    case "directory":
      return "Directory";
    case "file":
      return "File";
    case "symlink":
      return "Symlink";
    case "other":
    default:
      return "Other";
  }
}

function formatVmFileSize(sizeBytes: number | null): string {
  if (sizeBytes === null) {
    return "n/a";
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${trimTrailingZeros((sizeBytes / 1024).toFixed(1))} KB`;
  }

  return `${trimTrailingZeros((sizeBytes / (1024 * 1024)).toFixed(1))} MB`;
}

function isDiskUsageAlert(snapshot: VmDiskUsageSnapshot): boolean {
  return snapshot.status === "warning" || snapshot.status === "critical";
}

function diskUsageChipLabel(snapshot: VmDiskUsageSnapshot): string {
  switch (snapshot.status) {
    case "warning":
      return "Disk low";
    case "critical":
      return "Disk critical";
    default:
      return "Disk notice";
  }
}

function diskUsageSummaryText(snapshot: VmDiskUsageSnapshot): string {
  const focus = resolveDiskUsageFocus(snapshot);

  if (!focus || focus.availableBytes === null) {
    return snapshot.detail;
  }

  const subject = focus.path === "/" ? "root filesystem" : focus.path;
  return `${formatBytes(focus.availableBytes)} free on ${subject}`;
}

function resolveDiskUsageFocus(
  snapshot: VmDiskUsageSnapshot,
): VmDiskUsageSnapshot["root"] {
  if (!snapshot.root) {
    return snapshot.workspace;
  }

  if (!snapshot.workspace) {
    return snapshot.root;
  }

  const rootAvailable = snapshot.root.availableBytes ?? Number.POSITIVE_INFINITY;
  const workspaceAvailable = snapshot.workspace.availableBytes ?? Number.POSITIVE_INFINITY;
  return workspaceAvailable <= rootAvailable ? snapshot.workspace : snapshot.root;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return "Unknown";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 ** 2) {
    return `${trimTrailingZeros((value / 1024).toFixed(1))} KiB`;
  }

  if (value < 1024 ** 3) {
    return `${trimTrailingZeros((value / (1024 ** 2)).toFixed(1))} MiB`;
  }

  if (value < 1024 ** 4) {
    return `${trimTrailingZeros((value / (1024 ** 3)).toFixed(1))} GiB`;
  }

  return `${trimTrailingZeros((value / (1024 ** 4)).toFixed(1))} TiB`;
}

function formatVmFileEntryMeta(entry: VmFileEntry): string {
  const sizeLabel = formatVmFileSize(entry.sizeBytes);
  const kindLabel = formatVmFileEntryKindLabel(entry.kind);
  return entry.kind === "directory" ? kindLabel : `${kindLabel} · ${sizeLabel}`;
}

function formatVmFileBrowserRowMeta(entry: VmFileEntry): string | null {
  switch (entry.kind) {
    case "directory":
      return null;
    case "file":
      return formatVmFileSize(entry.sizeBytes);
    case "symlink":
      return "symlink";
    case "other":
      return "other";
  }
}

function formatVmFileBrowserKindToken(kind: VmFileEntry["kind"]): string {
  switch (kind) {
    case "directory":
      return "dir";
    case "file":
      return "file";
    case "symlink":
      return "link";
    case "other":
      return "other";
  }
}

function buildVmFileBrowserBreadcrumbs(
  currentPath: string,
): Array<{ label: string; path: string }> {
  if (currentPath === "/") {
    return [{ label: "/", path: "/" }];
  }

  let path = "";
  return [
    { label: "/", path: "/" },
    ...currentPath.split("/").filter(Boolean).map((segment) => {
      path = `${path}/${segment}`;
      return {
        label: segment,
        path,
      };
    }),
  ];
}

function buildVmFileBrowserEntryTitle(entry: VmFileEntry): string {
  const lines = [entry.path];

  if (entry.kind === "file") {
    lines.push(`Size: ${formatVmFileSize(entry.sizeBytes)}`);
  }

  if (entry.modifiedAt) {
    lines.push(`Modified: ${formatTimestamp(entry.modifiedAt)}`);
  }

  return lines.join("\n");
}

function buildVmFileDownloadHref(vmId: string, path: string): string {
  return `/api/vms/${encodeURIComponent(vmId)}/files/download?path=${encodeURIComponent(path)}`;
}

function formatTouchedFileRowMeta(entry: VmTouchedFile): string {
  const reasonsLabel = entry.reasons.map(formatTouchedFileReasonLabel).join(", ");

  if (entry.kind === "file") {
    return `${reasonsLabel} · ${formatVmFileSize(entry.sizeBytes)}`;
  }

  return reasonsLabel;
}

function buildTouchedFileEntryTitle(entry: VmTouchedFile): string {
  const lines = [
    entry.path,
    `Reasons: ${entry.reasons.map(formatTouchedFileReasonLabel).join(", ")}`,
  ];

  if (entry.kind === "file") {
    lines.push(`Size: ${formatVmFileSize(entry.sizeBytes)}`);
  }

  if (entry.modifiedAt) {
    lines.push(`Modified: ${formatTimestamp(entry.modifiedAt)}`);
  }

  if (entry.changedAt) {
    lines.push(`Changed: ${formatTimestamp(entry.changedAt)}`);
  }

  return lines.join("\n");
}

function formatTouchedFileReasonLabel(reason: VmTouchedFilesSnapshot["entries"][number]["reasons"][number]): string {
  switch (reason) {
    case "mtime":
      return "mtime";
    case "ctime":
      return "ctime";
    case "command-history":
      return "command history";
  }
}

function buildForwardBrowserHref(forward: VmPortForward): string {
  if (!forward.publicHostname || typeof window === "undefined") {
    return forward.publicPath;
  }

  const current = new URL(window.location.href);
  current.hostname = forward.publicHostname;
  current.pathname = "/";
  current.search = "";
  current.hash = "";
  return current.toString();
}

function toTemplatePortForward(forward: VmPortForward): TemplatePortForward {
  return {
    name: forward.name,
    guestPort: forward.guestPort,
    protocol: forward.protocol,
    description: forward.description,
  };
}

function persistenceBackendLabel(kind: HealthStatus["persistence"]["kind"]): string {
  return kind === "postgres" ? "PostgreSQL" : "JSON file";
}

function persistenceStatusLabel(persistence: HealthStatus["persistence"]): string {
  return persistence.status === "ready" ? "Ready" : "Degraded";
}

function persistenceChipLabel(persistence: HealthStatus["persistence"]): string {
  return `${persistenceBackendLabel(persistence.kind)} ${persistenceStatusLabel(persistence)}`;
}

function persistenceLocationLabel(persistence: HealthStatus["persistence"]): string {
  if (persistence.kind === "json") {
    return persistence.dataFile ?? "Unknown JSON path";
  }

  return persistence.databaseConfigured
    ? "Database URL configured"
    : "Database URL missing";
}

function incusStorageStatusLabel(incusStorage: NonNullable<HealthStatus["incusStorage"]>): string {
  switch (incusStorage.status) {
    case "ready":
      return "Ready";
    case "warning":
      return "Needs attention";
    case "unavailable":
    default:
      return "Unavailable";
  }
}

function incusStorageChipLabel(incusStorage: NonNullable<HealthStatus["incusStorage"]>): string {
  return `Incus storage ${incusStorageStatusLabel(incusStorage)}`;
}

function incusStoragePoolLabel(incusStorage: NonNullable<HealthStatus["incusStorage"]>): string {
  return (
    incusStorage.selectedPool ??
    incusStorage.defaultProfilePool ??
    (incusStorage.configuredPool ? `${incusStorage.configuredPool} (missing)` : "Unpinned")
  );
}

function providerStatusTitle(provider: DashboardSummary["provider"]): string {
  const status =
    provider.hostStatus === "ready"
      ? "Ready"
      : provider.hostStatus === "network-unreachable"
        ? "Internet unreachable"
      : provider.hostStatus === "missing-cli"
        ? "CLI missing"
        : provider.hostStatus === "daemon-unreachable"
          ? "Daemon unreachable"
          : provider.hostStatus === "daemon-conflict"
            ? "Daemon conflict"
          : "Error";

  return `${capitalizeWord(provider.kind)} ${status}. ${provider.detail}`;
}

function providerStatusDotClassName(provider: DashboardSummary["provider"]): string {
  switch (provider.hostStatus) {
    case "ready":
      return "workspace-rail__status-dot--ready";
    case "network-unreachable":
    case "missing-cli":
    case "daemon-unreachable":
      return "workspace-rail__status-dot--warning";
    case "daemon-conflict":
      return "workspace-rail__status-dot--error";
    default:
      return "workspace-rail__status-dot--error";
  }
}

function findProminentJob(
  summary: DashboardSummary,
  selectedVmId: string | null,
): {
  activeCount: number;
  job: DashboardSummary["jobs"][number];
  vmName: string;
} | null {
  const activeJobs = summary.jobs.filter(isActiveJob);

  if (activeJobs.length === 0) {
    return null;
  }

  const job =
    activeJobs.find((entry) => entry.targetVmId === selectedVmId) ?? activeJobs[0];
  const vmName =
    summary.vms.find((vm) => vm.id === job.targetVmId)?.name ??
    (job.targetVmId ? job.targetVmId : "System");

  return {
    activeCount: activeJobs.length,
    job,
    vmName,
  };
}

function isActiveJob(job: DashboardSummary["jobs"][number]): boolean {
  return job.status === "queued" || job.status === "running";
}

function pruneDismissedProminentJobIds(
  dismissedJobIds: Record<string, true>,
  jobs: DashboardSummary["jobs"] | null | undefined,
): Record<string, true> {
  const dismissedIds = Object.keys(dismissedJobIds);

  if (dismissedIds.length === 0) {
    return dismissedJobIds;
  }

  const activeJobIds = new Set((jobs ?? []).filter(isActiveJob).map((job) => job.id));
  let changed = false;
  const next: Record<string, true> = {};

  for (const jobId of dismissedIds) {
    if (!activeJobIds.has(jobId)) {
      changed = true;
      continue;
    }

    next[jobId] = true;
  }

  return changed ? next : dismissedJobIds;
}

function formatJobKindLabel(kind: DashboardSummary["jobs"][number]["kind"]): string {
  switch (kind) {
    case "launch-snapshot":
      return "Launch snapshot";
    case "restore-snapshot":
      return "Restore snapshot";
    case "capture-template":
      return "Capture template";
    case "inject-command":
      return "Run command";
    default:
      return `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
  }
}

function isDesktopBootJobKind(kind: DashboardSummary["jobs"][number]["kind"]): boolean {
  return (
    kind === "create" ||
    kind === "clone" ||
    kind === "launch-snapshot" ||
    kind === "start" ||
    kind === "restart"
  );
}

function formatActiveJobTiming(
  job: Pick<DashboardSummary["jobs"][number], "createdAt">,
  nowMs = Date.now(),
): string | null {
  const createdAt = Date.parse(job.createdAt);

  if (!Number.isFinite(createdAt)) {
    return null;
  }

  const elapsedMs = Math.max(0, nowMs - createdAt);
  return `Elapsed ${formatDurationShort(elapsedMs)}`;
}

function formatDurationShort(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return minutes > 0
      ? `${hours}h ${minutes}m`
      : `${hours}h`;
  }

  if (minutes > 0) {
    return seconds > 0
      ? `${minutes}m ${seconds}s`
      : `${minutes}m`;
  }

  return `${seconds}s`;
}

interface DesktopBootState {
  label: string;
  message: string;
  progressPercent: number | null;
  timingCopy: string | null;
}

function getVmDesktopBootState(
  detail: VmDetail,
  nowMs = Date.now(),
): DesktopBootState | null {
  const failedBootJob = detail.recentJobs.find(
    (job) => isDesktopBootJobKind(job.kind) && job.status === "failed",
  );

  if (failedBootJob) {
    return null;
  }

  const activeJob = detail.recentJobs.find(
    (job) =>
      isDesktopBootJobKind(job.kind) &&
      (job.status === "queued" || job.status === "running"),
  );

  if (!activeJob && detail.vm.status !== "creating") {
    return null;
  }

  if (activeJob?.kind === "start" || activeJob?.kind === "restart") {
    return {
      label: activeJob.kind === "restart" ? "Restarting workspace" : "Booting workspace",
      message:
        activeJob.message ||
        (activeJob.kind === "restart"
          ? "Restarting the VM and waiting for the desktop."
          : "Starting the VM and waiting for the desktop."),
      progressPercent: activeJob.progressPercent ?? null,
      timingCopy: formatActiveJobTiming(activeJob, nowMs),
    };
  }

  if (activeJob?.kind === "clone") {
    return {
      label: "Cloning workspace",
      message: activeJob.message || "Cloning the workspace and preparing the desktop.",
      progressPercent: activeJob.progressPercent ?? null,
      timingCopy: formatActiveJobTiming(activeJob, nowMs),
    };
  }

  if (activeJob?.kind === "launch-snapshot") {
    return {
      label: "Launching snapshot",
      message:
        activeJob.message || "Launching the workspace from a snapshot and waiting for the desktop.",
      progressPercent: activeJob.progressPercent ?? null,
      timingCopy: formatActiveJobTiming(activeJob, nowMs),
    };
  }

  return {
    label: "Creating workspace",
    message: activeJob?.message || "Provisioning the VM and waiting for the desktop.",
    progressPercent: activeJob?.progressPercent ?? null,
    timingCopy: activeJob ? formatActiveJobTiming(activeJob, nowMs) : null,
  };
}

function desktopFallbackBadge(detail: VmDetail): string {
  const failedBootJob = detail.recentJobs.find(
    (job) => isDesktopBootJobKind(job.kind) && job.status === "failed",
  );

  if (failedBootJob) {
    return "Launch failed";
  }

  if (detail.provider.desktopTransport === "synthetic" || detail.vm.session?.kind === "synthetic") {
    return "Synthetic preview";
  }

  if (detail.vm.status !== "running") {
    return `${capitalizeWord(detail.vm.status)} desktop`;
  }

  return "Waiting for guest VNC";
}

function hasBrowserDesktopSession(session: VmInstance["session"] | null | undefined): boolean {
  return session?.kind === "vnc" && Boolean(session.webSocketPath);
}

function shouldShowWorkspaceLogsSurface(detail: VmDetail): boolean {
  return detail.provider.desktopTransport === "novnc" &&
    detail.vm.status === "running" &&
    !hasBrowserDesktopSession(detail.vm.session);
}

function workspaceLogsTitle(detail: VmDetail): string {
  const failedBootJob = detail.recentJobs.find(
    (job) => isDesktopBootJobKind(job.kind) && job.status === "failed",
  );

  return failedBootJob ? "Desktop bridge failed" : "Waiting for guest VNC";
}

function workspaceLogsMessage(detail: VmDetail): string {
  const failedBootJob = detail.recentJobs.find(
    (job) => isDesktopBootJobKind(job.kind) && job.status === "failed",
  );

  if (failedBootJob) {
    return `${failedBootJob.message} Showing the latest guest logs while the running VM stays attached to the host.`;
  }

  return "This VM is running, but the browser VNC bridge is not ready yet. Showing the latest guest logs until the desktop attaches.";
}

function desktopFallbackMessage(detail: VmDetail): string {
  const failedBootJob = detail.recentJobs.find(
    (job) => isDesktopBootJobKind(job.kind) && job.status === "failed",
  );

  if (failedBootJob) {
    return failedBootJob.message;
  }

  if (detail.provider.desktopTransport === "synthetic" || detail.vm.session?.kind === "synthetic") {
    return "This server is running the mock provider, so the dashboard renders generated desktop frames instead of a live browser VNC session.";
  }

  if (detail.vm.status !== "running") {
    return "Start the VM to attach a browser desktop.";
  }

  return "This VM does not have a browser VNC session yet. The synthetic frame stays here until the guest publishes a reachable desktop endpoint.";
}

function workspaceFallbackTitle(detail: VmDetail): string {
  if (detail.provider.desktopTransport === "synthetic" || detail.vm.session?.kind === "synthetic") {
    return "Synthetic desktop preview";
  }

  if (detail.vm.status !== "running") {
    return "Desktop offline";
  }

  return "Desktop not attached";
}

function vmTilePreviewLabel(vm: VmInstance, showLivePreview: boolean): string {
  if (vm.session?.kind === "synthetic") {
    return "Synthetic preview";
  }

  if (vm.status !== "running") {
    return capitalizeWord(vm.status);
  }

  if (showLivePreview) {
    return "Waiting for VNC";
  }

  return "Static preview";
}

function capitalizeWord(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildPatternStyle(seed: number): CSSProperties {
  return {
    "--pattern-x": `${12 + (seed % 58)}%`,
    "--pattern-y": `${10 + ((seed * 3) % 62)}%`,
    "--pattern-tilt-a": `${-18 + (seed % 24)}deg`,
    "--pattern-tilt-b": `${8 + ((seed * 5) % 18)}deg`,
    "--pattern-shift": `${(seed * 7) % 160}px`,
  } as CSSProperties;
}

function statusClassName(status: VmStatus): string {
  switch (status) {
    case "running":
      return "status-badge--running";
    case "stopped":
      return "status-badge--stopped";
    case "creating":
      return "status-badge--creating";
    case "deleting":
      return "status-badge--deleting";
    case "error":
      return "status-badge--error";
    default:
      return "status-badge--default";
  }
}

function noticeToneClassName(tone: Notice["tone"]): string {
  switch (tone) {
    case "error":
      return "notice-bar--error";
    case "success":
      return "notice-bar--success";
    default:
      return "notice-bar--info";
  }
}

function readThemeMode(): ThemeMode {
  const stored = readStoredString("parallaize.theme");

  if (stored === "light" || stored === "dark") {
    return stored;
  }

  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }

  return "light";
}

function readFullscreenActive(): boolean {
  return typeof document !== "undefined" && document.fullscreenElement !== null;
}

function fullscreenKeyboardLock():
  | {
      lock: (keyCodes?: string[]) => Promise<void>;
      unlock: () => void;
    }
  | null {
  if (typeof navigator === "undefined") {
    return null;
  }

  const keyboard = (
    navigator as Navigator & {
      keyboard?: {
        lock?: (keyCodes?: string[]) => Promise<void>;
        unlock?: () => void;
      };
    }
  ).keyboard;

  if (!keyboard || typeof keyboard.lock !== "function" || typeof keyboard.unlock !== "function") {
    return null;
  }

  return {
    lock: keyboard.lock.bind(keyboard),
    unlock: keyboard.unlock.bind(keyboard),
  };
}

async function syncFullscreenKeyboardLock(): Promise<void> {
  if (typeof document === "undefined") {
    return;
  }

  const keyboard = fullscreenKeyboardLock();

  if (!keyboard) {
    return;
  }

  if (!document.fullscreenElement) {
    keyboard.unlock();
    return;
  }

  try {
    await keyboard.lock(["Escape"]);
  } catch {
    keyboard.unlock();
  }
}

function releaseFullscreenKeyboardLock(): void {
  fullscreenKeyboardLock()?.unlock();
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  const stored = readStoredString(key);

  if (stored === "true") {
    return true;
  }

  if (stored === "false") {
    return false;
  }

  return fallback;
}

function readStoredNumber(key: string): number | null {
  const stored = readStoredString(key);

  if (!stored) {
    return null;
  }

  const value = Number(stored);

  return Number.isFinite(value) ? value : null;
}

function readStoredString(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function clearStoredString(key: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore persistence failures and keep the session usable.
  }
}

function readDocumentVisible(): boolean {
  return typeof document === "undefined" ? true : document.visibilityState === "visible";
}

function readOrCreateResolutionControlClientId(): string {
  const existing = readStoredString(resolutionControlClientIdStorageKey)?.trim();

  if (existing) {
    return existing;
  }

  const clientId = `client-${createTabId()}`;
  writeStoredString(resolutionControlClientIdStorageKey, clientId);
  return clientId;
}

function createTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function claimResolutionControlLease(
  vmId: string,
  tabId: string,
  force = false,
): ResolutionControlOwner {
  if (typeof window === "undefined") {
    return "self";
  }

  const key = buildResolutionControlLeaseStorageKey(vmId);
  const now = Date.now();
  const existingLease = parseResolutionControlLease(readStoredString(key));

  if (
    !force &&
    !canClaimResolutionControlLease({
      lease: existingLease,
      now,
      tabId,
      ttlMs: resolutionControlLeaseTtlMs,
      vmId,
    })
  ) {
    return "other";
  }

  writeStoredString(key, JSON.stringify(createResolutionControlLease(vmId, tabId, now)));
  const confirmedLease = parseResolutionControlLease(readStoredString(key));

  return confirmedLease?.tabId === tabId ? "self" : "other";
}

function releaseResolutionControlLease(vmId: string, tabId: string): void {
  const key = buildResolutionControlLeaseStorageKey(vmId);
  const existingLease = parseResolutionControlLease(readStoredString(key));

  if (!existingLease || existingLease.tabId !== tabId) {
    return;
  }

  clearStoredString(key);
}

function readSidepanelCollapsedByVm(): Record<string, true> {
  const stored = readStoredString(sidepanelCollapsedByVmStorageKey);

  if (!stored) {
    return {};
  }

  try {
    const parsed = JSON.parse(stored) as Record<string, unknown>;

    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([vmId, collapsed]) => vmId.length > 0 && collapsed === true,
      ),
    ) as Record<string, true>;
  } catch {
    return {};
  }
}

function readActiveCpuThresholdsByVm(): Record<string, number> {
  const stored = readStoredString(activeCpuThresholdsByVmStorageKey);

  if (!stored) {
    return {};
  }

  try {
    const parsed = JSON.parse(stored) as Record<string, unknown>;

    return Object.fromEntries(
      Object.entries(parsed)
        .map(([vmId, threshold]) => {
          if (vmId.length === 0 || typeof threshold !== "number" || !Number.isFinite(threshold)) {
            return null;
          }

          return [vmId, normalizeActiveCpuThreshold(threshold)];
        })
        .filter((entry): entry is [string, number] => entry !== null),
    );
  } catch {
    return {};
  }
}

function readDesktopResolutionByVm(): Record<string, DesktopResolutionPreference> {
  const stored = readStoredString(desktopResolutionByVmStorageKey);

  if (!stored) {
    return {};
  }

  try {
    const parsed = JSON.parse(stored) as Record<string, Partial<DesktopResolutionPreference>>;

    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([vmId]) => vmId.length > 0)
        .map(([vmId, preference]) => [vmId, normalizeDesktopResolutionPreference(preference)]),
    );
  } catch {
    return {};
  }
}

function writeStoredString(key: string, value: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore persistence failures and keep the session usable.
  }
}

function readViewportWidth(): number {
  return typeof window === "undefined" ? 1440 : window.innerWidth;
}

function buildResolutionDraft(
  mode: DesktopResolutionMode,
  scale: number,
  width: number,
  height: number,
): ResolutionDraft {
  return {
    mode,
    scale: formatViewportScale(scale),
    width: String(width),
    height: String(height),
  };
}

function normalizeGuestDisplayResolution(
  width: number,
  height: number,
): SetVmResolutionInput {
  const roundedWidth = Math.round(width);
  const roundedHeight = Math.round(height);
  const alignedWidth =
    Math.round(roundedWidth / guestDisplayWidthStep) * guestDisplayWidthStep;

  return {
    width: Math.min(
      guestDisplayWidthMax,
      Math.max(guestDisplayWidthMin, alignedWidth),
    ),
    height: Math.min(
      guestDisplayHeightMax,
      Math.max(guestDisplayHeightMin, roundedHeight),
    ),
  };
}

function buildDesktopResolutionTarget(
  vmId: string,
  width: number,
  height: number,
): DesktopResolutionTarget {
  const normalized = normalizeGuestDisplayResolution(width, height);

  return {
    height: normalized.height,
    key: buildDesktopResolutionRequestKey(vmId, normalized.width, normalized.height),
    vmId,
    width: normalized.width,
  };
}

function normalizeDesktopResolutionPreference(
  preference: Partial<DesktopResolutionPreference>,
): DesktopResolutionPreference {
  const mode = preference.mode === "fixed" ? "fixed" : "viewport";
  const normalizedFixedResolution = normalizeGuestDisplayResolution(
    clampDesktopFixedWidth(preference.width ?? desktopFixedWidthDefault),
    clampDesktopFixedHeight(preference.height ?? desktopFixedHeightDefault),
  );
  return {
    mode,
    scale: clampDesktopViewportScale(preference.scale ?? desktopViewportScaleDefault),
    width: normalizedFixedResolution.width,
    height: normalizedFixedResolution.height,
  };
}

function buildDesktopResolutionRequestKey(
  vmId: string,
  width: number,
  height: number,
): string {
  return `${vmId}:${width}x${height}`;
}

function clampRailWidthPreference(width: number): number {
  const roundedWidth = Math.round(width);

  if (roundedWidth <= railCompactSnapWidth) {
    return railCompactWidth;
  }

  return Math.min(railMaxWidth, Math.max(railExpandedMinWidth, roundedWidth));
}

function clampDisplayedRailWidth(
  width: number,
  viewportWidth: number,
  sidepanelWidth: number,
): number {
  const maxWidth = maxDisplayedRailWidth(viewportWidth, sidepanelWidth);
  const preferredWidth = clampRailWidthPreference(width);

  if (preferredWidth <= railCompactWidth || maxWidth < railExpandedMinWidth) {
    return railCompactWidth;
  }

  return Math.min(preferredWidth, maxWidth);
}

function maxDisplayedRailWidth(viewportWidth: number, sidepanelWidth: number): number {
  return Math.max(
    railCompactWidth,
    Math.min(railMaxWidth, viewportWidth - Math.min(sidepanelWidth, sidepanelDefaultWidth) - 560),
  );
}

function clampDesktopFixedWidth(width: number): number {
  return Math.min(
    desktopFixedWidthMax,
    Math.max(desktopFixedWidthMin, Math.round(width)),
  );
}

function clampDesktopViewportScale(scale: number): number {
  if (!Number.isFinite(scale)) {
    return desktopViewportScaleDefault;
  }

  const rounded = Math.round(scale / desktopViewportScaleStep) * desktopViewportScaleStep;
  return Math.min(
    desktopViewportScaleMax,
    Math.max(desktopViewportScaleMin, Number(rounded.toFixed(2))),
  );
}

function clampDesktopFixedHeight(height: number): number {
  return Math.min(
    desktopFixedHeightMax,
    Math.max(desktopFixedHeightMin, Math.round(height)),
  );
}

function scaleViewportResolutionValue(
  value: number | null,
  scale: number,
): number | null {
  if (value === null) {
    return null;
  }

  return Math.max(1, Math.round(value * scale));
}

function formatViewportScale(scale: number): string {
  const normalized = clampDesktopViewportScale(scale);
  return normalized % 1 === 0 ? normalized.toFixed(0) : normalized.toFixed(2).replace(/0$/, "");
}

function clampSidepanelWidthPreference(width: number): number {
  const roundedWidth = Math.round(width);

  if (roundedWidth <= sidepanelCollapseSnapWidth) {
    return sidepanelClosedWidth;
  }

  return Math.min(sidepanelMaxWidth, Math.max(sidepanelMinWidth, roundedWidth));
}

function clampDisplayedSidepanelWidth(width: number, viewportWidth: number): number {
  return Math.min(
    clampSidepanelWidthPreference(width),
    maxDisplayedSidepanelWidth(viewportWidth),
  );
}

function maxDisplayedSidepanelWidth(viewportWidth: number): number {
  return Math.max(
    sidepanelMinWidth,
    Math.min(sidepanelMaxWidth, viewportWidth - 640),
  );
}

function defaultSnapshotLaunchName(vm: VmInstance, snapshot: Snapshot): string {
  const slug = snapshot.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);

  return `${vm.name}-${slug || "snapshot"}`;
}

function formatCurrentResolution(state: DesktopResolutionState): string {
  if (state.remoteWidth !== null && state.remoteHeight !== null) {
    return `${state.remoteWidth} x ${state.remoteHeight}`;
  }

  return "Waiting for live desktop";
}

function formatViewportResolution(state: DesktopResolutionState): string {
  if (state.clientWidth !== null && state.clientHeight !== null) {
    return `${state.clientWidth} x ${state.clientHeight}`;
  }

  return "Unavailable";
}

function formatTargetResolution(
  draft: ResolutionDraft,
  state: DesktopResolutionState,
): string {
  if (draft.mode === "fixed") {
    const width = Number(draft.width);
    const height = Number(draft.height);

    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return "Enter width and height";
    }

    const normalized = normalizeGuestDisplayResolution(
      clampDesktopFixedWidth(width),
      clampDesktopFixedHeight(height),
    );

    return `${normalized.width} x ${normalized.height}`;
  }

  const scale = clampDesktopViewportScale(Number(draft.scale));
  const rawWidth = scaleViewportResolutionValue(state.clientWidth, scale);
  const rawHeight = scaleViewportResolutionValue(state.clientHeight, scale);

  if (rawWidth !== null && rawHeight !== null) {
    const normalized = normalizeGuestDisplayResolution(rawWidth, rawHeight);
    return `${normalized.width} x ${normalized.height}`;
  }

  return "Waiting for viewport";
}

function formatTelemetryPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "--" : `${Math.round(value)}%`;
}

function formatRamUsage(usedRamMb: number, totalRamMb: number): string {
  if (totalRamMb <= 0) {
    return formatRam(usedRamMb);
  }

  if (usedRamMb >= 1024 && totalRamMb >= 1024) {
    const used = (usedRamMb / 1024).toFixed(usedRamMb % 1024 === 0 ? 0 : 1);
    const total = (totalRamMb / 1024).toFixed(totalRamMb % 1024 === 0 ? 0 : 1);
    return `${used}/${total} GB`;
  }

  return `${usedRamMb}/${totalRamMb} MB`;
}

function formatDiskUsage(usedDiskGb: number, totalDiskGb: number): string {
  if (totalDiskGb <= 0) {
    return `${usedDiskGb} GB`;
  }

  return `${usedDiskGb}/${totalDiskGb} GB`;
}

function formatUsageCount(used: number, total: number): string {
  if (total <= 0) {
    return String(used);
  }

  return `${used}/${total}`;
}

function buildSparklinePoints(
  values: number[],
  width: number,
  height: number,
): string {
  if (values.length <= 1) {
    const y = Math.round((1 - values[0] / 100) * (height - 2)) + 1;
    return `1,${y} ${width - 1},${y}`;
  }

  const step = (width - 2) / (values.length - 1);

  return values
    .map((value, index) => {
      const x = Math.round(1 + (step * index) * 100) / 100;
      const y = Math.round((1 - value / 100) * (height - 2) + 1);
      return `${x},${y}`;
    })
    .join(" ");
}

function joinClassNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function buildLatestReleaseTagUrl(version: string): string {
  return `${githubReleaseTagBaseUrl}${version}`;
}

function isNearScrollBottom(element: HTMLElement): boolean {
  return element.scrollHeight - (element.scrollTop + element.clientHeight) <= 24;
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: {
      accept: "application/json",
    },
  });

  const payload = (await response.json()) as ApiResponse<T>;

  if (response.status === 401) {
    throw new AuthRequiredError();
  }

  if (!response.ok || !payload.ok) {
    throw new Error(payload.ok ? `Request failed with ${response.status}` : payload.error);
  }

  return payload.data;
}

async function postJson<T = unknown, Body = unknown>(path: string, body: Body): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json()) as ApiResponse<T>;

  if (response.status === 401) {
    throw new AuthRequiredError(
      payload.ok ? "Authentication required." : payload.error,
    );
  }

  if (!response.ok || !payload.ok) {
    throw new Error(payload.ok ? `Request failed with ${response.status}` : payload.error);
  }

  return payload.data;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

class AuthRequiredError extends Error {
  constructor(message = "Authentication required.") {
    super(message);
    this.name = "AuthRequiredError";
  }
}
