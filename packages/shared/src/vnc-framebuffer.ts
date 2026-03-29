export interface VncPixelFormat {
  bitsPerPixel: number;
  blueMax: number;
  blueShift: number;
  depth: number;
  greenMax: number;
  greenShift: number;
  bigEndian: boolean;
  redMax: number;
  redShift: number;
  trueColor: boolean;
}

export interface FramebufferVisibilityStats {
  averageLuma: number;
  frameHeight: number;
  frameWidth: number;
  hasVisibleContent: boolean;
  litTileCount: number;
  litTileRatio: number;
  maxLuma: number;
  nonBlackPixelCount: number;
  nonBlackPixelRatio: number;
  pixelCount: number;
  recordedPixelCount: number;
  uniqueColorBucketCount: number;
}

const NON_BLACK_CHANNEL_THRESHOLD = 8;
const DEFAULT_TILE_COLUMNS = 16;
const DEFAULT_TILE_ROWS = 16;
const MIN_LIT_TILE_COUNT = 4;
const MIN_LIT_TILE_RATIO = 0.04;
const MIN_NON_BLACK_PIXEL_RATIO = 0.02;
const MIN_UNIQUE_COLOR_BUCKETS = 8;
const MIN_AVERAGE_LUMA = 8;
const MIN_NON_BLACK_PIXELS_FOR_COMPLEX_FRAME = 1_024;

export class FramebufferVisibilityTracker {
  private readonly litTiles: Uint8Array;
  private readonly uniqueColorBuckets = new Set<number>();
  private maxLuma = 0;
  private nonBlackPixelCount = 0;
  private recordedPixelCount = 0;
  private totalLuma = 0;

  constructor(
    private readonly frameWidth: number,
    private readonly frameHeight: number,
    private readonly tileColumns = DEFAULT_TILE_COLUMNS,
    private readonly tileRows = DEFAULT_TILE_ROWS,
  ) {
    if (!Number.isInteger(frameWidth) || frameWidth <= 0) {
      throw new Error(`Invalid framebuffer width: ${frameWidth}.`);
    }

    if (!Number.isInteger(frameHeight) || frameHeight <= 0) {
      throw new Error(`Invalid framebuffer height: ${frameHeight}.`);
    }

    if (!Number.isInteger(tileColumns) || tileColumns <= 0) {
      throw new Error(`Invalid tile column count: ${tileColumns}.`);
    }

    if (!Number.isInteger(tileRows) || tileRows <= 0) {
      throw new Error(`Invalid tile row count: ${tileRows}.`);
    }

    this.litTiles = new Uint8Array(tileColumns * tileRows);
  }

  recordRawRectangle(
    x: number,
    y: number,
    width: number,
    height: number,
    pixelBytes: Uint8Array,
    pixelFormat: VncPixelFormat,
  ): void {
    if (!Number.isInteger(width) || width <= 0) {
      throw new Error(`Invalid rectangle width: ${width}.`);
    }

    if (!Number.isInteger(height) || height <= 0) {
      throw new Error(`Invalid rectangle height: ${height}.`);
    }

    if (x < 0 || y < 0 || x + width > this.frameWidth || y + height > this.frameHeight) {
      throw new Error(
        `Rectangle ${x},${y} ${width}x${height} falls outside framebuffer ${this.frameWidth}x${this.frameHeight}.`,
      );
    }

    const bytesPerPixel = bytesPerPixelForFormat(pixelFormat);
    const expectedLength = width * height * bytesPerPixel;

    if (pixelBytes.length !== expectedLength) {
      throw new Error(
        `Raw rectangle payload length mismatch. Expected ${expectedLength} bytes, received ${pixelBytes.length}.`,
      );
    }

    this.recordedPixelCount += width * height;

    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const offset = (row * width + column) * bytesPerPixel;
        const { blue, green, red } = decodePixel(pixelBytes, offset, bytesPerPixel, pixelFormat);
        const luma = computeLuma(red, green, blue);

        this.totalLuma += luma;
        this.maxLuma = Math.max(this.maxLuma, luma);

        if (Math.max(red, green, blue) <= NON_BLACK_CHANNEL_THRESHOLD) {
          continue;
        }

        this.nonBlackPixelCount += 1;
        this.uniqueColorBuckets.add(quantizeColor(red, green, blue));

        const absoluteX = x + column;
        const absoluteY = y + row;
        const tileColumn = Math.min(
          this.tileColumns - 1,
          Math.floor((absoluteX * this.tileColumns) / this.frameWidth),
        );
        const tileRow = Math.min(
          this.tileRows - 1,
          Math.floor((absoluteY * this.tileRows) / this.frameHeight),
        );

        this.litTiles[tileRow * this.tileColumns + tileColumn] = 1;
      }
    }
  }

  snapshot(): FramebufferVisibilityStats {
    const pixelCount = this.frameWidth * this.frameHeight;
    const litTileCount = this.litTiles.reduce((count, value) => count + value, 0);
    const stats: FramebufferVisibilityStats = {
      averageLuma: this.totalLuma / pixelCount,
      frameHeight: this.frameHeight,
      frameWidth: this.frameWidth,
      hasVisibleContent: false,
      litTileCount,
      litTileRatio: litTileCount / this.litTiles.length,
      maxLuma: this.maxLuma,
      nonBlackPixelCount: this.nonBlackPixelCount,
      nonBlackPixelRatio: this.nonBlackPixelCount / pixelCount,
      pixelCount,
      recordedPixelCount: this.recordedPixelCount,
      uniqueColorBucketCount: this.uniqueColorBuckets.size,
    };

    return {
      ...stats,
      hasVisibleContent: framebufferHasVisibleContent(stats),
    };
  }
}

export function framebufferHasVisibleContent(stats: FramebufferVisibilityStats): boolean {
  return (
    stats.litTileCount >= MIN_LIT_TILE_COUNT ||
    stats.litTileRatio >= MIN_LIT_TILE_RATIO ||
    stats.nonBlackPixelRatio >= MIN_NON_BLACK_PIXEL_RATIO ||
    (
      stats.uniqueColorBucketCount >= MIN_UNIQUE_COLOR_BUCKETS &&
      stats.nonBlackPixelCount >= MIN_NON_BLACK_PIXELS_FOR_COMPLEX_FRAME &&
      stats.averageLuma >= MIN_AVERAGE_LUMA
    )
  );
}

function bytesPerPixelForFormat(pixelFormat: VncPixelFormat): number {
  if (pixelFormat.bitsPerPixel % 8 !== 0 || pixelFormat.bitsPerPixel <= 0) {
    throw new Error(`Unsupported VNC bits-per-pixel value: ${pixelFormat.bitsPerPixel}.`);
  }

  return pixelFormat.bitsPerPixel / 8;
}

function decodePixel(
  pixelBytes: Uint8Array,
  offset: number,
  bytesPerPixel: number,
  pixelFormat: VncPixelFormat,
): { blue: number; green: number; red: number } {
  if (!pixelFormat.trueColor) {
    const value = pixelBytes[offset] ?? 0;
    return {
      blue: value,
      green: value,
      red: value,
    };
  }

  const rawValue = readPixelValue(pixelBytes, offset, bytesPerPixel, pixelFormat.bigEndian);

  return {
    blue: scaleColorChannel((rawValue >>> pixelFormat.blueShift) & pixelFormat.blueMax, pixelFormat.blueMax),
    green: scaleColorChannel(
      (rawValue >>> pixelFormat.greenShift) & pixelFormat.greenMax,
      pixelFormat.greenMax,
    ),
    red: scaleColorChannel((rawValue >>> pixelFormat.redShift) & pixelFormat.redMax, pixelFormat.redMax),
  };
}

function readPixelValue(
  pixelBytes: Uint8Array,
  offset: number,
  bytesPerPixel: number,
  bigEndian: boolean,
): number {
  let value = 0;

  if (bigEndian) {
    for (let index = 0; index < bytesPerPixel; index += 1) {
      value = (value << 8) | (pixelBytes[offset + index] ?? 0);
    }
  } else {
    for (let index = 0; index < bytesPerPixel; index += 1) {
      value |= (pixelBytes[offset + index] ?? 0) << (index * 8);
    }
  }

  return value >>> 0;
}

function scaleColorChannel(value: number, maximum: number): number {
  if (maximum <= 0) {
    return 0;
  }

  return Math.round((value * 255) / maximum);
}

function quantizeColor(red: number, green: number, blue: number): number {
  return ((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4);
}

function computeLuma(red: number, green: number, blue: number): number {
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}
