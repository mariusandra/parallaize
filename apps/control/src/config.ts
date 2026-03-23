import { join } from "node:path";
import process from "node:process";

import type { ProviderKind } from "../../../packages/shared/src/types.js";
import type { IncusImageCompression } from "./providers.js";

export type PersistenceKind = "json" | "postgres";

export interface AppConfig {
  host: string;
  port: number;
  persistenceKind: PersistenceKind;
  dataFile: string;
  databaseUrl: string | null;
  providerKind: ProviderKind;
  incusBinary: string;
  incusProject: string | null;
  incusStoragePool: string | null;
  templateCompression: IncusImageCompression;
  guestVncPort: number;
  guestInotifyMaxUserWatches: number;
  guestInotifyMaxUserInstances: number;
  adminUsername: string;
  adminPassword: string | null;
}

export function loadConfig(): AppConfig {
  const adminPassword = parseOptionalString(process.env.PARALLAIZE_ADMIN_PASSWORD);
  const databaseUrl = parseOptionalString(
    process.env.PARALLAIZE_DATABASE_URL ?? process.env.DATABASE_URL,
  );
  const persistenceKind = parsePersistenceKind(
    process.env.PARALLAIZE_PERSISTENCE,
    databaseUrl,
  );

  if (persistenceKind === "postgres" && !databaseUrl) {
    throw new Error(
      "PARALLAIZE_DATABASE_URL or DATABASE_URL is required when PostgreSQL persistence is enabled.",
    );
  }

  return {
    host: process.env.HOST ?? "0.0.0.0",
    port: parseInteger(process.env.PORT, 3000),
    persistenceKind,
    dataFile:
      process.env.PARALLAIZE_DATA_FILE ??
      join(process.cwd(), "data", "state.json"),
    databaseUrl,
    providerKind: parseProviderKind(process.env.PARALLAIZE_PROVIDER),
    incusBinary: process.env.PARALLAIZE_INCUS_BIN ?? "incus",
    incusProject: parseOptionalString(process.env.PARALLAIZE_INCUS_PROJECT),
    incusStoragePool: parseOptionalString(process.env.PARALLAIZE_INCUS_STORAGE_POOL),
    templateCompression: parseTemplateCompression(process.env.PARALLAIZE_TEMPLATE_COMPRESSION),
    guestVncPort: parseInteger(process.env.PARALLAIZE_GUEST_VNC_PORT, 5900),
    guestInotifyMaxUserWatches: parsePositiveInteger(
      process.env.PARALLAIZE_GUEST_INOTIFY_MAX_USER_WATCHES,
      1_048_576,
    ),
    guestInotifyMaxUserInstances: parsePositiveInteger(
      process.env.PARALLAIZE_GUEST_INOTIFY_MAX_USER_INSTANCES,
      2_048,
    ),
    adminUsername: process.env.PARALLAIZE_ADMIN_USERNAME?.trim() || "admin",
    adminPassword,
  };
}

function parseProviderKind(value: string | undefined): ProviderKind {
  return value === "incus" ? "incus" : "mock";
}

function parsePersistenceKind(
  value: string | undefined,
  databaseUrl: string | null,
): PersistenceKind {
  const normalized = value?.trim().toLowerCase();

  switch (normalized) {
    case "json":
      return "json";
    case "postgres":
    case "postgresql":
      return "postgres";
    case undefined:
    case "":
      return databaseUrl ? "postgres" : "json";
    default:
      throw new Error(
        `Unsupported persistence backend "${value}". Use "json" or "postgres".`,
      );
  }
}

function parseOptionalString(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseTemplateCompression(value: string | undefined): IncusImageCompression {
  switch (value?.trim().toLowerCase()) {
    case "bzip2":
    case "gzip":
    case "lz4":
    case "lzma":
    case "xz":
    case "zstd":
    case "none":
      return value.trim().toLowerCase() as IncusImageCompression;
    case undefined:
    case "":
      return "none";
    default:
      return "none";
  }
}
