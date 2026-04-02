import { spawnSync } from "node:child_process";

import type {
  IncusStorageAction,
  IncusStorageActionResult,
  IncusStorageDiagnostics,
  IncusStoragePoolSummary,
} from "../../../packages/shared/src/types.js";
import type { AppConfig } from "./config.js";

const STORAGE_PROBE_TIMEOUT_MS = 2_500;
const STORAGE_BOOTSTRAP_TIMEOUT_MS = 15_000;
const DIR_POOL_THIN_LVM_COMMAND =
  "sudo incus storage create parallaize-lvm lvm size=200GiB lvm.use_thinpool=true";
const DIR_POOL_THIN_LVM_ENV_FILE = "/etc/parallaize/parallaize.env";
const DIR_POOL_THIN_LVM_ENV_LINE = "PARALLAIZE_INCUS_STORAGE_POOL=parallaize-lvm";
const DIR_POOL_THIN_LVM_RESTART_COMMAND = "sudo systemctl restart parallaize";

export interface ShellCommandRunner {
  execute(
    command: string,
    args: string[],
    options?: CommandExecutionOptions,
  ): ShellCommandResult;
}

interface CommandExecutionOptions {
  input?: string;
  timeoutMs?: number;
}

interface ShellCommandResult {
  args: string[];
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

interface IncusStoragePoolRecord {
  name?: string;
  driver?: string;
  config?: Record<string, string>;
}

interface IncusProfileRecord {
  devices?: Record<
    string,
    {
      type?: string;
      path?: string;
      pool?: string;
    }
  >;
}

export function collectIncusStorageDiagnostics(
  config: AppConfig,
  runner: ShellCommandRunner = new SpawnShellCommandRunner(),
): IncusStorageDiagnostics | null {
  if (config.providerKind !== "incus") {
    return null;
  }

  const configuredPool = normalizeOptionalValue(config.incusStoragePool);
  const defaultProfilePool = readDefaultProfilePool(config, runner);
  const poolsResult = runIncusCommand(
    config,
    runner,
    ["query", "/1.0/storage-pools?recursion=1"],
    {
      projectScoped: false,
      timeoutMs: STORAGE_PROBE_TIMEOUT_MS,
    },
  );
  const availablePools =
    poolsResult.status === 0
      ? parseIncusStoragePools(poolsResult.stdout)
      : [];
  const selectedPool = configuredPool ?? defaultProfilePool;
  const selectedPoolRecord =
    selectedPool === null
      ? null
      : availablePools.find((pool) => pool.name === selectedPool) ?? null;
  const selectedPoolDriver = normalizeOptionalValue(selectedPoolRecord?.driver);
  const selectedPoolSource = normalizeOptionalValue(selectedPoolRecord?.config?.source);
  const selectedPoolLoopBacked =
    selectedPoolRecord === null ? null : isLoopBackedPool(selectedPoolRecord);
  const availablePoolSummaries = summarizePools(availablePools);

  if (selectedPoolRecord) {
    if (selectedPoolDriver === "dir") {
      return {
        status: "warning",
        detail:
          `New VMs are landing on the Incus pool "${selectedPool}" with the ` +
          "`dir` driver. Move new workspaces to a thin, single-file `lvm` pool so " +
          "create, clone, and snapshot churn stop paying the `dir` penalty.",
        configuredPool,
        defaultProfilePool,
        selectedPool,
        selectedPoolDriver,
        selectedPoolSource,
        selectedPoolLoopBacked,
        availablePools: availablePoolSummaries,
        nextSteps: [
          `Run \`${DIR_POOL_THIN_LVM_COMMAND}\` on the host to create the thin, loop-backed LVM pool.`,
          `Add \`${DIR_POOL_THIN_LVM_ENV_LINE}\` to \`${DIR_POOL_THIN_LVM_ENV_FILE}\`, then run \`${DIR_POOL_THIN_LVM_RESTART_COMMAND}\` so Parallaize starts targeting it.`,
          "Keep in mind that existing VMs stay on their current Incus pool until you migrate them separately.",
        ],
      };
    }

    if (selectedPoolDriver === "btrfs" && selectedPoolLoopBacked) {
      return {
        status: "warning",
        detail:
          `New VMs are landing on the Incus pool "${selectedPool}" with a loop-backed ` +
          "`btrfs` driver. That is materially better than `dir`, but still a bootstrap compromise.",
        configuredPool,
        defaultProfilePool,
        selectedPool,
        selectedPoolDriver,
        selectedPoolSource,
        selectedPoolLoopBacked,
        availablePools: availablePoolSummaries,
        nextSteps: [
          "For production workloads, move to a dedicated `zfs`, `lvm`, or native `btrfs` pool instead of a loop-backed file.",
          "Update `PARALLAIZE_INCUS_STORAGE_POOL=<pool-name>` and restart Parallaize after the faster pool exists.",
          "Switching JSON to PostgreSQL improves control-plane durability, but it will not speed up VM disk operations.",
        ],
      };
    }

    return {
      status: "ready",
      detail:
        `New VMs are targeting the Incus pool "${selectedPool}" with the ` +
        `"${selectedPoolDriver ?? "unknown"}" driver.`,
      configuredPool,
      defaultProfilePool,
      selectedPool,
      selectedPoolDriver,
      selectedPoolSource,
      selectedPoolLoopBacked,
      availablePools: availablePoolSummaries,
      nextSteps:
        configuredPool === null
          ? [
              "Parallaize is currently following the Incus default profile root disk. Pin `PARALLAIZE_INCUS_STORAGE_POOL` if you want explicit placement.",
            ]
          : [],
    };
  }

  if (poolsResult.status !== 0) {
    return {
      status: "unavailable",
      detail:
        "Parallaize could not inspect Incus storage pools yet. Fix Incus reachability first, then rescan.",
      configuredPool,
      defaultProfilePool,
      selectedPool,
      selectedPoolDriver: null,
      selectedPoolSource: null,
      selectedPoolLoopBacked: null,
      availablePools: [],
      nextSteps: [
        "Restore Incus CLI and daemon health first.",
        selectedPool
          ? `Once Incus is reachable again, confirm that pool "${selectedPool}" exists and uses a non-\`dir\` driver.`
          : "Once Incus is reachable again, confirm which pool the default profile is using for root disks.",
      ],
    };
  }

  return {
    status: "warning",
    detail:
      selectedPool !== null
        ? `Parallaize is configured to target the Incus pool "${selectedPool}", but the pool was not found in the current Incus storage list.`
        : "Parallaize could not determine which Incus storage pool new VMs will land on.",
    configuredPool,
    defaultProfilePool,
    selectedPool,
    selectedPoolDriver: null,
    selectedPoolSource: null,
    selectedPoolLoopBacked: null,
    availablePools: availablePoolSummaries,
    nextSteps:
      selectedPool !== null
        ? [
            `Create or select a real Incus pool named "${selectedPool}", or change \`PARALLAIZE_INCUS_STORAGE_POOL\` to a pool that already exists.`,
            "Restart Parallaize after updating the storage-pool setting so new VMs land where you expect.",
          ]
        : [
            "Inspect the Incus default profile root disk and set `PARALLAIZE_INCUS_STORAGE_POOL=<pool-name>` if you want explicit placement.",
          ],
  };
}

export function runIncusStorageAction(
  config: AppConfig,
  action: IncusStorageAction,
  runner: ShellCommandRunner = new SpawnShellCommandRunner(),
): IncusStorageActionResult {
  if (config.providerKind !== "incus") {
    return {
      action,
      changed: false,
      message: "Incus storage actions are only available when the Incus provider is enabled.",
      output: [],
    };
  }

  switch (action) {
    case "probe": {
      const diagnostics = collectIncusStorageDiagnostics(config, runner);
      return {
        action,
        changed: false,
        message: diagnostics?.detail ?? "Incus storage probing is unavailable in mock mode.",
        output: diagnostics?.nextSteps ?? [],
      };
    }
    case "bootstrap":
      return bootstrapBlankIncusHost(config, runner);
    default:
      return assertNever(action);
  }
}

class SpawnShellCommandRunner implements ShellCommandRunner {
  execute(
    command: string,
    args: string[],
    options?: CommandExecutionOptions,
  ): ShellCommandResult {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      input: options?.input,
      timeout: options?.timeoutMs,
    });

    return {
      args,
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      error: result.error ?? undefined,
    };
  }
}

function bootstrapBlankIncusHost(
  config: AppConfig,
  runner: ShellCommandRunner,
): IncusStorageActionResult {
  const output: string[] = [];
  const pools = readStoragePoolsOrThrow(config, runner);
  const profile = readDefaultProfileOrThrow(config, runner);
  const bridgeProbe = runIncusCommand(config, runner, ["network", "show", "incusbr0"], {
    projectScoped: false,
    timeoutMs: STORAGE_PROBE_TIMEOUT_MS,
  });
  const hasBridge = bridgeProbe.status === 0;
  const hasStorage = pools.length > 0;
  const defaultProfileEmpty = profileHasNoDevices(profile);

  output.push(
    `Detected ${pools.length} Incus storage pool${pools.length === 1 ? "" : "s"}.`,
  );
  output.push(
    hasBridge
      ? "Found an existing incusbr0 bridge."
      : "No incusbr0 bridge was found.",
  );
  output.push(
    defaultProfileEmpty
      ? "The default Incus profile is empty."
      : "The default Incus profile already has devices configured.",
  );

  if (hasStorage || hasBridge || !defaultProfileEmpty) {
    return {
      action: "bootstrap",
      changed: false,
      message:
        "Skipped blank-host bootstrap because Incus already has storage, networking, or a populated default profile.",
      output,
    };
  }

  const preferredDriver = hasMkfsBtrfs(runner) ? "btrfs" : "dir";
  const preferredResult = runIncusCommand(
    config,
    runner,
    ["admin", "init", "--preseed"],
    {
      input: buildBlankHostPreseed(preferredDriver),
      projectScoped: false,
      timeoutMs: STORAGE_BOOTSTRAP_TIMEOUT_MS,
    },
  );

  if (preferredResult.status === 0) {
    output.push(`Initialized the blank host with a "${preferredDriver}" pool named "default".`);
    return {
      action: "bootstrap",
      changed: true,
      message:
        preferredDriver === "btrfs"
          ? "Initialized a blank Incus host with a loop-backed btrfs pool, incusbr0 bridge, and default profile."
          : "Initialized a blank Incus host with a dir-backed pool, incusbr0 bridge, and default profile.",
      output,
    };
  }

  if (preferredDriver === "btrfs") {
    output.push("The preferred btrfs bootstrap failed, retrying with dir.");
    const fallbackResult = runIncusCommand(
      config,
      runner,
      ["admin", "init", "--preseed"],
      {
        input: buildBlankHostPreseed("dir"),
        projectScoped: false,
        timeoutMs: STORAGE_BOOTSTRAP_TIMEOUT_MS,
      },
    );

    if (fallbackResult.status === 0) {
      output.push('Initialized the blank host with the fallback "dir" pool named "default".');
      return {
        action: "bootstrap",
        changed: true,
        message:
          "Initialized a blank Incus host with the fallback dir pool after the preferred btrfs bootstrap failed.",
        output,
      };
    }

    throw new Error(formatCommandFailure(fallbackResult));
  }

  throw new Error(formatCommandFailure(preferredResult));
}

function readStoragePoolsOrThrow(
  config: AppConfig,
  runner: ShellCommandRunner,
): IncusStoragePoolRecord[] {
  const result = runIncusCommand(
    config,
    runner,
    ["query", "/1.0/storage-pools?recursion=1"],
    {
      projectScoped: false,
      timeoutMs: STORAGE_PROBE_TIMEOUT_MS,
    },
  );

  if (result.status !== 0) {
    throw new Error(formatCommandFailure(result));
  }

  return parseIncusStoragePools(result.stdout);
}

function readDefaultProfilePool(
  config: AppConfig,
  runner: ShellCommandRunner,
): string | null {
  const result = runIncusCommand(
    config,
    runner,
    ["query", buildProfileQueryPath(config.incusProject)],
    {
      projectScoped: false,
      timeoutMs: STORAGE_PROBE_TIMEOUT_MS,
    },
  );

  if (result.status !== 0) {
    return null;
  }

  const profile = unwrapIncusMetadata<IncusProfileRecord>(parseJson(result.stdout));
  return findDefaultProfileRootPool(profile);
}

function readDefaultProfileOrThrow(
  config: AppConfig,
  runner: ShellCommandRunner,
): IncusProfileRecord {
  const result = runIncusCommand(
    config,
    runner,
    ["query", buildProfileQueryPath(config.incusProject)],
    {
      projectScoped: false,
      timeoutMs: STORAGE_PROBE_TIMEOUT_MS,
    },
  );

  if (result.status !== 0) {
    throw new Error(formatCommandFailure(result));
  }

  return unwrapIncusMetadata<IncusProfileRecord>(parseJson(result.stdout));
}

function runIncusCommand(
  config: AppConfig,
  runner: ShellCommandRunner,
  args: string[],
  options: {
    input?: string;
    projectScoped: boolean;
    timeoutMs: number;
  },
): ShellCommandResult {
  const fullArgs =
    options.projectScoped && config.incusProject
      ? ["--project", config.incusProject, ...args]
      : args;

  return runner.execute(config.incusBinary, fullArgs, {
    input: options.input,
    timeoutMs: options.timeoutMs,
  });
}

function parseIncusStoragePools(value: string): IncusStoragePoolRecord[] {
  const parsed = unwrapIncusMetadata<unknown>(parseJson(value));
  return Array.isArray(parsed)
    ? parsed.filter((entry): entry is IncusStoragePoolRecord => typeof entry === "object" && entry !== null)
    : [];
}

function summarizePools(pools: IncusStoragePoolRecord[]): IncusStoragePoolSummary[] {
  return pools
    .map((pool) => ({
      name: pool.name?.trim() || "(unnamed)",
      driver: normalizeOptionalValue(pool.driver),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function buildProfileQueryPath(project: string | null): string {
  if (!project) {
    return "/1.0/profiles/default";
  }

  const search = new URLSearchParams({
    project,
  });

  return `/1.0/profiles/default?${search.toString()}`;
}

function findDefaultProfileRootPool(profile: IncusProfileRecord): string | null {
  const devices = Object.values(profile.devices ?? {});
  const rootDisk =
    devices.find((device) => device.type === "disk" && device.path === "/") ??
    devices.find((device) => device.type === "disk" && device.pool);

  return normalizeOptionalValue(rootDisk?.pool);
}

function profileHasNoDevices(profile: IncusProfileRecord): boolean {
  return Object.keys(profile.devices ?? {}).length === 0;
}

function isLoopBackedPool(pool: IncusStoragePoolRecord): boolean {
  const source = normalizeOptionalValue(pool.config?.source);

  if (!source) {
    return false;
  }

  return source.includes("/var/lib/incus/disks/") || source.endsWith(".img");
}

function hasMkfsBtrfs(runner: ShellCommandRunner): boolean {
  const result = runner.execute("bash", ["-lc", "command -v mkfs.btrfs >/dev/null 2>&1"], {
    timeoutMs: STORAGE_PROBE_TIMEOUT_MS,
  });
  return result.status === 0;
}

function buildBlankHostPreseed(driver: "btrfs" | "dir"): string {
  return [
    "config: {}",
    "networks:",
    "- name: incusbr0",
    "  type: bridge",
    "  config:",
    "    ipv4.address: auto",
    "    ipv6.address: auto",
    "storage_pools:",
    "- name: default",
    `  driver: ${driver}`,
    "profiles:",
    "- name: default",
    "  description: Default Incus profile",
    "  config: {}",
    "  devices:",
    "    eth0:",
    "      name: eth0",
    "      network: incusbr0",
    "      type: nic",
    "    root:",
    "      path: /",
    "      pool: default",
    "      type: disk",
    "",
  ].join("\n");
}

function formatCommandFailure(result: ShellCommandResult): string {
  const detail =
    result.stderr.trim() ||
    result.stdout.trim() ||
    result.error?.message ||
    "unknown Incus error";

  return `${["incus", ...result.args].join(" ")} failed: ${detail}`;
}

function normalizeOptionalValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function unwrapIncusMetadata<T>(value: unknown): T {
  if (
    typeof value === "object" &&
    value !== null &&
    "metadata" in value
  ) {
    return (value as { metadata: T }).metadata;
  }

  return value as T;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Incus storage action: ${String(value)}`);
}
