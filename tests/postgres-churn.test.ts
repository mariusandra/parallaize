import assert from "node:assert/strict";
import test from "node:test";

import type { Pool } from "pg";

import type { AppState } from "../packages/shared/src/types.js";
import { DesktopManager } from "../apps/control/src/manager.js";
import { createProvider } from "../apps/control/src/providers.js";
import { createSeedState } from "../apps/control/src/seed.js";
import { PostgresStateStore } from "../apps/control/src/store.js";

test("postgres persistence survives repeated create, clone, delete, and snapshot churn", async () => {
  const provider = createProvider("mock", "incus");
  const initialState = createSeedState(provider.state);
  let storedState: AppState | null = null;

  const fakePool = {
    async query(sql: string, params?: unknown[]): Promise<void> {
      if (sql.includes("INSERT INTO app_state")) {
        storedState = JSON.parse(String(params?.[1])) as AppState;
        await wait(5);
      }
    },
    async end(): Promise<void> {},
  } as unknown as Pool;

  const StoreCtor = PostgresStateStore as unknown as {
    new (pool: Pool, initialState: AppState, initialPersistedAt: string | null): PostgresStateStore;
  };
  const store = new StoreCtor(fakePool, initialState, null);
  const manager = new DesktopManager(store, provider);

  for (let index = 0; index < 3; index += 1) {
    const vm = manager.createVm({
      templateId: "tpl-0001",
      name: `pg-churn-${index + 1}`,
      resources: {
        cpu: 4,
        ramMb: 8192,
        diskGb: 60,
      },
    });
    await wait(700);

    manager.snapshotVm(vm.id, {
      label: `checkpoint-${index + 1}`,
    });
    await wait(550);

    const snapshot = manager.getVmDetail(vm.id).snapshots[0];
    assert.ok(snapshot);

    const clone = manager.cloneVm({
      sourceVmId: vm.id,
      name: `pg-clone-${index + 1}`,
    });
    await wait(700);

    manager.deleteVm(clone.id);
    await wait(450);
  }

  await store.flush();

  const summary = manager.getSummary();

  assert.equal(store.getDiagnostics().status, "ready");
  if (!storedState) {
    throw new Error("Expected PostgreSQL persistence to capture state.");
  }
  const persistedState = storedState as AppState;
  assert.equal(persistedState.vms.length, summary.vms.length);
  assert.equal(persistedState.snapshots.length, summary.snapshots.length);
  assert.ok(persistedState.jobs.some((job) => job.kind === "snapshot"));
  assert.ok(persistedState.jobs.some((job) => job.kind === "clone"));
  assert.ok(persistedState.jobs.some((job) => job.kind === "delete"));
});

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
