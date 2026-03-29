import type { JSX } from "react";

import type { DashboardSummary } from "../../../packages/shared/src/types.js";

import type { Notice } from "./dashboardShell.js";
import { noticeToneClassName } from "./dashboardShell.js";
import { formatJobKindLabel } from "./dashboardHelpers.js";
import { joinClassNames } from "./dashboardUi.js";

interface DashboardNoticeStackProps {
  busyLabel: string | null;
  notice: Notice | null;
  prominentJob: {
    activeCount: number;
    job: DashboardSummary["jobs"][number];
    vmName: string;
  } | null;
  prominentJobTiming: string | null;
  onDismissProminentJob: (jobId: string) => void;
}

export function DashboardNoticeStack({
  busyLabel,
  notice,
  prominentJob,
  prominentJobTiming,
  onDismissProminentJob,
}: DashboardNoticeStackProps): JSX.Element | null {
  if (!notice && !busyLabel && !prominentJob) {
    return null;
  }

  return (
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
            {prominentJobTiming ? (
              <span className="notice-bar__meta">{prominentJobTiming}</span>
            ) : null}
          </div>

          <div className="notice-bar__actions">
            <div className="chip-row">
              <span className="surface-pill">{prominentJob.job.status}</span>
              {prominentJob.job.progressPercent !== null &&
              prominentJob.job.progressPercent !== undefined ? (
                <span className="surface-pill">{prominentJob.job.progressPercent}%</span>
              ) : null}
              {prominentJob.activeCount > 1 ? (
                <span className="surface-pill">{prominentJob.activeCount} active</span>
              ) : null}
            </div>
            <button
              className="button button--ghost notice-bar__dismiss"
              type="button"
              onClick={() => onDismissProminentJob(prominentJob.job.id)}
            >
              Hide
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
