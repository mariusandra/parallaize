import type { VmSession } from "../../../packages/shared/src/types.js";

import { buildSyntheticSession } from "./providers-synthetic.js";

export type MockDesktopTransport = "synthetic" | "selkies";

export function buildMockDesktopSession(
  vmId: string,
  transport: MockDesktopTransport,
): VmSession {
  return transport === "selkies"
    ? buildMockSelkiesSession(vmId)
    : buildSyntheticSession();
}

export function buildMockSelkiesSession(vmId: string): VmSession {
  return {
    kind: "selkies",
    host: null,
    port: null,
    reachable: true,
    webSocketPath: null,
    browserPath: buildMockSelkiesBrowserPath(vmId),
    display: "Mock Selkies browser session",
  };
}

export function buildMockSelkiesBrowserPath(vmId: string): string {
  return `/mock-selkies/${vmId}/`;
}

export function buildMockSelkiesDocument({
  frameHref,
  preview,
  vmId,
  vmName,
}: {
  frameHref: string;
  preview: boolean;
  vmId: string;
  vmName: string;
}): string {
  const escapedFrameHref = escapeHtml(frameHref);
  const escapedName = escapeHtml(vmName);
  const modeLabel = preview ? "Preview stream" : "Live desktop";
  const noteField = preview
    ? `<p class="mock-selkies__hint">Sidebar preview is connected.</p>`
    : `<label class="mock-selkies__field">
        <span>Session note</span>
        <textarea aria-label="Session note" placeholder="Type to prove the session resumes"></textarea>
      </label>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedName} ${preview ? "preview" : "desktop"}</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top, rgba(94, 211, 136, 0.18), transparent 40%),
          linear-gradient(160deg, #071018 0%, #0f1c27 48%, #081117 100%);
        color: #f4f7f9;
      }

      .mock-selkies {
        display: grid;
        gap: 1rem;
        min-height: 100vh;
        padding: ${preview ? "1rem" : "1.4rem"};
      }

      .mock-selkies__meta {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex-wrap: wrap;
      }

      .mock-selkies__pill {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 0.35rem 0.75rem;
        background: rgba(94, 211, 136, 0.14);
        border: 1px solid rgba(94, 211, 136, 0.35);
        color: #baf3cd;
        font: 600 0.75rem/1 "IBM Plex Mono", "SFMono-Regular", monospace;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .mock-selkies__title {
        margin: 0;
        font-size: ${preview ? "1rem" : "1.4rem"};
        line-height: 1.1;
      }

      .mock-selkies__copy,
      .mock-selkies__hint,
      .mock-selkies__field span {
        margin: 0;
        color: rgba(244, 247, 249, 0.76);
        font-size: ${preview ? "0.78rem" : "0.95rem"};
      }

      .mock-selkies__image {
        width: 100%;
        display: block;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: ${preview ? "18px" : "24px"};
        background: rgba(5, 9, 14, 0.72);
        box-shadow: 0 30px 60px rgba(0, 0, 0, 0.35);
      }

      .mock-selkies[data-stream-pixelated="true"] .mock-selkies__image {
        image-rendering: crisp-edges;
        image-rendering: pixelated;
      }

      .mock-selkies__field {
        display: grid;
        gap: 0.5rem;
      }

      .mock-selkies__field textarea {
        width: 100%;
        min-height: 7rem;
        resize: vertical;
        border-radius: 16px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        padding: 0.85rem 1rem;
        background: rgba(5, 9, 14, 0.76);
        color: #f4f7f9;
        font: 500 0.95rem/1.45 "IBM Plex Mono", "SFMono-Regular", monospace;
      }
    </style>
  </head>
  <body>
    <main
      class="mock-selkies"
      data-background-mode="false"
      data-mode="${preview ? "preview" : "stage"}"
      data-stream-ready="true"
      data-stream-reload-count="0"
      data-stream-scale="1"
      data-stream-scale-native="true"
      data-stream-pixelated="false"
      data-focus-handoff-calls="0"
      data-stream-scale-updates="0"
    >
      <div class="mock-selkies__meta">
        <span class="mock-selkies__pill">${modeLabel}</span>
        <h1 class="mock-selkies__title">${escapedName}</h1>
      </div>
      <p class="mock-selkies__copy">Mock Selkies browser session for end-to-end dashboard coverage.</p>
      <img
        class="mock-selkies__image"
        alt="${escapedName} desktop image"
        src="${escapedFrameHref}"
      />
      ${noteField}
    </main>
      <script>
      const shell = document.querySelector(".mock-selkies");
      const sessionStorageKeyBase = ${JSON.stringify(`parallaize.mock.selkies:${vmId}`)};
      const kickCountKey = sessionStorageKeyBase + ":kick-count";
      const recoveryModeKey = sessionStorageKeyBase + ":recovery-mode";
      const reloadCountKey = sessionStorageKeyBase + ":reload-count";
      const storageKey = ${JSON.stringify(`parallaize.mock.selkies:${vmId}:note`)};
      function currentKickCount() {
        return Number(window.sessionStorage.getItem(kickCountKey) || "0");
      }
      function recordKick() {
        const nextKickCount = currentKickCount() + 1;
        window.sessionStorage.setItem(kickCountKey, String(nextKickCount));
        return nextKickCount;
      }
      function currentReloadCount() {
        return Number(window.sessionStorage.getItem(reloadCountKey) || "0");
      }
      function recordReload() {
        const nextReloadCount = currentReloadCount() + 1;
        window.sessionStorage.setItem(reloadCountKey, String(nextReloadCount));
        if (shell instanceof HTMLElement) {
          shell.dataset.streamReloadCount = String(nextReloadCount);
        }
        return nextReloadCount;
      }
      function recordFocusHandoffCall() {
        if (!(shell instanceof HTMLElement)) {
          return;
        }

        shell.dataset.focusHandoffCalls = String(
          Number(shell.dataset.focusHandoffCalls || "0") + 1,
        );
      }
      function wrapFocusTarget(target) {
        if (!target || typeof target.focus !== "function") {
          return;
        }

        const originalFocus = target.focus.bind(target);
        target.focus = (...args) => {
          recordFocusHandoffCall();
          return originalFocus(...args);
        };
      }
      wrapFocusTarget(window);
      wrapFocusTarget(document.documentElement);
      wrapFocusTarget(document.body);
      const reloadCount = recordReload();
      function setBackgroundMode(background) {
        if (shell instanceof HTMLElement) {
          shell.dataset.backgroundMode = background ? "true" : "false";
        }
      }
      function setStreamReady(ready) {
        if (shell instanceof HTMLElement) {
          shell.dataset.streamReady = ready ? "true" : "false";
        }
      }
      function setStreamStatus(status) {
        if (shell instanceof HTMLElement) {
          shell.dataset.streamStatus = status;
        }
      }
      function setStreamScale(scale) {
        if (!(shell instanceof HTMLElement)) {
          return false;
        }
        if (!Number.isFinite(scale) || scale <= 0) {
          return false;
        }
        const roundedScale = Math.round(scale * 100) / 100;
        const devicePixelRatio = Number(window.devicePixelRatio) || 1;
        shell.dataset.streamScale = String(roundedScale);
        shell.dataset.streamScaleNative = "true";
        shell.dataset.streamPixelated =
          roundedScale + 0.01 < devicePixelRatio ? "true" : "false";
        shell.dataset.streamScaleUpdates = String(
          Number(shell.dataset.streamScaleUpdates || "0") + 1,
        );
        return true;
      }
      window.parallaizeSetBackgroundMode = (background) => {
        setBackgroundMode(Boolean(background));
      };
      setBackgroundMode(false);
      window.parallaizeSetStreamReady = (ready) => {
        const nextReady = Boolean(ready);
        setStreamReady(nextReady);
        setStreamStatus(nextReady ? "" : "Waiting for stream.");
      };
      window.parallaizeSetStreamStatus = (status) => {
        setStreamStatus(typeof status === "string" ? status : "");
      };
      window.parallaizeGetStreamState = () => {
        return {
          ready: !(shell instanceof HTMLElement) || shell.dataset.streamReady !== "false",
          status:
            !(shell instanceof HTMLElement)
              ? ""
              : shell.dataset.streamStatus ?? "",
        };
      };
      window.parallaizeKickStream = () => {
        recordKick();
        if (window.sessionStorage.getItem(recoveryModeKey) === "reload") {
          setStreamReady(false);
          if (!(shell instanceof HTMLElement) || !shell.dataset.streamStatus) {
            setStreamStatus("Connection failed.");
          }
          return true;
        }
        setStreamReady(true);
        setStreamStatus("");
        return true;
      };
      window.parallaizeSetStreamScale = (scale) => {
        return setStreamScale(Number(scale));
      };
      window.parallaizeGetKickCount = () => currentKickCount();
      window.parallaizeGetReloadCount = () => currentReloadCount();
      window.parallaizeRequireReloadRecovery = () => {
        window.sessionStorage.setItem(recoveryModeKey, "reload");
        setStreamReady(false);
        setStreamStatus("Connection failed.");
        return true;
      };
      if (window.sessionStorage.getItem(recoveryModeKey) === "reload" && reloadCount > 1) {
        window.sessionStorage.removeItem(recoveryModeKey);
        setStreamReady(true);
        setStreamStatus("");
      } else if (window.sessionStorage.getItem(recoveryModeKey) === "reload") {
        setStreamReady(false);
        setStreamStatus("Connection failed.");
      } else {
        setStreamReady(true);
        setStreamStatus("");
      }
      setStreamScale(window.devicePixelRatio || 1);
      const textarea = document.querySelector("textarea");
      const clipboardListeners = new Set();
      function notifyGuestClipboard(text) {
        clipboardListeners.forEach((listener) => {
          try {
            listener(text);
          } catch (error) {
            console.error("mock selkies clipboard listener failed", error);
          }
        });
      }
      function currentClipboardText() {
        return textarea instanceof HTMLTextAreaElement ? textarea.value : "";
      }
      function persistTextareaValue() {
        if (!(textarea instanceof HTMLTextAreaElement)) {
          return;
        }
        window.localStorage.setItem(storageKey, textarea.value);
      }
      function setClipboardText(text) {
        if (!(textarea instanceof HTMLTextAreaElement)) {
          return false;
        }
        textarea.value = text;
        persistTextareaValue();
        return true;
      }
      window.parallaizeWriteGuestClipboard = (text) => {
        return typeof text === "string" ? setClipboardText(text) : false;
      };
      window.parallaizeRequestGuestClipboard = () => {
        notifyGuestClipboard(currentClipboardText());
        return true;
      };
      window.parallaizeTriggerGuestPaste = () => true;
      window.parallaizeSubscribeGuestClipboard = (listener) => {
        if (typeof listener !== "function") {
          return () => {};
        }
        clipboardListeners.add(listener);
        return () => {
          clipboardListeners.delete(listener);
        };
      };
      if (textarea instanceof HTMLTextAreaElement) {
        const savedValue = window.localStorage.getItem(storageKey);
        if (savedValue !== null) {
          textarea.value = savedValue;
        }
        textarea.addEventListener("input", () => {
          persistTextareaValue();
        });
      }
    </script>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
