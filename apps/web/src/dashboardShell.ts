import type {
  SetVmResolutionInput,
  VmSessionKind,
  VmLogsSnapshot,
  VmStatus,
} from "../../../packages/shared/src/types.js";

import type { ViewportBounds } from "./desktopResolution.js";

export interface ResourceDraft {
  cpu: string;
  ramGb: string;
  diskGb: string;
}

export interface ResolutionDraft {
  mode: DesktopResolutionMode;
  scale: string;
  width: string;
  height: string;
}

export interface DesktopResolutionPreference {
  mode: DesktopResolutionMode;
  scale: number;
  width: number;
  height: number;
}

export interface ForwardDraft {
  name: string;
  guestPort: string;
  description: string;
}

export interface Notice {
  tone: "error" | "info" | "success";
  message: string;
}

export interface LoginDraft {
  username: string;
  password: string;
}

export type ThemeMode = "light" | "dark";
export type DesktopResolutionMode = "viewport" | "fixed";
export type ResolutionControlOwner = "none" | "self" | "other";
export type ResolutionControlSource = "none" | "local" | "remote";

export interface DesktopResolutionState {
  clientHeight: number | null;
  clientWidth: number | null;
  remoteHeight: number | null;
  remoteWidth: number | null;
}

export interface PendingManualResolutionSync {
  token: number;
  vmId: string;
}

export interface ResolutionControlStatus {
  controllerClientId: string | null;
  owner: ResolutionControlOwner;
  source: ResolutionControlSource;
  vmId: string | null;
}

export interface DesktopResolutionTarget {
  height: number;
  key: string;
  vmId: string;
  width: number;
}

export interface ResolutionRetryState {
  attempts: number;
  key: string;
}

interface ResolutionDisplayOptions {
  mode?: DesktopResolutionMode;
  sessionKind?: VmSessionKind | null | undefined;
}

interface ViewportScaleLabelOptions {
  sessionKind?: VmSessionKind | null | undefined;
}

export type RenameDialogState =
  | {
      kind: "vm";
      id: string;
      currentName: string;
    }
  | {
      kind: "template";
      id: string;
      currentName: string;
      description: string;
    };

export interface VmLogsDialogState {
  error: string | null;
  loading: boolean;
  logs: VmLogsSnapshot | null;
  refreshing: boolean;
  vmId: string;
  vmName: string;
}

export interface VmLogsViewState {
  error: string | null;
  loading: boolean;
  logs: VmLogsSnapshot | null;
  refreshing: boolean;
}

export interface CloneVmDialogState {
  canCaptureRam: boolean;
  ramMb: number;
  sourceVmId: string;
  sourceVmName: string;
  sourceVmStatus: VmStatus;
  stateful: boolean;
  wallpaperName: string;
}

export interface SnapshotDialogState {
  canCaptureRam: boolean;
  label: string;
  ramMb: number;
  stateful: boolean;
  vmId: string;
  vmName: string;
  vmStatus: VmStatus;
}

export function buildDefaultSnapshotLabel(date = new Date()): string {
  return `snapshot-${date.toISOString().slice(0, 16)}`;
}

export const quickCommands = ["pwd", "ls -la", "pnpm build", "pnpm test", "incus list"];
export const railCompactWidth = 48;
export const railExpandedMinWidth = 248;
export const railCompactSnapWidth = Math.round((railCompactWidth + railExpandedMinWidth) / 2);
export const railDefaultWidth = 320;
export const railMinWidth = railCompactWidth;
export const railMaxWidth = 420;
export const desktopViewportScaleDefault = 1;
export const desktopViewportScaleMin = 0.5;
export const desktopViewportScaleMax = 3;
export const desktopViewportScaleStep = 0.25;
export const liveCaptureWarningCopy =
  "This is fine, but you might capture inconsistent state or leave lockfiles open. Shut the VM down first if you need a clean checkpoint.";
export const liveCloneWarningCopy =
  "This carries open apps and in-memory edits into the fork. Turn RAM off or shut the source down first if you need a colder copy.";
export const desktopFixedWidthDefault = 1280;
export const desktopFixedHeightDefault = 800;
export const desktopFixedWidthMin = 640;
export const desktopFixedWidthMax = 3840;
export const desktopFixedHeightMin = 480;
export const desktopFixedHeightMax = 2160;
export const guestDisplayWidthMin = 320;
export const guestDisplayWidthMax = 8192;
export const guestDisplayWidthStep = 8;
export const guestDisplayHeightMin = 200;
export const guestDisplayHeightMax = 8192;
export const desktopResolutionRetryDelayMs = 900;
export const desktopResolutionRetryMaxAttempts = 4;
export const resolutionControlHeartbeatMs = 1_500;
export const sidepanelClosedWidth = 0;
export const sidepanelDefaultWidth = 380;
export const sidepanelMinWidth = 320;
export const sidepanelMaxWidth = 560;
export const sidepanelCollapseSnapWidth = Math.round(sidepanelMinWidth / 2);
export const sidepanelCompactBreakpoint = 1120;
export const vmDiskUsagePollIntervalMs = 30_000;

export const defaultDesktopResolutionPreference: DesktopResolutionPreference = {
  mode: "viewport",
  scale: desktopViewportScaleDefault,
  width: desktopFixedWidthDefault,
  height: desktopFixedHeightDefault,
};

export function sameViewportBounds(left: ViewportBounds, right: ViewportBounds): boolean {
  return left.width === right.width && left.height === right.height;
}

export function noticeToneClassName(tone: Notice["tone"]): string {
  switch (tone) {
    case "error":
      return "notice-bar--error";
    case "success":
      return "notice-bar--success";
    default:
      return "notice-bar--info";
  }
}

export function buildResolutionDraft(
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

export function normalizeGuestDisplayResolution(
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

export function buildDesktopResolutionTarget(
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

export function normalizeDesktopResolutionPreference(
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

export function buildDesktopResolutionRequestKey(
  vmId: string,
  width: number,
  height: number,
): string {
  return `${vmId}:${width}x${height}`;
}

export function clampRailWidthPreference(width: number): number {
  const roundedWidth = Math.round(width);

  if (roundedWidth <= railCompactSnapWidth) {
    return railCompactWidth;
  }

  return Math.min(railMaxWidth, Math.max(railExpandedMinWidth, roundedWidth));
}

export function clampDisplayedRailWidth(
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

export function clampDesktopFixedWidth(width: number): number {
  return Math.min(
    desktopFixedWidthMax,
    Math.max(desktopFixedWidthMin, Math.round(width)),
  );
}

export function clampDesktopViewportScale(scale: number): number {
  if (!Number.isFinite(scale)) {
    return desktopViewportScaleDefault;
  }

  const rounded = Math.round(scale / desktopViewportScaleStep) * desktopViewportScaleStep;
  return Math.min(
    desktopViewportScaleMax,
    Math.max(desktopViewportScaleMin, Number(rounded.toFixed(2))),
  );
}

export function clampDesktopFixedHeight(height: number): number {
  return Math.min(
    desktopFixedHeightMax,
    Math.max(desktopFixedHeightMin, Math.round(height)),
  );
}

export function scaleViewportResolutionValue(
  value: number | null,
  scale: number,
): number | null {
  if (value === null) {
    return null;
  }

  return Math.max(1, Math.round(value * scale));
}

export function formatViewportScale(scale: number): string {
  const normalized = clampDesktopViewportScale(scale);
  return normalized % 1 === 0 ? normalized.toFixed(0) : normalized.toFixed(2).replace(/0$/, "");
}

export function formatViewportScaleLabel(
  scale: number,
  options?: ViewportScaleLabelOptions,
): string {
  const normalized = clampDesktopViewportScale(scale);

  if (options?.sessionKind === "selkies") {
    return `${Math.round(normalized * 100)}%`;
  }

  return `${formatViewportScale(normalized)}x`;
}

export function clampSidepanelWidthPreference(width: number): number {
  const roundedWidth = Math.round(width);

  if (roundedWidth <= sidepanelCollapseSnapWidth) {
    return sidepanelClosedWidth;
  }

  return Math.min(sidepanelMaxWidth, Math.max(sidepanelMinWidth, roundedWidth));
}

export function clampDisplayedSidepanelWidth(width: number, viewportWidth: number): number {
  return Math.min(
    clampSidepanelWidthPreference(width),
    maxDisplayedSidepanelWidth(viewportWidth),
  );
}

export function isSelkiesViewportManagedResolution(input: {
  mode: DesktopResolutionMode;
  sessionKind: VmSessionKind | null | undefined;
}): boolean {
  return input.mode === "viewport" && input.sessionKind === "selkies";
}

export function normalizeBrowserDevicePixelRatio(
  value: number | null | undefined,
): number {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) {
    return 1;
  }

  return Number((value ?? 1).toFixed(2));
}

export function computeSelkiesViewportFallbackScale(
  scale: number,
  browserDevicePixelRatio: number,
): number {
  const normalizedScale = clampDesktopViewportScale(scale);
  const normalizedDevicePixelRatio = normalizeBrowserDevicePixelRatio(
    browserDevicePixelRatio,
  );

  return Number((normalizedDevicePixelRatio / normalizedScale).toFixed(4));
}

export function shouldPixelateSelkiesViewport(
  scale: number,
  browserDevicePixelRatio: number,
): boolean {
  return computeSelkiesViewportFallbackScale(scale, browserDevicePixelRatio) > 1.001;
}

export function formatCurrentResolution(
  state: DesktopResolutionState,
  options?: ResolutionDisplayOptions,
): string {
  if (
    options?.mode &&
    isSelkiesViewportManagedResolution({
      mode: options.mode,
      sessionKind: options.sessionKind,
    })
  ) {
    return "Managed by Selkies";
  }

  if (state.remoteWidth !== null && state.remoteHeight !== null) {
    return `${state.remoteWidth} x ${state.remoteHeight}`;
  }

  return "Waiting for live desktop";
}

export function formatViewportResolution(state: DesktopResolutionState): string {
  if (state.clientWidth !== null && state.clientHeight !== null) {
    return `${state.clientWidth} x ${state.clientHeight}`;
  }

  return "Unavailable";
}

export function formatTargetResolution(
  draft: ResolutionDraft,
  state: DesktopResolutionState,
  options?: ResolutionDisplayOptions,
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

function maxDisplayedRailWidth(viewportWidth: number, sidepanelWidth: number): number {
  return Math.max(
    railCompactWidth,
    Math.min(railMaxWidth, viewportWidth - Math.min(sidepanelWidth, sidepanelDefaultWidth) - 560),
  );
}

function maxDisplayedSidepanelWidth(viewportWidth: number): number {
  return Math.max(
    sidepanelMinWidth,
    Math.min(sidepanelMaxWidth, viewportWidth - 640),
  );
}
