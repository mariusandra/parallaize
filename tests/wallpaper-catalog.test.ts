import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAllWallpaperSubjects,
  buildBulkWallpaperFilename,
  collectPendingWallpaperSubjects,
} from "../packages/shared/src/wallpaper-catalog.js";

test("buildAllWallpaperSubjects enumerates the full adjective-animal catalog", () => {
  const subjects = buildAllWallpaperSubjects();

  assert.equal(subjects.length, 1_156);
  assert.equal(subjects[0]?.slug, "angry-badger");
  assert.equal(subjects.at(-1)?.slug, "wild-yak");
  assert.equal(new Set(subjects.map((subject) => subject.slug)).size, 1_156);
});

test("buildBulkWallpaperFilename matches the production bulk output layout", () => {
  assert.equal(buildBulkWallpaperFilename("daring-fox"), "daring-fox.jpg");
  assert.equal(buildBulkWallpaperFilename("quiet-yak", "webp"), "quiet-yak.webp");
});

test("collectPendingWallpaperSubjects skips files that already exist on disk", () => {
  const subjects = buildAllWallpaperSubjects().slice(0, 3);
  const pending = collectPendingWallpaperSubjects(
    subjects,
    new Set(["angry-badger.jpg", "angry-bear.jpg"]),
  );

  assert.deepEqual(pending.map((subject) => subject.slug), ["angry-beaver"]);
});
