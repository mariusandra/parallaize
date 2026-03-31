import { collectMetrics } from "../../../packages/shared/src/helpers.js";

import type {
  DashboardSummary,
  ProviderState,
  VmDetail,
  VmDiskUsageSnapshot,
  VmFileBrowserSnapshot,
  VmLogsSnapshot,
  VmTouchedFilesSnapshot,
} from "../../../packages/shared/src/types.js";
import type { VmFileContent, VmPreviewImage } from "./providers.js";
import {
  emptyResourceTelemetry,
  nowIso,
  requireVmGuestPath,
  resolveVmGuestPath,
  type DesktopManagerRuntime,
} from "./manager-core.js";

export function getProviderState(runtime: DesktopManagerRuntime): ProviderState {
  runtime.syncProviderState();
  return runtime.store.load().provider;
}

export function getSummary(runtime: DesktopManagerRuntime): DashboardSummary {
  const state = runtime.store.load();
  const metrics = collectMetrics(state.vms);
  metrics.hostCpuCount = runtime.hostCpuCount;
  metrics.hostRamMb = runtime.hostRamMb;
  metrics.hostDiskGb = runtime.hostDiskGb;

  return {
    hostTelemetry: runtime.hostTelemetry,
    provider: state.provider,
    templates: state.templates,
    vms: state.vms.map((vm) => ({
      ...vm,
      telemetry: runtime.vmTelemetry.get(vm.id) ?? emptyResourceTelemetry(),
    })),
    snapshots: state.snapshots,
    jobs: state.jobs,
    metrics,
    generatedAt: nowIso(),
  };
}

export function getVmDetail(runtime: DesktopManagerRuntime, vmId: string): VmDetail {
  const state = runtime.store.load();
  const vm = runtime.requireVm(state, vmId);

  return {
    provider: state.provider,
    vm: {
      ...vm,
      telemetry: runtime.vmTelemetry.get(vm.id) ?? emptyResourceTelemetry(),
    },
    template: state.templates.find((template) => template.id === vm.templateId) ?? null,
    snapshots: state.snapshots.filter((snapshot) => snapshot.vmId === vm.id),
    recentJobs: state.jobs.filter((job) => job.targetVmId === vm.id).slice(0, 8),
    generatedAt: nowIso(),
  };
}

export async function getVmLogs(
  runtime: DesktopManagerRuntime,
  vmId: string,
): Promise<VmLogsSnapshot> {
  const state = runtime.store.load();
  const vm = runtime.requireVm(state, vmId);
  runtime.ensureActiveProvider(vm);
  return runtime.provider.readVmLogs(vm);
}

export async function browseVmFiles(
  runtime: DesktopManagerRuntime,
  vmId: string,
  requestedPath?: string | null,
): Promise<VmFileBrowserSnapshot> {
  const state = runtime.store.load();
  const vm = runtime.requireVm(state, vmId);
  runtime.ensureActiveProvider(vm);
  return runtime.provider.browseVmFiles(
    vm,
    resolveVmGuestPath(vm.workspacePath, requestedPath),
  );
}

export async function readVmFile(
  runtime: DesktopManagerRuntime,
  vmId: string,
  requestedPath: string,
): Promise<VmFileContent> {
  const state = runtime.store.load();
  const vm = runtime.requireVm(state, vmId);
  runtime.ensureActiveProvider(vm);
  return runtime.provider.readVmFile(
    vm,
    requireVmGuestPath(vm.workspacePath, requestedPath),
  );
}

export async function getVmTouchedFiles(
  runtime: DesktopManagerRuntime,
  vmId: string,
): Promise<VmTouchedFilesSnapshot> {
  const state = runtime.store.load();
  const vm = runtime.requireVm(state, vmId);
  runtime.ensureActiveProvider(vm);
  return runtime.provider.readVmTouchedFiles(vm);
}

export async function getVmDiskUsage(
  runtime: DesktopManagerRuntime,
  vmId: string,
): Promise<VmDiskUsageSnapshot> {
  const state = runtime.store.load();
  const vm = runtime.requireVm(state, vmId);

  if (vm.status !== "running") {
    return {
      vmId: vm.id,
      workspacePath: vm.workspacePath,
      checkedAt: nowIso(),
      status: "unavailable",
      detail: "Guest disk usage is only available while the workspace is running.",
      warningThresholdBytes: 4 * 1024 ** 3,
      criticalThresholdBytes: 1024 ** 3,
      root: null,
      workspace: null,
    };
  }

  runtime.ensureActiveProvider(vm);

  if (!runtime.provider.readVmDiskUsage) {
    return {
      vmId: vm.id,
      workspacePath: vm.workspacePath,
      checkedAt: nowIso(),
      status: "unavailable",
      detail: "The active provider does not expose guest disk usage probes.",
      warningThresholdBytes: 4 * 1024 ** 3,
      criticalThresholdBytes: 1024 ** 3,
      root: null,
      workspace: null,
    };
  }

  return runtime.provider.readVmDiskUsage(vm);
}

export async function getVmPreviewImage(
  runtime: DesktopManagerRuntime,
  vmId: string,
): Promise<VmPreviewImage> {
  const state = runtime.store.load();
  const vm = runtime.requireVm(state, vmId);
  const template = state.templates.find((entry) => entry.id === vm.templateId) ?? null;
  const fallbackImage = {
    content: Buffer.from(runtime.provider.renderFrame(vm, template, "tile"), "utf8"),
    contentType: "image/svg+xml; charset=utf-8",
    generatedAt: nowIso(),
  } satisfies VmPreviewImage;

  if (vm.status !== "running" || !runtime.provider.readVmPreviewImage) {
    return fallbackImage;
  }

  runtime.ensureActiveProvider(vm);

  try {
    return await runtime.provider.readVmPreviewImage(vm);
  } catch {
    return fallbackImage;
  }
}

export function getVmFrame(
  runtime: DesktopManagerRuntime,
  vmId: string,
  mode: "tile" | "detail",
): string {
  const state = runtime.store.load();
  const vm = runtime.requireVm(state, vmId);
  const template = state.templates.find((entry) => entry.id === vm.templateId) ?? null;

  return runtime.provider.renderFrame(vm, template, mode);
}
