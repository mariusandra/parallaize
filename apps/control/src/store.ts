import { JsonStateStore } from "./store-json.js";
import { normalizePersistedState } from "./store-normalize.js";
import { POSTGRES_STORE_KEY, PostgresStateStore } from "./store-postgres.js";
import type {
  StateSeedFactory,
  StateStore,
  StateStoreConfig,
} from "./store-types.js";

export {
  JsonStateStore,
  normalizePersistedState,
  POSTGRES_STORE_KEY,
  PostgresStateStore,
};

export type {
  StateMutationResult,
  StateMutator,
  StateSeedFactory,
  StateStore,
  StateStoreConfig,
} from "./store-types.js";

export async function createStateStore(
  config: StateStoreConfig,
  createSeed: StateSeedFactory,
): Promise<StateStore> {
  if (config.kind === "postgres") {
    if (!config.databaseUrl) {
      throw new Error("PostgreSQL persistence requires a database URL.");
    }

    return PostgresStateStore.create(config.databaseUrl, createSeed, {
      defaultTemplateLaunchSource: config.defaultTemplateLaunchSource,
    });
  }

  return new JsonStateStore(config.dataFile, createSeed, {
    defaultTemplateLaunchSource: config.defaultTemplateLaunchSource,
  });
}
