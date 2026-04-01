import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, RefObject, JSX } from "react";

import type { DashboardSummary, VmInstance, VmPowerAction } from "../../../packages/shared/src/types.js";

import { RailCreateIcon, RailHomeIcon, RailSettingsIcon, VmTile } from "./dashboardRail.js";
import { RailResizeHandle } from "./dashboardSidepanel.js";
import { formatRamUsage, joinClassNames, PortalPopover, TelemetryPanel } from "./dashboardUi.js";
import { providerStatusDotClassName, providerStatusTitle, activeCpuThresholdDefault } from "./dashboardHelpers.js";
import type { ThemeMode } from "./dashboardShell.js";

interface DashboardWorkspaceRailProps {
  summary: DashboardSummary;
  appVersionLabel: string;
  authEnabled: boolean;
  compactRail: boolean;
  draggedVmId: string | null;
  effectiveSidePanelCollapsed: boolean;
  fullscreenActive: boolean;
  isBusy: boolean;
  latestReleaseHref: string | null;
  newerReleaseAvailable: boolean;
  openVmMenuId: string | null;
  railRef: RefObject<HTMLElement | null>;
  railResizeActive: boolean;
  railWidth: number;
  releaseIndicatorSeverity: string | null;
  renderedVms: VmInstance[];
  selectedVmId: string | null;
  shellMenuButtonRef: RefObject<HTMLButtonElement | null>;
  shellMenuOpen: boolean;
  showLivePreviews: boolean;
  supportsLiveDesktop: boolean;
  themeMode: ThemeMode;
  wideShellLayout: boolean;
  onClone: (vm: VmInstance) => Promise<void>;
  onDelete: (vm: VmInstance) => Promise<void>;
  onHideInspector: (vmId: string) => void;
  onLogout: () => void;
  onOpenCreateDialog: () => void;
  onOpenHomepage: () => void;
  onOpenLogs: (vm: VmInstance) => void;
  onPasteLocal: (vm: VmInstance) => void;
  onInspectVm: (vmId: string) => void;
  onRename: (vm: VmInstance) => Promise<void>;
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSelectVm: (vmId: string) => void;
  onSetActiveCpuThreshold: (vm: VmInstance) => void;
  onSnapshot: (vm: VmInstance) => Promise<void>;
  onToggleFullscreen: () => void;
  onToggleLivePreviews: () => void;
  onToggleShellMenu: () => void;
  onCloseShellMenu: () => void;
  onToggleTheme: () => void;
  onVmMenuToggle: (vmId: string) => void;
  onPowerAction: (vmId: string, action: VmPowerAction) => Promise<void>;
  onVmTileDragEnd: () => void;
  onVmTileDragOver: (targetVmId: string, event: React.DragEvent<HTMLElement>) => void;
  onVmTileDragStart: (vmId: string, event: React.DragEvent<HTMLElement>) => void;
  onVmTileDrop: (targetVmId: string, event: React.DragEvent<HTMLElement>) => void;
  onVmStripDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onVmStripDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  resolveActiveCpuThreshold: (vmId: string) => number;
  resolveMirroredStageFrameRef: (vmId: string) => RefObject<HTMLIFrameElement | null> | null;
}

export function collectRunningWorkspaceUsage(
  vms: VmInstance[],
): { cpu: number; ramMb: number } {
  return vms.reduce(
    (usage, vm) => {
      if (vm.status !== "running") {
        return usage;
      }

      usage.cpu += vm.resources.cpu;
      usage.ramMb += vm.resources.ramMb;
      return usage;
    },
    { cpu: 0, ramMb: 0 },
  );
}

export function DashboardWorkspaceRail({
  summary,
  appVersionLabel,
  authEnabled,
  compactRail,
  draggedVmId,
  effectiveSidePanelCollapsed,
  fullscreenActive,
  isBusy,
  latestReleaseHref,
  newerReleaseAvailable,
  openVmMenuId,
  railRef,
  railResizeActive,
  railWidth,
  releaseIndicatorSeverity,
  renderedVms,
  selectedVmId,
  shellMenuButtonRef,
  shellMenuOpen,
  showLivePreviews,
  supportsLiveDesktop,
  themeMode,
  wideShellLayout,
  onClone,
  onDelete,
  onHideInspector,
  onLogout,
  onOpenCreateDialog,
  onOpenHomepage,
  onOpenLogs,
  onPasteLocal,
  onInspectVm,
  onRename,
  onResizeKeyDown,
  onResizePointerDown,
  onSelectVm,
  onSetActiveCpuThreshold,
  onSnapshot,
  onToggleFullscreen,
  onToggleLivePreviews,
  onToggleShellMenu,
  onCloseShellMenu,
  onToggleTheme,
  onVmMenuToggle,
  onPowerAction,
  onVmTileDragEnd,
  onVmTileDragOver,
  onVmTileDragStart,
  onVmTileDrop,
  onVmStripDragOver,
  onVmStripDrop,
  resolveActiveCpuThreshold,
  resolveMirroredStageFrameRef,
}: DashboardWorkspaceRailProps): JSX.Element {
  const runningUsage = collectRunningWorkspaceUsage(summary.vms);

  return (
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
        onResizeKeyDown={onResizeKeyDown}
        onResizePointerDown={onResizePointerDown}
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
                onClick={onOpenHomepage}
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
                onClick={onOpenCreateDialog}
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
                onClick={onToggleShellMenu}
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
                    onClick={onOpenHomepage}
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
                    {newerReleaseAvailable && latestReleaseHref ? (
                      <a
                        className={`workspace-rail__brand-release-indicator${releaseIndicatorSeverity ? ` workspace-rail__brand-release-indicator--${releaseIndicatorSeverity}` : ""}`}
                        href={latestReleaseHref}
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
                  onClick={onToggleShellMenu}
                >
                  ...
                </button>
              </div>

              <div className="chip-row workspace-rail__chips">
                <span className="surface-pill">
                  {runningUsage.cpu}/{summary.metrics.hostCpuCount} CPU
                </span>
                <span className="surface-pill">
                  {formatRamUsage(runningUsage.ramMb, summary.metrics.hostRamMb)}
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
        onClose={onCloseShellMenu}
      >
        {supportsLiveDesktop ? (
          <button
            className={joinClassNames(
              "menu-action",
              "menu-action--split",
              showLivePreviews ? "menu-action--selected" : "",
            )}
            type="button"
            onClick={onToggleLivePreviews}
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
          onClick={onToggleTheme}
        >
          <span>Theme</span>
          <span className="menu-action__state">
            {themeMode === "dark" ? "Dark" : "Light"}
          </span>
        </button>

        <button
          className="menu-action menu-action--split"
          type="button"
          onClick={onToggleFullscreen}
        >
          <span>Fullscreen</span>
          <span className="menu-action__state">{fullscreenActive ? "On" : "Off"}</span>
        </button>

        {authEnabled ? (
          <button
            className="menu-action"
            type="button"
            onClick={onLogout}
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
            onClick={onOpenCreateDialog}
          >
            New VM
          </button>
        </div>
      ) : null}

      <div
        className="vm-strip"
        onDragOver={onVmStripDragOver}
        onDrop={onVmStripDrop}
      >
        {renderedVms.map((vm) => (
          <VmTile
            key={vm.id}
            activeCpuThresholdPercent={resolveActiveCpuThreshold(vm.id)}
            busy={isBusy}
            compact={compactRail}
            dragging={draggedVmId === vm.id}
            inspectorVisible={vm.id === selectedVmId && !effectiveSidePanelCollapsed}
            menuOpen={openVmMenuId === vm.id}
            mirroredStageFrameRef={resolveMirroredStageFrameRef(vm.id)}
            selected={vm.id === selectedVmId}
            showLivePreview={showLivePreviews}
            vm={vm}
            onDragEnd={onVmTileDragEnd}
            onDragOver={onVmTileDragOver}
            onDragStart={onVmTileDragStart}
            onDrop={onVmTileDrop}
            onClone={onClone}
            onDelete={onDelete}
            onHideInspector={() => onHideInspector(vm.id)}
            onOpen={onSelectVm}
            onInspect={onInspectVm}
            onOpenLogs={onOpenLogs}
            onPasteLocal={onPasteLocal}
            onRename={onRename}
            onSetActiveCpuThreshold={onSetActiveCpuThreshold}
            onSnapshot={onSnapshot}
            onPowerAction={onPowerAction}
            onToggleMenu={onVmMenuToggle}
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
  );
}
