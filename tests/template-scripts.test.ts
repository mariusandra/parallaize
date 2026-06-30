import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGuestTemplateScriptHarness,
  buildTemplateScriptExecutionPlan,
  normalizeTemplateEnvVars,
  normalizeTemplateScripts,
  parseGuestTemplateScriptHarnessResults,
} from "../apps/control/src/template-scripts.js";

test("template script normalizers keep valid env vars and resolve dependencies by name", () => {
  assert.deepEqual(
    normalizeTemplateEnvVars([
      { name: " OPENAI_API_KEY ", value: "secret" },
      { name: "bad-name", value: "ignored" },
      { name: "OPENAI_API_KEY", value: "ignored-duplicate" },
      { name: "PROJECT_ID", value: "parallaize" },
    ]),
    [
      { name: "OPENAI_API_KEY", value: "secret" },
      { name: "PROJECT_ID", value: "parallaize" },
    ],
  );

  assert.deepEqual(
    normalizeTemplateScripts([
      {
        id: "setup",
        name: "setup.sh",
        content: "true",
        dependsOn: [],
        runMode: "after-previous",
      },
      {
        id: "app",
        name: "app.sh",
        content: "true",
        dependsOn: ["setup.sh"],
        runMode: "parallel",
      },
    ]).map((script) => ({
      id: script.id,
      dependsOn: script.dependsOn,
    })),
    [
      { id: "setup", dependsOn: [] },
      { id: "app", dependsOn: ["setup"] },
    ],
  );
});

test("template script execution plan allows parallel scripts after dependencies", () => {
  const plan = buildTemplateScriptExecutionPlan([
    {
      id: "setup",
      name: "setup.sh",
      content: "true",
      dependsOn: [],
      runMode: "after-previous",
    },
    {
      id: "db",
      name: "db.sh",
      content: "true",
      dependsOn: ["setup"],
      runMode: "parallel",
    },
    {
      id: "app",
      name: "app.sh",
      content: "true",
      dependsOn: ["setup"],
      runMode: "parallel",
    },
  ]);

  assert.deepEqual(
    plan.map((wave) => wave.map((script) => script.id)),
    [["setup"], ["db", "app"]],
  );
});

test("template script harness parser reads JSON result lines", () => {
  const runs = parseGuestTemplateScriptHarnessResults(`noise
PARALLAIZE_TEMPLATE_SCRIPT_RESULTS_BEGIN
{"scriptId":"setup","name":"setup.sh","status":"succeeded","exitCode":0,"startedAt":"2026-06-30T10:00:00+02:00","finishedAt":"2026-06-30T10:00:01+02:00","log":"ok"}
PARALLAIZE_TEMPLATE_SCRIPT_RESULTS_END
tail`);

  assert.deepEqual(runs, [
    {
      scriptId: "setup",
      name: "setup.sh",
      status: "succeeded",
      exitCode: 0,
      startedAt: "2026-06-30T10:00:00+02:00",
      finishedAt: "2026-06-30T10:00:01+02:00",
      log: "ok",
    },
  ]);
});

test("template script harness embeds env values without raw secret text", () => {
  const harness = buildGuestTemplateScriptHarness(
    [{ name: "OPENAI_API_KEY", value: "sk-test-secret" }],
    [
      {
        id: "setup",
        name: "setup.sh",
        content: "echo ready",
        dependsOn: [],
        runMode: "after-previous",
      },
    ],
  );

  assert.match(harness, /export OPENAI_API_KEY/);
  assert.doesNotMatch(harness, /sk-test-secret/);
});
