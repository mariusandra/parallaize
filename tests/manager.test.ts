import assert from "node:assert/strict";
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
import { createProvider } from "../apps/control/src/providers.js";
import { createSeedState } from "../apps/control/src/seed.js";
import { JsonStateStore } from "../apps/control/src/store.js";

test("mock provider supports create, snapshot, and template capture flows", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-"));
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
  const manager = new DesktopManager(store, provider);
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
      (job) => job.kind === "start" && job.status === "succeeded" && job.message === "already-running started",
    ),
  );
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
  });

  assert.equal(updated.name, "Operator Base");
  assert.equal(updated.description, "Renamed from the inspector menu.");
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

test("vms can be renamed without changing their provider identity", (context) => {
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

  const updated = manager.updateVm("vm-0001", {
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
  assert.equal(summary.templates.length, 2);
  assert.equal(template?.description, "Refreshed from alpha-workbench");
  assert.equal(template?.launchSource, "mock://templates/ubuntu-agent-forge");
  assert.equal(template?.snapshotIds.length, 2);
  assert.equal(template?.snapshotIds[1], "snap-0001");
  assert.equal(summary.snapshots[0]?.templateId, "tpl-0001");
  assert.match(template?.notes[0] ?? "", /Captured from VM alpha-workbench/);
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
  const instanceName = "parallaize-vm-0099-delta-lab";
  const reports: Array<{ message: string; progressPercent: number | null }> = [];
  const executeResult = (args: string[]) => {
    if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
      return ok("[]", args);
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
    execute(args: string[]) {
      calls.push(args);
      return executeResult(args);
    },
    async executeStreaming(
      args: string[],
      listeners?: { onStdout?(chunk: string): void; onStderr?(chunk: string): void },
    ) {
      calls.push(args);

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
    tags: [],
    notes: [],
    snapshotIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const vm: VmInstance = {
    id: "vm-0099",
    name: "delta-lab",
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
  const startCall = calls.find(
    (args) => args[0] === "start" && args[1] === instanceName,
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
    "-d",
    "root,size=60GiB",
  ]);
  assert.ok(configSetCall);
  assert.match(configSetCall?.[4] ?? "", /x11vnc/);
  assert.match(configSetCall?.[4] ?? "", /\/usr\/local\/bin\/parallaize-x11vnc/);
  assert.match(configSetCall?.[4] ?? "", /-xrandr newfbsize/);
  assert.match(configSetCall?.[4] ?? "", /-noshm/);
  assert.match(configSetCall?.[4] ?? "", /xset r on \|\| true/);
  assert.match(configSetCall?.[4] ?? "", /-repeat/);
  assert.match(configSetCall?.[4] ?? "", /fs\.inotify\.max_user_watches=2097152/);
  assert.match(configSetCall?.[4] ?? "", /fs\.inotify\.max_user_instances=4096/);
  assert.match(configSetCall?.[4] ?? "", /sysctl --load \/etc\/sysctl\.d\/60-parallaize-inotify\.conf/);
  assert.match(configSetCall?.[4] ?? "", /incus-agent\.service/);
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
  const publishCall = calls.find(
    (args) => args[0] === "publish" && args[1]?.startsWith(`${instanceName}/`),
  );

  assert.equal(snapshot.launchSource, "parallaize-template-tpl-0099");
  assert.equal(snapshotCreateCall?.[0], "snapshot");
  assert.equal(snapshotCreateCall?.[1], "create");
  assert.match(snapshotCreateCall?.[3] ?? "", /^parallaize-template-tpl-0099-/);
  assert.deepEqual(publishCall, [
    "publish",
    `${instanceName}/${snapshotCreateCall?.[3] ?? ""}`,
    "--alias",
    "parallaize-template-tpl-0099",
    "--reuse",
    "--compression",
    "zstd",
  ]);
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
    (args) => args[0] === "publish" && args[1]?.startsWith(`${instanceName}/`),
  );
  const snapshotCreateCall = calls.find(
    (args) => args[0] === "snapshot" && args[1] === "create" && args[2] === instanceName,
  );
  assert.deepEqual(publishCall, [
    "publish",
    `${instanceName}/${snapshotCreateCall?.[3] ?? ""}`,
    "--alias",
    "parallaize-template-tpl-0100",
    "--reuse",
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

      return ok("", args);
    },
  };

  const provider = createProvider("incus", "incus", {
    commandRunner: runner,
  });

  const vm: VmInstance = {
    id: "vm-0199",
    name: "resolution-lab",
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
  assert.match(execCall?.[5] ?? "", /LAUNCHER_FILE="\/usr\/local\/bin\/parallaize-x11vnc"/);
  assert.match(execCall?.[5] ?? "", /parallaize-x11vnc\.service/);
  assert.match(execCall?.[5] ?? "", /-xrandr newfbsize/);
  assert.match(execCall?.[5] ?? "", /-noshm/);
  assert.match(execCall?.[5] ?? "", /xset r on \|\| true/);
  assert.match(execCall?.[5] ?? "", /-repeat/);
  assert.match(execCall?.[5] ?? "", /TARGET_MODE="1366x768"/);
  assert.match(execCall?.[5] ?? "", /xrandr --query/);
  assert.match(execCall?.[5] ?? "", /cvt "\$WIDTH" "\$HEIGHT" 60/);
  assert.match(execCall?.[5] ?? "", /MODE_TO_APPLY=/);
  assert.match(execCall?.[5] ?? "", /xrandr --output "\$OUTPUT" --mode "\$MODE_TO_APPLY"/);
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

  const configSetCall = calls.find(
    (args) =>
      args[0] === "config" &&
      args[1] === "set" &&
      args[2] === instanceName,
  );
  const deviceSetCall = calls.find(
    (args) =>
      args[0] === "config" &&
      args[1] === "device" &&
      args[2] === "set" &&
      args[3] === instanceName,
  );

  assert.deepEqual(configSetCall, [
    "config",
    "set",
    instanceName,
    "limits.cpu=8",
  ]);
  assert.equal(deviceSetCall, undefined);
  assert.equal(probed, false);
  assert.deepEqual(mutation.session, currentSession);
  assert.deepEqual(mutation.activity, [
    `incus: resized ${instanceName}`,
    "limits: cpu=8",
  ]);
});

test("incus provider targets the configured storage pool for creates and copies", async () => {
  const calls: string[][] = [];
  const sourceInstanceName = "parallaize-vm-0200-storage-origin";
  const targetInstanceName = "parallaize-vm-0201-storage-clone";
  const snapshotTargetInstanceName = "parallaize-vm-0202-storage-snapshot";
  const instanceAddresses = new Map<string, string>([
    [sourceInstanceName, "10.55.1.20"],
    [targetInstanceName, "10.55.1.21"],
    [snapshotTargetInstanceName, "10.55.1.22"],
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
  await provider.launchVmFromSnapshot(
    {
      id: "snap-0200",
      vmId: sourceVm.id,
      templateId: template.id,
      label: "checkpoint",
      summary: "Snapshot checkpoint captured from storage-origin.",
      providerRef: `${sourceInstanceName}/parallaize-snap-checkpoint`,
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
        args.includes("fastpool"),
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
});

test("incus provider launches and restores snapshots with VM commands", async () => {
  const calls: string[][] = [];
  const sourceInstanceName = "parallaize-vm-0109-snap-origin";
  const targetInstanceName = "parallaize-vm-0110-snap-launch";
  const addAttempts = new Map<string, number>();
  const instanceAddresses = new Map<string, string>([
    [sourceInstanceName, "10.55.0.21"],
    [targetInstanceName, "10.55.0.22"],
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
    resources: template.defaultResources,
    createdAt: new Date().toISOString(),
  };

  const launchMutation = await provider.launchVmFromSnapshot(snapshot, targetVm, template);
  assert.equal(launchMutation.session?.display, "10.55.0.22:5901");
  const copyCall = calls.find(
    (args) =>
      args[0] === "copy" &&
      args[1] === snapshot.providerRef &&
      args[2] === targetInstanceName,
  );
  assert.ok(copyCall);
  assert.ok(!copyCall?.includes("--instance-only"));

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
});

test("incus provider falls back to IPv6 guest metadata when IPv4 is absent", async () => {
  const instanceName = "parallaize-vm-0100-ipv6-only";
  const runner = {
    execute(args: string[]) {
      if (args[0] === "list" && args[1] === "--format" && args[2] === "json") {
        return ok("[]", args);
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
  const manager = new DesktopManager(store, provider);

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
  });

  await wait(700);

  const detail = manager.getVmDetail(vm.id);
  assert.equal(detail.vm.session?.webSocketPath, `/api/vms/${vm.id}/vnc`);
  assert.equal(detail.vm.session?.browserPath, `/?vm=${vm.id}`);
  assert.equal(detail.vm.forwardedPorts[0]?.publicPath, `/vm/${vm.id}/forwards/port-01/`);

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
});

test("incus clones do not reuse the source VM VNC identity", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-incus-clone-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const calls: string[][] = [];
  const sourceInstanceName = "parallaize-vm-0055-origin";
  const cloneInstanceName = "parallaize-vm-0056-origin-clone";
  const instanceAddresses = new Map<string, string>([
    [sourceInstanceName, "10.55.0.12"],
    [cloneInstanceName, "10.55.0.13"],
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
  });

  assert.equal(clone.id, "vm-0056");
  assert.equal(clone.providerRef, cloneInstanceName);
  assert.equal(clone.session, null);

  await wait(700);

  const detail = manager.getVmDetail(clone.id);
  assert.equal(detail.vm.status, "running");
  assert.equal(detail.vm.session?.host, "10.55.0.13");
  assert.equal(detail.vm.session?.webSocketPath, `/api/vms/${clone.id}/vnc`);
  assert.equal(detail.vm.session?.browserPath, `/?vm=${clone.id}`);
  assert.ok(
    calls.some(
      (args) =>
        args[0] === "copy" &&
        args[1] === sourceInstanceName &&
        args[2] === cloneInstanceName,
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

function ok(stdout: string, args: string[]) {
  return {
    args,
    status: 0,
    stdout,
    stderr: "",
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
