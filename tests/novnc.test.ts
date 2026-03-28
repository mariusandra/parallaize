import assert from "node:assert/strict";
import test from "node:test";

import {
  applySafeRfbEncodingPatch,
  buildRfbSocketUrls,
  clipboardPasteShortcutLabel,
  primeClipboardPasteCaptureTarget,
  readBrowserClipboardText,
  readClipboardEventText,
  readClipboardTransferText,
  readRfbFramebufferSize,
  resolveRfbConstructor,
  resolveClipboardShortcutAction,
  sendGuestCopyShortcut,
  sendGuestText,
  sendGuestPasteShortcut,
  viewportSettingsForMode,
  writeBrowserClipboardText,
} from "../apps/web/src/novnc.js";

class FakeRfb extends EventTarget {
  background = "";
  clipViewport = false;
  resizeSession = false;
  scaleViewport = false;
  viewOnly = false;

  blur(): void {}
  clipboardPasteFrom(_text: string): void {}
  disconnect(): void {}
  focus(): void {}
  sendKey(_keysym: number, _code: string, _down?: boolean): void {}
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

test("applySafeRfbEncodingPatch overrides noVNC's preferred encodings with a compressed-safe set", () => {
  const writes: Array<{ kind: string; value?: number }> = [];
  const rfb = {
    _fbDepth: 24,
    _sendEncodings() {
      writes.push({
        kind: "original",
      });
    },
    _sock: {
      flush() {
        writes.push({
          kind: "flush",
        });
      },
      sQpush8(value: number) {
        writes.push({
          kind: "u8",
          value,
        });
      },
      sQpush16(value: number) {
        writes.push({
          kind: "u16",
          value,
        });
      },
      sQpush32(value: number) {
        writes.push({
          kind: "u32",
          value,
        });
      },
    },
  };

  assert.equal(applySafeRfbEncodingPatch(rfb), true);
  rfb._sendEncodings();

  assert.deepEqual(
    writes,
    [
      {
        kind: "u8",
        value: 2,
      },
      {
        kind: "u8",
        value: 0,
      },
      {
        kind: "u16",
        value: 19,
      },
      {
        kind: "u32",
        value: 1,
      },
      {
        kind: "u32",
        value: 16,
      },
      {
        kind: "u32",
        value: 5,
      },
      {
        kind: "u32",
        value: 2,
      },
      {
        kind: "u32",
        value: 6,
      },
      {
        kind: "u32",
        value: 0,
      },
      {
        kind: "u32",
        value: -223,
      },
      {
        kind: "u32",
        value: -224,
      },
      {
        kind: "u32",
        value: -258,
      },
      {
        kind: "u32",
        value: -261,
      },
      {
        kind: "u32",
        value: -308,
      },
      {
        kind: "u32",
        value: -309,
      },
      {
        kind: "u32",
        value: -312,
      },
      {
        kind: "u32",
        value: -313,
      },
      {
        kind: "u32",
        value: -307,
      },
      {
        kind: "u32",
        value: 0xc0a1e5ce,
      },
      {
        kind: "u32",
        value: -316,
      },
      {
        kind: "u32",
        value: 0x574d5664,
      },
      {
        kind: "u32",
        value: -239,
      },
      {
        kind: "flush",
      },
    ],
  );
});

test("applySafeRfbEncodingPatch ignores unsupported shapes", () => {
  assert.equal(applySafeRfbEncodingPatch(null), false);
  assert.equal(applySafeRfbEncodingPatch({}), false);
});

test("clipboardPasteShortcutLabel prefers the Mac shortcut for Apple platforms", () => {
  assert.equal(clipboardPasteShortcutLabel("MacIntel"), "Cmd+V");
  assert.equal(clipboardPasteShortcutLabel("iPhone"), "Cmd+V");
});

test("clipboardPasteShortcutLabel falls back to Ctrl+V elsewhere", () => {
  assert.equal(clipboardPasteShortcutLabel("Linux x86_64"), "Ctrl+V");
  assert.equal(clipboardPasteShortcutLabel(undefined), "Ctrl+V");
});

test("resolveClipboardShortcutAction prefers Cmd on Apple platforms", () => {
  assert.equal(
    resolveClipboardShortcutAction(
      {
        key: "c",
        metaKey: true,
      },
      "MacIntel",
    ),
    "copy",
  );
  assert.equal(
    resolveClipboardShortcutAction(
      {
        key: "V",
        metaKey: true,
      },
      "MacIntel",
    ),
    "paste",
  );
});

test("resolveClipboardShortcutAction prefers Ctrl on non-Apple platforms", () => {
  assert.equal(
    resolveClipboardShortcutAction(
      {
        ctrlKey: true,
        key: "c",
      },
      "Linux x86_64",
    ),
    "copy",
  );
  assert.equal(
    resolveClipboardShortcutAction(
      {
        ctrlKey: true,
        key: "v",
      },
      undefined,
    ),
    "paste",
  );
});

test("resolveClipboardShortcutAction ignores modified or unsupported shortcuts", () => {
  assert.equal(
    resolveClipboardShortcutAction(
      {
        altKey: true,
        ctrlKey: true,
        key: "c",
      },
      "Linux x86_64",
    ),
    null,
  );
  assert.equal(
    resolveClipboardShortcutAction(
      {
        key: "c",
        metaKey: true,
        shiftKey: true,
      },
      "MacIntel",
    ),
    null,
  );
  assert.equal(
    resolveClipboardShortcutAction(
      {
        ctrlKey: true,
        key: "x",
      },
      "Linux x86_64",
    ),
    null,
  );
});

test("readBrowserClipboardText requires a readable clipboard implementation", async () => {
  await assert.rejects(() => readBrowserClipboardText(null), /clipboard read/i);
});

test("readBrowserClipboardText delegates to the clipboard API", async () => {
  const text = await readBrowserClipboardText({
    readText: async () => "hello from the browser",
  });

  assert.equal(text, "hello from the browser");
});

test("writeBrowserClipboardText requires a writable clipboard implementation", async () => {
  await assert.rejects(() => writeBrowserClipboardText(null, "hello"), /clipboard write/i);
});

test("writeBrowserClipboardText delegates to the clipboard API", async () => {
  let written = "";

  await writeBrowserClipboardText(
    {
      writeText: async (text) => {
        written = text;
      },
    },
    "hello from the guest",
  );

  assert.equal(written, "hello from the guest");
});

test("readClipboardTransferText prefers plain text and falls back cleanly", () => {
  assert.equal(
    readClipboardTransferText({
      getData(format: string) {
        return format === "text/plain" ? "plain" : "fallback";
      },
    }),
    "plain",
  );

  assert.equal(
    readClipboardTransferText({
      getData(format: string) {
        return format === "text" ? "fallback" : "";
      },
    }),
    "fallback",
  );

  assert.equal(readClipboardTransferText(null), "");
});

test("primeClipboardPasteCaptureTarget focuses and clears the capture field", () => {
  const calls: string[] = [];
  const target = {
    value: "stale",
    focus() {
      calls.push("focus");
    },
    select() {
      calls.push("select");
    },
    setSelectionRange(start: number, end: number) {
      calls.push(`range:${start}:${end}`);
    },
  };

  assert.equal(primeClipboardPasteCaptureTarget(target), true);
  assert.equal(target.value, "");
  assert.deepEqual(calls, ["focus", "select", "range:0:0"]);
  assert.equal(primeClipboardPasteCaptureTarget(null), false);
});

test("readClipboardEventText extracts noVNC clipboard payloads", () => {
  assert.equal(
    readClipboardEventText({
      detail: {
        text: "copied from the guest",
      },
    } as unknown as Event),
    "copied from the guest",
  );
});

test("readClipboardEventText ignores unsupported event payloads", () => {
  assert.equal(readClipboardEventText(new Event("clipboard")), null);
  assert.equal(
    readClipboardEventText({
      detail: {
        text: 42,
      },
    } as unknown as Event),
    null,
  );
});

test("sendGuestPasteShortcut emits a Ctrl+V key sequence", () => {
  const calls: Array<{ code: string; down: boolean | undefined; keysym: number }> = [];
  const rfb = {
    sendKey(keysym: number, code: string, down?: boolean) {
      calls.push({
        code,
        down,
        keysym,
      });
    },
  } as Pick<FakeRfb, "sendKey"> as Parameters<typeof sendGuestPasteShortcut>[0];

  sendGuestPasteShortcut(rfb);

  assert.deepEqual(calls, [
    {
      code: "ControlLeft",
      down: true,
      keysym: 0xffe3,
    },
    {
      code: "KeyV",
      down: true,
      keysym: 0x0076,
    },
    {
      code: "KeyV",
      down: false,
      keysym: 0x0076,
    },
    {
      code: "ControlLeft",
      down: false,
      keysym: 0xffe3,
    },
  ]);
});

test("sendGuestCopyShortcut emits a Ctrl+C key sequence", () => {
  const calls: Array<{ code: string; down: boolean | undefined; keysym: number }> = [];
  const rfb = {
    sendKey(keysym: number, code: string, down?: boolean) {
      calls.push({
        code,
        down,
        keysym,
      });
    },
  } as Pick<FakeRfb, "sendKey"> as Parameters<typeof sendGuestCopyShortcut>[0];

  sendGuestCopyShortcut(rfb);

  assert.deepEqual(calls, [
    {
      code: "ControlLeft",
      down: true,
      keysym: 0xffe3,
    },
    {
      code: "KeyC",
      down: true,
      keysym: 0x0063,
    },
    {
      code: "KeyC",
      down: false,
      keysym: 0x0063,
    },
    {
      code: "ControlLeft",
      down: false,
      keysym: 0xffe3,
    },
  ]);
});

test("sendGuestText emits direct text input events", () => {
  const calls: Array<{ code: string; down: boolean | undefined; keysym: number }> = [];
  const rfb = {
    sendKey(keysym: number, code: string, down?: boolean) {
      calls.push({
        code,
        down,
        keysym,
      });
    },
  } as Pick<FakeRfb, "sendKey"> as Parameters<typeof sendGuestText>[0];

  sendGuestText(rfb, "A\tb\n");

  assert.deepEqual(calls, [
    {
      code: "",
      down: undefined,
      keysym: 0x41,
    },
    {
      code: "Tab",
      down: undefined,
      keysym: 0xff09,
    },
    {
      code: "",
      down: undefined,
      keysym: 0x62,
    },
    {
      code: "Enter",
      down: undefined,
      keysym: 0xff0d,
    },
  ]);
});

test("viewportSettingsForMode defaults the main session to remote resize", () => {
  assert.deepEqual(viewportSettingsForMode("remote"), {
    clipViewport: false,
    resizeSession: true,
    scaleViewport: false,
  });
});

test("viewportSettingsForMode keeps fixed sessions at a fixed remote size but scales to fit", () => {
  assert.deepEqual(viewportSettingsForMode("fit"), {
    clipViewport: false,
    resizeSession: false,
    scaleViewport: true,
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
