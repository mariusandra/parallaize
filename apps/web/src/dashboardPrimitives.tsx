import type {
  CSSProperties,
  FormEvent,
  JSX,
  RefObject,
  ReactNode,
} from "react";
import { useEffect, useRef, useState } from "react";

import type { VmInstance, VmStatus } from "../../../packages/shared/src/types.js";

const PREVIEW_IMAGE_REFRESH_MS = 15_000;

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
  onOpenChange,
  title,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
}): JSX.Element {
  return (
    <details
      className="sidepanel-section"
      open={defaultOpen}
      onToggle={(event) => onOpenChange?.(event.currentTarget.open)}
    >
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

type PreviewMediaElement =
  | HTMLCanvasElement
  | HTMLImageElement
  | HTMLVideoElement;

function resolvePreviewMedia(
  sourceDocument: Document | null,
): PreviewMediaElement | null {
  const video = sourceDocument?.querySelector("video");

  if (video instanceof HTMLVideoElement) {
    return video;
  }

  const image = sourceDocument?.querySelector("img");

  if (image instanceof HTMLImageElement) {
    return image;
  }

  const canvas = sourceDocument?.querySelector("canvas");
  return canvas instanceof HTMLCanvasElement ? canvas : null;
}

function readPreviewMediaDimensions(sourceMedia: PreviewMediaElement): {
  height: number;
  width: number;
} {
  if (sourceMedia instanceof HTMLVideoElement) {
    return sourceMedia.readyState >= 2
      ? {
          height: sourceMedia.videoHeight,
          width: sourceMedia.videoWidth,
        }
      : {
          height: 0,
          width: 0,
        };
  }

  if (sourceMedia instanceof HTMLImageElement) {
    return sourceMedia.complete
      ? {
          height: sourceMedia.naturalHeight,
          width: sourceMedia.naturalWidth,
        }
      : {
          height: 0,
          width: 0,
        };
  }

  return {
    height: sourceMedia.height,
    width: sourceMedia.width,
  };
}

export function MirroredStagePreview({
  label,
  paused = false,
  sourceFrameRef,
}: {
  label: string;
  paused?: boolean;
  sourceFrameRef: RefObject<HTMLIFrameElement | null>;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let intervalId = 0;

    const paintFrame = () => {
      const canvas = canvasRef.current;
      const sourceFrame = sourceFrameRef.current;

      if (!canvas || !sourceFrame) {
        return;
      }

      try {
        const sourceDocument =
          sourceFrame.contentDocument ?? sourceFrame.contentWindow?.document ?? null;
        const sourceMedia = resolvePreviewMedia(sourceDocument);

        if (
          !(sourceMedia instanceof HTMLVideoElement) &&
          !(sourceMedia instanceof HTMLImageElement) &&
          !(sourceMedia instanceof HTMLCanvasElement)
        ) {
          return;
        }

        const {
          height: sourceHeight,
          width: sourceWidth,
        } = readPreviewMediaDimensions(sourceMedia);

        if (sourceWidth <= 0 || sourceHeight <= 0) {
          return;
        }

        if (
          canvas.width !== sourceWidth ||
          canvas.height !== sourceHeight
        ) {
          canvas.width = sourceWidth;
          canvas.height = sourceHeight;
        }

        const context = canvas.getContext("2d");

        if (!context) {
          return;
        }

        context.drawImage(sourceMedia, 0, 0, canvas.width, canvas.height);
      } catch {
        // Same-origin access is expected, but keep the rail stable if the frame is mid-navigation.
      }
    };

    if (paused) {
      return;
    }

    paintFrame();
    intervalId = window.setInterval(paintFrame, 120);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [paused, sourceFrameRef]);

  return <canvas ref={canvasRef} aria-label={label} />;
}

export function PollingImagePreview({
  label,
  onLoad,
  src,
}: {
  label: string;
  onLoad?: () => void;
  src: string;
}): JSX.Element {
  const [refreshIndex, setRefreshIndex] = useState(0);

  useEffect(() => {
    setRefreshIndex(0);
  }, [src]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setRefreshIndex((value) => value + 1);
    }, PREVIEW_IMAGE_REFRESH_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [src]);

  return (
    <img
      src={appendQueryParam(src, "tick", String(refreshIndex))}
      alt={label}
      decoding="async"
      loading="lazy"
      onLoad={onLoad}
    />
  );
}

let activeSnapshotPreviewOwner: string | null = null;
const snapshotPreviewListeners = new Set<() => void>();

function tryAcquireSnapshotPreview(ownerId: string): boolean {
  if (activeSnapshotPreviewOwner === null || activeSnapshotPreviewOwner === ownerId) {
    activeSnapshotPreviewOwner = ownerId;
    return true;
  }

  return false;
}

function releaseSnapshotPreview(ownerId: string): void {
  if (activeSnapshotPreviewOwner !== ownerId) {
    return;
  }

  activeSnapshotPreviewOwner = null;

  for (const listener of snapshotPreviewListeners) {
    listener();
  }
}

function shutdownEmbeddedSelkiesFrame(frame: HTMLIFrameElement | null): void {
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
    // Ignore cross-frame access races while the iframe is navigating away.
  }
}

export function SnapshotBrowserPreview({
  label,
  ownerId,
  src,
}: {
  label: string;
  ownerId: string;
  src: string;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const [attemptKey, setAttemptKey] = useState(0);
  const [leaseHeld, setLeaseHeld] = useState<boolean>(() => tryAcquireSnapshotPreview(ownerId));
  const [snapshotReady, setSnapshotReady] = useState(false);

  useEffect(() => {
    setAttemptKey(0);
    setSnapshotReady(false);
  }, [ownerId, src]);

  useEffect(() => {
    if (snapshotReady) {
      if (leaseHeld) {
        releaseSnapshotPreview(ownerId);
        setLeaseHeld(false);
      }
      return;
    }

    if (leaseHeld) {
      return;
    }

    if (tryAcquireSnapshotPreview(ownerId)) {
      setLeaseHeld(true);
      return;
    }

    const handleLeaseRelease = () => {
      if (tryAcquireSnapshotPreview(ownerId)) {
        setLeaseHeld(true);
      }
    };

    snapshotPreviewListeners.add(handleLeaseRelease);

    return () => {
      snapshotPreviewListeners.delete(handleLeaseRelease);
    };
  }, [leaseHeld, ownerId, snapshotReady]);

  useEffect(() => {
    if (!leaseHeld || snapshotReady) {
      return;
    }

    let active = true;
    const captureIntervalId = window.setInterval(() => {
      const canvas = canvasRef.current;
      const previewFrame = previewFrameRef.current;

      if (!canvas || !previewFrame) {
        return;
      }

      try {
        const previewDocument =
          previewFrame.contentDocument ?? previewFrame.contentWindow?.document ?? null;
        const previewMedia = resolvePreviewMedia(previewDocument);

        if (
          !(previewMedia instanceof HTMLVideoElement) &&
          !(previewMedia instanceof HTMLImageElement) &&
          !(previewMedia instanceof HTMLCanvasElement)
        ) {
          return;
        }

        const {
          height: sourceHeight,
          width: sourceWidth,
        } = readPreviewMediaDimensions(previewMedia);

        if (sourceWidth <= 0 || sourceHeight <= 0) {
          return;
        }

        if (
          canvas.width !== sourceWidth ||
          canvas.height !== sourceHeight
        ) {
          canvas.width = sourceWidth;
          canvas.height = sourceHeight;
        }

        const context = canvas.getContext("2d");

        if (!context) {
          return;
        }

        context.drawImage(previewMedia, 0, 0, canvas.width, canvas.height);

        if (!active) {
          return;
        }

        shutdownEmbeddedSelkiesFrame(previewFrame);
        setSnapshotReady(true);
      } catch {
        // Same-origin access can fail mid-navigation; retry on the next interval.
      }
    }, 120);
    const retryTimeoutId = window.setTimeout(() => {
      if (!active) {
        return;
      }

      setAttemptKey((value) => value + 1);
    }, 10_000);

    return () => {
      active = false;
      window.clearInterval(captureIntervalId);
      window.clearTimeout(retryTimeoutId);
    };
  }, [attemptKey, leaseHeld, snapshotReady]);

  useEffect(() => {
    return () => {
      shutdownEmbeddedSelkiesFrame(previewFrameRef.current);
      releaseSnapshotPreview(ownerId);
    };
  }, [ownerId]);

  return (
    <>
      <canvas ref={canvasRef} aria-label={label} />
      {leaseHeld && !snapshotReady ? (
        <iframe
          ref={previewFrameRef}
          key={`${src}:${attemptKey}`}
          className="vm-tile__browser-frame vm-tile__browser-frame--snapshot-source"
          src={src}
          title={`${label} source`}
          allow="autoplay; clipboard-read; clipboard-write; fullscreen"
          allowFullScreen
          loading="lazy"
          tabIndex={-1}
          aria-hidden="true"
        />
      ) : null}
    </>
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

function appendQueryParam(path: string, key: string, value: string): string {
  const hashIndex = path.indexOf("#");
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";
  const basePath = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const separator = basePath.includes("?") ? "&" : "?";
  return `${basePath}${separator}${key}=${encodeURIComponent(value)}${hash}`;
}

function statusClassName(status: VmStatus): string {
  switch (status) {
    case "running":
      return "status-badge--running";
    case "paused":
      return "status-badge--paused";
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
