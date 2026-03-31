import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import { formatResources, formatTimestamp } from "../../../packages/shared/src/helpers.js";
import type {
  DashboardSummary,
  EnvironmentTemplate,
  HealthStatus,
  Snapshot,
  VmDetail,
  VmDiskUsageSnapshot,
  VmFileBrowserSnapshot,
  VmInstance,
  VmNetworkMode,
  VmPowerAction,
  VmTouchedFilesSnapshot,
} from "../../../packages/shared/src/types.js";

import { TemplateInitCommandsPreview } from "./dashboardDialogs.js";
import {
  buildCaptureDraft,
  buildForwardBrowserHref,
  buildTouchedFileEntryTitle,
  buildVmFileBrowserBreadcrumbs,
  buildVmFileBrowserEntryTitle,
  buildVmFileDownloadHref,
  describeVmNetworkMode,
  diskUsageChipLabel,
  diskUsageSummaryText,
  formatDesktopReadyMs,
  formatDesktopTransportLabel,
  formatTemplateProvenanceKindLabel,
  formatTouchedFileRowMeta,
  formatVmFileBrowserKindToken,
  formatVmFileBrowserRowMeta,
  formatVmNetworkModeLabel,
  incusStorageChipLabel,
  incusStoragePoolLabel,
  incusStorageStatusLabel,
  isDiskUsageAlert,
  persistenceBackendLabel,
  persistenceChipLabel,
  persistenceLocationLabel,
  persistenceStatusLabel,
  resolveRecentTemplateSnapshots,
  type CaptureDraft,
} from "./dashboardHelpers.js";
import {
  FieldPair,
  InlineWarningNote,
  NumberField,
  SidepanelSection,
  StatusBadge,
} from "./dashboardPrimitives.js";
import {
  desktopViewportScaleDefault,
  desktopViewportScaleMax,
  desktopViewportScaleMin,
  desktopViewportScaleStep,
  formatCurrentResolution,
  formatTargetResolution,
  formatViewportResolution,
  formatViewportScaleLabel,
  isSelkiesViewportManagedResolution,
  liveCaptureWarningCopy,
  quickCommands,
  railMaxWidth,
  railMinWidth,
  sidepanelClosedWidth,
  sidepanelMaxWidth,
  type DesktopResolutionMode,
  type DesktopResolutionState,
  type ForwardDraft,
  type ResolutionDraft,
  type ResourceDraft,
} from "./dashboardShell.js";
import {
  formatDiskUsage,
  formatRamUsage,
  formatUsageCount,
  joinClassNames,
  PortalPopover,
} from "./dashboardUi.js";

export interface WorkspaceSidepanelProps {
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
  sessionRecoveryBusy: boolean;
  summary: DashboardSummary;
  touchedFiles: VmTouchedFilesSnapshot | null;
  touchedFilesError: string | null;
  touchedFilesLoading: boolean;
  vm: VmInstance;
  onApplyResolution: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onBrowsePath: (path?: string) => Promise<void>;
  onCaptureDraftChange: (draft: CaptureDraft) => void;
  onClone: (vm: VmInstance) => Promise<void>;
  onCommandDraftChange: (value: string) => void;
  onDelete: (vm: VmInstance) => Promise<void>;
  onForwardDraftChange: (draft: ForwardDraft) => void;
  onRename: (vm: VmInstance) => Promise<void>;
  onResolutionModeChange: (mode: DesktopResolutionMode) => void;
  onResolutionDraftChange: (draft: ResolutionDraft) => void;
  onKickBrowserStream: (vm: VmInstance) => void;
  onReloadBrowserStream: (vm: VmInstance) => void;
  onRepairDesktopBridge: (vm: VmInstance) => Promise<void>;
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
  onDeleteSnapshot: (vm: VmInstance, snapshot: Snapshot) => Promise<void>;
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
  canKickBrowserStream: boolean;
  canReloadBrowserStream: boolean;
  canRepairDesktopBridge: boolean;
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

export interface OverviewSidepanelProps {
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

interface SnapshotCardProps {
  busy: boolean;
  menuOpen: boolean;
  onDeleteSnapshot: (vm: VmInstance, snapshot: Snapshot) => Promise<void>;
  onLaunchFromSnapshot: (vm: VmInstance, snapshot: Snapshot) => Promise<void>;
  onRestoreSnapshot: (vm: VmInstance, snapshot: Snapshot) => Promise<void>;
  onToggleMenu: (snapshotId: string) => void;
  snapshot: Snapshot;
  vm: VmInstance;
}

export function RailResizeHandle({
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

export function WorkspaceSidepanel({
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
  sessionRecoveryBusy,
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
  onKickBrowserStream,
  onReloadBrowserStream,
  onRepairDesktopBridge,
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
  onDeleteSnapshot,
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
  canKickBrowserStream,
  canReloadBrowserStream,
  canRepairDesktopBridge,
  onResizeKeyDown,
  onResizePointerDown,
}: WorkspaceSidepanelProps): JSX.Element {
  const [filesSectionOpen, setFilesSectionOpen] = useState(false);
  const [openSnapshotMenuId, setOpenSnapshotMenuId] = useState<string | null>(null);
  const [touchedFilesSectionOpen, setTouchedFilesSectionOpen] = useState(false);
  const currentNetworkMode = detail?.vm.networkMode ?? "default";
  const resolutionSessionKind =
    detail?.vm.session?.kind ??
    vm.session?.kind ??
    (vm.desktopTransport === "selkies"
      ? "selkies"
      : vm.desktopTransport === "vnc"
        ? "vnc"
        : null);
  const selkiesViewportManaged = isSelkiesViewportManagedResolution({
    mode: resolutionDraft.mode,
    sessionKind: resolutionSessionKind,
  });
  const currentFileBrowser =
    fileBrowser &&
    fileBrowser.vmId === vm.id &&
    fileBrowser.workspacePath === detail?.vm.workspacePath
      ? fileBrowser
      : null;
  const currentTouchedFiles =
    touchedFiles &&
    touchedFiles.vmId === vm.id &&
    touchedFiles.workspacePath === detail?.vm.workspacePath
      ? touchedFiles
      : null;
  const showFileBrowserLoading =
    fileBrowserLoading ||
    (filesSectionOpen && currentFileBrowser === null && fileBrowserError === null);
  const showTouchedFilesLoading =
    touchedFilesLoading ||
    (touchedFilesSectionOpen && currentTouchedFiles === null && touchedFilesError === null);
  const showSelkiesRecoveryControls =
    detail?.vm.session?.kind === "selkies" || vm.desktopTransport === "selkies";

  useEffect(() => {
    if (!detail || !filesSectionOpen || currentFileBrowser) {
      return;
    }

    void onBrowsePath();
  }, [currentFileBrowser, detail, filesSectionOpen, vm.id]);

  useEffect(() => {
    if (!openSnapshotMenuId) {
      return;
    }

    if (detail?.snapshots.some((snapshot) => snapshot.id === openSnapshotMenuId)) {
      return;
    }

    setOpenSnapshotMenuId(null);
  }, [detail, openSnapshotMenuId, vm.id]);

  useEffect(() => {
    if (!detail || !touchedFilesSectionOpen || currentTouchedFiles) {
      return;
    }

    void onRefreshTouchedFiles();
  }, [currentTouchedFiles, detail, touchedFilesSectionOpen, vm.id]);

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
                    <span className="surface-pill">
                      {detail.template?.name ?? "Unlinked template"}
                    </span>
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
                      onClick={() =>
                        onPowerAction(vm.id, vm.status === "running" ? "stop" : "start")
                      }
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

                {showSelkiesRecoveryControls ? (
                  <SidepanelSection title="Recovery" defaultOpen>
                    <p className="empty-copy">
                      If a Selkies desktop sticks on waiting for stream, try these in
                      order: kick the browser stream, reload the frame, repair the guest
                      desktop bridge, then restart the VM if the guest runtime is still wedged.
                    </p>
                    <div className="action-grid">
                      <button
                        className="button button--secondary"
                        type="button"
                        onClick={() => onKickBrowserStream(vm)}
                        disabled={busy || sessionRecoveryBusy || !canKickBrowserStream}
                      >
                        Kick stream
                      </button>
                      <button
                        className="button button--ghost"
                        type="button"
                        onClick={() => onReloadBrowserStream(vm)}
                        disabled={busy || sessionRecoveryBusy || !canReloadBrowserStream}
                      >
                        Reload frame
                      </button>
                      <button
                        className="button button--ghost"
                        type="button"
                        onClick={() => void onRepairDesktopBridge(vm)}
                        disabled={busy || sessionRecoveryBusy || !canRepairDesktopBridge}
                      >
                        {sessionRecoveryBusy ? "Repairing..." : "Repair desktop bridge"}
                      </button>
                    </div>
                  </SidepanelSection>
                ) : null}

                <SidepanelSection title="Session" defaultOpen>
                  <div className="compact-grid">
                    <FieldPair label="Resources" value={formatResources(vm.resources)} />
                    <FieldPair label="Updated" value={formatTimestamp(vm.updatedAt)} />
                    <FieldPair label="Workspace path" mono value={vm.workspacePath} />
                    <FieldPair label="Last action" value={vm.lastAction} />
                    <FieldPair
                      label="Desktop transport"
                      value={formatDesktopTransportLabel(detail.vm)}
                    />
                    <FieldPair
                      label="Browser route"
                      mono
                      value={detail.vm.session?.browserPath ?? "Waiting for browser route"}
                    />
                    <FieldPair
                      label="Browser socket"
                      mono
                      value={
                        detail.vm.session?.kind === "vnc"
                          ? (detail.vm.session.webSocketPath ?? "Waiting for VNC bridge")
                          : detail.vm.session?.kind === "selkies"
                            ? "Handled inside the Selkies page"
                            : "Not applicable"
                      }
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
                    <FieldPair
                      label="Ready in"
                      value={formatDesktopReadyMs(detail.vm.desktopReadyMs)}
                    />
                    <FieldPair
                      label="Ready at"
                      value={
                        detail.vm.desktopReadyAt
                          ? formatTimestamp(detail.vm.desktopReadyAt)
                          : "Pending"
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
                    ) : selkiesViewportManaged ? (
                      <label className="field-shell">
                        <span>Stream scale</span>
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
                            {formatViewportScaleLabel(
                              Number(resolutionDraft.scale) || desktopViewportScaleDefault,
                              {
                                sessionKind: resolutionSessionKind,
                              },
                            )}
                          </span>
                        </div>
                        <p className="empty-copy">
                          100% acts like DPR 1. Increase it toward your browser DPR for a
                          sharper stream, or lower it to reduce guest render load.
                        </p>
                      </label>
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
                            {formatViewportScaleLabel(
                              Number(resolutionDraft.scale) || desktopViewportScaleDefault,
                              {
                                sessionKind: resolutionSessionKind,
                              },
                            )}
                          </span>
                        </div>
                      </label>
                    )}

                    <div className="compact-grid compact-grid--triple">
                      <FieldPair
                        compact
                        label="Current"
                        mono
                        value={formatCurrentResolution(resolutionState, {
                          mode: resolutionDraft.mode,
                          sessionKind: resolutionSessionKind,
                        })}
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
                        value={formatTargetResolution(resolutionDraft, resolutionState, {
                          sessionKind: resolutionSessionKind,
                        })}
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
                          {resolutionControlTakeoverBusy
                            ? "Taking over..."
                            : resolutionControlTakeoverLabel}
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
                    <button
                      className="button button--secondary button--full"
                      type="submit"
                      disabled={busy}
                    >
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

                      <button
                        className="button button--secondary button--full"
                        type="submit"
                        disabled={busy}
                      >
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
                    <button
                      className="button button--secondary button--full"
                      type="submit"
                      disabled={busy}
                    >
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

                <SidepanelSection title="Files" onOpenChange={setFilesSectionOpen}>
                  <div className="stack">
                    <div className="vm-file-browser">
                      <div className="vm-file-browser__head">
                        <nav
                          aria-label="Current folder"
                          className="vm-file-browser__breadcrumb"
                        >
                          {buildVmFileBrowserBreadcrumbs(
                            currentFileBrowser?.currentPath ??
                              currentFileBrowser?.homePath ??
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
                                  disabled={busy || showFileBrowserLoading}
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
                              void onBrowsePath(
                                currentFileBrowser?.homePath ?? detail.vm.workspacePath,
                              )}
                            disabled={busy || showFileBrowserLoading}
                          >
                            Home
                          </button>
                          <button
                            className="button button--ghost"
                            type="button"
                            onClick={() => void onBrowsePath("/")}
                            disabled={busy || showFileBrowserLoading}
                          >
                            Root
                          </button>
                          <button
                            className="button button--ghost"
                            type="button"
                            onClick={() => {
                              if (currentFileBrowser?.parentPath) {
                                void onBrowsePath(currentFileBrowser.parentPath);
                              }
                            }}
                            disabled={
                              busy ||
                              showFileBrowserLoading ||
                              !currentFileBrowser?.parentPath
                            }
                          >
                            Up
                          </button>
                          <button
                            className="button button--secondary"
                            type="button"
                            onClick={() =>
                              void onBrowsePath(
                                currentFileBrowser?.currentPath ??
                                  currentFileBrowser?.homePath ??
                                  detail.vm.workspacePath,
                              )}
                            disabled={busy || showFileBrowserLoading}
                          >
                            {showFileBrowserLoading ? "Refreshing..." : "Refresh"}
                          </button>
                        </div>
                      </div>

                      {fileBrowserError ? <p className="empty-copy">{fileBrowserError}</p> : null}

                      {currentFileBrowser && currentFileBrowser.entries.length > 0 ? (
                        <div className="vm-file-browser__list" role="list">
                          {currentFileBrowser.entries.map((entry) => {
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
                                  disabled={busy || showFileBrowserLoading}
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
                      ) : showFileBrowserLoading ? (
                        <p className="empty-copy">Loading files...</p>
                      ) : (
                        <p className="empty-copy">No files in this folder.</p>
                      )}
                    </div>
                  </div>
                </SidepanelSection>

                <SidepanelSection
                  title="Touched this session"
                  onOpenChange={setTouchedFilesSectionOpen}
                >
                  <div className="stack">
                    <p className="empty-copy">
                      {currentTouchedFiles?.baselineLabel ??
                        "Best effort from workspace timestamps and command-history hints."}
                    </p>
                    <p className="empty-copy">
                      {currentTouchedFiles?.limitationSummary ??
                        "This view is intentionally conservative and may miss or over-report edits."}
                    </p>

                    <div className="action-grid">
                      <button
                        className="button button--secondary"
                        type="button"
                        onClick={() => void onRefreshTouchedFiles()}
                        disabled={busy || showTouchedFilesLoading}
                      >
                        {showTouchedFilesLoading ? "Refreshing..." : "Refresh touched files"}
                      </button>
                    </div>

                    {touchedFilesError ? <p className="empty-copy">{touchedFilesError}</p> : null}

                    {currentTouchedFiles && currentTouchedFiles.entries.length > 0 ? (
                      <div className="vm-file-browser__list" role="list">
                        {currentTouchedFiles.entries.map((entry) => {
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
                                disabled={busy || showTouchedFilesLoading}
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
                    ) : showTouchedFilesLoading ? (
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
                      <label className="field-shell">
                        <span>Template</span>
                        <select
                          className="field-input"
                          value={captureDraft.templateId}
                          onChange={(event) => {
                            const template =
                              summary.templates.find((entry) => entry.id === event.target.value) ??
                              null;

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

                    <button
                      className="button button--secondary button--full"
                      type="submit"
                      disabled={busy}
                    >
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
                              {job.progressPercent !== null &&
                              job.progressPercent !== undefined ? (
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
                        <div key={`${entry}-${index}`} className="log-line mono-font">
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
                        <SnapshotCard
                          key={snapshot.id}
                          busy={busy}
                          menuOpen={openSnapshotMenuId === snapshot.id}
                          onDeleteSnapshot={onDeleteSnapshot}
                          onLaunchFromSnapshot={onLaunchFromSnapshot}
                          onRestoreSnapshot={onRestoreSnapshot}
                          onToggleMenu={(snapshotId) => {
                            setOpenSnapshotMenuId((current) =>
                              current === snapshotId ? null : snapshotId,
                            );
                          }}
                          snapshot={snapshot}
                          vm={vm}
                        />
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

function SnapshotCard({
  busy,
  menuOpen,
  onDeleteSnapshot,
  onLaunchFromSnapshot,
  onRestoreSnapshot,
  onToggleMenu,
  snapshot,
  vm,
}: SnapshotCardProps): JSX.Element {
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div className="list-card">
      <div className="list-card__head">
        <div className="list-card__title-copy">
          <strong>{snapshot.label}</strong>
          <p className="list-card__timestamp">{formatTimestamp(snapshot.createdAt)}</p>
        </div>

        <div className="list-card__menu" onClick={(event) => event.stopPropagation()}>
          <button
            ref={menuButtonRef}
            className={joinClassNames("menu-button", menuOpen ? "menu-button--open" : "")}
            type="button"
            aria-expanded={menuOpen}
            aria-label={`Actions for snapshot ${snapshot.label}`}
            onClick={() => onToggleMenu(snapshot.id)}
          >
            ...
          </button>

          {menuOpen ? (
            <PortalPopover
              anchorRef={menuButtonRef}
              className="list-card__popover"
              open={menuOpen}
              onClose={() => onToggleMenu(snapshot.id)}
            >
              <button
                className="menu-action"
                type="button"
                onClick={() => {
                  onToggleMenu(snapshot.id);
                  void onLaunchFromSnapshot(vm, snapshot);
                }}
                disabled={busy}
              >
                Create VM from snapshot
              </button>
              <button
                className="menu-action"
                type="button"
                onClick={() => {
                  onToggleMenu(snapshot.id);
                  void onRestoreSnapshot(vm, snapshot);
                }}
                disabled={busy}
              >
                Reset current VM to here
              </button>
              <button
                className="menu-action menu-action--danger"
                type="button"
                onClick={() => {
                  onToggleMenu(snapshot.id);
                  void onDeleteSnapshot(vm, snapshot);
                }}
                disabled={busy}
              >
                Delete snapshot
              </button>
            </PortalPopover>
          ) : null}
        </div>
      </div>

      <p>{snapshot.summary}</p>
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

export function OverviewSidepanel({
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
}: OverviewSidepanelProps): JSX.Element {
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
                    value={
                      persistence.lastPersistedAt
                        ? formatTimestamp(persistence.lastPersistedAt)
                        : "Pending"
                    }
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
              <button
                className="button button--secondary button--full"
                type="button"
                onClick={onCreate}
              >
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
