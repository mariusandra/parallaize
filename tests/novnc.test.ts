import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRfbSocketUrls,
  readRfbFramebufferSize,
  resolveRfbConstructor,
  viewportSettingsForMode,
} from "../apps/web/src/novnc.js";

class FakeRfb extends EventTarget {
  background = "";
  clipViewport = false;
  resizeSession = false;
  scaleViewport = false;
  viewOnly = false;

  disconnect(): void {}
}

test("resolveRfbConstructor accepts a direct default export", () => {
  const resolved = resolveRfbConstructor({
    default: FakeRfb,
  });

  assert.equal(resolved, FakeRfb);
});

test("resolveRfbConstructor accepts a nested CommonJS default export", () => {
  const resolved = resolveRfbConstructor({
    default: {
      default: FakeRfb,
    },
  });

  assert.equal(resolved, FakeRfb);
});

test("resolveRfbConstructor rejects unsupported module shapes", () => {
  assert.equal(resolveRfbConstructor({ default: { nope: true } }), null);
  assert.equal(resolveRfbConstructor({}), null);
});

test("buildRfbSocketUrls prefers the same-origin browser bridge", () => {
  const urls = buildRfbSocketUrls("/api/vms/vm-0003/vnc", {
    host: "monster:8080",
    hostname: "monster",
    port: "8080",
    protocol: "http:",
  });

  assert.deepEqual(urls, ["ws://monster:8080/api/vms/vm-0003/vnc"]);
});

test("buildRfbSocketUrls keeps an absolute websocket URL unchanged", () => {
  const urls = buildRfbSocketUrls("ws://monster:3000/api/vms/vm-0003/vnc", {
    host: "monster:8080",
    hostname: "monster",
    port: "8080",
    protocol: "http:",
  });

  assert.deepEqual(urls, ["ws://monster:3000/api/vms/vm-0003/vnc"]);
});

test("viewportSettingsForMode defaults the main session to remote resize", () => {
  assert.deepEqual(viewportSettingsForMode("remote"), {
    clipViewport: false,
    resizeSession: true,
    scaleViewport: false,
  });
});

test("viewportSettingsForMode keeps previews on local scaling", () => {
  assert.deepEqual(viewportSettingsForMode("scale"), {
    clipViewport: false,
    resizeSession: false,
    scaleViewport: true,
  });
});

test("readRfbFramebufferSize prefers the tracked framebuffer size over canvas backing size", () => {
  assert.deepEqual(
    readRfbFramebufferSize({
      _display: {
        height: 986,
        width: 848,
      },
      _fbHeight: 1972,
      _fbWidth: 1696,
    }),
    {
      height: 986,
      width: 848,
    },
  );
});

test("readRfbFramebufferSize falls back to direct framebuffer fields", () => {
  assert.deepEqual(
    readRfbFramebufferSize({
      _fbHeight: 1233,
      _fbWidth: 1152,
    }),
    {
      height: 1233,
      width: 1152,
    },
  );
});
