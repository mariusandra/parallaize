import { memo, useEffect, useRef, useState, type JSX } from "react";

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
  viewportSettingsForMode,
  writeBrowserClipboardText,
  type RfbLike,
  type RfbViewportMode,
} from "./novnc.js";

export interface NoVncViewportResolution {
  clientHeight: number | null;
  clientWidth: number | null;
  remoteHeight: number | null;
  remoteWidth: number | null;
}

interface NoVncViewportProps {
  className?: string;
  hideConnectedOverlayStatus?: boolean;
  onResolutionChange?: (resolution: NoVncViewportResolution) => void;
  reconnectDelayMs?: number;
  showHeader?: boolean;
  statusMode?: "header" | "overlay" | "hidden";
  surfaceClassName?: string;
  title?: string;
  viewportMode?: RfbViewportMode;
  viewOnly?: boolean;
  webSocketPath: string;
}

type ConnectionState = "connecting" | "connected" | "disconnected" | "error";
type ClipboardNoticeTone = "muted" | "success" | "warning";

const defaultReconnectDelayMs = 1_000;
const clipboardNoticeTimeoutMs = 4_500;
let rfbModulePromise: Promise<{
  default?: unknown;
}> | null = null;

export const NoVncViewport = memo(function NoVncViewport({
  className,
  hideConnectedOverlayStatus = false,
  onResolutionChange,
  reconnectDelayMs = defaultReconnectDelayMs,
  showHeader = true,
  statusMode = showHeader ? "header" : "overlay",
  surfaceClassName,
  title = "Desktop session",
  viewportMode = "remote",
  viewOnly = false,
  webSocketPath,
}: NoVncViewportProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hiddenPasteCaptureRef = useRef<HTMLTextAreaElement | null>(null);
  const lastGuestClipboardTextRef = useRef<string | null>(null);
  const rfbRef = useRef<RfbLike | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [statusMessage, setStatusMessage] = useState("Connecting to the guest desktop...");
  const [clipboardNotice, setClipboardNotice] = useState<string | null>(null);
  const [clipboardNoticeTone, setClipboardNoticeTone] = useState<ClipboardNoticeTone>("muted");
  const [clipboardControlsDismissed, setClipboardControlsDismissed] = useState(false);
  const [awaitingPasteShortcut, setAwaitingPasteShortcut] = useState(false);
  const [pendingGuestClipboardText, setPendingGuestClipboardText] = useState<string | null>(null);
  const clipboardEnabled = !viewOnly;
  const pasteShortcut = clipboardPasteShortcutLabel(globalThis.navigator?.platform);
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

  function dismissClipboardControls(): void {
    setClipboardControlsDismissed(true);
    setClipboardNotice(null);
    setClipboardNoticeTone("muted");
    setAwaitingPasteShortcut(false);
    focusRemoteDesktop();
  }

  function focusRemoteDesktop(): void {
    rfbRef.current?.focus({
      preventScroll: true,
    });
  }

  function sendClipboardToGuest(text: string): boolean {
    const rfb = rfbRef.current;

    if (!clipboardEnabled || !rfb || connectionState !== "connected") {
      return false;
    }

    rfb.clipboardPasteFrom(text);
    focusRemoteDesktop();
    return true;
  }

  function pasteClipboardIntoFocusedGuestTarget(text: string): boolean {
    const rfb = rfbRef.current;

    if (!sendClipboardToGuest(text) || !rfb) {
      return false;
    }

    sendGuestText(rfb, text);
    focusRemoteDesktop();
    return true;
  }

  async function handlePasteFromBrowserClipboard(): Promise<void> {
    try {
      const clipboardText = await readBrowserClipboardText(globalThis.navigator?.clipboard);

      if (clipboardText.length === 0) {
        setTransientClipboardNotice("Local clipboard is empty.", "warning");
        return;
      }

      if (!pasteClipboardIntoFocusedGuestTarget(clipboardText)) {
        setTransientClipboardNotice("Desktop not ready yet. Retry once the session reconnects.", "warning");
        return;
      }

      setTransientClipboardNotice("Sent local text to the guest.", "success");
    } catch {
      if (!primeClipboardPasteCaptureTarget(hiddenPasteCaptureRef.current)) {
        setTransientClipboardNotice(
          "Browser clipboard read is unavailable here, and the local paste fallback could not be armed.",
          "warning",
        );
        return;
      }

      setAwaitingPasteShortcut(true);
      if (connectionState !== "connected") {
        setTransientClipboardNotice("Desktop not ready yet. Retry once the session reconnects.", "warning");
        return;
      }

      setTransientClipboardNotice(
        `Browser clipboard read is unavailable here. Press ${pasteShortcut} now and it will be sent to the guest.`,
        "warning",
      );
    }
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
    setPendingGuestClipboardText(null);
    lastGuestClipboardTextRef.current = null;
  }, [viewOnly, webSocketPath]);

  useEffect(() => {
    const rfb = rfbRef.current;

    if (!rfb) {
      return;
    }

    const viewportSettings = viewportSettingsForMode(viewportMode);
    rfb.scaleViewport = viewportSettings.scaleViewport;
    rfb.resizeSession = viewportSettings.resizeSession;
    rfb.clipViewport = viewportSettings.clipViewport;
    rfb.viewOnly = viewOnly;
  }, [viewportMode, viewOnly]);

  useEffect(() => {
    if (!onResolutionChange) {
      return;
    }

    const mountNode = containerRef.current;
    const reportResolutionChange = onResolutionChange;

    if (!mountNode) {
      return;
    }

    const resolvedMountNode: HTMLDivElement = mountNode;

    let activeCanvas: HTMLCanvasElement | null = null;
    let containerResizeObserver: ResizeObserver | null = null;
    let canvasResizeObserver: ResizeObserver | null = null;
    let canvasMutationObserver: MutationObserver | null = null;
    let remoteResolutionPollTimer: number | null = null;
    let lastSerialized = "";

    function reportResolution(canvas: HTMLCanvasElement | null): void {
      const bounds = resolvedMountNode.getBoundingClientRect();
      const framebufferSize = readRfbFramebufferSize(rfbRef.current);
      const nextResolution: NoVncViewportResolution = {
        clientHeight: bounds.height > 0 ? Math.round(bounds.height) : null,
        clientWidth: bounds.width > 0 ? Math.round(bounds.width) : null,
        remoteHeight:
          framebufferSize.height ??
          (canvas && canvas.height > 0 ? canvas.height : null),
        remoteWidth:
          framebufferSize.width ??
          (canvas && canvas.width > 0 ? canvas.width : null),
      };
      const serialized = JSON.stringify(nextResolution);

      if (serialized === lastSerialized) {
        return;
      }

      lastSerialized = serialized;
      reportResolutionChange(nextResolution);
    }

    function detachCanvasObservers(): void {
      canvasResizeObserver?.disconnect();
      canvasMutationObserver?.disconnect();
      canvasResizeObserver = null;
      canvasMutationObserver = null;
    }

    function attachCanvas(canvas: HTMLCanvasElement | null): void {
      if (canvas === activeCanvas) {
        reportResolution(activeCanvas);
        return;
      }

      detachCanvasObservers();
      activeCanvas = canvas;

      if (!activeCanvas) {
        reportResolution(null);
        return;
      }

      canvasResizeObserver = new ResizeObserver(() => {
        reportResolution(activeCanvas);
      });
      canvasResizeObserver.observe(activeCanvas);

      canvasMutationObserver = new MutationObserver(() => {
        reportResolution(activeCanvas);
      });
      canvasMutationObserver.observe(activeCanvas, {
        attributeFilter: ["height", "width"],
        attributes: true,
      });

      reportResolution(activeCanvas);
    }

    const containerObserver = new MutationObserver(() => {
      attachCanvas(resolvedMountNode.querySelector<HTMLCanvasElement>("canvas"));
    });
    containerResizeObserver = new ResizeObserver(() => {
      reportResolution(activeCanvas);
    });

    containerObserver.observe(resolvedMountNode, {
      childList: true,
      subtree: true,
    });
    containerResizeObserver.observe(resolvedMountNode);
    remoteResolutionPollTimer = window.setInterval(() => {
      reportResolution(activeCanvas);
    }, 250);

    attachCanvas(resolvedMountNode.querySelector<HTMLCanvasElement>("canvas"));

    return () => {
      containerObserver.disconnect();
      containerResizeObserver?.disconnect();
      if (remoteResolutionPollTimer !== null) {
        window.clearInterval(remoteResolutionPollTimer);
      }
      detachCanvasObservers();
      activeCanvas = null;
      reportResolutionChange({
        clientHeight: null,
        clientWidth: null,
        remoteHeight: null,
        remoteWidth: null,
      });
    };
  }, [onResolutionChange]);

  useEffect(() => {
    if (!clipboardEnabled) {
      return;
    }

    const mountNode = containerRef.current;

    if (!mountNode) {
      return;
    }

    function handlePaste(event: ClipboardEvent): void {
      const clipboardText = readClipboardTransferText(event.clipboardData);

      if (clipboardText.length === 0) {
        return;
      }

      if (!pasteClipboardIntoFocusedGuestTarget(clipboardText)) {
        setTransientClipboardNotice("Desktop not ready yet. Retry once the session reconnects.", "warning");
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setTransientClipboardNotice("Sent local text to the guest.", "success");
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.target === hiddenPasteCaptureRef.current) {
        return;
      }

      const action = resolveClipboardShortcutAction(
        event,
        globalThis.navigator?.platform,
      );

      if (!action) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (action === "paste") {
        void handlePasteFromBrowserClipboard();
        return;
      }

      const rfb = rfbRef.current;

      if (!rfb || connectionState !== "connected") {
        setTransientClipboardNotice(
          "Desktop not ready yet. Retry once the session reconnects.",
          "warning",
        );
        return;
      }

      sendGuestCopyShortcut(rfb);
      focusRemoteDesktop();
    }

    mountNode.addEventListener("paste", handlePaste);
    mountNode.addEventListener("keydown", handleKeyDown);

    return () => {
      mountNode.removeEventListener("paste", handlePaste);
      mountNode.removeEventListener("keydown", handleKeyDown);
    };
  }, [clipboardEnabled, connectionState]);

  useEffect(() => {
    const mountNode = containerRef.current;

    if (!mountNode) {
      return;
    }

    const container = mountNode;
    container.replaceChildren();
    let cancelled = false;
    let rfb: RfbLike | null = null;
    let handleConnect: (() => void) | null = null;
    let handleClipboard: ((event: Event) => void) | null = null;
    let handleDisconnect: ((event: Event) => void) | null = null;
    let handleSecurityFailure: (() => void) | null = null;
    let retryTimer: number | null = null;
    const [socketUrl] = buildRfbSocketUrls(webSocketPath, window.location);

    function clearRetryTimer(): void {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    }

    function disposeRfb(disconnect: boolean): void {
      if (rfb) {
        if (handleConnect) {
          rfb.removeEventListener("connect", handleConnect);
        }

        if (handleClipboard) {
          rfb.removeEventListener("clipboard", handleClipboard);
        }

        if (handleDisconnect) {
          rfb.removeEventListener("disconnect", handleDisconnect);
        }

        if (handleSecurityFailure) {
          rfb.removeEventListener("securityfailure", handleSecurityFailure);
        }
      }

      if (disconnect) {
        rfb?.disconnect();
      }

      rfb = null;
      rfbRef.current = null;
      handleConnect = null;
      handleClipboard = null;
      handleDisconnect = null;
      handleSecurityFailure = null;
      container.replaceChildren();
    }

    function scheduleReconnect(message: string, delayMs = reconnectDelayMs): void {
      if (cancelled || retryTimer !== null) {
        return;
      }

      setConnectionState("connecting");
      setStatusMessage(message);
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void connect();
      }, delayMs);
    }

    async function connect(): Promise<void> {
      try {
        clearRetryTimer();
        disposeRfb(false);
        setConnectionState("connecting");
        setStatusMessage("Connecting to the guest desktop...");
        const imported = await loadRfbModule();

        if (cancelled) {
          return;
        }

        const RFB = resolveRfbConstructor(imported);

        if (!RFB) {
          throw new Error("Failed to load the noVNC client constructor.");
        }

        if (!socketUrl) {
          throw new Error("No browser VNC bridge URL is available.");
        }

        rfb = new RFB(container, socketUrl, {
          shared: true,
        });
        applySafeRfbEncodingPatch(rfb);
        rfbRef.current = rfb;
        const viewportSettings = viewportSettingsForMode(viewportMode);
        rfb.scaleViewport = viewportSettings.scaleViewport;
        rfb.resizeSession = viewportSettings.resizeSession;
        rfb.clipViewport = viewportSettings.clipViewport;
        rfb.viewOnly = viewOnly;
        rfb.background = "#05070b";

        handleConnect = () => {
          clearRetryTimer();
          setConnectionState("connected");
          setStatusMessage("Desktop connected.");
        };

        handleDisconnect = (event: Event) => {
          const detail = (event as CustomEvent<{ clean: boolean }>).detail;
          disposeRfb(false);

          scheduleReconnect(
            detail?.clean
              ? "Desktop disconnected. Reconnecting..."
              : "Desktop connection dropped. Retrying...",
          );
        };

        handleSecurityFailure = () => {
          setConnectionState("error");
          setStatusMessage("The browser VNC bridge rejected the connection.");
        };

        handleClipboard =
          clipboardEnabled
            ? (event: Event) => {
                const clipboardText = readClipboardEventText(event);

                if (clipboardText === null || cancelled) {
                  return;
                }

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
            : null;

        rfb.addEventListener("connect", handleConnect);
        if (handleClipboard) {
          rfb.addEventListener("clipboard", handleClipboard);
        }
        rfb.addEventListener("disconnect", handleDisconnect);
        rfb.addEventListener("securityfailure", handleSecurityFailure);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setConnectionState("error");
        setStatusMessage(
          error instanceof Error
            ? error.message
            : "Failed to load the browser VNC client.",
        );
      }
    }

    void connect();

    return () => {
      cancelled = true;
      clearRetryTimer();
      disposeRfb(true);
    };
  }, [webSocketPath]);

  return (
    <div
      className={joinClassNames(
        "novnc-shell",
        `novnc-shell--${viewportMode}`,
        className,
      )}
    >
      {showHeader && statusMode === "header" ? (
        <div className="novnc-shell__header">
          <span>{title}</span>
          <span className={connectionStateClassName(connectionState)}>{statusMessage}</span>
        </div>
      ) : null}

      <div
        ref={containerRef}
        className={joinClassNames(
          "novnc-surface",
          `novnc-surface--${viewportMode}`,
          surfaceClassName,
        )}
      />

      {!showHeader &&
      statusMode === "overlay" &&
      !(hideConnectedOverlayStatus && connectionState === "connected") ? (
        <div className="novnc-shell__overlay">
          <span className={joinClassNames("novnc-shell__status-pill", connectionStateClassName(connectionState))}>
            {connectionState === "connected" ? "Live" : statusMessage}
          </span>
        </div>
      ) : null}

      {clipboardEnabled && !clipboardControlsDismissed ? (
        <div className="novnc-shell__clipboard">
          <div className="novnc-shell__clipboard-actions">
            <button
              className="button button--ghost novnc-shell__clipboard-button"
              type="button"
              onClick={() => void handlePasteFromBrowserClipboard()}
              disabled={connectionState !== "connected"}
            >
              {awaitingPasteShortcut ? `Press ${pasteShortcut}` : "Paste local"}
            </button>
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
          <textarea
            ref={hiddenPasteCaptureRef}
            aria-hidden="true"
            defaultValue=""
            onBlur={() => {
              setAwaitingPasteShortcut(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setAwaitingPasteShortcut(false);
                focusRemoteDesktop();
              }
            }}
            onPaste={(event) => {
              const clipboardText = readClipboardTransferText(event.clipboardData);

              event.preventDefault();
              event.stopPropagation();
              setAwaitingPasteShortcut(false);
              event.currentTarget.value = "";

              if (clipboardText.length === 0) {
                setTransientClipboardNotice("Local clipboard is empty.", "warning");
                focusRemoteDesktop();
                return;
              }

              if (!pasteClipboardIntoFocusedGuestTarget(clipboardText)) {
                setTransientClipboardNotice(
                  "Desktop not ready yet. Retry once the session reconnects.",
                  "warning",
                );
                return;
              }

              setTransientClipboardNotice("Sent local text to the guest.", "success");
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
      ) : null}
    </div>
  );
});

NoVncViewport.displayName = "NoVncViewport";

function connectionStateClassName(state: ConnectionState): string {
  switch (state) {
    case "connected":
      return "novnc-shell__status-pill--connected";
    case "disconnected":
      return "novnc-shell__status-pill--disconnected";
    case "error":
      return "novnc-shell__status-pill--error";
    default:
      return "novnc-shell__status-pill--connecting";
  }
}

function joinClassNames(...values: Array<string | null | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

function copyTextWithSelection(text: string): boolean {
  const documentRef = globalThis.document;

  if (!documentRef?.body || typeof documentRef.execCommand !== "function") {
    return false;
  }

  const textarea = documentRef.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  documentRef.body.append(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  try {
    return documentRef.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

async function loadRfbModule(): Promise<{
  default?: unknown;
}> {
  if (!rfbModulePromise) {
    const modulePath = "/assets/vendor/novnc/rfb.js";
    rfbModulePromise = import(modulePath) as Promise<{
      default?: unknown;
    }>;
  }

  return rfbModulePromise;
}
