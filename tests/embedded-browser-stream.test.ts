import assert from "node:assert/strict";
import test from "node:test";

import {
  kickEmbeddedBrowserStream,
  readEmbeddedBrowserStreamState,
  setEmbeddedBrowserStreamScale,
} from "../apps/web/src/embeddedBrowserStream.js";

test("readEmbeddedBrowserStreamState reads the guest bridge payload", () => {
  const frame = {
    contentWindow: {
      parallaizeGetStreamState: () => ({
        ready: false,
        status: "Waiting for stream.",
      }),
    },
  } as unknown as HTMLIFrameElement & {
    contentWindow: {
      parallaizeGetStreamState: () => {
        ready: boolean;
        status: string;
      };
    };
  };

  assert.deepEqual(readEmbeddedBrowserStreamState(frame), {
    ready: false,
    status: "Waiting for stream.",
  });
});

test("kickEmbeddedBrowserStream prefers the explicit guest kick bridge", () => {
  const calls: string[] = [];
  const frame = {
    contentWindow: {
      parallaizeKickStream(reason?: string) {
        calls.push(reason ?? "");
        return true;
      },
    },
  } as unknown as HTMLIFrameElement & {
    contentWindow: {
      parallaizeKickStream: (reason?: string) => boolean;
    };
  };

  assert.equal(kickEmbeddedBrowserStream(frame, "auto-failed"), true);
  assert.deepEqual(calls, ["auto-failed"]);
});

test("kickEmbeddedBrowserStream falls back to signalling disconnect for older bundles", () => {
  let disconnectCalled = false;
  const frame = {
    contentWindow: {
      app: {
        loadingText: "",
        logEntries: [] as string[],
        showStart: true,
        status: "failed",
      },
      location: {
        reload() {
          throw new Error("should not reload");
        },
      },
      signalling: {
        _ws_conn: {},
        disconnect() {
          disconnectCalled = true;
        },
      },
    },
  } as unknown as HTMLIFrameElement & {
    contentWindow: {
      app: {
        loadingText: string;
        logEntries: string[];
        showStart: boolean;
        status: string;
      };
      location: {
        reload: () => void;
      };
      signalling: {
        _ws_conn: object;
        disconnect: () => void;
      };
    };
  };

  assert.equal(kickEmbeddedBrowserStream(frame, "auto-failed"), true);
  assert.equal(disconnectCalled, true);
  assert.equal(frame.contentWindow.app.loadingText, "Reconnecting stream.");
  assert.equal(frame.contentWindow.app.showStart, false);
  assert.equal(frame.contentWindow.app.status, "connecting");
});

test("setEmbeddedBrowserStreamScale prefers the explicit native scale bridge", () => {
  const calls: number[] = [];
  const frame = {
    contentWindow: {
      parallaizeSetStreamScale(scale: number) {
        calls.push(scale);
        return true;
      },
    },
  } as unknown as HTMLIFrameElement & {
    contentWindow: {
      parallaizeSetStreamScale: (scale: number) => boolean;
    };
  };

  assert.equal(setEmbeddedBrowserStreamScale(frame, 1.5), true);
  assert.deepEqual(calls, [1.5]);
});

test("setEmbeddedBrowserStreamScale returns false when the bridge is unavailable", () => {
  const frame = {
    contentWindow: {},
  } as unknown as HTMLIFrameElement;

  assert.equal(setEmbeddedBrowserStreamScale(frame, 1.25), false);
  assert.equal(setEmbeddedBrowserStreamScale(frame, Number.NaN), false);
});
