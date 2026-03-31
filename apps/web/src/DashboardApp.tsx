import {
  createRef,
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
  type RefObject,
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
  shouldDriveGuestResolution,
  shouldScheduleResolutionRepair,
  type ResolutionRequest,
  type ViewportBounds,
} from "./desktopResolution.js";
import {
  canUseDeferredIdentifiedCollection,
  orderIdentifiedCollectionByIds,
} from "./deferredCollections.js";
import {
  attachEmbeddedFrameFocusBridge,
  focusEmbeddedFrameTarget,
} from "./embeddedFrameFocus.js";
import {
  createSelkiesStreamRecoveryState,
  kickEmbeddedBrowserStream,
  readEmbeddedBrowserStreamScale,
  readEmbeddedBrowserStreamState,
  setEmbeddedBrowserStreamScale,
  type EmbeddedBrowserStreamState,
  updateSelkiesStreamRecoveryState,
} from "./embeddedBrowserStream.js";
import {
  hasBrowserDesktopSession,
  hasBrowserVncSession,
  mergeSelectedVmDetail,
  resolveDisplayedDesktopSession,
  resolveSelectedDesktopSession,
  shouldRefreshSelectedVmDetail,
  type RetainedDesktopSession,
} from "./desktopSession.js";
import { NoVncViewport } from "./NoVncViewport.js";
import { SelkiesClipboardOverlay } from "./SelkiesClipboardOverlay.js";
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
  desktopFallbackBadge,
  desktopFallbackMessage,
  findProminentJob,
  formatActiveJobTiming,
  formatRamDraftValue,
  formatTemplateProvenanceKindLabel,
  formatTouchedFileRowMeta,
  formatVmFileBrowserKindToken,
  formatVmFileBrowserRowMeta,
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
import { DashboardDialogsHost } from "./dashboardDialogsHost.js";
import { DashboardNoticeStack } from "./dashboardNoticeStack.js";
import { LoadingShell, LoginShell } from "./dashboardPrimitives.js";
import { formatTelemetryPercent, joinClassNames } from "./dashboardUi.js";
import { OverviewSidepanel, WorkspaceSidepanel } from "./dashboardSidepanel.js";
import {
  EmptyWorkspaceStage,
  WorkspaceBootSurface,
  WorkspaceControlLockOverlay,
  WorkspaceFallbackSurface,
  WorkspaceLogsSurface,
  WorkspaceSessionRelinquishedSurface,
} from "./dashboardStage.js";
import { DashboardWorkspaceRail } from "./dashboardWorkspaceRail.js";
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
  computeSelkiesViewportFallbackScale,
  defaultDesktopResolutionPreference,
  formatViewportScale,
  isSelkiesViewportManagedResolution,
  liveCaptureWarningCopy,
  normalizeBrowserDevicePixelRatio,
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
  shouldPixelateSelkiesViewport,
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
  claimDesktopSessionLease,
  desktopSessionLeaseStorageKeyPrefix,
  parseDesktopSessionLease,
  releaseDesktopSessionLease,
} from "./desktopSessionLease.js";
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
import { createDashboardAppMutations } from "./dashboardAppMutations.js";

const appVersionLabel = __PARALLAIZE_VERSION__;
const githubReleaseTagBaseUrl = "https://github.com/mariusandra/parallaize/releases/tag/v";
const selkiesAutoKickWaitingThresholdMs = 12_000;
const selkiesAutoKickFailedThresholdMs = 2_500;
const selkiesAutoKickCooldownMs = 15_000;
const selkiesAutoReloadCooldownMs = 5_000;
const selkiesAutoReloadAfterWaitingKickMs = 30_000;
const selkiesAutoReloadAfterFailedKickMs = 7_500;
const selkiesAutoRepairThresholdMs = 45_000;
const selkiesAutoRepairCooldownMs = 5 * 60_000;

interface CachedStageBrowserSession {
  browserPath: string;
  name: string;
  nativeScale: number | null;
  reloadToken: number;
  viewportBounds: ViewportBounds;
}

interface SelkiesStageScaleDescriptor {
  fallbackFrameStyle?: CSSProperties;
  pixelated: boolean;
}

function sameSelkiesStageScale(
  left: number | null | undefined,
  right: number,
): boolean {
  return left !== null && left !== undefined && Math.abs(left - right) <= 0.001;
}

function sameOptionalSelkiesStageScale(
  left: number | null | undefined,
  right: number | null | undefined,
): boolean {
  if (left === null || left === undefined || right === null || right === undefined) {
    return left === right;
  }

  return sameSelkiesStageScale(left, right);
}

function appendQueryParam(path: string, key: string, value: string): string {
  const hashIndex = path.indexOf("#");
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";
  const basePath = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const separator = basePath.includes("?") ? "&" : "?";
  return `${basePath}${separator}${key}=${encodeURIComponent(value)}${hash}`;
}

function buildSelkiesStageFrameSrc(
  browserPath: string,
  reloadToken: number,
): string {
  return reloadToken > 0
    ? appendQueryParam(browserPath, "parallaize_reload", String(reloadToken))
    : browserPath;
}

function buildSelkiesStageSessionKey(
  browserPath: string,
  reloadToken: number,
): string {
  return `${browserPath}#${reloadToken}`;
}

function describeSelkiesStageScale(
  preference: DesktopResolutionPreference,
  browserDevicePixelRatio: number,
): SelkiesStageScaleDescriptor {
  if (preference.mode !== "viewport") {
    return {
      pixelated: false,
    };
  }

  const appliedScale = clampDesktopViewportScale(preference.scale);
  const fallbackScale = computeSelkiesViewportFallbackScale(
    appliedScale,
    browserDevicePixelRatio,
  );

  return {
    fallbackFrameStyle:
      Math.abs(fallbackScale - 1) > 0.001
        ? ({
            height: `${100 / fallbackScale}%`,
            transform: `scale(${fallbackScale})`,
            width: `${100 / fallbackScale}%`,
          } satisfies CSSProperties)
        : undefined,
    pixelated: shouldPixelateSelkiesViewport(appliedScale, browserDevicePixelRatio),
  };
}

const emptyCreateDraft: CreateDraft = {
  launchSource: "",
  name: "",
  wallpaperName: "",
  cpu: "",
  ramGb: "",
  diskGb: "",
  desktopTransport: "selkies",
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

function readCurrentBrowserDevicePixelRatio(): number {
  return typeof window === "undefined"
    ? 1
    : normalizeBrowserDevicePixelRatio(window.devicePixelRatio);
}

function shouldSuspendStageBrowserFocusHandoff(
  target: EventTarget | null,
): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return (
    target.closest(".dialog-panel") !== null ||
    target.closest(".workspace-sidepanel") !== null ||
    target.closest(".portal-popover") !== null
  );
}

function blurEmbeddedFrameTarget(
  frame: HTMLIFrameElement | null,
): void {
  if (!frame) {
    return;
  }

  try {
    frame.blur();
  } catch {
    // Ignore blur failures from transient frame states.
  }

  try {
    frame.contentWindow?.blur();
  } catch {
    // Ignore same-origin access races while the frame is navigating.
  }
}

function resolveSelkiesStreamKickCandidate(
  state: EmbeddedBrowserStreamState | null,
): "failed" | "waiting" | null {
  if (!state || state.ready) {
    return null;
  }

  const normalizedStatus = state.status?.trim().toLowerCase() ?? "";

  if (normalizedStatus.length === 0) {
    return null;
  }

  if (normalizedStatus.includes("waiting for stream")) {
    return "waiting";
  }

  if (
    normalizedStatus.includes("connection failed") ||
    normalizedStatus.includes("peer connection failed") ||
    normalizedStatus.includes("server closed connection") ||
    normalizedStatus.includes("error from server") ||
    normalizedStatus === "failed" ||
    normalizedStatus === "disconnected" ||
    normalizedStatus === "closed"
  ) {
    return "failed";
  }

  return null;
}

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
  const [browserDevicePixelRatio, setBrowserDevicePixelRatio] = useState(() =>
    readCurrentBrowserDevicePixelRatio(),
  );
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
  const [relinquishedStageVmId, setRelinquishedStageVmId] = useState<string | null>(null);
  const [sessionRecoveryBusyVmId, setSessionRecoveryBusyVmId] = useState<string | null>(null);
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
  const stageSessionLeaseVmIdsRef = useRef<Set<string>>(new Set());
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
  const stageBrowserFrameRef = useRef<HTMLIFrameElement | null>(null);
  const cachedStageBrowserFrameRefsRef = useRef(
    new Map<string, RefObject<HTMLIFrameElement | null>>(),
  );
  const stageBrowserFrameFocusBridgeCleanupRef = useRef<(() => void) | null>(null);
  const stageBrowserFocusHandoffSuspendedRef = useRef(false);
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
  const selkiesAutoRepairAttemptAtRef = useRef<Map<string, number>>(new Map());
  const [availableViewportBounds, setAvailableViewportBounds] =
    useState<ViewportBounds>(emptyViewportBounds);
  const [observedViewportBounds, setObservedViewportBounds] =
    useState<ViewportBounds>(emptyViewportBounds);
  const [pendingManualResolutionSync, setPendingManualResolutionSync] =
    useState<PendingManualResolutionSync | null>(null);
  const [retainedStageSession, setRetainedStageSession] =
    useState<RetainedDesktopSession | null>(null);
  const [cachedStageBrowserSessions, setCachedStageBrowserSessions] =
    useState<Record<string, CachedStageBrowserSession>>({});

  function resolveStageBrowserFrameRef(vmId: string): RefObject<HTMLIFrameElement | null> {
    const existing = cachedStageBrowserFrameRefsRef.current.get(vmId);

    if (existing) {
      return existing;
    }

    const nextRef = createRef<HTMLIFrameElement>();
    cachedStageBrowserFrameRefsRef.current.set(vmId, nextRef);
    return nextRef;
  }

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
  const stageSessionRelinquished =
    currentStageVm !== null &&
    relinquishedStageVmId === currentStageVm.id &&
    hasBrowserDesktopSession(displayedStageSession);
  const activeStageBrowserSession =
    currentStageVm &&
    displayedStageSession?.kind === "selkies" &&
    displayedStageSession.browserPath &&
    !stageSessionRelinquished
      ? {
          browserPath: displayedStageSession.browserPath,
          name: currentStageVm.name,
          nativeScale:
            cachedStageBrowserSessions[currentStageVm.id]?.browserPath ===
            displayedStageSession.browserPath
              ? cachedStageBrowserSessions[currentStageVm.id]?.nativeScale ?? null
              : null,
          reloadToken:
            cachedStageBrowserSessions[currentStageVm.id]?.browserPath ===
            displayedStageSession.browserPath
              ? cachedStageBrowserSessions[currentStageVm.id]?.reloadToken ?? 0
              : 0,
        }
      : null;
  const activeStageBrowserVmId =
    activeStageBrowserSession && currentStageVm
      ? currentStageVm.id
      : null;
  const selectedSelkiesRecoveryTarget =
    selectedVm &&
    currentStageVm?.id === selectedVm.id &&
    activeStageBrowserVmId === selectedVm.id &&
    displayedStageSession?.kind === "selkies" &&
    displayedStageSession.browserPath &&
    !stageSessionRelinquished
      ? {
          browserPath: displayedStageSession.browserPath,
          vmName: currentStageVm?.name ?? selectedVm.name,
        }
      : null;
  const canRepairSelectedDesktopBridge =
    selectedVm !== null &&
    selectedVm.status === "running" &&
    selectedVm.provider === "incus" &&
    summary?.provider.kind === "incus";
  const stageBrowserSessionsByVm =
    activeStageBrowserSession && currentStageVm
      ? {
          ...cachedStageBrowserSessions,
          [currentStageVm.id]: {
            browserPath: activeStageBrowserSession.browserPath,
            name: activeStageBrowserSession.name,
            nativeScale: activeStageBrowserSession.nativeScale,
            reloadToken: activeStageBrowserSession.reloadToken,
            viewportBounds: emptyViewportBounds,
          },
        }
      : cachedStageBrowserSessions;
  const desktopSessionLeaseVmIds = Array.from(
    new Set(
      (activeStageBrowserVmId !== null ? [activeStageBrowserVmId] : []).concat(
        Object.keys(cachedStageBrowserSessions),
      ),
    ),
  );
  const desktopSessionLeaseVmIdsKey = desktopSessionLeaseVmIds.join("\u0000");
  const showWorkspaceLogs =
    currentDetail !== null && shouldShowWorkspaceLogsSurface(currentDetail);
  const liveResolutionVmId =
    currentStageVm?.status === "running" &&
    hasBrowserDesktopSession(displayedStageSession)
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
  const selkiesViewportManaged = isSelkiesViewportManagedResolution({
    mode: desktopResolutionMode,
    sessionKind: displayedStageSession?.kind,
  });
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
  const activeStageViewportBounds =
    desktopResolutionMode === "fixed"
      ? {
          height: appliedDesktopHeight,
          width: appliedDesktopWidth,
        }
      : observedViewportBounds.width !== null && observedViewportBounds.height !== null
        ? observedViewportBounds
        : availableViewportBounds;
  const effectiveDesktopResolution = applyViewportBoundsToResolution(
    desktopResolution,
    observedViewportBounds,
  );
  const drivesGuestResolution =
    liveResolutionVmId !== null &&
    shouldDriveGuestResolution({
      mode: desktopResolutionMode,
      sessionKind: displayedStageSession?.kind,
    });
  const desiredDesktopResolutionTarget =
    drivesGuestResolution &&
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

  function resolveMirroredStageFrameRef(
    vmId: string,
  ): RefObject<HTMLIFrameElement | null> | null {
    return stageBrowserSessionsByVm[vmId]
      ? resolveStageBrowserFrameRef(vmId)
      : null;
  }

  function shutdownStageBrowserFrame(frame: HTMLIFrameElement | null): void {
    if (!frame) {
      return;
    }

    try {
      const target = frame.contentWindow as (Window & {
        shutdownSelkiesStream?: () => void;
      }) | null;

      if (typeof target?.shutdownSelkiesStream === "function") {
        target.shutdownSelkiesStream();
      }
    } catch {
      // Ignore same-origin access races while the stage iframe is navigating.
    }
  }

  function setStageBrowserFrameBackgroundMode(
    frame: HTMLIFrameElement | null,
    background: boolean,
  ): void {
    if (!frame) {
      return;
    }

    try {
      const target = frame.contentWindow as (Window & {
        parallaizeSetBackgroundMode?: (background: boolean) => void;
      }) | null;

      target?.parallaizeSetBackgroundMode?.(background);
    } catch {
      // Ignore same-origin access races while the stage iframe is navigating.
    }
  }

  function markStageBrowserFrameScalePending(
    vmId: string,
    browserPath: string,
    name: string,
  ): void {
    setCachedStageBrowserSessions((current) => {
      const existing = current[vmId];
      const nextViewportBounds = existing?.viewportBounds ?? emptyViewportBounds;

      if (
        existing?.browserPath === browserPath &&
        existing?.name === name &&
        existing?.nativeScale === null
      ) {
        return current;
      }

      return {
        ...current,
        [vmId]: {
          browserPath,
          name,
          nativeScale: null,
          reloadToken: existing?.reloadToken ?? 0,
          viewportBounds: nextViewportBounds,
        },
      };
    });
  }

  function requestStageBrowserReload(
    vmId: string,
    browserPath: string,
    name: string,
  ): void {
    const frameRef = resolveStageBrowserFrameRef(vmId);
    const frame = frameRef.current;

    if (stageBrowserFrameRef.current === frame) {
      clearStageBrowserFrameFocusBridge();
      stageBrowserFrameRef.current = null;
    }

    shutdownStageBrowserFrame(frame);
    frameRef.current = null;

    setCachedStageBrowserSessions((current) => {
      const existing = current[vmId];
      const nextViewportBounds = existing?.viewportBounds ?? emptyViewportBounds;
      const nextReloadToken =
        existing?.browserPath === browserPath
          ? (existing.reloadToken ?? 0) + 1
          : 1;

      if (
        existing?.browserPath === browserPath &&
        existing?.name === name &&
        existing?.nativeScale === null &&
        existing?.reloadToken === nextReloadToken
      ) {
        return current;
      }

      return {
        ...current,
        [vmId]: {
          browserPath,
          name,
          nativeScale: null,
          reloadToken: nextReloadToken,
          viewportBounds: nextViewportBounds,
        },
      };
    });
  }

  function kickBrowserStream(vm: VmInstance): void {
    if (!selectedSelkiesRecoveryTarget || selectedVm?.id !== vm.id) {
      setNotice({
        tone: "error",
        message: `Open ${vm.name} on this stage before kicking its Selkies stream.`,
      });
      return;
    }

    if (kickEmbeddedBrowserStream(stageBrowserFrameRef.current, "manual-sidepanel")) {
      setNotice({
        tone: "info",
        message: `Requested a Selkies reconnect for ${vm.name}.`,
      });
      return;
    }

    requestStageBrowserReload(vm.id, selectedSelkiesRecoveryTarget.browserPath, vm.name);
    setNotice({
      tone: "info",
      message: `Fell back to a full Selkies frame reload for ${vm.name}.`,
    });
  }

  function reloadBrowserStream(vm: VmInstance): void {
    if (!selectedSelkiesRecoveryTarget || selectedVm?.id !== vm.id) {
      setNotice({
        tone: "error",
        message: `Open ${vm.name} on this stage before reloading its Selkies frame.`,
      });
      return;
    }

    requestStageBrowserReload(vm.id, selectedSelkiesRecoveryTarget.browserPath, vm.name);
    setNotice({
      tone: "info",
      message: `Reloading the Selkies frame for ${vm.name}.`,
    });
  }

  async function repairDesktopBridge(
    vm: VmInstance,
    mode: "automatic" | "manual" = "manual",
  ): Promise<void> {
    if (sessionRecoveryBusyVmId === vm.id) {
      return;
    }

    if (
      vm.status !== "running" ||
      vm.provider !== "incus" ||
      summary?.provider.kind !== "incus"
    ) {
      if (mode === "manual") {
        setNotice({
          tone: "error",
          message: `Desktop bridge repair is only available for running Incus VMs.`,
        });
      }
      return;
    }

    setSessionRecoveryBusyVmId(vm.id);

    if (mode === "automatic") {
      setNotice({
        tone: "info",
        message: `${vm.name} stayed stuck in Selkies recovery. Repairing the guest desktop bridge.`,
      });
    }

    try {
      const repairedDetail = await postJson<VmDetail>(
        `/api/vms/${vm.id}/desktop-bridge/repair`,
        {},
      );

      if (selectedVmIdRef.current === vm.id) {
        startTransition(() => {
          setDetail(repairedDetail);
        });
      }

      await refreshSummary();
      if (selectedVmIdRef.current === vm.id) {
        await refreshDetail(vm.id);
      }

      const activeRecoveryTarget =
        currentStageVm?.id === vm.id &&
        displayedStageSession?.kind === "selkies" &&
        displayedStageSession.browserPath &&
        !stageSessionRelinquished
          ? {
              browserPath: displayedStageSession.browserPath,
              vmName: currentStageVm?.name ?? vm.name,
            }
          : null;

      if (activeRecoveryTarget) {
        requestStageBrowserReload(vm.id, activeRecoveryTarget.browserPath, activeRecoveryTarget.vmName);
      }

      setNotice({
        tone: "success",
        message:
          mode === "automatic"
            ? `Repaired ${vm.name} after its Selkies stream stayed stuck.`
            : `Repaired the desktop bridge for ${vm.name}.`,
      });
    } catch (error: unknown) {
      setNotice({
        tone: "error",
        message:
          mode === "automatic"
            ? `Automatic desktop bridge repair failed for ${vm.name}: ${errorMessage(error)}`
            : errorMessage(error),
      });
    } finally {
      setSessionRecoveryBusyVmId((current) => (current === vm.id ? null : current));
    }
  }

  function syncSelkiesStageNativeScale(frame: HTMLIFrameElement | null): boolean {
    if (
      activeStageBrowserVmId === null ||
      displayedStageSession?.kind !== "selkies" ||
      !displayedStageSession.browserPath ||
      stageSessionRelinquished ||
      desktopResolutionMode !== "viewport"
    ) {
      return false;
    }

    const activeBrowserPath = displayedStageSession.browserPath;
    const activeVmName = currentStageVm?.name ?? "Desktop";
    const currentScale = readEmbeddedBrowserStreamScale(frame);
    const applied =
      (currentScale !== null &&
        sameSelkiesStageScale(currentScale, appliedDesktopViewportScale)) ||
      setEmbeddedBrowserStreamScale(frame, appliedDesktopViewportScale);

    if (!applied) {
      return false;
    }

    setCachedStageBrowserSessions((current) => {
      const existing = current[activeStageBrowserVmId];
      const nextViewportBounds = existing?.viewportBounds ?? emptyViewportBounds;

      if (
        existing?.browserPath === activeBrowserPath &&
        existing?.name === activeVmName &&
        existing !== undefined &&
        sameViewportBounds(nextViewportBounds, existing.viewportBounds) &&
        sameSelkiesStageScale(existing.nativeScale, appliedDesktopViewportScale)
      ) {
        return current;
      }

      return {
        ...current,
        [activeStageBrowserVmId]: {
          browserPath: activeBrowserPath,
          name: currentStageVm?.name ?? existing?.name ?? activeVmName,
          nativeScale: appliedDesktopViewportScale,
          reloadToken: existing?.reloadToken ?? 0,
          viewportBounds: nextViewportBounds,
        },
      };
    });

    return applied;
  }

  function releaseOwnedDesktopSessionLeases(vmIds = stageSessionLeaseVmIdsRef.current): void {
    for (const vmId of vmIds) {
      releaseDesktopSessionLease(vmId, tabIdRef.current);
    }

    if (vmIds === stageSessionLeaseVmIdsRef.current) {
      stageSessionLeaseVmIdsRef.current.clear();
    }
  }

  function disconnectCachedStageBrowserSession(vmId: string): void {
    const frameRef = cachedStageBrowserFrameRefsRef.current.get(vmId);
    const frame = frameRef?.current ?? null;

    if (stageBrowserFrameRef.current === frame) {
      clearStageBrowserFrameFocusBridge();
      stageBrowserFrameRef.current = null;
    }

    shutdownStageBrowserFrame(frame);

    if (frameRef) {
      frameRef.current = null;
      cachedStageBrowserFrameRefsRef.current.delete(vmId);
    }

    stageSessionLeaseVmIdsRef.current.delete(vmId);
    setCachedStageBrowserSessions((current) => {
      if (!(vmId in current)) {
        return current;
      }

      const next = { ...current };
      delete next[vmId];
      return next;
    });
  }

  function relinquishDesktopSessionVm(vmId: string): void {
    stageSessionLeaseVmIdsRef.current.delete(vmId);

    if (currentStageVm?.id === vmId) {
      clearStageBrowserFrameFocusBridge();
      stageBrowserFrameRef.current = null;
      setRelinquishedStageVmId(vmId);
      setRetainedStageSession((current) =>
        current?.vmId === vmId ? null : current,
      );
    }

    disconnectCachedStageBrowserSession(vmId);
  }

  const {
    activeCpuThresholdForVm,
    applyResolutionMode,
    applyViewportScalePreference,
    closeCloneVmDialog,
    closeRenameDialog,
    closeTemplateCloneDialog,
    closeTemplateEditDialog,
    closeVmLogsDialog,
    handleClone,
    handleCloneVmSubmit,
    handleCreate,
    handleCreateField,
    handleCreateShutdownBeforeCloneChange,
    handleCreateSourceChange,
    handleDelete,
    handleDeleteTemplate,
    handleEditTemplateSubmit,
    handleLogout,
    handleRailResizeKeyDown,
    handleRailResizeStart,
    handleRenameSubmit,
    handleRenameTemplate,
    handleRenameVm,
    handleSetActiveCpuThreshold,
    handleSidepanelClosedResizeStart,
    handleSidepanelResizeKeyDown,
    handleSidepanelResizeStart,
    handleSnapshot,
    handleTemplateCloneField,
    handleTemplateCloneSubmit,
    handleTemplateEditField,
    handleVmAction,
    handleVmStripDragOver,
    handleVmStripDrop,
    handleVmTileDragEnd,
    handleVmTileDragOver,
    handleVmTileDragStart,
    handleVmTileDrop,
    inspectVm,
    openCreateDialog,
    openCreateDialogForTemplate,
    openHomepage,
    openTemplateCloneDialog,
    openTemplateEditDialog,
    openVmLogsDialog,
    refreshDetail,
    refreshHealth,
    refreshSummary,
    refreshVmFileBrowserSnapshot,
    refreshVmLogsDialog,
    refreshVmTouchedFilesSnapshot,
    requireLogin,
    runMutation,
    selectVm,
    setCurrentSidepanelCollapsed,
    setVmDesktopResolutionPreference,
    setVmSidepanelCollapsed,
    toggleFullscreen,
  } = createDashboardAppMutations({
    summary,
    displayedVms,
    createDraft,
    cloneVmDialog,
    cloneVmDraft,
    renameDialog,
    renameDraft,
    templateEditDraft,
    templateCloneDraft,
    activeCpuThresholdsByVm,
    detail,
    draggedVmId,
    vmRailOrderIds,
    vmReorderBusy,
    wideShellLayout,
    compactSidepanelLayout,
    railWidth,
    displayedSidepanelWidth,
    viewportWidth,
    appliedDesktopViewportScale,
    appliedDesktopWidth,
    appliedDesktopHeight,
    resolutionDraft,
    emptyCreateDraft,
    selectedVmIdRef,
    lastResolutionRequestKeyRef,
    railRef,
    railResizeRef,
    sidepanelRef,
    sidepanelResizeRef,
    vmDragDropCommittedRef,
    setSummary,
    setAuthState,
    setHealth,
    setDetail,
    setVmFileBrowser,
    setVmFileBrowserError,
    setVmFileBrowserLoading,
    setVmTouchedFiles,
    setVmTouchedFilesError,
    setVmTouchedFilesLoading,
    setVmDiskUsage,
    setVmDiskUsageError,
    setVmDiskUsageLoading,
    setNotice,
    setBusyLabel,
    setCreateDirty,
    setCreateDraft,
    setShowCreateDialog,
    setCloneVmDialog,
    setCloneVmDraft,
    setRenameDialog,
    setRenameDraft,
    setVmLogsDialog,
    setVmLogsRefreshTick,
    setTemplateCloneDraft,
    setTemplateEditDraft,
    setShellMenuOpen,
    setOpenVmMenuId,
    setOpenTemplateMenuId,
    setSelectedVmId,
    setSidepanelCollapsedByVm,
    setOverviewSidepanelCollapsed,
    setDesktopResolutionByVm,
    setResolutionDraft,
    setActiveCpuThresholdsByVm,
    setVmRailOrderIds,
    setDraggedVmId,
    setVmReorderBusy,
    setRailResizeActive,
    setRailWidthPreference,
    setSidepanelResizeActive,
    setSidepanelWidthPreference,
  });

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
    if (
      currentStageVm &&
      displayedStageSession?.kind === "selkies" &&
      displayedStageSession.browserPath
    ) {
      return;
    }

    clearStageBrowserFrameFocusBridge();
    stageBrowserFrameRef.current = null;
  }, [
    currentStageVm?.id,
    displayedStageSession?.kind,
    displayedStageSession?.browserPath,
  ]);

  function clearStageBrowserFrameFocusBridge(): void {
    stageBrowserFrameFocusBridgeCleanupRef.current?.();
    stageBrowserFrameFocusBridgeCleanupRef.current = null;
  }

  function armStageBrowserFrameFocus(): void {
    armEmbeddedFrameFocusBridge(stageBrowserFrameRef.current);
  }

  function armEmbeddedFrameFocusBridge(
    frame: HTMLIFrameElement | null,
  ): void {
    clearStageBrowserFrameFocusBridge();

    if (!frame) {
      return;
    }

    stageBrowserFocusHandoffSuspendedRef.current = false;
    focusEmbeddedFrameTarget(frame);
    stageBrowserFrameFocusBridgeCleanupRef.current =
      attachEmbeddedFrameFocusBridge(frame);
  }

  useEffect(() => {
    if (
      activeStageBrowserVmId === null ||
      displayedStageSession?.kind !== "selkies" ||
      !displayedStageSession.browserPath ||
      stageSessionRelinquished
    ) {
      return;
    }

    armStageBrowserFrameFocus();
  }, [
    activeStageBrowserVmId,
    displayedStageSession?.kind,
    displayedStageSession?.browserPath,
    stageSessionRelinquished,
  ]);

  useEffect(() => {
    if (
      activeStageBrowserVmId === null ||
      displayedStageSession?.kind !== "selkies" ||
      !displayedStageSession.browserPath ||
      stageSessionRelinquished
    ) {
      return;
    }

    function handOffFocusedIframe(): void {
      const frame = stageBrowserFrameRef.current;

      if (!frame || stageBrowserFocusHandoffSuspendedRef.current) {
        return;
      }

      window.requestAnimationFrame(() => {
        if (stageBrowserFocusHandoffSuspendedRef.current) {
          return;
        }

        if (document.activeElement === frame) {
          focusEmbeddedFrameTarget(frame);
        }
      });
    }

    function handleDocumentPointerDown(event: PointerEvent): void {
      const frame = stageBrowserFrameRef.current;

      if (!frame) {
        return;
      }

      if (event.target === frame) {
        stageBrowserFocusHandoffSuspendedRef.current = false;
        return;
      }

      if (shouldSuspendStageBrowserFocusHandoff(event.target)) {
        stageBrowserFocusHandoffSuspendedRef.current = true;
        blurEmbeddedFrameTarget(frame);
      }
    }

    function handleDocumentFocusIn(event: FocusEvent): void {
      const frame = stageBrowserFrameRef.current;

      if (!frame) {
        return;
      }

      if (event.target === frame) {
        stageBrowserFocusHandoffSuspendedRef.current = false;
        handOffFocusedIframe();
        return;
      }

      if (shouldSuspendStageBrowserFocusHandoff(event.target)) {
        stageBrowserFocusHandoffSuspendedRef.current = true;
        blurEmbeddedFrameTarget(frame);
        return;
      }

      handOffFocusedIframe();
    }

    handOffFocusedIframe();
    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    document.addEventListener("focusin", handleDocumentFocusIn);

    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
      document.removeEventListener("focusin", handleDocumentFocusIn);
    };
  }, [
    activeStageBrowserVmId,
    displayedStageSession?.kind,
    displayedStageSession?.browserPath,
    stageSessionRelinquished,
  ]);

  useEffect(() => {
    if (
      activeStageBrowserVmId === null ||
      displayedStageSession?.kind !== "selkies" ||
      !displayedStageSession.browserPath ||
      stageSessionRelinquished
    ) {
      return;
    }

    const browserPath = displayedStageSession.browserPath;
    const vmName = currentStageVm?.name ?? "Desktop";
    let recoveryState = createSelkiesStreamRecoveryState();

    const pollStreamRecovery = (): void => {
      const state = readEmbeddedBrowserStreamState(stageBrowserFrameRef.current);
      const candidate = resolveSelkiesStreamKickCandidate(state);
      const now = Date.now();
      recoveryState = updateSelkiesStreamRecoveryState(
        recoveryState,
        state,
        candidate,
        now,
      );

      if (recoveryState.trackedCandidate === null) {
        return;
      }

      const trackedCandidate = recoveryState.trackedCandidate;
      const reloadThresholdMs =
        trackedCandidate === "failed"
          ? selkiesAutoReloadAfterFailedKickMs
          : selkiesAutoReloadAfterWaitingKickMs;

      if (
        recoveryState.kickCount > 0 &&
        now - recoveryState.candidateSinceMs >= reloadThresholdMs &&
        now - recoveryState.lastRecoveryAttemptMs >= selkiesAutoReloadCooldownMs
      ) {
        requestStageBrowserReload(
          activeStageBrowserVmId,
          browserPath,
          vmName,
        );
        recoveryState = {
          ...recoveryState,
          candidateSinceMs: now,
          kickCount: 0,
          lastRecoveryAttemptMs: now,
        };
        return;
      }

      if (recoveryState.kickCount > 0) {
        return;
      }

      const thresholdMs =
        trackedCandidate === "failed"
          ? selkiesAutoKickFailedThresholdMs
          : selkiesAutoKickWaitingThresholdMs;

      if (now - recoveryState.candidateSinceMs < thresholdMs) {
        return;
      }

      if (now - recoveryState.lastRecoveryAttemptMs < selkiesAutoKickCooldownMs) {
        return;
      }

      recoveryState = {
        ...recoveryState,
        lastRecoveryAttemptMs: now,
      };
      if (kickEmbeddedBrowserStream(stageBrowserFrameRef.current, `auto-${candidate}`)) {
        recoveryState = {
          ...recoveryState,
          kickCount: recoveryState.kickCount + 1,
        };
        return;
      }

      requestStageBrowserReload(
        activeStageBrowserVmId,
        browserPath,
        vmName,
      );
      recoveryState = {
        ...recoveryState,
        candidateSinceMs: now,
        lastRecoveryAttemptMs: now,
      };
    };

    pollStreamRecovery();
    const pollId = window.setInterval(pollStreamRecovery, 1_000);

    return () => {
      window.clearInterval(pollId);
    };
  }, [
    activeStageBrowserVmId,
    currentStageVm?.name,
    displayedStageSession?.kind,
    displayedStageSession?.browserPath,
    stageSessionRelinquished,
  ]);

  useEffect(() => {
    if (
      activeStageBrowserVmId === null ||
      displayedStageSession?.kind !== "selkies" ||
      !displayedStageSession.browserPath ||
      stageSessionRelinquished ||
      !currentStageVm ||
      currentStageVm.status !== "running" ||
      currentStageVm.provider !== "incus"
    ) {
      return;
    }

    let trackedCandidate: "failed" | "waiting" | null = null;
    let candidateSinceMs = 0;

    const pollAutomaticRepair = (): void => {
      const state = readEmbeddedBrowserStreamState(stageBrowserFrameRef.current);
      const candidate = resolveSelkiesStreamKickCandidate(state);
      const normalizedStatus = state?.status?.trim().toLowerCase() ?? "";
      const reconnecting =
        normalizedStatus.includes("reconnecting stream") && state?.ready !== true;
      const now = Date.now();

      if (candidate !== null) {
        if (trackedCandidate !== candidate) {
          trackedCandidate = candidate;
          candidateSinceMs = now;
        }
      } else if (!(reconnecting && trackedCandidate !== null)) {
        trackedCandidate = null;
        candidateSinceMs = 0;
        return;
      }

      const lastAttemptAt =
        selkiesAutoRepairAttemptAtRef.current.get(currentStageVm.id) ?? 0;

      if (
        candidateSinceMs === 0 ||
        sessionRecoveryBusyVmId === currentStageVm.id ||
        busyLabel !== null ||
        now - candidateSinceMs < selkiesAutoRepairThresholdMs ||
        now - lastAttemptAt < selkiesAutoRepairCooldownMs
      ) {
        return;
      }

      selkiesAutoRepairAttemptAtRef.current.set(currentStageVm.id, now);
      void repairDesktopBridge(currentStageVm, "automatic");
    };

    pollAutomaticRepair();
    const pollId = window.setInterval(pollAutomaticRepair, 1_000);

    return () => {
      window.clearInterval(pollId);
    };
  }, [
    activeStageBrowserVmId,
    busyLabel,
    currentStageVm,
    currentStageVm?.id,
    currentStageVm?.provider,
    currentStageVm?.status,
    displayedStageSession?.browserPath,
    displayedStageSession?.kind,
    repairDesktopBridge,
    sessionRecoveryBusyVmId,
    stageSessionRelinquished,
  ]);

  useEffect(() => {
    if (
      activeStageBrowserVmId === null ||
      displayedStageSession?.kind !== "selkies" ||
      !displayedStageSession.browserPath ||
      stageSessionRelinquished ||
      desktopResolutionMode !== "viewport"
    ) {
      return;
    }

    let cancelled = false;
    let retryTimer: number | null = null;
    let attempts = 0;

    const syncScale = (): void => {
      const applied = syncSelkiesStageNativeScale(stageBrowserFrameRef.current);

      if (cancelled) {
        return;
      }

      if (!applied && attempts < 20) {
        attempts += 1;
        retryTimer = window.setTimeout(syncScale, 250);
      }
    };

    syncScale();

    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [
    activeStageBrowserVmId,
    appliedDesktopViewportScale,
    desktopResolutionMode,
    displayedStageSession?.browserPath,
    displayedStageSession?.kind,
    stageSessionRelinquished,
  ]);

  function renderStageBrowserHost(): JSX.Element | null {
    const stageBrowserSessions = Object.entries(stageBrowserSessionsByVm);

    if (stageBrowserSessions.length === 0) {
      return null;
    }

    return (
      <>
        {stageBrowserSessions.map(([vmId, session]) => {
          const frameRef = resolveStageBrowserFrameRef(vmId);
          const active = activeStageBrowserVmId === vmId;
          const sessionResolutionPreference =
            desktopResolutionByVm[vmId] ?? defaultDesktopResolutionPreference;
          const sessionScaleDescriptor = describeSelkiesStageScale(
            sessionResolutionPreference,
            browserDevicePixelRatio,
          );
          const cachedViewportStyle =
            !active &&
            session.viewportBounds.width !== null &&
            session.viewportBounds.height !== null
              ? ({
                  width: `${session.viewportBounds.width}px`,
                  height: `${session.viewportBounds.height}px`,
                } satisfies CSSProperties)
              : undefined;

          return (
            <div
              key={`${vmId}:${session.browserPath}:${session.reloadToken}`}
              ref={active ? stageViewportShellRef : undefined}
              className={joinClassNames(
                "workspace-stage__browser-host",
                "workspace-stage__viewport-shell",
                active
                  ? desktopResolutionMode === "fixed"
                    ? "workspace-stage__viewport-shell--fixed"
                    : "workspace-stage__viewport-shell--viewport"
                  : "workspace-stage__viewport-shell--viewport",
                active
                  ? "workspace-stage__browser-host--active"
                  : "workspace-stage__browser-host--cached",
              )}
              aria-hidden={active ? undefined : true}
            >
              <div
                ref={active ? stageViewportFrameRef : undefined}
                className={joinClassNames(
                  "workspace-stage__viewport-frame",
                  active && desktopResolutionMode === "fixed"
                    ? "workspace-stage__viewport-frame--fixed"
                    : "",
                )}
                style={active ? stageViewportFrameStyle : cachedViewportStyle}
              >
                <div
                  className={joinClassNames(
                    "workspace-stage__browser-frame-shell",
                    sessionScaleDescriptor.pixelated
                      ? "workspace-stage__browser-frame-shell--pixelated"
                      : "",
                  )}
                >
                  <div
                    className={joinClassNames(
                      "workspace-stage__browser-frame-scale",
                      sessionScaleDescriptor.pixelated
                        ? "workspace-stage__browser-frame-scale--pixelated"
                        : "",
                    )}
                    style={sessionScaleDescriptor.fallbackFrameStyle}
                  >
                    <iframe
                      ref={(node) => {
                        frameRef.current = node;

                        if (active) {
                          stageBrowserFrameRef.current = node;
                        } else if (stageBrowserFrameRef.current === node) {
                          stageBrowserFrameRef.current = null;
                        }
                      }}
                      className={joinClassNames(
                        "workspace-stage__browser-frame",
                        sessionScaleDescriptor.pixelated
                          ? "workspace-stage__browser-frame--pixelated"
                          : "",
                      )}
                      src={buildSelkiesStageFrameSrc(
                        session.browserPath,
                        session.reloadToken,
                      )}
                      title={`${session.name} desktop`}
                      allow="autoplay; clipboard-read; clipboard-write; fullscreen; microphone; camera"
                      allowFullScreen
                      tabIndex={active ? 0 : -1}
                      aria-hidden={active ? undefined : true}
                      onFocus={
                        active
                          ? (event) => {
                              armEmbeddedFrameFocusBridge(event.currentTarget);
                            }
                          : undefined
                      }
                      onLoad={() => {
                        markStageBrowserFrameScalePending(
                          vmId,
                          session.browserPath,
                          session.name,
                        );

                        if (active) {
                          armEmbeddedFrameFocusBridge(frameRef.current);
                          syncSelkiesStageNativeScale(frameRef.current);
                        }
                        setStageBrowserFrameBackgroundMode(frameRef.current, !active);
                      }}
                      onPointerDownCapture={active ? armStageBrowserFrameFocus : undefined}
                    />
                  </div>
                </div>
                {active ? (
                  <SelkiesClipboardOverlay
                    frameRef={frameRef}
                    sessionKey={buildSelkiesStageSessionKey(
                      session.browserPath,
                      session.reloadToken,
                    )}
                  />
                ) : null}
                {active &&
                currentStageVm &&
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
          );
        })}
      </>
    );
  }

  function reconnectStageHere(): void {
    if (!currentStageVm) {
      return;
    }

    setRetainedStageSession(null);
    setRelinquishedStageVmId((current) =>
      current === currentStageVm.id ? null : current,
    );
  }

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
    const previousLeaseVmIds = stageSessionLeaseVmIdsRef.current;
    const nextLeaseVmIds = new Set(desktopSessionLeaseVmIds);

    for (const vmId of previousLeaseVmIds) {
      if (!nextLeaseVmIds.has(vmId)) {
        releaseDesktopSessionLease(vmId, tabIdRef.current);
      }
    }

    for (const vmId of nextLeaseVmIds) {
      if (!previousLeaseVmIds.has(vmId)) {
        claimDesktopSessionLease(vmId, tabIdRef.current);
      }
    }

    stageSessionLeaseVmIdsRef.current = nextLeaseVmIds;
  }, [desktopSessionLeaseVmIdsKey]);

  useEffect(() => {
    if (desktopSessionLeaseVmIds.length === 0) {
      return;
    }

    const leasedVmIdSet = new Set(desktopSessionLeaseVmIds);

    function handleStorage(event: StorageEvent): void {
      const leaseKey = event.key;

      if (
        typeof leaseKey !== "string" ||
        !leaseKey.startsWith(desktopSessionLeaseStorageKeyPrefix)
      ) {
        return;
      }

      const vmId = leaseKey.slice(desktopSessionLeaseStorageKeyPrefix.length);

      if (vmId.length === 0 || !leasedVmIdSet.has(vmId)) {
        return;
      }

      const lease = parseDesktopSessionLease(event.newValue);

      if (!lease || lease.vmId !== vmId || lease.tabId === tabIdRef.current) {
        return;
      }

      relinquishDesktopSessionVm(vmId);
    }

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, [currentStageVm?.id, desktopSessionLeaseVmIdsKey]);

  useEffect(() => {
    const releaseLeases = () => {
      releaseOwnedDesktopSessionLeases();
    };

    window.addEventListener("beforeunload", releaseLeases);
    window.addEventListener("pagehide", releaseLeases);

    return () => {
      window.removeEventListener("beforeunload", releaseLeases);
      window.removeEventListener("pagehide", releaseLeases);
      releaseLeases();
    };
  }, []);

  useEffect(() => {
    function handleViewportResize(): void {
      setViewportWidth(readViewportWidth());
      setBrowserDevicePixelRatio(readCurrentBrowserDevicePixelRatio());
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
    setVmFileBrowser(null);
    setVmFileBrowserError(null);
    setVmFileBrowserLoading(false);
    setVmTouchedFiles(null);
    setVmTouchedFilesError(null);
    setVmTouchedFilesLoading(false);
    setVmDiskUsage(null);
    setVmDiskUsageError(null);
    setVmDiskUsageLoading(false);
  }, [authState, detail?.vm.id, detail?.vm.workspacePath]);

  useEffect(() => {
    if (authState !== "ready" || !detail) {
      return;
    }

    let cancelled = false;
    let refreshTimer: number | null = null;
    const vmId = detail.vm.id;

    setVmDiskUsageLoading(true);
    setVmDiskUsageError(null);

    const refreshDiskUsage = async (): Promise<void> => {
      try {
        const diskUsageSnapshot = await fetchJson<VmDiskUsageSnapshot>(
          `/api/vms/${vmId}/disk-usage`,
        );

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

    void refreshDiskUsage();

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
      currentStageSession && hasBrowserDesktopSession(currentStageSession)
        ? currentStageSession
        : null;

    if (!nextStageSession) {
      return;
    }

    setRetainedStageSession((current) =>
      current?.vmId === currentStageVm.id &&
      current.session?.kind === nextStageSession.kind &&
      current.session?.webSocketPath === nextStageSession.webSocketPath &&
      current.session?.browserPath === nextStageSession.browserPath
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
    currentStageSession?.browserPath,
  ]);

  useEffect(() => {
    if (
      !currentStageVm ||
      currentStageVm.status !== "running" ||
      displayedStageSession?.kind !== "selkies" ||
      !displayedStageSession.browserPath ||
      stageSessionRelinquished
    ) {
      return;
    }

    const browserPath = displayedStageSession.browserPath;

    setCachedStageBrowserSessions((current) => {
      const existing = current[currentStageVm.id];
      const nextViewportBounds =
        activeStageViewportBounds.width !== null && activeStageViewportBounds.height !== null
          ? activeStageViewportBounds
          : existing?.viewportBounds ?? emptyViewportBounds;
      const nextNativeScale =
        desktopResolutionMode === "viewport" &&
        existing?.browserPath === browserPath &&
        sameSelkiesStageScale(existing.nativeScale, appliedDesktopViewportScale)
          ? existing.nativeScale
          : null;
      const nextReloadToken =
        existing?.browserPath === browserPath ? existing.reloadToken ?? 0 : 0;

      if (
        existing?.browserPath === displayedStageSession.browserPath &&
        existing?.name === currentStageVm.name &&
        existing !== undefined &&
        existing.reloadToken === nextReloadToken &&
        sameOptionalSelkiesStageScale(existing.nativeScale, nextNativeScale) &&
        sameViewportBounds(existing.viewportBounds, nextViewportBounds)
      ) {
        return current;
      }

      return {
        ...current,
        [currentStageVm.id]: {
          browserPath,
          name: currentStageVm.name,
          nativeScale: nextNativeScale,
          reloadToken: nextReloadToken,
          viewportBounds: nextViewportBounds,
        },
      };
    });
  }, [
    currentStageVm?.id,
    currentStageVm?.name,
    currentStageVm?.status,
    displayedStageSession?.kind,
    displayedStageSession?.browserPath,
    activeStageViewportBounds.width,
    activeStageViewportBounds.height,
    appliedDesktopViewportScale,
    desktopResolutionMode,
    stageSessionRelinquished,
  ]);

  useEffect(() => {
    const runningVmIds = new Set(
      (summary?.vms ?? [])
        .filter((vm) => vm.status === "running")
        .map((vm) => vm.id),
    );

    setCachedStageBrowserSessions((current) => {
      let changed = false;
      const next: Record<string, CachedStageBrowserSession> = {};

      for (const [vmId, session] of Object.entries(current)) {
        if (!runningVmIds.has(vmId)) {
          shutdownStageBrowserFrame(resolveStageBrowserFrameRef(vmId).current);
          resolveStageBrowserFrameRef(vmId).current = null;
          cachedStageBrowserFrameRefsRef.current.delete(vmId);
          changed = true;
          continue;
        }

        next[vmId] = session;
      }

      return changed ? next : current;
    });
  }, [summary?.vms]);

  useEffect(() => {
    const activeStageSession = displayedStageSession;

    if (
      !currentStageVm ||
      !activeStageSession ||
      !hasBrowserDesktopSession(activeStageSession)
    ) {
      setDesktopResolution(emptyResolutionState);
      setAvailableViewportBounds(emptyViewportBounds);
      setObservedViewportBounds(emptyViewportBounds);
      return;
    }

    if (activeStageSession.kind !== "vnc") {
      setDesktopResolution((current) =>
        current.clientWidth === null &&
        current.clientHeight === null &&
        current.remoteWidth === null &&
        current.remoteHeight === null
          ? current
          : emptyResolutionState,
      );
    }
  }, [
    currentStageVm?.id,
    displayedStageSession?.kind,
    displayedStageSession?.webSocketPath,
    displayedStageSession?.browserPath,
  ]);

  useEffect(() => {
    if (!selkiesViewportManaged) {
      return;
    }

    setDesktopResolution((current) =>
      current.remoteWidth === null && current.remoteHeight === null
        ? current
        : {
            ...current,
            remoteWidth: null,
            remoteHeight: null,
          },
    );
  }, [selkiesViewportManaged]);

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
    displayedStageSession?.browserPath,
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
    displayedStageSession?.browserPath,
    desktopResolutionMode,
  ]);

  useEffect(() => {
    for (const [vmId, frameRef] of cachedStageBrowserFrameRefsRef.current.entries()) {
      setStageBrowserFrameBackgroundMode(frameRef.current, activeStageBrowserVmId !== vmId);
    }
  }, [activeStageBrowserVmId, desktopSessionLeaseVmIdsKey]);

  useEffect(() => {
    return () => {
      for (const frameRef of cachedStageBrowserFrameRefsRef.current.values()) {
        shutdownStageBrowserFrame(frameRef.current);
      }

      shutdownStageBrowserFrame(stageBrowserFrameRef.current);
    };
  }, []);

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
      clearStageBrowserFrameFocusBridge();
      flushQueuedRailWidthPreference();
      flushQueuedSidepanelWidthPreference();
    };
  }, []);

  useEffect(() => {
    return () => {
      clearStageBrowserFrameFocusBridge();
    };
  }, [
    currentStageVm?.id,
    displayedStageSession?.kind,
    displayedStageSession?.browserPath,
  ]);

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

        if (
          liveResolutionVmIdRef.current === request.vmId &&
          displayedStageSession?.kind === "selkies"
        ) {
          setDesktopResolution((current) =>
            current.remoteWidth === request.width && current.remoteHeight === request.height
              ? current
              : {
                  ...current,
                  remoteWidth: request.width,
                  remoteHeight: request.height,
                },
          );
        }
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

  async function handleDeleteSnapshot(
    vm: VmInstance,
    snapshot: Snapshot,
  ): Promise<void> {
    const confirmed = window.confirm(
      `Delete snapshot "${snapshot.label}" from ${vm.name}? You will no longer be able to launch or restore from it.`,
    );

    if (!confirmed) {
      return;
    }

    await runMutation(
      `Deleting snapshot ${snapshot.label}`,
      async () => {
        await postJson(`/api/vms/${vm.id}/snapshots/${snapshot.id}/delete`, {});
        await refreshSummary();
        await refreshDetail(vm.id);
      },
      `Queued snapshot delete for ${snapshot.label}.`,
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
        <DashboardNoticeStack
          busyLabel={busyLabel}
          notice={notice}
          prominentJob={visibleProminentJob}
          prominentJobTiming={visibleProminentJobTiming}
          onDismissProminentJob={(jobId) =>
            setDismissedProminentJobIds((current) =>
              current[jobId]
                ? current
                : {
                    ...current,
                    [jobId]: true,
                  },
            )}
        />

        <section
          style={workspaceShellStyle}
          className="workspace-shell"
          data-focused={workspaceFocused ? "true" : "false"}
          onClick={(event) => event.stopPropagation()}
        >
          <DashboardWorkspaceRail
            summary={summary}
            appVersionLabel={appVersionLabel}
            authEnabled={authEnabled}
            compactRail={compactRail}
            draggedVmId={draggedVmId}
            effectiveSidePanelCollapsed={effectiveSidePanelCollapsed}
            fullscreenActive={fullscreenActive}
            isBusy={isBusy}
            latestReleaseHref={
              newerReleaseAvailable && latestRelease
                ? buildLatestReleaseTagUrl(latestRelease.version)
                : null
            }
            newerReleaseAvailable={newerReleaseAvailable}
            openVmMenuId={openVmMenuId}
            railRef={railRef}
            railResizeActive={railResizeActive}
            railWidth={railWidth}
            releaseIndicatorSeverity={releaseIndicatorSeverity}
            renderedVms={renderedVms}
            selectedVmId={selectedVmId}
            shellMenuButtonRef={shellMenuButtonRef}
            shellMenuOpen={shellMenuOpen}
            showLivePreviews={showLivePreviews}
            supportsLiveDesktop={supportsLiveDesktop}
            themeMode={themeMode}
            wideShellLayout={wideShellLayout}
            onClone={handleClone}
            onDelete={handleDelete}
            onHideInspector={(vmId) => setVmSidepanelCollapsed(vmId, true)}
            onLogout={() => {
              setShellMenuOpen(false);
              void handleLogout();
            }}
            onOpenCreateDialog={openCreateDialog}
            onOpenHomepage={openHomepage}
            onOpenLogs={openVmLogsDialog}
            onInspectVm={inspectVm}
            onRename={handleRenameVm}
            onResizeKeyDown={handleRailResizeKeyDown}
            onResizePointerDown={handleRailResizeStart}
            onSelectVm={selectVm}
            onSetActiveCpuThreshold={handleSetActiveCpuThreshold}
            onSnapshot={handleSnapshot}
            onToggleFullscreen={() => {
              setShellMenuOpen(false);
              void toggleFullscreen();
            }}
            onToggleLivePreviews={() => {
              setShowLivePreviews((current) => !current);
              setShellMenuOpen(false);
            }}
            onToggleShellMenu={() => {
              setOpenVmMenuId(null);
              setOpenTemplateMenuId(null);
              setShellMenuOpen((current) => !current);
            }}
            onCloseShellMenu={() => setShellMenuOpen(false)}
            onToggleTheme={() => {
              setThemeMode((current) => (current === "dark" ? "light" : "dark"));
              setShellMenuOpen(false);
            }}
            onVmMenuToggle={(vmId) => {
              setShellMenuOpen(false);
              setOpenTemplateMenuId(null);
              setOpenVmMenuId((current) => (current === vmId ? null : vmId));
            }}
            onPowerAction={handleVmAction}
            onVmTileDragEnd={handleVmTileDragEnd}
            onVmTileDragOver={handleVmTileDragOver}
            onVmTileDragStart={handleVmTileDragStart}
            onVmTileDrop={handleVmTileDrop}
            onVmStripDragOver={handleVmStripDragOver}
            onVmStripDrop={handleVmStripDrop}
            resolveActiveCpuThreshold={activeCpuThresholdForVm}
            resolveMirroredStageFrameRef={resolveMirroredStageFrameRef}
          />

          <section className="workspace-stage">
            <div
              className={joinClassNames(
                "workspace-stage__surface",
                selectedVm ? "" : "workspace-stage__surface--idle",
              )}
            >
              {renderStageBrowserHost()}
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
                ) : stageSessionRelinquished && currentDetail ? (
                  <WorkspaceSessionRelinquishedSurface
                    detail={currentDetail}
                    onReconnect={reconnectStageHere}
                  />
                ) : activeStageBrowserVmId ? null : !currentDetail ? (
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
                sessionRecoveryBusy={sessionRecoveryBusyVmId === selectedVm.id}
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
                onKickBrowserStream={kickBrowserStream}
                onReloadBrowserStream={reloadBrowserStream}
                onRepairDesktopBridge={repairDesktopBridge}
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
                onDeleteSnapshot={handleDeleteSnapshot}
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
                canKickBrowserStream={selectedSelkiesRecoveryTarget !== null}
                canReloadBrowserStream={selectedSelkiesRecoveryTarget !== null}
                canRepairDesktopBridge={canRepairSelectedDesktopBridge}
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

      <DashboardDialogsHost
        busy={isBusy}
        cloneVmDialog={cloneVmDialog}
        cloneVmDraft={cloneVmDraft}
        createDraft={createDraft}
        displayedTemplates={displayedTemplates}
        renameDialog={renameDialog}
        renameDraft={renameDraft}
        showCreateDialog={showCreateDialog}
        summary={summary}
        templateCloneDraft={templateCloneDraft}
        templateEditDraft={templateEditDraft}
        vmLogsDialog={vmLogsDialog}
        onCloneDraftChange={setCloneVmDraft}
        onCloseCloneVmDialog={closeCloneVmDialog}
        onCloseCreateDialog={() => setShowCreateDialog(false)}
        onCloseRenameDialog={closeRenameDialog}
        onCloseTemplateCloneDialog={closeTemplateCloneDialog}
        onCloseTemplateEditDialog={closeTemplateEditDialog}
        onCloseVmLogsDialog={closeVmLogsDialog}
        onCloneVmSubmit={handleCloneVmSubmit}
        onCreateFieldChange={handleCreateField}
        onCreateShutdownBeforeCloneChange={handleCreateShutdownBeforeCloneChange}
        onCreateSourceChange={handleCreateSourceChange}
        onCreateSubmit={handleCreate}
        onRefreshVmLogsDialog={refreshVmLogsDialog}
        onRenameDraftChange={setRenameDraft}
        onRenameSubmit={handleRenameSubmit}
        onTemplateCloneFieldChange={handleTemplateCloneField}
        onTemplateCloneSubmit={handleTemplateCloneSubmit}
        onTemplateEditFieldChange={handleTemplateEditField}
        onTemplateEditSubmit={handleEditTemplateSubmit}
      />
    </>
  );
}


function buildLatestReleaseTagUrl(version: string): string {
  return `${githubReleaseTagBaseUrl}${version}`;
}
