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

interface InternalRfbSocketLike {
  flush(): void;
  sQpush8(value: number): void;
  sQpush16(value: number): void;
  sQpush32(value: number): void;
}

interface InternalRfbLike extends RfbLike {
  __parallaizeSafeEncodingsPatched?: boolean;
  _fbDepth?: number;
  _sendEncodings?: () => void;
  _sock?: InternalRfbSocketLike;
}

export interface ClipboardLike {
  readText?(): Promise<string>;
  writeText?(text: string): Promise<void>;
}

export interface ClipboardTransferLike {
  getData?(format: string): string;
}

export interface ClipboardPasteCaptureTargetLike {
  focus(options?: FocusOptions): void;
  select(): void;
  setSelectionRange?(start: number, end: number): void;
  value?: string;
}

interface RfbClipboardEventLike {
  detail?: {
    text?: unknown;
  };
}

interface ClipboardShortcutKeyboardEventLike {
  altKey?: boolean;
  ctrlKey?: boolean;
  key?: string;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export type RfbViewportMode = "fit" | "remote" | "scale";
export type ClipboardShortcutAction = "copy" | "paste";

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

const x11BackspaceKeysym = 0xff08;
const x11KeyCKeysym = 0x0063;
const x11TabKeysym = 0xff09;
const x11ControlLeftKeysym = 0xffe3;
const x11ReturnKeysym = 0xff0d;
const x11KeyVKeysym = 0x0076;
const encodingRaw = 0;
const encodingCopyRect = 1;
const encodingRre = 2;
const encodingHextile = 5;
const encodingZlib = 6;
const encodingZrle = 16;
const pseudoEncodingDesktopSize = -223;
const pseudoEncodingLastRect = -224;
const pseudoEncodingCursor = -239;
const pseudoEncodingQemulExtendedKeyEvent = -258;
const pseudoEncodingQemuLedEvent = -261;
const pseudoEncodingDesktopName = -307;
const pseudoEncodingExtendedDesktopSize = -308;
const pseudoEncodingXvp = -309;
const pseudoEncodingFence = -312;
const pseudoEncodingContinuousUpdates = -313;
const pseudoEncodingExtendedMouseButtons = -316;
const pseudoEncodingVmwareCursor = 0x574d5664;
const pseudoEncodingExtendedClipboard = 0xc0a1e5ce;

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

export function applySafeRfbEncodingPatch(rfb: unknown): boolean {
  if (!isInternalRfbLike(rfb) || typeof rfb._sendEncodings !== "function") {
    return false;
  }

  if (rfb.__parallaizeSafeEncodingsPatched) {
    return true;
  }

  rfb._sendEncodings = function sendSafeEncodings(this: InternalRfbLike): void {
    const socket = this._sock;

    if (!socket) {
      return;
    }

    const encodings = buildSafeRfbEncodings(this._fbDepth);
    socket.sQpush8(2);
    socket.sQpush8(0);
    socket.sQpush16(encodings.length);

    for (const encoding of encodings) {
      socket.sQpush32(encoding);
    }

    socket.flush();
  };
  rfb.__parallaizeSafeEncodingsPatched = true;
  return true;
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
  if (isApplePlatform(platform)) {
    return "Cmd+V";
  }

  return "Ctrl+V";
}

export function resolveClipboardShortcutAction(
  event: ClipboardShortcutKeyboardEventLike,
  platform: string | null | undefined,
): ClipboardShortcutAction | null {
  const key = event.key?.toLowerCase();

  if (!key || event.altKey || event.shiftKey) {
    return null;
  }

  const expectsMeta = isApplePlatform(platform);
  const hasPrimaryModifier =
    expectsMeta
      ? Boolean(event.metaKey) && !event.ctrlKey
      : Boolean(event.ctrlKey) && !event.metaKey;

  if (!hasPrimaryModifier) {
    return null;
  }

  if (key === "c") {
    return "copy";
  }

  if (key === "v") {
    return "paste";
  }

  return null;
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

export function copyTextWithSelection(text: string): boolean {
  const documentRef = globalThis.document;

  if (!documentRef?.body || typeof documentRef.execCommand !== "function") {
    return false;
  }

  const textarea = documentRef.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  documentRef.body.append(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  try {
    return documentRef.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

export function readClipboardTransferText(
  clipboardData: ClipboardTransferLike | null | undefined,
): string {
  const plainText = clipboardData?.getData?.("text/plain") ?? "";

  if (plainText.length > 0) {
    return plainText;
  }

  return clipboardData?.getData?.("text") ?? "";
}

export function primeClipboardPasteCaptureTarget(
  target: ClipboardPasteCaptureTargetLike | null | undefined,
): boolean {
  if (!target) {
    return false;
  }

  if (typeof target.value === "string") {
    target.value = "";
  }

  target.focus({
    preventScroll: true,
  });
  target.select();
  target.setSelectionRange?.(0, 0);
  return true;
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

export function sendGuestText(rfb: RfbLike, text: string): void {
  for (const character of text) {
    switch (character) {
      case "\r":
        continue;
      case "\n":
        rfb.sendKey(x11ReturnKeysym, "Enter");
        continue;
      case "\t":
        rfb.sendKey(x11TabKeysym, "Tab");
        continue;
      case "\b":
        rfb.sendKey(x11BackspaceKeysym, "Backspace");
        continue;
      default: {
        const keysym = keysymForCharacter(character);

        if (keysym !== null) {
          rfb.sendKey(keysym, "");
        }
      }
    }
  }
}

export function sendGuestPasteShortcut(rfb: RfbLike): void {
  rfb.sendKey(x11ControlLeftKeysym, "ControlLeft", true);
  rfb.sendKey(x11KeyVKeysym, "KeyV", true);
  rfb.sendKey(x11KeyVKeysym, "KeyV", false);
  rfb.sendKey(x11ControlLeftKeysym, "ControlLeft", false);
}

export function sendGuestCopyShortcut(rfb: RfbLike): void {
  rfb.sendKey(x11ControlLeftKeysym, "ControlLeft", true);
  rfb.sendKey(x11KeyCKeysym, "KeyC", true);
  rfb.sendKey(x11KeyCKeysym, "KeyC", false);
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

function isInternalRfbLike(value: unknown): value is InternalRfbLike {
  return isNestedModule(value);
}

function buildSafeRfbEncodings(framebufferDepth: number | undefined): number[] {
  const encodings = [
    encodingCopyRect,
    encodingZrle,
    encodingHextile,
    encodingRre,
    encodingZlib,
    encodingRaw,
    pseudoEncodingDesktopSize,
    pseudoEncodingLastRect,
    pseudoEncodingQemulExtendedKeyEvent,
    pseudoEncodingQemuLedEvent,
    pseudoEncodingExtendedDesktopSize,
    pseudoEncodingXvp,
    pseudoEncodingFence,
    pseudoEncodingContinuousUpdates,
    pseudoEncodingDesktopName,
    pseudoEncodingExtendedClipboard,
    pseudoEncodingExtendedMouseButtons,
  ];

  if (framebufferDepth === 24) {
    encodings.push(pseudoEncodingVmwareCursor, pseudoEncodingCursor);
  }

  return encodings;
}

function isApplePlatform(platform: string | null | undefined): boolean {
  const normalizedPlatform = platform?.toLowerCase() ?? "";
  return (
    normalizedPlatform.includes("mac") ||
    normalizedPlatform.includes("iphone") ||
    normalizedPlatform.includes("ipad")
  );
}

function readPositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function keysymForCharacter(character: string): number | null {
  const codePoint = character.codePointAt(0);

  if (!codePoint) {
    return null;
  }

  if (codePoint >= 0x20 && codePoint <= 0xff) {
    return codePoint;
  }

  return 0x01000000 | codePoint;
}
