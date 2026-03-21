import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { AppState } from "../../../packages/shared/src/types.js";

export class JsonStateStore {
  constructor(
    private readonly filePath: string,
    private readonly createSeed: () => AppState,
  ) {}

  load(): AppState {
    if (!existsSync(this.filePath)) {
      const state = this.createSeed();
      this.save(state);
      return state;
    }

    const raw = readFileSync(this.filePath, "utf8");
    return JSON.parse(raw) as AppState;
  }

  save(state: AppState): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  update(mutator: (state: AppState) => boolean | void): {
    state: AppState;
    changed: boolean;
  } {
    const state = this.load();
    const changed = mutator(state) !== false;

    if (changed) {
      state.lastUpdated = new Date().toISOString();
      this.save(state);
    }

    return {
      state,
      changed,
    };
  }
}
