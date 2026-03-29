import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { formatRam } from "../../../packages/shared/src/helpers.js";
import type { ResourceTelemetry, VmStatus } from "../../../packages/shared/src/types.js";

import { parseAnsiText, resolveAnsiSegmentStyle } from "./ansi.js";

export function VmLogOutput({
  className,
  content,
}: {
  className?: string;
  content: string;
}): JSX.Element {
  const outputRef = useRef<HTMLPreElement | null>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const output = outputRef.current;

    if (!output || !stickToBottomRef.current) {
      return;
    }

    output.scrollTop = output.scrollHeight;
  }, [content]);

  return (
    <pre
      ref={outputRef}
      className={className}
      onScroll={(event) => {
        stickToBottomRef.current = isNearScrollBottom(event.currentTarget);
      }}
    >
      {parseAnsiText(content).map((segment, index) => (
        <span key={index} style={resolveAnsiSegmentStyle(segment)}>
          {segment.text}
        </span>
      ))}
    </pre>
  );
}

export function TelemetryPanel({
  activeCpuThresholdPercent,
  compact = false,
  label,
  telemetry,
}: {
  activeCpuThresholdPercent: number;
  compact?: boolean;
  label?: string;
  telemetry?: ResourceTelemetry;
}): JSX.Element {
  const chartWidth = compact ? 180 : 240;
  const chartHeight = compact ? 20 : 24;
  const cpuHistory = telemetry?.cpuHistory.length ? telemetry.cpuHistory : [0];
  const ramHistory = telemetry?.ramHistory.length ? telemetry.ramHistory : [0];
  const cpuPercent = telemetry?.cpuPercent;
  const showMutedCpuMetric =
    !compact &&
    cpuPercent !== null &&
    cpuPercent !== undefined &&
    Number.isFinite(cpuPercent) &&
    cpuPercent <= activeCpuThresholdPercent;

  return (
    <div className={joinClassNames("telemetry-panel", compact ? "telemetry-panel--compact" : "")}>
      <div className="telemetry-panel__head">
        {label ? <span className="telemetry-panel__label">{label}</span> : <span />}
        <span className="telemetry-panel__stats">
          <span
            className={joinClassNames(
              "telemetry-panel__metric",
              "telemetry-panel__metric--cpu",
              showMutedCpuMetric ? "telemetry-panel__metric--muted" : "",
            )}
          >
            CPU {formatTelemetryPercent(cpuPercent)}
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

const PORTAL_POPOVER_VIEWPORT_PADDING = 12;
const PORTAL_POPOVER_GAP = 8;

export function PortalPopover({
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
      const popover = popoverRef.current;

      if (!anchor || !popover) {
        setStyle(null);
        return;
      }

      const anchorBounds = anchor.getBoundingClientRect();
      const popoverBounds = popover.getBoundingClientRect();
      const nextStyle: CSSProperties = {
        position: "fixed",
        zIndex: 80,
        maxHeight: window.innerHeight - PORTAL_POPOVER_VIEWPORT_PADDING * 2,
      };

      if (anchorPlacement === "right-start") {
        const spaceToRight =
          window.innerWidth -
          anchorBounds.right -
          PORTAL_POPOVER_GAP -
          PORTAL_POPOVER_VIEWPORT_PADDING;
        const spaceToLeft =
          anchorBounds.left - PORTAL_POPOVER_GAP - PORTAL_POPOVER_VIEWPORT_PADDING;
        const openToLeft = spaceToRight < popoverBounds.width && spaceToLeft > spaceToRight;
        const desiredLeft = openToLeft
          ? anchorBounds.left - PORTAL_POPOVER_GAP - popoverBounds.width
          : anchorBounds.right + PORTAL_POPOVER_GAP;

        nextStyle.top = clampPopoverCoordinate(
          anchorBounds.top,
          popoverBounds.height,
          window.innerHeight,
        );
        nextStyle.left = clampPopoverCoordinate(
          desiredLeft,
          popoverBounds.width,
          window.innerWidth,
        );
      } else {
        const spaceBelow =
          window.innerHeight -
          anchorBounds.bottom -
          PORTAL_POPOVER_GAP -
          PORTAL_POPOVER_VIEWPORT_PADDING;
        const spaceAbove =
          anchorBounds.top - PORTAL_POPOVER_GAP - PORTAL_POPOVER_VIEWPORT_PADDING;
        const openAbove = spaceBelow < popoverBounds.height && spaceAbove > spaceBelow;
        const desiredTop = openAbove
          ? anchorBounds.top - PORTAL_POPOVER_GAP - popoverBounds.height
          : anchorBounds.bottom + PORTAL_POPOVER_GAP;
        const desiredLeft =
          anchorPlacement === "bottom-start"
            ? anchorBounds.left
            : anchorBounds.right - popoverBounds.width;

        nextStyle.top = clampPopoverCoordinate(
          desiredTop,
          popoverBounds.height,
          window.innerHeight,
        );
        nextStyle.left = clampPopoverCoordinate(
          desiredLeft,
          popoverBounds.width,
          window.innerWidth,
        );
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

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      ref={popoverRef}
      className={joinClassNames("portal-popover", className)}
      style={
        style ?? {
          position: "fixed",
          top: PORTAL_POPOVER_VIEWPORT_PADDING,
          left: PORTAL_POPOVER_VIEWPORT_PADDING,
          visibility: "hidden",
          pointerEvents: "none",
          zIndex: 80,
        }
      }
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

function clampPopoverCoordinate(value: number, size: number, viewportSize: number): number {
  const minimum = PORTAL_POPOVER_VIEWPORT_PADDING;
  const maximum = Math.max(
    minimum,
    viewportSize - PORTAL_POPOVER_VIEWPORT_PADDING - Math.min(size, viewportSize),
  );

  return Math.min(Math.max(value, minimum), maximum);
}

export function statusClassName(status: VmStatus): string {
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

export function formatTelemetryPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "--" : `${Math.round(value)}%`;
}

export function formatRamUsage(usedRamMb: number, totalRamMb: number): string {
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

export function formatDiskUsage(usedDiskGb: number, totalDiskGb: number): string {
  if (!Number.isFinite(totalDiskGb) || totalDiskGb <= 0) {
    return "N/A";
  }

  return `${usedDiskGb}/${totalDiskGb} GB`;
}

export function formatUsageCount(used: number, total: number): string {
  if (!Number.isFinite(total) || total <= 0) {
    return String(used);
  }

  return `${used}/${total}`;
}

function buildSparklinePoints(values: number[], width: number, height: number): string {
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

function isNearScrollBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 24;
}

export function joinClassNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
