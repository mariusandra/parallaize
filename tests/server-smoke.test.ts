import assert from "node:assert/strict";
import test from "node:test";

import type {
  ApiResponse,
  DashboardSummary,
  HealthStatus,
} from "../packages/shared/src/types.js";
import { startBuiltServer } from "./server-test-helpers.js";

test("built control plane serves health and summary endpoints", async (context) => {
  const server = await startBuiltServer({
    PARALLAIZE_ADMIN_PASSWORD: "",
  });
  context.after(async () => {
    await server.stop();
  });

  const health = await fetchOkJson<HealthStatus>(`${server.baseUrl}/api/health`);
  const summary = await fetchOkJson<DashboardSummary>(`${server.baseUrl}/api/summary`);

  assert.equal(health.status, "ok");
  assert.equal(health.provider.kind, "mock");
  assert.equal(health.provider.available, true);
  assert.equal(health.persistence.kind, "json");
  assert.equal(health.persistence.status, "ready");
  assert.equal(health.persistence.dataFile, server.stateFile);

  assert.equal(summary.provider.kind, "mock");
  assert.ok(summary.generatedAt);
  assert.ok(summary.templates.length >= 1);
  assert.ok(summary.vms.length >= 1);
  assert.equal(summary.metrics.totalVmCount, summary.vms.length);
});

async function fetchOkJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(5_000),
  });
  const payload = (await response.json()) as ApiResponse<T>;

  assert.equal(response.ok, true, `Expected ${url} to return 2xx, received ${response.status}`);
  assert.equal(payload.ok, true, `Expected ${url} to return an ok payload`);

  if (!payload.ok) {
    throw new Error(`Request returned an error payload for ${url}`);
  }

  return payload.data;
}
