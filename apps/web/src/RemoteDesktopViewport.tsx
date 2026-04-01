import { memo, type JSX } from "react";

import type { VmInstance } from "../../../packages/shared/src/types.js";

import { GuacamoleViewport, type GuacamoleViewportResolution } from "./GuacamoleViewport.js";
import { NoVncViewport, type NoVncViewportResolution } from "./NoVncViewport.js";

interface RemoteDesktopViewportProps {
  className?: string;
  hideConnectedOverlayStatus?: boolean;
  onPasteRequestHandled?: (token: number) => void;
  onResolutionChange?: (
    resolution: NoVncViewportResolution | GuacamoleViewportResolution,
  ) => void;
  pasteRequestToken?: number | null;
  reconnectDelayMs?: number;
  showHeader?: boolean;
  statusMode?: "header" | "overlay" | "hidden";
  surfaceClassName?: string;
  title?: string;
  viewportMode?: "fit" | "remote" | "scale";
  viewOnly?: boolean;
  session: VmInstance["session"];
}

export const RemoteDesktopViewport = memo(function RemoteDesktopViewport({
  session,
  ...props
}: RemoteDesktopViewportProps): JSX.Element | null {
  if (!session) {
    return null;
  }

  if (session.kind === "vnc" && session.webSocketPath) {
    return <NoVncViewport {...props} webSocketPath={session.webSocketPath} />;
  }

  if (session.kind === "guacamole" && session.webSocketPath) {
    return <GuacamoleViewport {...props} webSocketPath={session.webSocketPath} />;
  }

  return null;
});

RemoteDesktopViewport.displayName = "RemoteDesktopViewport";
