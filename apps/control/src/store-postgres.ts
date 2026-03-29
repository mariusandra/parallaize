import { Pool } from "pg";

import type { AppState, PersistenceDiagnostics } from "../../../packages/shared/src/types.js";
import type { DefaultTemplateLaunchSourceOptions } from "./template-defaults.js";
import {
  cloneState,
  normalizePersistedState,
  nowIso,
} from "./store-normalize.js";
import type {
  StateMutationResult,
  StateMutator,
  StateSeedFactory,
  StateStore,
} from "./store-types.js";

export const POSTGRES_STORE_KEY = "singleton";

export class PostgresStateStore implements StateStore {
  private readonly pool: Pool;
  private currentState: AppState;
  private pendingPersist: Promise<void> = Promise.resolve();
  private lastPersistError: Error | null = null;
  private lastPersistAttemptAt: string | null;
  private lastPersistedAt: string | null;

  private constructor(
    pool: Pool,
    initialState: AppState,
    initialPersistedAt: string | null,
    _options: DefaultTemplateLaunchSourceOptions = {},
  ) {
    this.pool = pool;
    this.currentState = cloneState(initialState);
    this.lastPersistAttemptAt = initialPersistedAt;
    this.lastPersistedAt = initialPersistedAt;
  }

  static async create(
    databaseUrl: string,
    createSeed: StateSeedFactory,
    options: DefaultTemplateLaunchSourceOptions = {},
  ): Promise<PostgresStateStore> {
    const pool = new Pool({
      connectionString: databaseUrl,
    });

    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_state (
        store_key TEXT PRIMARY KEY,
        state JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const initialState = await readOrInsertSeedState(pool, createSeed, options);
    return new PostgresStateStore(pool, initialState, nowIso(), options);
  }

  load(): AppState {
    return cloneState(this.currentState);
  }

  update(mutator: StateMutator): StateMutationResult {
    const nextState = cloneState(this.currentState);
    const changed = mutator(nextState) !== false;

    if (changed) {
      nextState.lastUpdated = nowIso();
      this.currentState = nextState;
      this.queuePersist(nextState);
    }

    return {
      state: cloneState(nextState),
      changed,
    };
  }

  async flush(): Promise<void> {
    await this.pendingPersist;
    this.assertHealthy();
  }

  async close(): Promise<void> {
    try {
      await this.flush();
    } finally {
      await this.pool.end();
    }
  }

  getDiagnostics(): PersistenceDiagnostics {
    return {
      kind: "postgres",
      status: this.lastPersistError ? "degraded" : "ready",
      databaseConfigured: true,
      dataFile: null,
      lastPersistAttemptAt: this.lastPersistAttemptAt,
      lastPersistedAt: this.lastPersistedAt,
      lastPersistError: this.lastPersistError?.message ?? null,
    };
  }

  private queuePersist(state: AppState): void {
    const snapshot = cloneState(state);
    const persistPromise = this.pendingPersist.then(async () => {
      const attemptedAt = nowIso();
      this.lastPersistAttemptAt = attemptedAt;
      await this.pool.query(
        `
          INSERT INTO app_state (store_key, state, updated_at)
          VALUES ($1, $2::jsonb, NOW())
          ON CONFLICT (store_key)
          DO UPDATE SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at
        `,
        [POSTGRES_STORE_KEY, JSON.stringify(snapshot)],
      );
      this.lastPersistError = null;
      this.lastPersistedAt = attemptedAt;
    });

    this.pendingPersist = persistPromise.catch((error: unknown) => {
      const normalizedError =
        error instanceof Error
          ? new Error(`PostgreSQL persistence failed: ${error.message}`)
          : new Error("PostgreSQL persistence failed.");

      this.lastPersistError = normalizedError;
      console.error(normalizedError);
    });
  }

  private assertHealthy(): void {
    if (this.lastPersistError) {
      throw this.lastPersistError;
    }
  }
}

async function readOrInsertSeedState(
  pool: Pool,
  createSeed: StateSeedFactory,
  options: DefaultTemplateLaunchSourceOptions = {},
): Promise<AppState> {
  const existing = await pool.query<{ state: unknown }>(
    "SELECT state FROM app_state WHERE store_key = $1",
    [POSTGRES_STORE_KEY],
  );

  if (existing.rowCount && existing.rows[0]?.state) {
    return normalizePersistedState(existing.rows[0].state, options);
  }

  const seed = createSeed();
  await pool.query(
    `
      INSERT INTO app_state (store_key, state, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (store_key)
      DO NOTHING
    `,
    [POSTGRES_STORE_KEY, JSON.stringify(seed)],
  );

  const seeded = await pool.query<{ state: unknown }>(
    "SELECT state FROM app_state WHERE store_key = $1",
    [POSTGRES_STORE_KEY],
  );

  if (!seeded.rowCount || !seeded.rows[0]?.state) {
    throw new Error("Failed to initialize PostgreSQL app state.");
  }

  return normalizePersistedState(seeded.rows[0].state, options);
}
