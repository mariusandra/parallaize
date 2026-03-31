import assert from "node:assert/strict";
import test from "node:test";

import {
  computeSelkiesViewportFallbackScale,
  formatCurrentResolution,
  formatTargetResolution,
  formatViewportScaleLabel,
  isSelkiesViewportManagedResolution,
  shouldPixelateSelkiesViewport,
  type DesktopResolutionState,
  type ResolutionDraft,
} from "../apps/web/src/dashboardShell.js";

const viewportState: DesktopResolutionState = {
  clientHeight: 985,
  clientWidth: 968,
  remoteHeight: 800,
  remoteWidth: 1280,
};

test("Selkies viewport mode disables dashboard-managed scale semantics", () => {
  assert.equal(
    isSelkiesViewportManagedResolution({
      mode: "viewport",
      sessionKind: "selkies",
    }),
    true,
  );
  assert.equal(
    isSelkiesViewportManagedResolution({
      mode: "fixed",
      sessionKind: "selkies",
    }),
    false,
  );
  assert.equal(
    isSelkiesViewportManagedResolution({
      mode: "viewport",
      sessionKind: "vnc",
    }),
    false,
  );
});

test("formatCurrentResolution hides stale fixed-size readouts in Selkies viewport mode", () => {
  assert.equal(
    formatCurrentResolution(viewportState, {
      mode: "viewport",
      sessionKind: "selkies",
    }),
    "Managed by Selkies",
  );
  assert.equal(
    formatCurrentResolution(viewportState, {
      mode: "fixed",
      sessionKind: "selkies",
    }),
    "1280 x 800",
  );
});

test("formatTargetResolution reflects Selkies viewport targets once scale control is active", () => {
  const draft: ResolutionDraft = {
    mode: "viewport",
    scale: "1",
    width: "1280",
    height: "800",
  };

  assert.equal(
    formatTargetResolution(draft, viewportState, {
      sessionKind: "selkies",
    }),
    "968 x 985",
  );
  assert.equal(
    formatTargetResolution(draft, viewportState, {
      sessionKind: "vnc",
    }),
    "968 x 985",
  );
});

test("computeSelkiesViewportFallbackScale normalizes the local zoom against browser DPR", () => {
  assert.equal(computeSelkiesViewportFallbackScale(1, 2), 2);
  assert.equal(computeSelkiesViewportFallbackScale(2, 2), 1);
  assert.equal(computeSelkiesViewportFallbackScale(1.5, 2), 1.3333);
});

test("shouldPixelateSelkiesViewport only enables crisp pixel rendering while upscaling", () => {
  assert.equal(shouldPixelateSelkiesViewport(1, 2), true);
  assert.equal(shouldPixelateSelkiesViewport(2, 2), false);
  assert.equal(shouldPixelateSelkiesViewport(2.5, 2), false);
});

test("formatViewportScaleLabel uses percent labels for Selkies and x labels elsewhere", () => {
  assert.equal(formatViewportScaleLabel(1, { sessionKind: "selkies" }), "100%");
  assert.equal(formatViewportScaleLabel(1.25, { sessionKind: "selkies" }), "125%");
  assert.equal(formatViewportScaleLabel(1.25, { sessionKind: "vnc" }), "1.25x");
});
