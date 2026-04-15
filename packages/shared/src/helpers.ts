import type {
  DashboardMetrics,
  EnvironmentTemplate,
  ResourceSpec,
  VmDesktopTransport,
  VmInstance,
  VmNetworkMode,
  WorkspaceProject,
} from "./types.js";
import {
  normalizeTemplateDesktopTransport as normalizeTemplateDesktopTransportValue,
  normalizeVmDesktopTransport as normalizeVmDesktopTransportValue,
} from "./desktopTransport.js";

export function formatResources(resources: ResourceSpec): string {
  return `${resources.cpu} CPU / ${formatRam(resources.ramMb)} / ${resources.diskGb} GB`;
}

export const DEFAULT_WORKSPACE_PROJECT_ID = "project-default";
export const DEFAULT_WORKSPACE_PROJECT_NAME = "Default";

export function formatRam(ramMb: number): string {
  if (ramMb >= 1024) {
    return `${(ramMb / 1024).toFixed(ramMb % 1024 === 0 ? 0 : 1)} GB`;
  }

  return `${ramMb} MB`;
}

export function normalizeVmNetworkMode(
  mode: VmNetworkMode | null | undefined,
): VmNetworkMode {
  return mode === "dmz" ? "dmz" : "default";
}

export function describeVmNetworkMode(
  mode: VmNetworkMode | null | undefined,
): string {
  return normalizeVmNetworkMode(mode) === "dmz" ? "dmz" : "default bridge";
}

export function normalizeTemplateDesktopTransport(
  transport: VmDesktopTransport | null | undefined,
): VmDesktopTransport {
  return normalizeTemplateDesktopTransportValue(transport);
}

export function normalizeVmDesktopTransport(
  transport: VmDesktopTransport | null | undefined,
): VmDesktopTransport {
  return normalizeVmDesktopTransportValue(transport);
}

export function minimumCreateDiskGb(
  template: Pick<EnvironmentTemplate, "launchSource" | "defaultResources">,
): number | null {
  return template.launchSource.startsWith("parallaize-template-")
    ? template.defaultResources.diskGb
    : null;
}

export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function collectMetrics(vms: VmInstance[]): DashboardMetrics {
  return vms.reduce<DashboardMetrics>(
    (metrics, vm) => {
      metrics.totalVmCount += 1;
      metrics.totalCpu += vm.resources.cpu;
      metrics.totalRamMb += vm.resources.ramMb;
      metrics.totalDiskGb += vm.resources.diskGb;

      if (vm.status === "running") {
        metrics.runningVmCount += 1;
      }

      return metrics;
    },
    {
      totalVmCount: 0,
      runningVmCount: 0,
      totalCpu: 0,
      hostCpuCount: 0,
      totalRamMb: 0,
      hostRamMb: 0,
      totalDiskGb: 0,
      hostDiskGb: 0,
    },
  );
}

export function buildDefaultWorkspaceProject(
  createdAt = new Date().toISOString(),
): WorkspaceProject {
  return {
    id: DEFAULT_WORKSPACE_PROJECT_ID,
    name: DEFAULT_WORKSPACE_PROJECT_NAME,
    githubUrl: "",
    status: "active",
    createdAt,
    updatedAt: createdAt,
  };
}

export function resolveWorkspaceProjectId(
  projects: Array<Pick<WorkspaceProject, "id">>,
  projectId: string | null | undefined,
): string {
  const trimmedProjectId = typeof projectId === "string" ? projectId.trim() : "";

  if (trimmedProjectId.length > 0 && projects.some((project) => project.id === trimmedProjectId)) {
    return trimmedProjectId;
  }

  return projects[0]?.id ?? DEFAULT_WORKSPACE_PROJECT_ID;
}

export function normalizeGithubUrl(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase();

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "";
    }

    if (hostname !== "github.com" && hostname !== "www.github.com") {
      return "";
    }

    parsed.hash = "";
    return parsed.toString().replace(/\/$/u, "");
  } catch {
    return "";
  }
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}
