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
  const runner = {
    execute(args: string[]) {
      calls.push(args);

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
    },
  };

  const provider = createProvider("incus", "incus", {
    guestVncPort: 5990,
    commandRunner: runner,
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

  const createMutation = await provider.createVm(vm, template);
  const initCall = calls.find((args) => args[0] === "init");
  const configSetCall = calls.find(
    (args) =>
      args[0] === "config" &&
      args[1] === "set" &&
      args[2] === instanceName &&
      args[3] === "cloud-init.user-data",
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
  assert.deepEqual(startCall, ["start", instanceName]);

  const snapshot = await provider.captureTemplate(vm, {
    templateId: "tpl-0099",
    name: "Captured Incus Template",
  });

  assert.equal(snapshot.launchSource, "parallaize-template-tpl-0099");
  assert.equal(calls.at(-2)?.[0], "snapshot");
  assert.equal(calls.at(-2)?.[1], "create");
  assert.match(calls.at(-2)?.[3] ?? "", /^parallaize-template-tpl-0099-/);
  assert.deepEqual(calls.at(-1), [
    "publish",
    `${instanceName}/${calls.at(-2)?.[3] ?? ""}`,
    "--alias",
    "parallaize-template-tpl-0099",
    "--reuse",
  ]);
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
