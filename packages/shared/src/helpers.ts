import type {
  DashboardMetrics,
  EnvironmentTemplate,
  ResourceSpec,
  VmInstance,
} from "./types.js";

export function formatResources(resources: ResourceSpec): string {
  return `${resources.cpu} CPU / ${formatRam(resources.ramMb)} / ${resources.diskGb} GB`;
}

export function formatRam(ramMb: number): string {
  if (ramMb >= 1024) {
    return `${(ramMb / 1024).toFixed(ramMb % 1024 === 0 ? 0 : 1)} GB`;
  }

  return `${ramMb} MB`;
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

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}
