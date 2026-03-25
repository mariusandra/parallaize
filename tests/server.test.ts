import assert from "node:assert/strict";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { request, type IncomingMessage } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import type { Readable } from "node:stream";
import test from "node:test";

type SpawnedServerProcess = ChildProcessByStdio<null, Readable, Readable>;

test("control plane exits promptly on SIGTERM even with an open SSE client", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-server-shutdown-"));
  const port = await reservePort();
  let serverProcess: SpawnedServerProcess | null = null;
  let eventsResponse: IncomingMessage | null = null;

  context.after(async () => {
    eventsResponse?.destroy();

    if (serverProcess && serverProcess.exitCode === null && serverProcess.signalCode === null) {
      serverProcess.kill("SIGKILL");
      await once(serverProcess, "exit");
    }

    rmSync(tempDir, { recursive: true, force: true });
  });

  const spawnedServer = spawn(process.execPath, ["dist/apps/control/src/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      PARALLAIZE_PROVIDER: "mock",
      PARALLAIZE_DATA_FILE: join(tempDir, "state.json"),
      PARALLAIZE_ADMIN_PASSWORD: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess = spawnedServer;

  const startupOutput = await waitForStdoutLine(spawnedServer, /parallaize listening on http:\/\/127\.0\.0\.1:/);
  assert.match(startupOutput, /using mock provider/);

  eventsResponse = await openEventStream(port);
  await once(eventsResponse, "data");

  const shutdownStartedAt = Date.now();
  const exitPromise = once(spawnedServer, "exit");
  spawnedServer.kill("SIGTERM");

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

async function openEventStream(port: number): Promise<IncomingMessage> {
  return await new Promise<IncomingMessage>((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path: "/events",
        method: "GET",
        headers: {
          Accept: "text/event-stream",
        },
      },
      (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Expected 200 from /events, got ${response.statusCode ?? "unknown"}.`));
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
