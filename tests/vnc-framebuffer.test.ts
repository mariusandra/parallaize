import assert from "node:assert/strict";
import test from "node:test";

import {
  FramebufferVisibilityTracker,
  type VncPixelFormat,
} from "../packages/shared/src/vnc-framebuffer.js";

const RGBX_8888_LE: VncPixelFormat = {
  bitsPerPixel: 32,
  blueMax: 255,
  blueShift: 0,
  depth: 24,
  greenMax: 255,
  greenShift: 8,
  bigEndian: false,
  redMax: 255,
  redShift: 16,
  trueColor: true,
};

const RGB_565_LE: VncPixelFormat = {
  bitsPerPixel: 16,
  blueMax: 31,
  blueShift: 0,
  depth: 16,
  greenMax: 63,
  greenShift: 5,
  bigEndian: false,
  redMax: 31,
  redShift: 11,
  trueColor: true,
};

test("framebuffer visibility tracker rejects a fully black frame", () => {
  const tracker = new FramebufferVisibilityTracker(64, 64);
  const pixels = Buffer.alloc(64 * 64 * 4);

  tracker.recordRawRectangle(0, 0, 64, 64, pixels, RGBX_8888_LE);
  const stats = tracker.snapshot();

  assert.equal(stats.hasVisibleContent, false);
  assert.equal(stats.nonBlackPixelCount, 0);
  assert.equal(stats.litTileCount, 0);
});

test("framebuffer visibility tracker ignores tiny bright cursor-like noise", () => {
  const tracker = new FramebufferVisibilityTracker(128, 128);
  const pixels = Buffer.alloc(128 * 128 * 4);

  fillRect32(pixels, 128, 2, 2, 6, 6, {
    blue: 255,
    green: 255,
    red: 255,
  });

  tracker.recordRawRectangle(0, 0, 128, 128, pixels, RGBX_8888_LE);
  const stats = tracker.snapshot();

  assert.equal(stats.hasVisibleContent, false);
  assert.equal(stats.litTileCount, 1);
  assert.ok(stats.nonBlackPixelRatio < 0.01);
});

test("framebuffer visibility tracker accepts a desktop-like distributed frame", () => {
  const tracker = new FramebufferVisibilityTracker(128, 128);
  const pixels = Buffer.alloc(128 * 128 * 4);

  fillRect32(pixels, 128, 0, 0, 64, 64, {
    blue: 56,
    green: 88,
    red: 193,
  });
  fillRect32(pixels, 128, 64, 0, 64, 64, {
    blue: 168,
    green: 125,
    red: 76,
  });
  fillRect32(pixels, 128, 0, 64, 64, 64, {
    blue: 208,
    green: 182,
    red: 88,
  });
  fillRect32(pixels, 128, 64, 64, 64, 64, {
    blue: 42,
    green: 42,
    red: 42,
  });

  tracker.recordRawRectangle(0, 0, 128, 128, pixels, RGBX_8888_LE);
  const stats = tracker.snapshot();

  assert.equal(stats.hasVisibleContent, true);
  assert.ok(stats.litTileCount >= 4);
  assert.ok(stats.uniqueColorBucketCount >= 4);
});

test("framebuffer visibility tracker decodes 16-bit RGB565 rectangles", () => {
  const tracker = new FramebufferVisibilityTracker(32, 32);
  const pixels = Buffer.alloc(32 * 32 * 2);

  fillRect16(pixels, 32, 0, 0, 32, 32, 0b01010, 0b111111, 0b01010);

  tracker.recordRawRectangle(0, 0, 32, 32, pixels, RGB_565_LE);
  const stats = tracker.snapshot();

  assert.equal(stats.hasVisibleContent, true);
  assert.ok(stats.averageLuma > 0);
});

function fillRect32(
  pixels: Buffer,
  frameWidth: number,
  x: number,
  y: number,
  width: number,
  height: number,
  color: { blue: number; green: number; red: number },
): void {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      const offset = ((row * frameWidth) + column) * 4;
      pixels[offset] = color.blue;
      pixels[offset + 1] = color.green;
      pixels[offset + 2] = color.red;
      pixels[offset + 3] = 0;
    }
  }
}

function fillRect16(
  pixels: Buffer,
  frameWidth: number,
  x: number,
  y: number,
  width: number,
  height: number,
  red: number,
  green: number,
  blue: number,
): void {
  const packed = ((red & 0b11111) << 11) | ((green & 0b111111) << 5) | (blue & 0b11111);

  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      const offset = ((row * frameWidth) + column) * 2;
      pixels.writeUInt16LE(packed, offset);
    }
  }
}
