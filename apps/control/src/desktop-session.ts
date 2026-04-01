import {
  formatDesktopTransportLabel,
  isPageDesktopSessionKind,
  isSocketDesktopSessionKind,
  normalizeVmDesktopTransport,
} from "../../../packages/shared/src/desktopTransport.js";
import type {
  VmDesktopTransport,
  VmSession,
} from "../../../packages/shared/src/types.js";

export function buildVmBrowserPath(vmId: string): string {
  return `/?vm=${vmId}`;
}

export function buildVncSocketPath(vmId: string): string {
  return `/api/vms/${vmId}/vnc`;
}

export function buildGuacamoleSocketPath(vmId: string): string {
  return `/api/vms/${vmId}/guacamole`;
}

export function buildSelkiesBrowserPath(vmId: string): string {
  return `/selkies-${vmId}/`;
}

export function buildDesktopSession(
  host: string | null,
  port: number,
  transport: VmDesktopTransport,
  reachable = true,
): VmSession {
  const pendingLabel = formatDesktopTransportLabel(transport);

  return {
    kind: transport,
    host,
    port,
    reachable,
    webSocketPath: null,
    browserPath: null,
    display: host
      ? reachable
        ? formatNetworkEndpoint(host, port)
        : `${formatNetworkEndpoint(host, port)} pending ${pendingLabel}`
      : `guest ${pendingLabel} on port ${port} pending DHCP`,
  };
}

export function enrichVmSession(
  vmId: string,
  session: VmSession | null | undefined,
): VmSession | null {
  if (!session) {
    return null;
  }

  if (session.kind === "synthetic") {
    return {
      ...session,
      browserPath: null,
      webSocketPath: null,
    };
  }

  if (isPageDesktopSessionKind(session.kind)) {
    return {
      ...session,
      browserPath:
        session.browserPath ??
        (session.reachable !== false && session.host && session.port
          ? buildSelkiesBrowserPath(vmId)
          : null),
      webSocketPath: null,
    };
  }

  if (isSocketDesktopSessionKind(session.kind)) {
    return {
      ...session,
      webSocketPath:
        session.webSocketPath ??
        (session.reachable !== false && session.host && session.port
          ? session.kind === "guacamole"
            ? buildGuacamoleSocketPath(vmId)
            : buildVncSocketPath(vmId)
          : null),
      browserPath:
        session.browserPath ??
        (session.reachable !== false && session.host && session.port
          ? buildVmBrowserPath(vmId)
          : null),
    };
  }

  return session;
}

export function cloneVmSession(session: VmSession | null | undefined): VmSession | null {
  if (!session) {
    return null;
  }

  if (session.kind !== "synthetic") {
    return null;
  }

  return {
    ...session,
    browserPath: session.browserPath ?? null,
    webSocketPath: session.webSocketPath ?? null,
  };
}

export function copyVmSession(session: VmSession | null | undefined): VmSession | null {
  if (!session) {
    return null;
  }

  return {
    ...session,
    browserPath: session.browserPath ?? null,
    webSocketPath: session.webSocketPath ?? null,
  };
}

export function rebindVmSessionTransport(
  vmId: string,
  session: VmSession | null | undefined,
  transport: VmDesktopTransport,
): VmSession | null {
  if (!session || session.kind === "synthetic") {
    return null;
  }

  const normalizedTransport = normalizeVmDesktopTransport(transport);
  const rebound = buildDesktopSession(
    session.host ?? null,
    session.port ?? defaultDesktopTransportPort(normalizedTransport),
    normalizedTransport,
    session.reachable ?? Boolean(session.host && session.port),
  );

  return enrichVmSession(vmId, rebound);
}

function defaultDesktopTransportPort(transport: VmDesktopTransport): number {
  return transport === "selkies" ? 6080 : 5900;
}

function formatNetworkEndpoint(host: string, port: number): string {
  return host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
}
