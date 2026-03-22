import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

export interface StartedBuiltServer {
  baseUrl: string;
  child: ChildProcessWithoutNullStreams;
  port: number;
  stateFile: string;
  stop(): Promise<void>;
}

export async function startBuiltServer(
  envOverrides: Record<string, string | undefined> = {},
): Promise<StartedBuiltServer> {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-server-"));
  const stateFile = join(tempDir, "state.json");
  const serverPath = resolve(process.cwd(), "dist", "apps", "control", "src", "server.js");

  assert.ok(existsSync(serverPath), `Built server entrypoint was not found: ${serverPath}`);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: "0",
    PARALLAIZE_PROVIDER: "mock",
    PARALLAIZE_DATA_FILE: stateFile,
  };

  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      delete env[key];
      continue;
    }

    env[key] = value;
  }

  const child = spawn(process.execPath, [serverPath], {
    cwd: process.cwd(),
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const port = await waitForListeningPort(child);

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    child,
    port,
    stateFile,
    async stop() {
      await stopChild(child);
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

async function waitForListeningPort(
  child: ChildProcessWithoutNullStreams,
): Promise<number> {
  const listeningPattern =
    /parallaize listening on http:\/\/127\.0\.0\.1:(\d+) using [a-z]+ provider with [a-z]+ persistence/;
  let stdout = "";
  let stderr = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  return await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Timed out waiting for the control plane to boot.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    }, 10_000);

    const onStdout = (chunk: string) => {
      stdout += chunk;
      const match = stdout.match(listeningPattern);

      if (!match) {
        return;
      }

      cleanup();
      resolve(Number.parseInt(match[1] ?? "", 10));
    };

    const onStderr = (chunk: string) => {
      stderr += chunk;
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          `Control plane exited before becoming ready (code=${code}, signal=${signal}).\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    };

    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("exit", onExit);
    };

    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.once("exit", onExit);
  });
}

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");

  const exitPromise = new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });
  const timeout = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }, 5_000);

  try {
    await exitPromise;
  } finally {
    clearTimeout(timeout);
  }
}
