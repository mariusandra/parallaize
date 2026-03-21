import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

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
  assert.ok(summary.templates.some((template) => template.name === "Captured Test Template"));
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
