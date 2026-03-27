import assert from "node:assert/strict";
import test from "node:test";

import {
  compareReleaseLabels,
  compareSemver,
  hasNewerReleaseAvailable,
} from "../apps/web/src/releaseVersion.js";

test("semver comparison orders stable versions correctly", () => {
  assert.equal(compareSemver("0.1.8", "0.1.8"), 0);
  assert.equal(compareSemver("0.1.8", "0.1.9"), -1);
  assert.equal(compareSemver("1.0.0", "0.9.9"), 1);
});

test("release comparison falls back to package release when versions match", () => {
  assert.equal(compareReleaseLabels("0.1.8", "1", "0.1.8", "2"), -1);
  assert.equal(compareReleaseLabels("0.1.8", "3", "0.1.8", "2"), 1);
});

test("update availability checks version and package release", () => {
  assert.equal(
    hasNewerReleaseAvailable("0.1.8", "1", {
      version: "0.1.8",
      packageRelease: "2",
      packageLabel: "0.1.8-2",
    }),
    true,
  );
  assert.equal(
    hasNewerReleaseAvailable("0.1.8", "2", {
      version: "0.1.8",
      packageRelease: "2",
      packageLabel: "0.1.8-2",
    }),
    false,
  );
  assert.equal(
    hasNewerReleaseAvailable("0.1.9", "1", {
      version: "0.1.8",
      packageRelease: "4",
      packageLabel: "0.1.8-4",
    }),
    false,
  );
});
