import type { EnvironmentTemplate } from "../../../packages/shared/src/types.js";

export const UBUNTU_24_04_TEMPLATE_LAUNCH_SOURCE =
  "images:ubuntu/noble/desktop";
export const UBUNTU_26_04_TEMPLATE_LAUNCH_SOURCE =
  "images:ubuntu/resolute/desktop";
export const FALLBACK_DEFAULT_TEMPLATE_LAUNCH_SOURCE =
  UBUNTU_26_04_TEMPLATE_LAUNCH_SOURCE;
export const DEFAULT_TEMPLATE_ID = "tpl-0001";
export const SYSTEM_UBUNTU_24_04_TEMPLATE_ID = "tpl-system-ubuntu-2404";
export const SYSTEM_UBUNTU_26_04_TEMPLATE_ID = "tpl-system-ubuntu-2604";

const AUTO_SEED_TEMPLATE_NAME_PATTERN =
  /^Ubuntu Agent Forge(?: (?:24\.04|26\.04))?$/;
const AUTO_SEED_TEMPLATE_DESCRIPTIONS = new Set<string>([
  "Balanced Ubuntu desktop for coding agents, shell tasks, and browser-based reviews.",
  "Balanced Ubuntu 24.04 desktop for coding agents, shell tasks, and browser-based reviews.",
  "Balanced Ubuntu 26.04 desktop for coding agents, shell tasks, and browser-based reviews.",
]);

const BUILTIN_SYSTEM_TEMPLATES = [
  {
    id: SYSTEM_UBUNTU_26_04_TEMPLATE_ID,
    launchSource: UBUNTU_26_04_TEMPLATE_LAUNCH_SOURCE,
  },
  {
    id: SYSTEM_UBUNTU_24_04_TEMPLATE_ID,
    launchSource: UBUNTU_24_04_TEMPLATE_LAUNCH_SOURCE,
  },
] as const;

export interface DefaultTemplateLaunchSourceOptions {
  defaultTemplateLaunchSource?: string | null;
}

export interface SeedTemplateDefinition {
  id: string;
  launchSource: string;
  name: string;
  description: string;
  notes: string[];
  tags: string[];
}

export function resolveDefaultTemplateLaunchSource(
  value: string | null | undefined,
): string {
  const trimmed = value?.trim();
  return trimmed || FALLBACK_DEFAULT_TEMPLATE_LAUNCH_SOURCE;
}

export function describeUbuntuRelease(
  launchSource: string | null | undefined,
): "24.04" | "26.04" | null {
  const normalized = launchSource?.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (/\bresolute\b/.test(normalized)) {
    return "26.04";
  }

  if (/\bnoble\b/.test(normalized)) {
    return "24.04";
  }

  return null;
}

export function buildSystemSeedTemplateDefinitions(
  value: string | null | undefined,
): SeedTemplateDefinition[] {
  const defaultLaunchSource = resolveDefaultTemplateLaunchSource(value);
  const defaultRelease = describeUbuntuRelease(defaultLaunchSource);
  const seenLaunchSources = new Set<string>([defaultLaunchSource]);
  const seenReleases = new Set<string>();

  if (defaultRelease) {
    seenReleases.add(defaultRelease);
  }

  const definitions = [
    buildSeedTemplateDefinition(DEFAULT_TEMPLATE_ID, defaultLaunchSource),
  ];

  for (const template of BUILTIN_SYSTEM_TEMPLATES) {
    const release = describeUbuntuRelease(template.launchSource);

    if (seenLaunchSources.has(template.launchSource)) {
      continue;
    }

    if (release && seenReleases.has(release)) {
      continue;
    }

    definitions.push(
      buildSeedTemplateDefinition(template.id, template.launchSource),
    );
    seenLaunchSources.add(template.launchSource);

    if (release) {
      seenReleases.add(release);
    }
  }

  return definitions;
}

export function buildSeedTemplateRecord(
  definition: SeedTemplateDefinition,
  now: string,
  snapshotIds: string[] = [],
): EnvironmentTemplate {
  const seededSummary = buildSeedTemplateSummary(definition.launchSource);

  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    launchSource: definition.launchSource,
    defaultResources: {
      cpu: 6,
      ramMb: 12288,
      diskGb: 80,
    },
    defaultForwardedPorts: [],
    defaultDesktopTransport: "vnc",
    defaultNetworkMode: "default",
    initCommands: [],
    tags: [...definition.tags],
    notes: [...definition.notes],
    snapshotIds: [...snapshotIds],
    provenance: {
      kind: "seed",
      summary: seededSummary,
      sourceTemplateId: null,
      sourceTemplateName: null,
      sourceVmId: null,
      sourceVmName: null,
      sourceSnapshotId: null,
      sourceSnapshotLabel: null,
    },
    history: [
      {
        kind: "created",
        summary: seededSummary,
        createdAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

export function buildSeedTemplateSummary(launchSource: string): string {
  return `Seeded from ${launchSource}.`;
}

export function isAutoSeedTemplateName(
  name: string | null | undefined,
): boolean {
  return !!name && AUTO_SEED_TEMPLATE_NAME_PATTERN.test(name);
}

export function isAutoSeedTemplateDescription(
  description: string | null | undefined,
): boolean {
  return !description || AUTO_SEED_TEMPLATE_DESCRIPTIONS.has(description);
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

function buildSeedTemplateDefinition(
  id: string,
  launchSource: string,
): SeedTemplateDefinition {
  return {
    id,
    launchSource,
    name: buildSeedTemplateName(launchSource),
    description: buildSeedTemplateDescription(launchSource),
    notes: buildSeedTemplateNotes(launchSource),
    tags: buildSeedTemplateTags(launchSource),
  };
}

function buildSeedTemplateName(launchSource: string): string {
  const release = describeUbuntuRelease(launchSource);
  return release ? `Ubuntu Agent Forge ${release}` : "Ubuntu Agent Forge";
}

function buildSeedTemplateDescription(launchSource: string): string {
  const release = describeUbuntuRelease(launchSource);
  return release
    ? `Balanced Ubuntu ${release} desktop for coding agents, shell tasks, and browser-based reviews.`
    : "Balanced Ubuntu desktop for coding agents, shell tasks, and browser-based reviews.";
}

function buildSeedTemplateNotes(launchSource: string): string[] {
  const release = describeUbuntuRelease(launchSource);

  return [
    "GNOME desktop with terminal and editor workspace layout.",
    release
      ? `Ubuntu ${release} base image is intended for iterative snapshotting during development.`
      : "Base image is intended for iterative snapshotting during development.",
  ];
}

function buildSeedTemplateTags(launchSource: string): string[] {
  const release = describeUbuntuRelease(launchSource);

  return release
    ? ["coding", "agents", "ubuntu", `ubuntu-${release}`]
    : ["coding", "agents", "ubuntu"];
}
