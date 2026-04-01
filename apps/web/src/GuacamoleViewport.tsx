import { memo, useEffect, useRef, useState, type JSX } from "react";

import {
  clipboardPasteShortcutLabel,
  copyTextWithSelection,
  primeClipboardPasteCaptureTarget,
  readBrowserClipboardText,
  readClipboardTransferText,
  resolveClipboardShortcutAction,
  writeBrowserClipboardText,
  type ClipboardLike,
  type ClipboardPasteCaptureTargetLike,
  type RfbViewportMode,
} from "./novnc.js";

export interface GuacamoleViewportResolution {
  clientHeight: number | null;
  clientWidth: number | null;
  remoteHeight: number | null;
  remoteWidth: number | null;
}

interface GuacamoleViewportProps {
  className?: string;
  hideConnectedOverlayStatus?: boolean;
  onPasteRequestHandled?: (token: number) => void;
  onResolutionChange?: (resolution: GuacamoleViewportResolution) => void;
  pasteRequestToken?: number | null;
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

interface GuacamoleStatusLike {
  code?: number;
  message?: string;
}

interface GuacamoleDisplayLike {
  getElement(): Element;
  getHeight(): number;
  getWidth(): number;
  oncursor:
    | ((canvas: HTMLCanvasElement, hotspotX: number, hotspotY: number) => void)
    | null;
  scale(scale: number): void;
  showCursor(shown?: boolean): void;
}

interface GuacamoleClientLike {
  createClipboardStream(mimetype: string): GuacamoleOutputStreamLike;
  connect(data?: string): void;
  disconnect(): void;
  getDisplay(): GuacamoleDisplayLike;
  onclipboard:
    | ((stream: GuacamoleInputStreamLike, mimetype: string) => void)
    | null;
  onerror: ((status: GuacamoleStatusLike) => void) | null;
  onname: ((name: string) => void) | null;
  onstatechange: ((state: number) => void) | null;
  sendKeyEvent(pressed: boolean, keysym: number): void;
  sendMouseState(state: GuacamoleMouseStateLike, applyDisplayScale?: boolean): void;
  sendSize(width: number, height: number): void;
}

interface GuacamoleInputStreamLike {}

interface GuacamoleOutputStreamLike {}

interface GuacamoleKeyboardLike {
  onkeydown: ((keysym: number) => boolean | void) | null;
  onkeyup: ((keysym: number) => boolean | void) | null;
}

interface GuacamoleModuleLike {
  Client: new (tunnel: GuacamoleTunnelLike) => GuacamoleClientLike;
  Keyboard: new (element: Element) => GuacamoleKeyboardLike;
  Mouse: new (element: Element) => GuacamoleMouseLike;
  StringReader: new (stream: GuacamoleInputStreamLike) => GuacamoleStringReaderLike;
  StringWriter: new (stream: GuacamoleOutputStreamLike) => GuacamoleStringWriterLike;
  WebSocketTunnel: new (url: string) => GuacamoleTunnelLike;
  default?: unknown;
}

interface GuacamoleMouseEventLike {
  state: GuacamoleMouseStateLike;
}

interface GuacamoleMouseLike {
  offEach?(types: string[], listener: (event: GuacamoleMouseEventLike) => void): void;
  onEach(types: string[], listener: (event: GuacamoleMouseEventLike) => void): void;
  setCursor?(canvas: HTMLCanvasElement, x: number, y: number): boolean;
}

interface GuacamoleMouseStateLike {
  x?: number;
  y?: number;
}

interface GuacamoleStringReaderLike {
  onend: (() => void) | null;
  ontext: ((text: string) => void) | null;
}

interface GuacamoleStringWriterLike {
  sendEnd(): void;
  sendText(text: string): void;
}

interface GuacamoleTunnelLike {
  onerror: ((status: GuacamoleStatusLike) => void) | null;
}

const defaultReconnectDelayMs = 1_000;
const clipboardNoticeTimeoutMs = 4_500;
const guacamoleCtrlKeysym = 0xffe3;
const guacamoleKeyVKeysym = 0x0076;
let guacamoleModulePromise: Promise<GuacamoleModuleLike> | null = null;

export const GuacamoleViewport = memo(function GuacamoleViewport({
  className,
  hideConnectedOverlayStatus = false,
  onPasteRequestHandled,
  onResolutionChange,
  pasteRequestToken = null,
  reconnectDelayMs = defaultReconnectDelayMs,
  showHeader = true,
  statusMode = showHeader ? "header" : "overlay",
  surfaceClassName,
  title = "Desktop session",
  viewportMode = "remote",
  viewOnly = false,
  webSocketPath,
}: GuacamoleViewportProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handledPasteRequestTokenRef = useRef<number | null>(null);
  const hiddenPasteCaptureRef = useRef<HTMLTextAreaElement | null>(null);
  const clientRef = useRef<GuacamoleClientLike | null>(null);
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

  function focusRemoteDesktop(): void {
    containerRef.current?.focus({
      preventScroll: true,
    });
  }

  function dismissClipboardControls(): void {
    setClipboardControlsDismissed(true);
    setClipboardNotice(null);
    setClipboardNoticeTone("muted");
    setAwaitingPasteShortcut(false);
    focusRemoteDesktop();
  }

  function sendPasteShortcut(): void {
    const client = clientRef.current;

    if (!client) {
      return;
    }

    client.sendKeyEvent(true, guacamoleCtrlKeysym);
    client.sendKeyEvent(true, guacamoleKeyVKeysym);
    client.sendKeyEvent(false, guacamoleKeyVKeysym);
    client.sendKeyEvent(false, guacamoleCtrlKeysym);
  }

  function sendClipboardToGuest(text: string): boolean {
    const client = clientRef.current;

    if (!clipboardEnabled || !client || connectionState !== "connected") {
      return false;
    }

    const stream = client.createClipboardStream("text/plain");
    const Guacamole = resolvedGuacamoleModule;

    if (!Guacamole) {
      return false;
    }

    const writer = new Guacamole.StringWriter(stream);
    writer.sendText(text);
    writer.sendEnd();
    sendPasteShortcut();
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

      if (!sendClipboardToGuest(clipboardText)) {
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
  }, [viewOnly, webSocketPath]);

  useEffect(() => {
    if (!clipboardEnabled || pasteRequestToken === null) {
      return;
    }

    if (handledPasteRequestTokenRef.current === pasteRequestToken) {
      return;
    }

    if (connectionState !== "connected") {
      return;
    }

    handledPasteRequestTokenRef.current = pasteRequestToken;
    onPasteRequestHandled?.(pasteRequestToken);
    void beginPasteFromBrowserClipboard();
  }, [clipboardEnabled, connectionState, onPasteRequestHandled, pasteRequestToken]);

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

      if (!sendClipboardToGuest(clipboardText)) {
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

      if (action !== "paste") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void handlePasteFromBrowserClipboard();
    }

    mountNode.addEventListener("paste", handlePaste);
    mountNode.addEventListener("keydown", handleKeyDown);

    return () => {
      mountNode.removeEventListener("paste", handlePaste);
      mountNode.removeEventListener("keydown", handleKeyDown);
    };
  }, [clipboardEnabled, connectionState]);

  useEffect(() => {
    if (!onResolutionChange) {
      return;
    }

    const mountNode = containerRef.current;

    if (!mountNode) {
      return;
    }

    let resizeObserver: ResizeObserver | null = null;
    let pollId: number | null = null;
    let lastSerialized = "";

    const reportResolution = (): void => {
      const bounds = mountNode.getBoundingClientRect();
      const display = clientRef.current?.getDisplay() ?? null;
      const nextResolution: GuacamoleViewportResolution = {
        clientHeight: bounds.height > 0 ? Math.round(bounds.height) : null,
        clientWidth: bounds.width > 0 ? Math.round(bounds.width) : null,
        remoteHeight: display ? display.getHeight() || null : null,
        remoteWidth: display ? display.getWidth() || null : null,
      };
      const serialized = JSON.stringify(nextResolution);

      if (serialized === lastSerialized) {
        return;
      }

      lastSerialized = serialized;
      onResolutionChange(nextResolution);
    };

    resizeObserver = new ResizeObserver(reportResolution);
    resizeObserver.observe(mountNode);
    pollId = window.setInterval(reportResolution, 250);
    reportResolution();

    return () => {
      resizeObserver?.disconnect();
      if (pollId !== null) {
        window.clearInterval(pollId);
      }
      onResolutionChange({
        clientHeight: null,
        clientWidth: null,
        remoteHeight: null,
        remoteWidth: null,
      });
    };
  }, [onResolutionChange]);

  useEffect(() => {
    const mountNode = containerRef.current;

    if (!mountNode) {
      return;
    }

    let cancelled = false;
    let client: GuacamoleClientLike | null = null;
    let keyboard: GuacamoleKeyboardLike | null = null;
    let mouse: GuacamoleMouseLike | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let reconnectTimer: number | null = null;
    let currentViewportScale = 1;
    let mouseListener: ((event: GuacamoleMouseEventLike) => void) | null = null;

    const surfaceNode = mountNode;

    function clearReconnectTimer(): void {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function syncDisplayScale(): void {
      const display = client?.getDisplay();

      if (!display) {
        return;
      }

      const remoteWidth = display.getWidth();
      const remoteHeight = display.getHeight();

      if (!remoteWidth || !remoteHeight) {
        return;
      }

      const bounds = surfaceNode.getBoundingClientRect();

      if (!bounds.width || !bounds.height) {
        return;
      }

      const scale =
        viewportMode === "remote"
          ? 1
          : Math.min(bounds.width / remoteWidth, bounds.height / remoteHeight);
      const nextScale = Number.isFinite(scale) && scale > 0 ? scale : 1;

      if (Math.abs(nextScale - currentViewportScale) < 0.001) {
        return;
      }

      currentViewportScale = nextScale;
      display.scale(nextScale);
    }

    function syncDisplaySize(): void {
      if (!client) {
        return;
      }

      const bounds = surfaceNode.getBoundingClientRect();
      const width = Math.max(1, Math.round(bounds.width));
      const height = Math.max(1, Math.round(bounds.height));
      client.sendSize(width, height);
      syncDisplayScale();
    }

    function disposeClient(): void {
      clearReconnectTimer();
      resizeObserver?.disconnect();
      resizeObserver = null;

      if (mouse && mouseListener && mouse.offEach) {
        mouse.offEach(["mousedown", "mousemove", "mouseup"], mouseListener);
      }

      if (keyboard) {
        keyboard.onkeydown = null;
        keyboard.onkeyup = null;
      }

      client?.disconnect();
      client = null;
      clientRef.current = null;
      keyboard = null;
      mouse = null;
      mouseListener = null;
      surfaceNode.style.cursor = "";
      surfaceNode.replaceChildren();
    }

    function scheduleReconnect(message: string): void {
      if (cancelled || reconnectTimer !== null) {
        return;
      }

      setConnectionState("connecting");
      setStatusMessage(message);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, reconnectDelayMs);
    }

    async function connect(): Promise<void> {
      try {
        clearReconnectTimer();
        disposeClient();
        setConnectionState("connecting");
        setStatusMessage("Connecting to the guest desktop...");
        const Guacamole = await loadGuacamoleModule();

        if (cancelled) {
          return;
        }

        const tunnel = new Guacamole.WebSocketTunnel(webSocketPath);
        client = new Guacamole.Client(tunnel);
        clientRef.current = client;
        const display = client.getDisplay();
        const displayElement = display.getElement() as HTMLDivElement;
        const originalShowCursor = display.showCursor.bind(display);
        surfaceNode.replaceChildren(displayElement);
        displayElement.classList.add("guacamole-display");
        surfaceNode.style.cursor = "none";
        display.scale(1);
        currentViewportScale = 1;
        display.showCursor = (shown = true) => {
          originalShowCursor(shown);
        };

        tunnel.onerror = (status) => {
          if (cancelled) {
            return;
          }

          setConnectionState("error");
          setStatusMessage(status.message || "The Guacamole bridge failed.");
        };

        client.onerror = (status) => {
          if (cancelled) {
            return;
          }

          setConnectionState("error");
          setStatusMessage(status.message || "The Guacamole session failed.");
        };

        client.onstatechange = (state) => {
          if (cancelled) {
            return;
          }

          switch (state) {
            case 3:
              setConnectionState("connected");
              setStatusMessage("Desktop connected.");
              syncDisplaySize();
              break;
            case 5:
              scheduleReconnect("Desktop disconnected. Reconnecting...");
              break;
            case 4:
            case 2:
            case 1:
              setConnectionState("connecting");
              setStatusMessage("Connecting to the guest desktop...");
              break;
            default:
              setConnectionState("disconnected");
              setStatusMessage("Desktop disconnected.");
          }
        };

        client.onclipboard = clipboardEnabled
          ? (stream, mimetype) => {
              if (mimetype !== "text/plain") {
                return;
              }

              const reader = new Guacamole.StringReader(stream);
              let receivedText = "";
              reader.ontext = (chunk) => {
                receivedText += chunk;
              };
              reader.onend = () => {
                if (cancelled) {
                  return;
                }

                if (receivedText.length === 0) {
                  setPendingGuestClipboardText(null);
                  setTransientClipboardNotice("Guest clipboard cleared.", "success");
                  return;
                }

                setClipboardControlsDismissed(false);
                void writeBrowserClipboardText(
                  globalThis.navigator?.clipboard,
                  receivedText,
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

                    setPendingGuestClipboardText(receivedText);
                    setTransientClipboardNotice(
                      "Guest clipboard is ready. Automatic browser copy was blocked.",
                      "warning",
                    );
                  });
              };
            }
          : null;

        if (!viewOnly) {
          keyboard = new Guacamole.Keyboard(surfaceNode);
          keyboard.onkeydown = (keysym) => {
            client?.sendKeyEvent(true, keysym);
            return false;
          };
          keyboard.onkeyup = (keysym) => {
            client?.sendKeyEvent(false, keysym);
            return false;
          };

          mouse = new Guacamole.Mouse(displayElement);
          display.oncursor = (canvas, hotspotX, hotspotY) => {
            const hardwareCursorApplied =
              mouse?.setCursor?.(canvas, hotspotX, hotspotY) === true;

            if (hardwareCursorApplied) {
              display.showCursor = () => {
                originalShowCursor(false);
              };
              display.showCursor(false);
              return;
            }

            display.showCursor = (shown = true) => {
              originalShowCursor(shown);
            };
            display.showCursor(true);
          };
          mouseListener = (event) => {
            client?.sendMouseState(event.state, true);
          };
          mouse.onEach(["mousedown", "mousemove", "mouseup"], mouseListener);
        }

        resizeObserver = new ResizeObserver(syncDisplaySize);
        resizeObserver.observe(surfaceNode);

        const bounds = surfaceNode.getBoundingClientRect();
        client.connect(
          buildConnectData({
            dpi: Math.max(96, Math.round((globalThis.devicePixelRatio || 1) * 96)),
            height: Math.max(1, Math.round(bounds.height || 1)),
            width: Math.max(1, Math.round(bounds.width || 1)),
          }),
        );
      } catch (error) {
        if (cancelled) {
          return;
        }

        setConnectionState("error");
        setStatusMessage(
          error instanceof Error
            ? error.message
            : "Failed to load the Guacamole client.",
        );
      }
    }

    void connect();

    return () => {
      cancelled = true;
      disposeClient();
    };
  }, [clipboardEnabled, reconnectDelayMs, viewOnly, viewportMode, webSocketPath]);

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
          "guacamole-surface",
          `novnc-surface--${viewportMode}`,
          surfaceClassName,
        )}
        tabIndex={0}
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
              onClick={() => void beginPasteFromBrowserClipboard()}
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

              if (!sendClipboardToGuest(clipboardText)) {
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

GuacamoleViewport.displayName = "GuacamoleViewport";

let resolvedGuacamoleModule: GuacamoleModuleLike | null = null;

async function loadGuacamoleModule(): Promise<GuacamoleModuleLike> {
  if (!guacamoleModulePromise) {
    guacamoleModulePromise = import("guacamole-common-js").then((module) => {
      const resolved =
        module && typeof module === "object" && "default" in module
          ? (module.default as GuacamoleModuleLike)
          : (module as unknown as GuacamoleModuleLike);
      resolvedGuacamoleModule = resolved;
      return resolved;
    });
  }

  return await guacamoleModulePromise;
}

function buildConnectData(input: {
  dpi: number;
  height: number;
  width: number;
}): string {
  const params = new URLSearchParams();
  params.set("dpi", String(input.dpi));
  params.set("height", String(input.height));
  params.set("width", String(input.width));
  return params.toString();
}

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
