import type {
  EnvironmentTemplate,
  TemplateEnvVar,
  TemplateScript,
  TemplateScriptRunMode,
  VmTemplateScriptRun,
} from "../../../packages/shared/src/types.js";

export const DEFAULT_TEMPLATE_SCRIPT_NAME = "user-init.sh";
export const DEFAULT_TEMPLATE_SCRIPT_LOG_PATH = "/var/log/parallaize-template-scripts";

const MAX_TEMPLATE_ENV_VARS = 128;
const MAX_TEMPLATE_SCRIPTS = 64;
const MAX_TEMPLATE_SCRIPT_BYTES = 512 * 1024;
const TEMPLATE_SCRIPT_RESULTS_BEGIN = "PARALLAIZE_TEMPLATE_SCRIPT_RESULTS_BEGIN";
const TEMPLATE_SCRIPT_RESULTS_END = "PARALLAIZE_TEMPLATE_SCRIPT_RESULTS_END";

export class TemplateScriptExecutionError extends Error {
  readonly runs: VmTemplateScriptRun[];

  constructor(message: string, runs: VmTemplateScriptRun[]) {
    super(message);
    this.name = "TemplateScriptExecutionError";
    this.runs = runs;
  }
}

export function normalizeTemplateEnvVars(
  envVars: EnvironmentTemplate["envVars"] | undefined,
): TemplateEnvVar[] {
  if (!Array.isArray(envVars)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: TemplateEnvVar[] = [];

  for (const envVar of envVars) {
    const name = typeof envVar?.name === "string" ? envVar.name.trim() : "";

    if (!isValidEnvVarName(name) || seen.has(name)) {
      continue;
    }

    normalized.push({
      name,
      value: typeof envVar.value === "string" ? envVar.value : "",
    });
    seen.add(name);

    if (normalized.length >= MAX_TEMPLATE_ENV_VARS) {
      break;
    }
  }

  return normalized;
}

export function normalizeTemplateScripts(
  scripts: EnvironmentTemplate["scripts"] | undefined,
): TemplateScript[] {
  if (!Array.isArray(scripts)) {
    return [];
  }

  const normalized: TemplateScript[] = [];
  const usedIds = new Set<string>();

  scripts.slice(0, MAX_TEMPLATE_SCRIPTS).forEach((script, index) => {
    const name = normalizeScriptName(script?.name, index);
    const id = normalizeScriptId(script?.id, name, index, usedIds);
    const content =
      typeof script?.content === "string"
        ? script.content.slice(0, MAX_TEMPLATE_SCRIPT_BYTES)
        : "";
    const runMode: TemplateScriptRunMode =
      script?.runMode === "parallel" ? "parallel" : "after-previous";

    usedIds.add(id);
    normalized.push({
      id,
      name,
      content,
      dependsOn: Array.isArray(script?.dependsOn)
        ? script.dependsOn
            .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
            .filter((entry) => entry.length > 0)
        : [],
      runMode,
    });
  });

  const idByName = new Map<string, string>();

  for (const script of normalized) {
    const key = script.name.toLowerCase();

    if (!idByName.has(key)) {
      idByName.set(key, script.id);
    }
  }

  const ids = new Set(normalized.map((script) => script.id));

  return normalized.map((script) => {
    const dependsOn = script.dependsOn
      .map((dependency) => ids.has(dependency)
        ? dependency
        : (idByName.get(dependency.toLowerCase()) ?? ""))
      .filter((dependency, index, dependencies) =>
        dependency.length > 0 &&
        dependency !== script.id &&
        dependencies.indexOf(dependency) === index,
      );

    return {
      ...script,
      dependsOn,
    };
  });
}

export function buildLegacyInitTemplateScript(
  initCommands: EnvironmentTemplate["initCommands"] | undefined,
): TemplateScript | null {
  if (!Array.isArray(initCommands) || initCommands.length === 0) {
    return null;
  }

  const content = initCommands
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0)
    .join("\n");

  if (!content) {
    return null;
  }

  return {
    id: "user-init",
    name: DEFAULT_TEMPLATE_SCRIPT_NAME,
    content,
    dependsOn: [],
    runMode: "after-previous",
  };
}

export function resolveExecutableTemplateScripts(
  template: Pick<EnvironmentTemplate, "initCommands" | "scripts">,
): TemplateScript[] {
  const scripts = resolveStructuredTemplateScripts(template);

  if (scripts.length > 0) {
    return scripts;
  }

  const legacyScript = buildLegacyInitTemplateScript(template.initCommands);
  return legacyScript ? [legacyScript] : [];
}

export function resolveStructuredTemplateScripts(
  template: Pick<EnvironmentTemplate, "scripts">,
): TemplateScript[] {
  return normalizeTemplateScripts(template.scripts)
    .filter((script) => script.content.trim().length > 0);
}

export function buildTemplateScriptExecutionPlan(
  scripts: TemplateScript[],
): TemplateScript[][] {
  const normalized = normalizeTemplateScripts(scripts)
    .filter((script) => script.content.trim().length > 0);
  const dependencyMap = new Map<string, Set<string>>();
  const byId = new Map(normalized.map((script) => [script.id, script]));

  normalized.forEach((script, index) => {
    const dependencies = new Set(
      script.dependsOn.filter((dependency) => byId.has(dependency)),
    );

    if (script.runMode !== "parallel" && index > 0) {
      dependencies.add(normalized[index - 1].id);
    }

    dependencyMap.set(script.id, dependencies);
  });

  const completed = new Set<string>();
  const remaining = new Set(normalized.map((script) => script.id));
  const waves: TemplateScript[][] = [];

  while (remaining.size > 0) {
    const ready = normalized.filter((script) => {
      if (!remaining.has(script.id)) {
        return false;
      }

      const dependencies = dependencyMap.get(script.id) ?? new Set<string>();
      return [...dependencies].every((dependency) => completed.has(dependency));
    });

    if (ready.length === 0) {
      const blockedNames = normalized
        .filter((script) => remaining.has(script.id))
        .map((script) => script.name)
        .join(", ");
      throw new Error(`Template script dependencies contain a cycle near: ${blockedNames}.`);
    }

    waves.push(ready);

    for (const script of ready) {
      completed.add(script.id);
      remaining.delete(script.id);
    }
  }

  return waves;
}

export function buildGuestTemplateScriptHarness(
  envVars: TemplateEnvVar[],
  scripts: TemplateScript[],
): string {
  const normalizedEnvVars = normalizeTemplateEnvVars(envVars);
  const normalizedScripts = normalizeTemplateScripts(scripts)
    .filter((script) => script.content.trim().length > 0);
  const waves = buildTemplateScriptExecutionPlan(normalizedScripts);
  const allScripts = waves.flat();
  const scriptWriteBlocks = allScripts.map((script, index) => {
    const filePath = scriptFilePath(script, index);
    return `cat > ${shellQuote(filePath)}.b64 <<'B64'\n${toBase64(script.content)}\nB64\nbase64 -d ${shellQuote(filePath)}.b64 > ${shellQuote(filePath)}\nrm -f ${shellQuote(filePath)}.b64\nchmod 0700 ${shellQuote(filePath)}`;
  }).join("\n");
  const envExports = normalizedEnvVars.map((envVar) =>
    `export ${envVar.name}="$(base64 -d <<'B64'\n${toBase64(envVar.value)}\nB64\n)"`,
  ).join("\n");
  const waveBlocks = waves.map((wave, waveIndex) => {
    const runLines = wave.map((script, scriptIndex) => {
      const flatIndex = allScripts.findIndex((entry) => entry.id === script.id);
      const filePath = scriptFilePath(script, flatIndex);
      const command = `run_template_script ${shellQuote(script.id)} ${shellQuote(script.name)} ${shellQuote(filePath)}`;

      if (wave.length === 1) {
        return `${command} || FAILED=1`;
      }

      return `${command} &\nPIDS="$PIDS $!"`;
    }).join("\n");
    const waitBlock = wave.length === 1
      ? ""
      : `for PID in $PIDS; do\n  if ! wait "$PID"; then\n    FAILED=1\n  fi\ndone`;
    const skipped = waves
      .slice(waveIndex + 1)
      .flat()
      .map((script) =>
        `record_template_script_result ${shellQuote(script.id)} ${shellQuote(script.name)} skipped null "" "" ""`,
      )
      .join("\n");

    return `PIDS=""\n${runLines}\n${waitBlock}\nif [ "$FAILED" -ne 0 ]; then\n${skipped ? indentBlock(skipped, "  ") : "  true"}\n  print_template_script_results\n  exit 1\nfi`;
  }).join("\n");

  return `#!/usr/bin/env bash
set -u
SCRIPT_DIR="/var/lib/parallaize/template-scripts"
LOG_DIR="${DEFAULT_TEMPLATE_SCRIPT_LOG_PATH}"
SUMMARY_FILE="$LOG_DIR/results.jsonl"
mkdir -p "$SCRIPT_DIR" "$LOG_DIR"
: > "$SUMMARY_FILE"
${envExports}
${scriptWriteBlocks}
record_template_script_result() {
  RESULT_SCRIPT_ID="$1"
  RESULT_SCRIPT_NAME="$2"
  RESULT_STATUS="$3"
  RESULT_EXIT_CODE="$4"
  RESULT_STARTED_AT="$5"
  RESULT_FINISHED_AT="$6"
  RESULT_LOG_FILE="$7"
  python3 - "$SUMMARY_FILE" "$RESULT_SCRIPT_ID" "$RESULT_SCRIPT_NAME" "$RESULT_STATUS" "$RESULT_EXIT_CODE" "$RESULT_STARTED_AT" "$RESULT_FINISHED_AT" "$RESULT_LOG_FILE" <<'PY'
import json
import pathlib
import sys

summary_file, script_id, name, status, exit_code, started_at, finished_at, log_file = sys.argv[1:]
log = ""
if log_file:
    path = pathlib.Path(log_file)
    if path.exists():
        log = path.read_text(errors="replace")
payload = {
    "scriptId": script_id,
    "name": name,
    "status": status,
    "exitCode": None if exit_code == "null" else int(exit_code),
    "startedAt": started_at or None,
    "finishedAt": finished_at or None,
    "log": log,
}
with open(summary_file, "a", encoding="utf-8") as handle:
    handle.write(json.dumps(payload, ensure_ascii=False) + "\\n")
PY
}
run_template_script() {
  SCRIPT_ID="$1"
  SCRIPT_NAME="$2"
  SCRIPT_FILE="$3"
  SAFE_NAME="$(printf '%s' "$SCRIPT_NAME" | tr -c 'A-Za-z0-9._-' '_')"
  LOG_FILE="$LOG_DIR/$SAFE_NAME.log"
  STARTED_AT="$(date -Is)"
  bash "$SCRIPT_FILE" >"$LOG_FILE" 2>&1
  EXIT_CODE="$?"
  FINISHED_AT="$(date -Is)"
  if [ "$EXIT_CODE" -eq 0 ]; then
    record_template_script_result "$SCRIPT_ID" "$SCRIPT_NAME" succeeded "$EXIT_CODE" "$STARTED_AT" "$FINISHED_AT" "$LOG_FILE"
  else
    record_template_script_result "$SCRIPT_ID" "$SCRIPT_NAME" failed "$EXIT_CODE" "$STARTED_AT" "$FINISHED_AT" "$LOG_FILE"
    printf 'Template script %s failed with exit code %s\\n' "$SCRIPT_NAME" "$EXIT_CODE" >&2
    cat "$LOG_FILE" >&2 || true
  fi
  return "$EXIT_CODE"
}
print_template_script_results() {
  printf '${TEMPLATE_SCRIPT_RESULTS_BEGIN}\\n'
  cat "$SUMMARY_FILE"
  printf '${TEMPLATE_SCRIPT_RESULTS_END}\\n'
}
FAILED=0
${waveBlocks}
print_template_script_results
exit 0`;
}

export function parseGuestTemplateScriptHarnessResults(stdout: string): VmTemplateScriptRun[] {
  const start = stdout.indexOf(TEMPLATE_SCRIPT_RESULTS_BEGIN);
  const end = stdout.indexOf(TEMPLATE_SCRIPT_RESULTS_END);

  if (start === -1 || end === -1 || end <= start) {
    return [];
  }

  const content = stdout
    .slice(start + TEMPLATE_SCRIPT_RESULTS_BEGIN.length, end)
    .trim();

  if (!content) {
    return [];
  }

  return content
    .split("\n")
    .map((line) => JSON.parse(line) as VmTemplateScriptRun);
}

export function formatTemplateScriptRunsActivity(runs: VmTemplateScriptRun[]): string[] {
  if (runs.length === 0) {
    return [];
  }

  const failed = runs.filter((run) => run.status === "failed");

  return [
    failed.length === 0
      ? `template-scripts: ${runs.length} script${runs.length === 1 ? "" : "s"} completed`
      : `template-scripts: ${failed.length} of ${runs.length} script${runs.length === 1 ? "" : "s"} failed`,
    `template-scripts-log: ${DEFAULT_TEMPLATE_SCRIPT_LOG_PATH}`,
  ];
}

export function summarizeTemplateScriptFailure(runs: VmTemplateScriptRun[]): string {
  const failed = runs.find((run) => run.status === "failed");

  if (!failed) {
    return "Template scripts failed.";
  }

  const logLines = failed.log
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-8);
  const logSummary = logLines.length > 0 ? ` ${logLines.join(" | ")}` : "";
  return `Template script ${failed.name} failed with exit code ${failed.exitCode ?? "unknown"}.${logSummary}`;
}

function isValidEnvVarName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function normalizeScriptName(value: string | undefined, index: number): string {
  const trimmed = value?.trim();

  if (trimmed) {
    return trimmed.slice(0, 96);
  }

  return index === 0 ? DEFAULT_TEMPLATE_SCRIPT_NAME : `script-${index + 1}.sh`;
}

function normalizeScriptId(
  value: string | undefined,
  name: string,
  index: number,
  usedIds: Set<string>,
): string {
  const base =
    sanitizeId(value) ||
    sanitizeId(name) ||
    `script-${index + 1}`;
  let candidate = base;
  let suffix = 2;

  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function sanitizeId(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function scriptFilePath(script: TemplateScript, index: number): string {
  const safeName = script.name
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "") ||
    `script-${index + 1}.sh`;
  return `/var/lib/parallaize/template-scripts/${String(index + 1).padStart(2, "0")}-${safeName}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function toBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function indentBlock(value: string, prefix: string): string {
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}
