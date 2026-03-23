import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createProvider } from "../apps/control/src/providers.js";
import {
  readStateFromJsonFile,
  readStateFromPostgresClient,
  summarizeState,
  writeStateToJsonFile,
  writeStateToPostgresClient,
  type SqlClientLike,
} from "../apps/control/src/persistence-admin.js";
import { createSeedState } from "../apps/control/src/seed.js";
import { POSTGRES_STORE_KEY } from "../apps/control/src/store.js";

test("json persistence admin helpers normalize legacy state and write canonical JSON", (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-persistence-json-"));
  context.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const sourcePath = join(tempDir, "legacy-state.json");
  const targetPath = join(tempDir, "canonical-state.json");

  writeFileSync(
    sourcePath,
    JSON.stringify({
      sequence: 0,
      provider: {
        kind: "incus",
      },
      templates: [
        {
          id: "tpl-legacy",
          name: "Legacy template",
        },
        {
          id: "tpl-default-kubuntu-24-04",
          name: "Retired Kubuntu default",
          kind: "default-image",
          launchSource: "parallaize-template-tpl-default-kubuntu-24-04",
        },
      ],
      vms: [
        {
          id: "vm-legacy",
          name: "legacy-vm",
          templateId: "tpl-legacy",
          provider: "incus",
        },
      ],
    }),
    "utf8",
  );

  const state = readStateFromJsonFile(sourcePath);
  assert.equal(state.sequence, 1);
  assert.equal(state.provider.kind, "incus");
  assert.equal(state.provider.desktopTransport, "novnc");
  assert.equal(state.templates[0]?.launchSource, "images:ubuntu/noble/desktop");
  assert.ok(state.templates.some((template) => template.id === "tpl-default-ubuntu-24-04"));
  assert.ok(!state.templates.some((template) => template.id === "tpl-default-kubuntu-24-04"));
  assert.equal(state.vms[0]?.workspacePath, "/root");

  writeStateToJsonFile(targetPath, state);
  const written = readFileSync(targetPath, "utf8");
  assert.match(written, /\n$/);

  const parsed = JSON.parse(written) as typeof state;
  assert.equal(parsed.templates[0]?.id, "tpl-legacy");
  assert.equal(parsed.vms[0]?.id, "vm-legacy");
});

test("postgres persistence admin helpers use the singleton row and preserve app state", async () => {
  const provider = createProvider("mock", "incus");
  const seeded = createSeedState(provider.state);
  let storedState: unknown = null;
  const queries: string[] = [];

  const client: SqlClientLike = {
    async query<Row = unknown>(sql: string, params: unknown[] = []) {
      queries.push(sql.trim());

      if (sql.includes("SELECT state FROM app_state")) {
        const rows =
          storedState === null
            ? []
            : ([{ state: storedState }] satisfies { state: unknown }[]);

        return {
          rowCount: rows.length,
          rows: rows as Row[],
        };
      }

      if (sql.includes("INSERT INTO app_state")) {
        assert.equal(params[0], POSTGRES_STORE_KEY);
        storedState = JSON.parse(String(params[1]));
        return {
          rowCount: 1,
          rows: [] as Row[],
        };
      }

      return {
        rowCount: null,
        rows: [] as Row[],
      };
    },
  };

  await writeStateToPostgresClient(client, seeded);
  const recovered = await readStateFromPostgresClient(client);
  const summary = summarizeState(recovered);

  assert.equal(recovered.provider.kind, seeded.provider.kind);
  assert.equal(recovered.templates.length, seeded.templates.length);
  assert.equal(recovered.vms.length, seeded.vms.length);
  assert.equal(summary.vmCount, seeded.vms.length);
  assert.ok(queries.some((entry) => entry.startsWith("CREATE TABLE IF NOT EXISTS app_state")));
  assert.ok(queries.some((entry) => entry.startsWith("INSERT INTO app_state")));
  assert.ok(queries.some((entry) => entry.startsWith("SELECT state FROM app_state")));
});
