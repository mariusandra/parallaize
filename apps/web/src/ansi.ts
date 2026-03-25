export interface AnsiTextSegment {
  text: string;
  style: AnsiTextStyle;
}

export interface AnsiTextStyle {
  backgroundColor: string | null;
  color: string | null;
  dim: boolean;
  fontStyle: "italic" | "normal";
  fontWeight: "bold" | "normal";
  inverse: boolean;
  textDecorationLine: "underline" | "none";
}

interface MutableAnsiTextStyle {
  backgroundColor: string | null;
  color: string | null;
  dim: boolean;
  fontStyle: "italic" | "normal";
  fontWeight: "bold" | "normal";
  inverse: boolean;
  textDecorationLine: "underline" | "none";
}

const ansiSgrPattern = /\x1b\[([0-9;]*)m/g;
const standardAnsiColors = [
  "#1f2937",
  "#ef4444",
  "#22c55e",
  "#eab308",
  "#60a5fa",
  "#d946ef",
  "#2dd4bf",
  "#e5e7eb",
];
const brightAnsiColors = [
  "#9ca3af",
  "#f87171",
  "#4ade80",
  "#facc15",
  "#93c5fd",
  "#e879f9",
  "#5eead4",
  "#ffffff",
];

export function parseAnsiText(content: string): AnsiTextSegment[] {
  const normalized = content.replace(/\r\n?/g, "\n");
  const segments: AnsiTextSegment[] = [];
  let lastIndex = 0;
  let style = defaultAnsiTextStyle();

  ansiSgrPattern.lastIndex = 0;

  for (const match of normalized.matchAll(ansiSgrPattern)) {
    const index = match.index ?? 0;

    if (index > lastIndex) {
      pushAnsiSegment(segments, normalized.slice(lastIndex, index), style);
    }

    style = applyAnsiSgrCodes(style, parseAnsiSgrCodes(match[1] ?? ""));
    lastIndex = index + match[0].length;
  }

  if (lastIndex < normalized.length) {
    pushAnsiSegment(segments, normalized.slice(lastIndex), style);
  }

  return segments;
}

export function resolveAnsiSegmentStyle(
  segment: AnsiTextSegment,
): Record<string, string | number> | undefined {
  const foreground = segment.style.inverse
    ? segment.style.backgroundColor ?? "var(--vm-log-bg)"
    : segment.style.color;
  const background = segment.style.inverse
    ? segment.style.color ?? "var(--vm-log-fg)"
    : segment.style.backgroundColor;

  if (
    foreground === null &&
    background === null &&
    segment.style.fontWeight === "normal" &&
    segment.style.fontStyle === "normal" &&
    segment.style.textDecorationLine === "none" &&
    !segment.style.dim
  ) {
    return undefined;
  }

  const style: Record<string, string | number> = {};

  if (foreground !== null) {
    style.color = foreground;
  }

  if (background !== null) {
    style.backgroundColor = background;
  }

  if (segment.style.fontWeight !== "normal") {
    style.fontWeight = segment.style.fontWeight;
  }

  if (segment.style.fontStyle !== "normal") {
    style.fontStyle = segment.style.fontStyle;
  }

  if (segment.style.textDecorationLine !== "none") {
    style.textDecorationLine = segment.style.textDecorationLine;
  }

  if (segment.style.dim) {
    style.opacity = 0.72;
  }

  return style;
}

function pushAnsiSegment(
  segments: AnsiTextSegment[],
  text: string,
  style: MutableAnsiTextStyle,
): void {
  if (!text) {
    return;
  }

  const nextSegment: AnsiTextSegment = {
    text,
    style: copyAnsiTextStyle(style),
  };
  const previous = segments.at(-1);

  if (previous && sameAnsiTextStyle(previous.style, nextSegment.style)) {
    previous.text += text;
    return;
  }

  segments.push(nextSegment);
}

function parseAnsiSgrCodes(rawCodes: string): number[] {
  if (!rawCodes) {
    return [0];
  }

  return rawCodes
    .split(";")
    .map((value) => Number.parseInt(value, 10))
    .map((value) => (Number.isFinite(value) ? value : 0));
}

function applyAnsiSgrCodes(
  current: MutableAnsiTextStyle,
  codes: number[],
): MutableAnsiTextStyle {
  const next = copyAnsiTextStyle(current);

  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index] ?? 0;

    switch (code) {
      case 0:
        resetAnsiTextStyle(next);
        break;
      case 1:
        next.fontWeight = "bold";
        break;
      case 2:
        next.dim = true;
        break;
      case 3:
        next.fontStyle = "italic";
        break;
      case 4:
        next.textDecorationLine = "underline";
        break;
      case 7:
        next.inverse = true;
        break;
      case 22:
        next.fontWeight = "normal";
        next.dim = false;
        break;
      case 23:
        next.fontStyle = "normal";
        break;
      case 24:
        next.textDecorationLine = "none";
        break;
      case 27:
        next.inverse = false;
        break;
      case 39:
        next.color = null;
        break;
      case 49:
        next.backgroundColor = null;
        break;
      default:
        if (code >= 30 && code <= 37) {
          next.color = standardAnsiColors[code - 30] ?? null;
          break;
        }

        if (code >= 40 && code <= 47) {
          next.backgroundColor = standardAnsiColors[code - 40] ?? null;
          break;
        }

        if (code >= 90 && code <= 97) {
          next.color = brightAnsiColors[code - 90] ?? null;
          break;
        }

        if (code >= 100 && code <= 107) {
          next.backgroundColor = brightAnsiColors[code - 100] ?? null;
          break;
        }

        if (code === 38 || code === 48) {
          const mode = codes[index + 1] ?? null;
          const target = code === 38 ? "color" : "backgroundColor";

          if (mode === 5) {
            const paletteIndex = codes[index + 2] ?? 0;
            next[target] = ansi256Color(paletteIndex);
            index += 2;
            break;
          }

          if (mode === 2) {
            const red = clampColorChannel(codes[index + 2] ?? 0);
            const green = clampColorChannel(codes[index + 3] ?? 0);
            const blue = clampColorChannel(codes[index + 4] ?? 0);
            next[target] = `rgb(${red} ${green} ${blue})`;
            index += 4;
          }
        }
        break;
    }
  }

  return next;
}

function ansi256Color(value: number): string {
  const index = Math.max(0, Math.min(255, Math.round(value)));

  if (index < 8) {
    return standardAnsiColors[index] ?? standardAnsiColors[0]!;
  }

  if (index < 16) {
    return brightAnsiColors[index - 8] ?? brightAnsiColors[0]!;
  }

  if (index >= 232) {
    const channel = 8 + ((index - 232) * 10);
    return `rgb(${channel} ${channel} ${channel})`;
  }

  const colorIndex = index - 16;
  const red = Math.floor(colorIndex / 36);
  const green = Math.floor((colorIndex % 36) / 6);
  const blue = colorIndex % 6;

  return `rgb(${ansiCubeChannel(red)} ${ansiCubeChannel(green)} ${ansiCubeChannel(blue)})`;
}

function ansiCubeChannel(value: number): number {
  if (value <= 0) {
    return 0;
  }

  return 55 + (value * 40);
}

function clampColorChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function defaultAnsiTextStyle(): MutableAnsiTextStyle {
  return {
    backgroundColor: null,
    color: null,
    dim: false,
    fontStyle: "normal",
    fontWeight: "normal",
    inverse: false,
    textDecorationLine: "none",
  };
}

function resetAnsiTextStyle(style: MutableAnsiTextStyle): void {
  style.backgroundColor = null;
  style.color = null;
  style.dim = false;
  style.fontStyle = "normal";
  style.fontWeight = "normal";
  style.inverse = false;
  style.textDecorationLine = "none";
}

function copyAnsiTextStyle(style: MutableAnsiTextStyle): MutableAnsiTextStyle {
  return {
    backgroundColor: style.backgroundColor,
    color: style.color,
    dim: style.dim,
    fontStyle: style.fontStyle,
    fontWeight: style.fontWeight,
    inverse: style.inverse,
    textDecorationLine: style.textDecorationLine,
  };
}

function sameAnsiTextStyle(left: AnsiTextStyle, right: AnsiTextStyle): boolean {
  return (
    left.backgroundColor === right.backgroundColor &&
    left.color === right.color &&
    left.dim === right.dim &&
    left.fontStyle === right.fontStyle &&
    left.fontWeight === right.fontWeight &&
    left.inverse === right.inverse &&
    left.textDecorationLine === right.textDecorationLine
  );
}
