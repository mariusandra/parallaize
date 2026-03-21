import { join } from "node:path";
import process from "node:process";

import type { ProviderKind } from "../../../packages/shared/src/types.js";

export interface AppConfig {
  host: string;
  port: number;
  dataFile: string;
  providerKind: ProviderKind;
  incusBinary: string;
  incusProject: string | null;
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
