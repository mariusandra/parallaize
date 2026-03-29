import assert from "node:assert/strict";
import test from "node:test";

import { parseLatestReleaseMetadata } from "../apps/control/src/server-release.js";

test("parseLatestReleaseMetadata accepts a valid release payload", () => {
  assert.deepEqual(
    parseLatestReleaseMetadata({
      version: "1.2.3",
      packageRelease: 4,
      packageLabel: "1.2.3-4",
    }),
    {
      version: "1.2.3",
      packageRelease: "4",
      packageLabel: "1.2.3-4",
    },
  );
});

test("parseLatestReleaseMetadata falls back to version-packageRelease for the label", () => {
  assert.deepEqual(
    parseLatestReleaseMetadata({
      version: "2.0.1",
      packageRelease: "7",
      packageLabel: "   ",
    }),
    {
      version: "2.0.1",
      packageRelease: "7",
      packageLabel: "2.0.1-7",
    },
  );
});

test("parseLatestReleaseMetadata rejects malformed version and package release values", () => {
  assert.equal(
    parseLatestReleaseMetadata({
      version: "2.0",
      packageRelease: "7",
    }),
    null,
  );
  assert.equal(
    parseLatestReleaseMetadata({
      version: "2.0.1",
      packageRelease: "0",
    }),
    null,
  );
});
