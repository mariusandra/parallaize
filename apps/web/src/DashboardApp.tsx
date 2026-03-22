import {
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type FormEvent,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import {
  formatRam,
  formatResources,
  formatTimestamp,
} from "../../../packages/shared/src/helpers.js";
import type {
  AuthStatus,
  ApiResponse,
  CaptureTemplateInput,
  CreateVmInput,
  DashboardSummary,
  EnvironmentTemplate,
  HealthStatus,
  InjectCommandInput,
  ResizeVmInput,
  ResourceTelemetry,
  SetVmResolutionInput,
  Snapshot,
  SnapshotLaunchInput,
  SnapshotInput,
  TemplatePortForward,
  VmDetail,
  VmInstance,
  VmPortForward,
  VmStatus,
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
import { NoVncViewport } from "./NoVncViewport.js";

interface CreateDraft {
  templateId: string;
  name: string;
  cpu: string;
  ramMb: string;
  diskGb: string;
}

interface ResourceDraft {
  cpu: string;
  ramMb: string;
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
  owner: ResolutionControlOwner;
  vmId: string | null;
}

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

const emptyCreateDraft: CreateDraft = {
  templateId: "",
  name: "",
  cpu: "",
  ramMb: "",
  diskGb: "",
};

const emptyResourceDraft: ResourceDraft = {
  cpu: "",
  ramMb: "",
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

const defaultLoginDraft: LoginDraft = {
  username: "admin",
  password: "",
};

const quickCommands = ["pwd", "ls -la", "pnpm build", "pnpm test", "incus list"];
const railWidthStorageKey = "parallaize.rail-width";
const overviewSidepanelCollapsedStorageKey = "parallaize.overview-sidepanel-collapsed";
const railCompactWidth = 48;
const railExpandedMinWidth = 248;
const railCompactSnapWidth = Math.round((railCompactWidth + railExpandedMinWidth) / 2);
const railDefaultWidth = 320;
const railMinWidth = railCompactWidth;
const railMaxWidth = 420;
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
const resolutionControlHeartbeatMs = 1_500;
const sidepanelWidthStorageKey = "parallaize.sidepanel-width";
const sidepanelCollapsedByVmStorageKey = "parallaize.sidepanel-collapsed-vms";
const sidepanelClosedWidth = 0;
const sidepanelDefaultWidth = 380;
const sidepanelMinWidth = 320;
const sidepanelMaxWidth = 560;
const sidepanelCollapseSnapWidth = Math.round(sidepanelMinWidth / 2);
const sidepanelCompactBreakpoint = 1120;

const defaultDesktopResolutionPreference: DesktopResolutionPreference = {
  mode: "viewport",
  scale: desktopViewportScaleDefault,
  width: desktopFixedWidthDefault,
  height: desktopFixedHeightDefault,
};

export function DashboardApp(): JSX.Element {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [selectedVmId, setSelectedVmId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VmDetail | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [createDraft, setCreateDraft] = useState<CreateDraft>(emptyCreateDraft);
  const [createDirty, setCreateDirty] = useState(false);
  const [resourceDraft, setResourceDraft] = useState<ResourceDraft>(emptyResourceDraft);
  const [commandDraft, setCommandDraft] = useState("");
  const [forwardDraft, setForwardDraft] = useState<ForwardDraft>(emptyForwardDraft);
  const [captureDraft, setCaptureDraft] = useState<CaptureDraft>(emptyCaptureDraft);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
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
  const [shellMenuOpen, setShellMenuOpen] = useState(false);
  const [fullscreenActive, setFullscreenActive] = useState(() => readFullscreenActive());
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readThemeMode());
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
      owner: "none",
      vmId: null,
    });
  const [railResizeActive, setRailResizeActive] = useState(false);
  const [sidepanelResizeActive, setSidepanelResizeActive] = useState(false);
  const selectedVmIdRef = useRef<string | null>(null);
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
    owner: "none",
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
  const isBusy = busyLabel !== null;
  const currentDetail = selectedVm && detail?.vm.id === selectedVm.id ? detail : null;
  const liveResolutionVmId =
    currentDetail?.vm.status === "running" &&
    currentDetail.vm.session?.kind === "vnc" &&
    currentDetail.vm.session.webSocketPath
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
  const resolutionControlMessage = blocksLiveResolutionControl
    ? "Another tab is currently controlling live viewport sync for this VM. Close or switch that tab to take over."
    : null;
  const supportsLiveDesktop = summary?.provider.desktopTransport === "novnc";
  const persistence = health?.persistence ?? null;
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
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (!liveResolutionVmId || !documentVisible) {
      setResolutionControlStatus({
        owner: "none",
        vmId: liveResolutionVmId,
      });
      clearResolutionRetryTimer();
      resolutionRequestQueueRef.current = emptyResolutionRequestQueue;
      return;
    }

    const vmId = liveResolutionVmId;

    function syncResolutionControlLease(): void {
      const owner = claimResolutionControlLease(vmId, tabIdRef.current);

      setResolutionControlStatus((current) =>
        current.vmId === vmId && current.owner === owner
          ? current
          : {
              owner,
              vmId,
            },
      );

      if (owner !== "self") {
        clearResolutionRetryTimer();
        resolutionRequestQueueRef.current = emptyResolutionRequestQueue;
      }
    }

    syncResolutionControlLease();
    const heartbeat = window.setInterval(syncResolutionControlLease, resolutionControlHeartbeatMs);
    const leaseKey = buildResolutionControlLeaseStorageKey(vmId);
    const releaseLease = () => {
      releaseResolutionControlLease(vmId, tabIdRef.current);
    };

    function handleStorage(event: StorageEvent): void {
      if (event.key === null || event.key === leaseKey) {
        syncResolutionControlLease();
      }
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener("beforeunload", releaseLease);
    window.addEventListener("pagehide", releaseLease);

    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("beforeunload", releaseLease);
      window.removeEventListener("pagehide", releaseLease);
      releaseLease();
    };
  }, [documentVisible, liveResolutionVmId]);

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
    if (!summary?.templates.length) {
      return;
    }

    setCreateDraft((current) => syncCreateDraft(current, summary.templates, createDirty));
  }, [summary?.templates, createDirty]);

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
    if (!detail) {
      setResourceDraft(emptyResourceDraft);
      return;
    }

    setResourceDraft({
      cpu: String(detail.vm.resources.cpu),
      ramMb: String(detail.vm.resources.ramMb),
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

  function requireLogin(): void {
    setAuthState("required");
    setHealth(null);
    setSummary(null);
    setDetail(null);
    setNotice(null);
    setBusyLabel(null);
    setShellMenuOpen(false);
    setOpenVmMenuId(null);
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

    const payload: CreateVmInput = {
      templateId: createDraft.templateId,
      name: createDraft.name.trim(),
      resources: {
        cpu: Number(createDraft.cpu),
        ramMb: Number(createDraft.ramMb),
        diskGb: Number(createDraft.diskGb),
      },
    };

    await runMutation(
      `Creating ${payload.name || "workspace"}`,
      async () => {
        const createdVm = await postJson<VmInstance>("/api/vms", payload);
        setCreateDirty(false);
        const template = summary?.templates.find((entry) => entry.id === payload.templateId) ?? null;
        if (template) {
          setCreateDraft(buildCreateDraft(template));
        }
        setVmSidepanelCollapsed(createdVm.id, false);
        setSelectedVmId(createdVm.id);
        setShowCreateDialog(false);
        await refreshSummary();
        await refreshDetail(createdVm.id);
      },
      `Queued create for ${payload.name}.`,
    );
  }

  function handleCreateField(field: keyof CreateDraft, value: string): void {
    setCreateDirty(true);
    setCreateDraft((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function handleTemplateChange(event: ChangeEvent<HTMLSelectElement>): void {
    if (!summary) {
      return;
    }

    const template = summary.templates.find((entry) => entry.id === event.target.value);

    if (!template) {
      return;
    }

    setCreateDirty(false);
    setCreateDraft(buildCreateDraft(template, createDraft.name));
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
    setShellMenuOpen(false);
  }

  function openHomepage(): void {
    setSelectedVmId(null);
    setOpenVmMenuId(null);
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
    setShellMenuOpen(false);
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
    action: "start" | "stop",
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
    const name = window.prompt("Clone name", `${vm.name}-clone`)?.trim();

    if (!name) {
      return;
    }

    await runMutation(
      `Cloning ${vm.name}`,
      async () => {
        const clone = await postJson<VmInstance>(`/api/vms/${vm.id}/clone`, {
          sourceVmId: vm.id,
          name,
        });
        setVmSidepanelCollapsed(clone.id, false);
        setSelectedVmId(clone.id);
        await refreshSummary();
        await refreshDetail(clone.id);
      },
      `Queued clone for ${vm.name}.`,
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

  async function handleResize(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!detail) {
      return;
    }

    const payload: ResizeVmInput = {
      resources: {
        cpu: Number(resourceDraft.cpu),
        ramMb: Number(resourceDraft.ramMb),
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

    return <LoadingShell />;
  }

  const workspaceFocused = selectedVm !== null;
  const prominentJob = findProminentJob(summary, selectedVmId);

  return (
    <>
      <main
        className="app-shell"
        onClick={() => {
          setOpenVmMenuId(null);
          setShellMenuOpen(false);
        }}
      >
        {notice || busyLabel || prominentJob ? (
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

            {prominentJob ? (
              <div className="notice-bar notice-bar--info">
                <div className="notice-bar__copy">
                  <strong className="notice-bar__title">
                    {prominentJob.vmName} · {formatJobKindLabel(prominentJob.job.kind)}
                  </strong>
                  <span>{prominentJob.job.message || "Action in progress"}</span>
                </div>

                <div className="chip-row">
                  <span className="surface-pill">{prominentJob.job.status}</span>
                  {prominentJob.job.progressPercent !== null &&
                  prominentJob.job.progressPercent !== undefined ? (
                    <span className="surface-pill">{prominentJob.job.progressPercent}%</span>
                  ) : null}
                  {prominentJob.activeCount > 1 ? (
                    <span className="surface-pill">
                      {prominentJob.activeCount} active
                    </span>
                  ) : null}
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
                      onClick={() => setShowCreateDialog(true)}
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
                        setShellMenuOpen((current) => !current);
                      }}
                    >
                      <RailSettingsIcon />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="workspace-rail__topbar">
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
                  onClick={() => setShowCreateDialog(true)}
                >
                  New VM
                </button>
              </div>
            ) : null}

            <div className="vm-strip">
              {deferredVms.map((vm) => (
                <VmTile
                  key={vm.id}
                  busy={isBusy}
                  compact={compactRail}
                  menuOpen={openVmMenuId === vm.id}
                  selected={vm.id === selectedVmId}
                  showLivePreview={showLivePreviews}
                  vm={vm}
                  onClone={handleClone}
                  onDelete={handleDelete}
                  onOpen={selectVm}
                  onInspect={inspectVm}
                  onSnapshot={handleSnapshot}
                  onStartStop={handleVmAction}
                  onToggleMenu={(vmId) =>
                    setOpenVmMenuId((current) => (current === vmId ? null : vmId))
                  }
                />
              ))}

              {deferredVms.length === 0 && !compactRail ? (
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
                ) : getVmDesktopBootState(currentDetail) ? (
                  <WorkspaceBootSurface state={getVmDesktopBootState(currentDetail)!} />
                ) : currentDetail.vm.session?.kind === "vnc" &&
                  currentDetail.vm.session.webSocketPath ? (
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
                        viewportMode={
                          desktopResolutionMode === "viewport" ? "scale" : "fit"
                        }
                        webSocketPath={currentDetail.vm.session.webSocketPath}
                        showHeader={false}
                        statusMode="overlay"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="workspace-fallback">
                    <StaticPatternPreview vm={currentDetail.vm} variant="stage" />
                    <div className="workspace-fallback__copy">
                      <span className="surface-pill surface-pill--busy">
                        {desktopFallbackBadge(currentDetail)}
                      </span>
                      <p>{desktopFallbackMessage(currentDetail)}</p>
                    </div>
                  </div>
                )
              ) : (
                <EmptyWorkspaceStage
                  summary={summary}
                  onCreate={() => setShowCreateDialog(true)}
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
                forwardDraft={forwardDraft}
                resolutionControlBlocked={blocksLiveResolutionControl}
                resolutionControlMessage={resolutionControlMessage}
                resolutionDraft={resolutionDraft}
                resolutionState={effectiveDesktopResolution}
                resourceDraft={resourceDraft}
                summary={summary}
                vm={selectedVm}
                onCaptureDraftChange={setCaptureDraft}
                onClone={handleClone}
                onCommandDraftChange={setCommandDraft}
                onDelete={handleDelete}
                onForwardDraftChange={setForwardDraft}
                onResolutionModeChange={(mode) => applyResolutionMode(selectedVm.id, mode)}
                onResolutionDraftChange={setResolutionDraft}
                onViewportScaleChange={(scale) =>
                  applyViewportScalePreference(selectedVm.id, scale)}
                onRemoveForward={handleRemoveForward}
                onResourceDraftChange={setResourceDraft}
                onApplyResolution={handleApplyResolution}
                onResize={handleResize}
                onSaveForward={handleAddForward}
                onLaunchFromSnapshot={handleLaunchFromSnapshot}
                onSnapshot={handleSnapshot}
                onStartStop={handleVmAction}
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
                collapsed={effectiveSidePanelCollapsed}
                persistence={persistence}
                summary={summary}
                onCreate={() => setShowCreateDialog(true)}
                onClosedResizeStart={handleSidepanelClosedResizeStart}
                onOpenCollapsed={() => setOverviewSidepanelCollapsed(false)}
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
          templates={deferredTemplates}
          onClose={() => setShowCreateDialog(false)}
          onFieldChange={handleCreateField}
          onSubmit={handleCreate}
          onTemplateChange={handleTemplateChange}
        />
      ) : null}
    </>
  );
}

interface CreateVmDialogProps {
  busy: boolean;
  createDraft: CreateDraft;
  templates: EnvironmentTemplate[];
  onClose: () => void;
  onFieldChange: (field: keyof CreateDraft, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onTemplateChange: (event: ChangeEvent<HTMLSelectElement>) => void;
}

function CreateVmDialog({
  busy,
  createDraft,
  templates,
  onClose,
  onFieldChange,
  onSubmit,
  onTemplateChange,
}: CreateVmDialogProps): JSX.Element {
  const selectedTemplate =
    templates.find((entry) => entry.id === createDraft.templateId) ?? templates[0] ?? null;

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <section className="dialog-panel" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-panel__header">
          <div>
            <p className="workspace-shell__eyebrow">Create workspace</p>
            <h2 className="dialog-panel__title">Launch a VM</h2>
            <p className="dialog-panel__copy">
              Keep the rail lean. Launch from a template here, then manage the rest in the
              sidepanel.
            </p>
          </div>
          <button className="button button--ghost" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <form className="dialog-panel__form" onSubmit={onSubmit}>
          <label className="field-shell">
            <span>Template</span>
            <select
              className="field-input"
              value={createDraft.templateId}
              onChange={onTemplateChange}
              disabled={busy}
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>

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
              label="RAM MB"
              value={createDraft.ramMb}
              onChange={(value) => onFieldChange("ramMb", value)}
            />
            <NumberField
              disabled={busy}
              label="Disk GB"
              value={createDraft.diskGb}
              onChange={(value) => onFieldChange("diskGb", value)}
            />
          </div>

          {selectedTemplate ? (
            <div className="dialog-panel__template">
              <div className="dialog-panel__template-head">
                <strong>{selectedTemplate.name}</strong>
                <span className="surface-pill">{formatResources(selectedTemplate.defaultResources)}</span>
              </div>
              <p>{selectedTemplate.description}</p>
              {selectedTemplate.defaultForwardedPorts.length > 0 ? (
                <div className="chip-row">
                  {selectedTemplate.defaultForwardedPorts.map((port) => (
                    <span key={`${port.name}-${port.guestPort}`} className="surface-pill">
                      {port.name}:{port.guestPort}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <button className="button button--primary button--full" type="submit" disabled={busy}>
            Queue workspace
          </button>
        </form>
      </section>
    </div>
  );
}

interface VmTileProps {
  busy: boolean;
  compact: boolean;
  menuOpen: boolean;
  selected: boolean;
  showLivePreview: boolean;
  vm: VmInstance;
  onClone: (vm: VmInstance) => Promise<void>;
  onDelete: (vm: VmInstance) => Promise<void>;
  onInspect: (vmId: string) => void;
  onOpen: (vmId: string) => void;
  onSnapshot: (vm: VmInstance) => Promise<void>;
  onStartStop: (vmId: string, action: "start" | "stop") => Promise<void>;
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
  busy,
  compact,
  menuOpen,
  selected,
  showLivePreview,
  vm,
  onClone,
  onDelete,
  onInspect,
  onOpen,
  onSnapshot,
  onStartStop,
  onToggleMenu,
}: VmTileProps): JSX.Element {
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const canShowLivePreview =
    showLivePreview &&
    vm.status === "running" &&
    vm.session?.kind === "vnc" &&
    Boolean(vm.session.webSocketPath);
  const previewLabel = vmTilePreviewLabel(vm, showLivePreview);
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
          {selected ? (
            <button
              className="menu-action"
              type="button"
              onClick={() => {
                onInspect(vm.id);
              }}
            >
              Inspect
            </button>
          ) : null}
          <button
            className="menu-action"
            type="button"
            onClick={() => {
              onToggleMenu(vm.id);
              void onStartStop(vm.id, vm.status === "running" ? "stop" : "start");
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
    return (
      <article
        className={joinClassNames(
          "vm-tile",
          selected ? "vm-tile--active" : "",
          "vm-tile--compact",
        )}
      >
        <button
          className="vm-tile__compact-trigger"
          type="button"
          aria-label={`Open ${vm.name}`}
          title={`${vm.name} · ${vm.status}`}
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
            )}
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
        selected ? "vm-tile--active" : "",
      )}
    >
      <button className="vm-tile__open" type="button" onClick={() => onOpen(vm.id)}>
        <div className="vm-tile__preview">
          {canShowLivePreview && vm.session?.webSocketPath ? (
            <NoVncViewport
              className="vm-tile__viewport"
              surfaceClassName="vm-tile__canvas"
              webSocketPath={vm.session.webSocketPath}
              viewportMode="scale"
              viewOnly
              showHeader={false}
              statusMode="overlay"
            />
          ) : (
            <>
              <StaticPatternPreview vm={vm} variant="tile" />
              <span className="vm-tile__preview-note">{previewLabel}</span>
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

          <TelemetryPanel telemetry={vm.telemetry} />

          <div className="vm-tile__meta">
            <span>{formatForwardCount(vm.forwardedPorts.length)}</span>
          </div>
        </div>
      </button>
      {menu}
    </article>
  );
}

function TelemetryPanel({
  compact = false,
  label,
  telemetry,
}: {
  compact?: boolean;
  label?: string;
  telemetry?: ResourceTelemetry;
}): JSX.Element {
  const chartWidth = compact ? 180 : 240;
  const chartHeight = compact ? 20 : 24;
  const cpuHistory = telemetry?.cpuHistory.length ? telemetry.cpuHistory : [0];
  const ramHistory = telemetry?.ramHistory.length ? telemetry.ramHistory : [0];

  return (
    <div className={joinClassNames("telemetry-panel", compact ? "telemetry-panel--compact" : "")}>
      <div className="telemetry-panel__head">
        {label ? <span className="telemetry-panel__label">{label}</span> : <span />}
        <span className="telemetry-panel__stats">
          <span className="telemetry-panel__metric telemetry-panel__metric--cpu">
            CPU {formatTelemetryPercent(telemetry?.cpuPercent)}
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

interface PortalPopoverProps {
  anchorPlacement?: "bottom-start" | "bottom-end" | "right-start";
  anchorRef: { current: HTMLElement | null };
  children: ReactNode;
  className?: string;
  open: boolean;
  onClose: () => void;
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

      if (!anchor) {
        setStyle(null);
        return;
      }

      const bounds = anchor.getBoundingClientRect();
      const nextStyle: CSSProperties = {
        position: "fixed",
        zIndex: 80,
      };

      if (anchorPlacement === "right-start") {
        nextStyle.top = Math.max(12, bounds.top);
        nextStyle.left = Math.max(12, bounds.right + 6);
      } else {
        nextStyle.top = bounds.bottom + 8;

        if (anchorPlacement === "bottom-start") {
          nextStyle.left = Math.max(12, bounds.left);
        } else {
          nextStyle.right = Math.max(12, window.innerWidth - bounds.right);
        }
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

  if (!open || !style || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      ref={popoverRef}
      className={joinClassNames("portal-popover", className)}
      style={style}
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
  forwardDraft: ForwardDraft;
  resolutionControlBlocked: boolean;
  resolutionControlMessage: string | null;
  resolutionDraft: ResolutionDraft;
  resolutionState: DesktopResolutionState;
  resourceDraft: ResourceDraft;
  summary: DashboardSummary;
  vm: VmInstance;
  onApplyResolution: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onCaptureDraftChange: (draft: CaptureDraft) => void;
  onClone: (vm: VmInstance) => Promise<void>;
  onCommandDraftChange: (value: string) => void;
  onDelete: (vm: VmInstance) => Promise<void>;
  onForwardDraftChange: (draft: ForwardDraft) => void;
  onResolutionModeChange: (mode: DesktopResolutionMode) => void;
  onResolutionDraftChange: (draft: ResolutionDraft) => void;
  onViewportScaleChange: (scale: number) => void;
  onRemoveForward: (forwardId: string) => Promise<void>;
  onResourceDraftChange: (draft: ResourceDraft) => void;
  onResize: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSaveForward: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSnapshot: (vm: VmInstance) => Promise<void>;
  onStartStop: (vmId: string, action: "start" | "stop") => Promise<void>;
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
  );
}

function WorkspaceSidepanel({
  busy,
  captureDraft,
  collapsed,
  commandDraft,
  detail,
  forwardDraft,
  resolutionControlBlocked,
  resolutionControlMessage,
  resolutionDraft,
  resolutionState,
  resourceDraft,
  summary,
  vm,
  onApplyResolution,
  onCaptureDraftChange,
  onClone,
  onCommandDraftChange,
  onDelete,
  onForwardDraftChange,
  onResolutionModeChange,
  onResolutionDraftChange,
  onViewportScaleChange,
  onRemoveForward,
  onResourceDraftChange,
  onResize,
  onSaveForward,
  onLaunchFromSnapshot,
  onSnapshot,
  onStartStop,
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
              </div>
            </section>

            <SidepanelSection title="Actions" defaultOpen>
              <div className="action-grid">
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() =>
                    onStartStop(vm.id, vm.status === "running" ? "stop" : "start")
                  }
                  disabled={busy}
                >
                  {vm.status === "running" ? "Stop" : "Start"}
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
                  <p className="empty-copy">{resolutionControlMessage}</p>
                ) : null}
              </form>
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
                      label="RAM MB"
                      value={resourceDraft.ramMb}
                      onChange={(value) =>
                        onResourceDraftChange({
                          ...resourceDraft,
                          ramMb: value,
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
                        </div>
                        <a
                          className="button button--secondary button--full"
                          href={forward.publicPath}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open service
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
        <p className="workspace-boot__message">{state.message}</p>
      </div>
    </div>
  );
}

function OverviewSidepanel({
  collapsed,
  onCreate,
  onClosedResizeStart,
  onOpenCollapsed,
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
  collapsed: boolean;
  onCreate: () => void;
  onClosedResizeStart: (pointerClientX: number, handleCenterX: number) => void;
  onOpenCollapsed: () => void;
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
  const recentJobs = summary.jobs.slice().reverse().slice(0, 5);

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
                    summary.provider.available ? "surface-pill--success" : "surface-pill--warning",
                  )}
                >
                  {summary.provider.available ? "Ready" : "Blocked"}
                </span>
              </div>

              <p className="empty-copy">{summary.provider.detail}</p>
              {persistence ? (
                <p className="empty-copy">{persistenceSummaryCopy(persistence)}</p>
              ) : null}

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

            <SidepanelSection title="Templates">
              <div className="stack">
                {summary.templates.length > 0 ? (
                  summary.templates.map((template) => (
                    <div key={template.id} className="list-card">
                      <div className="list-card__head">
                        <strong>{template.name}</strong>
                        <span className="surface-pill">{formatResources(template.defaultResources)}</span>
                      </div>
                      <p>{template.description}</p>
                    </div>
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

function LoadingShell(): JSX.Element {
  return (
    <main className="loading-shell">
      <div className="loading-shell__panel">
        <p className="workspace-shell__eyebrow">Parallaize Control Plane</p>
        <h1 className="loading-shell__title">Loading dashboard</h1>
        <p className="loading-shell__copy">
          Fetching provider state, templates, workspaces, and recent jobs.
        </p>
      </div>
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
            The dashboard now uses an in-app single-admin session instead of the browser’s
            native Basic Auth prompt.
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
  children: JSX.Element | JSX.Element[];
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
  disabled,
  label,
  onChange,
  value,
}: {
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
        inputMode="numeric"
        pattern="[0-9]*"
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

function InlineWarningNote({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="inline-note inline-note--warning">
      <strong>Running VM</strong>
      <p>{children}</p>
    </div>
  );
}

function syncCreateDraft(
  current: CreateDraft,
  templates: EnvironmentTemplate[],
  preserveInput: boolean,
): CreateDraft {
  const template =
    templates.find((entry) => entry.id === current.templateId) ?? templates[0] ?? null;

  if (!template) {
    return current;
  }

  if (preserveInput && current.templateId) {
    return current;
  }

  return buildCreateDraft(template, current.name);
}

function buildCreateDraft(
  template: EnvironmentTemplate,
  name = "",
): CreateDraft {
  return {
    templateId: template.id,
    name,
    cpu: String(template.defaultResources.cpu),
    ramMb: String(template.defaultResources.ramMb),
    diskGb: String(template.defaultResources.diskGb),
  };
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

function persistenceSummaryCopy(persistence: HealthStatus["persistence"]): string {
  const backend = persistenceBackendLabel(persistence.kind);

  if (persistence.status === "degraded") {
    return persistence.lastPersistError
      ? `${backend} persistence is degraded. ${persistence.lastPersistError}`
      : `${backend} persistence is degraded.`;
  }

  if (!persistence.lastPersistedAt) {
    return `${backend} persistence is ready and waiting for the next write.`;
  }

  return `${backend} persistence last wrote at ${formatTimestamp(persistence.lastPersistedAt)}.`;
}

function providerStatusTitle(provider: DashboardSummary["provider"]): string {
  const status =
    provider.hostStatus === "ready"
      ? "Ready"
      : provider.hostStatus === "missing-cli"
        ? "CLI missing"
        : provider.hostStatus === "daemon-unreachable"
          ? "Daemon unreachable"
          : "Error";

  return `${capitalizeWord(provider.kind)} ${status}. ${provider.detail}`;
}

function providerStatusDotClassName(provider: DashboardSummary["provider"]): string {
  switch (provider.hostStatus) {
    case "ready":
      return "workspace-rail__status-dot--ready";
    case "missing-cli":
    case "daemon-unreachable":
      return "workspace-rail__status-dot--warning";
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
  const activeJobs = summary.jobs.filter(
    (job) => job.status === "queued" || job.status === "running",
  );

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

interface DesktopBootState {
  label: string;
  message: string;
  progressPercent: number | null;
}

function getVmDesktopBootState(detail: VmDetail): DesktopBootState | null {
  const failedBootJob = detail.recentJobs.find(
    (job) =>
      (job.kind === "create" ||
        job.kind === "clone" ||
        job.kind === "launch-snapshot" ||
        job.kind === "start") &&
      job.status === "failed",
  );

  if (failedBootJob) {
    return null;
  }

  const activeJob = detail.recentJobs.find(
    (job) =>
      (job.kind === "create" ||
        job.kind === "clone" ||
        job.kind === "launch-snapshot" ||
        job.kind === "start") &&
      (job.status === "queued" || job.status === "running"),
  );

  if (!activeJob && detail.vm.status !== "creating") {
    return null;
  }

  if (activeJob?.kind === "start") {
    return {
      label: "Booting workspace",
      message: activeJob.message || "Starting the VM and waiting for the desktop.",
      progressPercent: activeJob.progressPercent ?? null,
    };
  }

  if (activeJob?.kind === "clone") {
    return {
      label: "Cloning workspace",
      message: activeJob.message || "Cloning the workspace and preparing the desktop.",
      progressPercent: activeJob.progressPercent ?? null,
    };
  }

  if (activeJob?.kind === "launch-snapshot") {
    return {
      label: "Launching snapshot",
      message:
        activeJob.message || "Launching the workspace from a snapshot and waiting for the desktop.",
      progressPercent: activeJob.progressPercent ?? null,
    };
  }

  return {
    label: "Creating workspace",
    message: activeJob?.message || "Provisioning the VM and waiting for the desktop.",
    progressPercent: activeJob?.progressPercent ?? null,
  };
}

function desktopFallbackBadge(detail: VmDetail): string {
  const failedBootJob = detail.recentJobs.find(
    (job) =>
      (job.kind === "create" ||
        job.kind === "clone" ||
        job.kind === "launch-snapshot" ||
        job.kind === "start") &&
      job.status === "failed",
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

function desktopFallbackMessage(detail: VmDetail): string {
  const failedBootJob = detail.recentJobs.find(
    (job) =>
      (job.kind === "create" ||
        job.kind === "clone" ||
        job.kind === "launch-snapshot" ||
        job.kind === "start") &&
      job.status === "failed",
  );

  if (failedBootJob) {
    return failedBootJob.message;
  }

  if (detail.provider.desktopTransport === "synthetic" || detail.vm.session?.kind === "synthetic") {
    return "This server is running the mock provider, so the dashboard renders generated desktop frames instead of a live browser VNC session.";
  }

  if (detail.vm.status !== "running") {
    return "Start the VM to attach a browser desktop. Until then the dashboard keeps showing the latest generated frame.";
  }

  return "This VM does not have a browser VNC session yet. The synthetic frame stays here until the guest publishes a reachable desktop endpoint.";
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

function formatForwardCount(count: number): string {
  if (count === 0) {
    return "No services";
  }

  return `${count} service${count === 1 ? "" : "s"}`;
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

function createTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function claimResolutionControlLease(
  vmId: string,
  tabId: string,
): ResolutionControlOwner {
  if (typeof window === "undefined") {
    return "self";
  }

  const key = buildResolutionControlLeaseStorageKey(vmId);
  const now = Date.now();
  const existingLease = parseResolutionControlLease(readStoredString(key));

  if (
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

async function postJson<T = unknown>(path: string, body: unknown): Promise<T> {
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
