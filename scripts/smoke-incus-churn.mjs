import process from "node:process";

import { Client } from "pg";

const CONTROL_URL = process.env.PARALLAIZE_SMOKE_CONTROL_URL ?? "http://127.0.0.1:3000";
const TEMPLATE_ID = process.env.PARALLAIZE_SMOKE_TEMPLATE_ID ?? "tpl-0001";
const VM_NAME_PREFIX = process.env.PARALLAIZE_CHURN_VM_PREFIX ?? "churn-incus";
const ITERATIONS = Math.max(1, parseInteger(process.env.PARALLAIZE_CHURN_ITERATIONS, 2));
const KEEP_VMS = process.env.PARALLAIZE_CHURN_KEEP_VMS === "1";
const DATABASE_URL =
  process.env.PARALLAIZE_DATABASE_URL ??
  process.env.DATABASE_URL ??
  null;
const AUTH_USERNAME =
  process.env.PARALLAIZE_SMOKE_ADMIN_USERNAME ??
  process.env.PARALLAIZE_ADMIN_USERNAME ??
  "admin";
const AUTH_PASSWORD =
  process.env.PARALLAIZE_SMOKE_ADMIN_PASSWORD ??
  process.env.PARALLAIZE_ADMIN_PASSWORD ??
  null;
const VM_TIMEOUT_MS = 360_000;
const PERSIST_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 3_000;

async function main() {
  logStep(`Using control plane ${CONTROL_URL} for ${ITERATIONS} churn iteration${ITERATIONS === 1 ? "" : "s"}`);

  const health = await assertPostgresHealth();

  if (!DATABASE_URL) {
    throw new Error(
      "PARALLAIZE_DATABASE_URL or DATABASE_URL must be set when verifying PostgreSQL churn.",
    );
  }

  const database = new Client({
    connectionString: DATABASE_URL,
  });
  await database.connect();

  const trackedVms = new Map();

  try {
    const baselineSummary = await getSummary();
    const baselinePersisted = await readPersistedState(database);
    assertBaselineParity(baselineSummary, baselinePersisted.state);
    logStep(
      `Baseline: ${baselinePersisted.state.vms.length} persisted VM${baselinePersisted.state.vms.length === 1 ? "" : "s"}, app_state updated at ${formatTimestamp(baselinePersisted.updatedAt)}`,
    );

    for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
      await runIteration(iteration, database, trackedVms);
    }

    const finalSummary = await getSummary();
    const finalPersisted = await readPersistedState(database);
    assertBaselineParity(finalSummary, finalPersisted.state);
    assertNoChurnArtifacts(finalSummary.data.vms, VM_NAME_PREFIX);
    assertNoChurnArtifacts(finalPersisted.state.vms, VM_NAME_PREFIX);

    if (finalPersisted.state.vms.length !== baselinePersisted.state.vms.length) {
      throw new Error(
        `Persisted VM count drifted from ${baselinePersisted.state.vms.length} to ${finalPersisted.state.vms.length}.`,
      );
    }

    process.stdout.write(
      `Churn test passed for ${ITERATIONS} iteration${ITERATIONS === 1 ? "" : "s"}; PostgreSQL app_state updated at ${formatTimestamp(finalPersisted.updatedAt)}\n`,
    );
  } finally {
    if (!KEEP_VMS) {
      await cleanupTrackedVms(trackedVms);
    } else if (trackedVms.size > 0) {
      logStep(`Keeping ${trackedVms.size} churn VM${trackedVms.size === 1 ? "" : "s"} for inspection`);
    }

    await database.end();
  }
}

async function runIteration(iteration, database, trackedVms) {
  const suffix = `${Date.now()}-${String(iteration).padStart(2, "0")}`;
  const sourceName = `${VM_NAME_PREFIX}-${suffix}`;
  const cloneName = `${sourceName}-clone`;
  const prefix = `[${iteration}/${ITERATIONS}]`;

  logStep(`${prefix} Creating source VM ${sourceName}`);
  const sourceVm = await createVm(sourceName);
  trackedVms.set(sourceVm.id, {
    id: sourceVm.id,
    name: sourceName,
  });

  const sourceDetail = await waitForVmRunning(sourceVm.id);
  logStep(`${prefix} Source ${sourceVm.id} running at ${sourceDetail.vm.session?.display ?? "unknown display"}`);
  await waitForPersistedVm(
    database,
    sourceVm.id,
    (vm) => Boolean(vm && vm.status === "running" && vm.session),
    `persisted source ${sourceVm.id} running`,
  );

  logStep(`${prefix} Cloning ${sourceVm.id} into ${cloneName}`);
  const cloneVmRecord = await cloneVm(sourceVm.id, cloneName);
  trackedVms.set(cloneVmRecord.id, {
    id: cloneVmRecord.id,
    name: cloneName,
  });

  const cloneDetail = await waitForVmRunning(cloneVmRecord.id);
  logStep(`${prefix} Clone ${cloneVmRecord.id} running at ${cloneDetail.vm.session?.display ?? "unknown display"}`);

  if (cloneDetail.vm.providerRef === sourceDetail.vm.providerRef) {
    throw new Error(`Clone ${cloneVmRecord.id} reused provider ref ${cloneDetail.vm.providerRef}.`);
  }

  await waitForPersistedVm(
    database,
    cloneVmRecord.id,
    (vm) => Boolean(vm && vm.status === "running" && vm.session),
    `persisted clone ${cloneVmRecord.id} running`,
  );

  logStep(`${prefix} Deleting clone ${cloneVmRecord.id}`);
  await deleteVm(cloneVmRecord.id);
  await waitForVmDeletion(cloneVmRecord.id);
  await waitForPersistedVm(
    database,
    cloneVmRecord.id,
    (vm) => vm === null,
    `persisted clone ${cloneVmRecord.id} deletion`,
  );
  trackedVms.delete(cloneVmRecord.id);

  logStep(`${prefix} Deleting source ${sourceVm.id}`);
  await deleteVm(sourceVm.id);
  await waitForVmDeletion(sourceVm.id);
  await waitForPersistedVm(
    database,
    sourceVm.id,
    (vm) => vm === null,
    `persisted source ${sourceVm.id} deletion`,
  );
  trackedVms.delete(sourceVm.id);

  const persisted = await readPersistedState(database);
  assertNoChurnArtifacts(persisted.state.vms, sourceName);
  assertNoChurnArtifacts(persisted.state.vms, cloneName);
  logStep(`${prefix} Persisted app_state converged after cleanup at ${formatTimestamp(persisted.updatedAt)}`);
}

async function assertPostgresHealth() {
  const payload = await fetchJson("/api/health");
  const persistence = payload.data?.persistence;

  if (persistence?.kind !== "postgres") {
    throw new Error(
      `Expected PostgreSQL persistence for churn verification, got ${persistence?.kind ?? "unknown"}.`,
    );
  }

  if (persistence.status !== "ready") {
    throw new Error(
      `PostgreSQL persistence is not ready: ${persistence.lastPersistError ?? persistence.status}.`,
    );
  }

  return payload.data;
}

async function getSummary() {
  return await fetchJson("/api/summary");
}

async function createVm(name) {
  const payload = await fetchJson("/api/vms", {
    method: "POST",
    body: JSON.stringify({
      templateId: TEMPLATE_ID,
      name,
      resources: {
        cpu: 2,
        ramMb: 4096,
        diskGb: 30,
      },
    }),
  });

  return payload.data;
}

async function cloneVm(vmId, name) {
  const payload = await fetchJson(`/api/vms/${vmId}/clone`, {
    method: "POST",
    body: JSON.stringify({
      name,
    }),
  });

  return payload.data;
}

async function deleteVm(vmId) {
  await fetchJson(`/api/vms/${vmId}/delete`, {
    method: "POST",
  });
}

async function getVmDetail(vmId) {
  const payload = await fetchJson(`/api/vms/${vmId}`);
  return payload.data;
}

async function waitForVmRunning(vmId) {
  return waitFor(
    `VM ${vmId} to reach running state`,
    VM_TIMEOUT_MS,
    POLL_INTERVAL_MS,
    async () => {
      try {
        const detail = await getVmDetail(vmId);
        return detail.vm.status === "running" && detail.vm.session ? detail : null;
      } catch {
        return null;
      }
    },
  );
}

async function waitForVmDeletion(vmId) {
  return waitFor(
    `VM ${vmId} deletion`,
    120_000,
    POLL_INTERVAL_MS,
    async () => {
      const response = await fetch(new URL(`/api/vms/${vmId}`, CONTROL_URL), {
        headers: buildAuthHeaders(),
      });
      return response.status === 500 ? true : null;
    },
  );
}

async function waitForPersistedVm(database, vmId, predicate, label) {
  return waitFor(label, PERSIST_TIMEOUT_MS, POLL_INTERVAL_MS, async () => {
    const persisted = await readPersistedState(database);
    const vm = persisted.state.vms.find((entry) => entry.id === vmId) ?? null;
    return predicate(vm, persisted.state) ? persisted : null;
  });
}

async function readPersistedState(database) {
  const result = await database.query(
    "SELECT state, updated_at FROM app_state WHERE store_key = $1",
    ["singleton"],
  );

  if (!result.rowCount || !result.rows[0]?.state) {
    throw new Error("No singleton app_state row was found in PostgreSQL.");
  }

  return {
    state: result.rows[0].state,
    updatedAt: result.rows[0].updated_at,
  };
}

function assertBaselineParity(summary, persistedState) {
  const summaryVmCount = summary.data?.vms?.length ?? 0;
  const persistedVmCount = persistedState?.vms?.length ?? 0;

  if (summaryVmCount !== persistedVmCount) {
    throw new Error(
      `API summary reports ${summaryVmCount} VM${summaryVmCount === 1 ? "" : "s"}, but PostgreSQL has ${persistedVmCount}.`,
    );
  }
}

function assertNoChurnArtifacts(vms, marker) {
  const leftovers = vms.filter((entry) => entry.name?.includes(marker));

  if (leftovers.length > 0) {
    throw new Error(
      `Found leftover churn VM${leftovers.length === 1 ? "" : "s"}: ${leftovers.map((entry) => entry.name).join(", ")}`,
    );
  }
}

async function cleanupTrackedVms(trackedVms) {
  for (const vm of [...trackedVms.values()].reverse()) {
    try {
      await deleteVm(vm.id);
      await waitForVmDeletion(vm.id);
      logStep(`Cleaned up leftover churn VM ${vm.id} (${vm.name})`);
    } catch (error) {
      process.stderr.write(
        `Cleanup failed for ${vm.id}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }
}

async function waitFor(label, timeoutMs, intervalMs, resolver) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await resolver();

    if (result) {
      return result;
    }

    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for ${label}.`);
}

async function fetchJson(path, init = {}) {
  const response = await fetch(new URL(path, CONTROL_URL), {
    headers: {
      ...buildAuthHeaders(),
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
    ...init,
  });
  const payload = await response.json();

  if (!response.ok || payload.ok === false) {
    throw new Error(
      payload?.error
        ? `${response.status} ${payload.error}`
        : `${response.status} request failed for ${path}`,
    );
  }

  return payload;
}

function buildAuthHeaders() {
  if (!AUTH_PASSWORD) {
    return {};
  }

  return {
    authorization: `Basic ${Buffer.from(`${AUTH_USERNAME}:${AUTH_PASSWORD}`).toString("base64")}`,
  };
}

function formatTimestamp(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

function parseInteger(value, fallback) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function logStep(message) {
  process.stdout.write(`[churn] ${message}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
