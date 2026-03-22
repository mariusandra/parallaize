import assert from "node:assert/strict";
import test from "node:test";

import {
  applyViewportBoundsToResolution,
  emptyResolutionRequestQueue,
  enqueueResolutionRequest,
  resolveResolutionRequest,
  type ResolutionRequest,
} from "../apps/web/src/desktopResolution.js";

function buildRequest(
  requestId: number,
  width: number,
  height: number,
  silent = true,
): ResolutionRequest {
  return {
    height,
    key: `vm-0001:${width}x${height}`,
    requestId,
    silent,
    vmId: "vm-0001",
    width,
  };
}

test("applyViewportBoundsToResolution prefers the observed frame size", () => {
  assert.deepEqual(
    applyViewportBoundsToResolution(
      {
        clientHeight: 800,
        clientWidth: 1280,
        remoteHeight: 720,
        remoteWidth: 1120,
      },
      {
        height: 694,
        width: 1188,
      },
    ),
    {
      clientHeight: 694,
      clientWidth: 1188,
      remoteHeight: 720,
      remoteWidth: 1120,
    },
  );
});

test("enqueueResolutionRequest starts immediately when no request is active", () => {
  const request = buildRequest(1, 1440, 900);
  const result = enqueueResolutionRequest(emptyResolutionRequestQueue, request);

  assert.equal(result.skipped, false);
  assert.equal(result.requestToStart, request);
  assert.equal(result.nextQueue.inFlight, request);
  assert.equal(result.nextQueue.queued, null);
});

test("enqueueResolutionRequest keeps only the latest queued target while one is active", () => {
  const inFlight = buildRequest(1, 1440, 900);
  const firstQueued = buildRequest(2, 1600, 900);
  const latestQueued = buildRequest(3, 1728, 972);

  const withFirstQueued = enqueueResolutionRequest(
    {
      inFlight,
      queued: null,
    },
    firstQueued,
  );
  const withLatestQueued = enqueueResolutionRequest(
    withFirstQueued.nextQueue,
    latestQueued,
  );
  const resolved = resolveResolutionRequest(withLatestQueued.nextQueue, inFlight.requestId);

  assert.equal(withFirstQueued.requestToStart, null);
  assert.equal(withFirstQueued.nextQueue.queued, firstQueued);
  assert.equal(withLatestQueued.requestToStart, null);
  assert.equal(withLatestQueued.nextQueue.queued, latestQueued);
  assert.equal(resolved.requestToStart, latestQueued);
  assert.equal(resolved.nextQueue.inFlight, latestQueued);
  assert.equal(resolved.nextQueue.queued, null);
});

test("enqueueResolutionRequest collapses duplicate queued targets and preserves visible errors", () => {
  const inFlight = buildRequest(1, 1440, 900);
  const queuedSilent = buildRequest(2, 1600, 900, true);
  const queuedVisible = buildRequest(3, 1600, 900, false);

  const result = enqueueResolutionRequest(
    {
      inFlight,
      queued: queuedSilent,
    },
    queuedVisible,
  );

  assert.equal(result.skipped, true);
  assert.equal(result.requestToStart, null);
  assert.deepEqual(result.nextQueue.queued, {
    ...queuedVisible,
    silent: false,
  });
});

test("enqueueResolutionRequest ignores duplicate in-flight targets", () => {
  const inFlight = buildRequest(1, 1440, 900);
  const duplicate = buildRequest(2, 1440, 900, false);

  const result = enqueueResolutionRequest(
    {
      inFlight,
      queued: null,
    },
    duplicate,
  );

  assert.equal(result.skipped, true);
  assert.equal(result.requestToStart, null);
  assert.equal(result.nextQueue.inFlight, inFlight);
  assert.equal(result.nextQueue.queued, null);
});
