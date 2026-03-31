import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type JSX,
  type RefObject,
} from "react";

import { formatResources } from "../../../packages/shared/src/helpers.js";
import type { VmInstance, VmPowerAction } from "../../../packages/shared/src/types.js";

import {
  hasBrowserDesktopSession,
  shouldShowLiveVmPreview,
} from "./desktopSession.js";
import { formatThresholdPercent, vmTilePreviewLabel } from "./dashboardHelpers.js";
import {
  MirroredStagePreview,
  PollingImagePreview,
  StaticPatternPreview,
  StatusBadge,
} from "./dashboardPrimitives.js";
import { readEmbeddedBrowserStreamState } from "./embeddedBrowserStream.js";
import {
  formatTelemetryPercent,
  joinClassNames,
  PortalPopover,
  statusClassName,
  TelemetryPanel,
} from "./dashboardUi.js";

interface VmTileProps {
  activeCpuThresholdPercent: number;
  busy: boolean;
  compact: boolean;
  dragging: boolean;
  inspectorVisible: boolean;
  menuOpen: boolean;
  mirroredStageFrameRef: RefObject<HTMLIFrameElement | null> | null;
  selected: boolean;
  showLivePreview: boolean;
  vm: VmInstance;
  onDragEnd: () => void;
  onDragOver: (targetVmId: string, event: ReactDragEvent<HTMLElement>) => void;
  onDragStart: (vmId: string, event: ReactDragEvent<HTMLElement>) => void;
  onDrop: (targetVmId: string, event: ReactDragEvent<HTMLElement>) => void;
  onClone: (vm: VmInstance) => Promise<void>;
  onDelete: (vm: VmInstance) => Promise<void>;
  onHideInspector: () => void;
  onInspect: (vmId: string) => void;
  onOpenLogs: (vm: VmInstance) => void;
  onOpen: (vmId: string) => void;
  onRename: (vm: VmInstance) => Promise<void>;
  onSetActiveCpuThreshold: (vm: VmInstance) => void;
  onSnapshot: (vm: VmInstance) => Promise<void>;
  onPowerAction: (vmId: string, action: VmPowerAction) => Promise<void>;
  onToggleMenu: (vmId: string) => void;
}

export function RailHomeIcon(): JSX.Element {
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

export function RailCreateIcon(): JSX.Element {
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

export function RailSettingsIcon(): JSX.Element {
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

export function VmTile({
  activeCpuThresholdPercent,
  busy,
  compact,
  dragging,
  inspectorVisible,
  menuOpen,
  mirroredStageFrameRef,
  selected,
  showLivePreview,
  vm,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onClone,
  onDelete,
  onHideInspector,
  onInspect,
  onOpenLogs,
  onOpen,
  onRename,
  onSetActiveCpuThreshold,
  onSnapshot,
  onPowerAction,
  onToggleMenu,
}: VmTileProps): JSX.Element {
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const selkiesPreviewCandidate =
    vm.session?.kind === "selkies" || vm.desktopTransport === "selkies";
  const [retainCapturedSelkiesPreview, setRetainCapturedSelkiesPreview] = useState(
    selkiesPreviewCandidate && selected && showLivePreview && vm.status === "running",
  );

  useEffect(() => {
    if (!selkiesPreviewCandidate || !showLivePreview || vm.status !== "running") {
      setRetainCapturedSelkiesPreview(false);
      return;
    }

    if (selected) {
      setRetainCapturedSelkiesPreview(true);
    }
  }, [selected, selkiesPreviewCandidate, showLivePreview, vm.status]);

  const streamReady = useEmbeddedBrowserStreamReady(mirroredStageFrameRef);
  const canShowLivePreview = shouldShowLiveVmPreview(vm, showLivePreview, selected);
  const previewLabel = vmTilePreviewLabel(vm, showLivePreview, selected);
  const preferCapturedSelkiesPreview =
    canShowLivePreview &&
    selkiesPreviewCandidate &&
    (selected || retainCapturedSelkiesPreview);
  const canShowMirroredBrowserPreview =
    showLivePreview &&
    vm.status === "running" &&
    mirroredStageFrameRef !== null &&
    !preferCapturedSelkiesPreview;
  const canShowCapturedBrowserPreview =
    canShowLivePreview &&
    hasBrowserDesktopSession(vm.session) &&
    !canShowMirroredBrowserPreview;
  const showStreamingBadge = vm.status === "running" && streamReady;
  const previewImagePath = canShowCapturedBrowserPreview
    ? `/api/vms/${encodeURIComponent(vm.id)}/preview?frameRevision=${vm.frameRevision}`
    : null;
  const compactCpuPercent = compactVmCpuPercent(vm);
  const showMutedPreviewStatus =
    vm.status === "running" && compactCpuPercent <= activeCpuThresholdPercent;
  const previewStatusColor =
    vm.status === "running"
      ? showMutedPreviewStatus
        ? "rgb(34 197 94 / 0.3)"
        : compactVmCpuColor(compactCpuPercent)
      : null;
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
          {compact ? (
            <div className="vm-tile__popover-telemetry">
              <TelemetryPanel
                activeCpuThresholdPercent={activeCpuThresholdPercent}
                compact
                telemetry={vm.telemetry}
              />
            </div>
          ) : null}
          {!selected ? (
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
          ) : null}
          {selected ? (
            <button
              className="menu-action"
              type="button"
              onClick={() => {
                if (inspectorVisible) {
                  onHideInspector();
                } else {
                  onInspect(vm.id);
                }
              }}
            >
              {inspectorVisible ? "Hide inspector" : "Inspector"}
            </button>
          ) : null}
          <button
            className="menu-action"
            type="button"
            onClick={() => {
              onToggleMenu(vm.id);
              void onPowerAction(vm.id, vm.status === "running" ? "stop" : "start");
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
              void onPowerAction(vm.id, "restart");
            }}
            disabled={busy || vm.status !== "running"}
          >
            Restart
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
              void onRename(vm);
            }}
            disabled={busy}
          >
            Rename
          </button>
          <button
            className="menu-action"
            type="button"
            onClick={() => {
              onToggleMenu(vm.id);
              onOpenLogs(vm);
            }}
          >
            Logs
          </button>
          <button
            className="menu-action menu-action--split"
            type="button"
            onClick={() => {
              onToggleMenu(vm.id);
              onSetActiveCpuThreshold(vm);
            }}
            disabled={busy}
          >
            <span>Set active threshold</span>
            <span className="menu-action__state">
              {formatThresholdPercent(activeCpuThresholdPercent)}
            </span>
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
    const compactStatusTitle =
      vm.status === "running"
        ? `${vm.name} · ${vm.status} · CPU ${formatTelemetryPercent(vm.telemetry?.cpuPercent)}`
        : `${vm.name} · ${vm.status}`;

    return (
      <article
        className={joinClassNames(
          "vm-tile",
          dragging ? "vm-tile--dragging" : "",
          selected ? "vm-tile--active" : "",
          "vm-tile--compact",
        )}
        draggable={!busy}
        onDragEnd={onDragEnd}
        onDragOver={(event) => onDragOver(vm.id, event)}
        onDragStart={(event) => onDragStart(vm.id, event)}
        onDrop={(event) => onDrop(vm.id, event)}
      >
        <button
          className="vm-tile__compact-trigger"
          type="button"
          aria-label={`Open ${vm.name}`}
          title={compactStatusTitle}
          onClick={() => onOpen(vm.id)}
        >
          <span className="vm-tile__open-hitbox" aria-hidden="true" />
          <div className="vm-tile__compact-preview">
            {canShowMirroredBrowserPreview ? (
              <MirroredStagePreview
                label={`${vm.name} live preview`}
                sourceFrameRef={mirroredStageFrameRef!}
              />
            ) : canShowCapturedBrowserPreview ? (
              <CapturedBrowserPreview
                fallbackFrameRef={mirroredStageFrameRef}
                freezeFallback={!selected}
                label={`${vm.name} live preview`}
                src={previewImagePath!}
              />
            ) : (
              <StaticPatternPreview vm={vm} variant="tile" />
            )}
            {showStreamingBadge ? (
              <span className="vm-tile__preview-badge">Streaming</span>
            ) : null}
          </div>
          <span
            className={joinClassNames(
              "vm-tile__compact-status",
              statusClassName(vm.status),
              showMutedPreviewStatus ? "vm-tile__compact-status--muted" : "",
            )}
            style={
              {
                "--vm-compact-cpu-color": previewStatusColor ?? undefined,
              } as CSSProperties
            }
            title={
              vm.status === "running"
                ? `CPU ${formatTelemetryPercent(vm.telemetry?.cpuPercent)}`
                : undefined
            }
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
        dragging ? "vm-tile--dragging" : "",
        selected ? "vm-tile--active" : "",
      )}
      draggable={!busy}
      onDragEnd={onDragEnd}
      onDragOver={(event) => onDragOver(vm.id, event)}
      onDragStart={(event) => onDragStart(vm.id, event)}
      onDrop={(event) => onDrop(vm.id, event)}
    >
      <button className="vm-tile__open" type="button" onClick={() => onOpen(vm.id)}>
        <span className="vm-tile__open-hitbox" aria-hidden="true" />
        <div className="vm-tile__preview">
          {canShowMirroredBrowserPreview ? (
            <>
              <MirroredStagePreview
                label={`${vm.name} live preview`}
                sourceFrameRef={mirroredStageFrameRef!}
              />
              <span
                className={joinClassNames(
                  "vm-tile__compact-status",
                  "vm-tile__preview-status",
                  statusClassName(vm.status),
                  showMutedPreviewStatus ? "vm-tile__compact-status--muted" : "",
                )}
                style={
                  {
                    "--vm-compact-cpu-color": previewStatusColor ?? undefined,
                  } as CSSProperties
                }
                title={
                  vm.status === "running"
                    ? `CPU ${formatTelemetryPercent(vm.telemetry?.cpuPercent)}`
                    : undefined
                }
                aria-hidden="true"
              />
            </>
          ) : canShowCapturedBrowserPreview ? (
            <>
              <CapturedBrowserPreview
                fallbackFrameRef={mirroredStageFrameRef}
                freezeFallback={!selected}
                label={`${vm.name} live preview`}
                src={previewImagePath!}
              />
              <span
                className={joinClassNames(
                  "vm-tile__compact-status",
                  "vm-tile__preview-status",
                  statusClassName(vm.status),
                  showMutedPreviewStatus ? "vm-tile__compact-status--muted" : "",
                )}
                style={
                  {
                    "--vm-compact-cpu-color": previewStatusColor ?? undefined,
                  } as CSSProperties
                }
                title={
                  vm.status === "running"
                    ? `CPU ${formatTelemetryPercent(vm.telemetry?.cpuPercent)}`
                    : undefined
                }
                aria-hidden="true"
              />
            </>
          ) : (
            <>
              <StaticPatternPreview vm={vm} variant="tile" />
              <span className="vm-tile__preview-note">{previewLabel}</span>
              <span
                className={joinClassNames(
                  "vm-tile__compact-status",
                  "vm-tile__preview-status",
                  statusClassName(vm.status),
                  showMutedPreviewStatus ? "vm-tile__compact-status--muted" : "",
                )}
                style={
                  {
                    "--vm-compact-cpu-color": previewStatusColor ?? undefined,
                  } as CSSProperties
                }
                title={
                  vm.status === "running"
                    ? `CPU ${formatTelemetryPercent(vm.telemetry?.cpuPercent)}`
                    : undefined
                }
                aria-hidden="true"
              />
            </>
          )}
          {showStreamingBadge ? (
            <span className="vm-tile__preview-badge">Streaming</span>
          ) : null}
        </div>

        <div className="vm-tile__body">
          <div className="vm-tile__body-head">
            <div className="vm-tile__identity">
              <h3 className="vm-tile__title">{vm.name}</h3>
              <p className="vm-tile__resources">{formatResources(vm.resources)}</p>
            </div>
            <StatusBadge status={vm.status}>{vm.status}</StatusBadge>
          </div>

          <TelemetryPanel
            activeCpuThresholdPercent={activeCpuThresholdPercent}
            telemetry={vm.telemetry}
          />
        </div>
      </button>
      {menu}
    </article>
  );
}

function compactVmCpuPercent(vm: VmInstance): number {
  const rawPercent = vm.telemetry?.cpuPercent;

  if (rawPercent === null || rawPercent === undefined || !Number.isFinite(rawPercent)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(rawPercent)));
}

function CapturedBrowserPreview({
  fallbackFrameRef,
  freezeFallback,
  label,
  src,
}: {
  fallbackFrameRef: RefObject<HTMLIFrameElement | null> | null;
  freezeFallback: boolean;
  label: string;
  src: string;
}): JSX.Element {
  const [imageReady, setImageReady] = useState(false);

  useEffect(() => {
    setImageReady(false);
  }, [src]);

  return (
    <div className="vm-tile__preview-stack">
      {!imageReady && fallbackFrameRef ? (
        <MirroredStagePreview
          label={label}
          paused={freezeFallback}
          sourceFrameRef={fallbackFrameRef}
        />
      ) : null}
      <PollingImagePreview
        label={label}
        src={src}
        onLoad={() => {
          setImageReady(true);
        }}
      />
    </div>
  );
}

function useEmbeddedBrowserStreamReady(
  frameRef: RefObject<HTMLIFrameElement | null> | null,
): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!frameRef) {
      setReady(false);
      return;
    }

    let trackedFrame: HTMLIFrameElement | null = null;

    const syncReady = (): void => {
      const nextState = readEmbeddedBrowserStreamState(frameRef.current);
      const nextReady = nextState?.ready ?? null;

      if (nextReady === null) {
        return;
      }

      setReady((current) => (current === nextReady ? current : nextReady));
    };

    const attachLoadListener = (): void => {
      const nextFrame = frameRef.current;

      if (trackedFrame === nextFrame) {
        return;
      }

      trackedFrame?.removeEventListener("load", syncReady);
      trackedFrame = nextFrame;
      trackedFrame?.addEventListener("load", syncReady);
    };

    attachLoadListener();
    syncReady();
    const pollId = window.setInterval(() => {
      attachLoadListener();
      syncReady();
    }, 250);

    return () => {
      window.clearInterval(pollId);
      trackedFrame?.removeEventListener("load", syncReady);
    };
  }, [frameRef]);

  return ready;
}

function compactVmCpuColor(percent: number): string {
  const setpoints = [
    {
      color: { b: 94, g: 197, r: 34 },
      percent: 0,
    },
    {
      color: { b: 59, g: 235, r: 251 },
      percent: 55,
    },
    {
      color: { b: 22, g: 115, r: 249 },
      percent: 78,
    },
    {
      color: { b: 68, g: 68, r: 239 },
      percent: 92,
    },
  ];

  if (percent <= setpoints[0].percent) {
    return rgbColorString(setpoints[0].color);
  }

  for (let index = 1; index < setpoints.length; index += 1) {
    const previous = setpoints[index - 1];
    const current = setpoints[index];

    if (percent <= current.percent) {
      return interpolateRgbColor(
        previous.color,
        current.color,
        (percent - previous.percent) / (current.percent - previous.percent),
      );
    }
  }

  return rgbColorString(setpoints.at(-1)?.color ?? { b: 68, g: 68, r: 239 });
}

function interpolateRgbColor(
  from: {
    b: number;
    g: number;
    r: number;
  },
  to: {
    b: number;
    g: number;
    r: number;
  },
  ratio: number,
): string {
  const clampedRatio = Math.max(0, Math.min(1, ratio));

  const r = Math.round(from.r + (to.r - from.r) * clampedRatio);
  const g = Math.round(from.g + (to.g - from.g) * clampedRatio);
  const b = Math.round(from.b + (to.b - from.b) * clampedRatio);

  return rgbColorString({ b, g, r });
}

function rgbColorString(color: {
  b: number;
  g: number;
  r: number;
}): string {
  return `rgb(${color.r} ${color.g} ${color.b})`;
}
