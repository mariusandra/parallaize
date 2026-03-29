import assert from "node:assert/strict";
import test from "node:test";

import { applyVmLogsAppend } from "../apps/web/src/dashboardTransport.js";

test("applyVmLogsAppend appends the new chunk and updates fetch metadata", () => {
  const snapshot = applyVmLogsAppend(
    {
      provider: "mock",
      providerRef: "alpha-workbench",
      source: "mock snapshot",
      content: "line 1\n",
      fetchedAt: "2026-03-29T10:00:00.000Z",
    },
    {
      chunk: "line 2\n",
      fetchedAt: "2026-03-29T10:00:05.000Z",
      source: "live tail",
    },
  );

  assert.deepEqual(snapshot, {
    provider: "mock",
    providerRef: "alpha-workbench",
    source: "live tail",
    content: "line 1\nline 2\n",
    fetchedAt: "2026-03-29T10:00:05.000Z",
  });
});

test("applyVmLogsAppend leaves a missing snapshot unchanged", () => {
  assert.equal(
    applyVmLogsAppend(null, {
      chunk: "line 2\n",
      fetchedAt: "2026-03-29T10:00:05.000Z",
      source: "live tail",
    }),
    null,
  );
});
