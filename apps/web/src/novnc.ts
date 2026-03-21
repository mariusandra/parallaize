export interface RfbLike extends EventTarget {
  background: string;
  clipViewport: boolean;
  resizeSession: boolean;
  scaleViewport: boolean;
  viewOnly: boolean;
  disconnect(): void;
}

export type RfbConstructor = new (
  target: Element,
  url: string,
  options?: {
    shared?: boolean;
  },
) => RfbLike;

interface NestedNoVncModule {
  default?: unknown;
}

interface LocationLike {
  host: string;
  hostname: string;
  port: string;
  protocol: string;
}

export function resolveRfbConstructor(module: {
  default?: unknown;
}): RfbConstructor | null {
  if (typeof module.default === "function") {
    return module.default as RfbConstructor;
  }

  if (isNestedModule(module.default) && typeof module.default.default === "function") {
    return module.default.default as RfbConstructor;
  }

  return null;
}

export function buildRfbSocketUrls(
  webSocketPath: string,
  location: LocationLike,
): string[] {
  if (/^wss?:\/\//.test(webSocketPath)) {
    return [webSocketPath];
  }

  const socketProtocol = location.protocol === "https:" ? "wss" : "ws";
  return [`${socketProtocol}://${location.host}${webSocketPath}`];
}

function isNestedModule(value: unknown): value is NestedNoVncModule {
  return typeof value === "object" && value !== null;
}
