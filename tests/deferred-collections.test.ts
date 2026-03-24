import assert from "node:assert/strict";
import test from "node:test";

import {
  canUseDeferredIdentifiedCollection,
  orderIdentifiedCollectionByIds,
} from "../apps/web/src/deferredCollections.js";

test("deferred collections stay active when the same ids are still present in order", () => {
  assert.equal(
    canUseDeferredIdentifiedCollection(
      [
        { id: "vm-1", name: "alpha" },
        { id: "vm-2", name: "beta" },
      ],
      [
        { id: "vm-1", name: "alpha old" },
        { id: "vm-2", name: "beta old" },
      ],
    ),
    true,
  );
});

test("deferred collections are rejected immediately when an item is removed", () => {
  assert.equal(
    canUseDeferredIdentifiedCollection(
      [{ id: "vm-1", name: "alpha" }],
      [
        { id: "vm-1", name: "alpha old" },
        { id: "vm-2", name: "beta old" },
      ],
    ),
    false,
  );
});

test("deferred collections are rejected immediately when ordering changes", () => {
  assert.equal(
    canUseDeferredIdentifiedCollection(
      [
        { id: "vm-2", name: "beta" },
        { id: "vm-1", name: "alpha" },
      ],
      [
        { id: "vm-1", name: "alpha old" },
        { id: "vm-2", name: "beta old" },
      ],
    ),
    false,
  );
});

test("identified collections can be reordered by a provided id sequence", () => {
  assert.deepEqual(
    orderIdentifiedCollectionByIds(
      [
        { id: "vm-1", name: "alpha" },
        { id: "vm-2", name: "beta" },
        { id: "vm-3", name: "gamma" },
      ],
      ["vm-3", "vm-1", "vm-2"],
    ).map((entry) => entry.id),
    ["vm-3", "vm-1", "vm-2"],
  );
});

test("identified collections append unknown or omitted ids in their current order", () => {
  assert.deepEqual(
    orderIdentifiedCollectionByIds(
      [
        { id: "vm-1", name: "alpha" },
        { id: "vm-2", name: "beta" },
        { id: "vm-3", name: "gamma" },
      ],
      ["vm-2"],
    ).map((entry) => entry.id),
    ["vm-2", "vm-1", "vm-3"],
  );
});
