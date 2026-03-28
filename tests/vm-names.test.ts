import assert from "node:assert/strict";
import test from "node:test";

import { buildRandomVmName } from "../apps/web/src/vmNames.js";

test("buildRandomVmName combines a clean adjective and animal slug", () => {
  const values = [0, 0.57];
  let index = 0;

  const name = buildRandomVmName(() => {
    const value = values[index] ?? values[values.length - 1] ?? 0;
    index += 1;
    return value;
  });

  assert.match(name, /^[a-z]+-[a-z]+$/);
  assert.equal(name, "angry-otter");
});

test("buildRandomVmName clamps edge-case random values into the word lists", () => {
  const values = [1, -1];
  let index = 0;

  const name = buildRandomVmName(() => {
    const value = values[index] ?? 0;
    index += 1;
    return value;
  });

  assert.equal(name, "wild-badger");
});
