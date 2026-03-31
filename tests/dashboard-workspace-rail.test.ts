import assert from "node:assert/strict";
import test from "node:test";

import type { VmInstance } from "../packages/shared/src/types.js";
import { collectRunningWorkspaceUsage } from "../apps/web/src/dashboardWorkspaceRail.js";

function buildVm(id: string, overrides: Partial<VmInstance> = {}): VmInstance {
  return {
    id,
    name: `vm-${id}`,
    templateId: "template-1",
    provider: "mock",
    providerRef: `mock://${id}`,
    status: "stopped",
    resources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 80,
    },
    createdAt: "2026-03-29T10:00:00.000Z",
    updatedAt: "2026-03-29T10:00:00.000Z",
    liveSince: null,
    lastAction: "Created",
    snapshotIds: [],
    frameRevision: 0,
    screenSeed: 1,
    activeWindow: "terminal",
    workspacePath: "/workspace",
    session: null,
    forwardedPorts: [],
    activityLog: [],
    ...overrides,
  };
}

test("collectRunningWorkspaceUsage only counts running VMs", () => {
  const usage = collectRunningWorkspaceUsage([
    buildVm("running-1", {
      status: "running",
      resources: {
        cpu: 16,
        ramMb: 65536,
        diskGb: 120,
      },
    }),
    buildVm("stopped-1", {
      status: "stopped",
      resources: {
        cpu: 48,
        ramMb: 131072,
        diskGb: 200,
      },
    }),
    buildVm("creating-1", {
      status: "creating",
      resources: {
        cpu: 8,
        ramMb: 16384,
        diskGb: 100,
      },
    }),
  ]);

  assert.deepEqual(usage, {
    cpu: 16,
    ramMb: 65536,
  });
});
