import type { CommandResult } from "./providers-contracts.js";

export function buildCommandReply(command: string, currentWorkspace: string): string {
  if (command.startsWith("cd ")) {
    return `cwd: ${command.slice(3).trim() || currentWorkspace}`;
  }

  if (command === "pwd") {
    return currentWorkspace;
  }

  if (command === "ls" || command === "ls -la") {
    return "src/  packages/  infra/  README.md  TODO.md";
  }

  if (command.startsWith("git status")) {
    return "working tree clean except for generated mock activity";
  }

  if (command.startsWith("pnpm build")) {
    return "build: compiled control-plane and dashboard successfully";
  }

  if (command.startsWith("pnpm test")) {
    return "test: synthetic provider checks passed";
  }

  if (command.startsWith("incus list")) {
    return "incus: unavailable in demo mode";
  }

  return `completed: ${command}`;
}

export function collectCommandOutput(result: CommandResult): string[] {
  const combined = [result.stdout, result.stderr]
    .filter((chunk) => chunk.length > 0)
    .join(result.stdout && result.stderr && !result.stdout.endsWith("\n") ? "\n" : "")
    .replace(/\r/g, "");
  const lines = combined
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return ["command completed without output"];
  }

  if (lines.length <= 12) {
    return lines;
  }

  const hiddenLineCount = lines.length - 11;
  return [
    ...lines.slice(0, 11),
    `… ${hiddenLineCount} more line${hiddenLineCount === 1 ? "" : "s"}`,
  ];
}

export function summarizeCommandOutput(lines: string[]): string[] {
  return lines.slice(0, 6);
}

export function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

export function formatCommandFailure(args: string[], result: CommandResult): string {
  if (result.error?.message.includes("ENOENT")) {
    return "Incus mode requested, but the incus CLI was not found on this host.";
  }

  if (isCommandTimeout(result)) {
    return `incus ${args.join(" ")} timed out before the host daemon answered.`;
  }

  const detail =
    result.stderr.trim() ||
    result.error?.message ||
    `Command exited with status ${result.status ?? "unknown"}.`;

  if (isGuestAgentUnavailableFailure(result) && args[0] === "exec") {
    return buildGuestAgentUnavailableMessage(args[1]);
  }

  return `incus ${args.join(" ")} failed: ${detail}`;
}

export function isCommandTimeout(result: CommandResult): boolean {
  const errorWithCode = result.error as (Error & { code?: string }) | undefined;
  return errorWithCode?.code === "ETIMEDOUT";
}

export function buildGuestAgentUnavailableMessage(instanceName: string | undefined): string {
  const instanceLabel =
    typeof instanceName === "string" && instanceName.length > 0
      ? ` for ${instanceName}`
      : "";

  return (
    `Incus guest agent is unavailable${instanceLabel}. ` +
    "The VM may already have booted, but guest command execution is not working. " +
    "Repair the Incus guest-agent payload on the host and retry."
  );
}

export function isGuestAgentUnavailableExecFailure(
  args: string[],
  result: CommandResult,
): boolean {
  return args[0] === "exec" && isGuestAgentUnavailableFailure(result);
}

export function isGuestAgentUnavailableFailure(result: CommandResult): boolean {
  const detail = `${result.stderr}\n${result.stdout}\n${result.error?.message ?? ""}`.toLowerCase();
  return (
    detail.includes("failed connecting to instance agent") ||
    detail.includes("failed to connect to instance agent") ||
    detail.includes("vm agent isn't currently connected") ||
    detail.includes("vm agent is not currently connected") ||
    detail.includes("vm agent isn't currently running") ||
    detail.includes("vm agent is not currently running") ||
    detail.includes("agent isn't currently connected") ||
    detail.includes("agent is not currently connected") ||
    detail.includes("agent isn't currently running") ||
    detail.includes("agent is not currently running")
  );
}

export function isMissingInstanceFailure(message: string): boolean {
  return (
    message.includes("Instance not found") ||
    message.includes("Failed to fetch instance")
  );
}

export function isDeleteAlreadySucceededFailure(message: string): boolean {
  return (
    message.includes("A matching non-reusable operation has now succeeded") ||
    message.includes("matching non-reusable operation has now succeeded")
  );
}

export function isMissingDeviceConfigFailure(message: string): boolean {
  return (
    message.includes("The device doesn't exist") ||
    message.includes("Device doesn't exist") ||
    message.includes("Unknown configuration key") ||
    isMissingInstanceFailure(message)
  );
}

export function isAlreadyRunningFailure(message: string): boolean {
  return message.includes("already running");
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
