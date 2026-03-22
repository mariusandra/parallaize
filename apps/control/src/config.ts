import { join } from "node:path";
import process from "node:process";

import type { ProviderKind } from "../../../packages/shared/src/types.js";
import type { IncusImageCompression } from "./providers.js";

export interface AppConfig {
  host: string;
  port: number;
  dataFile: string;
  providerKind: ProviderKind;
  incusBinary: string;
  incusProject: string | null;
  templateCompression: IncusImageCompression;
  guestVncPort: number;
  adminUsername: string;
  adminPassword: string | null;
}

export function loadConfig(): AppConfig {
  const adminPassword = parseOptionalString(process.env.PARALLAIZE_ADMIN_PASSWORD);

  return {
    host: process.env.HOST ?? "0.0.0.0",
    port: parseInteger(process.env.PORT, 3000),
    dataFile:
      process.env.PARALLAIZE_DATA_FILE ??
      join(process.cwd(), "data", "state.json"),
    providerKind: parseProviderKind(process.env.PARALLAIZE_PROVIDER),
    incusBinary: process.env.PARALLAIZE_INCUS_BIN ?? "incus",
    incusProject: parseOptionalString(process.env.PARALLAIZE_INCUS_PROJECT),
    templateCompression: parseTemplateCompression(process.env.PARALLAIZE_TEMPLATE_COMPRESSION),
    guestVncPort: parseInteger(process.env.PARALLAIZE_GUEST_VNC_PORT, 5901),
    adminUsername: process.env.PARALLAIZE_ADMIN_USERNAME?.trim() || "admin",
    adminPassword,
  };
}

function parseProviderKind(value: string | undefined): ProviderKind {
  return value === "incus" ? "incus" : "mock";
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
