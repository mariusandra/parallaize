import { spawn, spawnSync } from "node:child_process";

import type {
  CommandExecutionOptions,
  CommandResult,
  CommandStreamHandle,
  CommandStreamListeners,
  IncusCommandRunner,
} from "./providers-contracts.js";

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
  ): Promise<CommandResult> {
    return this.startStreaming(args, listeners).completed;
  }

  startStreaming(
    args: string[],
    listeners: CommandStreamListeners = {},
  ): CommandStreamHandle {
    const fullArgs = this.project
      ? ["--project", this.project, ...args]
      : args;
    const child = spawn(this.incusBinary, fullArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });
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
