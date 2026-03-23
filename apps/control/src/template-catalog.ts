import type {
  EnvironmentTemplate,
  EnvironmentTemplateCatalog,
  EnvironmentTemplateKind,
  ProviderKind,
  ResourceSpec,
} from "../../../packages/shared/src/types.js";

interface TemplateSeedDefinition {
  id: string;
  name: string;
  description: string;
  kind: EnvironmentTemplateKind;
  catalog: EnvironmentTemplateCatalog | null;
  launchSource: string;
  defaultResources: ResourceSpec;
  tags: string[];
  notes: string[];
  mockSnapshotId?: string;
}

const workspaceTemplateDefinitions: TemplateSeedDefinition[] = [
  {
    id: "tpl-0001",
    name: "Ubuntu Agent Forge",
    description:
      "Balanced Ubuntu desktop for coding agents, shell tasks, and browser-based reviews.",
    kind: "workspace",
    catalog: null,
    launchSource: "images:ubuntu/noble/desktop",
    defaultResources: {
      cpu: 6,
      ramMb: 12288,
      diskGb: 80,
    },
    tags: ["coding", "agents", "ubuntu"],
    notes: [
      "GNOME desktop with terminal and editor workspace layout.",
      "Forwarded services stay workload-specific and should be captured on derived templates, not baked into this base workspace.",
      "Base image is intended for iterative snapshotting during development.",
    ],
    mockSnapshotId: "snap-0001",
  },
  {
    id: "tpl-0002",
    name: "Research Bench",
    description:
      "Heavier desktop profile for docs, browser automation, and parallel review sessions.",
    kind: "workspace",
    catalog: null,
    launchSource: "images:ubuntu/noble/desktop",
    defaultResources: {
      cpu: 10,
      ramMb: 24576,
      diskGb: 140,
    },
    tags: ["research", "browser", "analysis"],
    notes: [
      "Configured for large-browser workloads and long-running analysis tasks.",
      "Forwarded services remain empty here so each captured workload template keeps only the ports it actually needs.",
    ],
    mockSnapshotId: "snap-0002",
  },
];

const defaultImageTemplateDefinitions: TemplateSeedDefinition[] = [
  {
    id: "tpl-default-ubuntu-24-04",
    name: "Ubuntu 24.04 LTS",
    description:
      "Default Ubuntu desktop launch source for clean browser-accessible workspace prep.",
    kind: "default-image",
    catalog: {
      distribution: "Ubuntu",
      release: "24.04 LTS",
      prepRequired: false,
    },
    launchSource: "images:ubuntu/noble/desktop",
    defaultResources: {
      cpu: 4,
      ramMb: 8192,
      diskGb: 60,
    },
    tags: ["default-image", "ubuntu", "24.04", "desktop"],
    notes: [
      "Uses the direct Incus remote desktop image for Ubuntu noble.",
      "This stays workload-neutral: add forwarded service defaults only after you capture a workload-specific template.",
    ],
  },
];

const retiredDefaultImageTemplateIds = new Set(["tpl-default-kubuntu-24-04"]);

export function buildSeedTemplates(
  providerKind: ProviderKind,
  now: string,
): EnvironmentTemplate[] {
  return [...workspaceTemplateDefinitions, ...defaultImageTemplateDefinitions].map(
    (definition) => buildTemplateFromDefinition(definition, providerKind, now),
  );
}

export function appendMissingDefaultImageTemplates(
  templates: EnvironmentTemplate[],
  now: string,
): EnvironmentTemplate[] {
  const reconciled = templates.filter(
    (template) =>
      !(
        template.kind === "default-image" &&
        retiredDefaultImageTemplateIds.has(template.id)
      ),
  );
  const byId = new Map(reconciled.map((template) => [template.id, template]));

  for (const definition of defaultImageTemplateDefinitions) {
    if (!byId.has(definition.id)) {
      reconciled.push(buildTemplateFromDefinition(definition, "incus", now));
    }
  }

  return reconciled;
}

function buildTemplateFromDefinition(
  definition: TemplateSeedDefinition,
  providerKind: ProviderKind,
  now: string,
): EnvironmentTemplate {
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    kind: definition.kind,
    catalog: definition.catalog,
    launchSource: definition.launchSource,
    defaultResources: { ...definition.defaultResources },
    defaultForwardedPorts: [],
    tags: [...definition.tags],
    notes: [...definition.notes],
    snapshotIds:
      providerKind === "mock" && definition.mockSnapshotId
        ? [definition.mockSnapshotId]
        : [],
    createdAt: now,
    updatedAt: now,
  };
}
