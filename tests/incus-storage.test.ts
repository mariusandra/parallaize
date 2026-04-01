import assert from "node:assert/strict";
import test from "node:test";

import type { AppConfig } from "../apps/control/src/config.js";
import {
  collectIncusStorageDiagnostics,
  runIncusStorageAction,
  type ShellCommandRunner,
} from "../apps/control/src/incus-storage.js";

test("incus storage diagnostics warn when Parallaize targets a dir pool", () => {
  const runner = new FakeRunner((command, args) => {
    if (command === "incus" && args[0] === "query" && args[1] === "/1.0/profiles/default") {
      return ok(
        args,
        JSON.stringify({
          devices: {
            root: {
              type: "disk",
              path: "/",
              pool: "default",
            },
          },
        }),
      );
    }

    if (
      command === "incus" &&
      args[0] === "query" &&
      args[1] === "/1.0/storage-pools?recursion=1"
    ) {
      return ok(
        args,
        JSON.stringify([
          {
            name: "default",
            driver: "dir",
            config: {
              source: "/var/lib/incus/storage-pools/default",
            },
          },
        ]),
      );
    }

    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  });

  const diagnostics = collectIncusStorageDiagnostics(buildConfig(), runner);

  assert.ok(diagnostics);
  assert.equal(diagnostics.status, "warning");
  assert.equal(diagnostics.selectedPool, "default");
  assert.equal(diagnostics.selectedPoolDriver, "dir");
  assert.match(diagnostics.detail, /slow path/i);
  assert.ok(
    diagnostics.nextSteps.some((entry) =>
      entry.includes("PARALLAIZE_INCUS_STORAGE_POOL"),
    ),
  );
});

test("incus storage diagnostics flag a loop-backed btrfs bootstrap pool", () => {
  const runner = new FakeRunner((command, args) => {
    if (command === "incus" && args[0] === "query" && args[1] === "/1.0/profiles/default") {
      return ok(
        args,
        JSON.stringify({
          devices: {
            root: {
              type: "disk",
              path: "/",
              pool: "default",
            },
          },
        }),
      );
    }

    if (
      command === "incus" &&
      args[0] === "query" &&
      args[1] === "/1.0/storage-pools?recursion=1"
    ) {
      return ok(
        args,
        JSON.stringify([
          {
            name: "default",
            driver: "btrfs",
            config: {
              source: "/var/lib/incus/disks/default.img",
            },
          },
        ]),
      );
    }

    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  });

  const diagnostics = collectIncusStorageDiagnostics(buildConfig(), runner);

  assert.ok(diagnostics);
  assert.equal(diagnostics.status, "warning");
  assert.equal(diagnostics.selectedPoolDriver, "btrfs");
  assert.equal(diagnostics.selectedPoolLoopBacked, true);
  assert.match(diagnostics.detail, /loop-backed/i);
});

test("blank-host bootstrap prefers btrfs and falls back to dir when needed", () => {
  let btrfsAttempted = false;
  const runner = new FakeRunner((command, args, options) => {
    if (
      command === "incus" &&
      args[0] === "query" &&
      args[1] === "/1.0/storage-pools?recursion=1"
    ) {
      return ok(args, "[]");
    }

    if (command === "incus" && args[0] === "query" && args[1] === "/1.0/profiles/default") {
      return ok(
        args,
        JSON.stringify({
          devices: {},
        }),
      );
    }

    if (command === "incus" && args[0] === "network" && args[1] === "show" && args[2] === "incusbr0") {
      return fail(args, "incusbr0 was not found");
    }

    if (command === "bash" && args[0] === "-lc") {
      return ok(args, "");
    }

    if (command === "incus" && args[0] === "admin" && args[1] === "init" && args[2] === "--preseed") {
      const input = options?.input ?? "";

      if (input.includes("driver: btrfs") && !btrfsAttempted) {
        btrfsAttempted = true;
        return fail(args, "btrfs backend failed");
      }

      return ok(args, "");
    }

    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  });

  const result = runIncusStorageAction(buildConfig(), "bootstrap", runner);

  assert.equal(result.changed, true);
  assert.match(result.message, /fallback dir/i);
  const initInputs = runner.calls
    .filter(
      (call) =>
        call.command === "incus" &&
        call.args[0] === "admin" &&
        call.args[1] === "init",
    )
    .map((call) => call.input ?? "");
  assert.equal(initInputs.length, 2);
  assert.match(initInputs[0] ?? "", /driver: btrfs/);
  assert.match(initInputs[1] ?? "", /driver: dir/);
});

test("blank-host bootstrap is a no-op once Incus already has storage", () => {
  const runner = new FakeRunner((command, args) => {
    if (
      command === "incus" &&
      args[0] === "query" &&
      args[1] === "/1.0/storage-pools?recursion=1"
    ) {
      return ok(
        args,
        JSON.stringify([
          {
            name: "fastpool",
            driver: "zfs",
            config: {
              source: "fastpool",
            },
          },
        ]),
      );
    }

    if (command === "incus" && args[0] === "query" && args[1] === "/1.0/profiles/default") {
      return ok(
        args,
        JSON.stringify({
          devices: {
            root: {
              type: "disk",
              path: "/",
              pool: "fastpool",
            },
          },
        }),
      );
    }

    if (command === "incus" && args[0] === "network" && args[1] === "show" && args[2] === "incusbr0") {
      return ok(args, "name: incusbr0");
    }

    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  });

  const result = runIncusStorageAction(buildConfig({ incusStoragePool: "fastpool" }), "bootstrap", runner);

  assert.equal(result.changed, false);
  assert.match(result.message, /Skipped blank-host bootstrap/);
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "incus" &&
        call.args[0] === "admin" &&
        call.args[1] === "init",
    ),
    false,
  );
});

class FakeRunner implements ShellCommandRunner {
  readonly calls: Array<{
    command: string;
    args: string[];
    input?: string;
  }> = [];

  constructor(
    private readonly handler: (
      command: string,
      args: string[],
      options?: {
        input?: string;
        timeoutMs?: number;
      },
    ) => {
      args: string[];
      status: number | null;
      stdout: string;
      stderr: string;
      error?: Error;
    },
  ) {}

  execute(
    command: string,
    args: string[],
    options?: {
      input?: string;
      timeoutMs?: number;
    },
  ) {
    this.calls.push({
      command,
      args,
      input: options?.input,
    });
    return this.handler(command, args, options);
  }
}

function buildConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    appHome: process.cwd(),
    host: "127.0.0.1",
    port: 3000,
    releaseMetadataUrl: "https://parallaize.com/latest.json",
    forwardedServiceHostBase: "localhost",
    persistenceKind: "json",
    dataFile: "data/state.json",
    databaseUrl: null,
    providerKind: "incus",
    mockDesktopTransport: "synthetic",
    incusBinary: "incus",
    incusProject: null,
    incusStoragePool: "default",
    configuredDefaultTemplateLaunchSource: null,
    defaultTemplateLaunchSource: "images:ubuntu/noble/desktop",
    templateCompression: "none",
    guestVncPort: 5900,
    guestSelkiesPort: 6080,
    guacdHost: "127.0.0.1",
    guacdPort: 4822,
    guestSelkiesRtcConfig: null,
    guestInotifyMaxUserWatches: 1_048_576,
    guestInotifyMaxUserInstances: 2_048,
    adminUsername: "admin",
    adminPassword: null,
    sessionMaxAgeSeconds: 60 * 60 * 24 * 7,
    sessionIdleTimeoutSeconds: 60 * 60 * 24,
    sessionRotationSeconds: 60 * 60 * 6,
    ...overrides,
  };
}

function ok(args: string[], stdout: string) {
  return {
    args,
    status: 0,
    stdout,
    stderr: "",
  };
}

function fail(args: string[], stderr: string) {
  return {
    args,
    status: 1,
    stdout: "",
    stderr,
  };
}
