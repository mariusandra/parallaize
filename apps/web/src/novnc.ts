export interface RfbLike extends EventTarget {
  background: string;
  clipViewport: boolean;
  clipboardPasteFrom(text: string): void;
  focus(options?: FocusOptions): void;
  resizeSession: boolean;
  sendKey(keysym: number, code: string, down?: boolean): void;
  scaleViewport: boolean;
  viewOnly: boolean;
  blur(): void;
  disconnect(): void;
}

export interface ClipboardLike {
  readText?(): Promise<string>;
  writeText?(text: string): Promise<void>;
}

interface RfbClipboardEventLike {
  detail?: {
    text?: unknown;
  };
}

export type RfbViewportMode = "fit" | "remote" | "scale";

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

const x11ControlLeftKeysym = 0xffe3;
const x11KeyVKeysym = 0x0076;

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

export function clipboardPasteShortcutLabel(
  platform: string | null | undefined,
): string {
  const normalizedPlatform = platform?.toLowerCase() ?? "";

  if (
    normalizedPlatform.includes("mac") ||
    normalizedPlatform.includes("iphone") ||
    normalizedPlatform.includes("ipad")
  ) {
    return "Cmd+V";
  }

  return "Ctrl+V";
}

export async function readBrowserClipboardText(
  clipboard: ClipboardLike | null | undefined,
): Promise<string> {
  if (!clipboard?.readText) {
    throw new Error("Browser clipboard read is unavailable.");
  }

  return clipboard.readText();
}

export async function writeBrowserClipboardText(
  clipboard: ClipboardLike | null | undefined,
  text: string,
): Promise<void> {
  if (!clipboard?.writeText) {
    throw new Error("Browser clipboard write is unavailable.");
  }

  await clipboard.writeText(text);
}

export function readClipboardEventText(event: Event): string | null {
  if (!isNestedModule(event)) {
    return null;
  }

  const clipboardEvent = event as RfbClipboardEventLike;
  return typeof clipboardEvent.detail?.text === "string"
    ? clipboardEvent.detail.text
    : null;
}

export function sendGuestPasteShortcut(rfb: RfbLike): void {
  rfb.sendKey(x11ControlLeftKeysym, "ControlLeft", true);
  rfb.sendKey(x11KeyVKeysym, "KeyV", true);
  rfb.sendKey(x11KeyVKeysym, "KeyV", false);
  rfb.sendKey(x11ControlLeftKeysym, "ControlLeft", false);
}

export function viewportSettingsForMode(mode: RfbViewportMode): RfbViewportSettings {
  switch (mode) {
    case "fit":
      return {
        clipViewport: false,
        resizeSession: false,
        scaleViewport: true,
      };
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
