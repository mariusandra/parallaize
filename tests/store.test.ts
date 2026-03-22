import assert from "node:assert/strict";
import test from "node:test";

import type { Pool } from "pg";

import type { AppState } from "../packages/shared/src/types.js";
import { createProvider } from "../apps/control/src/providers.js";
import { createSeedState } from "../apps/control/src/seed.js";
import { PostgresStateStore } from "../apps/control/src/store.js";

test("postgres diagnostics degrade on failed persist and recover after a later successful write", async () => {
  const provider = createProvider("mock", "incus");
  const initialState = createSeedState(provider.state);
  let failWrites = true;
  const originalConsoleError = console.error;

  console.error = () => {};

  try {
    const fakePool = {
      async query(): Promise<void> {
        if (failWrites) {
          throw new Error("db down");
        }
      },
      async end(): Promise<void> {},
    } as unknown as Pool;

    const StoreCtor = PostgresStateStore as unknown as {
      new (pool: Pool, initialState: AppState, initialPersistedAt: string | null): PostgresStateStore;
    };
    const store = new StoreCtor(fakePool, initialState, null);

    store.update((draft) => {
      draft.sequence += 1;
    });

    await assert.rejects(store.flush(), /PostgreSQL persistence failed: db down/);
    assert.equal(store.getDiagnostics().status, "degraded");
    assert.match(store.getDiagnostics().lastPersistError ?? "", /db down/);
    assert.equal(store.load().sequence, initialState.sequence + 1);

    failWrites = false;

    store.update((draft) => {
      draft.sequence += 1;
    });

    await store.flush();
    assert.equal(store.getDiagnostics().status, "ready");
    assert.equal(store.getDiagnostics().lastPersistError, null);
    assert.equal(store.load().sequence, initialState.sequence + 2);
  } finally {
    console.error = originalConsoleError;
  }
});
