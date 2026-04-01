import assert from "node:assert/strict";
import test from "node:test";

import {
  createSelkiesStreamRecoveryState,
  kickEmbeddedBrowserStream,
  readEmbeddedBrowserStreamScale,
  readEmbeddedBrowserStreamState,
  setEmbeddedBrowserStreamScale,
  updateSelkiesStreamRecoveryState,
} from "../apps/web/src/embeddedBrowserStream.js";

function withMockVideoDom(
  videoFactory: () => object,
  callback: (video: object) => void,
): void {
  const originalHtmlVideoElement = globalThis.HTMLVideoElement;

  class MockHtmlVideoElement {}

  Object.defineProperty(globalThis, "HTMLVideoElement", {
    configurable: true,
    value: MockHtmlVideoElement,
  });

  try {
    const video = Object.assign(new MockHtmlVideoElement(), videoFactory());
    callback(video);
  } finally {
    if (originalHtmlVideoElement === undefined) {
      delete (globalThis as { HTMLVideoElement?: typeof HTMLVideoElement }).HTMLVideoElement;
    } else {
      Object.defineProperty(globalThis, "HTMLVideoElement", {
        configurable: true,
        value: originalHtmlVideoElement,
      });
    }
  }
}

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

test("readEmbeddedBrowserStreamState rejects a false-connected placeholder video", () => {
  withMockVideoDom(
    () => ({
      currentTime: 0,
      ended: false,
      paused: false,
      readyState: 4,
      srcObject: {},
      videoHeight: 2,
      videoWidth: 2,
      getVideoPlaybackQuality: () => ({
        totalVideoFrames: 0,
      }),
    }),
    function (video) {
      const frame = {
        contentDocument: {
          querySelector(selector: string) {
            return selector === "video" ? video : null;
          },
        },
        contentWindow: {
          app: {
            logEntries: [
              "[signalling] [ERROR] Server closed connection.",
              "[signalling] Connection error, retrying.",
            ],
            status: "connected",
          },
          parallaizeGetStreamState: () => ({
            ready: true,
            status: "connected",
          }),
          signalling: {
            _ws_conn: {
              readyState: 3,
            },
          },
          webrtc: {
            peerConnection: {
              connectionState: "new",
              iceConnectionState: "new",
            },
          },
        },
      } as unknown as HTMLIFrameElement;

      assert.deepEqual(readEmbeddedBrowserStreamState(frame), {
        ready: false,
        status: "Connection failed.",
      });
    },
  );
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

test("readEmbeddedBrowserStreamScale reads the guest bridge payload", () => {
  const frame = {
    contentWindow: {
      parallaizeGetStreamScale: () => 1.25,
    },
  } as unknown as HTMLIFrameElement & {
    contentWindow: {
      parallaizeGetStreamScale: () => number;
    };
  };

  assert.equal(readEmbeddedBrowserStreamScale(frame), 1.25);
  assert.equal(readEmbeddedBrowserStreamScale(null), null);
});

test("Selkies recovery state survives a kicked reconnecting phase", () => {
  const waitingState = {
    ready: false,
    status: "Waiting for stream.",
  };
  const reconnectingState = {
    ready: false,
    status: "Reconnecting stream.",
  };

  let recovery = updateSelkiesStreamRecoveryState(
    createSelkiesStreamRecoveryState(),
    waitingState,
    "waiting",
    1_000,
  );
  recovery = {
    ...recovery,
    kickCount: 1,
    lastRecoveryAttemptMs: 13_000,
  };

  recovery = updateSelkiesStreamRecoveryState(
    recovery,
    reconnectingState,
    "reconnecting",
    13_250,
  );
  assert.deepEqual(recovery, {
    candidateSinceMs: 1_000,
    kickCount: 1,
    lastRecoveryAttemptMs: 13_000,
    trackedCandidate: "reconnecting",
  });

  recovery = updateSelkiesStreamRecoveryState(
    recovery,
    {
      ready: false,
      status: "",
    },
    null,
    14_000,
  );
  assert.deepEqual(recovery, {
    candidateSinceMs: 1_000,
    kickCount: 1,
    lastRecoveryAttemptMs: 13_000,
    trackedCandidate: "reconnecting",
  });
});

test("Selkies recovery state keeps a reconnecting candidate through a blank spinner phase", () => {
  const recovery = updateSelkiesStreamRecoveryState(
    updateSelkiesStreamRecoveryState(
      createSelkiesStreamRecoveryState(),
      {
        ready: false,
        status: "Reconnecting stream.",
      },
      "reconnecting",
      1_000,
    ),
    {
      ready: false,
      status: "",
    },
    null,
    4_000,
  );

  assert.deepEqual(recovery, {
    candidateSinceMs: 1_000,
    kickCount: 0,
    lastRecoveryAttemptMs: 0,
    trackedCandidate: "reconnecting",
  });
});

test("Selkies recovery state resets once the stream is healthy again", () => {
  const recovery = updateSelkiesStreamRecoveryState(
    {
      candidateSinceMs: 1_000,
      kickCount: 1,
      lastRecoveryAttemptMs: 13_000,
      trackedCandidate: "failed",
    },
    {
      ready: true,
      status: "",
    },
    null,
    14_000,
  );

  assert.deepEqual(recovery, {
    candidateSinceMs: 0,
    kickCount: 0,
    lastRecoveryAttemptMs: 0,
    trackedCandidate: null,
  });
});
