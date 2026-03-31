import { spawn, spawnSync } from "node:child_process";

import type {
  CommandExecutionOptions,
  CommandResult,
  CommandStreamHandle,
  CommandStreamListeners,
  IncusCommandRunner,
} from "./providers-contracts.js";

const INCUS_SYNC_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

export class SpawnIncusCommandRunner implements IncusCommandRunner {
  constructor(
    private readonly incusBinary: string,
    private readonly project?: string,
  ) {}

  execute(args: string[], options?: CommandExecutionOptions): CommandResult {
    const fullArgs = this.project
      ? ["--project", this.project, ...args]
      : args;
    const result = spawnSync(this.incusBinary, fullArgs, {
      encoding: "utf8",
      input: options?.input,
      maxBuffer: INCUS_SYNC_MAX_BUFFER_BYTES,
      timeout: options?.timeoutMs,
    });

    return {
      args: fullArgs,
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      error: result.error ?? undefined,
    };
  }

  async executeStreaming(
    args: string[],
    listeners: CommandStreamListeners = {},
    options?: CommandExecutionOptions,
  ): Promise<CommandResult> {
    return this.startStreaming(args, listeners, options).completed;
  }

  startStreaming(
    args: string[],
    listeners: CommandStreamListeners = {},
    options?: CommandExecutionOptions,
  ): CommandStreamHandle {
    const fullArgs = this.project
      ? ["--project", this.project, ...args]
      : args;
    let child: ReturnType<typeof spawn>;

    try {
      child = spawn(this.incusBinary, fullArgs, {
        stdio: [options?.input !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
      });
    } catch (error) {
      return {
        close() {},
        completed: Promise.resolve({
          args: fullArgs,
          status: null,
          stdout: "",
          stderr: "",
          error: error instanceof Error ? error : new Error(String(error)),
        }),
      };
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const completed = new Promise<CommandResult>((resolve) => {
      const finish = (result: CommandResult) => {
        if (settled) {
          return;
        }

        settled = true;
        resolve(result);
      };

      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
        listeners.onStdout?.(chunk);
      });

      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
        listeners.onStderr?.(chunk);
      });

      child.stdin?.on("error", () => {
        // Ignore EPIPE-style failures when the command exits before consuming stdin.
      });
      if (options?.input !== undefined) {
        child.stdin?.end(options.input);
      }

      child.on("error", (error) => {
        finish({
          args: fullArgs,
          status: null,
          stdout,
          stderr,
          error,
        });
      });

      child.on("close", (status) => {
        finish({
          args: fullArgs,
          status,
          stdout,
          stderr,
        });
      });
    });

    return {
      close() {
        if (child.killed) {
          return;
        }

        child.kill();
      },
      completed,
    };
  }
}
