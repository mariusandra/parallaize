import assert from "node:assert/strict";
import test from "node:test";

import type { VmDetail, VmInstance } from "../packages/shared/src/types.js";
import {
  buildSelkiesPreviewBrowserPath,
  hasBrowserDesktopSession,
  hasBrowserSelkiesSession,
  hasBrowserVncSession,
  mergeSelectedVmDetail,
  resolveDisplayedDesktopSession,
  resolveSelectedDesktopSession,
  shouldRefreshSelectedVmDetail,
  type RetainedDesktopSession,
  shouldShowLiveVmPreview,
} from "../apps/web/src/desktopSession.js";

test("hasBrowserDesktopSession accepts Selkies sessions with a browser path", () => {
  assert.equal(
    hasBrowserDesktopSession({
      kind: "selkies",
      host: "10.0.0.10",
      port: 6080,
      reachable: true,
      webSocketPath: null,
      browserPath: "/selkies-vm-1/",
      display: "10.0.0.10:6080",
    }),
    true,
  );
});

test("hasBrowserVncSession only accepts VNC sessions with a websocket path", () => {
  assert.equal(hasBrowserVncSession(null), false);
  assert.equal(
    hasBrowserVncSession({
      kind: "vnc",
      host: "10.0.0.10",
      port: 5900,
      reachable: true,
      webSocketPath: null,
      browserPath: null,
      display: "10.0.0.10:5900",
    }),
    false,
  );
  assert.equal(
    hasBrowserVncSession({
      kind: "vnc",
      host: "10.0.0.10",
      port: 5900,
      reachable: true,
      webSocketPath: "/api/vms/vm-1/vnc",
      browserPath: "/?vm=vm-1",
      display: "10.0.0.10:5900",
    }),
    true,
  );
});

test("hasBrowserSelkiesSession only accepts Selkies sessions with a browser path", () => {
  assert.equal(hasBrowserSelkiesSession(null), false);
  assert.equal(
    hasBrowserSelkiesSession({
      kind: "selkies",
      host: "10.0.0.10",
      port: 6080,
      reachable: true,
      webSocketPath: null,
      browserPath: null,
      display: "10.0.0.10:6080",
    }),
    false,
  );
  assert.equal(
    hasBrowserSelkiesSession({
      kind: "selkies",
      host: "10.0.0.10",
      port: 6080,
      reachable: true,
      webSocketPath: null,
      browserPath: "/selkies-vm-1/",
      display: "10.0.0.10:6080",
    }),
    true,
  );
});

test("buildSelkiesPreviewBrowserPath adds preview mode for rail iframes", () => {
  assert.equal(
    buildSelkiesPreviewBrowserPath({
      kind: "selkies",
      host: "10.0.0.10",
      port: 6080,
      reachable: true,
      webSocketPath: null,
      browserPath: "/selkies-vm-1/",
      display: "10.0.0.10:6080",
    }),
    "/selkies-vm-1/?parallaize_preview=1",
  );
  assert.equal(
    buildSelkiesPreviewBrowserPath({
      kind: "selkies",
      host: "10.0.0.10",
      port: 6080,
      reachable: true,
      webSocketPath: null,
      browserPath: "/selkies-vm-1/?foo=bar",
      display: "10.0.0.10:6080",
    }),
    "/selkies-vm-1/?foo=bar&parallaize_preview=1",
  );
});

test("resolveSelectedDesktopSession falls back to the summary VM session while detail is loading", () => {
  const selectedVm = buildVm("vm-0100", {
    kind: "vnc",
    host: "10.0.0.10",
    port: 5900,
    reachable: true,
    webSocketPath: "/api/vms/vm-0100/vnc",
    browserPath: "/?vm=vm-0100",
    display: "10.0.0.10:5900",
  });

  assert.deepEqual(resolveSelectedDesktopSession(selectedVm, null), selectedVm.session);
});

test("resolveSelectedDesktopSession prefers the matching detail session when it is available", () => {
  const selectedVm = buildVm("vm-0100", {
    kind: "vnc",
    host: "10.0.0.10",
    port: 5900,
    reachable: true,
    webSocketPath: "/api/vms/vm-0100/vnc",
    browserPath: "/?vm=vm-0100",
    display: "10.0.0.10:5900",
  });
  const detailSession = {
    kind: "vnc" as const,
    host: "10.0.0.11",
    port: 5900,
    reachable: true,
    webSocketPath: "/api/vms/vm-0100/vnc",
    browserPath: "/?vm=vm-0100",
    display: "10.0.0.11:5900",
  };
  const detail = buildDetail(selectedVm, detailSession);

  assert.deepEqual(resolveSelectedDesktopSession(selectedVm, detail), detailSession);
});

test("resolveSelectedDesktopSession ignores stale detail for another VM", () => {
  const selectedVm = buildVm("vm-0100", {
    kind: "vnc",
    host: "10.0.0.10",
    port: 5900,
    reachable: true,
    webSocketPath: "/api/vms/vm-0100/vnc",
    browserPath: "/?vm=vm-0100",
    display: "10.0.0.10:5900",
  });
  const staleDetail = buildDetail(
    buildVm("vm-9999", {
      kind: "vnc",
      host: "10.0.0.99",
      port: 5900,
      reachable: true,
      webSocketPath: "/api/vms/vm-9999/vnc",
      browserPath: "/?vm=vm-9999",
      display: "10.0.0.99:5900",
    }),
    {
      kind: "vnc",
      host: "10.0.0.99",
      port: 5900,
      reachable: true,
      webSocketPath: "/api/vms/vm-9999/vnc",
      browserPath: "/?vm=vm-9999",
      display: "10.0.0.99:5900",
    },
  );

  assert.deepEqual(resolveSelectedDesktopSession(selectedVm, staleDetail), selectedVm.session);
});

test("shouldShowLiveVmPreview allows the selected VM tile to keep a live preview", () => {
  const vm = buildVm("vm-0100", {
    kind: "vnc",
    host: "10.0.0.10",
    port: 5900,
    reachable: true,
    webSocketPath: "/api/vms/vm-0100/vnc",
    browserPath: "/?vm=vm-0100",
    display: "10.0.0.10:5900",
  });

  assert.equal(shouldShowLiveVmPreview(vm, true), true);
});

test("shouldShowLiveVmPreview keeps Selkies previews active on selected tiles", () => {
  const vm = buildVm("vm-0102", {
    kind: "selkies",
    host: "10.0.0.12",
    port: 6080,
    reachable: true,
    webSocketPath: null,
    browserPath: "/selkies-vm-0102/",
    display: "10.0.0.12:6080",
  });

  assert.equal(shouldShowLiveVmPreview(vm, true), true);
  assert.equal(shouldShowLiveVmPreview(vm, true, true), true);
});

test("mergeSelectedVmDetail preserves a fresher detail VNC session when summary lags behind", () => {
  const selectedVm = buildVm("vm-0100", null);
  const detailSession = {
    kind: "vnc" as const,
    host: "10.0.0.10",
    port: 5900,
    reachable: true,
    webSocketPath: "/api/vms/vm-0100/vnc",
    browserPath: "/?vm=vm-0100",
    display: "10.0.0.10:5900",
  };
  const detail = buildDetail(selectedVm, detailSession);

  assert.deepEqual(mergeSelectedVmDetail(selectedVm, detail)?.vm.session, detailSession);
});

test("shouldRefreshSelectedVmDetail refreshes when selected summary jobs are newer than detail", () => {
  const selectedVm = buildVm("vm-0100", null);
  const detail = buildDetail(selectedVm, null);
  detail.generatedAt = "2026-03-28T10:00:00.000Z";

  assert.equal(
    shouldRefreshSelectedVmDetail(selectedVm, detail, [
      buildJob("vm-0100", "2026-03-28T10:00:01.000Z"),
    ]),
    true,
  );
});

test("shouldRefreshSelectedVmDetail stays idle when selected detail already matches the live summary", () => {
  const selectedVm = buildVm("vm-0100", {
    kind: "vnc",
    host: "10.0.0.10",
    port: 5900,
    reachable: true,
    webSocketPath: "/api/vms/vm-0100/vnc",
    browserPath: "/?vm=vm-0100",
    display: "10.0.0.10:5900",
  });
  selectedVm.updatedAt = "2026-03-28T10:00:02.000Z";
  const detail = buildDetail(selectedVm, selectedVm.session);
  detail.generatedAt = "2026-03-28T10:00:03.000Z";

  assert.equal(
    shouldRefreshSelectedVmDetail(selectedVm, detail, [
      buildJob("vm-0100", "2026-03-28T10:00:02.000Z"),
    ]),
    false,
  );
});

test("resolveDisplayedDesktopSession keeps the last good stage session for the same running VM", () => {
  const vm = buildVm("vm-0100", null);
  const retainedSession: RetainedDesktopSession = {
    vmId: vm.id,
    session: {
      kind: "vnc",
      host: "10.0.0.10",
      port: 5900,
      reachable: true,
      webSocketPath: "/api/vms/vm-0100/vnc",
      browserPath: "/?vm=vm-0100",
      display: "10.0.0.10:5900",
    },
  };

  assert.deepEqual(resolveDisplayedDesktopSession(vm, null, retainedSession), retainedSession.session);
});

test("resolveDisplayedDesktopSession does not reuse a retained session for another VM", () => {
  const vm = buildVm("vm-0101", null);
  const retainedSession: RetainedDesktopSession = {
    vmId: "vm-0100",
    session: {
      kind: "vnc",
      host: "10.0.0.10",
      port: 5900,
      reachable: true,
      webSocketPath: "/api/vms/vm-0100/vnc",
      browserPath: "/?vm=vm-0100",
      display: "10.0.0.10:5900",
    },
  };

  assert.equal(resolveDisplayedDesktopSession(vm, null, retainedSession), null);
});

test("resolveDisplayedDesktopSession keeps the last good Selkies session for the same running VM", () => {
  const vm = buildVm("vm-0102", null);
  const retainedSession: RetainedDesktopSession = {
    vmId: vm.id,
    session: {
      kind: "selkies",
      host: "10.0.0.10",
      port: 6080,
      reachable: true,
      webSocketPath: null,
      browserPath: "/selkies-vm-0102/",
      display: "10.0.0.10:6080",
    },
  };

  assert.deepEqual(resolveDisplayedDesktopSession(vm, null, retainedSession), retainedSession.session);
});

function buildVm(
  id: string,
  session: VmInstance["session"],
): VmDetail["vm"] {
  return {
    id,
    name: id,
    templateId: "tpl-0001",
    provider: "incus",
    providerRef: id,
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
    screenSeed: 1,
    activeWindow: "terminal",
    workspacePath: "/root",
    desktopTransport: "vnc",
    networkMode: "default",
    session,
    forwardedPorts: [],
    activityLog: [],
    commandHistory: [],
    telemetry: {
      cpuHistory: [],
      cpuPercent: null,
      ramHistory: [],
      ramPercent: null,
    },
  };
}

function buildDetail(
  vm: VmDetail["vm"],
  session: VmInstance["session"],
): VmDetail {
  return {
    provider: {
      kind: "incus",
      available: true,
      detail: "Incus is reachable.",
      hostStatus: "ready",
      binaryPath: "incus",
      project: null,
      desktopTransport: "novnc",
      nextSteps: [],
    },
    vm: {
      ...vm,
      session,
    },
    template: null,
    snapshots: [],
    recentJobs: [],
    generatedAt: new Date().toISOString(),
  };
}

function buildJob(
  targetVmId: string,
  updatedAt: string,
): VmDetail["recentJobs"][number] {
  return {
    id: `job-${targetVmId}`,
    kind: "start",
    targetVmId,
    targetTemplateId: null,
    status: "running",
    message: "Refreshing desktop",
    progressPercent: 50,
    createdAt: updatedAt,
    updatedAt,
  };
}
