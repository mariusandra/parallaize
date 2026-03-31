export interface DesktopResolutionLike {
  clientHeight: number | null;
  clientWidth: number | null;
  remoteHeight: number | null;
  remoteWidth: number | null;
}

export interface ViewportBounds {
  height: number | null;
  width: number | null;
}

export interface ResolutionRequest {
  height: number;
  key: string;
  requestId: number;
  silent: boolean;
  vmId: string;
  width: number;
}

export interface ResolutionRequestQueue {
  inFlight: ResolutionRequest | null;
  queued: ResolutionRequest | null;
}

export interface ResolutionControlLease {
  heartbeatAt: number;
  tabId: string;
  vmId: string;
}

export type DesktopResolutionSessionKind = "selkies" | "synthetic" | "vnc";

export const emptyViewportBounds: ViewportBounds = {
  height: null,
  width: null,
};

export const emptyResolutionRequestQueue: ResolutionRequestQueue = {
  inFlight: null,
  queued: null,
};

export const resolutionControlLeaseTtlMs = 5_000;

export function applyViewportBoundsToResolution<T extends DesktopResolutionLike>(
  resolution: T,
  bounds: ViewportBounds,
): T {
  if (bounds.width === null && bounds.height === null) {
    return resolution;
  }

  return {
    ...resolution,
    clientHeight: bounds.height ?? resolution.clientHeight,
    clientWidth: bounds.width ?? resolution.clientWidth,
  };
}

export function enqueueResolutionRequest(
  queue: ResolutionRequestQueue,
  request: ResolutionRequest,
): {
  nextQueue: ResolutionRequestQueue;
  requestToStart: ResolutionRequest | null;
  skipped: boolean;
} {
  if (queue.inFlight?.key === request.key) {
    return {
      nextQueue: queue,
      requestToStart: null,
      skipped: true,
    };
  }

  if (queue.queued?.key === request.key) {
    return {
      nextQueue: {
        ...queue,
        queued: {
          ...request,
          silent: queue.queued.silent && request.silent,
        },
      },
      requestToStart: null,
      skipped: true,
    };
  }

  if (queue.inFlight) {
    return {
      nextQueue: {
        ...queue,
        queued: request,
      },
      requestToStart: null,
      skipped: false,
    };
  }

  return {
    nextQueue: {
      inFlight: request,
      queued: null,
    },
    requestToStart: request,
    skipped: false,
  };
}

export function resolveResolutionRequest(
  queue: ResolutionRequestQueue,
  requestId: number,
): {
  nextQueue: ResolutionRequestQueue;
  requestToStart: ResolutionRequest | null;
} {
  if (queue.inFlight?.requestId !== requestId) {
    return {
      nextQueue: queue,
      requestToStart: null,
    };
  }

  if (!queue.queued) {
    return {
      nextQueue: emptyResolutionRequestQueue,
      requestToStart: null,
    };
  }

  return {
    nextQueue: {
      inFlight: queue.queued,
      queued: null,
    },
    requestToStart: queue.queued,
  };
}

export function shouldScheduleResolutionRepair(input: {
  attempts: number;
  currentRemoteKey: string | null;
  maxAttempts: number;
  queue: ResolutionRequestQueue;
  targetKey: string | null;
}): boolean {
  if (!input.targetKey || input.currentRemoteKey === input.targetKey) {
    return false;
  }

  if (input.queue.inFlight !== null || input.queue.queued !== null) {
    return false;
  }

  return input.attempts < input.maxAttempts;
}

export function shouldDriveGuestResolution(input: {
  mode: "fixed" | "viewport";
  sessionKind: DesktopResolutionSessionKind | null | undefined;
}): boolean {
  if (input.mode === "fixed") {
    return true;
  }

  // Selkies handles viewport resize through its own data channel; only noVNC needs dashboard-managed viewport resizes.
  return input.sessionKind === "vnc";
}

export function buildResolutionControlLeaseStorageKey(vmId: string): string {
  return `parallaize.desktop-resolution-controller:${vmId}`;
}

export function createResolutionControlLease(
  vmId: string,
  tabId: string,
  heartbeatAt: number,
): ResolutionControlLease {
  return {
    heartbeatAt,
    tabId,
    vmId,
  };
}

export function parseResolutionControlLease(raw: string | null): ResolutionControlLease | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ResolutionControlLease>;

    if (
      typeof parsed.vmId !== "string" ||
      !parsed.vmId ||
      typeof parsed.tabId !== "string" ||
      !parsed.tabId ||
      typeof parsed.heartbeatAt !== "number" ||
      !Number.isFinite(parsed.heartbeatAt)
    ) {
      return null;
    }

    return {
      heartbeatAt: parsed.heartbeatAt,
      tabId: parsed.tabId,
      vmId: parsed.vmId,
    };
  } catch {
    return null;
  }
}

export function isResolutionControlLeaseFresh(
  lease: ResolutionControlLease | null,
  now: number,
  ttlMs = resolutionControlLeaseTtlMs,
): boolean {
  if (!lease) {
    return false;
  }

  return now - lease.heartbeatAt <= ttlMs;
}

export function canClaimResolutionControlLease(input: {
  lease: ResolutionControlLease | null;
  now: number;
  tabId: string;
  ttlMs?: number;
  vmId: string;
}): boolean {
  if (!input.lease || input.lease.vmId !== input.vmId) {
    return true;
  }

  if (input.lease.tabId === input.tabId) {
    return true;
  }

  return !isResolutionControlLeaseFresh(input.lease, input.now, input.ttlMs);
}
