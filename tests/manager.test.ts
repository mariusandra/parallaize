import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  AppState,
  EnvironmentTemplate,
  VmInstance,
} from "../packages/shared/src/types.js";
import { DesktopManager } from "../apps/control/src/manager.js";
import type { DesktopProvider } from "../apps/control/src/providers.js";
import { createProvider } from "../apps/control/src/providers.js";
import { createSeedState } from "../apps/control/src/seed.js";
import { JsonStateStore } from "../apps/control/src/store.js";

function readCommandInput(
  options?: { input?: Buffer | string },
): string {
  if (typeof options?.input === "string") {
    return options.input;
  }

  return Buffer.isBuffer(options?.input) ? options.input.toString("utf8") : "";
}

test("mock provider supports create, snapshot, and template capture flows", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider, {
    forwardedServiceHostBase: "localhost",
  });

  const vm = manager.createVm({
    templateId: "tpl-0001",
    name: "test-lab",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
  });

  await wait(700);
  assert.equal(manager.getVmDetail(vm.id).vm.status, "running");

  manager.snapshotVm(vm.id, { label: "checkpoint" });
  await wait(550);
  assert.equal(manager.getVmDetail(vm.id).snapshots.length, 1);

  manager.captureTemplate(vm.id, {
    name: "Captured Test Template",
    description: "Created during test verification",
  });
  await wait(650);

  const summary = manager.getSummary();
  const capturedTemplate = summary.templates.find(
    (template) => template.name === "Captured Test Template",
  );
  assert.ok(capturedTemplate);
  assert.equal(capturedTemplate?.launchSource, "mock://templates/captured-test-template");
  assert.equal(summary.snapshots[0]?.templateId, capturedTemplate?.id);
  assert.ok(summary.jobs.some((job) => job.kind === "capture-template" && job.status === "succeeded"));
});

test("create jobs expose staged progress while the desktop boots", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-job-progress-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);

  const vm = manager.createVm({
    templateId: "tpl-0001",
    name: "progress-lab",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
  });

  await wait(50);

  const job = manager.getVmDetail(vm.id).recentJobs[0];
  assert.ok(job);
  assert.equal(job?.kind, "create");
  assert.equal(job?.status, "running");
  assert.ok((job?.progressPercent ?? 0) > 0);
  assert.ok((job?.progressPercent ?? 100) < 100);
});

test("manager exposes preview images for running VMs", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-preview-image-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);

  const vm = manager.createVm({
    templateId: "tpl-0001",
    name: "preview-image-lab",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
  });

  await wait(700);

  const preview = await manager.getVmPreviewImage(vm.id);
  assert.equal(preview.contentType, "image/svg+xml; charset=utf-8");
  assert.match(preview.content.toString("utf8"), /<svg[\s>]/);
});

test("manager falls back to a synthetic preview image when live capture fails", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-preview-fallback-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);

  const vm = manager.createVm({
    templateId: "tpl-0001",
    name: "preview-fallback-lab",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
  });

  await wait(700);

  provider.readVmPreviewImage = async () => {
    throw new Error("Incus guest agent is unavailable for preview capture.");
  };

  const preview = await manager.getVmPreviewImage(vm.id);
  assert.equal(preview.contentType, "image/svg+xml; charset=utf-8");
  assert.match(preview.content.toString("utf8"), /<svg[\s>]/);
});

test("clone jobs surface provider boot progress instead of a stale copy label", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-clone-progress-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  provider.cloneVm = async (sourceVm, targetVm, template, report) => {
    report?.("Cloning disks", 52);
    await wait(80);
    report?.("Starting workspace", 76);
    await wait(200);

    return {
      lastAction: `Cloned from ${sourceVm.name}`,
      activity: [
        `clone: copied disks and metadata from ${sourceVm.name}`,
        `template: ${template.name}`,
      ],
      activeWindow: sourceVm.activeWindow,
      workspacePath: `/srv/workspaces/${targetVm.name}`,
      session: null,
    };
  };
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);

  const vm = manager.cloneVm({
    sourceVmId: "vm-0001",
    name: "clone-progress-lab",
  });

  await wait(700);

  const job = manager.getVmDetail(vm.id).recentJobs[0];
  assert.ok(job);
  assert.equal(job?.kind, "clone");
  assert.equal(job?.status, "running");
  assert.equal(job?.message, "Starting workspace");
  assert.equal(job?.progressPercent, 76);
});

test("snapshot launch jobs surface provider boot progress instead of a stale copy label", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-snapshot-progress-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  provider.launchVmFromSnapshot = async (snapshot, targetVm, template, report) => {
    report?.("Cloning snapshot", 48);
    await wait(80);
    report?.("Starting workspace", 76);
    await wait(200);

    return {
      lastAction: `Launched from snapshot ${snapshot.label}`,
      activity: [
        `snapshot launch: ${snapshot.label}`,
        `template: ${template.name}`,
      ],
      activeWindow: "terminal",
      workspacePath: `/srv/workspaces/${targetVm.name}`,
      session: null,
    };
  };
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);

  manager.snapshotVm("vm-0001", { label: "checkpoint" });
  await wait(550);

  const snapshot = manager.getVmDetail("vm-0001").snapshots[0];
  assert.ok(snapshot);

  const vm = manager.launchVmFromSnapshot("vm-0001", snapshot!.id, {
    sourceVmId: "vm-0001",
    name: "snapshot-progress-lab",
  });

  await wait(520);

  const job = manager.getVmDetail(vm.id).recentJobs[0];
  assert.ok(job);
  assert.equal(job?.kind, "launch-snapshot");
  assert.equal(job?.status, "running");
  assert.equal(job?.message, "Starting workspace");
  assert.equal(job?.progressPercent, 76);
});

test("manager preserves the generated wallpaper name across later renames", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-wallpaper-name-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);

  const vm = manager.createVm({
    templateId: "tpl-0001",
    name: "custom-client-name",
    wallpaperName: "angry-puffin",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
  });

  assert.equal(manager.getVmDetail(vm.id).vm.wallpaperName, "angry-puffin");

  const updated = await manager.updateVm(vm.id, {
    name: "renamed-client-name",
  });

  assert.equal(updated.name, "renamed-client-name");
  assert.equal(updated.wallpaperName, "angry-puffin");
});

test("manager reconciles the seeded template launch source to the configured default", (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-template-source-reconcile-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider, {
    defaultTemplateLaunchSource: "local:ubuntu-noble-desktop-20260320",
  });

  const template = manager.getSummary().templates.find((entry) => entry.id === "tpl-0001");
  assert.ok(template);
  assert.ok(template?.provenance);
  assert.ok(template?.history);
  assert.equal(template?.launchSource, "local:ubuntu-noble-desktop-20260320");
  assert.equal(
    template.provenance.summary,
    "Seeded from local:ubuntu-noble-desktop-20260320.",
  );
  assert.equal(
    template.history[0]?.summary,
    "Seeded from local:ubuntu-noble-desktop-20260320.",
  );
});

test("seeded templates default new VM launches to VNC", (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-template-default-transport-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);

  const template = manager.getSummary().templates.find((entry) => entry.id === "tpl-0001");

  assert.ok(template);
  assert.equal(template?.defaultDesktopTransport, "vnc");
});

test("manager preserves a persisted seeded template launch source without an env pin", (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-template-source-preserve-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );

  store.update((draft) => {
    const template = draft.templates.find((entry) => entry.id === "tpl-0001");

    assert.ok(template);
    assert.ok(template.provenance);
    assert.ok(template.history);

    template.launchSource = "local:ubuntu-noble-desktop-20260320";
    template.provenance.summary = "Seeded from local:ubuntu-noble-desktop-20260320.";
    template.history[0] = {
      ...template.history[0],
      summary: "Seeded from local:ubuntu-noble-desktop-20260320.",
    };
    template.updatedAt = new Date().toISOString();
    return true;
  });

  const manager = new DesktopManager(store, provider);
  const template = manager.getSummary().templates.find((entry) => entry.id === "tpl-0001");

  assert.ok(template);
  assert.ok(template.provenance);
  assert.ok(template.history);
  assert.equal(template.launchSource, "local:ubuntu-noble-desktop-20260320");
  assert.equal(
    template.provenance.summary,
    "Seeded from local:ubuntu-noble-desktop-20260320.",
  );
  assert.equal(
    template.history[0]?.summary,
    "Seeded from local:ubuntu-noble-desktop-20260320.",
  );
});

test("manager hot read paths reuse cached provider state", (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-cached-read-state-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  const originalRefreshState = provider.refreshState.bind(provider);
  let refreshStateCalls = 0;

  provider.refreshState = () => {
    refreshStateCalls += 1;
    return originalRefreshState();
  };

  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);
  const callsAfterConstruction = refreshStateCalls;

  manager.getSummary();
  manager.getVmDetail("vm-0001");

  assert.equal(refreshStateCalls, callsAfterConstruction);
});

test("create can launch a new VM from a template snapshot", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-create-snapshot-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);

  const vm = manager.createVm({
    snapshotId: "snap-0001",
    name: "snapshot-seeded-lab",
    resources: {
      cpu: 8,
      ramMb: 16384,
      diskGb: 96,
    },
  });

  await wait(700);

  const detail = manager.getVmDetail(vm.id);
  assert.equal(detail.vm.status, "running");
  assert.equal(detail.vm.templateId, "tpl-0001");
  assert.match(detail.vm.lastAction, /snapshot/i);
  assert.ok(
    detail.recentJobs.some((job) => job.kind === "launch-snapshot" && job.status === "succeeded"),
  );
});

test("create can override template init commands for a single VM launch", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-create-init-override-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);

  const vm = manager.createVm({
    templateId: "tpl-0001",
    name: "init-override-lab",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    initCommands: [
      "sudo apt-get update",
      "sudo apt-get install -y ripgrep",
    ],
  });

  await wait(700);

  const detail = manager.getVmDetail(vm.id);
  assert.equal(detail.vm.status, "running");
  assert.ok(
    detail.vm.activityLog.some((line) =>
      /init: 2 first-boot commands completed/.test(line),
    ),
  );
  assert.deepEqual(
    manager.getSummary().templates.find((entry) => entry.id === "tpl-0001")?.initCommands,
    [],
  );
});

test("clone can stop the source VM first and keep requested resource overrides", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-clone-stop-first-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  const stopVm = provider.stopVm.bind(provider);
  const cloneVm = provider.cloneVm.bind(provider);
  const calls: string[] = [];

  provider.stopVm = async (vm) => {
    calls.push(`stop:${vm.id}`);
    return await stopVm(vm);
  };
  provider.cloneVm = async (sourceVm, targetVm, template) => {
    calls.push(`clone:${sourceVm.id}`);
    return await cloneVm(sourceVm, targetVm, template);
  };

  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);

  const clone = manager.cloneVm({
    sourceVmId: "vm-0001",
    name: "alpha-clean-copy",
    resources: {
      cpu: 10,
      ramMb: 24576,
      diskGb: 160,
    },
    networkMode: "dmz",
    shutdownSourceBeforeClone: true,
  });

  await wait(800);

  assert.deepEqual(calls, ["stop:vm-0001", "clone:vm-0001"]);
  assert.equal(manager.getVmDetail("vm-0001").vm.status, "stopped");

  const cloneDetail = manager.getVmDetail(clone.id);
  assert.equal(cloneDetail.vm.status, "running");
  assert.deepEqual(cloneDetail.vm.resources, {
    cpu: 10,
    ramMb: 24576,
    diskGb: 160,
  });
  assert.equal(cloneDetail.vm.networkMode, "dmz");
});

test("clone can request RAM from a running source", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-clone-with-ram-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  const cloneVm = provider.cloneVm.bind(provider);
  let requestedStateful = false;

  provider.cloneVm = async (sourceVm, targetVm, template, report, options) => {
    requestedStateful = options?.stateful === true;
    return await cloneVm(sourceVm, targetVm, template, report, options);
  };

  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);

  const clone = manager.cloneVm({
    sourceVmId: "vm-0001",
    name: "alpha-live-fork",
    stateful: true,
  });

  await wait(800);

  assert.equal(requestedStateful, true);
  assert.equal(manager.getVmDetail(clone.id).vm.status, "running");
});

test("clone with RAM rejects shutdown-before-clone", (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-clone-with-ram-invalid-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);

  assert.throws(
    () =>
      manager.cloneVm({
        sourceVmId: "vm-0001",
        name: "alpha-live-fork-invalid",
        shutdownSourceBeforeClone: true,
        stateful: true,
      }),
    /Clone with RAM requires the source VM to remain running/,
  );
});

test("manager marks a running VM stopped after the provider reports an external shutdown", (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-external-stop-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const instanceName = "parallaize-vm-0103-external-stop";
  const provider = createProvider("incus", "incus", {
    commandRunner: {
      execute(args: string[]) {
        if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
          return ok(
            JSON.stringify([
              {
                name: instanceName,
                status: "Stopped",
                state: {
                  status: "Stopped",
                },
              },
            ]),
            args,
          );
        }

        return ok("", args);
      },
    },
  });
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider, {
    forwardedServiceHostBase: "localhost",
  });
  const now = new Date().toISOString();

  store.update((draft) => {
    draft.vms.unshift({
      id: "vm-0103",
      name: "external-stop",
      templateId: "tpl-0001",
      provider: "incus",
      providerRef: instanceName,
      status: "running",
      resources: {
        cpu: 4,
        ramMb: 8192,
        diskGb: 60,
      },
      createdAt: now,
      updatedAt: now,
      liveSince: now,
      lastAction: "Running",
      snapshotIds: [],
      frameRevision: 1,
      screenSeed: 103,
      activeWindow: "terminal",
      workspacePath: "/root",
      session: {
        kind: "vnc",
        host: "10.55.0.103",
        port: 5900,
        webSocketPath: "/api/vms/vm-0103/vnc",
        browserPath: "/?vm=vm-0103",
        display: "10.55.0.103:5900",
      },
      forwardedPorts: [],
      activityLog: ["vnc: 10.55.0.103:5900"],
      commandHistory: [],
    });
  });

  assert.equal(store.load().vms[0]?.status, "running");

  manager.getProviderState();
  const detail = manager.getVmDetail("vm-0103");

  assert.equal(detail.vm.status, "stopped");
  assert.equal(detail.vm.liveSince, null);
  assert.equal(detail.vm.session, null);
  assert.equal(detail.vm.lastAction, "Workspace stopped");
  assert.match(
    detail.vm.activityLog.at(-1) ?? "",
    /detected .* stopped outside the dashboard/,
  );
});

test("manager marks a stopped VM running after the provider reports an external start", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-external-start-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const instanceName = "parallaize-vm-0104-external-start";
  const provider = createProvider("incus", "incus", {
    commandRunner: {
      execute(args: string[]) {
        if (
          args[0] === "list" &&
          ((args[1] === "--format" && args[2] === "json") || args[1] === instanceName)
        ) {
          return ok(
            JSON.stringify([
              {
                name: instanceName,
                status: "Running",
                state: {
                  status: "Running",
                  network: {
                    enp5s0: {
                      addresses: [
                        {
                          family: "inet",
                          scope: "global",
                          address: "10.55.0.104",
                        },
                      ],
                    },
                  },
                },
              },
            ]),
            args,
          );
        }

        return ok("", args);
      },
    },
    guestPortProbe: {
      async probe(host: string) {
        return host === "10.55.0.104";
      },
    },
  });
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider, {
    forwardedServiceHostBase: "localhost",
  });
  const now = new Date().toISOString();

  store.update((draft) => {
    draft.vms.unshift({
      id: "vm-0104",
      name: "external-start",
      templateId: "tpl-0001",
      provider: "incus",
      providerRef: instanceName,
      status: "stopped",
      resources: {
        cpu: 4,
        ramMb: 8192,
        diskGb: 60,
      },
      createdAt: now,
      updatedAt: now,
      liveSince: null,
      lastAction: "Workspace stopped",
      snapshotIds: [],
      frameRevision: 1,
      screenSeed: 104,
      activeWindow: "logs",
      workspacePath: "/root",
      session: null,
      forwardedPorts: [],
      activityLog: [],
      commandHistory: [],
    });
  });

  await wait(80);

  manager.getProviderState();
  const runningDetail = manager.getVmDetail("vm-0104");

  assert.equal(runningDetail.vm.status, "running");
  assert.equal(runningDetail.vm.lastAction, "Workspace resumed");
  assert.match(
    runningDetail.vm.activityLog.at(-1) ?? "",
    /detected .* running outside the dashboard/,
  );

  await wait(80);

  manager.getProviderState();
  const detail = manager.getVmDetail("vm-0104");

  assert.equal(detail.vm.session?.display, "10.55.0.104:5900");
  assert.equal(detail.vm.session?.webSocketPath, "/api/vms/vm-0104/vnc");
  assert.equal(detail.vm.session?.browserPath, "/?vm=vm-0104");
});

test("manager treats an already-running incus start as a successful resume", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-start-already-running-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const instanceName = "parallaize-vm-0104-already-running";
  const provider = createProvider("incus", "incus", {
    guestVncPort: 5901,
    commandRunner: {
      execute(args: string[]) {
        if (
          args[0] === "list" &&
          ((args[1] === "--format" && args[2] === "json") || args[1] === instanceName)
        ) {
          return ok(
            JSON.stringify([
              {
                name: instanceName,
                status: "Running",
                state: {
                  status: "Running",
                  network: {
                    enp5s0: {
                      addresses: [
                        {
                          family: "inet",
                          scope: "global",
                          address: "10.55.0.104",
                        },
                      ],
                    },
                  },
                },
              },
            ]),
            args,
          );
        }

        if (args[0] === "start" && args[1] === instanceName) {
          return {
            args,
            status: 1,
            stdout: "",
            stderr:
              `Error: The instance is already running ` +
              `Try \`incus info --show-log ${instanceName}\` for more info`,
          };
        }

        if (args[0] === "query" && args[1] === `/1.0/instances/${instanceName}`) {
          return expandedRootDevice(args);
        }

        return ok("", args);
      },
    },
    guestPortProbe: {
      async probe() {
        return true;
      },
    },
  });
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);
  const now = new Date().toISOString();

  store.update((draft) => {
    draft.vms.unshift({
      id: "vm-0104",
      name: "already-running",
      templateId: "tpl-0001",
      provider: "incus",
      providerRef: instanceName,
      status: "stopped",
      resources: {
        cpu: 2,
        ramMb: 4096,
        diskGb: 30,
      },
      createdAt: now,
      updatedAt: now,
      liveSince: null,
      lastAction: "Stopped",
      snapshotIds: [],
      frameRevision: 1,
      screenSeed: 104,
      activeWindow: "terminal",
      workspacePath: "/root",
      session: null,
      forwardedPorts: [],
      activityLog: [],
      commandHistory: [],
    });
  });

  manager.startVm("vm-0104");
  await wait(500);

  const detail = manager.getVmDetail("vm-0104");

  assert.equal(detail.vm.status, "running");
  assert.ok(detail.vm.liveSince);
  assert.equal(detail.vm.lastAction, "Workspace resumed");
  assert.equal(detail.vm.session?.display, "10.55.0.104:5901");
  assert.ok(
    detail.recentJobs.some(
      (job) =>
        job.kind === "start" &&
        job.status === "succeeded" &&
        (job.message === "already-running started" ||
          job.message === "already-running is already running"),
    ),
  );
});

test("incus provider reapplies the guest hostname on start", async () => {
  const calls: string[][] = [];
  const commandInputs = new Map<string[], string>();
  const instanceName = "parallaize-vm-0106-start-hostname";
  const runner = {
    execute(args: string[], options?: { input?: Buffer | string }) {
      calls.push(args);
      commandInputs.set(args, readCommandInput(options));

      if (
        args[0] === "list" &&
        ((args[1] === "--format" && args[2] === "json") || args[1] === instanceName)
      ) {
        return ok(
          JSON.stringify([
            {
              name: instanceName,
              status: "Running",
              state: {
                status: "Running",
                network: {
                  enp5s0: {
                    addresses: [
                      {
                        family: "inet",
                        scope: "global",
                        address: "10.55.0.106",
                      },
                    ],
                  },
                },
              },
            },
          ]),
          args,
        );
      }

      if (args[0] === "query" && args[1] === `/1.0/instances/${instanceName}`) {
        return expandedRootDevice(args);
      }

      return ok("", args);
    },
  };
  const provider = createProvider("incus", "incus", {
    commandRunner: runner,
    guestPortProbe: {
      async probe() {
        return true;
      },
    },
  });
  const vm: VmInstance = {
    id: "vm-0106",
    name: "restart-persistent-hostname",
    templateId: "tpl-0001",
    provider: "incus",
    providerRef: instanceName,
    status: "stopped",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: null,
    lastAction: "Workspace stopped",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 106,
    activeWindow: "terminal",
    workspacePath: "/root",
    session: null,
    forwardedPorts: [],
    activityLog: [],
    commandHistory: [],
  };

  const mutation = await provider.startVm(vm);

  assert.ok(mutation.activity.includes("guest-hostname: restart-persistent-hostname"));
  const hostnameSyncCall = calls.find(
    (args) =>
      args[0] === "exec" &&
      args[1] === instanceName &&
      args[2] === "--" &&
      args[3] === "sh" &&
      args[4] === "-s",
  );
  assert.ok(hostnameSyncCall);

  const hostnameSyncInput = commandInputs.get(hostnameSyncCall ?? []) ?? "";
  assert.match(hostnameSyncInput, /DESIRED_HOSTNAME="restart-persistent-hostname"/);
  assert.match(hostnameSyncInput, /parallaize-hostname-sync/);
  assert.match(hostnameSyncInput, /systemctl enable "\$HOSTNAME_SYNC_SERVICE_NAME"/);
});

test("restart runs as a single queued action that stops before booting again", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-restart-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);

  const vm = manager.createVm({
    templateId: "tpl-0001",
    name: "restart-lab",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
  });

  await wait(700);
  manager.restartVm(vm.id);
  await wait(50);

  const restartingDetail = manager.getVmDetail(vm.id);
  assert.equal(restartingDetail.vm.status, "stopped");
  assert.equal(restartingDetail.recentJobs[0]?.kind, "restart");
  assert.equal(restartingDetail.recentJobs[0]?.status, "running");
  assert.equal(restartingDetail.recentJobs[0]?.message, "Preparing boot");

  await wait(500);

  const detail = manager.getVmDetail(vm.id);
  assert.equal(detail.vm.status, "running");
  assert.equal(detail.vm.lastAction, "Workspace resumed");
  assert.ok(detail.recentJobs[0]);
  assert.equal(detail.recentJobs[0]?.kind, "restart");
  assert.equal(detail.recentJobs[0]?.status, "succeeded");
  assert.equal(detail.recentJobs[0]?.message, "restart-lab restarted");
  assert.ok(detail.vm.activityLog.includes("stop: VM state checkpoint saved"));
  assert.ok(detail.vm.activityLog.includes("resume: desktop compositor restarted"));
});

test("pause and resume keep VM status in sync and running snapshots capture RAM by default", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-pause-resume-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);

  manager.pauseVm("vm-0001");
  await wait(250);

  let detail = manager.getVmDetail("vm-0001");
  assert.equal(detail.vm.status, "paused");
  assert.equal(detail.vm.lastAction, "Workspace paused");
  assert.equal(detail.vm.liveSince, null);

  manager.startVm("vm-0001");
  await wait(550);

  detail = manager.getVmDetail("vm-0001");
  assert.equal(detail.vm.status, "running");
  assert.equal(detail.vm.lastAction, "Workspace resumed");

  manager.snapshotVm("vm-0001", { label: "warm-checkpoint" });
  await wait(550);

  const warmSnapshot = manager
    .getVmDetail("vm-0001")
    .snapshots.find((entry) => entry.label === "warm-checkpoint");
  assert.equal(warmSnapshot?.stateful, true);

  manager.stopVm("vm-0001");
  await wait(300);
  manager.snapshotVm("vm-0001", { label: "cold-checkpoint" });
  await wait(550);

  const coldSnapshot = manager
    .getVmDetail("vm-0001")
    .snapshots.find((entry) => entry.label === "cold-checkpoint");
  assert.equal(coldSnapshot?.stateful, false);
});

test("template capture jobs expose staged publish progress", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-capture-progress-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  const originalCaptureTemplate = provider.captureTemplate.bind(provider);
  provider.captureTemplate = async (vm, target, report) => {
    report?.("Publishing template image (uncompressed export in progress, 1s elapsed)", 62);
    await wait(80);
    report?.("Publishing template image (uncompressed export in progress, 2s elapsed)", 66);
    await wait(80);
    return originalCaptureTemplate(vm, target, report);
  };

  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);

  manager.captureTemplate("vm-0001", {
    name: "Progress Capture",
    description: "Verifies capture progress reporting",
  });

  await wait(260);

  const job = manager.getVmDetail("vm-0001").recentJobs[0];
  assert.ok(job);
  assert.equal(job?.kind, "capture-template");
  assert.equal(job?.status, "running");
  assert.match(job?.message ?? "", /Publishing template image/);
  assert.ok((job?.progressPercent ?? 0) > 14);
  assert.ok((job?.progressPercent ?? 100) < 100);

  await wait(250);

  assert.ok(
    manager
      .getSummary()
      .jobs.some((entry) => entry.kind === "capture-template" && entry.status === "succeeded"),
  );
});

test("templates can be updated and deleted when no VM still uses them", (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-template-actions-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);
  const now = new Date().toISOString();

  store.update((draft) => {
    draft.templates.unshift({
      id: "tpl-unused",
      name: "Unused Template",
      description: "Free to rename or delete.",
      launchSource: "mock://templates/unused-template",
      defaultResources: {
        cpu: 2,
        ramMb: 4096,
        diskGb: 40,
      },
      defaultForwardedPorts: [],
      initCommands: [],
      tags: [],
      notes: [],
      snapshotIds: [],
      createdAt: now,
      updatedAt: now,
    });
  });

  const updated = manager.updateTemplate("tpl-unused", {
    name: "Operator Base",
    description: "Renamed from the inspector menu.",
    initCommands: ["sudo apt-get update", "sudo apt-get install -y ripgrep"],
  });

  assert.equal(updated.name, "Operator Base");
  assert.equal(updated.description, "Renamed from the inspector menu.");
  assert.deepEqual(updated.initCommands, [
    "sudo apt-get update",
    "sudo apt-get install -y ripgrep",
  ]);
  assert.equal(updated.history?.[0]?.kind, "updated");
  assert.match(updated.history?.[0]?.summary ?? "", /Updated name, description, init commands/);
  assert.equal(
    manager.getSummary().templates.find((entry) => entry.id === "tpl-unused")?.name,
    "Operator Base",
  );

  manager.deleteTemplate("tpl-unused");
  assert.equal(
    manager.getSummary().templates.some((entry) => entry.id === "tpl-unused"),
    false,
  );

  assert.throws(
    () => manager.deleteTemplate("tpl-0001"),
    /Template Ubuntu Agent Forge is still attached to VM alpha-workbench\./,
  );
});

test("templates can be cloned into new defaults with first-boot init commands", (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-template-clone-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);

  const cloned = manager.createTemplate({
    sourceTemplateId: "tpl-0001",
    name: "Ubuntu Agent Forge Node",
    description: "Seeded Ubuntu desktop with Node and pnpm on first boot.",
    initCommands: [
      "sudo apt-get update",
      "sudo apt-get install -y nodejs npm",
      "sudo npm install -g pnpm",
    ],
  });

  const source = manager.getSummary().templates.find((entry) => entry.id === "tpl-0001");
  assert.ok(source);
  assert.equal(cloned.name, "Ubuntu Agent Forge Node");
  assert.equal(cloned.launchSource, source?.launchSource);
  assert.deepEqual(cloned.defaultResources, source?.defaultResources);
  assert.deepEqual(cloned.defaultForwardedPorts, source?.defaultForwardedPorts);
  assert.deepEqual(cloned.initCommands, [
    "sudo apt-get update",
    "sudo apt-get install -y nodejs npm",
    "sudo npm install -g pnpm",
  ]);
  assert.equal(cloned.snapshotIds.length, 0);
  assert.match(cloned.notes[0] ?? "", /Cloned from template Ubuntu Agent Forge/);
  assert.match(cloned.notes[1] ?? "", /First-boot init script runs 3 commands/);
  assert.equal(cloned.provenance?.kind, "cloned");
  assert.equal(cloned.provenance?.sourceTemplateId, "tpl-0001");
  assert.match(cloned.provenance?.summary ?? "", /Cloned from template Ubuntu Agent Forge/);
  assert.equal(cloned.history?.[0]?.kind, "cloned");
  assert.match(cloned.history?.[0]?.summary ?? "", /with 3 first-boot init commands/);
});

test("captured templates reject create requests that undersize the source disk", (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-create-disk-guard-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);
  const now = new Date().toISOString();

  store.update((draft) => {
    draft.templates.unshift({
      id: "tpl-captured-100g",
      name: "Captured 100G Template",
      description: "Captured from a 100 GB workspace.",
      launchSource: "parallaize-template-tpl-captured-100g",
      defaultResources: {
        cpu: 8,
        ramMb: 16384,
        diskGb: 100,
      },
      defaultForwardedPorts: [],
      initCommands: [],
      tags: ["captured"],
      notes: [],
      snapshotIds: [],
      createdAt: now,
      updatedAt: now,
    });
  });

  assert.throws(
    () =>
      manager.createVm({
        templateId: "tpl-captured-100g",
        name: "too-small-disk",
        resources: {
          cpu: 4,
          ramMb: 8192,
          diskGb: 50,
        },
      }),
    /requires at least 100 GB disk/,
  );
});

test("manager falls back to the newest compatible template snapshot when a captured image alias is missing", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-template-alias-recovery-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  let createCalls = 0;
  let snapshotLaunchCalls = 0;
  let recoveredSnapshotId: string | null = null;

  const providerState = {
    kind: "incus" as const,
    available: true,
    detail: "Incus is reachable.",
    hostStatus: "ready" as const,
    binaryPath: "incus",
    project: null,
    desktopTransport: "novnc" as const,
    nextSteps: [],
  };
  const provider: DesktopProvider = {
    state: providerState,
    refreshState() {
      return this.state;
    },
    sampleHostTelemetry() {
      return null;
    },
    sampleVmTelemetry() {
      return null;
    },
    observeVmPowerState() {
      return null;
    },
    async refreshVmSession() {
      return null;
    },
    async createVm(vm, template) {
      createCalls += 1;
      throw new Error(
        `incus init ${template.launchSource} ${vm.providerRef} --vm failed: Error: Image "${template.launchSource}" not found`,
      );
    },
    async cloneVm() {
      throw new Error("not implemented");
    },
    async startVm() {
      throw new Error("not implemented");
    },
    async pauseVm() {
      throw new Error("not implemented");
    },
    async stopVm() {
      throw new Error("not implemented");
    },
    async deleteVm() {
      throw new Error("not implemented");
    },
    async syncVmHostname() {
      return null;
    },
    async deleteVmSnapshot() {
      throw new Error("not implemented");
    },
    async resizeVm() {
      throw new Error("not implemented");
    },
    async setNetworkMode() {
      throw new Error("not implemented");
    },
    async setDisplayResolution() {
      throw new Error("not implemented");
    },
    async snapshotVm() {
      throw new Error("not implemented");
    },
    async launchVmFromSnapshot(snapshot, targetVm) {
      snapshotLaunchCalls += 1;
      recoveredSnapshotId = snapshot.id;

      return {
        lastAction: `Launched from snapshot ${snapshot.label}`,
        activity: [`incus: launched ${targetVm.providerRef} from ${snapshot.providerRef}`],
        activeWindow: "terminal",
        workspacePath: "/root",
        session: null,
      };
    },
    async restoreVmToSnapshot() {
      throw new Error("not implemented");
    },
    async captureTemplate() {
      throw new Error("not implemented");
    },
    async injectCommand() {
      throw new Error("not implemented");
    },
    async readVmLogs() {
      throw new Error("not implemented");
    },
    async browseVmFiles() {
      throw new Error("not implemented");
    },
    async readVmFile() {
      throw new Error("not implemented");
    },
    async readVmTouchedFiles() {
      throw new Error("not implemented");
    },
    tickVm() {
      return null;
    },
    renderFrame() {
      return "";
    },
  };
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);
  const now = new Date();

  store.update((draft) => {
    const template = draft.templates.find((entry) => entry.id === "tpl-0001");

    if (!template) {
      throw new Error("Seed template tpl-0001 was not found.");
    }

    template.launchSource = "parallaize-template-tpl-0001";
    template.snapshotIds = ["snap-0900", "snap-0901"];
    draft.snapshots.push(
      {
        id: "snap-0900",
        vmId: "vm-source-older",
        templateId: template.id,
        label: "compatible recovery point",
        summary: "Newest snapshot that still fits the requested disk size.",
        providerRef: "parallaize-vm-old/parallaize-snap-old",
        stateful: false,
        resources: { ...template.defaultResources },
        createdAt: new Date(now.getTime() - 60_000).toISOString(),
      },
      {
        id: "snap-0901",
        vmId: "vm-source-newer",
        templateId: template.id,
        label: "oversized recovery point",
        summary: "Newest captured snapshot, but it needs a larger disk.",
        providerRef: "parallaize-vm-new/parallaize-snap-new",
        stateful: false,
        resources: {
          ...template.defaultResources,
          diskGb: 100,
        },
        createdAt: now.toISOString(),
      },
    );

    return true;
  });

  const vm = manager.createVm({
    templateId: "tpl-0001",
    name: "alias-recovery",
    resources: {
      cpu: 6,
      ramMb: 12288,
      diskGb: 80,
    },
  });

  await wait(50);

  const detail = manager.getVmDetail(vm.id);
  assert.equal(createCalls, 1);
  assert.equal(snapshotLaunchCalls, 1);
  assert.equal(recoveredSnapshotId, "snap-0900");
  assert.equal(detail.vm.status, "running");
  assert.equal(detail.vm.lastAction, "Launched from snapshot compatible recovery point");
  assert.ok(
    detail.vm.activityLog.some((entry) =>
      entry.includes("template image missing: recovered from snapshot compatible recovery point"),
    ),
  );
  assert.equal(detail.recentJobs[0]?.status, "succeeded");
});

test("vms can be renamed without changing their provider identity", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-rename-vm-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);
  const originalProviderRef = manager.getVmDetail("vm-0001").vm.providerRef;

  const updated = await manager.updateVm("vm-0001", {
    name: "alpha-renamed",
  });

  assert.equal(updated.name, "alpha-renamed");
  assert.equal(updated.providerRef, originalProviderRef);
  assert.equal(manager.getVmDetail("vm-0001").vm.name, "alpha-renamed");
  assert.equal(
    manager.getVmDetail("vm-0001").vm.lastAction,
    "Renamed workspace to alpha-renamed",
  );
});

test("renaming a running incus vm syncs the guest hostname without changing provider identity", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-rename-running-incus-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const calls: string[][] = [];
  const commandInputs = new Map<string[], string>();
  const instanceName = "parallaize-vm-0105-running-rename";
  const provider = createProvider("incus", "incus", {
    commandRunner: {
      execute(args: string[], options?: { input?: Buffer | string }) {
        calls.push(args);
        commandInputs.set(args, readCommandInput(options));

        if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
          return ok("[]", args);
        }

        return ok("", args);
      },
    },
  });
  const seed = createSeedState(provider.state);
  const now = new Date().toISOString();
  const state: AppState = {
    ...seed,
    vms: [
      {
        id: "vm-0105",
        name: "rename-source",
        templateId: "tpl-0001",
        provider: "incus",
        providerRef: instanceName,
        status: "running",
        resources: {
          cpu: 4,
          ramMb: 8192,
          diskGb: 60,
        },
        createdAt: now,
        updatedAt: now,
        liveSince: now,
        lastAction: "Workspace resumed",
        snapshotIds: [],
        frameRevision: 1,
        screenSeed: 105,
        activeWindow: "terminal",
        workspacePath: "/root",
        session: {
          kind: "vnc",
          host: "10.55.0.105",
          port: 5900,
          webSocketPath: "/api/vms/vm-0105/vnc",
          browserPath: "/?vm=vm-0105",
          display: "10.55.0.105:5900",
        },
        forwardedPorts: [],
        activityLog: [],
        commandHistory: [],
      },
    ],
  };
  const store = new JsonStateStore(join(tempDir, "state.json"), () => state);
  const manager = new DesktopManager(store, provider);

  const updated = await manager.updateVm("vm-0105", {
    name: "direct-hostname-lab",
  });

  assert.equal(updated.name, "direct-hostname-lab");
  assert.equal(updated.providerRef, instanceName);
  assert.ok(updated.activityLog.includes("guest-hostname: direct-hostname-lab"));

  const hostnameSyncCall = calls.find(
    (args) =>
      args[0] === "exec" &&
      args[1] === instanceName &&
      args[2] === "--" &&
      args[3] === "sh" &&
      args[4] === "-s",
  );
  assert.ok(hostnameSyncCall);

  const hostnameSyncInput = commandInputs.get(hostnameSyncCall ?? []) ?? "";
  assert.match(hostnameSyncInput, /DESIRED_HOSTNAME="direct-hostname-lab"/);
  assert.match(hostnameSyncInput, /hostnamectl set-hostname "\$DESIRED_HOSTNAME"/);
  assert.match(hostnameSyncInput, /desired-hostname/);
  assert.doesNotMatch(hostnameSyncInput, /parallaize-vm-0105-running-rename/);
});

test("stopped incus vms can switch desktop transport without repairing immediately", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-switch-stopped-transport-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("incus", "incus", {
    commandRunner: {
      execute(args: string[]) {
        if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
          return ok("[]", args);
        }

        return ok("", args);
      },
    },
  });
  let repairCalls = 0;
  provider.repairVmDesktopBridge = async () => {
    repairCalls += 1;
    return {
      lastAction: "Desktop bridge repaired",
      activity: ["desktop-bridge: repaired"],
    };
  };

  const seed = createSeedState(provider.state);
  const now = new Date().toISOString();
  const state: AppState = {
    ...seed,
    vms: [
      {
        id: "vm-0106",
        name: "transport-source",
        templateId: "tpl-0001",
        provider: "incus",
        providerRef: "parallaize-vm-0106-transport-source",
        status: "stopped",
        resources: {
          cpu: 4,
          ramMb: 8192,
          diskGb: 60,
        },
        createdAt: now,
        updatedAt: now,
        liveSince: null,
        lastAction: "Workspace stopped",
        snapshotIds: [],
        frameRevision: 1,
        screenSeed: 106,
        activeWindow: "logs",
        workspacePath: "/root",
        desktopTransport: "vnc",
        networkMode: "default",
        session: null,
        forwardedPorts: [],
        activityLog: [],
        commandHistory: [],
      },
    ],
    snapshots: [],
    jobs: [],
    adminSessions: [],
    lastUpdated: now,
  };
  const store = new JsonStateStore(join(tempDir, "state.json"), () => state);
  const manager = new DesktopManager(store, provider);

  const updated = await manager.updateVm("vm-0106", {
    desktopTransport: "selkies",
  });

  assert.equal(updated.desktopTransport, "selkies");
  assert.equal(updated.lastAction, "Desktop transport set to Selkies");
  assert.equal(updated.frameRevision, 1);
  assert.equal(repairCalls, 0);
  assert.ok(updated.activityLog.includes("desktop-transport: vnc -> selkies"));
});

test("running incus vms switch desktop transport by repairing the bridge in place", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-switch-running-transport-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("incus", "incus", {
    commandRunner: {
      execute(args: string[]) {
        if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
          return ok("[]", args);
        }

        return ok("", args);
      },
    },
  });
  const repairCalls: Array<{ name: string; transport: string | undefined }> = [];
  provider.repairVmDesktopBridge = async (vm) => {
    repairCalls.push({
      name: vm.name,
      transport: vm.desktopTransport,
    });

    return {
      lastAction: "Desktop bridge repaired",
      activity: ["desktop-bridge: reconciled selkies runtime"],
      session: {
        kind: "selkies",
        host: "10.55.0.107",
        port: 6080,
        webSocketPath: null,
        browserPath: "/?vm=vm-0107",
        display: "10.55.0.107:6080",
      },
      desktopReadyAt: new Date().toISOString(),
      desktopReadyMs: 320,
    };
  };

  const seed = createSeedState(provider.state);
  const now = new Date().toISOString();
  const state: AppState = {
    ...seed,
    vms: [
      {
        id: "vm-0107",
        name: "transport-running",
        templateId: "tpl-0001",
        provider: "incus",
        providerRef: "parallaize-vm-0107-transport-running",
        status: "running",
        resources: {
          cpu: 4,
          ramMb: 8192,
          diskGb: 60,
        },
        createdAt: now,
        updatedAt: now,
        liveSince: now,
        lastAction: "Workspace resumed",
        snapshotIds: [],
        frameRevision: 1,
        screenSeed: 107,
        activeWindow: "terminal",
        workspacePath: "/root",
        desktopTransport: "vnc",
        networkMode: "default",
        session: {
          kind: "vnc",
          host: "10.55.0.107",
          port: 5900,
          webSocketPath: "/api/vms/vm-0107/vnc",
          browserPath: "/?vm=vm-0107",
          display: "10.55.0.107:5900",
        },
        forwardedPorts: [],
        activityLog: [],
        commandHistory: [],
      },
    ],
    snapshots: [],
    jobs: [],
    adminSessions: [],
    lastUpdated: now,
  };
  const store = new JsonStateStore(join(tempDir, "state.json"), () => state);
  const manager = new DesktopManager(store, provider);

  const updated = await manager.updateVm("vm-0107", {
    desktopTransport: "selkies",
  });

  assert.deepEqual(repairCalls, [
    {
      name: "transport-running",
      transport: "selkies",
    },
  ]);
  assert.equal(updated.desktopTransport, "selkies");
  assert.equal(updated.lastAction, "Desktop transport switched to Selkies");
  assert.equal(updated.frameRevision, 2);
  assert.equal(updated.session?.kind, "selkies");
  assert.equal(updated.session?.browserPath, "/?vm=vm-0107");
  assert.ok(updated.activityLog.includes("desktop-transport: vnc -> selkies"));
  assert.ok(updated.activityLog.includes("desktop-bridge: reconciled selkies runtime"));
});

test("running incus vms switch between VNC and Guacamole without replacing the guest bridge", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-switch-running-guacamole-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("incus", "incus", {
    commandRunner: {
      execute(args: string[]) {
        if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
          return ok("[]", args);
        }

        return ok("", args);
      },
    },
  });
  let repairCalls = 0;
  provider.repairVmDesktopBridge = async () => {
    repairCalls += 1;
    return {
      lastAction: "Desktop bridge repaired",
      activity: ["desktop-bridge: repaired"],
    };
  };

  const seed = createSeedState(provider.state);
  const now = new Date().toISOString();
  const state: AppState = {
    ...seed,
    vms: [
      {
        id: "vm-0107",
        name: "transport-running",
        templateId: "tpl-0001",
        provider: "incus",
        providerRef: "parallaize-vm-0107-transport-running",
        status: "running",
        resources: {
          cpu: 4,
          ramMb: 8192,
          diskGb: 60,
        },
        createdAt: now,
        updatedAt: now,
        liveSince: now,
        lastAction: "Workspace resumed",
        snapshotIds: [],
        frameRevision: 1,
        screenSeed: 107,
        activeWindow: "terminal",
        workspacePath: "/root",
        desktopTransport: "vnc",
        networkMode: "default",
        session: {
          kind: "vnc",
          host: "10.55.0.107",
          port: 5900,
          webSocketPath: "/api/vms/vm-0107/vnc",
          browserPath: "/?vm=vm-0107",
          display: "10.55.0.107:5900",
        },
        forwardedPorts: [],
        activityLog: [],
        commandHistory: [],
      },
    ],
    snapshots: [],
    jobs: [],
    adminSessions: [],
    lastUpdated: now,
  };
  const store = new JsonStateStore(join(tempDir, "state.json"), () => state);
  const manager = new DesktopManager(store, provider);

  const updated = await manager.updateVm("vm-0107", {
    desktopTransport: "guacamole",
  });

  assert.equal(repairCalls, 0);
  assert.equal(updated.desktopTransport, "guacamole");
  assert.equal(updated.lastAction, "Desktop transport set to Guacamole");
  assert.equal(updated.frameRevision, 1);
  assert.equal(updated.session?.kind, "guacamole");
  assert.equal(updated.session?.webSocketPath, "/api/vms/vm-0107/guacamole");
  assert.equal(updated.session?.browserPath, "/?vm=vm-0107");
  assert.ok(updated.activityLog.includes("desktop-transport: vnc -> guacamole"));
});

test("stale in-flight session refreshes do not overwrite a later VNC to Guacamole switch", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-switch-running-guacamole-refresh-race-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  let signalRefreshStarted = (): void => {};
  const refreshStarted = new Promise<void>((resolve) => {
    signalRefreshStarted = resolve as () => void;
  });
  let releaseRefreshNow = (): void => {};
  const releaseRefresh = new Promise<void>((resolve) => {
    releaseRefreshNow = resolve as () => void;
  });

  const provider = createProvider("incus", "incus", {
    commandRunner: {
      execute(args: string[]) {
        if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
          return ok("[]", args);
        }

        return ok("", args);
      },
    },
  });
  provider.refreshVmSession = async (vm) => {
    if (vm.id !== "vm-0108") {
      return null;
    }

    signalRefreshStarted();
    await releaseRefresh;
    return {
      kind: "vnc",
      host: "10.55.0.108",
      port: 5900,
      webSocketPath: "/api/vms/vm-0108/vnc",
      browserPath: "/?vm=vm-0108",
      display: "10.55.0.108:5900",
    };
  };

  const seed = createSeedState(provider.state);
  const now = new Date().toISOString();
  const state: AppState = {
    ...seed,
    vms: [
      {
        id: "vm-0108",
        name: "transport-race",
        templateId: "tpl-0001",
        provider: "incus",
        providerRef: "parallaize-vm-0108-transport-race",
        status: "running",
        resources: {
          cpu: 4,
          ramMb: 8192,
          diskGb: 60,
        },
        createdAt: now,
        updatedAt: now,
        liveSince: now,
        lastAction: "Workspace resumed",
        snapshotIds: [],
        frameRevision: 1,
        screenSeed: 108,
        activeWindow: "terminal",
        workspacePath: "/root",
        desktopTransport: "vnc",
        networkMode: "default",
        session: {
          kind: "vnc",
          host: "10.55.0.108",
          port: 5900,
          webSocketPath: "/api/vms/vm-0108/vnc",
          browserPath: "/?vm=vm-0108",
          display: "10.55.0.108:5900",
        },
        forwardedPorts: [],
        activityLog: [],
        commandHistory: [],
      },
    ],
    snapshots: [],
    jobs: [],
    adminSessions: [],
    lastUpdated: now,
  };
  const store = new JsonStateStore(join(tempDir, "state.json"), () => state);
  const manager = new DesktopManager(store, provider);

  await refreshStarted;

  const updated = await manager.updateVm("vm-0108", {
    desktopTransport: "guacamole",
  });

  releaseRefreshNow();
  await wait(20);

  const detail = manager.getVmDetail("vm-0108").vm;
  assert.equal(updated.desktopTransport, "guacamole");
  assert.equal(updated.session?.kind, "guacamole");
  assert.equal(updated.session?.webSocketPath, "/api/vms/vm-0108/guacamole");
  assert.equal(detail.desktopTransport, "guacamole");
  assert.equal(detail.session?.kind, "guacamole");
  assert.equal(detail.session?.webSocketPath, "/api/vms/vm-0108/guacamole");
});

test("running incus transport switches clear stale desktop sessions until the replacement is ready", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-switch-running-transport-clear-session-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("incus", "incus", {
    commandRunner: {
      execute(args: string[]) {
        if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
          return ok("[]", args);
        }

        return ok("", args);
      },
    },
  });
  provider.repairVmDesktopBridge = async () => ({
    lastAction: "Desktop bridge repair pending",
    activity: ["desktop-bridge: waiting for vnc listener"],
  });

  const seed = createSeedState(provider.state);
  const now = new Date().toISOString();
  const state: AppState = {
    ...seed,
    vms: [
      {
        id: "vm-0108",
        name: "transport-waiting",
        templateId: "tpl-0001",
        provider: "incus",
        providerRef: "parallaize-vm-0108-transport-waiting",
        status: "running",
        resources: {
          cpu: 4,
          ramMb: 8192,
          diskGb: 60,
        },
        createdAt: now,
        updatedAt: now,
        liveSince: now,
        lastAction: "Workspace resumed",
        snapshotIds: [],
        frameRevision: 1,
        screenSeed: 108,
        activeWindow: "browser",
        workspacePath: "/root",
        desktopTransport: "selkies",
        networkMode: "default",
        session: {
          kind: "selkies",
          host: "10.55.0.108",
          port: 6080,
          webSocketPath: null,
          browserPath: "/selkies-vm-0108/",
          display: "10.55.0.108:6080",
        },
        desktopReadyAt: now,
        desktopReadyMs: 180,
        forwardedPorts: [],
        activityLog: [],
        commandHistory: [],
      },
    ],
    snapshots: [],
    jobs: [],
    adminSessions: [],
    lastUpdated: now,
  };
  const store = new JsonStateStore(join(tempDir, "state.json"), () => state);
  const manager = new DesktopManager(store, provider);

  const updated = await manager.updateVm("vm-0108", {
    desktopTransport: "vnc",
  });

  assert.equal(updated.desktopTransport, "vnc");
  assert.equal(updated.lastAction, "Desktop transport switched to VNC");
  assert.equal(updated.frameRevision, 2);
  assert.equal(updated.session, null);
  assert.equal(updated.desktopReadyAt, null);
  assert.equal(updated.desktopReadyMs, null);
  assert.ok(updated.activityLog.includes("desktop-transport: selkies -> vnc"));
  assert.ok(updated.activityLog.includes("desktop-bridge: waiting for vnc listener"));
});

test("running incus vms can restart the desktop service in place", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-restart-desktop-service-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("incus", "incus", {
    commandRunner: {
      execute(args: string[]) {
        if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
          return ok("[]", args);
        }

        return ok("", args);
      },
    },
  });
  const restartCalls: Array<{ name: string; transport: string | undefined }> = [];
  provider.restartVmDesktopService = async (vm) => {
    restartCalls.push({
      name: vm.name,
      transport: vm.desktopTransport,
    });

    return {
      lastAction: "Selkies service restarted",
      activity: ["desktop-service: restarted parallaize-selkies.service"],
      session: {
        kind: "selkies",
        host: "10.55.0.109",
        port: 6080,
        webSocketPath: null,
        browserPath: "/selkies-vm-0109/",
        display: "10.55.0.109:6080",
      },
      desktopReadyAt: new Date().toISOString(),
      desktopReadyMs: 240,
    };
  };

  const seed = createSeedState(provider.state);
  const now = new Date().toISOString();
  const state: AppState = {
    ...seed,
    vms: [
      {
        id: "vm-0109",
        name: "selkies-restart",
        templateId: "tpl-0001",
        provider: "incus",
        providerRef: "parallaize-vm-0109-selkies-restart",
        status: "running",
        resources: {
          cpu: 4,
          ramMb: 8192,
          diskGb: 60,
        },
        createdAt: now,
        updatedAt: now,
        liveSince: now,
        lastAction: "Workspace resumed",
        snapshotIds: [],
        frameRevision: 1,
        screenSeed: 109,
        activeWindow: "browser",
        workspacePath: "/root",
        desktopTransport: "selkies",
        networkMode: "default",
        session: null,
        forwardedPorts: [],
        activityLog: [],
        commandHistory: [],
      },
    ],
    snapshots: [],
    jobs: [],
    adminSessions: [],
    lastUpdated: now,
  };
  const store = new JsonStateStore(join(tempDir, "state.json"), () => state);
  const manager = new DesktopManager(store, provider);

  const updated = await manager.restartVmDesktopService("vm-0109");

  assert.deepEqual(restartCalls, [
    {
      name: "selkies-restart",
      transport: "selkies",
    },
  ]);
  assert.equal(updated.vm.lastAction, "Selkies service restarted");
  assert.equal(updated.vm.frameRevision, 2);
  assert.equal(updated.vm.session?.kind, "selkies");
  assert.equal(updated.vm.session?.browserPath, "/selkies-vm-0109/");
  assert.ok(updated.vm.activityLog.includes("desktop-service: restarted parallaize-selkies.service"));
});

test("vms can be reordered and the new order is reflected in summary output", (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-reorder-vms-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);
  const initialVmIds = manager.getSummary().vms.map((vm) => vm.id);
  const reorderedVmIds = initialVmIds.slice().reverse();

  const reorderedSummary = manager.reorderVms({
    vmIds: reorderedVmIds,
  });

  assert.deepEqual(
    reorderedSummary.vms.map((vm) => vm.id),
    reorderedVmIds,
  );
});

test("command output is retained and snapshots can launch or restore VMs", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-command-history-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);

  manager.injectCommand("vm-0001", "pwd");
  await wait(300);

  const commandDetail = manager.getVmDetail("vm-0001");
  assert.equal(commandDetail.vm.commandHistory?.length, 1);
  assert.equal(commandDetail.vm.commandHistory?.[0]?.command, "pwd");
  assert.equal(
    commandDetail.vm.commandHistory?.[0]?.output[0],
    "/srv/workspaces/alpha-workbench",
  );

  manager.snapshotVm("vm-0001", { label: "checkpoint" });
  await wait(550);

  const snapshot = manager.getVmDetail("vm-0001").snapshots[0];
  assert.ok(snapshot);

  const launchedVm = manager.launchVmFromSnapshot("vm-0001", snapshot!.id, {
    sourceVmId: "vm-0001",
    name: "alpha-from-checkpoint",
  });
  await wait(700);

  const launchedDetail = manager.getVmDetail(launchedVm.id);
  assert.equal(launchedDetail.vm.status, "running");
  assert.match(launchedDetail.vm.lastAction, /Launched from snapshot checkpoint/);
  assert.ok(
    manager
      .getSummary()
      .jobs.some((job) => job.kind === "launch-snapshot" && job.status === "succeeded"),
  );

  manager.restoreVmSnapshot("vm-0001", snapshot!.id);
  await wait(450);

  const restoredDetail = manager.getVmDetail("vm-0001");
  assert.match(restoredDetail.vm.lastAction, /Restored alpha-workbench to checkpoint/);
  assert.ok(
    restoredDetail.recentJobs.some(
      (job) => job.kind === "restore-snapshot" && job.status === "succeeded",
    ),
  );
  const snapshotCountBeforeDelete = restoredDetail.snapshots.length;

  manager.deleteVmSnapshot("vm-0001", snapshot!.id);
  await wait(700);

  const afterDeleteDetail = manager.getVmDetail("vm-0001");
  assert.equal(afterDeleteDetail.snapshots.length, snapshotCountBeforeDelete - 1);
  assert.equal(afterDeleteDetail.snapshots.some((entry) => entry.id === snapshot!.id), false);
  assert.ok(afterDeleteDetail.vm.snapshotIds.every((entry) => entry !== snapshot!.id));
  assert.ok(
    afterDeleteDetail.recentJobs.some(
      (job) => job.kind === "delete" && job.status === "succeeded",
    ),
  );
  assert.match(afterDeleteDetail.vm.lastAction, /Snapshot deleted: checkpoint/);
  assert.equal(
    manager.getSummary().snapshots.some((entry) => entry.id === snapshot!.id),
    false,
  );
  assert.equal(
    afterDeleteDetail.template?.snapshotIds.some((entry) => entry === snapshot!.id),
    false,
  );
});

test("workspace file browsing starts at home, can reach root, and touched files include command-history hints", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-workspace-browser-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);

  manager.injectCommand("vm-0001", "pwd");
  await wait(300);

  const rootSnapshot = await manager.browseVmFiles("vm-0001");
  assert.equal(rootSnapshot.workspacePath, "/srv/workspaces/alpha-workbench");
  assert.equal(rootSnapshot.homePath, "/home/ubuntu");
  assert.equal(rootSnapshot.currentPath, "/home/ubuntu");
  assert.equal(rootSnapshot.parentPath, "/home");
  assert.ok(rootSnapshot.entries.some((entry) => entry.name === "Desktop" && entry.kind === "directory"));

  const childSnapshot = await manager.browseVmFiles(
    "vm-0001",
    "/srv/workspaces/alpha-workbench/src",
  );
  assert.equal(childSnapshot.parentPath, "/srv/workspaces/alpha-workbench");
  assert.ok(childSnapshot.entries.some((entry) => entry.name === "DashboardApp.tsx"));

  const systemSnapshot = await manager.browseVmFiles("vm-0001", "/etc");
  assert.equal(systemSnapshot.currentPath, "/etc");
  assert.equal(systemSnapshot.parentPath, "/");
  assert.ok(systemSnapshot.entries.some((entry) => entry.name === "hosts"));

  const fsRootSnapshot = await manager.browseVmFiles("vm-0001", "/");
  assert.equal(fsRootSnapshot.currentPath, "/");
  assert.equal(fsRootSnapshot.parentPath, null);
  assert.ok(fsRootSnapshot.entries.some((entry) => entry.name === "home" && entry.kind === "directory"));

  const downloadedFile = await manager.readVmFile(
    "vm-0001",
    "/srv/workspaces/alpha-workbench/README.md",
  );
  assert.equal(downloadedFile.name, "README.md");
  assert.match(downloadedFile.content.toString("utf8"), /Mock workspace/);

  const touchedSnapshot = await manager.getVmTouchedFiles("vm-0001");
  assert.match(touchedSnapshot.baselineLabel, /Best effort/);
  assert.ok(
    touchedSnapshot.entries.some((entry) => entry.reasons.includes("command-history")),
  );
});

test("failed snapshot launches leave the placeholder VM in an error state", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-snapshot-launch-error-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);

  manager.snapshotVm("vm-0001", { label: "checkpoint" });
  await wait(550);

  const snapshot = manager.getVmDetail("vm-0001").snapshots[0];
  assert.ok(snapshot);

  provider.launchVmFromSnapshot = async () => {
    throw new Error("snapshot copy failed");
  };

  const launchedVm = manager.launchVmFromSnapshot("vm-0001", snapshot!.id, {
    sourceVmId: "vm-0001",
    name: "broken-from-snapshot",
  });

  await wait(500);

  const detail = manager.getVmDetail(launchedVm.id);
  assert.equal(detail.vm.status, "error");
  assert.equal(detail.vm.lastAction, "snapshot copy failed");
  assert.ok(detail.vm.activityLog.some((entry) => entry === "error: snapshot copy failed"));
  assert.ok(
    detail.recentJobs.some(
      (job) => job.kind === "launch-snapshot" && job.status === "failed",
    ),
  );
});

test("failed desktop attach keeps the VM running when the provider still sees it booted", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-desktop-attach-error-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("incus", "incus", {
    commandRunner: {
      execute(args: string[]) {
        if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
          return ok("[]", args);
        }

        return ok("", args);
      },
    },
  });
  provider.createVm = async () => {
    throw new Error("desktop bridge failed");
  };
  provider.observeVmPowerState = () => ({
    status: "running",
  });

  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);

  const vm = manager.createVm({
    templateId: "tpl-0001",
    name: "running-without-vnc",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
  });

  await wait(100);

  const detail = manager.getVmDetail(vm.id);
  assert.equal(detail.vm.status, "running");
  assert.equal(detail.vm.activeWindow, "logs");
  assert.equal(detail.vm.lastAction, "desktop bridge failed");
  assert.equal(detail.vm.session, null);
  assert.ok(detail.vm.liveSince);
  assert.ok(detail.vm.activityLog.some((entry) => entry === "error: desktop bridge failed"));
  assert.ok(
    detail.recentJobs.some(
      (job) => job.kind === "create" && job.status === "failed",
    ),
  );
});

test("unhealthy Selkies guest heartbeats trigger automatic desktop bridge repair", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-stream-health-repair-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus", {
    mockDesktopTransport: "selkies",
  });
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider, {
    forwardedServiceHostBase: "localhost",
    streamHealthSecret: "test-stream-health-secret",
    selkiesStreamHealthDegradedRepairMs: 25,
    selkiesStreamHealthRepairCooldownMs: 25,
    selkiesStreamHealthStaleRepairMs: 25,
  });

  manager.handleVmStreamHealthConnected("vm-0001");
  manager.handleVmStreamHealthHeartbeat("vm-0001", {
    desktopHealthy: false,
    localReachable: false,
    reason: "guest desktop bridge service is inactive",
    sampledAt: new Date().toISOString(),
    serviceActive: false,
    source: "test-suite",
    status: "unhealthy",
  });

  await wait(80);

  const detail = manager.getVmDetail("vm-0001");
  assert.equal(detail.vm.lastAction, "Desktop bridge auto-repaired");
  assert.equal(detail.vm.session?.kind, "selkies");
  assert.ok(
    detail.vm.activityLog.some((entry) =>
      entry ===
      "stream-health: automatic desktop bridge repair (guest desktop bridge service is inactive)",
    ),
  );
});

test("manager marks queued or running jobs as failed after a server restart", (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-interrupted-jobs-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );

  store.update((draft) => {
    draft.jobs.unshift({
      id: "job-interrupted",
      kind: "resize",
      targetVmId: "vm-0001",
      targetTemplateId: "tpl-0001",
      status: "running",
      message: "Action in progress",
      progressPercent: 14,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  const manager = new DesktopManager(store, provider);
  const detail = manager.getVmDetail("vm-0001");

  assert.equal(detail.recentJobs[0]?.id, "job-interrupted");
  assert.equal(detail.recentJobs[0]?.status, "failed");
  assert.equal(
    detail.recentJobs[0]?.message,
    "Control server restarted before resize could finish.",
  );
  assert.equal(detail.recentJobs[0]?.progressPercent, null);
  assert.equal(detail.vm.lastAction, "Control server restarted before resize could finish.");
  assert.ok(
    detail.vm.activityLog.some(
      (entry) => entry === "error: Control server restarted before resize could finish.",
    ),
  );
});

test("manager recovers interrupted create jobs when the VM is already running after restart", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-interrupted-create-recovery-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const providerState = {
    kind: "incus" as const,
    available: true,
    detail: "Incus is reachable.",
    hostStatus: "ready" as const,
    binaryPath: "incus",
    project: null,
    desktopTransport: "novnc" as const,
    nextSteps: [],
  };
  const provider: DesktopProvider = {
    state: providerState,
    refreshState() {
      return this.state;
    },
    sampleHostTelemetry() {
      return null;
    },
    sampleVmTelemetry() {
      return null;
    },
    observeVmPowerState(vm) {
      return vm.id === "vm-0001" ? { status: "running" } : null;
    },
    async refreshVmSession(vm) {
      return vm.id === "vm-0001"
        ? {
            kind: "vnc",
            host: "10.55.0.44",
            port: 5900,
            reachable: true,
            webSocketPath: null,
            browserPath: null,
            display: "10.55.0.44:5900",
          }
        : null;
    },
    async createVm() {
      throw new Error("not implemented");
    },
    async cloneVm() {
      throw new Error("not implemented");
    },
    async startVm() {
      throw new Error("not implemented");
    },
    async pauseVm() {
      throw new Error("not implemented");
    },
    async stopVm() {
      throw new Error("not implemented");
    },
    async deleteVm() {
      throw new Error("not implemented");
    },
    async syncVmHostname() {
      return null;
    },
    async deleteVmSnapshot() {
      throw new Error("not implemented");
    },
    async resizeVm() {
      throw new Error("not implemented");
    },
    async setNetworkMode() {
      throw new Error("not implemented");
    },
    async setDisplayResolution() {
      throw new Error("not implemented");
    },
    async snapshotVm() {
      throw new Error("not implemented");
    },
    async launchVmFromSnapshot() {
      throw new Error("not implemented");
    },
    async restoreVmToSnapshot() {
      throw new Error("not implemented");
    },
    async captureTemplate() {
      throw new Error("not implemented");
    },
    async injectCommand() {
      throw new Error("not implemented");
    },
    async readVmLogs() {
      throw new Error("not implemented");
    },
    async browseVmFiles() {
      throw new Error("not implemented");
    },
    async readVmFile() {
      throw new Error("not implemented");
    },
    async readVmTouchedFiles() {
      throw new Error("not implemented");
    },
    tickVm() {
      return null;
    },
    renderFrame() {
      return "";
    },
  };
  const now = new Date().toISOString();
  const state: AppState = {
    sequence: 2,
    provider: provider.state,
    templates: [
      {
        id: "tpl-0001",
        name: "Ubuntu Agent Forge",
        description: "Seeded Ubuntu desktop template",
        launchSource: "parallaize-template-tpl-0001",
        defaultResources: {
          cpu: 4,
          ramMb: 8192,
          diskGb: 60,
        },
        defaultForwardedPorts: [],
        initCommands: [],
        tags: [],
        notes: [],
        snapshotIds: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    vms: [
      {
        id: "vm-0001",
        name: "restart-recovery",
        templateId: "tpl-0001",
        provider: "incus",
        providerRef: "parallaize-vm-0001-seeded",
        status: "creating",
        resources: {
          cpu: 4,
          ramMb: 8192,
          diskGb: 60,
        },
        createdAt: now,
        updatedAt: now,
        liveSince: null,
        lastAction: "Action in progress",
        snapshotIds: [],
        frameRevision: 1,
        screenSeed: 1,
        activeWindow: "terminal",
        workspacePath: "/root",
        session: null,
        forwardedPorts: [],
        activityLog: ["template: Ubuntu Agent Forge", "status: creating"],
        commandHistory: [],
      },
    ],
    snapshots: [],
    jobs: [
      {
        id: "job-create-interrupted",
        kind: "create",
        targetVmId: "vm-0001",
        targetTemplateId: "tpl-0001",
        status: "running",
        message: "Waiting for desktop",
        progressPercent: 89,
        createdAt: now,
        updatedAt: now,
      },
    ],
    adminSessions: [],
    lastUpdated: now,
  };
  const store = new JsonStateStore(join(tempDir, "state.json"), () => state);
  store.save(state);

  const manager = new DesktopManager(store, provider);

  await wait(80);

  const detail = manager.getVmDetail("vm-0001");
  assert.equal(detail.vm.status, "running");
  assert.equal(detail.vm.lastAction, "Workspace recovered after control server restart.");
  assert.equal(detail.vm.session?.display, "10.55.0.44:5900");
  assert.equal(detail.vm.session?.webSocketPath, "/api/vms/vm-0001/vnc");
  assert.equal(detail.vm.session?.browserPath, "/?vm=vm-0001");
  assert.ok(
    detail.vm.activityLog.some(
      (entry) => entry === "incus: recovered parallaize-vm-0001-seeded after interrupted create",
    ),
  );
  assert.equal(detail.recentJobs[0]?.status, "failed");
  assert.equal(
    detail.recentJobs[0]?.message,
    "Control server restarted before create could finish.",
  );
});

test("captured templates become reusable launch sources for subsequent VMs", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-captured-template-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);

  manager.captureTemplate("vm-0001", {
    name: "Reusable Capture",
    description: "Freshly captured from the seeded VM",
  });
  await wait(700);

  const capturedTemplate = manager
    .getSummary()
    .templates.find((template) => template.name === "Reusable Capture");

  assert.ok(capturedTemplate);
  assert.equal(capturedTemplate?.provenance?.kind, "captured");
  assert.equal(capturedTemplate?.provenance?.sourceVmId, "vm-0001");
  assert.match(capturedTemplate?.provenance?.summary ?? "", /Captured from VM alpha-workbench/);
  assert.equal(capturedTemplate?.history?.[0]?.kind, "captured");
  assert.match(capturedTemplate?.history?.[0]?.summary ?? "", /Template capture: Reusable Capture/);

  const derivedVm = manager.createVm({
    templateId: capturedTemplate!.id,
    name: "derived-from-capture",
    resources: capturedTemplate!.defaultResources,
  });

  await wait(700);

  const detail = manager.getVmDetail(derivedVm.id);
  assert.match(detail.vm.activityLog.join("\n"), /mock:\/\/templates\/reusable-capture/);
});

test("template capture can refresh an existing template while preserving history", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-template-update-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);

  manager.captureTemplate("vm-0001", {
    templateId: "tpl-0001",
    name: "Ubuntu Agent Forge",
    description: "Refreshed from alpha-workbench",
  });

  await wait(700);

  const summary = manager.getSummary();
  const template = summary.templates.find((entry) => entry.id === "tpl-0001");

  assert.ok(template);
  assert.equal(summary.templates.length, 1);
  assert.equal(template?.description, "Refreshed from alpha-workbench");
  assert.equal(template?.launchSource, "mock://templates/ubuntu-agent-forge");
  assert.equal(template?.snapshotIds.length, 2);
  assert.equal(template?.snapshotIds[1], "snap-0001");
  assert.equal(summary.snapshots[0]?.templateId, "tpl-0001");
  assert.match(template?.notes[0] ?? "", /Captured from VM alpha-workbench/);
  assert.equal(template?.provenance?.kind, "captured");
  assert.equal(template?.provenance?.sourceVmName, "alpha-workbench");
  assert.equal(template?.provenance?.sourceSnapshotId, summary.snapshots[0]?.id);
  assert.equal(template?.history?.[0]?.kind, "captured");
  assert.match(template?.history?.[0]?.summary ?? "", /Refreshed from VM alpha-workbench/);
  assert.ok(summary.jobs.some((job) => job.kind === "capture-template" && job.status === "succeeded"));
});

test("frame renderer emits SVG markup for a seeded VM", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-frame-"));
  const provider = createProvider("mock", "incus");
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);

  const svg = manager.getVmFrame("vm-0001", "tile");
  assert.match(svg, /^<\?xml version="1\.0"/);
  assert.match(svg, /alpha-workbench/);
  assert.match(svg, /ACTIVITY FEED/);

  rmSync(tempDir, { recursive: true, force: true });
});

test("incus provider builds real lifecycle commands and VNC metadata", async () => {
  const calls: string[][] = [];
  const commandInputs = new Map<string[], string>();
  const instanceName = "parallaize-vm-0099-delta-lab";
  const reports: Array<{ message: string; progressPercent: number | null }> = [];
  const executeResult = (args: string[]) => {
    if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
      return ok("[]", args);
    }

    if (args[0] === "query" && args[1] === `/1.0/instances/${instanceName}`) {
      return expandedRootDevice(args, "osdisk");
    }

    if (args[0] === "list" && args[1] === instanceName) {
      return ok(
        JSON.stringify([
          {
            name: instanceName,
            status: "Running",
            state: {
              status: "Running",
              network: {
                enp5s0: {
                  addresses: [
                    {
                      family: "inet",
                      scope: "global",
                      address: "10.55.0.12",
                    },
                  ],
                },
              },
            },
          },
        ]),
        args,
      );
    }

    return ok("", args);
  };
  const runner = {
    execute(args: string[], options?: { input?: Buffer | string }) {
      calls.push(args);
      commandInputs.set(args, readCommandInput(options));
      return executeResult(args);
    },
    async executeStreaming(
      args: string[],
      listeners?: { onStdout?(chunk: string): void; onStderr?(chunk: string): void },
      options?: { input?: Buffer | string },
    ) {
      calls.push(args);
      commandInputs.set(args, readCommandInput(options));

      if (args[0] === "init") {
        listeners?.onStderr?.("Allocating image: 20%\r");
        listeners?.onStderr?.("Allocating image: 80%\r");
      }

      return executeResult(args);
    },
  };

  const provider = createProvider("incus", "incus", {
    guestVncPort: 5990,
    guestInotifyMaxUserWatches: 2_097_152,
    guestInotifyMaxUserInstances: 4_096,
    commandRunner: runner,
    templateCompression: "zstd",
    guestPortProbe: {
      async probe() {
        return true;
      },
    },
  });

  assert.equal(provider.state.available, true);
  assert.equal(provider.state.hostStatus, "ready");
  assert.equal(provider.state.desktopTransport, "novnc");

  const template: EnvironmentTemplate = {
    id: "tpl-0099",
    name: "Incus Template",
    description: "Backed by a real image alias",
    launchSource: "images:ubuntu/noble/desktop",
    defaultResources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    defaultForwardedPorts: [],
    initCommands: [
      "sudo apt-get update",
      "sudo apt-get install -y ripgrep fd-find",
      "echo \"bootstrap complete\" > /tmp/parallaize-init.txt",
    ],
    tags: [],
    notes: [],
    snapshotIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const vm: VmInstance = {
    id: "vm-0099",
    name: "renamed-delta-lab",
    wallpaperName: "angry-puffin",
    templateId: template.id,
    provider: "incus",
    providerRef: instanceName,
    status: "creating",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: null,
    lastAction: "Queued",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 7,
    activeWindow: "editor",
    workspacePath: "/root",
    session: null,
    forwardedPorts: [],
    activityLog: [],
  };

  const createMutation = await provider.createVm(vm, template, (message, progressPercent) => {
    reports.push({
      message,
      progressPercent,
    });
  });
  const initCall = calls.find((args) => args[0] === "init");
  const configSetCall = calls.find(
    (args) =>
      args[0] === "config" &&
      args[1] === "set" &&
      args[2] === instanceName &&
      args[3] === "cloud-init.user-data",
  );
  const agentDeviceCall = calls.find(
    (args) =>
      args[0] === "config" &&
      args[1] === "device" &&
      args[2] === "add" &&
      args[3] === instanceName &&
      args[4] === "agent",
  );
  const rootDiskOverrideCall = calls.find(
    (args) =>
      args[0] === "config" &&
      args[1] === "device" &&
      args[2] === "override" &&
      args[3] === instanceName,
  );
  const startCall = calls.find(
    (args) => args[0] === "start" && args[1] === instanceName,
  );
  const initExecCall = calls.find(
    (args) =>
      args[0] === "exec" &&
      args[1] === instanceName &&
      args[2] === "--cwd" &&
      args[3] === "/root" &&
      args[4] === "--" &&
      args[5] === "sh" &&
      args[6] === "-lc" &&
      (args[7] ?? "").includes("/var/log/parallaize-template-init.log"),
  );

  assert.equal(createMutation.session?.display, "10.55.0.12:5990");
  assert.deepEqual(initCall, [
    "init",
    "images:ubuntu/noble/desktop",
    instanceName,
    "--vm",
    "-c",
    "limits.cpu=4",
    "-c",
    "limits.memory=8192MiB",
  ]);
  assert.deepEqual(rootDiskOverrideCall, [
    "config",
    "device",
    "override",
    instanceName,
    "osdisk",
    "size=60GiB",
  ]);
  assert.deepEqual(configSetCall, [
    "config",
    "set",
    instanceName,
    "cloud-init.user-data",
    "-",
  ]);
  const configSetInput = commandInputs.get(configSetCall ?? []) ?? "";
  assert.match(configSetInput, /x11vnc/);
  assert.match(configSetInput, /\/usr\/local\/bin\/parallaize-x11vnc/);
  assert.match(configSetInput, /\/usr\/local\/bin\/parallaize-desktop-bootstrap/);
  assert.match(configSetInput, /\/etc\/environment\.d\/90-parallaize-rendering\.conf/);
  assert.match(configSetInput, /\/usr\/local\/bin\/parallaize-desktop-health-check/);
  assert.match(configSetInput, /\/usr\/local\/bin\/parallaize-desktop-session-setup/);
  assert.match(configSetInput, /parallaize-desktop-bootstrap\.service/);
  assert.match(configSetInput, /parallaize-desktop-session-setup\.desktop/);
  assert.match(configSetInput, /find_guest_auth_file\(\)/);
  assert.match(configSetInput, /find_guest_display_number\(\)/);
  assert.match(configSetInput, /guest_desktop_has_visible_stage\(\)/);
  assert.match(configSetInput, /guest_desktop_session_ready\(\)/);
  assert.match(configSetInput, /pgrep -u ubuntu -x gnome-shell/);
  assert.match(configSetInput, /\/usr\/libexec\/gnome-session-binary/);
  assert.match(configSetInput, /xwininfo -root -tree/);
  assert.match(configSetInput, /mutter guard window/);
  assert.match(configSetInput, /loginctl list-sessions --no-legend/);
  assert.match(configSetInput, /-p Class --value/);
  assert.match(configSetInput, /ps -C x11vnc -o args=/);
  assert.match(configSetInput, /ps -C Xwayland -o args=/);
  assert.match(configSetInput, /\.mutter-Xwaylandauth\.\*/);
  assert.match(configSetInput, /\/var\/run\/gdm3\/auth-for-\*\/database/);
  assert.match(configSetInput, /Acquire::ForceIPv4=true/);
  assert.match(configSetInput, /LIBGL_ALWAYS_SOFTWARE=1/);
  assert.match(configSetInput, /GALLIUM_DRIVER=llvmpipe/);
  assert.match(configSetInput, /-noxdamage/);
  assert.match(configSetInput, /indicator-multiload/);
  assert.match(configSetInput, /dock-position RIGHT/);
  assert.match(configSetInput, /dash-max-icon-size 32/);
  assert.match(configSetInput, /idle-delay 'uint32 0'/);
  assert.match(configSetInput, /sleep-inactive-ac-type 'nothing'/);
  assert.match(configSetInput, /sleep-inactive-ac-timeout 'uint32 0'/);
  assert.match(configSetInput, /sleep-inactive-battery-type 'nothing'/);
  assert.match(configSetInput, /sleep-inactive-battery-timeout 'uint32 0'/);
  assert.match(configSetInput, /https:\/\/wallpapers\.parallaize\.com\/24\.04\/angry-puffin\.jpg/);
  assert.match(configSetInput, /download_remote_wallpaper\(\)/);
  assert.match(configSetInput, /resolve_first_boot_wallpaper_uri\(\)/);
  assert.match(configSetInput, /Monument_valley_by_orbitelambda\.jpg/);
  assert.match(configSetInput, /desktop-wallpaper-initialized/);
  assert.match(configSetInput, /desktop-wallpaper-source/);
  assert.match(configSetInput, /current_wallpaper_state/);
  assert.match(configSetInput, /desired_wallpaper_state/);
  assert.match(configSetInput, /picture-uri-dark/);
  assert.doesNotMatch(configSetInput, /shuf -n 1/);
  assert.match(configSetInput, /desktop-session-unhealthy-at/);
  assert.match(configSetInput, /desktop-session-last-gdm-restart/);
  assert.match(configSetInput, /DESKTOP_HEALTH_GRACE_SECONDS=30/);
  assert.match(configSetInput, /DESKTOP_GDM_RESTART_COOLDOWN_SECONDS=30/);
  assert.match(configSetInput, /repair_guest_desktop_if_unhealthy\(\)/);
  assert.match(configSetInput, /systemctl restart gdm3 \|\| true/);
  assert.match(configSetInput, /gnome-initial-setup-done/);
  assert.match(configSetInput, /gnome-initial-setup-first-login\.desktop/);
  assert.match(configSetInput, /-xrandr newfbsize/);
  assert.match(configSetInput, /-noshm/);
  assert.match(configSetInput, /xset r on \|\| true/);
  assert.match(configSetInput, /-norepeat/);
  assert.doesNotMatch(configSetInput, / -repeat\b/);
  assert.match(configSetInput, /fs\.inotify\.max_user_watches=2097152/);
  assert.match(configSetInput, /fs\.inotify\.max_user_instances=4096/);
  assert.match(configSetInput, /sysctl --load \/etc\/sysctl\.d\/60-parallaize-inotify\.conf/);
  assert.match(configSetInput, /incus-agent\.service/);
  assert.match(configSetInput, /systemctl enable parallaize-desktop-bootstrap\.service/);
  assert.deepEqual(agentDeviceCall, [
    "config",
    "device",
    "add",
    instanceName,
    "agent",
    "disk",
    "source=agent:config",
  ]);
  assert.deepEqual(startCall, ["start", instanceName]);
  assert.ok(initExecCall);
  assert.equal(
    spawnSync("sh", ["-n"], {
      input: initExecCall?.[7] ?? "",
      encoding: "utf8",
    }).status,
    0,
  );
  assert.match(initExecCall?.[7] ?? "", /sudo apt-get update/);
  assert.match(initExecCall?.[7] ?? "", /sudo apt-get install -y ripgrep fd-find/);
  assert.match(
    initExecCall?.[7] ?? "",
    /echo "bootstrap complete" > \/tmp\/parallaize-init\.txt/,
  );
  assert.ok(
    reports.some(
      (entry) =>
        entry.message.startsWith("Allocating workspace") &&
        (entry.progressPercent ?? 0) > 20 &&
        (entry.progressPercent ?? 100) < 58,
    ),
  );
  assert.ok(
    reports.some(
      (entry) =>
        entry.message === "Desktop session ready" &&
        (entry.progressPercent ?? 0) >= 96,
    ),
  );

  const snapshot = await provider.captureTemplate(vm, {
    templateId: "tpl-0099",
    name: "Captured Incus Template",
  });
  const snapshotCreateCall = calls.find(
    (args) => args[0] === "snapshot" && args[1] === "create" && args[2] === instanceName,
  );
  const publishCopyCall = calls.find(
    (args) =>
      args[0] === "copy" &&
      args[1] === `${instanceName}/${snapshotCreateCall?.[3] ?? ""}` &&
      (args[2] ?? "").startsWith("parallaize-template-publish-tpl-0099-"),
  );
  const publishCall = calls.find(
    (args) => args[0] === "publish" && args[1] === publishCopyCall?.[2],
  );
  const publishCleanupCall = calls.find(
    (args) => args[0] === "delete" && args[1] === publishCopyCall?.[2] && args[2] === "--force",
  );

  assert.equal(snapshot.launchSource, "parallaize-template-tpl-0099");
  assert.equal(snapshotCreateCall?.[0], "snapshot");
  assert.equal(snapshotCreateCall?.[1], "create");
  assert.match(snapshotCreateCall?.[3] ?? "", /^parallaize-template-tpl-0099-/);
  assert.deepEqual(publishCopyCall, [
    "copy",
    `${instanceName}/${snapshotCreateCall?.[3] ?? ""}`,
    publishCopyCall?.[2] ?? "",
  ]);
  assert.deepEqual(publishCall, [
    "publish",
    publishCopyCall?.[2] ?? "",
    "--alias",
    "parallaize-template-tpl-0099",
    "--reuse",
    "--compression",
    "zstd",
  ]);
  assert.deepEqual(publishCleanupCall, [
    "delete",
    publishCopyCall?.[2] ?? "",
    "--force",
  ]);
});

test("incus provider treats a timed-out readiness probe as daemon-unreachable", () => {
  const provider = createProvider("incus", "incus", {
    commandRunner: {
      execute(args: string[]) {
        if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
          return timedOut(args);
        }

        return ok("", args);
      },
    },
  });

  assert.equal(provider.state.available, false);
  assert.equal(provider.state.hostStatus, "daemon-unreachable");
  assert.match(provider.state.detail, /readiness probe timed out/i);
});

test("incus provider reports mixed Flox and distro daemon ownership explicitly", () => {
  const provider = createProvider("incus", "incus", {
    commandRunner: {
      execute(args: string[]) {
        if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
          return ok("[]", args);
        }

        return ok("", args);
      },
    },
    hostDaemonProbe: {
      probe() {
        return {
          status: "conflict",
          detail:
            "Mixed Incus daemon ownership detected. incus.socket enabled; Flox incusd: /home/marius/.flox/bin/incusd --group sudo.",
          nextSteps: [
            "Disable `incus.socket` before running Flox `incusd` manually.",
          ],
        };
      },
    },
  });

  assert.equal(provider.state.available, true);
  assert.equal(provider.state.hostStatus, "daemon-conflict");
  assert.match(provider.state.detail, /mixed incus daemon ownership detected/i);
  assert.deepEqual(provider.state.nextSteps, [
    "Disable `incus.socket` before running Flox `incusd` manually.",
  ]);
});

test("incus provider applies a managed DMZ ACL and NIC override for dmz VMs", async () => {
  const calls: string[][] = [];
  const instanceName = "parallaize-vm-0100-dmz";
  const runner = {
    execute(args: string[]) {
      calls.push(args);

      if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
        return ok("[]", args);
      }

      if (
        args[0] === "query" &&
        typeof args[1] === "string" &&
        args[1] === `/1.0/instances/${instanceName}`
      ) {
        return expandedRootAndNicDevice(args);
      }

      if (
        args[0] === "query" &&
        typeof args[1] === "string" &&
        args[1] === "/1.0/networks/incusbr0"
      ) {
        return ok(
          JSON.stringify({
            managed: true,
            type: "bridge",
            config: {
              "ipv4.address": "10.36.140.1/24",
              "ipv6.address": "fd42:f551:1c4c:bffd::1/64",
            },
          }),
          args,
        );
      }

      if (
        args[0] === "query" &&
        typeof args[1] === "string" &&
        (
          args[1] === "/1.0/network-acls/parallaize-dmz" ||
          args[1] === "/1.0/network-acls/parallaize-airgap"
        )
      ) {
        return {
          args,
          status: 1,
          stdout: "",
          stderr: "not found",
        };
      }

      if (args[0] === "list" && args[1] === instanceName && args[2] === "--format" && args[3] === "json") {
        return ok(
          JSON.stringify([
            {
              name: instanceName,
              status: "Running",
              state: {
                status: "Running",
                network: {
                  enp5s0: {
                    addresses: [
                      {
                        family: "inet",
                        scope: "global",
                        address: "10.55.0.45",
                      },
                    ],
                  },
                },
              },
            },
          ]),
          args,
        );
      }

      return ok("", args);
    },
  };

  const provider = createProvider("incus", "incus", {
    commandRunner: runner,
    guestPortProbe: {
      async probe() {
        return true;
      },
    },
  });

  const template: EnvironmentTemplate = {
    id: "tpl-dmz-0001",
    name: "DMZ Template",
    description: "Validates managed Incus ACL wiring",
    launchSource: "images:ubuntu/noble/desktop",
    defaultResources: {
      cpu: 2,
      ramMb: 4096,
      diskGb: 30,
    },
    defaultForwardedPorts: [],
    defaultNetworkMode: "dmz",
    initCommands: [],
    tags: [],
    notes: [],
    snapshotIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const vm: VmInstance = {
    id: "vm-dmz-0001",
    name: "dmz-check",
    templateId: template.id,
    provider: "incus",
    providerRef: instanceName,
    status: "creating",
    resources: template.defaultResources,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: null,
    lastAction: "Queued",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 1,
    activeWindow: "editor",
    workspacePath: "/root",
    networkMode: "dmz",
    session: null,
    forwardedPorts: [],
    activityLog: [],
  };

  const mutation = await provider.createVm(vm, template);
  const aclCreateCall = calls.find(
    (args) =>
      args[0] === "network" &&
      args[1] === "acl" &&
      args[2] === "create" &&
      args[3] === "parallaize-dmz",
  );
  const aclPutCall = calls.find(
    (args) =>
      args[0] === "query" &&
      args[1] === "-X" &&
      args[2] === "PUT" &&
      args[6] === "/1.0/network-acls/parallaize-dmz",
  );
  const nicOverrideCall = calls.find(
    (args) =>
      args[0] === "config" &&
      args[1] === "device" &&
      args[2] === "override" &&
      args[3] === instanceName &&
      args[4] === "eth0",
  );
  const guestDnsCall = calls.find(
    (args) =>
      args[0] === "exec" &&
      args[1] === instanceName &&
      (args[5] ?? "").includes("DNS=1.1.1.1 1.0.0.1 2606:4700:4700::1111 2606:4700:4700::1001"),
  );

  assert.ok(aclCreateCall);
  assert.ok(aclPutCall);
  assert.match(aclPutCall?.[5] ?? "", /"user\.parallaize\.profile":"dmz"/);
  assert.match(aclPutCall?.[5] ?? "", /10\.36\.140\.1\/32/);
  assert.match(aclPutCall?.[5] ?? "", /fd42:f551:1c4c:bffd::1\/128/);
  assert.doesNotMatch(aclPutCall?.[5] ?? "", /"destination_port":"53"/);
  assert.ok(nicOverrideCall?.includes("security.acls=parallaize-dmz"));
  assert.ok(nicOverrideCall?.includes("security.acls.default.egress.action=reject"));
  assert.ok(nicOverrideCall?.includes("security.acls.default.ingress.action=reject"));
  assert.ok(nicOverrideCall?.includes("security.port_isolation=true"));
  assert.ok(nicOverrideCall?.includes("security.mac_filtering=true"));
  assert.ok(guestDnsCall);
  assert.ok(mutation.activity.includes("network: dmz via parallaize-dmz"));
  assert.ok(
    mutation.activity.includes(
      "dns: public resolvers 1.1.1.1, 1.0.0.1, 2606:4700:4700::1111, 2606:4700:4700::1001",
    ),
  );
});

test("incus provider degrades health when host internet checks fail", () => {
  const provider = createProvider("incus", "incus", {
    commandRunner: {
      execute(args: string[]) {
        if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
          return ok("[]", args);
        }

        return ok("", args);
      },
    },
    hostNetworkProbe: {
      probe() {
        return {
          status: "unreachable",
          detail: "Incus is reachable, but outbound internet checks failed.",
          nextSteps: ["Verify outbound IPv4 and DNS from the control-plane host."],
        };
      },
    },
  });

  assert.equal(provider.state.available, true);
  assert.equal(provider.state.hostStatus, "network-unreachable");
  assert.equal(provider.state.detail, "Incus is reachable, but outbound internet checks failed.");
  assert.deepEqual(provider.state.nextSteps, [
    "Verify outbound IPv4 and DNS from the control-plane host.",
  ]);
});

test("incus provider repairs captured-template desktops before trusting guest VNC", async () => {
  const calls: string[][] = [];
  const instanceName = "parallaize-vm-0100-captured-bootstrap";
  let bootstrapScript = "";
  const provider = createProvider("incus", "incus", {
    commandRunner: {
      execute(args: string[], options?: { input?: Buffer | string }) {
        calls.push(args);
        const input = readCommandInput(options);

        if (
          args[0] === "list" &&
          ((args[1] === "--format" && args[2] === "json") || args[1] === instanceName)
        ) {
          return ok(
            JSON.stringify([
              {
                name: instanceName,
                status: "Running",
                state: {
                  status: "Running",
                  network: {
                    enp5s0: {
                      addresses: [
                        {
                          family: "inet",
                          scope: "global",
                          address: "10.55.0.44",
                        },
                      ],
                    },
                  },
                },
              },
            ]),
            args,
          );
        }

        if (args[0] === "query" && args[1] === `/1.0/instances/${instanceName}`) {
          return expandedRootDevice(args, "osdisk");
        }

        if (
          args[0] === "exec" &&
          args[1] === instanceName &&
          input.includes('BOOTSTRAP_FILE="/usr/local/bin/parallaize-desktop-bootstrap"')
        ) {
          bootstrapScript = input;
          return ok("", args);
        }

        return ok("", args);
      },
    },
    guestAgentRetryMs: 0,
    guestAgentRetryTimeoutMs: 0,
    guestPortProbe: {
      async probe() {
        return true;
      },
    },
  });

  const template: EnvironmentTemplate = {
    id: "tpl-captured-0100",
    name: "Captured Desktop",
    description: "Publishes an existing workspace image",
    launchSource: "parallaize-template-tpl-captured-0100",
    defaultResources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    defaultForwardedPorts: [],
    initCommands: [],
    tags: ["captured"],
    notes: [],
    snapshotIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const vm: VmInstance = {
    id: "vm-0100",
    name: "captured-bootstrap",
    templateId: template.id,
    provider: "incus",
    providerRef: instanceName,
    status: "creating",
    resources: template.defaultResources,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: null,
    lastAction: "Queued",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 10,
    activeWindow: "editor",
    workspacePath: "/root",
    session: null,
    forwardedPorts: [],
    activityLog: [],
  };

  const mutation = await provider.createVm(vm, template);

  assert.notEqual(bootstrapScript, "");
  assert.equal(
    spawnSync("sh", ["-n"], {
      input: bootstrapScript,
      encoding: "utf8",
    }).status,
    0,
  );
  assert.match(bootstrapScript, /DESKTOP_HEALTH_GRACE_SECONDS=10/);
  assert.match(bootstrapScript, /DESKTOP_GDM_RESTART_COOLDOWN_SECONDS=15/);
  assert.equal(mutation.session?.display, "10.55.0.44:5900");
});

test("incus provider fails fast when captured-template bootstrap repair cannot reach the guest agent", async () => {
  const calls: string[][] = [];
  const instanceName = "parallaize-vm-0100-captured-agent-missing";
  const provider = createProvider("incus", "incus", {
    commandRunner: {
      execute(args: string[], options?: { input?: Buffer | string }) {
        calls.push(args);
        const input = readCommandInput(options);

        if (
          args[0] === "list" &&
          ((args[1] === "--format" && args[2] === "json") || args[1] === instanceName)
        ) {
          return ok(
            JSON.stringify([
              {
                name: instanceName,
                status: "Running",
                state: {
                  status: "Running",
                  network: {
                    enp5s0: {
                      addresses: [
                        {
                          family: "inet",
                          scope: "global",
                          address: "10.55.0.45",
                        },
                      ],
                    },
                  },
                },
              },
            ]),
            args,
          );
        }

        if (args[0] === "query" && args[1] === `/1.0/instances/${instanceName}`) {
          return expandedRootDevice(args, "osdisk");
        }

        if (
          args[0] === "exec" &&
          args[1] === instanceName &&
          input.includes('BOOTSTRAP_FILE="/usr/local/bin/parallaize-desktop-bootstrap"')
        ) {
          return {
            args,
            status: 1,
            stdout: "",
            stderr: "Error: VM agent isn't currently connected",
          };
        }

        return ok("", args);
      },
    },
    guestAgentRetryMs: 0,
    guestAgentRetryTimeoutMs: 0,
    guestPortProbe: {
      async probe() {
        return true;
      },
    },
  });

  const template: EnvironmentTemplate = {
    id: "tpl-captured-0101",
    name: "Captured Desktop",
    description: "Publishes an existing workspace image",
    launchSource: "parallaize-template-tpl-captured-0101",
    defaultResources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    defaultForwardedPorts: [],
    initCommands: [],
    tags: ["captured"],
    notes: [],
    snapshotIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const vm: VmInstance = {
    id: "vm-0101",
    name: "captured-agent-missing",
    templateId: template.id,
    provider: "incus",
    providerRef: instanceName,
    status: "creating",
    resources: template.defaultResources,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: null,
    lastAction: "Queued",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 11,
    activeWindow: "editor",
    workspacePath: "/root",
    session: null,
    forwardedPorts: [],
    activityLog: [],
  };

  await assert.rejects(
    provider.createVm(vm, template),
    /Incus guest agent is unavailable.*Repair the Incus guest-agent payload on the host and retry\./s,
  );

  const inspectCalls = calls.filter((args) => args[0] === "list" && args[1] === instanceName);
  assert.equal(inspectCalls.length, 1);
});

test("incus provider reads staged publish progress from the operations API", async () => {
  const calls: string[][] = [];
  const instanceName = "parallaize-vm-0100-publish-heartbeat";
  const operationId = "8fba0d4b-1d58-4c30-9551-0c2734f0e100";
  let operationQueryCount = 0;
  const runner = {
    execute(args: string[]) {
      calls.push(args);

      if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
        return ok("[]", args);
      }

      if (args[0] === "query" && args[1] === "/1.0/operations?recursion=1") {
        operationQueryCount += 1;

        if (operationQueryCount === 1) {
          return ok(JSON.stringify({ running: [] }), args);
        }

        if (operationQueryCount < 4) {
          return ok(
            JSON.stringify({
              running: [
                {
                  id: operationId,
                  created_at: new Date().toISOString(),
                  metadata: {
                    create_image_from_container_pack_progress: "Exporting: 62%",
                    progress: {
                      percent: "62",
                      speed: "0",
                      stage: "create_image_from_container_pack",
                    },
                  },
                },
              ],
            }),
            args,
          );
        }

        return ok(
          JSON.stringify({
            running: [
              {
                id: operationId,
                created_at: new Date().toISOString(),
                metadata: {
                  create_image_from_container_pack_progress: "Image pack: 50.00GiB (20.00MiB/s)",
                  progress: {
                    processed: String(50 * 1024 * 1024 * 1024),
                    speed: String(20 * 1024 * 1024),
                    stage: "create_image_from_container_pack",
                  },
                },
              },
            ],
          }),
          args,
        );
      }

      return ok("", args);
    },
    async executeStreaming(args: string[]) {
      calls.push(args);
      await wait(220);
      return ok("", args);
    },
  };

  const provider = createProvider("incus", "incus", {
    commandRunner: runner,
    templatePublishHeartbeatMs: 40,
  });

  const vm: VmInstance = {
    id: "vm-0100",
    name: "publish-heartbeat",
    templateId: "tpl-0001",
    provider: "incus",
    providerRef: instanceName,
    status: "running",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 100,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: new Date().toISOString(),
    lastAction: "Running",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 100,
    activeWindow: "editor",
    workspacePath: "/root",
    session: {
      kind: "vnc",
      host: "10.55.0.100",
      port: 5901,
      webSocketPath: "/api/vms/vm-0100/vnc",
      browserPath: "/?vm=vm-0100",
      display: "10.55.0.100:5901",
    },
    forwardedPorts: [],
    activityLog: [],
  };

  const reports: Array<{ message: string; progressPercent: number | null }> = [];
  await provider.captureTemplate(
    vm,
    {
      templateId: "tpl-0100",
      name: "Heartbeat Capture",
    },
    (message, progressPercent) => {
      reports.push({
        message,
        progressPercent,
      });
    },
  );

  assert.ok(
    reports.some(
      (entry) =>
        entry.message.includes("Exporting: 62%") &&
        (entry.progressPercent ?? 0) > 58,
    ),
  );
  const packReport = reports.find((entry) => entry.message.includes("Image pack: 50.00GiB"));
  assert.ok(packReport);
  assert.ok((packReport?.progressPercent ?? 0) > 78);
  assert.ok((packReport?.progressPercent ?? 100) < 90);
  assert.equal(reports.at(-1)?.message, "Template image published");
  assert.equal(reports.at(-1)?.progressPercent, 92);
  const publishCall = calls.find(
    (args) => args[0] === "publish" && (args[1] ?? "").startsWith("parallaize-template-publish-tpl-0100-"),
  );
  const snapshotCreateCall = calls.find(
    (args) => args[0] === "snapshot" && args[1] === "create" && args[2] === instanceName,
  );
  const publishCopyCall = calls.find(
    (args) =>
      args[0] === "copy" &&
      args[1] === `${instanceName}/${snapshotCreateCall?.[3] ?? ""}` &&
      args[2] === publishCall?.[1],
  );
  const publishCleanupCall = calls.find(
    (args) => args[0] === "delete" && args[1] === publishCall?.[1] && args[2] === "--force",
  );
  assert.deepEqual(publishCall, [
    "publish",
    publishCall?.[1] ?? "",
    "--alias",
    "parallaize-template-tpl-0100",
    "--reuse",
  ]);
  assert.deepEqual(publishCopyCall, [
    "copy",
    `${instanceName}/${snapshotCreateCall?.[3] ?? ""}`,
    publishCall?.[1] ?? "",
  ]);
  assert.deepEqual(publishCleanupCall, [
    "delete",
    publishCall?.[1] ?? "",
    "--force",
  ]);
});

test("incus provider parses image-pack output when publish streaming reports bytes instead of percent", async () => {
  const calls: string[][] = [];
  const instanceName = "parallaize-vm-0100-publish-pack-output";
  const runner = {
    execute(args: string[]) {
      calls.push(args);

      if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
        return ok("[]", args);
      }

      if (args[0] === "query" && args[1] === "/1.0/operations?recursion=1") {
        return ok(JSON.stringify({ running: [] }), args);
      }

      return ok("", args);
    },
    async executeStreaming(args: string[], listeners?: { onStdout?(chunk: string): void }) {
      calls.push(args);
      listeners?.onStdout?.("Publishing instance: Exporting: 100%\r");
      await wait(25);
      listeners?.onStdout?.("Publishing instance: Image pack: 50.00GiB (20.00MiB/s)\r");
      await wait(25);
      return ok("", args);
    },
  };

  const provider = createProvider("incus", "incus", {
    commandRunner: runner,
    templatePublishHeartbeatMs: 40,
  });

  const vm: VmInstance = {
    id: "vm-0101",
    name: "publish-pack-output",
    templateId: "tpl-0001",
    provider: "incus",
    providerRef: instanceName,
    status: "running",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 100,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: new Date().toISOString(),
    lastAction: "Running",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 101,
    activeWindow: "editor",
    workspacePath: "/root",
    session: {
      kind: "vnc",
      host: "10.55.0.101",
      port: 5901,
      webSocketPath: "/api/vms/vm-0101/vnc",
      browserPath: "/?vm=vm-0101",
      display: "10.55.0.101:5901",
    },
    forwardedPorts: [],
    activityLog: [],
  };

  const reports: Array<{ message: string; progressPercent: number | null }> = [];
  await provider.captureTemplate(
    vm,
    {
      templateId: "tpl-0101",
      name: "Pack Output Capture",
    },
    (message, progressPercent) => {
      reports.push({
        message,
        progressPercent,
      });
    },
  );

  const packReport = reports.find((entry) => entry.message.includes("Image pack: 50.0 GiB"));
  assert.ok(packReport);
  assert.ok((packReport?.progressPercent ?? 0) > 78);
  assert.ok((packReport?.progressPercent ?? 100) < 90);
});

test("incus provider applies guest display resolution through xrandr", async () => {
  const calls: string[][] = [];
  const instanceName = "parallaize-vm-0199-resolution-lab";
  const runner = {
    execute(args: string[]) {
      calls.push(args);

      if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
        return ok("[]", args);
      }

      if (args[0] === "query" && args[1] === `/1.0/instances/${instanceName}`) {
        return expandedRootDevice(args, "disk0");
      }

      return ok("", args);
    },
  };

  const provider = createProvider("incus", "incus", {
    commandRunner: runner,
    guestSelkiesRtcConfig: {
      stunHost: "stun.example.com",
      stunPort: 3478,
      turnHost: "turn.example.com",
      turnPort: 5349,
      turnProtocol: "tcp",
      turnTls: true,
      turnSharedSecret: "shared-secret",
      turnRestUri: "https://turn.example.com/api",
      turnRestUsername: "selkies-host",
    },
  });

  const vm: VmInstance = {
    id: "vm-0199",
    name: "resolution-lab-renamed",
    wallpaperName: "daring-fox",
    templateId: "tpl-0001",
    provider: "incus",
    providerRef: instanceName,
    status: "running",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: new Date().toISOString(),
    lastAction: "Running",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 99,
    activeWindow: "editor",
    workspacePath: "/root",
    session: {
      kind: "vnc",
      host: "10.55.0.77",
      port: 5901,
      webSocketPath: "/api/vms/vm-0199/vnc",
      browserPath: "/?vm=vm-0199",
      display: "10.55.0.77:5901",
    },
    forwardedPorts: [],
    activityLog: [],
  };

  await provider.setDisplayResolution(vm, 1366, 768);

  const execCall = calls.find(
    (args) =>
      args[0] === "exec" &&
      args[1] === instanceName &&
      (args[5] ?? "").includes('TARGET_MODE="1366x768"'),
  );

  assert.ok(execCall);
  assert.equal(execCall?.[2], "--");
  assert.equal(execCall?.[3], "sh");
  assert.equal(execCall?.[4], "-lc");
  assert.match(execCall?.[5] ?? "", /BOOTSTRAP_FILE="\/usr\/local\/bin\/parallaize-desktop-bootstrap"/);
  assert.match(execCall?.[5] ?? "", /BOOTSTRAP_SERVICE_FILE="\/etc\/systemd\/system\/parallaize-desktop-bootstrap\.service"/);
  assert.match(execCall?.[5] ?? "", /LAUNCHER_FILE="\/usr\/local\/bin\/parallaize-x11vnc"/);
  assert.match(
    execCall?.[5] ?? "",
    /SESSION_HEALTH_FILE="\/usr\/local\/bin\/parallaize-desktop-health-check"/,
  );
  assert.match(
    execCall?.[5] ?? "",
    /SESSION_SETUP_FILE="\/usr\/local\/bin\/parallaize-desktop-session-setup"/,
  );
  assert.match(
    execCall?.[5] ?? "",
    /RENDERING_ENV_FILE="\/etc\/environment\.d\/90-parallaize-rendering\.conf"/,
  );
  assert.match(
    execCall?.[5] ?? "",
    /SESSION_AUTOSTART_FILE="\/etc\/xdg\/autostart\/parallaize-desktop-session-setup\.desktop"/,
  );
  assert.match(execCall?.[5] ?? "", /parallaize-x11vnc\.service/);
  assert.match(execCall?.[5] ?? "", /parallaize-desktop-bootstrap\.service/);
  assert.match(execCall?.[5] ?? "", /find_guest_auth_file\(\)/);
  assert.match(execCall?.[5] ?? "", /find_guest_display_number\(\)/);
  assert.match(execCall?.[5] ?? "", /guest_desktop_has_visible_stage\(\)/);
  assert.match(execCall?.[5] ?? "", /guest_desktop_session_ready\(\)/);
  assert.match(execCall?.[5] ?? "", /pgrep -u ubuntu -x gnome-shell/);
  assert.match(execCall?.[5] ?? "", /\/usr\/libexec\/gnome-session-binary/);
  assert.match(execCall?.[5] ?? "", /xwininfo -root -tree/);
  assert.match(execCall?.[5] ?? "", /mutter guard window/);
  assert.match(execCall?.[5] ?? "", /loginctl list-sessions --no-legend/);
  assert.match(execCall?.[5] ?? "", /-p Class --value/);
  assert.match(execCall?.[5] ?? "", /ps -C x11vnc -o args=/);
  assert.match(execCall?.[5] ?? "", /ps -C Xwayland -o args=/);
  assert.match(execCall?.[5] ?? "", /Acquire::ForceIPv4=true/);
  assert.match(execCall?.[5] ?? "", /LIBGL_ALWAYS_SOFTWARE=1/);
  assert.match(execCall?.[5] ?? "", /GALLIUM_DRIVER=llvmpipe/);
  assert.match(execCall?.[5] ?? "", /indicator-multiload/);
  assert.match(execCall?.[5] ?? "", /dock-position RIGHT/);
  assert.match(execCall?.[5] ?? "", /dash-max-icon-size 32/);
  assert.match(execCall?.[5] ?? "", /idle-delay 'uint32 0'/);
  assert.match(execCall?.[5] ?? "", /sleep-inactive-ac-type 'nothing'/);
  assert.match(execCall?.[5] ?? "", /sleep-inactive-ac-timeout 'uint32 0'/);
  assert.match(execCall?.[5] ?? "", /sleep-inactive-battery-type 'nothing'/);
  assert.match(execCall?.[5] ?? "", /sleep-inactive-battery-timeout 'uint32 0'/);
  assert.match(
    execCall?.[5] ?? "",
    /https:\/\/wallpapers\.parallaize\.com\/24\.04\/daring-fox\.jpg/,
  );
  assert.match(execCall?.[5] ?? "", /download_remote_wallpaper\(\)/);
  assert.match(execCall?.[5] ?? "", /resolve_first_boot_wallpaper_uri\(\)/);
  assert.match(execCall?.[5] ?? "", /Monument_valley_by_orbitelambda\.jpg/);
  assert.match(execCall?.[5] ?? "", /desktop-wallpaper-initialized/);
  assert.match(execCall?.[5] ?? "", /desktop-wallpaper-source/);
  assert.match(execCall?.[5] ?? "", /current_wallpaper_state/);
  assert.match(execCall?.[5] ?? "", /desired_wallpaper_state/);
  assert.match(execCall?.[5] ?? "", /picture-uri-dark/);
  assert.doesNotMatch(execCall?.[5] ?? "", /shuf -n 1/);
  assert.match(execCall?.[5] ?? "", /desktop-session-unhealthy-at/);
  assert.match(execCall?.[5] ?? "", /desktop-session-last-gdm-restart/);
  assert.match(execCall?.[5] ?? "", /repair_guest_desktop_if_unhealthy\(\)/);
  assert.match(execCall?.[5] ?? "", /gnome-initial-setup-done/);
  assert.match(execCall?.[5] ?? "", /gnome-initial-setup-first-login\.desktop/);
  assert.match(execCall?.[5] ?? "", /ATTEMPT=0/);
  assert.match(execCall?.[5] ?? "", /sleep 2/);
  assert.match(execCall?.[5] ?? "", /-xrandr newfbsize/);
  assert.match(execCall?.[5] ?? "", /-noxdamage/);
  assert.match(execCall?.[5] ?? "", /-noshm/);
  assert.match(execCall?.[5] ?? "", /xset r on \|\| true/);
  assert.match(execCall?.[5] ?? "", /-norepeat/);
  assert.doesNotMatch(execCall?.[5] ?? "", / -repeat\b/);
  assert.match(execCall?.[5] ?? "", /RESTART_DESKTOP=0/);
  assert.match(
    execCall?.[5] ?? "",
    /if \[ "\$RESTART_DESKTOP" -eq 1 \] \|\| ! systemctl is-active --quiet "\$DESKTOP_SERVICE_NAME"; then/,
  );
  assert.match(
    execCall?.[5] ?? "",
    /systemctl restart --no-block "\$DESKTOP_SERVICE_NAME"/,
  );
  assert.match(execCall?.[5] ?? "", /TARGET_MODE="1366x768"/);
  assert.match(execCall?.[5] ?? "", /xrandr --query/);
  assert.match(execCall?.[5] ?? "", /cvt "\$WIDTH" "\$HEIGHT" 60/);
  assert.match(execCall?.[5] ?? "", /MODE_TO_APPLY=/);
  assert.match(execCall?.[5] ?? "", /xrandr --output "\$OUTPUT" --mode "\$MODE_TO_APPLY"/);
});

test("incus provider applies guest display resolution through the Selkies bootstrap path", async () => {
  const calls: string[][] = [];
  const instanceName = "parallaize-vm-0201-resolution-selkies";
  const runner = {
    execute(args: string[]) {
      calls.push(args);

      if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
        return ok("[]", args);
      }

      if (args[0] === "query" && args[1] === `/1.0/instances/${instanceName}`) {
        return expandedRootDevice(args, "disk0");
      }

      return ok("", args);
    },
  };

  const provider = createProvider("incus", "incus", {
    commandRunner: runner,
    guestSelkiesRtcConfig: {
      stunHost: "stun.example.com",
      stunPort: 3478,
      turnHost: "turn.example.com",
      turnPort: 5349,
      turnProtocol: "tcp",
      turnTls: true,
      turnSharedSecret: "shared-secret",
      turnRestUri: "https://turn.example.com/api",
      turnRestUsername: "selkies-host",
    },
  });

  const vm: VmInstance = {
    id: "vm-0201",
    name: "resolution-selkies",
    wallpaperName: "silver-heron",
    templateId: "tpl-0001",
    provider: "incus",
    providerRef: instanceName,
    status: "running",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: new Date().toISOString(),
    lastAction: "Running",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 101,
    activeWindow: "editor",
    workspacePath: "/root",
    desktopTransport: "selkies",
    session: {
      kind: "selkies",
      host: "10.55.0.88",
      port: 6080,
      reachable: true,
      webSocketPath: null,
      browserPath: "/selkies-vm-0201/",
      display: "10.55.0.88:6080",
    },
    forwardedPorts: [],
    activityLog: [],
  };

  await provider.setDisplayResolution(vm, 1441, 901);

  const execCall = calls.find(
    (args) =>
      args[0] === "exec" &&
      args[1] === instanceName &&
      (args[5] ?? "").includes('TARGET_MODE="1441x901"'),
  );

  assert.ok(execCall);
  assert.match(execCall?.[5] ?? "", /LAUNCHER_FILE="\/usr\/local\/bin\/parallaize-selkies"/);
  assert.match(execCall?.[5] ?? "", /DESKTOP_SERVICE_NAME="parallaize-selkies\.service"/);
  assert.match(execCall?.[5] ?? "", /SELKIES_PORT="6080"/);
  assert.match(execCall?.[5] ?? "", /SELKIES_ENABLE_RESIZE="true"/);
  assert.match(execCall?.[5] ?? "", /SELKIES_STUN_HOST="stun\.example\.com"/);
  assert.match(execCall?.[5] ?? "", /SELKIES_STUN_PORT="3478"/);
  assert.match(execCall?.[5] ?? "", /SELKIES_TURN_HOST="turn\.example\.com"/);
  assert.match(execCall?.[5] ?? "", /SELKIES_TURN_PORT="5349"/);
  assert.match(execCall?.[5] ?? "", /SELKIES_TURN_PROTOCOL="tcp"/);
  assert.match(execCall?.[5] ?? "", /SELKIES_TURN_TLS="true"/);
  assert.match(execCall?.[5] ?? "", /SELKIES_TURN_SHARED_SECRET="shared-secret"/);
  assert.match(execCall?.[5] ?? "", /SELKIES_TURN_REST_URI="https:\/\/turn\.example\.com\/api"/);
  assert.match(execCall?.[5] ?? "", /SELKIES_TURN_REST_USERNAME="selkies-host"/);
  assert.match(execCall?.[5] ?? "", /DESKTOP_HOME="\/home\/ubuntu"/);
  assert.match(execCall?.[5] ?? "", /SELKIES_STATE_DIR="\$DESKTOP_HOME\/\.cache\/parallaize-selkies"/);
  assert.match(execCall?.[5] ?? "", /SELKIES_JSON_CONFIG="\$SELKIES_STATE_DIR\/selkies_config\.json"/);
  assert.match(execCall?.[5] ?? "", /SELKIES_RTC_CONFIG_JSON="\$SELKIES_STATE_DIR\/rtc\.json"/);
  assert.match(execCall?.[5] ?? "", /DESKTOP_RUNTIME_DIR="\/run\/user\/\$DESKTOP_UID"/);
  assert.match(execCall?.[5] ?? "", /export XDG_RUNTIME_DIR="\/run\/user\/\$DESKTOP_UID"/);
  assert.match(execCall?.[5] ?? "", /install -d -m 700 -o "\$DESKTOP_UID" -g "\$DESKTOP_GID" "\$SELKIES_STATE_DIR"/);
  assert.match(execCall?.[5] ?? "", /exec runuser --preserve-environment -u "\$DESKTOP_USER" -- env DISPLAY="\$DISPLAY" XAUTHORITY="\$XAUTHORITY" "\$SELKIES_RUNNER"/);
  assert.doesNotMatch(execCall?.[5] ?? "", /parallaize-x11vnc\.service/);
});

test("manager allows running Selkies desktops to apply display resolution changes", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-selkies-resolution-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  let capturedResolution: { height: number; vmId: string; width: number } | null = null;
  provider.setDisplayResolution = async (vm, width, height) => {
    capturedResolution = {
      height,
      vmId: vm.id,
      width,
    };
  };

  const state = createSeedState(provider.state);
  state.vms[0] = {
    ...state.vms[0]!,
    desktopTransport: "selkies",
    session: {
      kind: "selkies",
      host: "10.55.0.42",
      port: 6080,
      reachable: true,
      webSocketPath: null,
      browserPath: "/selkies-vm-0001/",
      display: "10.55.0.42:6080",
    },
  };

  const store = new JsonStateStore(join(tempDir, "state.json"), () => state);
  store.save(state);
  const manager = new DesktopManager(store, provider);

  await manager.setVmResolution("vm-0001", {
    width: 1365,
    height: 767,
  });

  assert.deepEqual(capturedResolution, {
    height: 767,
    vmId: "vm-0001",
    width: 1365,
  });
});

test("manager allows running Guacamole desktops to apply display resolution changes", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-guacamole-resolution-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const provider = createProvider("mock", "incus");
  let capturedResolution: { height: number; vmId: string; width: number } | null = null;
  provider.setDisplayResolution = async (vm, width, height) => {
    capturedResolution = {
      height,
      vmId: vm.id,
      width,
    };
  };

  const state = createSeedState(provider.state);
  state.vms[0] = {
    ...state.vms[0]!,
    desktopTransport: "guacamole",
    session: {
      kind: "guacamole",
      host: "10.55.0.43",
      port: 5900,
      reachable: true,
      webSocketPath: "/api/vms/vm-0001/guacamole",
      browserPath: "/?vm=vm-0001",
      display: "10.55.0.43:5900",
    },
  };

  const store = new JsonStateStore(join(tempDir, "state.json"), () => state);
  store.save(state);
  const manager = new DesktopManager(store, provider);

  await manager.setVmResolution("vm-0001", {
    width: 1536,
    height: 864,
  });

  assert.deepEqual(capturedResolution, {
    height: 864,
    vmId: "vm-0001",
    width: 1536,
  });
});

test("incus provider reads VM logs from the console stream and falls back to info output", async () => {
  const instanceName = "parallaize-vm-0200-log-reader";
  let consoleAttempts = 0;
  const provider = createProvider("incus", "incus", {
    commandRunner: {
      execute(args: string[]) {
        if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
          return ok("[]", args);
        }

        if (args[0] === "console" && args[1] === instanceName && args[2] === "--show-log") {
          consoleAttempts += 1;
          return ok(consoleAttempts === 1 ? "Boot complete\n" : "", args);
        }

        if (args[0] === "info" && args[1] === instanceName && args[2] === "--show-log") {
          return ok("Fallback info log\nAgent connected\n", args);
        }

        return ok("", args);
      },
    },
  });

  const vm: VmInstance = {
    id: "vm-0200",
    name: "log-reader",
    templateId: "tpl-0001",
    provider: "incus",
    providerRef: instanceName,
    status: "running",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: new Date().toISOString(),
    lastAction: "Running",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 200,
    activeWindow: "logs",
    workspacePath: "/root",
    session: null,
    forwardedPorts: [],
    activityLog: [],
  };

  const consoleLogs = await provider.readVmLogs(vm);
  assert.equal(consoleLogs.source, "incus console --show-log");
  assert.equal(consoleLogs.providerRef, instanceName);
  assert.match(consoleLogs.content, /Boot complete/);

  const fallbackLogs = await provider.readVmLogs(vm);
  assert.equal(fallbackLogs.source, "incus info --show-log");
  assert.match(fallbackLogs.content, /Fallback info log/);
  assert.match(fallbackLogs.content, /Agent connected/);
});

test("incus provider prefers Selkies service logs while the browser route is still missing", async () => {
  const instanceName = "parallaize-vm-0200-selkies-service-logs";
  let execCalls = 0;
  let consoleCalls = 0;
  let infoCalls = 0;
  const provider = createProvider("incus", "incus", {
    commandRunner: {
      execute(args: string[]) {
        if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
          return ok("[]", args);
        }

        if (
          args[0] === "exec" &&
          args[1] === instanceName &&
          args[2] === "--cwd" &&
          args[3] === "/" &&
          args[4] === "--" &&
          args[5] === "sh" &&
          args[6] === "-lc"
        ) {
          execCalls += 1;
          assert.match(args[7] ?? "", /parallaize-selkies\.service/);
          assert.match(args[7] ?? "", /journalctl -u "\$SERVICE_NAME" -n 200/);
          return ok(
            `== desktop service ==
parallaize-selkies.service

ActiveState=failed

== journalctl ==
Apr 02 00:00:00 selkies restart loop
`,
            args,
          );
        }

        if (args[0] === "console" && args[1] === instanceName && args[2] === "--show-log") {
          consoleCalls += 1;
          return ok(`Boot complete\n`, args);
        }

        if (args[0] === "info" && args[1] === instanceName && args[2] === "--show-log") {
          infoCalls += 1;
          return ok(`Fallback info log\n`, args);
        }

        return ok("", args);
      },
    },
  });

  const vm: VmInstance = {
    id: "vm-0200-selkies",
    name: "selkies-log-reader",
    templateId: "tpl-0001",
    provider: "incus",
    providerRef: instanceName,
    status: "running",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: new Date().toISOString(),
    lastAction: "Running",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 201,
    activeWindow: "logs",
    workspacePath: "/root",
    desktopTransport: "selkies",
    session: null,
    forwardedPorts: [],
    activityLog: [],
  };

  const logs = await provider.readVmLogs(vm);

  assert.equal(logs.source, "guest desktop service logs (parallaize-selkies.service)");
  assert.equal(execCalls, 1);
  assert.equal(consoleCalls, 0);
  assert.equal(infoCalls, 0);
  assert.match(logs.content, /ActiveState=failed/);
  assert.match(logs.content, /selkies restart loop/);
});

test("incus provider streams live VM log chunks from the console", async () => {
  const instanceName = "parallaize-vm-0201-live-log-reader";
  let closeCalled = false;
  const provider = createProvider("incus", "incus", {
    commandRunner: {
      execute(args: string[]) {
        if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
          return ok("[]", args);
        }

        return ok("", args);
      },
      startStreaming(args: string[], listeners = {}) {
        assert.deepEqual(args, ["console", instanceName]);
        listeners.onStdout?.("Booting\r\nReady\r\n");

        return {
          close() {
            closeCalled = true;
          },
          completed: Promise.resolve(ok("", args)),
        };
      },
    },
  });

  const vm: VmInstance = {
    id: "vm-0201",
    name: "live-log-reader",
    templateId: "tpl-0001",
    provider: "incus",
    providerRef: instanceName,
    status: "running",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: new Date().toISOString(),
    lastAction: "Running",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 201,
    activeWindow: "logs",
    workspacePath: "/root",
    session: null,
    forwardedPorts: [],
    activityLog: [],
  };

  const chunks: string[] = [];
  const errors: string[] = [];
  let closed = false;

  if (!provider.streamVmLogs) {
    throw new Error("Expected the Incus provider to expose a live log stream.");
  }

  const handle = provider.streamVmLogs(vm, {
    onAppend(chunk) {
      chunks.push(chunk);
    },
    onClose() {
      closed = true;
    },
    onError(error) {
      errors.push(error.message);
    },
  });

  await Promise.resolve();

  assert.deepEqual(chunks, ["Booting\nReady\n"]);
  assert.deepEqual(errors, []);
  assert.equal(closed, true);

  handle.close();
  assert.equal(closeCalled, true);
});

test("incus provider treats non-tty console tail failures as a quiet close", async () => {
  const instanceName = "parallaize-vm-0201-live-log-ioctl";
  const provider = createProvider("incus", "incus", {
    commandRunner: {
      execute(args: string[]) {
        if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
          return ok("[]", args);
        }

        return ok("", args);
      },
      startStreaming(args: string[]) {
        assert.deepEqual(args, ["console", instanceName]);

        return {
          close() {},
          completed: Promise.resolve({
            args,
            status: 1,
            stdout: "",
            stderr: "Error: inappropriate ioctl for device",
          }),
        };
      },
    },
  });

  const vm: VmInstance = {
    id: "vm-0201",
    name: "live-log-ioctl",
    templateId: "tpl-0001",
    provider: "incus",
    providerRef: instanceName,
    status: "running",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: new Date().toISOString(),
    lastAction: "Running",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 202,
    activeWindow: "logs",
    workspacePath: "/root",
    session: null,
    forwardedPorts: [],
    activityLog: [],
  };

  const errors: string[] = [];
  let closed = false;

  if (!provider.streamVmLogs) {
    throw new Error("Expected the Incus provider to expose a live log stream.");
  }

  provider.streamVmLogs(vm, {
    onClose() {
      closed = true;
    },
    onError(error) {
      errors.push(error.message);
    },
  });

  await Promise.resolve();

  assert.equal(closed, true);
  assert.deepEqual(errors, []);
});

test("incus provider parses guest disk usage snapshots and flags low free space", async () => {
  const calls: string[][] = [];
  const instanceName = "parallaize-vm-0200-disk-usage";
  const provider = createProvider("incus", "incus", {
    commandRunner: {
      execute(args: string[]) {
        calls.push(args);

        if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
          return ok("[]", args);
        }

        if (args[0] === "exec" && args[1] === instanceName) {
          return ok(
            JSON.stringify({
              root: {
                path: "/",
                mountPath: "/",
                filesystem: "/dev/sda2",
                sizeBytes: 64 * 1024 ** 3,
                usedBytes: 52 * 1024 ** 3,
                availableBytes: 12 * 1024 ** 3,
                usedPercent: 81,
              },
              workspace: {
                path: "/srv/workspaces/alpha",
                mountPath: "/srv/workspaces",
                filesystem: "/dev/sdb1",
                sizeBytes: 20 * 1024 ** 3,
                usedBytes: 18 * 1024 ** 3,
                availableBytes: 2 * 1024 ** 3,
                usedPercent: 90,
              },
            }),
            args,
          );
        }

        return ok("", args);
      },
    },
  });

  const vm: VmInstance = {
    id: "vm-0200",
    name: "disk-usage",
    templateId: "tpl-0001",
    provider: "incus",
    providerRef: instanceName,
    status: "running",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: new Date().toISOString(),
    lastAction: "Running",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 200,
    activeWindow: "browser",
    workspacePath: "/srv/workspaces/alpha",
    session: null,
    forwardedPorts: [],
    activityLog: [],
  };

  const snapshot = await provider.readVmDiskUsage?.(vm);
  assert.ok(snapshot);
  assert.equal(snapshot?.status, "warning");
  assert.equal(snapshot?.workspace?.mountPath, "/srv/workspaces");
  assert.equal(snapshot?.workspace?.availableBytes, 2 * 1024 ** 3);
  assert.match(snapshot?.detail ?? "", /drops under 1 GB free/);

  const execCall = calls.find((args) => args[0] === "exec" && args[1] === instanceName);
  assert.ok(execCall);
  const script = execCall?.at(-1) ?? "";
  assert.match(script, /df", "-B1", "-P"/);
  assert.match(script, /workspace_path = "\/srv\/workspaces\/alpha"/);
});

test("incus provider emits Python None for the default file browse request", async () => {
  const calls: string[][] = [];
  const instanceName = "parallaize-vm-0200-file-browser";
  const provider = createProvider("incus", "incus", {
    commandRunner: {
      execute(args: string[]) {
        calls.push(args);

        if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
          return ok("[]", args);
        }

        if (args[0] === "exec" && args[1] === instanceName) {
          return ok(
            JSON.stringify({
              homePath: "/home/ubuntu",
              currentPath: "/home/ubuntu",
              entries: [],
            }),
            args,
          );
        }

        return ok("", args);
      },
    },
  });

  const vm: VmInstance = {
    id: "vm-0200",
    name: "file-browser",
    templateId: "tpl-0001",
    provider: "incus",
    providerRef: instanceName,
    status: "running",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: new Date().toISOString(),
    lastAction: "Running",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 200,
    activeWindow: "browser",
    workspacePath: "/root",
    session: null,
    forwardedPorts: [],
    activityLog: [],
  };

  const snapshot = await provider.browseVmFiles(vm);
  assert.equal(snapshot.homePath, "/home/ubuntu");
  assert.equal(snapshot.currentPath, "/home/ubuntu");

  const execCall = calls.find((args) => args[0] === "exec" && args[1] === instanceName);
  assert.ok(execCall);

  const script = execCall?.at(-1) ?? "";
  assert.match(script, /requested_path = None/);
  assert.doesNotMatch(script, /requested_path = null/);
});

test("incus provider prefers /home/ubuntu for touched file scans when it exists", async () => {
  const calls: string[][] = [];
  const instanceName = "parallaize-vm-0200-touched-files";
  const provider = createProvider("incus", "incus", {
    commandRunner: {
      execute(args: string[]) {
        calls.push(args);

        if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
          return ok("[]", args);
        }

        if (args[0] === "exec" && args[1] === instanceName) {
          return ok(
            JSON.stringify({
              scanPath: "/home/ubuntu",
              truncated: false,
              entries: [
                {
                  name: "project",
                  path: "/home/ubuntu/project",
                  kind: "directory",
                  sizeBytes: null,
                  modifiedAt: new Date().toISOString(),
                  changedAt: new Date().toISOString(),
                  reasons: ["mtime"],
                },
              ],
            }),
            args,
          );
        }

        return ok("", args);
      },
    },
  });

  const vm: VmInstance = {
    id: "vm-0200",
    name: "touched-files",
    templateId: "tpl-0001",
    provider: "incus",
    providerRef: instanceName,
    status: "running",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: new Date().toISOString(),
    lastAction: "Running",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 200,
    activeWindow: "browser",
    workspacePath: "/root",
    session: null,
    forwardedPorts: [],
    activityLog: [],
    commandHistory: [
      {
        command: "cd /home/ubuntu/project",
        output: [],
        workspacePath: "/home/ubuntu/project",
        createdAt: new Date().toISOString(),
      },
      {
        command: "cd /home/ubuntu/.cache/f",
        output: [],
        workspacePath: "/home/ubuntu/.cache/f",
        createdAt: new Date().toISOString(),
      },
    ],
  };

  const snapshot = await provider.readVmTouchedFiles(vm);
  assert.equal(snapshot.workspacePath, "/root");
  assert.equal(snapshot.scanPath, "/home/ubuntu");
  assert.ok(snapshot.entries.some((entry) => entry.path === "/home/ubuntu/project"));
  assert.ok(snapshot.entries.every((entry) => !entry.path.startsWith("/home/ubuntu/.cache")));
  assert.match(snapshot.limitationSummary, /\/home\/ubuntu\/\.cache is ignored/);

  const execCall = calls.find((args) => args[0] === "exec" && args[1] === instanceName);
  assert.ok(execCall);

  const script = execCall?.at(-1) ?? "";
  assert.match(script, /scan_path = "\/home\/ubuntu" if os\.path\.isdir\("\/home\/ubuntu"\) else workspace_path/);
  assert.match(script, /ignored_paths = \{/);
  assert.match(script, /dirnames\[:\] = \[/);
  assert.match(script, /os\.walk\(scan_path\)/);
});

test("incus provider resource resize only updates changed limits and preserves the current session", async () => {
  const calls: string[][] = [];
  const instanceName = "parallaize-vm-0200-resize-fast";
  let probed = false;
  const runner = {
    execute(args: string[]) {
      calls.push(args);

      if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
        return ok("[]", args);
      }

      if (args[0] === "query" && args[1] === `/1.0/instances/${instanceName}`) {
        return expandedRootDevice(args, "disk0");
      }

      return ok("", args);
    },
  };

  const provider = createProvider("incus", "incus", {
    commandRunner: runner,
    guestPortProbe: {
      async probe() {
        probed = true;
        return false;
      },
    },
  });

  const currentSession = {
    kind: "vnc" as const,
    host: "10.55.0.88",
    port: 5900,
    webSocketPath: "/api/vms/vm-0200/vnc",
    browserPath: "/?vm=vm-0200",
    display: "10.55.0.88:5900",
  };

  const vm: VmInstance = {
    id: "vm-0200",
    name: "resize-fast",
    templateId: "tpl-0001",
    provider: "incus",
    providerRef: instanceName,
    status: "running",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: new Date().toISOString(),
    lastAction: "Running",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 42,
    activeWindow: "terminal",
    workspacePath: "/root",
    session: currentSession,
    forwardedPorts: [],
    activityLog: [],
  };

  const mutation = await provider.resizeVm(vm, {
    cpu: 8,
    ramMb: 8192,
    diskGb: 60,
  });

  const cpuSetCall = calls.find(
    (args) =>
      args[0] === "config" &&
      args[1] === "set" &&
      args[2] === instanceName &&
      args[3] === "limits.cpu=8",
  );
  const statefulSetCall = calls.find(
    (args) =>
      args[0] === "config" &&
      args[1] === "set" &&
      args[2] === instanceName &&
      args[3] === "migration.stateful=true",
  );
  const deviceOverrideCall = calls.find(
    (args) =>
      args[0] === "config" &&
      args[1] === "device" &&
      args[2] === "override" &&
      args[3] === instanceName &&
      args[4] === "disk0" &&
      args[5] === "size.state=9012MiB",
  );
  const deviceSetCall = calls.find(
    (args) =>
      args[0] === "config" &&
      args[1] === "device" &&
      args[2] === "set" &&
      args[3] === instanceName,
  );

  assert.deepEqual(cpuSetCall, [
    "config",
    "set",
    instanceName,
    "limits.cpu=8",
  ]);
  assert.deepEqual(statefulSetCall, [
    "config",
    "set",
    instanceName,
    "migration.stateful=true",
  ]);
  assert.deepEqual(deviceOverrideCall, [
    "config",
    "device",
    "override",
    instanceName,
    "disk0",
    "size.state=9012MiB",
  ]);
  assert.equal(deviceSetCall, undefined);
  assert.equal(probed, false);
  assert.deepEqual(mutation.session, currentSession);
  assert.deepEqual(mutation.activity, [
    `incus: resized ${instanceName}`,
    "limits: cpu=8",
  ]);
});

test("incus provider resizes the expanded root disk device even when it is not named root", async () => {
  const calls: string[][] = [];
  const instanceName = "parallaize-vm-0200-resize-disk";
  const runner = {
    execute(args: string[]) {
      calls.push(args);

      if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
        return ok("[]", args);
      }

      if (args[0] === "query" && args[1] === `/1.0/instances/${instanceName}`) {
        return expandedRootDevice(args, "osdisk");
      }

      if (
        args[0] === "config" &&
        args[1] === "device" &&
        args[2] === "override" &&
        args[3] === instanceName &&
        args[4] === "osdisk"
      ) {
        return {
          args,
          status: 1,
          stdout: "",
          stderr: "Error: The device already exists",
        };
      }

      return ok("", args);
    },
  };

  const provider = createProvider("incus", "incus", {
    commandRunner: runner,
  });

  const vm: VmInstance = {
    id: "vm-0200",
    name: "resize-disk",
    templateId: "tpl-0001",
    provider: "incus",
    providerRef: instanceName,
    status: "running",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: new Date().toISOString(),
    lastAction: "Running",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 42,
    activeWindow: "terminal",
    workspacePath: "/root",
    session: null,
    forwardedPorts: [],
    activityLog: [],
  };

  const mutation = await provider.resizeVm(vm, {
    cpu: 4,
    ramMb: 8192,
    diskGb: 90,
  });

  assert.ok(
    calls.some(
      (args) =>
        args[0] === "config" &&
        args[1] === "device" &&
        args[2] === "override" &&
        args[3] === instanceName &&
        args[4] === "osdisk" &&
        args[5] === "size=90GiB",
    ),
  );
  assert.ok(
    calls.some(
      (args) =>
        args[0] === "config" &&
        args[1] === "device" &&
        args[2] === "set" &&
        args[3] === instanceName &&
        args[4] === "osdisk" &&
        args[5] === "size=90GiB",
    ),
  );
  assert.deepEqual(mutation.activity, [
    `incus: resized ${instanceName}`,
    "limits: disk=90GiB",
  ]);
});

test("incus provider targets the configured storage pool for creates and copies", async () => {
  const calls: string[][] = [];
  const sourceInstanceName = "parallaize-vm-0200-storage-origin";
  const targetInstanceName = "parallaize-vm-0201-storage-clone";
  const snapshotTargetInstanceName = "parallaize-vm-0202-storage-snapshot";
  const statefulCloneInstanceName = "parallaize-vm-0203-storage-clone-live";
  const instanceAddresses = new Map<string, string>([
    [sourceInstanceName, "10.55.1.20"],
    [targetInstanceName, "10.55.1.21"],
    [snapshotTargetInstanceName, "10.55.1.22"],
    [statefulCloneInstanceName, "10.55.1.23"],
  ]);
  const runner = {
    execute(args: string[]) {
      calls.push(args);

      if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
        return ok("[]", args);
      }

      if (args[0] === "list" && args[2] === "--format" && args[3] === "json") {
        const address = instanceAddresses.get(args[1]);

        if (!address) {
          return ok("[]", args);
        }

        return ok(
          JSON.stringify([
            {
              name: args[1],
              status: "Running",
              state: {
                status: "Running",
                network: {
                  enp5s0: {
                    addresses: [
                      {
                        family: "inet",
                        scope: "global",
                        address,
                      },
                    ],
                  },
                },
              },
            },
          ]),
          args,
        );
      }

      if (args[0] === "query" && args[1] === `/1.0/instances/${sourceInstanceName}`) {
        return expandedRootDevice(args, "root", {
          config: {
            "migration.stateful": "true",
          },
          status: "Running",
        });
      }

      if (
        args[0] === "query" &&
        [
          `/1.0/instances/${targetInstanceName}`,
          `/1.0/instances/${snapshotTargetInstanceName}`,
          `/1.0/instances/${statefulCloneInstanceName}`,
        ].includes(args[1])
      ) {
        return expandedRootDevice(args);
      }

      return ok("", args);
    },
  };

  const provider = createProvider("incus", "incus", {
    storagePool: "fastpool",
    guestVncPort: 5901,
    commandRunner: runner,
    guestPortProbe: {
      async probe() {
        return true;
      },
    },
  });

  const template: EnvironmentTemplate = {
    id: "tpl-0200",
    name: "Storage Pool Template",
    description: "Verifies Incus storage targeting",
    launchSource: "images:ubuntu/noble/desktop",
    defaultResources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    defaultForwardedPorts: [],
    initCommands: [],
    tags: [],
    notes: [],
    snapshotIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const sourceVm: VmInstance = {
    id: "vm-0200",
    name: "storage-origin",
    templateId: template.id,
    provider: "incus",
    providerRef: sourceInstanceName,
    status: "running",
    resources: template.defaultResources,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: new Date().toISOString(),
    lastAction: "Running",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 20,
    activeWindow: "terminal",
    workspacePath: "/root",
    session: {
      kind: "vnc",
      host: "10.55.1.20",
      port: 5901,
      webSocketPath: "/api/vms/vm-0200/vnc",
      browserPath: "/?vm=vm-0200",
      display: "10.55.1.20:5901",
    },
    forwardedPorts: [],
    activityLog: [],
  };

  const targetVm: VmInstance = {
    ...sourceVm,
    id: "vm-0201",
    name: "storage-clone",
    providerRef: targetInstanceName,
    session: null,
  };

  const snapshotTargetVm: VmInstance = {
    ...sourceVm,
    id: "vm-0202",
    name: "storage-snapshot",
    providerRef: snapshotTargetInstanceName,
    session: null,
  };

  const statefulTargetVm: VmInstance = {
    ...sourceVm,
    id: "vm-0203",
    name: "storage-clone-live",
    providerRef: statefulCloneInstanceName,
    session: null,
  };

  await provider.createVm(
    {
      ...sourceVm,
      status: "creating",
      liveSince: null,
      session: null,
    },
    template,
  );
  await provider.cloneVm(sourceVm, targetVm, template);
  await provider.cloneVm(sourceVm, statefulTargetVm, template, undefined, {
    stateful: true,
  });
  await provider.launchVmFromSnapshot(
    {
      id: "snap-0200",
      vmId: sourceVm.id,
      templateId: template.id,
      label: "checkpoint",
      summary: "Snapshot checkpoint captured from storage-origin.",
      providerRef: `${sourceInstanceName}/parallaize-snap-checkpoint`,
      stateful: false,
      resources: template.defaultResources,
      createdAt: new Date().toISOString(),
    },
    snapshotTargetVm,
    template,
  );

  assert.ok(
    calls.some(
      (args) =>
        args[0] === "init" &&
        args[1] === template.launchSource &&
        args[2] === sourceInstanceName &&
        args.includes("-s") &&
        args.includes("fastpool"),
    ),
  );
  assert.ok(
    calls.some(
      (args) =>
        args[0] === "copy" &&
        args[1] === sourceInstanceName &&
        args[2] === targetInstanceName &&
        args.includes("-s") &&
        args.includes("fastpool") &&
        args.includes("--stateless"),
    ),
  );
  assert.ok(
    calls.some(
      (args) =>
        args[0] === "copy" &&
        args[1] === sourceInstanceName &&
        args[2] === statefulCloneInstanceName &&
        args.includes("-s") &&
        args.includes("fastpool") &&
        !args.includes("--stateless"),
    ),
  );
  assert.ok(
    calls.some(
      (args) =>
        args[0] === "copy" &&
        args[1] === `${sourceInstanceName}/parallaize-snap-checkpoint` &&
        args[2] === snapshotTargetInstanceName &&
        args.includes("-s") &&
        args.includes("fastpool"),
    ),
  );
  assert.ok(
    calls.some(
      (args) =>
        args[0] === "config" &&
        args[1] === "device" &&
        args[2] === "override" &&
        args[3] === sourceInstanceName &&
        args[5] === "size=60GiB",
    ),
  );
  assert.ok(
    calls.some(
      (args) =>
        args[0] === "config" &&
        args[1] === "device" &&
        args[2] === "override" &&
        args[3] === targetInstanceName &&
        args[5] === "size=60GiB",
    ),
  );
  assert.ok(
    calls.some(
      (args) =>
        args[0] === "config" &&
        args[1] === "device" &&
        args[2] === "override" &&
        args[3] === snapshotTargetInstanceName &&
        args[5] === "size=60GiB",
    ),
  );
});

test("incus provider launches and restores snapshots with VM commands", async () => {
  const calls: string[][] = [];
  const sourceInstanceName = "parallaize-vm-0109-snap-origin";
  const targetInstanceName = "parallaize-vm-0110-snap-launch";
  const statefulTargetInstanceName = "parallaize-vm-0111-snap-launch-live";
  let bootstrapScript = "";
  const addAttempts = new Map<string, number>();
  const instanceAddresses = new Map<string, string>([
    [sourceInstanceName, "10.55.0.21"],
    [targetInstanceName, "10.55.0.22"],
    [statefulTargetInstanceName, "10.55.0.23"],
  ]);
  const runner = {
    execute(args: string[], options?: { input?: Buffer | string }) {
      calls.push(args);
      const input = readCommandInput(options);

      if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
        return ok("[]", args);
      }

      if (args[0] === "list" && args[2] === "--format" && args[3] === "json") {
        const address = instanceAddresses.get(args[1]);

        if (!address) {
          return ok("[]", args);
        }

        return ok(
          JSON.stringify([
            {
              name: args[1],
              status: "Running",
              state: {
                status: "Running",
                network: {
                  enp5s0: {
                    addresses: [
                      {
                        family: "inet",
                        scope: "global",
                        address,
                      },
                    ],
                  },
                },
              },
            },
          ]),
          args,
        );
      }

      if (
        args[0] === "query" &&
        [
          `/1.0/instances/${sourceInstanceName}`,
          `/1.0/instances/${targetInstanceName}`,
          `/1.0/instances/${statefulTargetInstanceName}`,
        ].includes(
          args[1],
        )
      ) {
        return expandedRootDevice(args, "disk0");
      }

      if (
        args[0] === "exec" &&
        [targetInstanceName, statefulTargetInstanceName].includes(args[1]) &&
        input.includes('BOOTSTRAP_FILE="/usr/local/bin/parallaize-desktop-bootstrap"')
      ) {
        bootstrapScript = input;
        return ok("", args);
      }

      if (
        args[0] === "config" &&
        args[1] === "device" &&
        args[2] === "add" &&
        args[3] === sourceInstanceName &&
        args[4] === "agent"
      ) {
        const attempts = (addAttempts.get(sourceInstanceName) ?? 0) + 1;
        addAttempts.set(sourceInstanceName, attempts);

        if (attempts === 1) {
          return {
            args,
            status: 1,
            stdout: "",
            stderr: "Error: The device already exists",
          };
        }
      }

      return ok("", args);
    },
  };

  const provider = createProvider("incus", "incus", {
    guestVncPort: 5901,
    commandRunner: runner,
    guestPortProbe: {
      async probe() {
        return true;
      },
    },
  });

  const template: EnvironmentTemplate = {
    id: "tpl-0109",
    name: "Snapshot Launch Template",
    description: "Used to validate snapshot workflows",
    launchSource: "images:ubuntu/noble/desktop",
    defaultResources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    defaultForwardedPorts: [],
    initCommands: [],
    tags: [],
    notes: [],
    snapshotIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const sourceVm: VmInstance = {
    id: "vm-0109",
    name: "snap-origin",
    templateId: template.id,
    provider: "incus",
    providerRef: sourceInstanceName,
    status: "running",
    resources: template.defaultResources,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: new Date().toISOString(),
    lastAction: "Running",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 17,
    activeWindow: "terminal",
    workspacePath: "/root",
    session: {
      kind: "vnc",
      host: "10.55.0.21",
      port: 5901,
      webSocketPath: "/api/vms/vm-0109/vnc",
      browserPath: "/?vm=vm-0109",
      display: "10.55.0.21:5901",
    },
    forwardedPorts: [],
    activityLog: [],
  };

  const targetVm: VmInstance = {
    id: "vm-0110",
    name: "snap-launch",
    wallpaperName: "silver-falcon",
    templateId: template.id,
    provider: "incus",
    providerRef: targetInstanceName,
    status: "creating",
    resources: template.defaultResources,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: null,
    lastAction: "Queued",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 18,
    activeWindow: "terminal",
    workspacePath: "/root",
    session: null,
    forwardedPorts: [],
    activityLog: [],
  };

  const snapshot = {
    id: "snap-0109",
    vmId: sourceVm.id,
    templateId: template.id,
    label: "checkpoint",
    summary: "Snapshot checkpoint captured from snap-origin.",
    providerRef: `${sourceInstanceName}/parallaize-snap-checkpoint`,
    stateful: false,
    resources: template.defaultResources,
    createdAt: new Date().toISOString(),
  };

  const statefulSnapshot = await provider.snapshotVm(sourceVm, "checkpoint-live", {
    stateful: true,
  });
  assert.equal(statefulSnapshot.stateful, true);
  assert.ok(
    calls.some(
      (args) =>
        args[0] === "snapshot" &&
        args[1] === "create" &&
        args[2] === sourceInstanceName &&
        args.includes("--stateful"),
    ),
  );

  const launchMutation = await provider.launchVmFromSnapshot(snapshot, targetVm, template);
  assert.equal(launchMutation.session?.display, "10.55.0.22:5901");
  const copyCall = calls.find(
    (args) =>
      args[0] === "copy" &&
      args[1] === snapshot.providerRef &&
      args[2] === targetInstanceName,
  );
  assert.notEqual(bootstrapScript, "");
  assert.match(bootstrapScript, /https:\/\/wallpapers\.parallaize\.com\/24\.04\/silver-falcon\.jpg/);
  assert.match(bootstrapScript, /desktop-wallpaper-source/);
  assert.match(bootstrapScript, /DESKTOP_HEALTH_GRACE_SECONDS=10/);
  assert.match(bootstrapScript, /DESKTOP_GDM_RESTART_COOLDOWN_SECONDS=15/);
  assert.ok(copyCall);
  assert.ok(!copyCall?.includes("--instance-only"));

  const statefulLaunchCallIndex = calls.length;
  const statefulLaunchMutation = await provider.launchVmFromSnapshot(
    {
      ...snapshot,
      id: "snap-0111",
      label: "checkpoint-live",
      providerRef: statefulSnapshot.providerRef,
      summary: statefulSnapshot.summary,
      stateful: true,
    },
    {
      ...targetVm,
      id: "vm-0111",
      providerRef: statefulTargetInstanceName,
      name: "snapshot-launch-live",
    },
    template,
  );
  const statefulLaunchCalls = calls.slice(statefulLaunchCallIndex);
  const statefulLaunchCopyCall = statefulLaunchCalls.find(
    (args) =>
      args[0] === "copy" &&
      args[1] === statefulSnapshot.providerRef &&
      args[2] === statefulTargetInstanceName,
  );
  assert.equal(statefulLaunchMutation.session?.display, "10.55.0.23:5901");
  assert.ok(statefulLaunchCopyCall?.includes("--stateless"));
  assert.ok(
    statefulLaunchMutation.activity.some((entry) =>
      entry.includes("Incus cannot rename a stateful snapshot copy"),
    ),
  );
  assert.ok(
    calls.some(
      (args) =>
        args[0] === "config" &&
        args[1] === "device" &&
        args[2] === "override" &&
        args[3] === targetInstanceName &&
        args[4] === "disk0" &&
        args[5] === "size=60GiB",
    ),
  );

  const restoreMutation = await provider.restoreVmToSnapshot(sourceVm, snapshot);
  assert.equal(restoreMutation.session?.display, "10.55.0.21:5901");
  assert.ok(
    calls.some(
      (args) =>
        args[0] === "snapshot" &&
        args[1] === "restore" &&
        args[2] === sourceInstanceName &&
        args[3] === "parallaize-snap-checkpoint",
    ),
  );
  assert.ok(
    calls.some(
      (args) =>
        args[0] === "config" &&
        args[1] === "device" &&
        args[2] === "remove" &&
        args[3] === sourceInstanceName &&
        args[4] === "agent",
    ),
  );

  const statefulRestoreCallIndex = calls.length;
  const statefulSnapshotName = statefulSnapshot.providerRef.split("/").at(-1);
  const statefulRestoreMutation = await provider.restoreVmToSnapshot(
    {
      ...sourceVm,
      status: "stopped",
      liveSince: null,
      session: null,
    },
    {
      ...snapshot,
      id: "snap-0110",
      label: "checkpoint-live",
      providerRef: statefulSnapshot.providerRef,
      summary: statefulSnapshot.summary,
      stateful: true,
    },
  );
  const statefulRestoreCalls = calls.slice(statefulRestoreCallIndex);
  assert.equal(statefulRestoreMutation.session?.display, "10.55.0.21:5901");
  assert.ok(
    statefulRestoreCalls.some(
      (args) =>
        args[0] === "snapshot" &&
        args[1] === "restore" &&
        args[2] === sourceInstanceName &&
        args[3] === statefulSnapshotName &&
        args.includes("--stateful"),
    ),
  );
  assert.equal(
    statefulRestoreCalls.some(
      (args) => args[0] === "start" && args[1] === sourceInstanceName,
    ),
    false,
  );
});

test("incus provider falls back to IPv6 guest metadata when IPv4 is absent", async () => {
  const instanceName = "parallaize-vm-0100-ipv6-only";
  const runner = {
    execute(args: string[]) {
      if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
        return ok("[]", args);
      }

      if (args[0] === "query" && args[1] === `/1.0/instances/${instanceName}`) {
        return expandedRootDevice(args);
      }

      if (
        args[0] === "list" &&
        ((args[1] === "--format" && args[2] === "json") || args[1] === instanceName)
      ) {
        return ok(
          JSON.stringify([
            {
              name: instanceName,
              status: "Running",
              state: {
                status: "Running",
                network: {
                  enp5s0: {
                    addresses: [
                      {
                        family: "inet6",
                        scope: "global",
                        address: "fd42:f551:1c4c:bffd:1266:6aff:fe27:207e",
                      },
                    ],
                  },
                },
              },
            },
          ]),
          args,
        );
      }

      return ok("", args);
    },
  };

  const provider = createProvider("incus", "incus", {
    guestVncPort: 5900,
    commandRunner: runner,
    guestPortProbe: {
      async probe() {
        return true;
      },
    },
  });

  const template: EnvironmentTemplate = {
    id: "tpl-0100",
    name: "IPv6 Template",
    description: "IPv6-only guest metadata probe",
    launchSource: "images:ubuntu/noble/desktop",
    defaultResources: {
      cpu: 2,
      ramMb: 4096,
      diskGb: 40,
    },
    defaultForwardedPorts: [],
    initCommands: [],
    tags: [],
    notes: [],
    snapshotIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const vm: VmInstance = {
    id: "vm-0100",
    name: "ipv6-only",
    templateId: template.id,
    provider: "incus",
    providerRef: instanceName,
    status: "creating",
    resources: template.defaultResources,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: null,
    lastAction: "Queued",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 11,
    activeWindow: "editor",
    workspacePath: "/root",
    session: null,
    forwardedPorts: [],
    activityLog: [],
  };

  const createMutation = await provider.createVm(vm, template);

  assert.equal(createMutation.session?.host, "fd42:f551:1c4c:bffd:1266:6aff:fe27:207e");
  assert.equal(
    createMutation.session?.display,
    "[fd42:f551:1c4c:bffd:1266:6aff:fe27:207e]:5900",
  );
});

test("incus provider only marks a guest VNC session ready after an RFB handshake", async () => {
  const server = createServer((socket) => {
    socket.write("RFB 003.008\n");

    let received = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);

      if (received.length >= 12) {
        socket.end(Buffer.from([1, 1]));
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to allocate the fake RFB server port.");
  }

  const instanceName = "parallaize-vm-0102-rfb-probe";
  const runner = {
    execute(args: string[]) {
      if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
        return ok("[]", args);
      }

      if (args[0] === "query" && args[1] === `/1.0/instances/${instanceName}`) {
        return expandedRootDevice(args);
      }

      if (
        args[0] === "list" &&
        ((args[1] === "--format" && args[2] === "json") || args[1] === instanceName)
      ) {
        return ok(
          JSON.stringify([
            {
              name: instanceName,
              status: "Running",
              state: {
                status: "Running",
                network: {
                  enp5s0: {
                    addresses: [
                      {
                        family: "inet",
                        scope: "global",
                        address: "127.0.0.1",
                      },
                    ],
                  },
                },
              },
            },
          ]),
          args,
        );
      }

      return ok("", args);
    },
  };

  const provider = createProvider("incus", "incus", {
    guestVncPort: address.port,
    commandRunner: runner,
  });

  const template: EnvironmentTemplate = {
    id: "tpl-0102",
    name: "RFB Probe Template",
    description: "Uses the built-in VNC readiness probe",
    launchSource: "images:ubuntu/noble/desktop",
    defaultResources: {
      cpu: 2,
      ramMb: 4096,
      diskGb: 40,
    },
    defaultForwardedPorts: [],
    initCommands: [],
    tags: [],
    notes: [],
    snapshotIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const vm: VmInstance = {
    id: "vm-0102",
    name: "rfb-probe",
    templateId: template.id,
    provider: "incus",
    providerRef: instanceName,
    status: "creating",
    resources: template.defaultResources,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: null,
    lastAction: "Queued",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 21,
    activeWindow: "editor",
    workspacePath: "/root",
    session: null,
    forwardedPorts: [],
    activityLog: [],
  };

  try {
    const createMutation = await provider.createVm(vm, template);
    assert.equal(createMutation.session?.host, "127.0.0.1");
    assert.equal(createMutation.session?.port, address.port);
    assert.equal(createMutation.session?.display, `127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
});

test("incus provider treats a timed-out stop as success once the VM is stopped", async () => {
  const calls: string[][] = [];
  const instanceName = "parallaize-vm-0101-stop-timeout";

  const runner = {
    execute(args: string[]) {
      calls.push(args);

      if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
        return ok("[]", args);
      }

      if (args[0] === "query" && args[1] === `/1.0/instances/${instanceName}`) {
        return expandedRootDevice(args, "disk0");
      }

      if (args[0] === "stop" && args[1] === instanceName) {
        return {
          args,
          status: 1,
          stdout: "",
          stderr:
            "Error: Failed shutting down instance, status is \"Running\": context deadline exceeded",
        };
      }

      if (args[0] === "list" && args[1] === instanceName) {
        return ok(
          JSON.stringify([
            {
              name: instanceName,
              status: "Stopped",
              state: {
                status: "Stopped",
              },
            },
          ]),
          args,
        );
      }

      if (args[0] === "query" && args[1] === `/1.0/instances/${instanceName}`) {
        return expandedRootDevice(args);
      }

      return ok("", args);
    },
  };

  const provider = createProvider("incus", "incus", {
    commandRunner: runner,
  });

  const vm: VmInstance = {
    id: "vm-0101",
    name: "stop-timeout",
    templateId: "tpl-0001",
    provider: "incus",
    providerRef: instanceName,
    status: "running",
    resources: {
      cpu: 2,
      ramMb: 4096,
      diskGb: 30,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: new Date().toISOString(),
    lastAction: "Running",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 5,
    activeWindow: "terminal",
    workspacePath: "/root",
    session: {
      kind: "vnc",
      host: "10.10.0.9",
      port: 5900,
      webSocketPath: "/api/vms/vm-0101/vnc",
      browserPath: "/?vm=vm-0101",
      display: "10.10.0.9:5900",
    },
    forwardedPorts: [],
    activityLog: [],
  };

  const mutation = await provider.stopVm(vm);

  assert.equal(mutation.lastAction, "Workspace stopped");
  assert.equal(
    calls.some((args) => args[0] === "stop" && args.includes("--force")),
    false,
  );
});

test("incus provider treats a missing instance during delete as already removed", async () => {
  const calls: string[][] = [];
  const instanceName = "parallaize-vm-0102-missing-delete";

  const runner = {
    execute(args: string[]) {
      calls.push(args);

      if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
        return ok("[]", args);
      }

      if (args[0] === "delete" && args[1] === instanceName) {
        return {
          args,
          status: 1,
          stdout: "",
          stderr:
            `Error: Failed checking instance exists "local:${instanceName}": Failed to fetch instance "${instanceName}" in project "default": Instance not found`,
        };
      }

      return ok("", args);
    },
  };

  const provider = createProvider("incus", "incus", {
    commandRunner: runner,
  });

  const vm: VmInstance = {
    id: "vm-0102",
    name: "missing-delete",
    templateId: "tpl-0001",
    provider: "incus",
    providerRef: instanceName,
    status: "error",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: null,
    lastAction: "Launch failed",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 102,
    activeWindow: "logs",
    workspacePath: "/root",
    session: null,
    forwardedPorts: [],
    activityLog: [],
  };

  const mutation = await provider.deleteVm(vm);

  assert.equal(mutation.lastAction, "Workspace missing-delete deleted");
  assert.ok(
    calls.some(
      (args) => args[0] === "delete" && args[1] === instanceName && args[2] === "--force",
    ),
  );
});

test("incus provider treats a completed competing delete operation as already removed", async () => {
  const calls: string[][] = [];
  const instanceName = "parallaize-vm-0103-raced-delete";

  const runner = {
    execute(args: string[]) {
      calls.push(args);

      if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
        return ok("[]", args);
      }

      if (args[0] === "delete" && args[1] === instanceName) {
        return {
          args,
          status: 1,
          stdout: "",
          stderr:
            `Error: Failed deleting instance "${instanceName}" in project "default": Failed to create instance delete operation: A matching non-reusable operation has now succeeded`,
        };
      }

      if (
        args[0] === "list" &&
        args[1] === instanceName &&
        args[2] === "--format" &&
        args[3] === "json"
      ) {
        return ok("[]", args);
      }

      return ok("", args);
    },
  };

  const provider = createProvider("incus", "incus", {
    commandRunner: runner,
  });

  const vm: VmInstance = {
    id: "vm-0103",
    name: "raced-delete",
    templateId: "tpl-0001",
    provider: "incus",
    providerRef: instanceName,
    status: "deleting",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: null,
    lastAction: "Delete requested",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 103,
    activeWindow: "logs",
    workspacePath: "/root",
    session: null,
    forwardedPorts: [],
    activityLog: [],
  };

  const mutation = await provider.deleteVm(vm);

  assert.equal(mutation.lastAction, "Workspace raced-delete deleted");
  assert.ok(
    calls.some(
      (args) => args[0] === "delete" && args[1] === instanceName && args[2] === "--force",
    ),
  );
  assert.ok(
    calls.some(
      (args) =>
        args[0] === "list" &&
        args[1] === instanceName &&
        args[2] === "--format" &&
        args[3] === "json",
    ),
  );
});

test("manager derives browser VNC and forwarded service routes for incus VMs", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-incus-forwarding-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const runner = {
    execute(args: string[]) {
      if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
        return ok("[]", args);
      }

      if (
        args[0] === "query" &&
        typeof args[1] === "string" &&
        args[1].startsWith("/1.0/instances/parallaize-vm-")
      ) {
        return expandedRootDevice(args);
      }

      if (args[0] === "list" && typeof args[1] === "string" && args[1].startsWith("parallaize-vm-")) {
        return ok(
          JSON.stringify([
            {
              name: args[1],
              status: "Running",
              state: {
                status: "Running",
                network: {
                  enp5s0: {
                    addresses: [
                      {
                        family: "inet",
                        scope: "global",
                        address: "10.44.0.27",
                      },
                    ],
                  },
                },
              },
            },
          ]),
          args,
        );
      }


      return ok("", args);
    },
  };

  const provider = createProvider("incus", "incus", {
    guestVncPort: 5900,
    commandRunner: runner,
    guestPortProbe: {
      async probe() {
        return true;
      },
    },
  });
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider, {
    forwardedServiceHostBase: "localhost",
  });

  const vm = manager.createVm({
    templateId: "tpl-0001",
    name: "browser-route-test",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    forwardedPorts: [
      {
        name: "app-ui",
        guestPort: 3000,
        protocol: "http",
        description: "Primary guest web app",
      },
    ],
    desktopTransport: "vnc",
  });

  await wait(700);

  const detail = manager.getVmDetail(vm.id);
  assert.equal(detail.vm.session?.webSocketPath, `/api/vms/${vm.id}/vnc`);
  assert.equal(detail.vm.session?.browserPath, `/?vm=${vm.id}`);
  assert.equal(detail.vm.forwardedPorts[0]?.publicPath, `/vm/${vm.id}/forwards/port-01/`);
  assert.equal(detail.vm.forwardedPorts[0]?.publicHostname, `app-ui--${vm.id}.localhost`);

  manager.updateVmForwardedPorts(vm.id, {
    forwardedPorts: [
      {
        name: "api",
        guestPort: 8080,
        protocol: "http",
        description: "Forwarded guest API",
      },
    ],
  });

  const updated = manager.getVmDetail(vm.id);
  assert.equal(updated.vm.forwardedPorts.length, 1);
  assert.equal(updated.vm.forwardedPorts[0]?.guestPort, 8080);
  assert.equal(updated.vm.forwardedPorts[0]?.publicPath, `/vm/${vm.id}/forwards/port-01/`);
  assert.equal(updated.vm.forwardedPorts[0]?.publicHostname, `api--${vm.id}.localhost`);
});

test("incus clones do not reuse the source VM VNC identity", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-incus-clone-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const calls: string[][] = [];
  const sourceInstanceName = "parallaize-vm-0055-origin";
  const cloneInstanceName = "parallaize-vm-0056-origin-clone";
  let bootstrapScript = "";
  const instanceAddresses = new Map<string, string>([
    [sourceInstanceName, "10.55.0.12"],
    [cloneInstanceName, "10.55.0.13"],
  ]);
  const runner = {
    execute(args: string[], options?: { input?: Buffer | string }) {
      calls.push(args);
      const input = readCommandInput(options);

      if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
        return ok("[]", args);
      }

      if (args[0] === "query" && args[1] === `/1.0/instances/${sourceInstanceName}`) {
        return expandedRootDevice(args, "root", {
          config: {
            "migration.stateful": "true",
          },
          status: "Running",
        });
      }

      if (args[0] === "query" && args[1] === `/1.0/instances/${cloneInstanceName}`) {
        return expandedRootDevice(args);
      }

      if (args[0] === "list" && args[2] === "--format" && args[3] === "json") {
        const address = instanceAddresses.get(args[1]);

        if (!address) {
          return ok("[]", args);
        }

        return ok(
          JSON.stringify([
            {
              name: args[1],
              status: "Running",
              state: {
                status: "Running",
                network: {
                  enp5s0: {
                    addresses: [
                      {
                        family: "inet",
                        scope: "global",
                        address,
                      },
                    ],
                  },
                },
              },
            },
          ]),
          args,
        );
      }

      if (
        args[0] === "exec" &&
        args[1] === cloneInstanceName &&
        input.includes('BOOTSTRAP_FILE="/usr/local/bin/parallaize-desktop-bootstrap"')
      ) {
        bootstrapScript = input;
        return ok("", args);
      }

      return ok("", args);
    },
  };

  const provider = createProvider("incus", "incus", {
    guestVncPort: 5901,
    commandRunner: runner,
    guestPortProbe: {
      async probe() {
        return true;
      },
    },
  });

  const now = new Date().toISOString();
  const template: EnvironmentTemplate = {
    id: "tpl-0055",
    name: "Clone Test Template",
    description: "Used to verify clone identity isolation",
    launchSource: "images:ubuntu/noble/desktop",
    defaultResources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    defaultForwardedPorts: [],
    defaultDesktopTransport: "selkies",
    initCommands: [],
    tags: [],
    notes: [],
    snapshotIds: [],
    createdAt: now,
    updatedAt: now,
  };
  const state: AppState = {
    sequence: 56,
    provider: provider.state,
    templates: [template],
    vms: [
      {
        id: "vm-0055",
        name: "origin",
        templateId: template.id,
        provider: "incus",
        providerRef: sourceInstanceName,
        status: "running",
        resources: {
          cpu: 4,
          ramMb: 8192,
          diskGb: 60,
        },
        createdAt: now,
        updatedAt: now,
        liveSince: now,
        lastAction: "Booted",
        snapshotIds: [],
        frameRevision: 1,
        screenSeed: 55,
        activeWindow: "terminal",
        workspacePath: "/root",
        desktopTransport: "vnc",
        session: {
          kind: "vnc",
          host: "10.55.0.12",
          port: 5901,
          webSocketPath: "/api/vms/vm-9999/vnc",
          browserPath: "/?vm=vm-9999",
          display: "10.55.0.12:5901",
        },
        forwardedPorts: [],
        activityLog: [],
      },
    ],
    snapshots: [],
    jobs: [],
    adminSessions: [],
    lastUpdated: now,
  };

  const store = new JsonStateStore(join(tempDir, "state.json"), () => state);
  store.save(state);
  const manager = new DesktopManager(store, provider);

  const sourceDetail = manager.getVmDetail("vm-0055");
  assert.equal(sourceDetail.vm.session?.webSocketPath, "/api/vms/vm-0055/vnc");
  assert.equal(sourceDetail.vm.session?.browserPath, "/?vm=vm-0055");

  const clone = manager.cloneVm({
    sourceVmId: "vm-0055",
    name: "origin-clone",
    stateful: true,
    wallpaperName: "silver-falcon",
  });

  assert.equal(clone.id, "vm-0056");
  assert.equal(clone.providerRef, cloneInstanceName);
  assert.equal(clone.session, null);

  await wait(700);

  const detail = manager.getVmDetail(clone.id);
  assert.equal(detail.vm.status, "running");
  assert.equal(detail.vm.wallpaperName, "silver-falcon");
  assert.equal(detail.vm.session?.host, "10.55.0.13");
  assert.equal(detail.vm.session?.webSocketPath, `/api/vms/${clone.id}/vnc`);
  assert.equal(detail.vm.session?.browserPath, `/?vm=${clone.id}`);
  assert.notEqual(bootstrapScript, "");
  assert.match(bootstrapScript, /https:\/\/wallpapers\.parallaize\.com\/24\.04\/silver-falcon\.jpg/);
  assert.match(bootstrapScript, /desktop-wallpaper-source/);
  assert.match(bootstrapScript, /DESKTOP_HEALTH_GRACE_SECONDS=10/);
  assert.match(bootstrapScript, /DESKTOP_GDM_RESTART_COOLDOWN_SECONDS=15/);
  assert.ok(
    calls.some(
      (args) =>
        args[0] === "copy" &&
        args[1] === sourceInstanceName &&
        args[2] === cloneInstanceName &&
        !args.includes("--stateless"),
    ),
  );
  assert.ok(
    calls.some(
      (args) =>
        args[0] === "config" &&
        args[1] === "device" &&
        args[2] === "add" &&
        args[3] === cloneInstanceName &&
        args[4] === "agent" &&
        args[5] === "disk" &&
        args[6] === "source=agent:config",
    ),
  );
});

test("incus provider refreshes an existing agent device before resuming a VM", async () => {
  const calls: string[][] = [];
  const instanceName = "parallaize-vm-0110-resume-agent";
  let addAttempts = 0;
  const runner = {
    execute(args: string[]) {
      calls.push(args);

      if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
        return ok("[]", args);
      }

      if (
        args[0] === "config" &&
        args[1] === "device" &&
        args[2] === "add" &&
        args[3] === instanceName &&
        args[4] === "agent"
      ) {
        addAttempts += 1;

        if (addAttempts === 1) {
          return {
            args,
            status: 1,
            stdout: "",
            stderr: "Error: The device already exists",
          };
        }

        return ok("", args);
      }

      if (args[0] === "list" && args[1] === instanceName) {
        return ok(
          JSON.stringify([
            {
              name: instanceName,
              status: "Running",
              state: {
                status: "Running",
                network: {
                  enp5s0: {
                    addresses: [
                      {
                        family: "inet",
                        scope: "global",
                        address: "10.55.0.110",
                      },
                    ],
                  },
                },
              },
            },
          ]),
          args,
        );
      }

      if (args[0] === "query" && args[1] === `/1.0/instances/${instanceName}`) {
        return expandedRootDevice(args);
      }

      return ok("", args);
    },
  };

  const provider = createProvider("incus", "incus", {
    guestVncPort: 5901,
    commandRunner: runner,
    guestPortProbe: {
      async probe() {
        return true;
      },
    },
  });

  const vm: VmInstance = {
    id: "vm-0110",
    name: "resume-agent",
    templateId: "tpl-0001",
    provider: "incus",
    providerRef: instanceName,
    status: "stopped",
    resources: {
      cpu: 2,
      ramMb: 4096,
      diskGb: 30,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: null,
    lastAction: "Stopped",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 10,
    activeWindow: "terminal",
    workspacePath: "/root",
    session: null,
    forwardedPorts: [],
    activityLog: [],
  };

  const mutation = await provider.startVm(vm);
  const agentDeviceAddCalls = calls.filter(
    (args) =>
      args[0] === "config" &&
      args[1] === "device" &&
      args[2] === "add" &&
      args[3] === instanceName &&
      args[4] === "agent",
  );
  const agentDeviceRemoveCall = calls.find(
    (args) =>
      args[0] === "config" &&
      args[1] === "device" &&
      args[2] === "remove" &&
      args[3] === instanceName &&
      args[4] === "agent",
  );
  const startCall = calls.find(
    (args) => args[0] === "start" && args[1] === instanceName,
  );

  assert.equal(mutation.session?.display, "10.55.0.110:5901");
  assert.equal(agentDeviceAddCalls.length, 2);
  assert.deepEqual(agentDeviceAddCalls[1], [
    "config",
    "device",
    "add",
    instanceName,
    "agent",
    "disk",
    "source=agent:config",
  ]);
  assert.deepEqual(agentDeviceRemoveCall, [
    "config",
    "device",
    "remove",
    instanceName,
    "agent",
  ]);
  assert.deepEqual(startCall, ["start", instanceName]);
});

test("incus provider triggers guest desktop bootstrap while waiting for VNC", async () => {
  const calls: string[][] = [];
  const instanceName = "parallaize-vm-0110-bootstrap-retry";
  let bootstrapScript = "";
  let probeAttempts = 0;
  const runner = {
    execute(args: string[], options?: { input?: Buffer | string }) {
      calls.push(args);
      const input = readCommandInput(options);

      if (
        args[0] === "list" &&
        ((args[1] === "--format" && args[2] === "json") || args[1] === instanceName)
      ) {
        return ok(
          JSON.stringify([
            {
              name: instanceName,
              status: "Running",
              state: {
                status: "Running",
                network: {
                  enp5s0: {
                    addresses: [
                      {
                        family: "inet",
                        scope: "global",
                        address: "10.55.0.111",
                      },
                    ],
                  },
                },
              },
            },
          ]),
          args,
        );
      }

      if (
        args[0] === "exec" &&
        args[1] === instanceName &&
        input.includes('BOOTSTRAP_FILE="/usr/local/bin/parallaize-desktop-bootstrap"')
      ) {
        bootstrapScript = input;
        return ok("", args);
      }

      if (args[0] === "query" && args[1] === `/1.0/instances/${instanceName}`) {
        return expandedRootDevice(args);
      }

      return ok("", args);
    },
  };

  const provider = createProvider("incus", "incus", {
    guestVncPort: 5901,
    commandRunner: runner,
    guestPortProbe: {
      async probe() {
        probeAttempts += 1;
        return probeAttempts >= 2;
      },
    },
  });

  const vm: VmInstance = {
    id: "vm-0110",
    name: "bootstrap-retry",
    templateId: "tpl-0001",
    provider: "incus",
    providerRef: instanceName,
    status: "stopped",
    resources: {
      cpu: 2,
      ramMb: 4096,
      diskGb: 30,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: null,
    lastAction: "Stopped",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 11,
    activeWindow: "terminal",
    workspacePath: "/root",
    session: null,
    forwardedPorts: [],
    activityLog: [],
  };

  const mutation = await provider.startVm(vm);

  assert.equal(mutation.session?.display, "10.55.0.111:5901");
  assert.notEqual(bootstrapScript, "");
  assert.match(bootstrapScript, /"\$BOOTSTRAP_FILE" \|\| true/);
});

test("incus provider treats an already-running instance as a successful resume", async () => {
  const calls: string[][] = [];
  const instanceName = "parallaize-vm-0111-resume-already-running";
  const runner = {
    execute(args: string[]) {
      calls.push(args);

      if (
        args[0] === "list" &&
        ((args[1] === "--format" && args[2] === "json") || args[1] === instanceName)
      ) {
        return ok(
          JSON.stringify([
            {
              name: instanceName,
              status: "Running",
              state: {
                status: "Running",
                network: {
                  enp5s0: {
                    addresses: [
                      {
                        family: "inet",
                        scope: "global",
                        address: "10.55.0.111",
                      },
                    ],
                  },
                },
              },
            },
          ]),
          args,
        );
      }

      if (args[0] === "start" && args[1] === instanceName) {
        return {
          args,
          status: 1,
          stdout: "",
          stderr:
            `Error: The instance is already running ` +
            `Try \`incus info --show-log ${instanceName}\` for more info`,
        };
      }

      if (args[0] === "query" && args[1] === `/1.0/instances/${instanceName}`) {
        return expandedRootDevice(args);
      }

      return ok("", args);
    },
  };

  const provider = createProvider("incus", "incus", {
    guestVncPort: 5901,
    commandRunner: runner,
    guestPortProbe: {
      async probe() {
        return true;
      },
    },
  });

  const vm: VmInstance = {
    id: "vm-0111",
    name: "resume-already-running",
    templateId: "tpl-0001",
    provider: "incus",
    providerRef: instanceName,
    status: "stopped",
    resources: {
      cpu: 2,
      ramMb: 4096,
      diskGb: 30,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: null,
    lastAction: "Stopped",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 11,
    activeWindow: "terminal",
    workspacePath: "/root",
    session: null,
    forwardedPorts: [],
    activityLog: [],
  };

  const mutation = await provider.startVm(vm);
  const startCall = calls.find(
    (args) => args[0] === "start" && args[1] === instanceName,
  );

  assert.equal(mutation.session?.display, "10.55.0.111:5901");
  assert.deepEqual(startCall, ["start", instanceName]);
  assert.equal(mutation.lastAction, "Workspace resumed");
});

test("incus provider retries guest DNS sync until the guest agent is ready", async () => {
  const calls: string[][] = [];
  const instanceName = "parallaize-vm-0112-agent-retry";
  let dnsExecAttempts = 0;
  const runner = {
    execute(args: string[]) {
      calls.push(args);

      if (args[0] === "query" && args[1] === `/1.0/instances/${instanceName}`) {
        return expandedRootDevice(args, "root");
      }

      if (
        args[0] === "list" &&
        ((args[1] === "--format" && args[2] === "json") || args[1] === instanceName)
      ) {
        return ok(
          JSON.stringify([
            {
              name: instanceName,
              status: "Running",
              state: {
                status: "Running",
                network: {
                  enp5s0: {
                    addresses: [
                      {
                        family: "inet",
                        scope: "global",
                        address: "10.55.0.112",
                      },
                    ],
                  },
                },
              },
            },
          ]),
          args,
        );
      }

      if (
        args[0] === "exec" &&
        args[1] === instanceName &&
        (args[5] ?? "").includes("systemctl restart systemd-resolved.service")
      ) {
        dnsExecAttempts += 1;

        if (dnsExecAttempts < 3) {
          return {
            args,
            status: 1,
            stdout: "",
            stderr: "Error: VM agent isn't currently running",
          };
        }
      }

      if (args[0] === "query" && args[1] === `/1.0/instances/${instanceName}`) {
        return expandedRootDevice(args);
      }

      return ok("", args);
    },
  };

  const provider = createProvider("incus", "incus", {
    guestVncPort: 5901,
    commandRunner: runner,
    guestAgentRetryMs: 0,
    guestAgentRetryTimeoutMs: 50,
    guestPortProbe: {
      async probe() {
        return true;
      },
    },
  });

  const vm: VmInstance = {
    id: "vm-0112",
    name: "agent-retry",
    templateId: "tpl-0001",
    provider: "incus",
    providerRef: instanceName,
    status: "stopped",
    resources: {
      cpu: 2,
      ramMb: 4096,
      diskGb: 30,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: null,
    lastAction: "Stopped",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 12,
    activeWindow: "terminal",
    workspacePath: "/root",
    session: null,
    forwardedPorts: [],
    activityLog: [],
  };

  const mutation = await provider.startVm(vm);

  assert.equal(mutation.session?.display, "10.55.0.112:5901");
  assert.equal(dnsExecAttempts, 3);
});

test("manager reattaches reachable VNC sessions for running incus VMs after startup", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-reattach-vnc-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const instanceName = "parallaize-vm-0201-reattach";
  const provider = createProvider("incus", "incus", {
    guestVncPort: 5900,
    commandRunner: {
      execute(args: string[]) {
        if (
          args[0] === "list" &&
          ((args[1] === "--format" && args[2] === "json") || args[1] === instanceName)
        ) {
          return ok(
            JSON.stringify([
              {
                name: instanceName,
                status: "Running",
                state: {
                  status: "Running",
                  network: {
                    enp5s0: {
                      addresses: [
                        {
                          family: "inet",
                          scope: "global",
                          address: "10.55.0.201",
                        },
                      ],
                    },
                  },
                },
              },
            ]),
            args,
          );
        }

        return ok("", args);
      },
    },
    guestPortProbe: {
      async probe(host: string) {
        return host === "10.55.0.201";
      },
    },
  });
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const now = new Date().toISOString();

  store.update((draft) => {
    draft.vms.unshift({
      id: "vm-0201",
      name: "reattach",
      templateId: "tpl-0001",
      provider: "incus",
      providerRef: instanceName,
      status: "running",
      resources: {
        cpu: 4,
        ramMb: 8192,
        diskGb: 60,
      },
      createdAt: now,
      updatedAt: now,
      liveSince: now,
      lastAction: "Workspace resumed",
      snapshotIds: [],
      frameRevision: 1,
      screenSeed: 201,
      activeWindow: "terminal",
      workspacePath: "/root",
      session: null,
      forwardedPorts: [],
      activityLog: ["vnc: 10.55.0.201:5900"],
      commandHistory: [],
    });
  });

  const manager = new DesktopManager(store, provider);

  await wait(50);

  const detail = manager.getVmDetail("vm-0201");

  assert.equal(detail.vm.session?.display, "10.55.0.201:5900");
  assert.equal(detail.vm.session?.webSocketPath, "/api/vms/vm-0201/vnc");
  assert.equal(detail.vm.session?.browserPath, "/?vm=vm-0201");
});

test("manager periodically refreshes reachable Selkies sessions for maintenance", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-selkies-maintenance-refresh-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  let refreshCalls = 0;
  const providerState = {
    kind: "incus" as const,
    available: true,
    detail: "Incus is reachable.",
    hostStatus: "ready" as const,
    binaryPath: "incus",
    project: null,
    desktopTransport: "novnc" as const,
    nextSteps: [],
  };
  const reachableSession = {
    kind: "selkies" as const,
    host: "10.55.0.204",
    port: 6080,
    reachable: true,
    webSocketPath: null,
    browserPath: "/selkies-vm-0204/",
    display: "10.55.0.204:6080",
  };
  const provider: DesktopProvider = {
    state: providerState,
    refreshState() {
      return this.state;
    },
    sampleHostTelemetry() {
      return null;
    },
    sampleVmTelemetry() {
      return null;
    },
    observeVmPowerState() {
      return null;
    },
    async refreshVmSession() {
      refreshCalls += 1;
      return reachableSession;
    },
    async createVm() {
      throw new Error("not implemented");
    },
    async cloneVm() {
      throw new Error("not implemented");
    },
    async startVm() {
      throw new Error("not implemented");
    },
    async pauseVm() {
      throw new Error("not implemented");
    },
    async stopVm() {
      throw new Error("not implemented");
    },
    async deleteVm() {
      throw new Error("not implemented");
    },
    async syncVmHostname() {
      return null;
    },
    async deleteVmSnapshot() {
      throw new Error("not implemented");
    },
    async resizeVm() {
      throw new Error("not implemented");
    },
    async setNetworkMode() {
      throw new Error("not implemented");
    },
    async setDisplayResolution() {
      throw new Error("not implemented");
    },
    async snapshotVm() {
      throw new Error("not implemented");
    },
    async launchVmFromSnapshot() {
      throw new Error("not implemented");
    },
    async restoreVmToSnapshot() {
      throw new Error("not implemented");
    },
    async captureTemplate() {
      throw new Error("not implemented");
    },
    async injectCommand() {
      throw new Error("not implemented");
    },
    async readVmLogs() {
      throw new Error("not implemented");
    },
    async browseVmFiles() {
      throw new Error("not implemented");
    },
    async readVmFile() {
      throw new Error("not implemented");
    },
    async readVmTouchedFiles() {
      throw new Error("not implemented");
    },
    tickVm() {
      return null;
    },
    renderFrame() {
      return "";
    },
  };
  const now = new Date().toISOString();
  const state: AppState = {
    sequence: 2,
    provider: provider.state,
    templates: [
      {
        id: "tpl-0001",
        name: "Ubuntu Agent Forge",
        description: "Seeded Ubuntu desktop template",
        launchSource: "parallaize-template-tpl-0001",
        defaultResources: {
          cpu: 4,
          ramMb: 8192,
          diskGb: 60,
        },
        defaultForwardedPorts: [],
        defaultDesktopTransport: "selkies",
        initCommands: [],
        tags: [],
        notes: [],
        snapshotIds: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    vms: [
      {
        id: "vm-0204",
        name: "steady-otter",
        templateId: "tpl-0001",
        provider: "incus",
        providerRef: "parallaize-vm-0204-steady-otter",
        status: "running",
        resources: {
          cpu: 4,
          ramMb: 8192,
          diskGb: 60,
        },
        createdAt: now,
        updatedAt: now,
        liveSince: now,
        lastAction: "Workspace resumed",
        snapshotIds: [],
        frameRevision: 1,
        screenSeed: 204,
        activeWindow: "terminal",
        workspacePath: "/root",
        desktopTransport: "selkies",
        session: reachableSession,
        forwardedPorts: [],
        activityLog: ["selkies: 10.55.0.204:6080"],
        commandHistory: [],
      },
    ],
    snapshots: [],
    jobs: [],
    adminSessions: [],
    lastUpdated: now,
  };
  const store = new JsonStateStore(join(tempDir, "state.json"), () => state);
  store.save(state);

  const manager = new DesktopManager(store, provider, {
    vmSessionMaintenanceRefreshMs: 1_000,
  });

  context.after(() => {
    manager.stop();
  });

  await wait(100);
  assert.ok(refreshCalls >= 1);
  const initialRefreshCalls = refreshCalls;

  manager.start();
  await wait(2_700);

  assert.ok(refreshCalls >= initialRefreshCalls + 1);
});

test("manager keeps refreshing newly created VMs while guest VNC is still pending", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-pending-vnc-refresh-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  let refreshCalls = 0;
  let createdAt = 0;
  const providerState = {
    kind: "incus" as const,
    available: true,
    detail: "Incus is reachable.",
    hostStatus: "ready" as const,
    binaryPath: "incus",
    project: null,
    desktopTransport: "novnc" as const,
    nextSteps: [],
  };
  const pendingSession = {
    kind: "vnc" as const,
    host: "10.55.0.203",
    port: 5900,
    reachable: false,
    webSocketPath: null,
    browserPath: null,
    display: "10.55.0.203:5900 pending VNC",
  };
  const provider: DesktopProvider = {
    state: providerState,
    refreshState() {
      return this.state;
    },
    sampleHostTelemetry() {
      return null;
    },
    sampleVmTelemetry() {
      return null;
    },
    observeVmPowerState() {
      return null;
    },
    async refreshVmSession() {
      refreshCalls += 1;

      if (createdAt === 0 || Date.now() - createdAt < 1200) {
        return pendingSession;
      }

      return {
        ...pendingSession,
        reachable: true,
        display: "10.55.0.203:5900",
      };
    },
    async createVm() {
      createdAt = Date.now();

      return {
        lastAction: "Provisioned from Ubuntu Agent Force",
        activity: ["incus: launched pending-retry from ubuntu-agent-force"],
        activeWindow: "terminal",
        workspacePath: "/root",
        session: pendingSession,
      };
    },
    async cloneVm() {
      throw new Error("not implemented");
    },
    async startVm() {
      throw new Error("not implemented");
    },
    async pauseVm() {
      throw new Error("not implemented");
    },
    async stopVm() {
      throw new Error("not implemented");
    },
    async deleteVm() {
      throw new Error("not implemented");
    },
    async syncVmHostname() {
      return null;
    },
    async deleteVmSnapshot() {
      throw new Error("not implemented");
    },
    async resizeVm() {
      throw new Error("not implemented");
    },
    async setNetworkMode() {
      throw new Error("not implemented");
    },
    async setDisplayResolution() {
      throw new Error("not implemented");
    },
    async snapshotVm() {
      throw new Error("not implemented");
    },
    async launchVmFromSnapshot() {
      throw new Error("not implemented");
    },
    async restoreVmToSnapshot() {
      throw new Error("not implemented");
    },
    async captureTemplate() {
      throw new Error("not implemented");
    },
    async injectCommand() {
      throw new Error("not implemented");
    },
    async readVmLogs() {
      throw new Error("not implemented");
    },
    async browseVmFiles() {
      throw new Error("not implemented");
    },
    async readVmFile() {
      throw new Error("not implemented");
    },
    async readVmTouchedFiles() {
      throw new Error("not implemented");
    },
    tickVm() {
      return null;
    },
    renderFrame() {
      return "";
    },
  };
  const store = new JsonStateStore(join(tempDir, "state.json"), () =>
    createSeedState(provider.state),
  );
  const manager = new DesktopManager(store, provider);

  context.after(() => {
    manager.stop();
  });

  manager.start();

  const vm = manager.createVm({
    templateId: "tpl-0001",
    name: "pending-retry",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
  });

  await wait(100);

  const pendingVm = store.load().vms.find((entry) => entry.id === vm.id);
  assert.equal(pendingVm?.status, "running");
  assert.equal(pendingVm?.session?.display, "10.55.0.203:5900 pending VNC");
  assert.equal(pendingVm?.session?.webSocketPath, null);
  assert.equal(pendingVm?.session?.browserPath, null);

  await wait(2700);

  const readyVm = store.load().vms.find((entry) => entry.id === vm.id);
  assert.ok(refreshCalls >= 1);
  assert.equal(readyVm?.session?.display, "10.55.0.203:5900");
  assert.equal(readyVm?.session?.webSocketPath, `/api/vms/${vm.id}/vnc`);
  assert.equal(readyVm?.session?.browserPath, `/?vm=${vm.id}`);
});

test("incus provider refresh reruns guest desktop bootstrap when VNC is still missing", async () => {
  const calls: string[][] = [];
  const instanceName = "parallaize-vm-0202-refresh-bootstrap";
  let bootstrapScript = "";
  let probeAttempts = 0;
  const provider = createProvider("incus", "incus", {
    guestVncPort: 5900,
    commandRunner: {
      execute(args: string[], options?: { input?: Buffer | string }) {
        calls.push(args);
        const input = readCommandInput(options);

        if (
          args[0] === "list" &&
          ((args[1] === "--format" && args[2] === "json") || args[1] === instanceName)
        ) {
          return ok(
            JSON.stringify([
              {
                name: instanceName,
                status: "Running",
                state: {
                  status: "Running",
                  network: {
                    enp5s0: {
                      addresses: [
                        {
                          family: "inet",
                          scope: "global",
                          address: "10.55.0.202",
                        },
                      ],
                    },
                  },
                },
              },
            ]),
            args,
          );
        }

        if (
          args[0] === "exec" &&
          args[1] === instanceName &&
          input.includes('BOOTSTRAP_FILE="/usr/local/bin/parallaize-desktop-bootstrap"')
        ) {
          bootstrapScript = input;
          return ok("", args);
        }

        return ok("", args);
      },
    },
    guestPortProbe: {
      async probe() {
        probeAttempts += 1;
        return probeAttempts >= 2;
      },
    },
  });

  const session = await provider.refreshVmSession({
    id: "vm-0202",
    name: "refresh-bootstrap",
    wallpaperName: "angry-puffin",
    templateId: "tpl-0001",
    provider: "incus",
    providerRef: instanceName,
    status: "running",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: new Date().toISOString(),
    lastAction: "Workspace resumed",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 202,
    activeWindow: "terminal",
    workspacePath: "/root",
    session: null,
    forwardedPorts: [],
    activityLog: [],
    commandHistory: [],
  });

  assert.notEqual(bootstrapScript, "");
  assert.match(bootstrapScript, /https:\/\/wallpapers\.parallaize\.com\/24\.04\/angry-puffin\.jpg/);
  assert.equal(session?.display, "10.55.0.202:5900");
});

test("incus provider refresh accepts a reachable VNC session without waiting for guest desktop health", async () => {
  const calls: string[][] = [];
  const instanceName = "parallaize-vm-0203-refresh-health";
  let sawBootstrapRepair = false;
  const provider = createProvider("incus", "incus", {
    guestVncPort: 5900,
    commandRunner: {
      execute(args: string[], options?: { input?: Buffer | string }) {
        calls.push(args);
        const input = readCommandInput(options);

        if (
          args[0] === "exec" &&
          args[1] === instanceName &&
          input.includes('BOOTSTRAP_FILE="/usr/local/bin/parallaize-desktop-bootstrap"')
        ) {
          sawBootstrapRepair = true;
        }

        if (
          args[0] === "list" &&
          ((args[1] === "--format" && args[2] === "json") || args[1] === instanceName)
        ) {
          return ok(
            JSON.stringify([
              {
                name: instanceName,
                status: "Running",
                state: {
                  status: "Running",
                  network: {
                    enp5s0: {
                      addresses: [
                        {
                          family: "inet",
                          scope: "global",
                          address: "10.55.0.203",
                        },
                      ],
                    },
                  },
                },
              },
            ]),
            args,
          );
        }

        return ok("", args);
      },
    },
    guestPortProbe: {
      async probe() {
        return true;
      },
    },
  });

  const session = await provider.refreshVmSession({
    id: "vm-0203",
    name: "refresh-health",
    wallpaperName: "golden-fox",
    templateId: "tpl-0001",
    provider: "incus",
    providerRef: instanceName,
    status: "running",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: new Date().toISOString(),
    lastAction: "Workspace resumed",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 203,
    activeWindow: "terminal",
    workspacePath: "/root",
    session: null,
    forwardedPorts: [],
    activityLog: [],
    commandHistory: [],
  });

  assert.equal(
    calls.some(
      (args) =>
        args[0] === "exec" &&
        args[1] === instanceName &&
        args[5] === "/usr/local/bin/parallaize-desktop-health-check",
    ),
    false,
  );
  assert.equal(
    sawBootstrapRepair,
    false,
  );
  assert.equal(session?.display, "10.55.0.203:5900");
});

test("incus provider prefers the primary guest NIC over bridge interfaces for VNC", async () => {
  const instanceName = "parallaize-vm-0202-prefer-primary-nic";
  const probedHosts: string[] = [];
  const provider = createProvider("incus", "incus", {
    guestVncPort: 5900,
    commandRunner: {
      execute(args: string[]) {
        if (
          args[0] === "list" &&
          ((args[1] === "--format" && args[2] === "json") || args[1] === instanceName)
        ) {
          return ok(
            JSON.stringify([
              {
                name: instanceName,
                status: "Running",
                state: {
                  status: "Running",
                  network: {
                    "br-c8802e9f546e": {
                      addresses: [
                        {
                          family: "inet",
                          scope: "global",
                          address: "172.18.0.1",
                        },
                      ],
                    },
                    docker0: {
                      addresses: [
                        {
                          family: "inet",
                          scope: "global",
                          address: "172.17.0.1",
                        },
                      ],
                    },
                    enp5s0: {
                      host_name: "tap1234",
                      type: "broadcast",
                      addresses: [
                        {
                          family: "inet",
                          scope: "global",
                          address: "10.55.0.202",
                        },
                      ],
                    },
                  },
                },
              },
            ]),
            args,
          );
        }

        return ok("", args);
      },
    },
    guestPortProbe: {
      async probe(host: string) {
        probedHosts.push(host);
        return host === "10.55.0.202";
      },
    },
  });

  const session = await provider.refreshVmSession({
    id: "vm-0202",
    name: "prefer-primary-nic",
    templateId: "tpl-0001",
    provider: "incus",
    providerRef: instanceName,
    status: "running",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: new Date().toISOString(),
    lastAction: "Workspace resumed",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 202,
    activeWindow: "terminal",
    workspacePath: "/root",
    session: null,
    forwardedPorts: [],
    activityLog: [],
    commandHistory: [],
  });

  assert.deepEqual(probedHosts, ["10.55.0.202"]);
  assert.equal(session?.display, "10.55.0.202:5900");
});

test("incus provider restores guest DNS defaults when starting a default-network VM", async () => {
  const calls: string[][] = [];
  const instanceName = "parallaize-vm-0203-default-dns";
  const provider = createProvider("incus", "incus", {
    guestVncPort: 5900,
    commandRunner: {
      execute(args: string[]) {
        calls.push(args);

        if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
          return ok("[]", args);
        }

        if (args[0] === "query" && args[1] === `/1.0/instances/${instanceName}`) {
          return expandedRootAndNicDevice(args);
        }

        if (args[0] === "list" && args[1] === instanceName) {
          return ok(
            JSON.stringify([
              {
                name: instanceName,
                status: "Running",
                state: {
                  status: "Running",
                  network: {
                    enp5s0: {
                      addresses: [
                        {
                          family: "inet",
                          scope: "global",
                          address: "10.55.0.203",
                        },
                      ],
                    },
                  },
                },
              },
            ]),
            args,
          );
        }

        return ok("", args);
      },
    },
    guestPortProbe: {
      async probe() {
        return true;
      },
    },
  });

  const mutation = await provider.startVm({
    id: "vm-0203",
    name: "default-dns",
    templateId: "tpl-0203",
    provider: "incus",
    providerRef: instanceName,
    status: "stopped",
    resources: {
      cpu: 2,
      ramMb: 4096,
      diskGb: 40,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    liveSince: null,
    lastAction: "Workspace stopped",
    snapshotIds: [],
    frameRevision: 1,
    screenSeed: 203,
    activeWindow: "terminal",
    workspacePath: "/root",
    networkMode: "default",
    session: null,
    forwardedPorts: [],
    activityLog: [],
  });

  const guestDnsResetCall = calls.find(
    (args) =>
      args[0] === "exec" &&
      args[1] === instanceName &&
      (args[5] ?? "").includes("rm -f /etc/systemd/resolved.conf.d/60-parallaize-dmz.conf"),
  );

  assert.ok(guestDnsResetCall);
  assert.equal(mutation.session?.display, "10.55.0.203:5900");
  assert.ok(!mutation.activity.some((entry) => entry.startsWith("dns: public resolvers")));
});

function ok(stdout: string, args: string[]) {
  return {
    args,
    status: 0,
    stdout,
    stderr: "",
  };
}

function expandedRootDevice(
  args: string[],
  deviceName = "root",
  options?: {
    config?: Record<string, string>;
    stateful?: boolean;
    status?: string;
  },
) {
  return ok(
    JSON.stringify({
      config: options?.config,
      expanded_devices: {
        [deviceName]: {
          type: "disk",
          path: "/",
          pool: "default",
        },
      },
      state: options?.status
        ? {
            status: options.status,
          }
        : undefined,
      stateful: options?.stateful,
      status: options?.status,
    }),
    args,
  );
}

function expandedRootAndNicDevice(
  args: string[],
  nicDeviceName = "eth0",
  networkName = "incusbr0",
  rootDeviceName = "root",
) {
  return ok(
    JSON.stringify({
      expanded_devices: {
        [nicDeviceName]: {
          type: "nic",
          network: networkName,
        },
        [rootDeviceName]: {
          type: "disk",
          path: "/",
          pool: "default",
        },
      },
    }),
    args,
  );
}

function timedOut(args: string[]) {
  const error = new Error("spawnSync incus ETIMEDOUT") as Error & { code?: string };
  error.code = "ETIMEDOUT";

  return {
    args,
    status: null,
    stdout: "",
    stderr: "",
    error,
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
