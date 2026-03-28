import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { Pool } from "pg";

import type { AppState } from "../packages/shared/src/types.js";
import { createProvider } from "../apps/control/src/providers.js";
import { createSeedState } from "../apps/control/src/seed.js";
import { JsonStateStore, PostgresStateStore } from "../apps/control/src/store.js";

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

test("json store honors the configured default launch source while normalizing legacy templates", (context) => {
  const provider = createProvider("mock", "incus");
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-store-default-source-"));
  const statePath = join(tempDir, "state.json");

  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  writeFileSync(
    statePath,
    JSON.stringify({
      sequence: 1,
      provider: provider.state,
      templates: [
        {
          id: "tpl-legacy",
          name: "Legacy seed",
          provenance: {
            kind: "seed",
            summary: "",
          },
        },
      ],
      vms: [],
      snapshots: [],
      jobs: [],
      adminSessions: [],
      lastUpdated: new Date().toISOString(),
    }),
    "utf8",
  );

  const store = new JsonStateStore(
    statePath,
    () => createSeedState(provider.state),
    {
      defaultTemplateLaunchSource: "local:ubuntu-noble-desktop-20260320",
    },
  );

  const state = store.load();

  assert.equal(
    state.templates[0]?.launchSource,
    "local:ubuntu-noble-desktop-20260320",
  );
});
