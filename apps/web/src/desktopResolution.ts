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

export const emptyViewportBounds: ViewportBounds = {
  height: null,
  width: null,
};

export const emptyResolutionRequestQueue: ResolutionRequestQueue = {
  inFlight: null,
  queued: null,
};

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
