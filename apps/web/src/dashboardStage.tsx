import { useRef, useState, type JSX } from "react";

import { formatTimestamp } from "../../../packages/shared/src/helpers.js";
import type { DashboardSummary, HealthStatus, VmDetail } from "../../../packages/shared/src/types.js";

import type { DesktopBootState } from "./dashboardHelpers.js";
import {
  buildWallpaperNameFromParts,
  buildWallpaperUrl,
  desktopFallbackBadge,
  desktopFallbackMessage,
  homepageWallpaperAdjectives,
  homepageWallpaperAnimals,
  resolveWallpaperSelection,
  workspaceFallbackTitle,
  workspaceLogsMessage,
  workspaceLogsTitle,
} from "./dashboardHelpers.js";
import { StageStat, StaticPatternPreview } from "./dashboardPrimitives.js";
import type { VmLogsViewState } from "./dashboardShell.js";
import { PortalPopover, VmLogOutput } from "./dashboardUi.js";

interface WorkspaceControlLockOverlayProps {
  disabled: boolean;
  message: string;
  takeOverLabel: string;
  takeoverBusy: boolean;
  title: string;
  onTakeOver: () => void;
}

interface WorkspaceBootSurfaceProps {
  state: DesktopBootState;
}

interface WorkspaceLogsSurfaceProps {
  detail: VmDetail;
  logsState: VmLogsViewState;
  onRefreshLogs: () => void;
}

interface WorkspaceFallbackSurfaceProps {
  detail: VmDetail;
}

interface WorkspaceSessionRelinquishedSurfaceProps {
  detail: VmDetail;
  onReconnect: () => void;
}

interface EmptyWorkspaceStageProps {
  homepageWallpaperName: string;
  incusStorage: HealthStatus["incusStorage"] | null;
  onCreate: () => void;
  onHomepageWallpaperChange: (wallpaperName: string) => void;
  summary: DashboardSummary;
}

export function WorkspaceControlLockOverlay({
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

export function EmptyWorkspaceStage({
  homepageWallpaperName,
  incusStorage,
  onCreate,
  onHomepageWallpaperChange,
  summary,
}: EmptyWorkspaceStageProps): JSX.Element {
  const wallpaperMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const [wallpaperMenuOpen, setWallpaperMenuOpen] = useState(false);
  const hasWorkspaces = summary.vms.length > 0;
  const runningJobCount = summary.jobs.filter((job) => job.status === "running").length;
  const wallpaperSelection = resolveWallpaperSelection(homepageWallpaperName);
  const showingDirStorageGuidance = incusStorage?.selectedPoolDriver === "dir";

  return (
    <div
      className="workspace-stage__empty"
      style={{
        backgroundImage: [
          "linear-gradient(180deg, rgba(5, 7, 10, 0.2) 0%, rgba(5, 7, 10, 0.56) 58%, rgba(5, 7, 10, 0.86) 100%)",
          `url("${buildWallpaperUrl(wallpaperSelection.wallpaperName)}")`,
        ].join(", "),
      }}
    >
      <div className="workspace-stage__empty-toolbar">
        <button
          ref={wallpaperMenuButtonRef}
          className="menu-button workspace-stage__menu-button"
          type="button"
          aria-expanded={wallpaperMenuOpen}
          aria-label="Choose homepage wallpaper"
          onClick={() => setWallpaperMenuOpen((current) => !current)}
        >
          ...
        </button>
        <PortalPopover
          anchorPlacement="bottom-end"
          anchorRef={wallpaperMenuButtonRef}
          className="workspace-stage__popover"
          open={wallpaperMenuOpen}
          onClose={() => setWallpaperMenuOpen(false)}
        >
          <div className="workspace-stage__popover-copy">
            <strong>Homepage wallpaper</strong>
            <p>Choose any supported emotion and animal.</p>
          </div>
          <label className="field-shell">
            <span>Emotion</span>
            <select
              className="field-input"
              value={wallpaperSelection.adjective}
              onChange={(event) =>
                onHomepageWallpaperChange(
                  buildWallpaperNameFromParts(
                    event.target.value as (typeof homepageWallpaperAdjectives)[number],
                    wallpaperSelection.animal,
                  ),
                )
              }
            >
              {homepageWallpaperAdjectives.map((adjective) => (
                <option key={adjective} value={adjective}>
                  {adjective}
                </option>
              ))}
            </select>
          </label>
          <label className="field-shell">
            <span>Animal</span>
            <select
              className="field-input"
              value={wallpaperSelection.animal}
              onChange={(event) =>
                onHomepageWallpaperChange(
                  buildWallpaperNameFromParts(
                    wallpaperSelection.adjective,
                    event.target.value as (typeof homepageWallpaperAnimals)[number],
                  ),
                )
              }
            >
              {homepageWallpaperAnimals.map((animal) => (
                <option key={animal} value={animal}>
                  {animal}
                </option>
              ))}
            </select>
          </label>
        </PortalPopover>
      </div>

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

        {showingDirStorageGuidance ? (
          <div className="workspace-stage__notice">
            <div className="workspace-stage__notice-copy">
              <span className="surface-pill surface-pill--warning">Incus dir pool</span>
              <h3 className="workspace-stage__notice-title">Move new VMs to thin LVM</h3>
              <p>
                This host is still landing new VMs on the slow <code>dir</code> storage
                driver. Create a thin, single-file LVM pool and point Parallaize at it so
                create, clone, and snapshot churn stop paying the dir penalty.
              </p>
            </div>
            <div className="workspace-stage__notice-body">
              <div className="workspace-stage__command-block">
                <span>Run this on the host</span>
                <pre className="workspace-stage__command mono-font">sudo incus storage create parallaize-lvm lvm size=200GiB lvm.use_thinpool=true</pre>
              </div>
              <div className="workspace-stage__command-block">
                <span>Add this to /etc/parallaize/parallaize.env</span>
                <pre className="workspace-stage__command mono-font">PARALLAIZE_INCUS_STORAGE_POOL=parallaize-lvm</pre>
              </div>
              <div className="workspace-stage__command-block">
                <span>Then reload Parallaize</span>
                <pre className="workspace-stage__command mono-font">sudo systemctl restart parallaize</pre>
              </div>
            </div>
          </div>
        ) : null}
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

export function WorkspaceBootSurface({ state }: WorkspaceBootSurfaceProps): JSX.Element {
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

export function WorkspaceLogsSurface({
  detail,
  logsState,
  onRefreshLogs,
}: WorkspaceLogsSurfaceProps): JSX.Element {
  return (
    <div className="workspace-log-surface">
      <div className="workspace-log-surface__header">
        <span className="surface-pill surface-pill--busy">
          {desktopFallbackBadge(detail)}
        </span>
        <h2 className="workspace-log-surface__title">{workspaceLogsTitle(detail)}</h2>
        <p className="workspace-log-surface__copy">{workspaceLogsMessage(detail)}</p>
        <div className="workspace-stage__header-actions">
          <button
            className="button button--ghost"
            disabled={logsState.loading || logsState.refreshing}
            type="button"
            onClick={onRefreshLogs}
          >
            {logsState.loading || logsState.refreshing ? "Refreshing logs..." : "Reload logs"}
          </button>
        </div>
        <div className="chip-row vm-logs__meta">
          {logsState.logs ? (
            <span className="surface-pill mono-font">{logsState.logs.providerRef}</span>
          ) : null}
          <span className="surface-pill">{logsState.logs?.source ?? "Loading guest logs..."}</span>
          {logsState.logs ? (
            <span className="surface-pill">Updated {formatTimestamp(logsState.logs.fetchedAt)}</span>
          ) : null}
        </div>
      </div>

      {logsState.error ? <p className="empty-copy">Live stream issue: {logsState.error}</p> : null}

      {logsState.loading && !logsState.logs ? (
        <p className="empty-copy">Loading guest logs...</p>
      ) : null}

      {logsState.logs && logsState.logs.content.trim().length > 0 ? (
        <VmLogOutput
          className="vm-logs__output workspace-log-surface__output mono-font"
          content={logsState.logs.content}
        />
      ) : null}

      {!logsState.loading && logsState.logs && logsState.logs.content.trim().length === 0 ? (
        <p className="empty-copy">No guest log output is available yet.</p>
      ) : null}
    </div>
  );
}

export function WorkspaceFallbackSurface({
  detail,
}: WorkspaceFallbackSurfaceProps): JSX.Element {
  return (
    <div className="workspace-fallback">
      <StaticPatternPreview vm={detail.vm} variant="stage" />
      <div className="workspace-fallback__copy">
        <div className="workspace-fallback__panel">
          <span className="surface-pill surface-pill--busy">{desktopFallbackBadge(detail)}</span>
          <h2 className="workspace-fallback__title">{workspaceFallbackTitle(detail)}</h2>
          <p>{desktopFallbackMessage(detail)}</p>
        </div>
      </div>
    </div>
  );
}

export function WorkspaceSessionRelinquishedSurface({
  detail,
  onReconnect,
}: WorkspaceSessionRelinquishedSurfaceProps): JSX.Element {
  return (
    <div className="workspace-fallback">
      <StaticPatternPreview vm={detail.vm} variant="stage" />
      <div className="workspace-fallback__copy">
        <div className="workspace-fallback__panel">
          <span className="surface-pill surface-pill--busy">Opened elsewhere</span>
          <h2 className="workspace-fallback__title">Opened in another tab</h2>
          <p>
            This workspace is already driving a live Selkies session in another dashboard
            tab. Reconnect here to take over the live desktop.
          </p>
          <button className="button button--secondary" type="button" onClick={onReconnect}>
            Reconnect here
          </button>
        </div>
      </div>
    </div>
  );
}
