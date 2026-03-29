import type {
  CSSProperties,
  FormEvent,
  JSX,
  ReactNode,
} from "react";

import type { VmInstance, VmStatus } from "../../../packages/shared/src/types.js";

export function LoadingShell({ showContent = true }: { showContent?: boolean }): JSX.Element {
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

export function LoginShell({
  busy,
  error,
  loginDraft,
  onFieldChange,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  loginDraft: {
    username: string;
    password: string;
  };
  onFieldChange: (field: "username" | "password", value: string) => void;
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

export function MiniStat({
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

export function StageStat({
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

export function SidepanelSection({
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

export function StaticPatternPreview({
  variant,
  vm,
}: {
  variant: "stage" | "tile";
  vm: VmInstance;
}): JSX.Element {
  return (
    <div
      className={
        variant === "stage"
          ? "pattern-preview pattern-preview--stage"
          : "pattern-preview pattern-preview--tile"
      }
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

export function NumberField({
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

export function StatusBadge({
  children,
  status,
}: {
  children: string;
  status: VmStatus;
}): JSX.Element {
  return <span className={`status-badge ${statusClassName(status)}`}>{children}</span>;
}

export function FieldPair({
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
  const shellClassName = compact ? "field-pair field-pair--compact" : "field-pair";
  const valueClassName = mono ? "field-pair__value mono-font" : "field-pair__value";

  return (
    <div className={shellClassName}>
      <p className="field-pair__label">{label}</p>
      <p className={valueClassName}>{value}</p>
    </div>
  );
}

export function InlineWarningNote({
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
