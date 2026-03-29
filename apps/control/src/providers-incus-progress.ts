import type { EnvironmentTemplate } from "../../../packages/shared/src/types.js";

import {
  BYTES_PER_GIB,
  TEMPLATE_PUBLISH_COMPLETE_PERCENT,
  TEMPLATE_PUBLISH_EXPORT_COMPLETE_PERCENT,
  TEMPLATE_PUBLISH_START_PERCENT,
  VM_CREATE_ALLOCATION_COMPLETE_PERCENT,
  VM_CREATE_ALLOCATION_START_PERCENT,
  VM_CREATE_DESKTOP_WAIT_START_PERCENT,
  VM_CREATE_READY_PERCENT,
  type IncusImageCompression,
  type IncusOperation,
  type ProviderProgressReporter,
  type TemplatePublishProgressSample,
} from "./providers-contracts.js";

export function describeTemplatePublishActivity(
  compression: IncusImageCompression | null,
): string {
  switch (compression) {
    case "bzip2":
    case "gzip":
    case "lz4":
    case "lzma":
    case "xz":
    case "zstd":
      return `${compression} compression in progress`;
    case "none":
    case null:
    default:
      return "uncompressed export in progress";
  }
}

export function estimateTemplatePublishProgress(
  startedAt: number,
  heartbeatMs: number,
  diskGb: number,
): number {
  const elapsedMs = Date.now() - startedAt;
  const durationMs = estimateTemplatePublishDurationMs(diskGb);
  const span = TEMPLATE_PUBLISH_EXPORT_COMPLETE_PERCENT - TEMPLATE_PUBLISH_START_PERCENT;
  const estimatedByDuration = Math.round((elapsedMs / Math.max(durationMs, 1)) * span);
  const heartbeatFloor = elapsedMs >= heartbeatMs ? 1 : 0;

  return Math.min(
    TEMPLATE_PUBLISH_START_PERCENT + Math.max(estimatedByDuration, heartbeatFloor),
    TEMPLATE_PUBLISH_EXPORT_COMPLETE_PERCENT - 1,
  );
}

export function parseTemplatePublishProgressChunk(
  chunk: string,
): TemplatePublishProgressSample | null {
  const normalized = stripAnsi(chunk).replace(/\r/g, "\n");
  const packMatches = [
    ...normalized.matchAll(
      /Image pack:\s*([0-9]+(?:\.[0-9]+)?)\s*([KMGTPE]i?B)(?:\s*\(([0-9]+(?:\.[0-9]+)?)\s*([KMGTPE]i?B)\/s\))?/gi,
    ),
  ];
  const packMatch = packMatches.at(-1);

  if (packMatch) {
    const processedBytes = parseByteSize(packMatch[1], packMatch[2]);

    if (processedBytes !== null) {
      const speedBytesPerSecond =
        packMatch[3] && packMatch[4]
          ? parseByteSize(packMatch[3], packMatch[4])
          : null;

      return {
        kind: "pack",
        processedBytes,
        speedBytesPerSecond,
        detail: buildTemplatePackDetail(processedBytes, speedBytesPerSecond),
      };
    }
  }

  const exportMatches = [...normalized.matchAll(/Exporting:\s*(\d{1,3})%/gi)];
  const rawValue = exportMatches.at(-1)?.[1];

  if (!rawValue) {
    return null;
  }

  const percent = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(percent)) {
    return null;
  }

  return {
    kind: "export",
    percent: Math.min(Math.max(percent, 0), 100),
    detail: `Exporting: ${Math.min(Math.max(percent, 0), 100)}%`,
  };
}

export function mapTemplatePublishProgress(
  sample: TemplatePublishProgressSample,
  diskGb: number,
): number {
  if (sample.kind === "export") {
    return mapTemplatePublishExportPercent(sample.percent);
  }

  return mapTemplatePublishPackProgress(sample.processedBytes, diskGb);
}

export function formatByteCount(bytes: number): string {
  const absBytes = Math.max(bytes, 0);
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let unitIndex = 0;
  let value = absBytes;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const fractionDigits =
    value >= 100 || unitIndex === 0
      ? 0
      : value >= 10
        ? 1
        : 2;

  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

export function buildProgressEmitter(
  report?: ProviderProgressReporter,
): ProviderProgressReporter {
  let lastKey = "";

  return (message, progressPercent) => {
    if (!report) {
      return;
    }

    const normalizedPercent =
      progressPercent === null || !Number.isFinite(progressPercent)
        ? null
        : Math.min(Math.max(Math.round(progressPercent), 0), 100);
    const key = `${message}\u0000${normalizedPercent ?? "null"}`;

    if (key === lastKey) {
      return;
    }

    lastKey = key;
    report(message, normalizedPercent);
  };
}

export function parseVmCreateProgressChunk(
  chunk: string,
): { detail: string | null; percent: number | null } | null {
  const detail = stripAnsi(chunk)
    .split(/[\r\n]+/u)
    .map((line) => line.trim().replace(/\s+/gu, " "))
    .filter((line) => line.length > 0)
    .at(-1);

  if (!detail) {
    return null;
  }

  const percentMatch = detail.match(/(\d{1,3})%/u);

  return {
    detail,
    percent:
      percentMatch && Number.isFinite(Number(percentMatch[1]))
        ? Math.min(Math.max(Number(percentMatch[1]), 0), 100)
        : null,
  };
}

export function estimateVmCreateAllocationProgress(
  startedAt: number,
  diskGb: number,
): number {
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const estimatedDurationMs = Math.max(45_000, 15_000 + diskGb * 2_250);
  const fraction = Math.min(elapsedMs / estimatedDurationMs, 0.92);

  return VM_CREATE_ALLOCATION_START_PERCENT + (
    fraction * (VM_CREATE_ALLOCATION_COMPLETE_PERCENT - VM_CREATE_ALLOCATION_START_PERCENT)
  );
}

export function estimateVmCreateDesktopWaitProgress(startedAt: number): number {
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const fraction = Math.min(elapsedMs / (60 * 5_000), 0.96);

  return VM_CREATE_DESKTOP_WAIT_START_PERCENT + (
    fraction * (VM_CREATE_READY_PERCENT - VM_CREATE_DESKTOP_WAIT_START_PERCENT)
  );
}

export function normalizeVmLogContent(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

export function shouldRequireGuestBootstrapRepairBeforeReady(
  template: EnvironmentTemplate,
): boolean {
  return template.launchSource.startsWith("parallaize-template-");
}

export function mapPercentToRange(percent: number, start: number, end: number): number {
  const clampedPercent = Math.min(Math.max(percent, 0), 100);
  return start + (((end - start) * clampedPercent) / 100);
}

export function pickTemplatePublishOperation(
  operations: IncusOperation[],
  publishStartedAt: number,
  knownOperationIds: Set<string>,
): IncusOperation | null {
  const candidates = operations
    .filter((operation) => {
      if (!operation.id || knownOperationIds.has(operation.id)) {
        return false;
      }

      if (!parseTemplatePublishOperation(operation)) {
        return false;
      }

      const createdAt = parseTimestamp(operation.created_at);

      if (createdAt === null) {
        return true;
      }

      return createdAt >= publishStartedAt - 5_000;
    })
    .sort((left, right) => {
      const leftCreatedAt = parseTimestamp(left.created_at) ?? Number.POSITIVE_INFINITY;
      const rightCreatedAt = parseTimestamp(right.created_at) ?? Number.POSITIVE_INFINITY;
      return (
        Math.abs(leftCreatedAt - publishStartedAt) -
        Math.abs(rightCreatedAt - publishStartedAt)
      );
    });

  return candidates[0] ?? null;
}

export function parseTemplatePublishOperation(
  operation: IncusOperation,
): TemplatePublishProgressSample | null {
  const progress = operation.metadata?.progress;
  const detail = operation.metadata?.create_image_from_container_pack_progress;

  if (progress?.stage !== "create_image_from_container_pack") {
    return null;
  }

  const percent = parseInteger(progress.percent);

  if (percent !== null) {
    return {
      kind: "export",
      percent: Math.min(Math.max(percent, 0), 100),
      detail:
        typeof detail === "string" && detail.trim().length > 0
          ? detail.trim()
          : `Exporting: ${Math.min(Math.max(percent, 0), 100)}%`,
    };
  }

  const processedBytes = parseInteger(progress.processed);

  if (processedBytes === null) {
    return null;
  }

  const speedBytesPerSecond = parseInteger(progress.speed);

  return {
    kind: "pack",
    processedBytes,
    speedBytesPerSecond,
    detail:
      typeof detail === "string" && detail.trim().length > 0
        ? detail.trim()
        : buildTemplatePackDetail(processedBytes, speedBytesPerSecond),
  };
}

export function parseInteger(value: string | undefined): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseTimestamp(value: string | undefined): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
}

export function normalizeStatus(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function estimateTemplatePublishDurationMs(diskGb: number): number {
  const safeDiskGb = Math.max(diskGb, 1);
  return 15_000 + safeDiskGb * 2_000;
}

function mapTemplatePublishExportPercent(percent: number): number {
  const bounded = Math.min(Math.max(percent, 0), 100);
  const span = TEMPLATE_PUBLISH_EXPORT_COMPLETE_PERCENT - TEMPLATE_PUBLISH_START_PERCENT;
  return TEMPLATE_PUBLISH_START_PERCENT + Math.round((bounded / 100) * span);
}

function mapTemplatePublishPackProgress(processedBytes: number, diskGb: number): number {
  const estimatedTotalBytes = Math.max(Math.round(Math.max(diskGb, 1) * BYTES_PER_GIB), 1);
  const completedFraction = Math.min(Math.max(processedBytes / estimatedTotalBytes, 0), 0.95);
  const span = TEMPLATE_PUBLISH_COMPLETE_PERCENT - TEMPLATE_PUBLISH_EXPORT_COMPLETE_PERCENT;
  return TEMPLATE_PUBLISH_EXPORT_COMPLETE_PERCENT + Math.round(completedFraction * span);
}

function buildTemplatePackDetail(
  processedBytes: number,
  speedBytesPerSecond: number | null,
): string {
  const processedLabel = formatByteCount(processedBytes);

  if (speedBytesPerSecond && speedBytesPerSecond > 0) {
    return `Image pack: ${processedLabel} (${formatByteCount(speedBytesPerSecond)}/s)`;
  }

  return `Image pack: ${processedLabel}`;
}

function parseByteSize(rawValue: string, rawUnit: string): number | null {
  const value = Number.parseFloat(rawValue);

  if (!Number.isFinite(value) || value < 0) {
    return null;
  }

  const normalizedUnit = rawUnit.trim().toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1000,
    MB: 1000 ** 2,
    GB: 1000 ** 3,
    TB: 1000 ** 4,
    PB: 1000 ** 5,
    KIB: 1024,
    MIB: 1024 ** 2,
    GIB: 1024 ** 3,
    TIB: 1024 ** 4,
    PIB: 1024 ** 5,
  };
  const multiplier = multipliers[normalizedUnit];

  if (!multiplier) {
    return null;
  }

  return Math.round(value * multiplier);
}
