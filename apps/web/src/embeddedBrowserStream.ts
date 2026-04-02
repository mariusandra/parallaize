export interface EmbeddedBrowserStreamState {
  ready: boolean;
  status: string | null;
}

export type SelkiesStreamRecoveryCandidate =
  | "failed"
  | "reconnecting"
  | "stalled"
  | "waiting";

export interface SelkiesStreamRecoveryState {
  candidateSinceMs: number;
  kickCount: number;
  lastRecoveryAttemptMs: number;
  trackedCandidate: SelkiesStreamRecoveryCandidate | null;
}

interface EmbeddedBrowserStreamBridgeWindow extends Window {
  app?: {
    loadingText?: unknown;
    logEntries?: unknown;
    showStart?: unknown;
    status?: unknown;
  };
  parallaizeGetStreamScale?: (() => number | string | null | undefined) | undefined;
  parallaizeGetStreamState?:
    | (() => {
        ready?: unknown;
        status?: unknown;
      } | boolean | null | undefined)
    | undefined;
  parallaizeKickStream?: ((reason?: string) => boolean) | undefined;
  parallaizeSetStreamScale?: ((scale: number) => boolean) | undefined;
  signalling?: {
    _ws_conn?: {
      readyState?: unknown;
    } | null;
    disconnect?: (() => void) | undefined;
  } | null;
  webrtc?: {
    connect?: (() => void) | undefined;
    peerConnection?: {
      connectionState?: unknown;
      iceConnectionState?: unknown;
    } | null;
    reset?: (() => void) | undefined;
  } | null;
}

interface EmbeddedBrowserElementOwnerWindow extends Window {
  HTMLCanvasElement?: typeof HTMLCanvasElement;
  HTMLImageElement?: typeof HTMLImageElement;
  HTMLVideoElement?: typeof HTMLVideoElement;
}

const embeddedBrowserRecentLogWindow = 12;
const embeddedBrowserPlaceholderVideoDimensionPx = 4;

function normalizeEmbeddedBrowserStatus(status: unknown): string | null {
  if (typeof status !== "string") {
    return null;
  }

  const trimmed = status.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readEmbeddedBrowserRecentLogs(
  target: EmbeddedBrowserStreamBridgeWindow | null,
): string[] {
  if (!target?.app || !Array.isArray(target.app.logEntries)) {
    return [];
  }

  return target.app.logEntries
    .filter((entry): entry is string => typeof entry === "string")
    .slice(-embeddedBrowserRecentLogWindow);
}

function resolveEmbeddedBrowserDerivedStatus(
  target: EmbeddedBrowserStreamBridgeWindow | null,
): string | null {
  const recentLogs = readEmbeddedBrowserRecentLogs(target);

  for (let index = recentLogs.length - 1; index >= 0; index -= 1) {
    const entry = recentLogs[index]?.toLowerCase() ?? "";
    if (
      entry.includes("connection failed") ||
      entry.includes("peer connection failed") ||
      entry.includes("server closed connection") ||
      entry.includes("error from server")
    ) {
      return "Connection failed.";
    }
  }

  for (let index = recentLogs.length - 1; index >= 0; index -= 1) {
    const entry = recentLogs[index]?.toLowerCase() ?? "";
    if (
      entry.includes("reconnecting stream") ||
      entry.includes("connection error, retrying")
    ) {
      return "Reconnecting stream.";
    }
  }

  for (let index = recentLogs.length - 1; index >= 0; index -= 1) {
    const entry = recentLogs[index]?.toLowerCase() ?? "";
    if (entry.includes("waiting for stream")) {
      return "Waiting for stream.";
    }
  }

  return normalizeEmbeddedBrowserStatus(target?.app?.status);
}

function resolveEmbeddedBrowserStatus(
  bridgedStatus: unknown,
  target: EmbeddedBrowserStreamBridgeWindow | null,
): string | null {
  const normalizedBridgedStatus = normalizeEmbeddedBrowserStatus(bridgedStatus);

  if (
    normalizedBridgedStatus !== null &&
    normalizedBridgedStatus.trim().toLowerCase() !== "connected"
  ) {
    return normalizedBridgedStatus;
  }

  return resolveEmbeddedBrowserDerivedStatus(target) ?? normalizedBridgedStatus;
}

function hasRenderableEmbeddedBrowserVideo(video: HTMLVideoElement): boolean {
  return video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
}

function resolveEmbeddedBrowserVideoFrameCount(
  video: HTMLVideoElement,
): number | null {
  const playbackQuality =
    typeof video.getVideoPlaybackQuality === "function"
      ? video.getVideoPlaybackQuality()
      : null;

  return typeof playbackQuality?.totalVideoFrames === "number"
    ? playbackQuality.totalVideoFrames
    : null;
}

function hasSuspiciousEmbeddedBrowserVideoState(
  target: EmbeddedBrowserStreamBridgeWindow | null,
  video: HTMLVideoElement,
  bridgedReady: boolean,
  bridgedStatus: string | null,
): boolean {
  const normalizedStatus = bridgedStatus?.trim().toLowerCase() ?? "";

  if (!bridgedReady && normalizedStatus !== "connected") {
    return false;
  }

  if (!hasRenderableEmbeddedBrowserVideo(video) || video.paused || video.ended) {
    return false;
  }

  const totalVideoFrames = resolveEmbeddedBrowserVideoFrameCount(video);
  const stalledPlayback =
    totalVideoFrames !== null ? totalVideoFrames === 0 : video.currentTime <= 0.01;

  if (!stalledPlayback) {
    return false;
  }

  const placeholderSized =
    video.videoWidth <= embeddedBrowserPlaceholderVideoDimensionPx &&
    video.videoHeight <= embeddedBrowserPlaceholderVideoDimensionPx;

  const peerConnection = target?.webrtc?.peerConnection ?? null;
  const connectionState =
    typeof peerConnection?.connectionState === "string"
      ? peerConnection.connectionState.toLowerCase()
      : "";
  const iceConnectionState =
    typeof peerConnection?.iceConnectionState === "string"
      ? peerConnection.iceConnectionState.toLowerCase()
      : "";
  const peerNotConnected =
    connectionState === "new" ||
    connectionState === "disconnected" ||
    connectionState === "failed" ||
    connectionState === "closed" ||
    ((connectionState === "" || connectionState === "connecting") &&
      (iceConnectionState === "new" ||
        iceConnectionState === "disconnected" ||
        iceConnectionState === "failed" ||
        iceConnectionState === "closed"));

  const socketReadyState = target?.signalling?._ws_conn?.readyState;
  const signallingDisconnected =
    typeof socketReadyState === "number" && socketReadyState !== 1;

  return placeholderSized || peerNotConnected || signallingDisconnected;
}

function isEmbeddedBrowserVideoElement(candidate: unknown): candidate is HTMLVideoElement {
  if (!candidate || typeof candidate !== "object") {
    return false;
  }

  if (typeof HTMLVideoElement !== "undefined" && candidate instanceof HTMLVideoElement) {
    return true;
  }

  const ownerWindow = (candidate as {
    ownerDocument?: { defaultView?: EmbeddedBrowserElementOwnerWindow | null };
  })
    .ownerDocument?.defaultView;

  return typeof ownerWindow?.HTMLVideoElement === "function" &&
    candidate instanceof ownerWindow.HTMLVideoElement;
}

function isEmbeddedBrowserImageElement(candidate: unknown): candidate is HTMLImageElement {
  if (!candidate || typeof candidate !== "object") {
    return false;
  }

  if (typeof HTMLImageElement !== "undefined" && candidate instanceof HTMLImageElement) {
    return true;
  }

  const ownerWindow = (candidate as {
    ownerDocument?: { defaultView?: EmbeddedBrowserElementOwnerWindow | null };
  })
    .ownerDocument?.defaultView;

  return typeof ownerWindow?.HTMLImageElement === "function" &&
    candidate instanceof ownerWindow.HTMLImageElement;
}

function isEmbeddedBrowserCanvasElement(candidate: unknown): candidate is HTMLCanvasElement {
  if (!candidate || typeof candidate !== "object") {
    return false;
  }

  if (typeof HTMLCanvasElement !== "undefined" && candidate instanceof HTMLCanvasElement) {
    return true;
  }

  const ownerWindow = (candidate as {
    ownerDocument?: { defaultView?: EmbeddedBrowserElementOwnerWindow | null };
  })
    .ownerDocument?.defaultView;

  return typeof ownerWindow?.HTMLCanvasElement === "function" &&
    candidate instanceof ownerWindow.HTMLCanvasElement;
}

export function createSelkiesStreamRecoveryState(): SelkiesStreamRecoveryState {
  return {
    candidateSinceMs: 0,
    kickCount: 0,
    lastRecoveryAttemptMs: 0,
    trackedCandidate: null,
  };
}

export function updateSelkiesStreamRecoveryState(
  current: SelkiesStreamRecoveryState,
  state: EmbeddedBrowserStreamState | null,
  candidate: SelkiesStreamRecoveryCandidate | null,
  nowMs: number,
): SelkiesStreamRecoveryState {
  if (candidate === null) {
    return current.trackedCandidate !== null && state?.ready !== true
      ? current
      : createSelkiesStreamRecoveryState();
  }

  if (current.trackedCandidate !== candidate) {
    if (current.kickCount > 0 && state?.ready !== true) {
      return {
        ...current,
        candidateSinceMs: current.candidateSinceMs || nowMs,
        trackedCandidate: candidate,
      };
    }

    return {
      ...createSelkiesStreamRecoveryState(),
      candidateSinceMs: nowMs,
      trackedCandidate: candidate,
    };
  }

  return current;
}

export function resolveSelkiesStreamRecoveryCandidate(
  state: EmbeddedBrowserStreamState | null,
): SelkiesStreamRecoveryCandidate | null {
  if (!state || state.ready) {
    return null;
  }

  const normalizedStatus = state.status?.trim().toLowerCase() ?? "";

  if (normalizedStatus.length === 0) {
    return null;
  }

  if (
    normalizedStatus.includes("connection failed") ||
    normalizedStatus.includes("peer connection failed") ||
    normalizedStatus.includes("server closed connection") ||
    normalizedStatus.includes("error from server") ||
    normalizedStatus === "failed" ||
    normalizedStatus === "disconnected" ||
    normalizedStatus === "closed"
  ) {
    return "failed";
  }

  if (normalizedStatus === "connected") {
    return "stalled";
  }

  if (normalizedStatus.includes("waiting for stream")) {
    return "waiting";
  }

  if (
    normalizedStatus.includes("reconnecting stream") ||
    normalizedStatus.includes("connection error, retrying")
  ) {
    return "reconnecting";
  }

  return null;
}

export function readEmbeddedBrowserStreamState(
  frame: HTMLIFrameElement | null,
): EmbeddedBrowserStreamState | null {
  if (!frame) {
    return {
      ready: false,
      status: null,
    };
  }

  try {
    const target = frame.contentWindow as EmbeddedBrowserStreamBridgeWindow | null;
    const bridgedState = target?.parallaizeGetStreamState?.();
    let bridgedReady = false;
    let bridgedStatus: string | null = null;
    let hasBridgedState = false;

    if (typeof bridgedState === "boolean") {
      bridgedReady = bridgedState;
      hasBridgedState = true;
    }

    if (bridgedState && typeof bridgedState === "object") {
      bridgedReady =
        "ready" in bridgedState && typeof bridgedState.ready === "boolean"
          ? bridgedState.ready
          : false;
      bridgedStatus =
        "status" in bridgedState && typeof bridgedState.status === "string"
          ? bridgedState.status
          : null;
      hasBridgedState = true;
    }

    const sourceDocument = frame.contentDocument ?? target?.document ?? null;
    const video = sourceDocument?.querySelector("video");
    const resolvedStatus = resolveEmbeddedBrowserStatus(bridgedStatus, target);
    const bridgedNotReady = hasBridgedState && !bridgedReady;

    if (isEmbeddedBrowserVideoElement(video)) {
      const videoReady = hasRenderableEmbeddedBrowserVideo(video);

      if (
        hasSuspiciousEmbeddedBrowserVideoState(target, video, bridgedReady, bridgedStatus)
      ) {
        return {
          ready: false,
          status: resolvedStatus,
        };
      }

      return {
        ready: videoReady && !bridgedNotReady,
        status: resolvedStatus,
      };
    }

    const image = sourceDocument?.querySelector("img");

    if (isEmbeddedBrowserImageElement(image)) {
      const imageReady = image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;

      return {
        ready: imageReady && !bridgedNotReady,
        status: resolvedStatus,
      };
    }

    const canvas = sourceDocument?.querySelector("canvas");

    if (isEmbeddedBrowserCanvasElement(canvas)) {
      const canvasReady = canvas.width > 0 && canvas.height > 0;

      return {
        ready: canvasReady && !bridgedNotReady,
        status: resolvedStatus,
      };
    }

    return {
      ready: false,
      status: resolvedStatus,
    };
  } catch {
    return null;
  }
}

export function hasEmbeddedBrowserRenderSurface(
  frame: HTMLIFrameElement | null,
): boolean {
  if (!frame) {
    return false;
  }

  try {
    const target = frame.contentWindow as EmbeddedBrowserStreamBridgeWindow | null;
    const sourceDocument = frame.contentDocument ?? target?.document ?? null;
    const video = sourceDocument?.querySelector("video");

    if (isEmbeddedBrowserVideoElement(video)) {
      return hasRenderableEmbeddedBrowserVideo(video);
    }

    const image = sourceDocument?.querySelector("img");

    if (isEmbeddedBrowserImageElement(image)) {
      return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
    }

    const canvas = sourceDocument?.querySelector("canvas");

    return isEmbeddedBrowserCanvasElement(canvas) &&
      canvas.width > 0 &&
      canvas.height > 0;
  } catch {
    return false;
  }
}

export function readEmbeddedBrowserStreamScale(
  frame: HTMLIFrameElement | null,
): number | null {
  if (!frame) {
    return null;
  }

  try {
    const target = frame.contentWindow as EmbeddedBrowserStreamBridgeWindow | null;
    const bridgedScale = target?.parallaizeGetStreamScale?.();
    const resolvedScale =
      typeof bridgedScale === "number"
        ? bridgedScale
        : typeof bridgedScale === "string"
          ? Number(bridgedScale)
          : Number.NaN;

    if (!Number.isFinite(resolvedScale) || resolvedScale <= 0) {
      return null;
    }

    return Math.round(resolvedScale * 100) / 100;
  } catch {
    return null;
  }
}

export function kickEmbeddedBrowserStream(
  frame: HTMLIFrameElement | null,
  reason = "manual",
): boolean {
  if (!frame) {
    return false;
  }

  try {
    const target = frame.contentWindow as EmbeddedBrowserStreamBridgeWindow | null;

    if (!target) {
      return false;
    }

    if (typeof target.parallaizeKickStream === "function") {
      return target.parallaizeKickStream(reason) !== false;
    }

    if (target.app && Array.isArray(target.app.logEntries)) {
      target.app.logEntries.push(`[parallaize] kicking stream: ${reason}`);
    }
    if (target.app && typeof target.app.loadingText === "string") {
      target.app.loadingText = "Reconnecting stream.";
    }
    if (target.app && typeof target.app.showStart === "boolean") {
      target.app.showStart = false;
    }
    if (target.app && typeof target.app.status === "string") {
      target.app.status = "connecting";
    }

    if (
      typeof target.signalling?.disconnect === "function" &&
      target.signalling._ws_conn !== null &&
      target.signalling._ws_conn !== undefined
    ) {
      target.signalling.disconnect();
      return true;
    }

    if (
      typeof target.webrtc?.reset === "function" &&
      target.webrtc.peerConnection !== null &&
      target.webrtc.peerConnection !== undefined
    ) {
      target.webrtc.reset();
      return true;
    }

    if (typeof target.webrtc?.connect === "function") {
      target.webrtc.connect();
      return true;
    }

    target.location.reload();
    return true;
  } catch {
    return false;
  }
}

export function setEmbeddedBrowserStreamScale(
  frame: HTMLIFrameElement | null,
  scale: number,
): boolean {
  if (!frame || !Number.isFinite(scale) || scale <= 0) {
    return false;
  }

  try {
    const target = frame.contentWindow as EmbeddedBrowserStreamBridgeWindow | null;

    if (typeof target?.parallaizeSetStreamScale !== "function") {
      return false;
    }

    return target.parallaizeSetStreamScale(scale) !== false;
  } catch {
    return false;
  }
}
