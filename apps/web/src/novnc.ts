export interface RfbLike extends EventTarget {
  background: string;
  clipViewport: boolean;
  resizeSession: boolean;
  scaleViewport: boolean;
  viewOnly: boolean;
  disconnect(): void;
}

export type RfbViewportMode = "remote" | "scale";

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

interface RfbViewportSettings {
  clipViewport: boolean;
  resizeSession: boolean;
  scaleViewport: boolean;
}

interface RfbDisplayLike {
  height?: unknown;
  width?: unknown;
}

interface RfbInternalLike {
  _display?: RfbDisplayLike;
  _fbHeight?: unknown;
  _fbWidth?: unknown;
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

export function viewportSettingsForMode(mode: RfbViewportMode): RfbViewportSettings {
  switch (mode) {
    case "scale":
      return {
        clipViewport: false,
        resizeSession: false,
        scaleViewport: true,
      };
    default:
      return {
        clipViewport: false,
        resizeSession: true,
        scaleViewport: false,
      };
  }
}

export function readRfbFramebufferSize(rfb: unknown): {
  height: number | null;
  width: number | null;
} {
  if (!isNestedModule(rfb)) {
    return {
      height: null,
      width: null,
    };
  }

  const internal = rfb as RfbInternalLike;
  const display = isNestedModule(internal._display)
    ? (internal._display as RfbDisplayLike)
    : null;

  return {
    height:
      readPositiveNumber(display?.height) ??
      readPositiveNumber(internal._fbHeight) ??
      null,
    width:
      readPositiveNumber(display?.width) ??
      readPositiveNumber(internal._fbWidth) ??
      null,
  };
}

function isNestedModule(value: unknown): value is NestedNoVncModule {
  return typeof value === "object" && value !== null;
}

function readPositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
