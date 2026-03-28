export const FALLBACK_DEFAULT_TEMPLATE_LAUNCH_SOURCE =
  "images:ubuntu/noble/desktop";
export const DEFAULT_TEMPLATE_ID = "tpl-0001";

export interface DefaultTemplateLaunchSourceOptions {
  defaultTemplateLaunchSource?: string | null;
}

export function resolveDefaultTemplateLaunchSource(
  value: string | null | undefined,
): string {
  const trimmed = value?.trim();
  return trimmed || FALLBACK_DEFAULT_TEMPLATE_LAUNCH_SOURCE;
}

export function buildSeedTemplateSummary(launchSource: string): string {
  return `Seeded from ${launchSource}.`;
}

export function isAutoSeedTemplateSummary(
  summary: string | null | undefined,
): boolean {
  if (!summary) {
    return true;
  }

  return (
    /^Seeded from .+\.$/.test(summary) ||
    /^Seed template backed by .+\.$/.test(summary)
  );
}
