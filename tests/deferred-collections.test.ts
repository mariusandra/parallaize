import assert from "node:assert/strict";
import test from "node:test";

import { canUseDeferredIdentifiedCollection } from "../apps/web/src/deferredCollections.js";

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
