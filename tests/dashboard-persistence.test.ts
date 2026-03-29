import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import {
  activeCpuThresholdsByVmStorageKey,
  desktopResolutionByVmStorageKey,
  readActiveCpuThresholdsByVm,
  readDesktopResolutionByVm,
  readDocumentVisible,
  readSidepanelCollapsedByVm,
  readStoredBoolean,
  readStoredNumber,
  readThemeMode,
  readViewportWidth,
  sidepanelCollapsedByVmStorageKey,
  themeModeStorageKey,
  writeStoredString,
} from "../apps/web/src/dashboardPersistence.js";

test("dashboard persistence reads theme and primitive values from browser storage", (context) => {
  const storage = new Map<string, string>([
    [themeModeStorageKey, "dark"],
    ["feature-flag", "true"],
    ["rail-width", "320"],
  ]);
  installBrowserGlobals(context, storage, {
    innerWidth: 1660,
    prefersDark: false,
    visibilityState: "hidden",
  });

  assert.equal(readThemeMode(), "dark");
  assert.equal(readStoredBoolean("feature-flag", false), true);
  assert.equal(readStoredNumber("rail-width"), 320);
  assert.equal(readViewportWidth(), 1660);
  assert.equal(readDocumentVisible(), false);
});

test("dashboard persistence falls back to system dark mode and ignores bad storage payloads", (context) => {
  const storage = new Map<string, string>([
    [sidepanelCollapsedByVmStorageKey, "{\"vm-0001\":true,\"\":true,\"vm-0002\":false}"],
    [
      activeCpuThresholdsByVmStorageKey,
      "{\"vm-0001\":72,\"vm-0002\":\"bad\",\"\":55}",
    ],
    [
      desktopResolutionByVmStorageKey,
      "{\"vm-0001\":{\"mode\":\"fixed\",\"width\":1600},\"\":{\"mode\":\"viewport\"}}",
    ],
  ]);
  installBrowserGlobals(context, storage, {
    prefersDark: true,
  });

  assert.equal(readThemeMode(), "dark");
  assert.deepEqual(readSidepanelCollapsedByVm(), {
    "vm-0001": true,
  });
  assert.deepEqual(
    readActiveCpuThresholdsByVm((value) => Math.round(value / 5) * 5),
    {
      "vm-0001": 70,
    },
  );
  assert.deepEqual(
    readDesktopResolutionByVm((preference) => {
      const parsed = preference as { mode?: string; width?: number };
      return {
        mode: parsed.mode === "fixed" ? "fixed" : "viewport",
        width: parsed.width ?? 1280,
      };
    }),
    {
      "vm-0001": {
        mode: "fixed",
        width: 1600,
      },
    },
  );
});

test("dashboard persistence writes through localStorage failures without throwing", (context) => {
  const storage = new Map<string, string>();
  installBrowserGlobals(context, storage, {
    failWrites: true,
  });

  assert.doesNotThrow(() => {
    writeStoredString("theme", "light");
  });
  assert.equal(storage.get("theme"), undefined);
});

function installBrowserGlobals(
  context: TestContext,
  storage: Map<string, string>,
  options: {
    failWrites?: boolean;
    innerWidth?: number;
    prefersDark?: boolean;
    visibilityState?: "visible" | "hidden";
  } = {},
): void {
  const globalScope = globalThis as typeof globalThis & {
    document?: unknown;
    window?: unknown;
  };
  const previousWindow = globalScope.window;
  const previousDocument = globalScope.document;

  const windowMock = {
    innerWidth: options.innerWidth ?? 1440,
    localStorage: {
      getItem(key: string) {
        return storage.get(key) ?? null;
      },
      removeItem(key: string) {
        storage.delete(key);
      },
      setItem(key: string, value: string) {
        if (options.failWrites) {
          throw new Error("write failed");
        }

        storage.set(key, value);
      },
    },
    matchMedia() {
      return {
        matches: options.prefersDark ?? false,
      };
    },
  };
  const documentMock = {
    visibilityState: options.visibilityState ?? "visible",
  };

  Object.assign(globalScope, {
    document: documentMock,
    window: windowMock,
  });

  context.after(() => {
    if (previousWindow === undefined) {
      Reflect.deleteProperty(globalScope, "window");
    } else {
      globalScope.window = previousWindow;
    }

    if (previousDocument === undefined) {
      Reflect.deleteProperty(globalScope, "document");
    } else {
      globalScope.document = previousDocument;
    }
  });
}
