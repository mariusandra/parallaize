import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCompressionFriendlyWallpaperPrompt,
  buildRandomWallpaperSubject,
  buildWallpaperSubjectFromParts,
} from "../packages/shared/src/wallpaper-prompts.js";

test("buildRandomWallpaperSubject reuses the VM adjective and animal lists", () => {
  const values = [0, 0.57];
  let index = 0;

  const subject = buildRandomWallpaperSubject(() => {
    const value = values[index] ?? values[values.length - 1] ?? 0;
    index += 1;
    return value;
  });

  assert.deepEqual(subject, {
    adjective: "angry",
    animal: "otter",
    slug: "angry-otter",
  });
});

test("buildCompressionFriendlyWallpaperPrompt keeps the abstract compression-safe art direction", () => {
  const prompt = buildCompressionFriendlyWallpaperPrompt({
    subject: buildWallpaperSubjectFromParts("fox", "quiet"),
  });

  assert.match(prompt, /Feature a fox as the central subject/u);
  assert.match(prompt, /Match the visual language of Ubuntu 24\.04's Monument Valley wallpaper/u);
  assert.match(prompt, /Set it in a stylized forest edge with brushy undergrowth/u);
  assert.match(prompt, /compression-friendly/u);
  assert.match(prompt, /rather than dropping it into Monument Valley/u);
  assert.match(prompt, /no watermark/u);
  assert.match(prompt, /Make the adjective "quiet" visually unmistakable/u);
  assert.match(prompt, /The wallpaper should read clearly as "quiet-fox"/u);
});
