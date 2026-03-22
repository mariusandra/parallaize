import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { Pool } from "pg";

import type { AppState, PersistenceKind } from "../../../packages/shared/src/types.js";
import { POSTGRES_STORE_KEY, normalizePersistedState } from "./store.js";

export interface PersistenceLocation {
  kind: PersistenceKind;
  dataFile: string | null;
  databaseUrl: string | null;
}

export interface PersistenceSummary {
  providerKind: AppState["provider"]["kind"];
  templateCount: number;
  vmCount: number;
  snapshotCount: number;
  jobCount: number;
  lastUpdated: string;
}

export interface SqlQueryResult<Row> {
  rowCount: number | null;
  rows: Row[];
}

export interface SqlClientLike {
  query<Row = unknown>(sql: string, params?: unknown[]): Promise<SqlQueryResult<Row>>;
  end?(): Promise<void>;
}

export async function exportState(location: PersistenceLocation): Promise<AppState> {
  switch (location.kind) {
    case "json":
      return readStateFromJsonFile(requireDataFile(location));
    case "postgres":
      return await withPostgresClient(requireDatabaseUrl(location), readStateFromPostgresClient);
  }
}

export async function importState(
  location: PersistenceLocation,
  state: AppState,
): Promise<void> {
  switch (location.kind) {
    case "json":
      writeStateToJsonFile(requireDataFile(location), state);
      return;
    case "postgres":
      await withPostgresClient(requireDatabaseUrl(location), (client) =>
        writeStateToPostgresClient(client, state),
      );
      return;
  }
}

export async function copyState(
  source: PersistenceLocation,
  target: PersistenceLocation,
): Promise<AppState> {
  const state = await exportState(source);
  await importState(target, state);
  return state;
}

export function readStateFromJsonFile(filePath: string): AppState {
  const resolvedPath = resolve(filePath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`JSON state file was not found: ${resolvedPath}`);
  }

  const raw = readFileSync(resolvedPath, "utf8");
  return normalizePersistedState(JSON.parse(raw));
}

export function writeStateToJsonFile(filePath: string, state: AppState): void {
  const resolvedPath = resolve(filePath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  writeFileSync(
    resolvedPath,
    `${JSON.stringify(normalizePersistedState(state), null, 2)}\n`,
    "utf8",
  );
}

export async function readStateFromPostgresClient(
  client: SqlClientLike,
): Promise<AppState> {
  await ensureAppStateTable(client);

  const result = await client.query<{ state: unknown }>(
    "SELECT state FROM app_state WHERE store_key = $1",
    [POSTGRES_STORE_KEY],
  );

  if (!result.rowCount || !result.rows[0]?.state) {
    throw new Error(
      "No persisted app_state row was found in PostgreSQL. Seed or import state first.",
    );
  }

  return normalizePersistedState(result.rows[0].state);
}

export async function writeStateToPostgresClient(
  client: SqlClientLike,
  state: AppState,
): Promise<void> {
  await ensureAppStateTable(client);
  await client.query(
    `
      INSERT INTO app_state (store_key, state, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (store_key)
      DO UPDATE SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at
    `,
    [POSTGRES_STORE_KEY, JSON.stringify(normalizePersistedState(state))],
  );
}

export function summarizeState(state: AppState): PersistenceSummary {
  return {
    providerKind: state.provider.kind,
    templateCount: state.templates.length,
    vmCount: state.vms.length,
    snapshotCount: state.snapshots.length,
    jobCount: state.jobs.length,
    lastUpdated: state.lastUpdated,
  };
}

export function formatStateSummary(summary: PersistenceSummary): string {
  return [
    `${summary.templateCount} template${summary.templateCount === 1 ? "" : "s"}`,
    `${summary.vmCount} VM${summary.vmCount === 1 ? "" : "s"}`,
    `${summary.snapshotCount} snapshot${summary.snapshotCount === 1 ? "" : "s"}`,
    `${summary.jobCount} job${summary.jobCount === 1 ? "" : "s"}`,
    `${summary.providerKind} provider`,
    `last updated ${summary.lastUpdated}`,
  ].join(", ");
}

async function ensureAppStateTable(client: SqlClientLike): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      store_key TEXT PRIMARY KEY,
      state JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function withPostgresClient<T>(
  databaseUrl: string,
  callback: (client: SqlClientLike) => Promise<T>,
): Promise<T> {
  const pool = new Pool({
    connectionString: databaseUrl,
  });

  try {
    return await callback(pool);
  } finally {
    await pool.end();
  }
}

function requireDataFile(location: PersistenceLocation): string {
  if (!location.dataFile) {
    throw new Error("A JSON data file path is required for the json persistence target.");
  }

  return location.dataFile;
}

function requireDatabaseUrl(location: PersistenceLocation): string {
  if (!location.databaseUrl) {
    throw new Error("A database URL is required for the postgres persistence target.");
  }

  return location.databaseUrl;
}
