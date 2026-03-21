import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRfbSocketUrls,
  resolveRfbConstructor,
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
