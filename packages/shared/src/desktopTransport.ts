import type {
  ProviderDesktopTransport,
  VmDesktopTransport,
  VmSession,
  VmSessionKind,
} from "./types.js";

export type VmDesktopRuntime = "selkies" | "x11vnc";
export type BrowserSocketSessionKind = "vnc" | "guacamole";
export type BrowserPageSessionKind = "selkies";

export const vmDesktopTransports = [
  "selkies",
  "vnc",
  "guacamole",
] as const satisfies readonly VmDesktopTransport[];

export function normalizeTemplateDesktopTransport(
  transport: VmDesktopTransport | null | undefined,
): VmDesktopTransport {
  return transport === "vnc" || transport === "guacamole"
    ? transport
    : "selkies";
}

export function normalizeVmDesktopTransport(
  transport: VmDesktopTransport | null | undefined,
): VmDesktopTransport {
  return transport === "selkies" || transport === "guacamole"
    ? transport
    : "vnc";
}

export function formatDesktopTransportLabel(
  transport: VmDesktopTransport | VmSessionKind | null | undefined,
): string {
  switch (transport) {
    case "selkies":
      return "Selkies";
    case "guacamole":
      return "Guacamole";
    case "synthetic":
      return "Synthetic";
    default:
      return "VNC";
  }
}

export function resolveDesktopTransportRuntime(
  transport: VmDesktopTransport,
): VmDesktopRuntime {
  return transport === "selkies" ? "selkies" : "x11vnc";
}

export function providerSupportsBrowserDesktopSessions(
  transport: ProviderDesktopTransport | null | undefined,
): boolean {
  return transport === "novnc";
}

export function isSocketDesktopTransport(
  transport: VmDesktopTransport,
): transport is BrowserSocketSessionKind {
  return transport === "vnc" || transport === "guacamole";
}

export function isSocketDesktopSessionKind(
  kind: VmSessionKind | null | undefined,
): kind is BrowserSocketSessionKind {
  return kind === "vnc" || kind === "guacamole";
}

export function isPageDesktopTransport(
  transport: VmDesktopTransport,
): transport is BrowserPageSessionKind {
  return transport === "selkies";
}

export function isPageDesktopSessionKind(
  kind: VmSessionKind | null | undefined,
): kind is BrowserPageSessionKind {
  return kind === "selkies";
}

export function resolveSessionDesktopTransport(
  session: Pick<VmSession, "kind"> | null | undefined,
): VmDesktopTransport | null {
  switch (session?.kind) {
    case "selkies":
    case "vnc":
    case "guacamole":
      return session.kind;
    default:
      return null;
  }
}
