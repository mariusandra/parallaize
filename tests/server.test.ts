import assert from "node:assert/strict";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createHttpServer, request, type IncomingMessage } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import type { Readable } from "node:stream";
import test from "node:test";

import type {
  VmLogsSnapshot,
  VmResolutionControlSnapshot,
} from "../packages/shared/src/types.js";

type SpawnedServerProcess = ChildProcessByStdio<null, Readable, Readable>;

test("control plane exits promptly on SIGTERM even with an open SSE client", async (context) => {
  const { port, serverProcess, startupOutput } = await startServer(context, {
    adminPassword: "",
    tempDirPrefix: "parallaize-server-shutdown-",
  });
  let eventsResponse: IncomingMessage | null = null;

  context.after(async () => {
    eventsResponse?.destroy();
  });
  assert.match(startupOutput, /using mock provider/);

  eventsResponse = await openEventStream(port, {
    accept: "text/event-stream",
  });
  await once(eventsResponse, "data");

  const shutdownStartedAt = Date.now();
  const exitPromise = once(serverProcess, "exit");
  serverProcess.kill("SIGTERM");

  const exitResult = await Promise.race([
    exitPromise,
    waitForTimeout(3_000).then(() => {
      throw new Error("Server did not exit within 3 seconds while an SSE client was connected.");
    }),
  ]);

  const [exitCode, signal] = exitResult as [number | null, NodeJS.Signals | null];
  assert.equal(signal, null);
  assert.equal(exitCode, 0);
  assert.ok(Date.now() - shutdownStartedAt < 3_000);
});

test("control plane serves the shell and unauthenticated auth status while admin auth is enabled", async (context) => {
  const { port } = await startServer(context, {
    adminPassword: "change-me",
    tempDirPrefix: "parallaize-server-auth-",
  });

  const rootResponse = await sendRequest(port, {
    path: "/",
    method: "GET",
    headers: {
      accept: "text/html",
    },
  });
  assert.equal(rootResponse.statusCode, 200);
  assert.match(String(rootResponse.headers["content-type"] ?? ""), /^text\/html;/);

  const faviconResponse = await sendRequest(port, {
    path: "/favicon.svg",
    method: "GET",
  });
  assert.equal(faviconResponse.statusCode, 200);

  const cssResponse = await sendRequest(port, {
    path: "/assets/main.css",
    method: "GET",
  });
  assert.equal(cssResponse.statusCode, 200);

  const statusResponse = await sendRequest(port, {
    path: "/api/auth/status",
    method: "GET",
    headers: {
      accept: "application/json",
    },
  });
  assert.equal(statusResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(statusResponse.body), {
    ok: true,
    data: {
      authEnabled: true,
      authenticated: false,
      username: null,
      mode: "unauthenticated",
    },
  });
});

test("file browser defaults to the ubuntu home and downloads mock guest files", async (context) => {
  const { port } = await startServer(context, {
    adminPassword: "",
    tempDirPrefix: "parallaize-server-files-",
  });

  const browserResponse = await sendRequest(port, {
    path: "/api/vms/vm-0001/files",
    method: "GET",
    headers: {
      accept: "application/json",
    },
  });
  assert.equal(browserResponse.statusCode, 200);
  const browserPayload = JSON.parse(browserResponse.body) as {
    ok: boolean;
    data: {
      currentPath: string;
      entries: Array<{
        changedAt: string;
        kind: string;
        modifiedAt: string;
        name: string;
        path: string;
        sizeBytes: number | null;
      }>;
      generatedAt: string;
      homePath: string | null;
      parentPath: string | null;
      vmId: string;
      workspacePath: string;
    };
  };
  assert.equal(browserPayload.ok, true);
  assert.equal(browserPayload.data.vmId, "vm-0001");
  assert.equal(browserPayload.data.workspacePath, "/srv/workspaces/alpha-workbench");
  assert.equal(browserPayload.data.homePath, "/home/ubuntu");
  assert.equal(browserPayload.data.currentPath, "/home/ubuntu");
  assert.equal(browserPayload.data.parentPath, "/home");
  assert.deepEqual(
    browserPayload.data.entries.map((entry) => ({
      kind: entry.kind,
      name: entry.name,
      path: entry.path,
      sizeBytes: entry.sizeBytes,
    })),
    [
      {
        name: ".bashrc",
        path: "/home/ubuntu/.bashrc",
        kind: "file",
        sizeBytes: 3771,
      },
      {
        name: "Desktop",
        path: "/home/ubuntu/Desktop",
        kind: "directory",
        sizeBytes: null,
      },
      {
        name: "Downloads",
        path: "/home/ubuntu/Downloads",
        kind: "directory",
        sizeBytes: null,
      },
      {
        name: "notes.txt",
        path: "/home/ubuntu/notes.txt",
        kind: "file",
        sizeBytes: 184,
      },
    ],
  );

  const downloadResponse = await sendRequest(port, {
    path: "/api/vms/vm-0001/files/download?path=%2Fsrv%2Fworkspaces%2Falpha-workbench%2FREADME.md",
    method: "GET",
  });
  assert.equal(downloadResponse.statusCode, 200);
  assert.match(String(downloadResponse.headers["content-disposition"] ?? ""), /attachment;/);
  assert.equal(
    String(downloadResponse.headers["content-type"] ?? ""),
    "text/plain; charset=utf-8",
  );
  assert.match(downloadResponse.body, /Mock workspace/);
});

test("disk usage endpoint reports guest filesystem usage for the selected VM", async (context) => {
  const { port } = await startServer(context, {
    adminPassword: "",
    tempDirPrefix: "parallaize-server-disk-usage-",
  });

  const diskUsageResponse = await sendRequest(port, {
    path: "/api/vms/vm-0001/disk-usage",
    method: "GET",
    headers: {
      accept: "application/json",
    },
  });
  assert.equal(diskUsageResponse.statusCode, 200);

  const diskUsagePayload = JSON.parse(diskUsageResponse.body) as {
    ok: boolean;
    data: {
      vmId: string;
      workspacePath: string;
      status: string;
      detail: string;
      root: {
        mountPath: string;
        path: string;
        filesystem: string | null;
      } | null;
      workspace: {
        mountPath: string;
        path: string;
        filesystem: string | null;
      } | null;
    };
  };

  assert.equal(diskUsagePayload.ok, true);
  assert.equal(diskUsagePayload.data.vmId, "vm-0001");
  assert.equal(diskUsagePayload.data.workspacePath, "/srv/workspaces/alpha-workbench");
  assert.equal(diskUsagePayload.data.status, "ready");
  assert.match(diskUsagePayload.data.detail, /free on the workspace path/i);
  assert.equal(diskUsagePayload.data.root?.mountPath, "/");
  assert.equal(diskUsagePayload.data.root?.path, "/");
  assert.equal(diskUsagePayload.data.workspace?.mountPath, "/");
  assert.equal(
    diskUsagePayload.data.workspace?.path,
    "/srv/workspaces/alpha-workbench",
  );
});

test("protected APIs and event streams require a session cookie when admin auth is enabled", async (context) => {
  const { port } = await startServer(context, {
    adminPassword: "change-me",
    tempDirPrefix: "parallaize-server-session-required-",
  });

  for (const path of ["/api/summary", "/api/health", "/events", "/api/vms/vm-0001/logs/live"]) {
    const response = await sendRequest(port, {
      path,
      method: "GET",
      headers: path === "/events"
        ? { accept: "text/event-stream" }
        : { accept: "application/json" },
    });

    assert.equal(response.statusCode, 401, `Expected 401 for unauthenticated ${path}.`);
    const payload = JSON.parse(response.body) as {
      ok: boolean;
      error?: string;
    };
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "Authentication required.");
  }
});

test("login issues a session cookie that unlocks protected APIs and event streams", async (context) => {
  const { port } = await startServer(context, {
    adminPassword: "change-me",
    tempDirPrefix: "parallaize-server-session-auth-",
  });

  const loginResponse = await sendRequest(port, {
    path: "/api/auth/login",
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      username: "admin",
      password: "change-me",
    }),
  });
  assert.equal(loginResponse.statusCode, 200);

  const sessionCookie = extractCookieHeader(loginResponse);
  assert.match(sessionCookie, /^parallaize_session=/);
  assert.deepEqual(JSON.parse(loginResponse.body), {
    ok: true,
    data: {
      authEnabled: true,
      authenticated: true,
      username: "admin",
      mode: "session",
    },
  });

  const summaryResponse = await sendRequest(port, {
    path: "/api/summary",
    method: "GET",
    headers: {
      cookie: sessionCookie,
      accept: "application/json",
    },
  });
  assert.equal(summaryResponse.statusCode, 200);
  const summaryPayload = JSON.parse(summaryResponse.body) as {
    ok: boolean;
    data: {
      vms: unknown[];
      templates: unknown[];
      jobs: unknown[];
    };
  };
  assert.equal(summaryPayload.ok, true);
  assert.ok(Array.isArray(summaryPayload.data.vms));
  assert.ok(Array.isArray(summaryPayload.data.templates));
  assert.ok(Array.isArray(summaryPayload.data.jobs));

  const eventsResponse = await openEventStream(port, {
    cookie: sessionCookie,
    accept: "text/event-stream",
  });
  assert.equal(eventsResponse.statusCode, 200);
  assert.match(String(eventsResponse.headers["content-type"] ?? ""), /^text\/event-stream;/);
  eventsResponse.destroy();
});

test("live VM log streams push updated snapshots after commands land", async (context) => {
  const { port } = await startServer(context, {
    adminPassword: "",
    tempDirPrefix: "parallaize-server-live-logs-",
  });

  const logsResponse = await openEventStream(
    port,
    {
      accept: "text/event-stream",
    },
    "/api/vms/vm-0001/logs/live",
  );

  context.after(() => {
    logsResponse.destroy();
  });

  const initialSnapshot = await readSseEvent<VmLogsSnapshot>(logsResponse, "snapshot");
  assert.equal(initialSnapshot.providerRef, "alpha-workbench");
  assert.match(initialSnapshot.content, /provider: mock/);

  const commandResponse = await sendRequest(port, {
    path: "/api/vms/vm-0001/input",
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      command: "pwd",
    }),
  });
  assert.equal(commandResponse.statusCode, 202);

  const pushedSnapshot = await readSseEvent<VmLogsSnapshot>(logsResponse, "snapshot");
  assert.match(pushedSnapshot.content, /\$ pwd/);
  assert.match(pushedSnapshot.content, /cwd:/);
});

test("auth status rotates persisted sessions and invalidates the previous cookie", async (context) => {
  const { port } = await startServer(context, {
    adminPassword: "change-me",
    tempDirPrefix: "parallaize-server-session-rotation-",
    extraEnv: {
      PARALLAIZE_SESSION_MAX_AGE_SECONDS: "120",
      PARALLAIZE_SESSION_IDLE_TIMEOUT_SECONDS: "30",
      PARALLAIZE_SESSION_ROTATION_SECONDS: "1",
    },
  });

  const loginResponse = await sendRequest(port, {
    path: "/api/auth/login",
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      username: "admin",
      password: "change-me",
    }),
  });
  assert.equal(loginResponse.statusCode, 200);

  const sessionCookie = extractCookieHeader(loginResponse);
  await waitForTimeout(1_100);

  const rotatedStatusResponse = await sendRequest(port, {
    path: "/api/auth/status",
    method: "GET",
    headers: {
      cookie: sessionCookie,
      accept: "application/json",
    },
  });
  assert.equal(rotatedStatusResponse.statusCode, 200);
  const rotatedCookie = extractCookieHeader(rotatedStatusResponse);
  assert.notEqual(rotatedCookie, sessionCookie);
  assert.deepEqual(JSON.parse(rotatedStatusResponse.body), {
    ok: true,
    data: {
      authEnabled: true,
      authenticated: true,
      username: "admin",
      mode: "session",
    },
  });

  const staleSummaryResponse = await sendRequest(port, {
    path: "/api/summary",
    method: "GET",
    headers: {
      cookie: sessionCookie,
      accept: "application/json",
    },
  });
  assert.equal(staleSummaryResponse.statusCode, 401);

  const rotatedSummaryResponse = await sendRequest(port, {
    path: "/api/summary",
    method: "GET",
    headers: {
      cookie: rotatedCookie,
      accept: "application/json",
    },
  });
  assert.equal(rotatedSummaryResponse.statusCode, 200);
});

test("persisted sessions survive a control-plane restart", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-server-session-restart-"));
  const dataFilePath = join(tempDir, "state.json");

  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const first = await startServer(context, {
    adminPassword: "change-me",
    tempDirPrefix: "parallaize-server-session-restart-unused-",
    dataFilePath,
    cleanupTempDir: false,
  });

  const loginResponse = await sendRequest(first.port, {
    path: "/api/auth/login",
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      username: "admin",
      password: "change-me",
    }),
  });
  assert.equal(loginResponse.statusCode, 200);
  const sessionCookie = extractCookieHeader(loginResponse);

  const firstExit = once(first.serverProcess, "exit");
  first.serverProcess.kill("SIGTERM");
  await Promise.race([
    firstExit,
    waitForTimeout(3_000).then(() => {
      throw new Error("Server did not exit within 3 seconds during restart validation.");
    }),
  ]);

  const second = await startServer(context, {
    adminPassword: "change-me",
    tempDirPrefix: "parallaize-server-session-restart-unused-",
    dataFilePath,
    cleanupTempDir: false,
  });

  const statusResponse = await sendRequest(second.port, {
    path: "/api/auth/status",
    method: "GET",
    headers: {
      cookie: sessionCookie,
      accept: "application/json",
    },
  });
  assert.equal(statusResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(statusResponse.body), {
    ok: true,
    data: {
      authEnabled: true,
      authenticated: true,
      username: "admin",
      mode: "session",
    },
  });

  const summaryResponse = await sendRequest(second.port, {
    path: "/api/summary",
    method: "GET",
    headers: {
      cookie: sessionCookie,
      accept: "application/json",
    },
  });
  assert.equal(summaryResponse.statusCode, 200);
});

test("resolution control claims stay pinned to one client until another client takes over", async (context) => {
  const { port } = await startServer(context, {
    adminPassword: "change-me",
    tempDirPrefix: "parallaize-server-resolution-control-",
  });

  const loginResponse = await sendRequest(port, {
    path: "/api/auth/login",
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      username: "admin",
      password: "change-me",
    }),
  });
  assert.equal(loginResponse.statusCode, 200);

  const sessionCookie = extractCookieHeader(loginResponse);
  const eventsResponse = await openEventStream(port, {
    cookie: sessionCookie,
    accept: "text/event-stream",
  });

  context.after(() => {
    eventsResponse.destroy();
  });

  const initialClaimResponse = await sendRequest(port, {
    path: "/api/vms/vm-0001/resolution-control/claim",
    method: "POST",
    headers: {
      cookie: sessionCookie,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      clientId: "client-a",
    }),
  });
  assert.equal(initialClaimResponse.statusCode, 200);
  const initialClaimPayload = JSON.parse(initialClaimResponse.body) as {
    ok: boolean;
    data: VmResolutionControlSnapshot;
  };
  assert.equal(initialClaimPayload.ok, true);
  assert.equal(initialClaimPayload.data.vmId, "vm-0001");
  assert.equal(initialClaimPayload.data.controller?.clientId, "client-a");
  assert.match(initialClaimPayload.data.controller?.claimedAt ?? "", /\d{4}-\d{2}-\d{2}T/);
  assert.match(initialClaimPayload.data.controller?.heartbeatAt ?? "", /\d{4}-\d{2}-\d{2}T/);

  const initialEvent = await readSseEvent<VmResolutionControlSnapshot>(
    eventsResponse,
    "resolution-control",
  );
  assert.equal(initialEvent.vmId, "vm-0001");
  assert.equal(initialEvent.controller?.clientId, "client-a");

  const blockedClaimResponse = await sendRequest(port, {
    path: "/api/vms/vm-0001/resolution-control/claim",
    method: "POST",
    headers: {
      cookie: sessionCookie,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      clientId: "client-b",
    }),
  });
  assert.equal(blockedClaimResponse.statusCode, 200);
  const blockedClaimPayload = JSON.parse(blockedClaimResponse.body) as {
    ok: boolean;
    data: VmResolutionControlSnapshot;
  };
  assert.equal(
    blockedClaimPayload.data.controller?.clientId,
    "client-a",
  );

  const takeoverResponse = await sendRequest(port, {
    path: "/api/vms/vm-0001/resolution-control/claim",
    method: "POST",
    headers: {
      cookie: sessionCookie,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      clientId: "client-b",
      force: true,
    }),
  });
  assert.equal(takeoverResponse.statusCode, 200);
  const takeoverPayload = JSON.parse(takeoverResponse.body) as {
    ok: boolean;
    data: VmResolutionControlSnapshot;
  };
  assert.equal(
    takeoverPayload.data.controller?.clientId,
    "client-b",
  );

  const takeoverEvent = await readSseEvent<VmResolutionControlSnapshot>(
    eventsResponse,
    "resolution-control",
  );
  assert.equal(takeoverEvent.vmId, "vm-0001");
  assert.equal(takeoverEvent.controller?.clientId, "client-b");
});

test("authenticated clients can fetch latest release metadata through the control plane", async (context) => {
  const releaseMetadataPort = await reservePort();
  const releaseMetadataServer = createHttpServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
    });
    response.end(
      `${JSON.stringify({
        version: "0.1.9",
        packageRelease: "2",
        packageLabel: "0.1.9-2",
      })}\n`,
    );
  });

  releaseMetadataServer.listen(releaseMetadataPort, "127.0.0.1");
  await once(releaseMetadataServer, "listening");

  context.after(async () => {
    releaseMetadataServer.close();
    await once(releaseMetadataServer, "close");
  });

  const { port } = await startServer(context, {
    adminPassword: "change-me",
    tempDirPrefix: "parallaize-server-release-metadata-",
    extraEnv: {
      PARALLAIZE_RELEASE_METADATA_URL: `http://127.0.0.1:${releaseMetadataPort}/latest.json`,
    },
  });

  const loginResponse = await sendRequest(port, {
    path: "/api/auth/login",
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      username: "admin",
      password: "change-me",
    }),
  });
  assert.equal(loginResponse.statusCode, 200);

  const sessionCookie = extractCookieHeader(loginResponse);
  const releaseResponse = await sendRequest(port, {
    path: "/api/version/latest",
    method: "GET",
    headers: {
      cookie: sessionCookie,
      accept: "application/json",
    },
  });

  assert.equal(releaseResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(releaseResponse.body), {
    ok: true,
    data: {
      version: "0.1.9",
      packageRelease: "2",
      packageLabel: "0.1.9-2",
    },
  });
});

test("logout clears the session so refresh returns to the login flow", async (context) => {
  const { port } = await startServer(context, {
    adminPassword: "change-me",
    tempDirPrefix: "parallaize-server-logout-auth-",
  });

  const loginResponse = await sendRequest(port, {
    path: "/api/auth/login",
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      username: "admin",
      password: "change-me",
    }),
  });
  assert.equal(loginResponse.statusCode, 200);

  const sessionCookie = extractCookieHeader(loginResponse);
  assert.match(sessionCookie, /^parallaize_session=/);
  assert.deepEqual(JSON.parse(loginResponse.body), {
    ok: true,
    data: {
      authEnabled: true,
      authenticated: true,
      username: "admin",
      mode: "session",
    },
  });

  const statusResponse = await sendRequest(port, {
    path: "/api/auth/status",
    method: "GET",
    headers: {
      cookie: sessionCookie,
      accept: "application/json",
    },
  });
  assert.equal(statusResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(statusResponse.body), {
    ok: true,
    data: {
      authEnabled: true,
      authenticated: true,
      username: "admin",
      mode: "session",
    },
  });

  const summaryResponse = await sendRequest(port, {
    path: "/api/summary",
    method: "GET",
    headers: {
      cookie: sessionCookie,
      accept: "application/json",
    },
  });
  assert.equal(summaryResponse.statusCode, 200);

  const logoutResponse = await sendRequest(port, {
    path: "/api/auth/logout",
    method: "POST",
    headers: {
      cookie: sessionCookie,
      accept: "application/json",
    },
  });
  assert.equal(logoutResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(logoutResponse.body), {
    ok: true,
    data: {
      authEnabled: true,
      authenticated: false,
      username: null,
      mode: "unauthenticated",
    },
  });

  const loggedOutSummaryResponse = await sendRequest(port, {
    path: "/api/summary",
    method: "GET",
    headers: {
      cookie: sessionCookie,
      accept: "application/json",
    },
  });
  assert.equal(loggedOutSummaryResponse.statusCode, 401);

  const loggedOutStatusResponse = await sendRequest(port, {
    path: "/api/auth/status",
    method: "GET",
    headers: {
      cookie: sessionCookie,
      accept: "application/json",
    },
  });
  assert.equal(loggedOutStatusResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(loggedOutStatusResponse.body), {
    ok: true,
    data: {
      authEnabled: true,
      authenticated: false,
      username: null,
      mode: "unauthenticated",
    },
  });

  const refreshedRootResponse = await sendRequest(port, {
    path: "/",
    method: "GET",
    headers: {
      accept: "text/html",
    },
  });
  assert.equal(refreshedRootResponse.statusCode, 200);
});

async function waitForStdoutLine(
  child: SpawnedServerProcess,
  pattern: RegExp,
): Promise<string> {
  let output = "";

  return await new Promise<string>((resolve, reject) => {
    const onData = (chunk: Buffer | string) => {
      output += chunk.toString();

      if (pattern.test(output)) {
        cleanup();
        resolve(output);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          `Server exited before startup completed (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
        ),
      );
    };
    const cleanup = () => {
      child.stdout.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
    };

    child.stdout.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function startServer(
  context: test.TestContext,
  {
    adminPassword,
    tempDirPrefix,
    dataFilePath,
    extraEnv,
    cleanupTempDir = true,
  }: {
    adminPassword: string;
    tempDirPrefix: string;
    dataFilePath?: string;
    extraEnv?: Record<string, string>;
    cleanupTempDir?: boolean;
  },
): Promise<{
  port: number;
  serverProcess: SpawnedServerProcess;
  startupOutput: string;
}> {
  const tempDir = dataFilePath ? join(dataFilePath, "..") : mkdtempSync(join(tmpdir(), tempDirPrefix));
  const port = await reservePort();
  const serverProcess = spawn(process.execPath, ["dist/apps/control/src/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      PARALLAIZE_PROVIDER: "mock",
      PARALLAIZE_DATA_FILE: dataFilePath ?? join(tempDir, "state.json"),
      PARALLAIZE_ADMIN_PASSWORD: adminPassword,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  context.after(async () => {
    if (serverProcess.exitCode === null && serverProcess.signalCode === null) {
      serverProcess.kill("SIGKILL");
      await once(serverProcess, "exit");
    }

    if (cleanupTempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  const startupOutput = await waitForStdoutLine(
    serverProcess,
    /parallaize listening on http:\/\/127\.0\.0\.1:/,
  );

  return {
    port,
    serverProcess,
    startupOutput,
  };
}

async function openEventStream(
  port: number,
  headers: Record<string, string> = {},
  path = "/events",
): Promise<IncomingMessage> {
  return await new Promise<IncomingMessage>((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers,
      },
      (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Expected 200 from ${path}, got ${response.statusCode ?? "unknown"}.`));
          response.resume();
          return;
        }

        resolve(response);
      },
    );

    req.once("error", reject);
    req.end();
  });
}

async function sendRequest(
  port: number,
  {
    path,
    method,
    headers,
    body,
  }: {
    path: string;
    method: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<IncomingMessage & { body: string }> {
  return await new Promise<IncomingMessage & { body: string }>((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve(Object.assign(response, {
            body: Buffer.concat(chunks).toString("utf8"),
          }));
        });
        response.on("error", reject);
      },
    );

    req.once("error", reject);

    if (body) {
      req.write(body);
    }

    req.end();
  });
}

async function readSseEvent<T>(
  response: IncomingMessage,
  eventName: string,
): Promise<T> {
  let buffer = "";

  return await new Promise<T>((resolve, reject) => {
    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();

      while (true) {
        const boundary = buffer.indexOf("\n\n");

        if (boundary === -1) {
          return;
        }

        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        let currentEvent = "message";
        const dataLines: string[] = [];

        for (const line of block.split("\n")) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice("event: ".length);
            continue;
          }

          if (line.startsWith("data: ")) {
            dataLines.push(line.slice("data: ".length));
          }
        }

        if (currentEvent !== eventName) {
          continue;
        }

        cleanup();
        resolve(JSON.parse(dataLines.join("\n")) as T);
        return;
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(new Error(`Event stream closed before receiving ${eventName}.`));
    };
    const cleanup = () => {
      response.off("data", onData);
      response.off("error", onError);
      response.off("close", onClose);
    };

    response.on("data", onData);
    response.once("error", onError);
    response.once("close", onClose);
  });
}

function extractCookieHeader(response: IncomingMessage): string {
  const setCookie = response.headers["set-cookie"];
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;

  if (!header) {
    throw new Error("Expected a Set-Cookie header.");
  }

  return header.split(";", 1)[0];
}

async function reservePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Failed to reserve an inet port.");
    }

    return address.port;
  } finally {
    server.close();
    await once(server, "close");
  }
}

async function waitForTimeout(timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}
