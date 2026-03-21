import { spawnSync } from "node:child_process";
import { join } from "node:path";
import process from "node:process";

import type {
  ProviderKind,
  ProviderState,
} from "../../../packages/shared/src/types.js";

export interface AppConfig {
  host: string;
  port: number;
  dataFile: string;
  providerKind: ProviderKind;
  providerState: ProviderState;
  incusBinary: string;
}

export function loadConfig(): AppConfig {
  const host = process.env.HOST ?? "0.0.0.0";
  const port = parseInteger(process.env.PORT, 3000);
  const dataFile = process.env.PARALLAIZE_DATA_FILE ?? join(process.cwd(), "data", "state.json");
  const providerKind = parseProviderKind(process.env.PARALLAIZE_PROVIDER);
  const incusBinary = process.env.PARALLAIZE_INCUS_BIN ?? "incus";
  const providerState = detectProviderState(providerKind, incusBinary);

  return {
    host,
    port,
    dataFile,
    providerKind,
    providerState,
    incusBinary,
  };
}

function parseProviderKind(value: string | undefined): ProviderKind {
  if (value === "incus") {
    return "incus";
  }

  return "mock";
}

function detectProviderState(
  kind: ProviderKind,
  incusBinary: string,
): ProviderState {
  if (kind === "mock") {
    return {
      kind,
      available: true,
      detail:
        "Demo mode is active. VM actions are simulated until Incus is wired in.",
    };
  }

  const result = spawnSync(incusBinary, ["--version"], {
    encoding: "utf8",
  });

  if (result.status === 0) {
    return {
      kind,
      available: true,
      detail:
        "Incus CLI detected. The UI provider boundary is ready, but guest session wiring is still mock-oriented.",
    };
  }

  return {
    kind,
    available: false,
    detail:
      "Incus mode was requested but the incus CLI is not available on this host.",
  };
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
