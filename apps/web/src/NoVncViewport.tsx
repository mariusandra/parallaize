import { useEffect, useRef, useState, type JSX } from "react";

import {
  buildRfbSocketUrls,
  resolveRfbConstructor,
  viewportSettingsForMode,
  type RfbLike,
  type RfbViewportMode,
} from "./novnc.js";

interface NoVncViewportProps {
  className?: string;
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
  showHeader = true,
  statusMode = showHeader ? "header" : "overlay",
  surfaceClassName,
  title = "Desktop session",
  viewportMode = "remote",
  viewOnly = false,
  webSocketPath,
}: NoVncViewportProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [statusMessage, setStatusMessage] = useState("Connecting to the guest desktop...");

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
