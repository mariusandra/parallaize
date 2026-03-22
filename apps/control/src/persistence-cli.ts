import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import type { AppState, PersistenceKind } from "../../../packages/shared/src/types.js";
import {
  copyState,
  exportState,
  formatStateSummary,
  importState,
  summarizeState,
  type PersistenceLocation,
} from "./persistence-admin.js";
import { normalizePersistedState } from "./store.js";

type Command = "export" | "import" | "copy";

interface CliIo {
  stderr: Pick<NodeJS.WriteStream, "write">;
  stdout: Pick<NodeJS.WriteStream, "write">;
}

interface ParsedArgs {
  command: Command | null;
  options: Map<string, string | true>;
}

export async function main(
  argv = process.argv.slice(2),
  io: CliIo = { stdout: process.stdout, stderr: process.stderr },
): Promise<number> {
  const parsed = parseArgs(argv);

  if (parsed.options.has("help")) {
    io.stdout.write(`${buildHelpText()}\n`);
    return 0;
  }

  if (!parsed.command) {
    io.stdout.write(`${buildHelpText()}\n`);
    return 1;
  }

  switch (parsed.command) {
    case "export":
      return await runExport(parsed.options, io);
    case "import":
      return await runImport(parsed.options, io);
    case "copy":
      return await runCopy(parsed.options, io);
  }
}

async function runExport(
  options: ParsedArgs["options"],
  io: CliIo,
): Promise<number> {
  const sourceKind = readPersistenceKindOption(options, "from");
  const source = resolveLocation(sourceKind, "from", options);
  const state = await exportState(source);
  const summary = formatStateSummary(summarizeState(state));
  const outputPath = readOptionalPathOption(options, "output");
  const serialized = `${JSON.stringify(state, null, 2)}\n`;

  if (outputPath) {
    writeFileSync(outputPath, serialized, "utf8");
    io.stdout.write(`Exported ${summary} from ${describeLocation(source)} to ${outputPath}\n`);
    return 0;
  }

  io.stderr.write(`Exported ${summary} from ${describeLocation(source)} to stdout\n`);
  io.stdout.write(serialized);
  return 0;
}

async function runImport(
  options: ParsedArgs["options"],
  io: CliIo,
): Promise<number> {
  const targetKind = readPersistenceKindOption(options, "to");
  const target = resolveLocation(targetKind, "to", options);
  const inputPath = readRequiredPathOption(options, "input");
  const state = readStateFile(inputPath);
  const summary = formatStateSummary(summarizeState(state));

  await importState(target, state);
  io.stdout.write(`Imported ${summary} from ${inputPath} to ${describeLocation(target)}\n`);
  return 0;
}

async function runCopy(
  options: ParsedArgs["options"],
  io: CliIo,
): Promise<number> {
  const sourceKind = readPersistenceKindOption(options, "from");
  const targetKind = readPersistenceKindOption(options, "to");
  const source = resolveLocation(sourceKind, "from", options);
  const target = resolveLocation(targetKind, "to", options);
  const state = await copyState(source, target);
  const summary = formatStateSummary(summarizeState(state));

  io.stdout.write(`Copied ${summary} from ${describeLocation(source)} to ${describeLocation(target)}\n`);
  return 0;
}

function parseArgs(argv: string[]): ParsedArgs {
  const options = new Map<string, string | true>();
  let command: Command | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token) {
      continue;
    }

    if (!token.startsWith("--")) {
      if (!command && isCommand(token)) {
        command = token;
        continue;
      }

      throw new Error(`Unexpected argument: ${token}`);
    }

    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const key = rawKey.trim();

    if (!key) {
      throw new Error(`Invalid option: ${token}`);
    }

    if (inlineValue !== undefined) {
      options.set(key, inlineValue);
      continue;
    }

    const nextToken = argv[index + 1];
    if (nextToken && !nextToken.startsWith("--")) {
      options.set(key, nextToken);
      index += 1;
      continue;
    }

    options.set(key, true);
  }

  return { command, options };
}

function isCommand(value: string): value is Command {
  return value === "export" || value === "import" || value === "copy";
}

function resolveLocation(
  kind: PersistenceKind,
  prefix: "from" | "to",
  options: ParsedArgs["options"],
): PersistenceLocation {
  if (kind === "json") {
    return {
      kind,
      dataFile: resolveJsonPath(prefix, options),
      databaseUrl: null,
    };
  }

  return {
    kind,
    dataFile: null,
    databaseUrl: resolveDatabaseUrl(prefix, options),
  };
}

function readPersistenceKindOption(
  options: ParsedArgs["options"],
  key: "from" | "to",
): PersistenceKind {
  const value = readStringOption(options, key);

  if (value === "json" || value === "postgres") {
    return value;
  }

  throw new Error(`--${key} must be "json" or "postgres".`);
}

function resolveJsonPath(
  prefix: "from" | "to",
  options: ParsedArgs["options"],
): string {
  const specific = readOptionalPathOption(options, `${prefix}-data-file`);
  if (specific) {
    return specific;
  }

  const generic = readOptionalPathOption(options, "data-file");
  if (generic) {
    return generic;
  }

  const envValue = process.env.PARALLAIZE_DATA_FILE;
  return resolve(envValue && envValue.trim() ? envValue : "data/state.json");
}

function resolveDatabaseUrl(
  prefix: "from" | "to",
  options: ParsedArgs["options"],
): string {
  const specific = readOptionalStringOption(options, `${prefix}-database-url`);
  if (specific) {
    return specific;
  }

  const generic = readOptionalStringOption(options, "database-url");
  if (generic) {
    return generic;
  }

  const envValue = process.env.PARALLAIZE_DATABASE_URL ?? process.env.DATABASE_URL ?? null;
  if (envValue) {
    return envValue;
  }

  throw new Error(
    `A PostgreSQL connection string is required for --${prefix} postgres. Use --${prefix}-database-url, --database-url, PARALLAIZE_DATABASE_URL, or DATABASE_URL.`,
  );
}

function readStateFile(filePath: string): AppState {
  const raw = readFileSync(filePath, "utf8");
  return normalizePersistedState(JSON.parse(raw));
}

function describeLocation(location: PersistenceLocation): string {
  if (location.kind === "json") {
    return `JSON ${location.dataFile}`;
  }

  return `PostgreSQL ${redactDatabaseUrl(location.databaseUrl)}`;
}

function redactDatabaseUrl(value: string | null): string {
  if (!value) {
    return "(unset)";
  }

  try {
    const parsed = new URL(value);
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return value;
  }
}

function readRequiredPathOption(
  options: ParsedArgs["options"],
  key: string,
): string {
  return readRequiredStringOption(options, key, true);
}

function readOptionalPathOption(
  options: ParsedArgs["options"],
  key: string,
): string | null {
  const value = readOptionalStringOption(options, key);
  return value ? resolve(value) : null;
}

function readRequiredStringOption(
  options: ParsedArgs["options"],
  key: string,
  isPath: boolean,
): string {
  const value = readOptionalStringOption(options, key);
  if (!value) {
    throw new Error(`--${key} is required${isPath ? " and must point to a file" : ""}.`);
  }

  return isPath ? resolve(value) : value;
}

function readStringOption(options: ParsedArgs["options"], key: string): string {
  const value = options.get(key);
  if (!value || value === true) {
    throw new Error(`--${key} is required.`);
  }

  return value;
}

function readOptionalStringOption(
  options: ParsedArgs["options"],
  key: string,
): string | null {
  const value = options.get(key);

  if (!value || value === true) {
    return null;
  }

  return value;
}

function buildHelpText(): string {
  return [
    "Usage:",
    "  node dist/apps/control/src/persistence-cli.js export --from <json|postgres> [options]",
    "  node dist/apps/control/src/persistence-cli.js import --to <json|postgres> --input <file> [options]",
    "  node dist/apps/control/src/persistence-cli.js copy --from <json|postgres> --to <json|postgres> [options]",
    "",
    "Options:",
    "  --data-file <path>           Generic JSON file path when only one side is JSON.",
    "  --from-data-file <path>      Source JSON file path.",
    "  --to-data-file <path>        Target JSON file path.",
    "  --database-url <url>         Generic PostgreSQL URL when only one side is postgres.",
    "  --from-database-url <url>    Source PostgreSQL URL.",
    "  --to-database-url <url>      Target PostgreSQL URL.",
    "  --input <file>               Input state file for import.",
    "  --output <file>              Output state file for export. Defaults to stdout.",
    "  --help                       Show this help text.",
    "",
    "Examples:",
    "  node dist/apps/control/src/persistence-cli.js copy --from json --data-file data/incus-state.json --to postgres --database-url postgresql://parallaize:parallaize@127.0.0.1:5432/parallaize",
    "  node dist/apps/control/src/persistence-cli.js export --from postgres --database-url postgresql://parallaize:parallaize@127.0.0.1:5432/parallaize --output backups/parallaize-state.json",
    "  node dist/apps/control/src/persistence-cli.js import --to json --to-data-file data/restore.json --input backups/parallaize-state.json",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
