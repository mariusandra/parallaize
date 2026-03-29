import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { AppState, PersistenceDiagnostics } from "../../../packages/shared/src/types.js";
import {
  type DefaultTemplateLaunchSourceOptions,
  resolveDefaultTemplateLaunchSource,
} from "./template-defaults.js";
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

export class JsonStateStore implements StateStore {
  private lastPersistAttemptAt: string | null = null;
  private lastPersistedAt: string | null = null;
  private readonly defaultTemplateLaunchSource: string;

  constructor(
    private readonly filePath: string,
    private readonly createSeed: StateSeedFactory,
    options: DefaultTemplateLaunchSourceOptions = {},
  ) {
    this.defaultTemplateLaunchSource = resolveDefaultTemplateLaunchSource(
      options.defaultTemplateLaunchSource,
    );
  }

  load(): AppState {
    if (!existsSync(this.filePath)) {
      const state = this.createSeed();
      this.save(state);
      return cloneState(state);
    }

    const raw = readFileSync(this.filePath, "utf8");
    const filePersistedAt = statSync(this.filePath).mtime.toISOString();
    this.lastPersistAttemptAt = filePersistedAt;
    this.lastPersistedAt = filePersistedAt;
    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizePersistedState(parsed, {
      defaultTemplateLaunchSource: this.defaultTemplateLaunchSource,
    });

    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      this.save(normalized);
    }

    return cloneState(normalized);
  }

  save(state: AppState): void {
    const attemptedAt = nowIso();
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    this.lastPersistAttemptAt = attemptedAt;
    this.lastPersistedAt = attemptedAt;
  }

  update(mutator: StateMutator): StateMutationResult {
    const state = this.load();
    const changed = mutator(state) !== false;

    if (changed) {
      state.lastUpdated = nowIso();
      this.save(state);
    }

    return {
      state: cloneState(state),
      changed,
    };
  }

  async flush(): Promise<void> {}

  async close(): Promise<void> {}

  getDiagnostics(): PersistenceDiagnostics {
    return {
      kind: "json",
      status: "ready",
      databaseConfigured: false,
      dataFile: this.filePath,
      lastPersistAttemptAt: this.lastPersistAttemptAt,
      lastPersistedAt: this.lastPersistedAt,
      lastPersistError: null,
    };
  }
}
