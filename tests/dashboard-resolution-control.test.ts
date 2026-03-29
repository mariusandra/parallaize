import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { createResolutionControlLease } from "../apps/web/src/desktopResolution.js";
import {
  readOrCreateResolutionControlClientId,
  claimResolutionControlLease,
  releaseResolutionControlLease,
} from "../apps/web/src/dashboardResolutionControl.js";
import {
  resolutionControlClientIdStorageKey,
} from "../apps/web/src/dashboardPersistence.js";

test("resolution-control client ids persist once created", (context) => {
  const storage = new Map<string, string>();
  installWindow(context, storage);

  const first = readOrCreateResolutionControlClientId();
  const second = readOrCreateResolutionControlClientId();

  assert.equal(first, second);
  assert.equal(storage.get(resolutionControlClientIdStorageKey), first);
});

test("resolution-control leases block other tabs until released or expired", (context) => {
  const storage = new Map<string, string>();
  installWindow(context, storage);

  assert.equal(claimResolutionControlLease("vm-0001", "tab-a"), "self");
  assert.equal(claimResolutionControlLease("vm-0001", "tab-b"), "other");

  releaseResolutionControlLease("vm-0001", "tab-b");
  assert.equal(claimResolutionControlLease("vm-0001", "tab-b"), "other");

  releaseResolutionControlLease("vm-0001", "tab-a");
  assert.equal(claimResolutionControlLease("vm-0001", "tab-b"), "self");
});

test("resolution-control force claims replace a stale foreign lease", (context) => {
  const storage = new Map<string, string>([
    [
      "parallaize.desktop-resolution-controller:vm-0001",
      JSON.stringify(createResolutionControlLease("vm-0001", "tab-a", Date.now())),
    ],
  ]);
  installWindow(context, storage);

  assert.equal(claimResolutionControlLease("vm-0001", "tab-b", true), "self");
});

function installWindow(context: TestContext, storage: Map<string, string>): void {
  const globalScope = globalThis as typeof globalThis & { window?: unknown };
  const previousWindow = globalScope.window;

  Object.assign(globalScope, {
    window: {
      localStorage: {
        getItem(key: string) {
          return storage.get(key) ?? null;
        },
        removeItem(key: string) {
          storage.delete(key);
        },
        setItem(key: string, value: string) {
          storage.set(key, value);
        },
      },
    },
  });

  context.after(() => {
    if (previousWindow === undefined) {
      Reflect.deleteProperty(globalScope, "window");
    } else {
      globalScope.window = previousWindow;
    }
  });
}
