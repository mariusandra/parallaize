import assert from "node:assert/strict";
import test from "node:test";

import {
  attachEmbeddedFrameFocusBridge,
  focusEmbeddedFrameTarget,
  type EmbeddedFrameDocumentLike,
  type EmbeddedFrameLike,
} from "../apps/web/src/embeddedFrameFocus.js";

test("focusEmbeddedFrameTarget focuses the frame and same-origin document targets", () => {
  const calls: string[] = [];
  const frame = buildFrame(calls);

  assert.equal(focusEmbeddedFrameTarget(frame), true);
  assert.deepEqual(calls, ["frame", "window", "documentElement", "body"]);
});

test("focusEmbeddedFrameTarget tolerates inaccessible frame internals", () => {
  const calls: string[] = [];
  const frame = {
    focus() {
      calls.push("frame");
    },
  } as EmbeddedFrameLike;

  Object.defineProperty(frame, "contentWindow", {
    get() {
      throw new Error("cross-origin");
    },
  });

  assert.equal(focusEmbeddedFrameTarget(frame), true);
  assert.deepEqual(calls, ["frame"]);
});

test("attachEmbeddedFrameFocusBridge focuses the frame on embedded pointer interaction", () => {
  const calls: string[] = [];
  const listeners = new Map<string, EventListenerOrEventListenerObject>();
  const frame = buildFrame(calls, listeners);

  const cleanup = attachEmbeddedFrameFocusBridge(frame);
  const pointerDown = listeners.get("pointerdown");
  const mouseDown = listeners.get("mousedown");

  assert.equal(typeof pointerDown, "function");
  assert.equal(typeof mouseDown, "function");

  (pointerDown as EventListener)(new Event("pointerdown"));

  assert.deepEqual(calls, ["frame", "window", "documentElement", "body"]);

  cleanup();

  assert.equal(listeners.size, 0);
});

function buildFrame(
  calls: string[],
  listeners?: Map<string, EventListenerOrEventListenerObject>,
): EmbeddedFrameLike {
  const documentLike: EmbeddedFrameDocumentLike = {
    addEventListener(type, listener) {
      listeners?.set(type, listener);
    },
    body: {
      focus() {
        calls.push("body");
      },
    },
    documentElement: {
      focus() {
        calls.push("documentElement");
      },
    },
    removeEventListener(type) {
      listeners?.delete(type);
    },
  };

  return {
    contentDocument: documentLike,
    contentWindow: {
      document: documentLike,
      focus() {
        calls.push("window");
      },
    },
    focus() {
      calls.push("frame");
    },
  };
}
