import type { JSX } from "react";

import { formatTimestamp } from "../../../packages/shared/src/helpers.js";
import type { DashboardSummary, VmDetail } from "../../../packages/shared/src/types.js";

import type { DesktopBootState } from "./dashboardHelpers.js";
import {
  desktopFallbackBadge,
  desktopFallbackMessage,
  workspaceFallbackTitle,
  workspaceLogsMessage,
  workspaceLogsTitle,
} from "./dashboardHelpers.js";
import { StageStat, StaticPatternPreview } from "./dashboardPrimitives.js";
import type { VmLogsViewState } from "./dashboardShell.js";
import { VmLogOutput } from "./dashboardUi.js";

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
}

interface WorkspaceFallbackSurfaceProps {
  detail: VmDetail;
}

interface EmptyWorkspaceStageProps {
  onCreate: () => void;
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
  onCreate,
  summary,
}: EmptyWorkspaceStageProps): JSX.Element {
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
}: WorkspaceLogsSurfaceProps): JSX.Element {
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
        <p className="empty-copy">Live stream issue: {logsState.error}</p>
      ) : null}

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
