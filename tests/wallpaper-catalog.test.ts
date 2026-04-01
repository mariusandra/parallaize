import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAllWallpaperSubjects,
  buildBulkWallpaperFilename,
  collectPendingWallpaperSubjects,
} from "../packages/shared/src/wallpaper-catalog.js";
import {
  vmNameAdjectives,
  vmNameAnimals,
} from "../packages/shared/src/vm-name-words.js";

test("buildAllWallpaperSubjects enumerates the full adjective-animal catalog", () => {
  const subjects = buildAllWallpaperSubjects();
  const expectedCatalogSize = vmNameAdjectives.length * vmNameAnimals.length;

  assert.equal(subjects.length, expectedCatalogSize);
  assert.equal(subjects[0]?.slug, `angry-${vmNameAnimals[0]}`);
  assert.equal(
    subjects.at(-1)?.slug,
    `wild-${vmNameAnimals[vmNameAnimals.length - 1]}`,
  );
  assert.equal(
    new Set(subjects.map((subject) => subject.slug)).size,
    expectedCatalogSize,
  );
});

test("buildBulkWallpaperFilename matches the production bulk output layout", () => {
  assert.equal(buildBulkWallpaperFilename("daring-fox"), "daring-fox.jpg");
  assert.equal(buildBulkWallpaperFilename("quiet-yak", "webp"), "quiet-yak.webp");
});

test("collectPendingWallpaperSubjects skips files that already exist on disk", () => {
  const subjects = buildAllWallpaperSubjects().slice(0, 3);
  const existingFilenames = new Set(
    subjects
      .slice(0, 2)
      .map((subject) => buildBulkWallpaperFilename(subject.slug)),
  );
  const pending = collectPendingWallpaperSubjects(
    subjects,
    existingFilenames,
  );

  assert.deepEqual(pending.map((subject) => subject.slug), [subjects[2]?.slug]);
});
