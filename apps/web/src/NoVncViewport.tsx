import { useEffect, useRef, useState, type JSX } from "react";
import {
  buildRfbSocketUrls,
  resolveRfbConstructor,
  type RfbConstructor,
  type RfbLike,
} from "./novnc.js";

interface NoVncViewportProps {
  title: string;
  webSocketPath: string;
}

type ConnectionState = "connecting" | "connected" | "disconnected" | "error";
const RECONNECT_DELAY_MS = 5_000;

export function NoVncViewport({
  title,
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

    function scheduleReconnect(message: string, delayMs = RECONNECT_DELAY_MS): void {
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
        rfb.scaleViewport = true;
        rfb.resizeSession = true;
        rfb.clipViewport = false;
        rfb.viewOnly = false;
        rfb.background = "#04070b";

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
  }, [webSocketPath]);

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-900/10 bg-slate-950">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 text-xs uppercase tracking-[0.22em] text-slate-300">
        <span>{title}</span>
        <span className={connectionStateClassName(connectionState)}>{statusMessage}</span>
      </div>
      <div
        ref={containerRef}
        className="novnc-surface aspect-[16/10] min-h-[320px] w-full bg-slate-950"
      />
    </div>
  );
}

function connectionStateClassName(state: ConnectionState): string {
  switch (state) {
    case "connected":
      return "text-emerald-300";
    case "disconnected":
      return "text-amber-300";
    case "error":
      return "text-rose-300";
    default:
      return "text-sky-300";
  }
}
