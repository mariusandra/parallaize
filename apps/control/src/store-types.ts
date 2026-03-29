import type {
  AppState,
  PersistenceDiagnostics,
} from "../../../packages/shared/src/types.js";

export type StateMutator = (state: AppState) => boolean | void;

export interface StateMutationResult {
  changed: boolean;
  state: AppState;
}

export interface StateStore {
  load(): AppState;
  update(mutator: StateMutator): StateMutationResult;
  getDiagnostics(): PersistenceDiagnostics;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export interface StateStoreConfig {
  kind: "json" | "postgres";
  dataFile: string;
  databaseUrl: string | null;
  defaultTemplateLaunchSource?: string | null;
}

export type StateSeedFactory = () => AppState;
