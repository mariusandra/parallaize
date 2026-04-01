import assert from "node:assert/strict";
import test from "node:test";

import { buildRandomVmName } from "../apps/web/src/vmNames.js";
import { vmNameAnimals } from "../packages/shared/src/vm-name-words.js";

test("buildRandomVmName combines a clean adjective and animal slug", () => {
  const otterIndex = vmNameAnimals.indexOf("otter");
  const values = [0, (otterIndex + 0.1) / vmNameAnimals.length];
  let index = 0;

  const name = buildRandomVmName(() => {
    const value = values[index] ?? values[values.length - 1] ?? 0;
    index += 1;
    return value;
  });

  assert.match(name, /^[a-z]+-[a-z]+$/);
  assert.equal(name, "angry-otter");
});

test("vmNameAnimals keeps the requested slugs available", () => {
  const requiredAnimals = [
    "beaver",
    "hedgehog",
    "penguin",
    "kingfisher",
    "toucan",
    "parrot",
    "meerkat",
    "axolotl",
    "capybara",
    "wombat",
  ] as const satisfies readonly (typeof vmNameAnimals)[number][];

  for (const animal of requiredAnimals) {
    assert.equal(vmNameAnimals.includes(animal), true);
  }
});

test("buildRandomVmName clamps edge-case random values into the word lists", () => {
  const values = [1, -1];
  let index = 0;

  const name = buildRandomVmName(() => {
    const value = values[index] ?? 0;
    index += 1;
    return value;
  });

  assert.equal(name, `wild-${vmNameAnimals[0]}`);
});
