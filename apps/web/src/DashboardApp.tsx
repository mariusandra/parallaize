import {
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
} from "react";

declare const __PARALLAIZE_VERSION__: string;

import { formatResources, formatTimestamp } from "../../../packages/shared/src/helpers.js";
import type {
  AuthStatus,
  CaptureTemplateInput,
  CreateTemplateInput,
  CreateVmInput,
  DashboardSummary,
  EnvironmentTemplate,
  HealthStatus,
  InjectCommandInput,
  ReorderVmsInput,
  ResizeVmInput,
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
  VmInstance,
  LatestReleaseMetadata,
  VmNetworkMode,
  VmPowerAction,
  VmResolutionControlSnapshot,
  VmTouchedFilesSnapshot,
} from "../../../packages/shared/src/types.js";
import {
  applyViewportBoundsToResolution,
  buildResolutionControlLeaseStorageKey,
  emptyResolutionRequestQueue,
  emptyViewportBounds,
  enqueueResolutionRequest,
  resolveResolutionRequest,
  shouldScheduleResolutionRepair,
  type ResolutionRequest,
  type ViewportBounds,
} from "./desktopResolution.js";
import {
  canUseDeferredIdentifiedCollection,
  orderIdentifiedCollectionByIds,
} from "./deferredCollections.js";
import {
  hasBrowserVncSession,
  mergeSelectedVmDetail,
  resolveDisplayedDesktopSession,
  resolveSelectedDesktopSession,
  shouldRefreshSelectedVmDetail,
  type RetainedDesktopSession,
} from "./desktopSession.js";
import { NoVncViewport } from "./NoVncViewport.js";
import {
  appPackageReleaseLabel,
  classifyAvailableRelease,
  hasNewerReleaseAvailable,
} from "./releaseVersion.js";
import { buildRandomVmName } from "./vmNames.js";
import {
  activeCpuThresholdDefault,
  buildCaptureDraft,
  buildCreateDraftFromSource,
  buildCreateDraftFromSnapshot,
  buildCreateDraftFromTemplate,
  buildCreateDraftFromVm,
  buildCreateLaunchValidationError,
  buildCreateSourceGroups,
  buildForwardBrowserHref,
  buildTemplateCloneDraft,
  buildTemplateEditDraft,
  buildTouchedFileEntryTitle,
  buildVmFileBrowserBreadcrumbs,
  buildVmFileBrowserEntryTitle,
  buildVmFileDownloadHref,
  describeVmNetworkMode,
  desktopFallbackBadge,
  desktopFallbackMessage,
  findProminentJob,
  formatActiveJobTiming,
  formatJobKindLabel,
  formatRamDraftValue,
  formatTemplateProvenanceKindLabel,
  formatTouchedFileRowMeta,
  formatVmFileBrowserKindToken,
  formatVmFileBrowserRowMeta,
  formatVmNetworkModeLabel,
  getVmDesktopBootState,
  incusStorageChipLabel,
  incusStoragePoolLabel,
  incusStorageStatusLabel,
  isDiskUsageAlert,
  normalizeActiveCpuThreshold,
  normalizeVmNetworkMode,
  parseInitCommandsDraft,
  parseRamDraftValue,
  persistenceBackendLabel,
  persistenceChipLabel,
  persistenceLocationLabel,
  persistenceStatusLabel,
  providerStatusDotClassName,
  providerStatusTitle,
  pruneDismissedProminentJobIds,
  reorderVmIds,
  resolveCreateSourceSelection,
  resolveRecentTemplateSnapshots,
  sameIdOrder,
  shouldShowWorkspaceLogsSurface,
  syncCreateDraft,
  toTemplatePortForward,
  workspaceFallbackTitle,
  workspaceLogsMessage,
  workspaceLogsTitle,
  diskUsageChipLabel,
  diskUsageSummaryText,
  firstCreateSourceSelection,
  type CaptureDraft,
  type CreateDraft,
  type DesktopBootState,
  type TemplateCloneDraft,
  type TemplateEditDraft,
} from "./dashboardHelpers.js";
import {
  CloneVmDialog,
  CreateVmDialog,
  RenameDialog,
  TemplateCloneDialog,
  TemplateEditDialog,
  VmLogsDialog,
} from "./dashboardDialogs.js";
import { LoadingShell, LoginShell, MiniStat } from "./dashboardPrimitives.js";
import { RailCreateIcon, RailHomeIcon, RailSettingsIcon, VmTile } from "./dashboardRail.js";
import {
  formatRamUsage,
  formatTelemetryPercent,
  joinClassNames,
  PortalPopover,
  statusClassName,
  TelemetryPanel,
} from "./dashboardUi.js";
import {
  OverviewSidepanel,
  RailResizeHandle,
  WorkspaceSidepanel,
} from "./dashboardSidepanel.js";
import {
  EmptyWorkspaceStage,
  WorkspaceBootSurface,
  WorkspaceControlLockOverlay,
  WorkspaceFallbackSurface,
  WorkspaceLogsSurface,
} from "./dashboardStage.js";
import {
  buildDesktopResolutionRequestKey,
  buildDesktopResolutionTarget,
  buildResolutionDraft,
  clampDesktopFixedHeight,
  clampDesktopFixedWidth,
  clampDesktopViewportScale,
  clampDisplayedRailWidth,
  clampDisplayedSidepanelWidth,
  clampRailWidthPreference,
  defaultDesktopResolutionPreference,
  formatViewportScale,
  liveCaptureWarningCopy,
  noticeToneClassName,
  normalizeDesktopResolutionPreference,
  normalizeGuestDisplayResolution,
  railExpandedMinWidth,
  scaleViewportResolutionValue,
  sameViewportBounds,
  clampSidepanelWidthPreference,
  sidepanelClosedWidth,
  sidepanelCompactBreakpoint,
  sidepanelDefaultWidth,
  sidepanelMaxWidth,
  sidepanelMinWidth,
  desktopResolutionRetryDelayMs,
  desktopResolutionRetryMaxAttempts,
  resolutionControlHeartbeatMs,
  railCompactWidth,
  railDefaultWidth,
  railMaxWidth,
  vmDiskUsagePollIntervalMs,
} from "./dashboardShell.js";
import type {
  CloneVmDialogState,
  DesktopResolutionMode,
  DesktopResolutionPreference,
  DesktopResolutionState,
  DesktopResolutionTarget,
  ForwardDraft,
  LoginDraft,
  Notice,
  PendingManualResolutionSync,
  RenameDialogState,
  ResolutionControlStatus,
  ResolutionDraft,
  ResolutionRetryState,
  ResourceDraft,
  ThemeMode,
  VmLogsDialogState,
  VmLogsViewState,
} from "./dashboardShell.js";
import {
  readFullscreenActive,
  releaseFullscreenKeyboardLock,
  syncFullscreenKeyboardLock,
} from "./dashboardFullscreen.js";
import {
  activeCpuThresholdsByVmStorageKey,
  desktopResolutionByVmStorageKey,
  livePreviewsStorageKey,
  overviewSidepanelCollapsedStorageKey,
  railWidthStorageKey,
  readActiveCpuThresholdsByVm,
  readDesktopResolutionByVm,
  readDocumentVisible,
  readSidepanelCollapsedByVm,
  readStoredBoolean,
  readStoredNumber,
  readThemeMode,
  readViewportWidth,
  sidepanelCollapsedByVmStorageKey,
  sidepanelWidthStorageKey,
  themeModeStorageKey,
  writeStoredString,
} from "./dashboardPersistence.js";
import {
  claimResolutionControlLease,
  createTabId,
  readOrCreateResolutionControlClientId,
  releaseResolutionControlLease,
} from "./dashboardResolutionControl.js";
import {
  AuthRequiredError,
  applyVmLogsAppend,
  errorMessage,
  fetchJson,
  openVmLogsEventSource,
  postJson,
} from "./dashboardTransport.js";

const appVersionLabel = __PARALLAIZE_VERSION__;
const githubReleaseTagBaseUrl = "https://github.com/mariusandra/parallaize/releases/tag/v";

const emptyCreateDraft: CreateDraft = {
  launchSource: "",
  name: "",
  wallpaperName: "",
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
  >(() =>
    readDesktopResolutionByVm((preference) =>
      normalizeDesktopResolutionPreference(
        preference as Partial<DesktopResolutionPreference>,
      ),
    ),
  );
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
  >(() => readActiveCpuThresholdsByVm(normalizeActiveCpuThreshold));
  const [resolutionDraft, setResolutionDraft] = useState<ResolutionDraft>(() =>
    buildResolutionDraft(
      defaultDesktopResolutionPreference.mode,
      defaultDesktopResolutionPreference.scale,
      defaultDesktopResolutionPreference.width,
      defaultDesktopResolutionPreference.height,
    ),
  );
  const [showLivePreviews, setShowLivePreviews] = useState(() =>
    readStoredBoolean(livePreviewsStorageKey, true),
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
  const railResizeFrameRef = useRef<number | null>(null);
  const pendingRailWidthRef = useRef<number | null>(null);
  const sidepanelRef = useRef<HTMLElement | null>(null);
  const sidepanelResizeRef = useRef<{
    anchorClientX: number;
    anchorWidth: number;
    pendingClosedOpen: boolean;
  } | null>(null);
  const sidepanelResizeFrameRef = useRef<number | null>(null);
  const pendingSidepanelWidthRef = useRef<number | null>(null);
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
  const [retainedStageSession, setRetainedStageSession] =
    useState<RetainedDesktopSession | null>(null);

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
  const currentDetail = mergeSelectedVmDetail(selectedVm, detail);
  const currentStageSession = resolveSelectedDesktopSession(selectedVm, currentDetail);
  const currentStageVm = currentDetail?.vm ?? selectedVm ?? null;
  const displayedStageSession = resolveDisplayedDesktopSession(
    currentStageVm,
    currentStageSession,
    retainedStageSession,
  );
  const showWorkspaceLogs =
    currentDetail !== null && shouldShowWorkspaceLogsSurface(currentDetail);
  const liveResolutionVmId =
    currentStageVm?.status === "running" &&
    hasBrowserVncSession(displayedStageSession)
      ? currentStageVm.id
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

  function flushQueuedRailWidthPreference(): void {
    if (railResizeFrameRef.current !== null) {
      window.cancelAnimationFrame(railResizeFrameRef.current);
      railResizeFrameRef.current = null;
    }

    const pendingWidth = pendingRailWidthRef.current;
    pendingRailWidthRef.current = null;

    if (pendingWidth !== null) {
      setRailWidthPreference(pendingWidth);
    }
  }

  function queueRailWidthPreference(nextWidth: number): void {
    pendingRailWidthRef.current = nextWidth;

    if (railResizeFrameRef.current !== null) {
      return;
    }

    railResizeFrameRef.current = window.requestAnimationFrame(() => {
      railResizeFrameRef.current = null;
      const pendingWidth = pendingRailWidthRef.current;
      pendingRailWidthRef.current = null;

      if (pendingWidth !== null) {
        setRailWidthPreference(pendingWidth);
      }
    });
  }

  function flushQueuedSidepanelWidthPreference(): void {
    if (sidepanelResizeFrameRef.current !== null) {
      window.cancelAnimationFrame(sidepanelResizeFrameRef.current);
      sidepanelResizeFrameRef.current = null;
    }

    const pendingWidth = pendingSidepanelWidthRef.current;
    pendingSidepanelWidthRef.current = null;

    if (pendingWidth !== null) {
      setSidepanelWidthPreference(pendingWidth);
    }
  }

  function queueSidepanelWidthPreference(nextWidth: number): void {
    pendingSidepanelWidthRef.current = nextWidth;

    if (sidepanelResizeFrameRef.current !== null) {
      return;
    }

    sidepanelResizeFrameRef.current = window.requestAnimationFrame(() => {
      sidepanelResizeFrameRef.current = null;
      const pendingWidth = pendingSidepanelWidthRef.current;
      pendingSidepanelWidthRef.current = null;

      if (pendingWidth !== null) {
        setSidepanelWidthPreference(pendingWidth);
      }
    });
  }

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

    const selectedSummaryVm =
      summary?.vms.find((entry) => entry.id === selectedVmId) ?? null;
    const shouldFetchDetail =
      !detail ||
      detail.vm.id !== selectedVmId ||
      (selectedSummaryVm &&
        shouldRefreshSelectedVmDetail(selectedSummaryVm, detail, summary?.jobs));

    if (!shouldFetchDetail) {
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
  }, [selectedVmId, summary?.generatedAt, detail?.vm.id, detail?.generatedAt]);

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

    const vmId = vmLogsDialog.vmId;
    setVmLogsDialog((current) =>
      current && current.vmId === vmId
        ? {
            ...current,
            error: null,
            loading: current.logs === null,
            refreshing: current.logs !== null,
          }
        : current,
    );

    return openVmLogsEventSource(vmId, {
      onSnapshot: (logs) => {
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
      },
      onAppend: (appendEvent) => {
        setVmLogsDialog((current) =>
          current && current.vmId === vmId
            ? {
                ...current,
                error: null,
                loading: false,
                logs: applyVmLogsAppend(current.logs, appendEvent),
                refreshing: false,
              }
            : current,
        );
      },
      onStreamError: (message) => {
        setVmLogsDialog((current) =>
          current && current.vmId === vmId
            ? {
                ...current,
                error: message,
                loading: false,
                refreshing: false,
              }
            : current,
        );
      },
      onConnectionError: () => {
        setVmLogsDialog((current) =>
          current && current.vmId === vmId
            ? {
                ...current,
                error: current.logs ? "Live log stream disconnected. Retrying." : current.error,
                loading: current.logs === null,
                refreshing: current.logs !== null,
              }
            : current,
        );
      },
    });
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

    const vmId = currentDetail.vm.id;

    setWorkspaceLogs({
      error: null,
      loading: true,
      logs: null,
      refreshing: false,
    });

    return openVmLogsEventSource(vmId, {
      onSnapshot: (logs) => {
        setWorkspaceLogs({
          error: null,
          loading: false,
          logs,
          refreshing: false,
        });
      },
      onAppend: (appendEvent) => {
        setWorkspaceLogs((current) => ({
          error: null,
          loading: false,
          logs: applyVmLogsAppend(current.logs, appendEvent),
          refreshing: false,
        }));
      },
      onStreamError: (message) => {
        setWorkspaceLogs((current) => ({
          ...current,
          error: message,
          loading: false,
          refreshing: false,
        }));
      },
      onConnectionError: () => {
        setWorkspaceLogs((current) => ({
          ...current,
          error: current.logs ? "Live log stream disconnected. Retrying." : current.error,
          loading: current.logs === null,
          refreshing: current.logs !== null,
        }));
      },
    });
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
    writeStoredString(themeModeStorageKey, themeMode);
  }, [themeMode]);

  useEffect(() => {
    writeStoredString(
      livePreviewsStorageKey,
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
    if (!currentStageVm || currentStageVm.status !== "running") {
      setRetainedStageSession(null);
      return;
    }

    const nextStageSession =
      currentStageSession && hasBrowserVncSession(currentStageSession)
        ? currentStageSession
        : null;

    if (!nextStageSession) {
      return;
    }

    setRetainedStageSession((current) =>
      current?.vmId === currentStageVm.id &&
      current.session?.kind === nextStageSession.kind &&
      current.session?.webSocketPath === nextStageSession.webSocketPath
        ? current
        : {
            vmId: currentStageVm.id,
            session: nextStageSession,
          },
    );
  }, [
    currentStageVm?.id,
    currentStageVm?.status,
    currentStageSession?.kind,
    currentStageSession?.webSocketPath,
  ]);

  useEffect(() => {
    if (
      !currentStageVm ||
      displayedStageSession?.kind !== "vnc" ||
      !displayedStageSession.webSocketPath
    ) {
      setDesktopResolution(emptyResolutionState);
      setAvailableViewportBounds(emptyViewportBounds);
      setObservedViewportBounds(emptyViewportBounds);
    }
  }, [currentStageVm?.id, displayedStageSession?.kind, displayedStageSession?.webSocketPath]);

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
      const nextBounds = {
        height: bounds.height > 0 ? Math.round(bounds.height) : null,
        width: bounds.width > 0 ? Math.round(bounds.width) : null,
      };
      setAvailableViewportBounds((current) =>
        sameViewportBounds(current, nextBounds) ? current : nextBounds,
      );
    }

    reportAvailableBounds();

    const observer = new ResizeObserver(() => {
      reportAvailableBounds();
    });
    observer.observe(observedShellNode);

    return () => {
      observer.disconnect();
      setAvailableViewportBounds((current) =>
        sameViewportBounds(current, emptyViewportBounds) ? current : emptyViewportBounds,
      );
    };
  }, [
    currentStageVm?.id,
    displayedStageSession?.kind,
    displayedStageSession?.webSocketPath,
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
      const nextBounds = {
        height: bounds.height > 0 ? Math.round(bounds.height) : null,
        width: bounds.width > 0 ? Math.round(bounds.width) : null,
      };
      setObservedViewportBounds((current) =>
        sameViewportBounds(current, nextBounds) ? current : nextBounds,
      );
    }

    reportBounds();

    const observer = new ResizeObserver(() => {
      reportBounds();
    });
    observer.observe(observedFrameNode);

    return () => {
      observer.disconnect();
      setObservedViewportBounds((current) =>
        sameViewportBounds(current, emptyViewportBounds) ? current : emptyViewportBounds,
      );
    };
  }, [
    currentStageVm?.id,
    displayedStageSession?.kind,
    displayedStageSession?.webSocketPath,
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
      flushQueuedRailWidthPreference();
      railResizeRef.current = null;
      setRailResizeActive(false);
    }

    function handlePointerMove(event: PointerEvent): void {
      const panelLeft = railResizeRef.current?.panelLeft;

      if (panelLeft === undefined) {
        return;
      }

      queueRailWidthPreference(clampRailWidthPreference(event.clientX - panelLeft));
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
      flushQueuedSidepanelWidthPreference();
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
        queueSidepanelWidthPreference(activatedWidth);
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
      queueSidepanelWidthPreference(nextWidth);
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

  useEffect(() => {
    return () => {
      flushQueuedRailWidthPreference();
      flushQueuedSidepanelWidthPreference();
    };
  }, []);

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
                wallpaperName: createDraft.wallpaperName.trim() || requestedName,
                resources: requestedResources,
                networkMode: createDraft.networkMode,
                shutdownSourceBeforeClone: createDraft.shutdownSourceBeforeClone,
              })
            : await postJson<VmInstance>("/api/vms", {
                name: requestedName,
                wallpaperName: createDraft.wallpaperName.trim() || requestedName,
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
        case "wallpaperName":
          return current;
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
    setCreateDraft(
      buildCreateDraftFromSource(
        selectedSource,
        createDraft.name,
        createDraft.wallpaperName,
      ),
    );
  }

  function openCreateDialog(): void {
    const nextSource = summary
      ? resolveCreateSourceSelection(
          summary.templates,
          summary.snapshots,
          summary.vms,
          createDraft.launchSource,
        ) ?? firstCreateSourceSelection(summary.templates, summary.snapshots, summary.vms)
      : null;

    setCreateDirty(false);
    setCreateDraft(nextSource ? buildCreateDraftFromSource(nextSource) : emptyCreateDraft);
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
    if (nextWidth === null) {
      return;
    }
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
    const wallpaperName = buildRandomVmName();
    setCloneVmDialog({
      sourceVmId: vm.id,
      sourceVmName: vm.name,
      wallpaperName,
    });
    setCloneVmDraft(wallpaperName);
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
          wallpaperName: cloneVmDialog.wallpaperName,
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
      buildRandomVmName(),
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
                hasBrowserVncSession(displayedStageSession) ? (
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
                        key={currentStageVm?.id ?? displayedStageSession!.webSocketPath!}
                        className="workspace-stage__viewport"
                        hideConnectedOverlayStatus
                        onResolutionChange={setDesktopResolution}
                        reconnectDelayMs={500}
                        surfaceClassName="workspace-stage__canvas"
                        viewOnly={blocksLiveResolutionControl}
                        viewportMode={
                          desktopResolutionMode === "viewport" ? "scale" : "fit"
                        }
                        webSocketPath={displayedStageSession!.webSocketPath!}
                        showHeader={false}
                        statusMode="overlay"
                      />
                      {currentStageVm &&
                      blocksLiveResolutionControl &&
                      resolutionControlHeading &&
                      resolutionControlMessage ? (
                        <WorkspaceControlLockOverlay
                          disabled={isBusy || resolutionControlTakeoverBusy}
                          message={resolutionControlMessage}
                          takeOverLabel={resolutionControlTakeoverLabel}
                          takeoverBusy={resolutionControlTakeoverBusy}
                          title={resolutionControlHeading}
                          onTakeOver={() => void handleTakeOverResolutionControl(currentStageVm)}
                        />
                      ) : null}
                    </div>
                  </div>
                ) : !currentDetail ? (
                  <div className="workspace-stage__placeholder">
                    <div className="workspace-stage__placeholder-block skeleton-shell" />
                  </div>
                ) : getVmDesktopBootState(currentDetail, jobTimingNowMs) ? (
                  <WorkspaceBootSurface state={getVmDesktopBootState(currentDetail, jobTimingNowMs)!} />
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


function buildLatestReleaseTagUrl(version: string): string {
  return `${githubReleaseTagBaseUrl}${version}`;
}
