import type { IncomingMessage, ServerResponse } from "node:http";

import type {
  DashboardSummary,
  HealthStatus,
  IncusStorageActionResult,
  LatestReleaseMetadata,
  RunIncusStorageActionInput,
} from "../../../packages/shared/src/types.js";
import type { AppConfig } from "./config.js";
import { collectIncusStorageDiagnostics, runIncusStorageAction } from "./incus-storage.js";
import type { DesktopManager } from "./manager.js";
import { readJsonBody, writeJson } from "./server-http.js";
import { createServerEventStreams } from "./server-events.js";
import { createLatestReleaseMetadataCache } from "./server-release.js";
import type { StateStore } from "./store.js";

interface HandleSystemRouteOptions {
  config: AppConfig;
  events: ReturnType<typeof createServerEventStreams>;
  manager: DesktopManager;
  method: string;
  request: IncomingMessage;
  response: ServerResponse;
  releaseMetadataCache: ReturnType<typeof createLatestReleaseMetadataCache>;
  store: StateStore;
  url: URL;
}

export async function handleSystemRoute({
  config,
  events,
  manager,
  method,
  request,
  response,
  releaseMetadataCache,
  store,
  url,
}: HandleSystemRouteOptions): Promise<boolean> {
  if (method === "GET" && url.pathname === "/api/health") {
    const providerState = manager.getProviderState();
    const persistence = store.getDiagnostics();
    const incusStorage = collectIncusStorageDiagnostics(config);
    const status =
      providerState.hostStatus === "ready" &&
      persistence.status === "ready" &&
      (incusStorage === null || incusStorage.status === "ready")
        ? "ok"
        : "degraded";

    writeJson<HealthStatus>(response, 200, {
      ok: true,
      data: {
        status,
        provider: providerState,
        persistence,
        incusStorage,
        generatedAt: new Date().toISOString(),
      },
    });
    return true;
  }

  if (method === "POST" && url.pathname === "/api/incus/storage/action") {
    const payload = await readJsonBody<RunIncusStorageActionInput>(request);
    writeJson<IncusStorageActionResult>(response, 200, {
      ok: true,
      data: runIncusStorageAction(config, payload.action),
    });
    return true;
  }

  if (method === "GET" && url.pathname === "/api/summary") {
    writeJson<DashboardSummary>(response, 200, {
      ok: true,
      data: manager.getSummary(),
    });
    return true;
  }

  if (method === "GET" && url.pathname === "/api/version/latest") {
    writeJson<LatestReleaseMetadata | null>(response, 200, {
      ok: true,
      data: await releaseMetadataCache.getLatestReleaseMetadata(),
    });
    return true;
  }

  if (method === "GET" && url.pathname === "/events") {
    events.handleSummaryEvents(response);
    return true;
  }

  return false;
}
