export interface EmbeddedBrowserStreamState {
  ready: boolean;
  status: string | null;
}

export interface SelkiesStreamRecoveryState {
  candidateSinceMs: number;
  kickCount: number;
  lastRecoveryAttemptMs: number;
  trackedCandidate: "failed" | "waiting" | null;
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
    _ws_conn?: unknown;
    disconnect?: (() => void) | undefined;
  } | null;
  webrtc?: {
    connect?: (() => void) | undefined;
    peerConnection?: unknown;
    reset?: (() => void) | undefined;
  } | null;
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
  candidate: "failed" | "waiting" | null,
  nowMs: number,
): SelkiesStreamRecoveryState {
  if (candidate === null) {
    return current.kickCount > 0 && current.trackedCandidate !== null && state?.ready !== true
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

    if (typeof bridgedState === "boolean") {
      return {
        ready: bridgedState,
        status: null,
      };
    }

    if (bridgedState && typeof bridgedState === "object") {
      const ready =
        "ready" in bridgedState && typeof bridgedState.ready === "boolean"
          ? bridgedState.ready
          : false;
      const status =
        "status" in bridgedState && typeof bridgedState.status === "string"
          ? bridgedState.status
          : null;

      return {
        ready,
        status,
      };
    }

    const sourceDocument = frame.contentDocument ?? target?.document ?? null;
    const video = sourceDocument?.querySelector("video");

    if (video instanceof HTMLVideoElement) {
      return {
        ready: video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0,
        status: null,
      };
    }

    const image = sourceDocument?.querySelector("img");

    if (image instanceof HTMLImageElement) {
      return {
        ready: image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
        status: null,
      };
    }

    const canvas = sourceDocument?.querySelector("canvas");

    if (canvas instanceof HTMLCanvasElement) {
      return {
        ready: canvas.width > 0 && canvas.height > 0,
        status: null,
      };
    }

    return {
      ready: false,
      status: null,
    };
  } catch {
    return null;
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
