import { useEffect, useRef, useState, type JSX } from "react";

import {
  buildRfbSocketUrls,
  readRfbFramebufferSize,
  resolveRfbConstructor,
  viewportSettingsForMode,
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
  onResolutionChange?: (resolution: NoVncViewportResolution) => void;
  showHeader?: boolean;
  statusMode?: "header" | "overlay" | "hidden";
  surfaceClassName?: string;
  title?: string;
  viewportMode?: RfbViewportMode;
  viewOnly?: boolean;
  webSocketPath: string;
}

type ConnectionState = "connecting" | "connected" | "disconnected" | "error";

const reconnectDelayMs = 5_000;

export function NoVncViewport({
  className,
  onResolutionChange,
  showHeader = true,
  statusMode = showHeader ? "header" : "overlay",
  surfaceClassName,
  title = "Desktop session",
  viewportMode = "remote",
  viewOnly = false,
  webSocketPath,
}: NoVncViewportProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<RfbLike | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [statusMessage, setStatusMessage] = useState("Connecting to the guest desktop...");

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
    const mountNode = containerRef.current;

    if (!mountNode) {
      return;
    }

    const container = mountNode;
    container.replaceChildren();
    let cancelled = false;
    let rfb: RfbLike | null = null;
    let handleConnect: (() => void) | null = null;
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
      if (rfb && handleConnect && handleDisconnect && handleSecurityFailure) {
        rfb.removeEventListener("connect", handleConnect);
        rfb.removeEventListener("disconnect", handleDisconnect);
        rfb.removeEventListener("securityfailure", handleSecurityFailure);
      }

      if (disconnect) {
        rfb?.disconnect();
      }

      rfb = null;
      rfbRef.current = null;
      handleConnect = null;
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
        const modulePath = "/assets/vendor/novnc/rfb.js";
        const imported = (await import(modulePath)) as {
          default?: unknown;
        };

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

        rfb.addEventListener("connect", handleConnect);
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
  }, [viewportMode, viewOnly, webSocketPath]);

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

      {!showHeader && statusMode === "overlay" ? (
        <div className="novnc-shell__overlay">
          <span className={joinClassNames("novnc-shell__status-pill", connectionStateClassName(connectionState))}>
            {connectionState === "connected" ? "Live" : statusMessage}
          </span>
        </div>
      ) : null}
    </div>
  );
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
