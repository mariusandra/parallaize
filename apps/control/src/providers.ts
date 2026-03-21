import { spawnSync } from "node:child_process";

import { slugify } from "../../../packages/shared/src/helpers.js";
import type {
  EnvironmentTemplate,
  ProviderKind,
  ProviderState,
  ResourceSpec,
  VmInstance,
  VmWindow,
} from "../../../packages/shared/src/types.js";

export interface DesktopProvider {
  readonly state: ProviderState;
  createVm(
    template: EnvironmentTemplate,
    name: string,
    resources: ResourceSpec,
  ): Promise<ProviderMutation>;
  cloneVm(
    vm: VmInstance,
    template: EnvironmentTemplate,
    name: string,
  ): Promise<ProviderMutation>;
  startVm(vm: VmInstance): Promise<ProviderMutation>;
  stopVm(vm: VmInstance): Promise<ProviderMutation>;
  deleteVm(vm: VmInstance): Promise<ProviderMutation>;
  resizeVm(vm: VmInstance, resources: ResourceSpec): Promise<ProviderMutation>;
  snapshotVm(vm: VmInstance, label: string): Promise<ProviderSnapshot>;
  captureTemplate(vm: VmInstance, name: string): Promise<ProviderSnapshot>;
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
}

export interface ProviderSnapshot {
  providerRef: string;
  summary: string;
}

export interface ProviderTick {
  activity?: string;
  activeWindow?: VmWindow;
}

export function createProvider(
  kind: ProviderKind,
  incusBinary: string,
): DesktopProvider {
  if (kind === "incus") {
    return new IncusProvider(incusBinary);
  }

  return new MockProvider();
}

class MockProvider implements DesktopProvider {
  readonly state: ProviderState = {
    kind: "mock",
    available: true,
    detail:
      "Demo mode is active. Actions update persisted state and synthetic desktop frames.",
  };

  async createVm(
    template: EnvironmentTemplate,
    name: string,
    resources: ResourceSpec,
  ): Promise<ProviderMutation> {
    return {
      lastAction: `Provisioned from ${template.name}`,
      activity: [
        `boot: ubuntu desktop launched from ${template.baseImage}`,
        `resources: ${resources.cpu} CPU / ${resources.ramMb} MB / ${resources.diskGb} GB`,
        `workspace: /srv/workspaces/${slugify(name)}`,
      ],
      activeWindow: "editor",
      workspacePath: `/srv/workspaces/${slugify(name)}`,
    };
  }

  async cloneVm(
    vm: VmInstance,
    template: EnvironmentTemplate,
    name: string,
  ): Promise<ProviderMutation> {
    return {
      lastAction: `Cloned from ${vm.name}`,
      activity: [
        `clone: copied disks and metadata from ${vm.name}`,
        `template: ${template.name}`,
        `workspace: /srv/workspaces/${slugify(name)}`,
      ],
      activeWindow: vm.activeWindow,
      workspacePath: `/srv/workspaces/${slugify(name)}`,
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
    };
  }

  async deleteVm(vm: VmInstance): Promise<ProviderMutation> {
    return {
      lastAction: `Workspace ${vm.name} deleted`,
      activity: ["delete: disks and metadata released"],
      activeWindow: "logs",
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
    };
  }

  async snapshotVm(vm: VmInstance, label: string): Promise<ProviderSnapshot> {
    return {
      providerRef: `mock://snapshots/${slugify(vm.name)}-${slugify(label)}`,
      summary: `Snapshot ${label} captured from ${vm.name}.`,
    };
  }

  async captureTemplate(
    vm: VmInstance,
    name: string,
  ): Promise<ProviderSnapshot> {
    return {
      providerRef: `mock://templates/${slugify(name)}`,
      summary: `Template ${name} captured from ${vm.name}.`,
    };
  }

  async injectCommand(
    vm: VmInstance,
    command: string,
  ): Promise<ProviderMutation> {
    const trimmed = command.trim();
    const reply = buildCommandReply(trimmed, vm.workspacePath);

    return {
      lastAction: `Executed: ${trimmed}`,
      activity: [`$ ${trimmed}`, reply],
      activeWindow: "terminal",
      workspacePath: reply.startsWith("cwd:")
        ? reply.replace("cwd: ", "")
        : undefined,
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
  readonly state: ProviderState;

  constructor(private readonly incusBinary: string) {
    const version = spawnSync(this.incusBinary, ["--version"], {
      encoding: "utf8",
    });

    if (version.status === 0) {
      this.state = {
        kind: "incus",
        available: true,
        detail:
          "Incus CLI detected. Provider commands are reserved for later host integration work.",
      };
      return;
    }

    this.state = {
      kind: "incus",
      available: false,
      detail:
        "Incus mode requested, but the incus CLI was not found on this machine.",
    };
  }

  async createVm(): Promise<ProviderMutation> {
    return this.reject();
  }

  async cloneVm(): Promise<ProviderMutation> {
    return this.reject();
  }

  async startVm(): Promise<ProviderMutation> {
    return this.reject();
  }

  async stopVm(): Promise<ProviderMutation> {
    return this.reject();
  }

  async deleteVm(): Promise<ProviderMutation> {
    return this.reject();
  }

  async resizeVm(): Promise<ProviderMutation> {
    return this.reject();
  }

  async snapshotVm(): Promise<ProviderSnapshot> {
    throw new Error(this.state.detail);
  }

  async captureTemplate(): Promise<ProviderSnapshot> {
    throw new Error(this.state.detail);
  }

  async injectCommand(): Promise<ProviderMutation> {
    return this.reject();
  }

  tickVm(): ProviderTick | null {
    return null;
  }

  renderFrame(
    vm: VmInstance,
    template: EnvironmentTemplate | null,
    mode: "tile" | "detail",
  ): string {
    return renderSyntheticFrame(vm, template, mode, this.state.detail);
  }

  private reject(): never {
    throw new Error(this.state.detail);
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
      `editor: checkpointing UI changes before snapshot`,
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
  <text x="${width - 480}" y="${height - 20}" fill="rgba(244,247,249,0.66)" font-size="${mode === "detail" ? 16 : 11}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">workspace: ${workspacePath} • ${providerLine} • last action: ${lastAction}</text>
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
