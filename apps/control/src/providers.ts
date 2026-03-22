import { spawnSync } from "node:child_process";
import { connect as connectTcp } from "node:net";

import { slugify } from "../../../packages/shared/src/helpers.js";
import type {
  EnvironmentTemplate,
  ProviderKind,
  ProviderState,
  ResourceSpec,
  Snapshot,
  VmInstance,
  VmSession,
  VmWindow,
} from "../../../packages/shared/src/types.js";

const DEFAULT_GUEST_VNC_PORT = 5900;
const DEFAULT_GUEST_WORKSPACE = "/root";

export interface CaptureTemplateTarget {
  templateId: string;
  name: string;
}

export interface CreateProviderOptions {
  project?: string;
  guestVncPort?: number;
  commandRunner?: IncusCommandRunner;
  guestPortProbe?: GuestPortProbe;
}

export interface DesktopProvider {
  state: ProviderState;
  refreshState(): ProviderState;
  createVm(
    vm: VmInstance,
    template: EnvironmentTemplate,
  ): Promise<ProviderMutation>;
  cloneVm(
    sourceVm: VmInstance,
    targetVm: VmInstance,
    template: EnvironmentTemplate,
  ): Promise<ProviderMutation>;
  startVm(vm: VmInstance): Promise<ProviderMutation>;
  stopVm(vm: VmInstance): Promise<ProviderMutation>;
  deleteVm(vm: VmInstance): Promise<ProviderMutation>;
  resizeVm(vm: VmInstance, resources: ResourceSpec): Promise<ProviderMutation>;
  snapshotVm(vm: VmInstance, label: string): Promise<ProviderSnapshot>;
  launchVmFromSnapshot(
    snapshot: Snapshot,
    targetVm: VmInstance,
    template: EnvironmentTemplate,
  ): Promise<ProviderMutation>;
  restoreVmToSnapshot(
    vm: VmInstance,
    snapshot: Snapshot,
  ): Promise<ProviderMutation>;
  captureTemplate(
    vm: VmInstance,
    target: CaptureTemplateTarget,
  ): Promise<ProviderSnapshot>;
  injectCommand(vm: VmInstance, command: string): Promise<ProviderMutation>;
  tickVm(vm: VmInstance, template: EnvironmentTemplate): ProviderTick | null;
  renderFrame(
    vm: VmInstance,
    template: EnvironmentTemplate | null,
    mode: "tile" | "detail",
  ): string;
}

export interface ProviderMutation {
  lastAction: string;
  activity: string[];
  activeWindow?: VmWindow;
  workspacePath?: string;
  session?: VmSession | null;
  commandResult?: ProviderCommandResult;
}

export interface ProviderSnapshot {
  providerRef: string;
  summary: string;
  launchSource?: string;
}

export interface ProviderTick {
  activity?: string;
  activeWindow?: VmWindow;
}

interface ProviderCommandResult {
  command: string;
  output: string[];
  workspacePath: string;
}

interface IncusCommandRunner {
  execute(args: string[]): CommandResult;
}

interface CommandResult {
  args: string[];
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

interface GuestPortProbe {
  probe(host: string, port: number): Promise<boolean>;
}

interface IncusListInstance {
  name?: string;
  status?: string;
  state?: {
    status?: string;
    network?: Record<
      string,
      {
        addresses?: Array<{
          family?: string;
          address?: string;
          scope?: string;
        }>;
      }
    >;
  };
}

export function createProvider(
  kind: ProviderKind,
  incusBinary: string,
  options: CreateProviderOptions = {},
): DesktopProvider {
  if (kind === "incus") {
    return new IncusProvider(incusBinary, options);
  }

  return new MockProvider();
}

class MockProvider implements DesktopProvider {
  state: ProviderState = buildMockProviderState();

  refreshState(): ProviderState {
    return this.state;
  }

  async createVm(
    vm: VmInstance,
    template: EnvironmentTemplate,
  ): Promise<ProviderMutation> {
    return {
      lastAction: `Provisioned from ${template.name}`,
      activity: [
        `boot: ubuntu desktop launched from ${template.launchSource}`,
        `provider ref: ${vm.providerRef}`,
        `resources: ${vm.resources.cpu} CPU / ${vm.resources.ramMb} MB / ${vm.resources.diskGb} GB`,
        `workspace: /srv/workspaces/${slugify(vm.name)}`,
      ],
      activeWindow: "editor",
      workspacePath: `/srv/workspaces/${slugify(vm.name)}`,
      session: buildSyntheticSession(),
    };
  }

  async cloneVm(
    vm: VmInstance,
    targetVm: VmInstance,
    template: EnvironmentTemplate,
  ): Promise<ProviderMutation> {
    return {
      lastAction: `Cloned from ${vm.name}`,
      activity: [
        `clone: copied disks and metadata from ${vm.name}`,
        `template: ${template.name}`,
        `workspace: /srv/workspaces/${slugify(targetVm.name)}`,
      ],
      activeWindow: vm.activeWindow,
      workspacePath: `/srv/workspaces/${slugify(targetVm.name)}`,
      session: buildSyntheticSession(),
    };
  }

  async startVm(): Promise<ProviderMutation> {
    return {
      lastAction: "Workspace resumed",
      activity: [
        "resume: desktop compositor restarted",
        "agent: session heartbeat restored",
      ],
      activeWindow: "terminal",
      session: buildSyntheticSession(),
    };
  }

  async stopVm(): Promise<ProviderMutation> {
    return {
      lastAction: "Workspace stopped",
      activity: [
        "stop: VM state checkpoint saved",
        "session: desktop marked inactive",
      ],
      activeWindow: "logs",
      session: buildSyntheticSession(),
    };
  }

  async deleteVm(vm: VmInstance): Promise<ProviderMutation> {
    return {
      lastAction: `Workspace ${vm.name} deleted`,
      activity: ["delete: disks and metadata released"],
      activeWindow: "logs",
      session: null,
    };
  }

  async resizeVm(
    vm: VmInstance,
    resources: ResourceSpec,
  ): Promise<ProviderMutation> {
    return {
      lastAction: `Resources updated for ${vm.name}`,
      activity: [
        `limits: cpu=${resources.cpu} ram=${resources.ramMb}MB disk=${resources.diskGb}GB`,
      ],
      activeWindow: "logs",
      session: buildSyntheticSession(),
    };
  }

  async snapshotVm(vm: VmInstance, label: string): Promise<ProviderSnapshot> {
    return {
      providerRef: `mock://snapshots/${slugify(vm.name)}-${slugify(label)}`,
      summary: `Snapshot ${label} captured from ${vm.name}.`,
    };
  }

  async launchVmFromSnapshot(
    snapshot: Snapshot,
    targetVm: VmInstance,
    template: EnvironmentTemplate,
  ): Promise<ProviderMutation> {
    return {
      lastAction: `Launched from snapshot ${snapshot.label}`,
      activity: [
        `snapshot launch: ${snapshot.label}`,
        `template: ${template.name}`,
        `workspace: /srv/workspaces/${slugify(targetVm.name)}`,
      ],
      activeWindow: "terminal",
      workspacePath: `/srv/workspaces/${slugify(targetVm.name)}`,
      session: buildSyntheticSession(),
    };
  }

  async restoreVmToSnapshot(
    vm: VmInstance,
    snapshot: Snapshot,
  ): Promise<ProviderMutation> {
    return {
      lastAction: `Restored ${vm.name} to ${snapshot.label}`,
      activity: [
        `snapshot restore: ${snapshot.label}`,
        `workspace: ${vm.workspacePath}`,
      ],
      activeWindow: "terminal",
      workspacePath: vm.workspacePath,
      session: buildSyntheticSession(),
    };
  }

  async captureTemplate(
    vm: VmInstance,
    target: CaptureTemplateTarget,
  ): Promise<ProviderSnapshot> {
    return {
      providerRef: `mock://snapshots/${target.templateId}`,
      summary: `Template ${target.name} captured from ${vm.name}.`,
      launchSource: `mock://templates/${slugify(target.name)}`,
    };
  }

  async injectCommand(
    vm: VmInstance,
    command: string,
  ): Promise<ProviderMutation> {
    const trimmed = command.trim();
    const reply = buildCommandReply(trimmed, vm.workspacePath);
    const nextWorkspacePath = reply.startsWith("cwd:")
      ? reply.replace("cwd: ", "")
      : vm.workspacePath;

    return {
      lastAction: `Executed: ${trimmed}`,
      activity: [`$ ${trimmed}`, reply],
      activeWindow: "terminal",
      workspacePath: nextWorkspacePath,
      session: buildSyntheticSession(),
      commandResult: {
        command: trimmed,
        output: [reply],
        workspacePath: nextWorkspacePath,
      },
    };
  }

  tickVm(vm: VmInstance, template: EnvironmentTemplate): ProviderTick | null {
    if (vm.status !== "running") {
      return null;
    }

    const sequence = (vm.frameRevision + vm.screenSeed) % 8;

    const windows: VmWindow[] = ["editor", "terminal", "browser", "logs"];
    const activeWindow = windows[sequence % windows.length];
    const activity = selectActivityLine(activeWindow, template.name, vm.name, sequence);

    return {
      activeWindow,
      activity,
    };
  }

  renderFrame(
    vm: VmInstance,
    template: EnvironmentTemplate | null,
    mode: "tile" | "detail",
  ): string {
    return renderSyntheticFrame(vm, template, mode, this.state.detail);
  }
}

class IncusProvider implements DesktopProvider {
  state: ProviderState;
  private readonly guestVncPort: number;
  private readonly runner: IncusCommandRunner;
  private readonly project: string | null;
  private readonly guestPortProbe: GuestPortProbe;

  constructor(
    private readonly incusBinary: string,
    options: CreateProviderOptions,
  ) {
    this.guestVncPort = options.guestVncPort ?? DEFAULT_GUEST_VNC_PORT;
    this.project = options.project ?? null;
    this.runner =
      options.commandRunner ??
      new SpawnIncusCommandRunner(this.incusBinary, options.project);
    this.guestPortProbe = options.guestPortProbe ?? new TcpGuestPortProbe();
    this.state = this.probeState();
  }

  refreshState(): ProviderState {
    this.state = this.probeState();
    return this.state;
  }

  async createVm(
    vm: VmInstance,
    template: EnvironmentTemplate,
  ): Promise<ProviderMutation> {
    this.assertAvailable();
    this.assertLaunchSource(template);

    this.run([
      "init",
      template.launchSource,
      vm.providerRef,
      "--vm",
      "-c",
      `limits.cpu=${vm.resources.cpu}`,
      "-c",
      `limits.memory=${formatMemoryLimit(vm.resources.ramMb)}`,
      "-d",
      `root,size=${formatDiskSize(vm.resources.diskGb)}`,
    ]);
    this.run([
      "config",
      "set",
      vm.providerRef,
      "cloud-init.user-data",
      buildGuestVncCloudInit(this.guestVncPort),
    ]);
    this.ensureAgentDevice(vm.providerRef);
    this.run(["start", vm.providerRef]);

    const session = await this.resolveSession(vm.providerRef);

    return {
      lastAction: `Provisioned from ${template.name}`,
      activity: [
        `incus: launched ${vm.providerRef} from ${template.launchSource}`,
        `resources: ${vm.resources.cpu} CPU / ${formatMemoryLimit(vm.resources.ramMb)} / ${formatDiskSize(vm.resources.diskGb)}`,
        session ? `vnc: ${session.display}` : "vnc: guest network pending",
      ],
      activeWindow: "terminal",
      workspacePath: DEFAULT_GUEST_WORKSPACE,
      session,
    };
  }

  async cloneVm(
    sourceVm: VmInstance,
    targetVm: VmInstance,
    template: EnvironmentTemplate,
  ): Promise<ProviderMutation> {
    this.assertAvailable();

    this.run([
      "copy",
      sourceVm.providerRef,
      targetVm.providerRef,
      "--instance-only",
      "-c",
      `limits.cpu=${targetVm.resources.cpu}`,
      "-c",
      `limits.memory=${formatMemoryLimit(targetVm.resources.ramMb)}`,
      "-d",
      `root,size=${formatDiskSize(targetVm.resources.diskGb)}`,
    ]);
    this.ensureAgentDevice(targetVm.providerRef);
    this.run(["start", targetVm.providerRef]);

    const session = await this.resolveSession(targetVm.providerRef);

    return {
      lastAction: `Cloned from ${sourceVm.name}`,
      activity: [
        `incus: cloned ${sourceVm.providerRef} to ${targetVm.providerRef}`,
        `template: ${template.name}`,
        session ? `vnc: ${session.display}` : "vnc: guest network pending",
      ],
      activeWindow: "terminal",
      workspacePath: sourceVm.workspacePath || DEFAULT_GUEST_WORKSPACE,
      session,
    };
  }

  async startVm(vm: VmInstance): Promise<ProviderMutation> {
    this.assertAvailable();
    this.ensureAgentDevice(vm.providerRef);
    this.run(["start", vm.providerRef]);
    const session = await this.resolveSession(vm.providerRef);

    return {
      lastAction: "Workspace resumed",
      activity: [
        `incus: started ${vm.providerRef}`,
        session ? `vnc: ${session.display}` : "vnc: guest network pending",
      ],
      activeWindow: "terminal",
      workspacePath: vm.workspacePath || DEFAULT_GUEST_WORKSPACE,
      session,
    };
  }

  async stopVm(vm: VmInstance): Promise<ProviderMutation> {
    this.assertAvailable();
    this.stopInstance(vm.providerRef);

    return {
      lastAction: "Workspace stopped",
      activity: [`incus: stopped ${vm.providerRef}`],
      activeWindow: "logs",
      session: null,
    };
  }

  async deleteVm(vm: VmInstance): Promise<ProviderMutation> {
    this.assertAvailable();
    this.run(["delete", vm.providerRef, "--force"]);

    return {
      lastAction: `Workspace ${vm.name} deleted`,
      activity: [`incus: deleted ${vm.providerRef}`],
      activeWindow: "logs",
      session: null,
    };
  }

  async resizeVm(
    vm: VmInstance,
    resources: ResourceSpec,
  ): Promise<ProviderMutation> {
    this.assertAvailable();

    this.run([
      "config",
      "set",
      vm.providerRef,
      `limits.cpu=${resources.cpu}`,
      `limits.memory=${formatMemoryLimit(resources.ramMb)}`,
    ]);
    this.run([
      "config",
      "device",
      "set",
      vm.providerRef,
      "root",
      `size=${formatDiskSize(resources.diskGb)}`,
    ]);

    return {
      lastAction: `Resources updated for ${vm.name}`,
      activity: [
        `incus: resized ${vm.providerRef}`,
        `limits: cpu=${resources.cpu} ram=${formatMemoryLimit(resources.ramMb)} disk=${formatDiskSize(resources.diskGb)}`,
      ],
      activeWindow: "logs",
      session: vm.status === "running" ? await this.resolveSession(vm.providerRef) : vm.session,
    };
  }

  async snapshotVm(vm: VmInstance, label: string): Promise<ProviderSnapshot> {
    this.assertAvailable();
    const snapshotName = buildSnapshotName(label);

    this.run(["snapshot", "create", vm.providerRef, snapshotName]);

    return {
      providerRef: `${vm.providerRef}/${snapshotName}`,
      summary: `Snapshot ${label} captured from ${vm.name}.`,
    };
  }

  async launchVmFromSnapshot(
    snapshot: Snapshot,
    targetVm: VmInstance,
    template: EnvironmentTemplate,
  ): Promise<ProviderMutation> {
    this.assertAvailable();
    this.assertLaunchSource(template);

    this.run([
      "copy",
      snapshot.providerRef,
      targetVm.providerRef,
      "--instance-only",
      "-c",
      `limits.cpu=${targetVm.resources.cpu}`,
      "-c",
      `limits.memory=${formatMemoryLimit(targetVm.resources.ramMb)}`,
      "-d",
      `root,size=${formatDiskSize(targetVm.resources.diskGb)}`,
    ]);
    this.ensureAgentDevice(targetVm.providerRef);
    this.run(["start", targetVm.providerRef]);

    const session = await this.resolveSession(targetVm.providerRef);

    return {
      lastAction: `Launched from snapshot ${snapshot.label}`,
      activity: [
        `incus: launched ${targetVm.providerRef} from ${snapshot.providerRef}`,
        `template: ${template.name}`,
        session ? `vnc: ${session.display}` : "vnc: guest network pending",
      ],
      activeWindow: "terminal",
      workspacePath: DEFAULT_GUEST_WORKSPACE,
      session,
    };
  }

  async restoreVmToSnapshot(
    vm: VmInstance,
    snapshot: Snapshot,
  ): Promise<ProviderMutation> {
    this.assertAvailable();

    const snapshotName = parseSnapshotName(snapshot.providerRef, vm.providerRef);
    const wasRunning = vm.status === "running";

    if (wasRunning) {
      this.stopInstance(vm.providerRef);
    }

    this.run(["snapshot", "restore", vm.providerRef, snapshotName]);
    this.ensureAgentDevice(vm.providerRef);

    let session: VmSession | null = null;

    if (wasRunning) {
      this.run(["start", vm.providerRef]);
      session = await this.resolveSession(vm.providerRef);
    }

    return {
      lastAction: `Restored ${vm.name} to ${snapshot.label}`,
      activity: [
        `incus: restored ${vm.providerRef} to ${snapshotName}`,
        wasRunning
          ? session
            ? `vnc: ${session.display}`
            : "vnc: guest network pending"
          : "workspace remains stopped after restore",
      ],
      activeWindow: "terminal",
      workspacePath: vm.workspacePath || DEFAULT_GUEST_WORKSPACE,
      session,
    };
  }

  async captureTemplate(
    vm: VmInstance,
    target: CaptureTemplateTarget,
  ): Promise<ProviderSnapshot> {
    this.assertAvailable();
    const snapshotName = buildTemplateSnapshotName(target.templateId);
    const alias = buildTemplateAlias(target.templateId);

    this.run(["snapshot", "create", vm.providerRef, snapshotName]);
    this.run([
      "publish",
      `${vm.providerRef}/${snapshotName}`,
      "--alias",
      alias,
      "--reuse",
    ]);

    return {
      providerRef: `${vm.providerRef}/${snapshotName}`,
      summary: `Template ${target.name} published as ${alias}.`,
      launchSource: alias,
    };
  }

  async injectCommand(
    vm: VmInstance,
    command: string,
  ): Promise<ProviderMutation> {
    this.assertAvailable();
    const workspacePath = vm.workspacePath || DEFAULT_GUEST_WORKSPACE;
    const cdMatch = command.match(/^cd(?:\s+(.+))?$/);

    if (cdMatch) {
      const result = this.run([
        "exec",
        vm.providerRef,
        "--cwd",
        workspacePath,
        "--",
        "sh",
        "-lc",
        `${command} && pwd`,
      ]);
      const nextWorkspacePath = result.stdout.trim() || workspacePath;

      return {
        lastAction: `Changed directory for ${vm.name}`,
        activity: [`$ ${command}`, `cwd: ${nextWorkspacePath}`],
        activeWindow: "terminal",
        workspacePath: nextWorkspacePath,
        session: vm.session,
        commandResult: {
          command,
          output: [`cwd: ${nextWorkspacePath}`],
          workspacePath: nextWorkspacePath,
        },
      };
    }

    const result = this.run([
      "exec",
      vm.providerRef,
      "--cwd",
      workspacePath,
      "--",
      "sh",
      "-lc",
      command,
    ]);
    const output = collectCommandOutput(result);
    const activity = [`$ ${command}`, ...summarizeCommandOutput(output)];

    return {
      lastAction: `Executed: ${command}`,
      activity,
      activeWindow: "terminal",
      workspacePath,
      session: vm.session,
      commandResult: {
        command,
        output,
        workspacePath,
      },
    };
  }

  tickVm(): ProviderTick | null {
    return null;
  }

  renderFrame(
    vm: VmInstance,
    template: EnvironmentTemplate | null,
    mode: "tile" | "detail",
  ): string {
    const providerLine =
      vm.session?.kind === "vnc"
        ? `VNC ${vm.session.display}`
        : this.state.detail;

    return renderSyntheticFrame(vm, template, mode, providerLine);
  }

  private assertAvailable(): void {
    const state = this.refreshState();

    if (!state.available) {
      throw new Error(state.detail);
    }
  }

  private probeState(): ProviderState {
    const probe = this.runner.execute(["list", "--format", "json"]);
    return buildIncusProviderState(this.incusBinary, this.project, probe);
  }

  private assertLaunchSource(template: EnvironmentTemplate): void {
    if (template.launchSource.startsWith("mock://")) {
      throw new Error(
        `Template ${template.name} was captured in mock mode and cannot be launched with Incus.`,
      );
    }
  }

  private ensureAgentDevice(instanceName: string): void {
    const addArgs = [
      "config",
      "device",
      "add",
      instanceName,
      "agent",
      "disk",
      "source=agent:config",
    ];
    const result = this.runner.execute(addArgs);

    if (result.status === 0) {
      return;
    }

    const detail = `${result.stderr}\n${result.stdout}`;

    if (!detail.includes("already exists")) {
      throw new Error(formatCommandFailure(addArgs, result));
    }

    this.run(["config", "device", "remove", instanceName, "agent"]);
    this.run(addArgs);
  }

  private stopInstance(instanceName: string): void {
    const stopArgs = ["stop", instanceName, "--timeout", "30"];
    const stopResult = this.runner.execute(stopArgs);

    if (stopResult.status !== 0 && !this.instanceMatchesStatus(instanceName, "stopped")) {
      const forceArgs = ["stop", instanceName, "--force"];
      const forceResult = this.runner.execute(forceArgs);

      if (forceResult.status !== 0 && !this.instanceMatchesStatus(instanceName, "stopped")) {
        throw new Error(
          [formatCommandFailure(stopArgs, stopResult), formatCommandFailure(forceArgs, forceResult)]
            .filter(Boolean)
            .join("\n"),
        );
      }
    }
  }

  private async resolveSession(instanceName: string): Promise<VmSession | null> {
    let address: string | null = null;

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const info = this.inspectInstance(instanceName);
      address = findGlobalGuestAddress(info);

      if (
        address &&
        (await this.guestPortProbe.probe(address, this.guestVncPort))
      ) {
        return buildVncSession(address, this.guestVncPort);
      }

      if (normalizeStatus(info.status ?? info.state?.status) !== "running") {
        break;
      }

      await sleep(5000);
    }

    return address ? buildVncSession(address, this.guestVncPort) : null;
  }

  private inspectInstance(instanceName: string): IncusListInstance {
    const match = this.inspectInstanceSafe(instanceName);

    if (!match) {
      throw new Error(`Incus did not return instance metadata for ${instanceName}.`);
    }

    return match;
  }

  private inspectInstanceSafe(instanceName: string): IncusListInstance | null {
    const result = this.run(["list", instanceName, "--format", "json"]);
    const instances = parseJson<IncusListInstance[]>(result.stdout);
    const match =
      instances.find((entry) => entry.name === instanceName) ?? instances[0] ?? null;

    return match;
  }

  private instanceMatchesStatus(
    instanceName: string,
    expectedStatus: "running" | "stopped",
  ): boolean {
    const info = this.inspectInstanceSafe(instanceName);
    return normalizeStatus(info?.status ?? info?.state?.status) === expectedStatus;
  }

  private run(args: string[]): CommandResult {
    const result = this.runner.execute(args);

    if (result.status === 0) {
      return result;
    }

    throw new Error(formatCommandFailure(args, result));
  }
}

class SpawnIncusCommandRunner implements IncusCommandRunner {
  constructor(
    private readonly incusBinary: string,
    private readonly project?: string,
  ) {}

  execute(args: string[]): CommandResult {
    const fullArgs = this.project
      ? ["--project", this.project, ...args]
      : args;
    const result = spawnSync(this.incusBinary, fullArgs, {
      encoding: "utf8",
    });

    return {
      args: fullArgs,
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      error: result.error ?? undefined,
    };
  }
}

class TcpGuestPortProbe implements GuestPortProbe {
  async probe(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      let stage: "banner" | "security" = "banner";
      let buffer = Buffer.alloc(0);
      const socket = connectTcp({
        host,
        port,
      });
      const finish = (result: boolean) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(result);
      };
      const timer = setTimeout(() => {
        finish(false);
      }, 2000);

      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);

        if (stage === "banner") {
          if (buffer.length < 12) {
            return;
          }

          const banner = buffer.subarray(0, 12).toString("latin1");

          if (!banner.startsWith("RFB ")) {
            finish(false);
            return;
          }

          stage = "security";
          buffer = Buffer.alloc(0);
          socket.write(Buffer.from("RFB 003.008\n", "ascii"));
          return;
        }

        if (buffer.length > 0) {
          finish(true);
        }
      });

      socket.once("error", () => {
        finish(false);
      });

      socket.once("close", () => {
        if (stage === "security" && buffer.length > 0) {
          finish(true);
          return;
        }

        finish(false);
      });
    });
  }
}

function buildCommandReply(command: string, currentWorkspace: string): string {
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

function buildMockProviderState(): ProviderState {
  return {
    kind: "mock",
    available: true,
    detail:
      "Demo mode is active. Actions update persisted state and synthetic desktop frames.",
    hostStatus: "ready",
    binaryPath: null,
    project: null,
    desktopTransport: "synthetic",
    nextSteps: [],
  };
}

function buildIncusProviderState(
  incusBinary: string,
  project: string | null,
  result: CommandResult,
): ProviderState {
  if (result.status === 0) {
    return {
      kind: "incus",
      available: true,
      detail:
        "Incus is reachable. Browser sessions use the built-in noVNC bridge when the guest VNC server is reachable.",
      hostStatus: "ready",
      binaryPath: incusBinary,
      project,
      desktopTransport: "novnc",
      nextSteps: [
        "Ensure the guest image starts a VNC server on the configured guest port so the browser bridge can connect.",
      ],
    };
  }

  return {
    kind: "incus",
    available: false,
    detail: describeProbeFailure(result),
    hostStatus: classifyProbeFailure(result),
    binaryPath: incusBinary,
    project,
    desktopTransport: "novnc",
    nextSteps: buildProbeNextSteps(classifyProbeFailure(result)),
  };
}

function collectCommandOutput(result: CommandResult): string[] {
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

function summarizeCommandOutput(lines: string[]): string[] {
  return lines.slice(0, 6);
}

function parseSnapshotName(providerRef: string, instanceName: string): string {
  const prefix = `${instanceName}/`;

  if (providerRef.startsWith(prefix)) {
    return providerRef.slice(prefix.length);
  }

  const slashIndex = providerRef.lastIndexOf("/");

  if (slashIndex >= 0 && slashIndex < providerRef.length - 1) {
    return providerRef.slice(slashIndex + 1);
  }

  throw new Error(`Snapshot provider ref ${providerRef} is not attached to ${instanceName}.`);
}

function selectActivityLine(
  window: VmWindow,
  templateName: string,
  vmName: string,
  sequence: number,
): string {
  const pools: Record<VmWindow, string[]> = {
    editor: [
      `editor: refining control-plane routes for ${vmName}`,
      `editor: updating template metadata derived from ${templateName}`,
      "editor: checkpointing UI changes before snapshot",
    ],
    terminal: [
      "terminal: pnpm build completed in 1.3s",
      "terminal: action worker heartbeat green",
      "terminal: no pending shell tasks",
    ],
    browser: [
      "browser: reviewing host resource telemetry",
      "browser: docs pinned for snapshot and clone flow",
      "browser: dashboard detail view refreshed",
    ],
    logs: [
      "logs: stream idle",
      "logs: background job queue healthy",
      "logs: provider heartbeat acknowledged",
    ],
  };

  const entries = pools[window];
  return entries[sequence % entries.length];
}

function renderSyntheticFrame(
  vm: VmInstance,
  template: EnvironmentTemplate | null,
  mode: "tile" | "detail",
  providerLine: string,
): string {
  const width = mode === "detail" ? 1280 : 640;
  const height = mode === "detail" ? 800 : 360;
  const hue = vm.screenSeed % 360;
  const statusColor = statusAccent(vm.status);
  const logLines = vm.activityLog.slice(-5);
  const title = escapeXml(vm.name);
  const templateName = escapeXml(template?.name ?? "Unknown template");
  const workspacePath = escapeXml(vm.workspacePath);
  const lastAction = escapeXml(vm.lastAction);
  const activeWindow = vm.activeWindow;
  const windowTitles: VmWindow[] = ["editor", "terminal", "browser", "logs"];

  const windowMarkup = windowTitles
    .map((window, index) => {
      const x = index % 2 === 0 ? 32 : width / 2 + 16;
      const y = index < 2 ? 112 : height / 2 + 8;
      const panelWidth = width / 2 - 48;
      const panelHeight = height / 2 - 96;
      const isActive = window === activeWindow;
      const label = window.toUpperCase();

      return `
        <g transform="translate(${x} ${y})">
          <rect width="${panelWidth}" height="${panelHeight}" rx="20"
            fill="${isActive ? `hsla(${hue}, 58%, 14%, 0.9)` : "rgba(10, 16, 22, 0.76)"}"
            stroke="${isActive ? statusColor : "rgba(255,255,255,0.08)"}"
            stroke-width="${isActive ? 2 : 1}" />
          <rect x="16" y="18" width="${panelWidth - 32}" height="28" rx="14"
            fill="rgba(255,255,255,0.06)" />
          <text x="30" y="38" fill="#f4f7f9" font-size="${mode === "detail" ? 20 : 14}"
            font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${label}</text>
          <text x="30" y="72" fill="rgba(255,255,255,0.72)"
            font-size="${mode === "detail" ? 18 : 12}"
            font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${escapeXml(panelCopy(window, logLines))}</text>
        </g>
      `;
    })
    .join("");

  const activityMarkup = logLines
    .map(
      (line, index) => `
        <text x="44" y="${height - 116 + index * (mode === "detail" ? 28 : 18)}"
          fill="rgba(244,247,249,0.82)"
          font-size="${mode === "detail" ? 18 : 12}"
          font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${escapeXml(line)}</text>
      `,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="hsl(${hue}, 66%, 16%)" />
      <stop offset="50%" stop-color="hsl(${(hue + 28) % 360}, 64%, 11%)" />
      <stop offset="100%" stop-color="#081117" />
    </linearGradient>
    <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
      <path d="M 28 0 L 0 0 0 28" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="1" />
    </pattern>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)" />
  <rect width="${width}" height="${height}" fill="url(#grid)" opacity="0.45" />
  <rect x="20" y="18" width="${width - 40}" height="74" rx="24" fill="rgba(5, 9, 14, 0.82)" stroke="rgba(255,255,255,0.08)" />
  <circle cx="48" cy="54" r="8" fill="#ff7b5b" />
  <circle cx="74" cy="54" r="8" fill="#ffc857" />
  <circle cx="100" cy="54" r="8" fill="#5ed388" />
  <text x="128" y="48" fill="#f4f7f9" font-size="${mode === "detail" ? 26 : 18}" font-family="Georgia, Cambria, serif">${title}</text>
  <text x="128" y="72" fill="rgba(244,247,249,0.72)" font-size="${mode === "detail" ? 18 : 12}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${templateName} • ${vm.resources.cpu} CPU • ${(vm.resources.ramMb / 1024).toFixed(1)} GB RAM • ${vm.resources.diskGb} GB disk</text>
  <rect x="${width - 220}" y="30" width="176" height="40" rx="20" fill="rgba(255,255,255,0.08)" />
  <text x="${width - 196}" y="56" fill="${statusColor}" font-size="${mode === "detail" ? 18 : 12}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${vm.status.toUpperCase()}</text>
  ${windowMarkup}
  <rect x="24" y="${height - 144}" width="${width - 48}" height="116" rx="24" fill="rgba(5, 9, 14, 0.82)" stroke="rgba(255,255,255,0.08)" />
  <text x="44" y="${height - 118}" fill="${statusColor}" font-size="${mode === "detail" ? 18 : 12}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">ACTIVITY FEED</text>
  ${activityMarkup}
  <text x="${width - 480}" y="${height - 20}" fill="rgba(244,247,249,0.66)" font-size="${mode === "detail" ? 16 : 11}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">workspace: ${workspacePath} • ${escapeXml(providerLine)} • last action: ${lastAction}</text>
</svg>`;
}

function panelCopy(window: VmWindow, logLines: string[]): string {
  switch (window) {
    case "editor":
      return "queue.ts | provider adapter | dashboard state";
    case "terminal":
      return logLines.at(-1) ?? "terminal idle";
    case "browser":
      return "grid view | template notes | docs";
    case "logs":
      return "actions healthy • no crash loops";
    default:
      return "panel idle";
  }
}

function statusAccent(status: VmInstance["status"]): string {
  switch (status) {
    case "running":
      return "#5ed388";
    case "stopped":
      return "#ffb02e";
    case "creating":
      return "#5bbcff";
    case "deleting":
      return "#ff7b5b";
    case "error":
      return "#ff4d73";
    default:
      return "#f4f7f9";
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildSyntheticSession(): VmSession {
  return {
    kind: "synthetic",
    host: null,
    port: null,
    webSocketPath: null,
    browserPath: null,
    display: "Synthetic frame stream",
  };
}

function buildVncSession(
  host: string | null,
  port: number,
): VmSession {
  return {
    kind: "vnc",
    host,
    port,
    webSocketPath: null,
    browserPath: null,
    display: host ? `${formatNetworkEndpoint(host, port)}` : `guest VNC on port ${port} pending DHCP`,
  };
}

function buildGuestVncCloudInit(port: number): string {
  return `#cloud-config
package_update: true
packages:
  - x11vnc
write_files:
  - path: /etc/gdm3/custom.conf
    permissions: '0644'
    content: |
      [daemon]
      AutomaticLoginEnable=true
      AutomaticLogin=ubuntu
      WaylandEnable=false
  - path: /etc/systemd/system/parallaize-x11vnc.service
    permissions: '0644'
    content: |
      [Unit]
      Description=Parallaize x11vnc bridge
      After=display-manager.service
      Wants=display-manager.service

      [Service]
      Type=simple
      ExecStart=/usr/bin/x11vnc -display WAIT:0 -auth guess -forever -loop -shared -nopw -rfbport ${port} -o /var/log/x11vnc.log
      Restart=always
      RestartSec=3

      [Install]
      WantedBy=multi-user.target
runcmd:
  - systemctl daemon-reload
  - systemctl disable --now gnome-remote-desktop.service || true
  - systemctl mask gnome-remote-desktop.service || true
  - mkdir -p /etc/systemd/user
  - ln -sf /dev/null /etc/systemd/user/gnome-remote-desktop.service
  - ln -sf /dev/null /etc/systemd/user/gnome-remote-desktop-handover.service
  - ln -sf /dev/null /etc/systemd/user/gnome-remote-desktop-headless.service
  - mkdir -p /mnt/incus-agent
  - |
      if mount /dev/disk/by-label/incus-agent /mnt/incus-agent; then
        (
          cd /mnt/incus-agent
          ./install.sh || true
        )
        umount /mnt/incus-agent || true
        agent_target=""
        for candidate in /usr/lib /lib /etc; do
          if [ -f "$candidate/systemd/system/incus-agent.service" ]; then
            agent_target="$candidate"
            break
          fi
        done
        if [ -n "$agent_target" ]; then
          mkdir -p /etc/systemd/system/multi-user.target.wants
          ln -sf "$agent_target/systemd/system/incus-agent.service" /etc/systemd/system/multi-user.target.wants/incus-agent.service
        fi
        systemctl start incus-agent.service || true
      fi
  - systemctl enable parallaize-x11vnc.service
  - systemctl restart gdm3 || true
  - systemctl start parallaize-x11vnc.service
`;
}

function findGlobalGuestAddress(instance: IncusListInstance): string | null {
  const networks = instance.state?.network ?? {};
  let ipv6Address: string | null = null;

  for (const network of Object.values(networks)) {
    for (const address of network.addresses ?? []) {
      if (address.family === "inet" && address.scope === "global" && address.address) {
        return address.address;
      }

      if (
        !ipv6Address &&
        address.family === "inet6" &&
        address.scope === "global" &&
        address.address
      ) {
        ipv6Address = address.address;
      }
    }
  }

  return ipv6Address;
}

function formatNetworkEndpoint(host: string, port: number): string {
  return host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
}

function formatMemoryLimit(ramMb: number): string {
  return `${ramMb}MiB`;
}

function formatDiskSize(diskGb: number): string {
  return `${diskGb}GiB`;
}

function buildSnapshotName(label: string): string {
  const slug = slugify(label) || "snapshot";
  return `parallaize-${Date.now().toString(36)}-${slug}`;
}

function buildTemplateSnapshotName(templateId: string): string {
  return `parallaize-template-${slugify(templateId)}-${Date.now().toString(36)}`;
}

function buildTemplateAlias(templateId: string): string {
  return `parallaize-template-${slugify(templateId)}`;
}

function normalizeStatus(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function describeProbeFailure(result: CommandResult): string {
  if (result.error?.message.includes("ENOENT")) {
    return "Incus mode requested, but the incus CLI was not found on this host.";
  }

  const detail = result.stderr.trim() || result.error?.message || "Unknown Incus error.";
  return `Incus CLI was found, but the daemon is unavailable: ${detail}`;
}

function classifyProbeFailure(result: CommandResult): ProviderState["hostStatus"] {
  if (result.error?.message.includes("ENOENT")) {
    return "missing-cli";
  }

  const detail = `${result.stderr} ${result.stdout}`.trim().toLowerCase();

  if (
    detail.includes("daemon doesn't appear to be started") ||
    detail.includes("server version: unreachable") ||
    detail.includes("unix.socket")
  ) {
    return "daemon-unreachable";
  }

  return "error";
}

function buildProbeNextSteps(status: ProviderState["hostStatus"]): string[] {
  switch (status) {
    case "missing-cli":
      return [
        "Run the control plane inside Flox or set PARALLAIZE_INCUS_BIN to a valid Incus binary.",
        "Install the package with `flox install -d . incus` if this environment still lacks Incus.",
        "Initialize the daemon after install with `flox activate -d . -- incus admin init --minimal`.",
      ];
    case "daemon-unreachable":
      return [
        "Start the daemon with your service manager or `flox activate -d . -- incusd` on the target Linux host.",
        "Initialize storage and networking with `flox activate -d . -- incus admin init --minimal` if this is the first run.",
        "Restart the dashboard with PARALLAIZE_PROVIDER=incus once `incus list --format json` succeeds.",
      ];
    case "error":
      return [
        "Run `flox activate -d . -- incus list --format json` on the host and resolve the reported error.",
        "Check any configured Incus project value and host permissions before retrying.",
      ];
    case "ready":
    default:
      return [];
  }
}

function formatCommandFailure(args: string[], result: CommandResult): string {
  if (result.error?.message.includes("ENOENT")) {
    return "Incus mode requested, but the incus CLI was not found on this host.";
  }

  const detail =
    result.stderr.trim() ||
    result.error?.message ||
    `Command exited with status ${result.status ?? "unknown"}.`;

  return `incus ${args.join(" ")} failed: ${detail}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
