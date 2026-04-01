import { useEffect, useRef, useState, type JSX, type RefObject } from "react";

import { focusEmbeddedFrameTarget } from "./embeddedFrameFocus.js";
import {
  clipboardPasteShortcutLabel,
  copyTextWithSelection,
  primeClipboardPasteCaptureTarget,
  readBrowserClipboardText,
  readClipboardTransferText,
  resolveClipboardShortcutAction,
  writeBrowserClipboardText,
} from "./novnc.js";

interface SelkiesClipboardOverlayProps {
  frameRef: RefObject<HTMLIFrameElement | null>;
  onPasteRequestHandled?: (token: number) => void;
  pasteRequestToken?: number | null;
  sessionKey: string;
}

type ClipboardNoticeTone = "muted" | "success" | "warning";
type GuestPasteResult = "pasted" | "synced" | "unavailable";

interface SelkiesClipboardBridgeWindow extends Window {
  parallaizeRequestGuestClipboard?: () => boolean;
  parallaizeSubscribeGuestClipboard?: (
    listener: (text: string) => void,
  ) => (() => void) | void;
  parallaizeTriggerGuestPaste?: () => boolean;
  parallaizeWriteGuestClipboard?: (text: string) => boolean;
}

const clipboardNoticeTimeoutMs = 4_500;

function isEditablePasteTarget(
  target: EventTarget | null,
  hiddenPasteCapture: HTMLTextAreaElement | null,
): boolean {
  if (target === hiddenPasteCapture) {
    return false;
  }

  if (!(target instanceof Element)) {
    return false;
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function SelkiesClipboardOverlay({
  frameRef,
  onPasteRequestHandled,
  pasteRequestToken = null,
  sessionKey,
}: SelkiesClipboardOverlayProps): JSX.Element | null {
  const handledPasteRequestTokenRef = useRef<number | null>(null);
  const hiddenPasteCaptureRef = useRef<HTMLTextAreaElement | null>(null);
  const manualPasteFieldRef = useRef<HTMLTextAreaElement | null>(null);
  const lastGuestClipboardTextRef = useRef<string | null>(null);
  const [clipboardNotice, setClipboardNotice] = useState<string | null>(null);
  const [clipboardNoticeTone, setClipboardNoticeTone] = useState<ClipboardNoticeTone>("muted");
  const [clipboardControlsDismissed, setClipboardControlsDismissed] = useState(false);
  const [awaitingPasteShortcut, setAwaitingPasteShortcut] = useState(false);
  const [manualPasteDraft, setManualPasteDraft] = useState("");
  const [pendingGuestClipboardText, setPendingGuestClipboardText] = useState<string | null>(null);
  const pasteShortcut = clipboardPasteShortcutLabel(globalThis.navigator?.platform);
  const browserClipboardReadAvailable =
    typeof globalThis.navigator?.clipboard?.readText === "function";
  const showPasteLocalButton = awaitingPasteShortcut || !browserClipboardReadAvailable;
  const resolvedClipboardMessage =
    clipboardNotice ??
    (pendingGuestClipboardText
      ? "Guest clipboard is ready. Automatic browser copy was blocked."
      : null);
  const resolvedClipboardTone =
    clipboardNotice !== null
      ? clipboardNoticeTone
      : pendingGuestClipboardText
        ? "warning"
        : "muted";

  function setTransientClipboardNotice(
    message: string,
    tone: ClipboardNoticeTone,
  ): void {
    setClipboardNotice(message);
    setClipboardNoticeTone(tone);
  }

  function resolveBridgeWindow(): SelkiesClipboardBridgeWindow | null {
    const frame = frameRef.current;

    if (!frame) {
      return null;
    }

    try {
      return frame.contentWindow as SelkiesClipboardBridgeWindow | null;
    } catch {
      return null;
    }
  }

  function focusGuestDesktop(): void {
    const frame = frameRef.current;

    if (!frame) {
      return;
    }

    focusEmbeddedFrameTarget(frame);
  }

  function dismissClipboardControls(): void {
    setClipboardControlsDismissed(true);
    setClipboardNotice(null);
    setClipboardNoticeTone("muted");
    setAwaitingPasteShortcut(false);
    setManualPasteDraft("");
    focusGuestDesktop();
  }

  function sendClipboardToGuest(text: string): GuestPasteResult {
    const bridgeWindow = resolveBridgeWindow();

    if (!bridgeWindow?.parallaizeWriteGuestClipboard) {
      return "unavailable";
    }

    if (bridgeWindow.parallaizeWriteGuestClipboard(text) === false) {
      return "unavailable";
    }

    const pasteTriggered =
      typeof bridgeWindow.parallaizeTriggerGuestPaste === "function"
        ? bridgeWindow.parallaizeTriggerGuestPaste() !== false
        : false;

    focusGuestDesktop();
    return pasteTriggered ? "pasted" : "synced";
  }

  function resolveGuestPasteMessage(result: GuestPasteResult): string | null {
    switch (result) {
      case "pasted":
        return "Sent local text to the guest.";
      case "synced":
        return "Sent local text to the guest clipboard. Use Ctrl+V in the desktop if needed.";
      default:
        return null;
    }
  }

  async function handlePasteFromBrowserClipboard(): Promise<void> {
    try {
      const clipboardText = await readBrowserClipboardText(globalThis.navigator?.clipboard);

      if (clipboardText.length === 0) {
        setTransientClipboardNotice("Local clipboard is empty.", "warning");
        return;
      }

      const pasteResult = sendClipboardToGuest(clipboardText);
      const successMessage = resolveGuestPasteMessage(pasteResult);

      if (!successMessage) {
        setTransientClipboardNotice("Desktop not ready yet. Retry once the session reconnects.", "warning");
        return;
      }

      setTransientClipboardNotice(successMessage, "success");
    } catch {
      setAwaitingPasteShortcut(true);
      setManualPasteDraft("");
      setTransientClipboardNotice(
        `Browser clipboard read is unavailable here. Press ${pasteShortcut} in the field below and it will be sent to the guest.`,
        "warning",
      );
      window.requestAnimationFrame(() => {
        primeClipboardPasteCaptureTarget(hiddenPasteCaptureRef.current);
      });
    }
  }

  async function beginPasteFromBrowserClipboard(): Promise<void> {
    setClipboardControlsDismissed(false);
    await handlePasteFromBrowserClipboard();
  }

  async function handleCopyGuestClipboard(): Promise<void> {
    if (!pendingGuestClipboardText) {
      return;
    }

    try {
      await writeBrowserClipboardText(
        globalThis.navigator?.clipboard,
        pendingGuestClipboardText,
      );
      setPendingGuestClipboardText(null);
      setTransientClipboardNotice("Guest clipboard copied to your browser.", "success");
      return;
    } catch {
      if (!copyTextWithSelection(pendingGuestClipboardText)) {
        setTransientClipboardNotice(
          "Browser clipboard write was blocked. Try copying again inside the guest.",
          "warning",
        );
        return;
      }
    }

    setPendingGuestClipboardText(null);
    setTransientClipboardNotice("Guest clipboard copied to your browser.", "success");
  }

  function handleManualPasteText(clipboardText: string): void {
    setAwaitingPasteShortcut(false);
    setManualPasteDraft("");

    if (clipboardText.length === 0) {
      setTransientClipboardNotice("Local clipboard is empty.", "warning");
      focusGuestDesktop();
      return;
    }

    const pasteResult = sendClipboardToGuest(clipboardText);
    const successMessage = resolveGuestPasteMessage(pasteResult);

    if (!successMessage) {
      setTransientClipboardNotice(
        "Desktop not ready yet. Retry once the session reconnects.",
        "warning",
      );
      return;
    }

    setTransientClipboardNotice(successMessage, "success");
  }

  useEffect(() => {
    if (!clipboardNotice) {
      return;
    }

    const timer = window.setTimeout(() => {
      setClipboardNotice(null);
      setClipboardNoticeTone("muted");
    }, clipboardNoticeTimeoutMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [clipboardNotice]);

  useEffect(() => {
    setClipboardNotice(null);
    setClipboardNoticeTone("muted");
    setClipboardControlsDismissed(false);
    setAwaitingPasteShortcut(false);
    setManualPasteDraft("");
    setPendingGuestClipboardText(null);
    lastGuestClipboardTextRef.current = null;
  }, [sessionKey]);

  useEffect(() => {
    if (pasteRequestToken === null) {
      return;
    }

    const requestToken: number = pasteRequestToken;

    if (handledPasteRequestTokenRef.current === requestToken) {
      return;
    }

    let cancelled = false;
    let pollTimer: number | null = null;
    const frame = frameRef.current;

    function clearPollTimer(): void {
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function tryHandlePasteRequest(): boolean {
      if (cancelled) {
        return true;
      }

      if (handledPasteRequestTokenRef.current === requestToken) {
        return true;
      }

      const bridgeWindow = resolveBridgeWindow();

      if (!bridgeWindow?.parallaizeWriteGuestClipboard) {
        return false;
      }

      handledPasteRequestTokenRef.current = requestToken;
      onPasteRequestHandled?.(requestToken);
      void beginPasteFromBrowserClipboard();
      return true;
    }

    if (tryHandlePasteRequest()) {
      return;
    }

    const handleFrameLoad = () => {
      if (tryHandlePasteRequest()) {
        clearPollTimer();
      }
    };

    frame?.addEventListener("load", handleFrameLoad);
    pollTimer = window.setInterval(() => {
      if (tryHandlePasteRequest()) {
        clearPollTimer();
      }
    }, 250);

    return () => {
      cancelled = true;
      frame?.removeEventListener("load", handleFrameLoad);
      clearPollTimer();
    };
  }, [frameRef, onPasteRequestHandled, pasteRequestToken, sessionKey]);

  useEffect(() => {
    if (!awaitingPasteShortcut) {
      return;
    }

    const target = manualPasteFieldRef.current;

    if (!target) {
      return;
    }

    window.requestAnimationFrame(() => {
      if (manualPasteFieldRef.current !== target) {
        return;
      }

      target.focus({
        preventScroll: true,
      });
      target.select();
      target.setSelectionRange(0, target.value.length);
    });
  }, [awaitingPasteShortcut]);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: number | null = null;
    let unsubscribe: (() => void) | null = null;

    function handleGuestClipboardText(clipboardText: string): void {
      if (clipboardText.length === 0) {
        setPendingGuestClipboardText(null);
        setTransientClipboardNotice("Guest clipboard cleared.", "success");
        return;
      }

      if (lastGuestClipboardTextRef.current !== clipboardText) {
        lastGuestClipboardTextRef.current = clipboardText;
        setClipboardControlsDismissed(false);
      }

      void writeBrowserClipboardText(
        globalThis.navigator?.clipboard,
        clipboardText,
      )
        .then(() => {
          if (cancelled) {
            return;
          }

          setPendingGuestClipboardText(null);
          setTransientClipboardNotice(
            "Guest clipboard copied to your browser.",
            "success",
          );
        })
        .catch(() => {
          if (cancelled) {
            return;
          }

          setPendingGuestClipboardText(clipboardText);
          setTransientClipboardNotice(
            "Guest clipboard is ready. Automatic browser copy was blocked.",
            "warning",
          );
        });
    }

    function clearSubscription(): void {
      unsubscribe?.();
      unsubscribe = null;
    }

    function attachClipboardSubscription(): boolean {
      clearSubscription();

      const bridgeWindow = resolveBridgeWindow();

      if (!bridgeWindow?.parallaizeSubscribeGuestClipboard) {
        return false;
      }

      const maybeUnsubscribe = bridgeWindow.parallaizeSubscribeGuestClipboard(
        (clipboardText) => {
          if (cancelled) {
            return;
          }

          handleGuestClipboardText(clipboardText);
        },
      );

      unsubscribe =
        typeof maybeUnsubscribe === "function"
          ? maybeUnsubscribe
          : null;
      return true;
    }

    const frame = frameRef.current;
    const handleFrameLoad = () => {
      attachClipboardSubscription();
    };

    frame?.addEventListener("load", handleFrameLoad);

    if (!attachClipboardSubscription()) {
      pollTimer = window.setInterval(() => {
        if (!attachClipboardSubscription()) {
          return;
        }

        if (pollTimer !== null) {
          window.clearInterval(pollTimer);
          pollTimer = null;
        }
      }, 250);
    }

    return () => {
      cancelled = true;
      frame?.removeEventListener("load", handleFrameLoad);
      clearSubscription();

      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
      }
    };
  }, [frameRef, sessionKey]);

  useEffect(() => {
    if (!awaitingPasteShortcut) {
      return;
    }

    function handleDocumentKeyDown(event: KeyboardEvent): void {
      if (event.target === hiddenPasteCaptureRef.current) {
        return;
      }

      if (isEditablePasteTarget(event.target, hiddenPasteCaptureRef.current)) {
        return;
      }

      if (event.key === "Escape") {
        setAwaitingPasteShortcut(false);
        focusGuestDesktop();
        return;
      }

      const action = resolveClipboardShortcutAction(
        event,
        globalThis.navigator?.platform,
      );

      if (action !== "paste") {
        return;
      }

      primeClipboardPasteCaptureTarget(hiddenPasteCaptureRef.current);
    }

    function handleDocumentPaste(event: ClipboardEvent): void {
      if (event.target === hiddenPasteCaptureRef.current) {
        return;
      }

      if (isEditablePasteTarget(event.target, hiddenPasteCaptureRef.current)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      handleManualPasteText(readClipboardTransferText(event.clipboardData));
    }

    document.addEventListener("keydown", handleDocumentKeyDown, true);
    document.addEventListener("paste", handleDocumentPaste, true);

    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown, true);
      document.removeEventListener("paste", handleDocumentPaste, true);
    };
  }, [awaitingPasteShortcut]);

  if (clipboardControlsDismissed) {
    return null;
  }

  return (
    <div className="novnc-shell__clipboard">
      <div className="novnc-shell__clipboard-actions">
        {showPasteLocalButton ? (
          <button
            className="button button--ghost novnc-shell__clipboard-button"
            type="button"
            onClick={() => void beginPasteFromBrowserClipboard()}
          >
            {awaitingPasteShortcut ? `Press ${pasteShortcut}` : "Paste local"}
          </button>
        ) : null}
        {pendingGuestClipboardText ? (
          <button
            className="button button--secondary novnc-shell__clipboard-button novnc-shell__clipboard-button--accent"
            type="button"
            onClick={() => void handleCopyGuestClipboard()}
          >
            Copy guest
          </button>
        ) : null}
        <button
          className="button button--ghost novnc-shell__clipboard-button novnc-shell__clipboard-dismiss"
          type="button"
          aria-label="Hide clipboard controls"
          onClick={dismissClipboardControls}
        >
          x
        </button>
      </div>
      {resolvedClipboardMessage ? (
        <p
          className={joinClassNames(
            "novnc-shell__clipboard-copy",
            `novnc-shell__clipboard-copy--${resolvedClipboardTone}`,
          )}
          aria-live="polite"
        >
          {resolvedClipboardMessage}
        </p>
      ) : null}
      {awaitingPasteShortcut ? (
        <div className="novnc-shell__clipboard-panel">
          <p className="novnc-shell__clipboard-label">Paste local text</p>
          <textarea
            ref={manualPasteFieldRef}
            aria-label="Paste local text"
            className="novnc-shell__clipboard-input"
            value={manualPasteDraft}
            placeholder={`Press ${pasteShortcut} here when browser clipboard access is blocked.`}
            onChange={(event) => {
              setManualPasteDraft(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setAwaitingPasteShortcut(false);
                setManualPasteDraft("");
                focusGuestDesktop();
              }
            }}
            onPaste={(event) => {
              event.preventDefault();
              event.stopPropagation();
              handleManualPasteText(readClipboardTransferText(event.clipboardData));
            }}
            spellCheck={false}
          />
          <div className="novnc-shell__clipboard-panel-actions">
            <button
              className="button button--secondary"
              type="button"
              disabled={manualPasteDraft.length === 0}
              onClick={() => {
                handleManualPasteText(manualPasteDraft);
              }}
            >
              Send to guest
            </button>
            <button
              className="button button--ghost"
              type="button"
              onClick={() => {
                setAwaitingPasteShortcut(false);
                setManualPasteDraft("");
                focusGuestDesktop();
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      <textarea
        ref={hiddenPasteCaptureRef}
        aria-hidden="true"
        defaultValue=""
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setAwaitingPasteShortcut(false);
            focusGuestDesktop();
          }
        }}
        onPaste={(event) => {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.value = "";
          handleManualPasteText(readClipboardTransferText(event.clipboardData));
        }}
        spellCheck={false}
        style={{
          height: "1px",
          left: "-9999px",
          opacity: "0",
          pointerEvents: "none",
          position: "fixed",
          top: "0",
          width: "1px",
        }}
        tabIndex={-1}
      />
    </div>
  );
}

function joinClassNames(...values: Array<string | null | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}
