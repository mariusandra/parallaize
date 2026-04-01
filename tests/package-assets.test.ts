import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const packageAssetsModule = await import(
  pathToFileURL(resolve(process.cwd(), "scripts/package-assets.mjs")).href,
);

test("packaged Caddyfile is derived from the development front-door config", async () => {
  const source = await readFile(resolve(process.cwd(), "infra/Caddyfile"), "utf8");
  const rendered = packageAssetsModule.renderPackagedCaddyfile(source);

  assert.match(
    rendered,
    /^https:\/\/127\.0\.0\.1:\{\$PARALLAIZE_CADDY_PORT:8080\}, https:\/\/localhost:\{\$PARALLAIZE_CADDY_PORT:8080\}, https:\/\/\{\$HOSTNAME:localhost\}:\{\$PARALLAIZE_CADDY_PORT:8080\}, https:\/\/\{\$PARALLAIZE_FORWARDED_SERVICE_HOST_BASE:parallaize\.localhost\}:\{\$PARALLAIZE_CADDY_PORT:8080\}, https:\/\/\*\.\{\$PARALLAIZE_FORWARDED_SERVICE_HOST_BASE:parallaize\.localhost\}:\{\$PARALLAIZE_CADDY_PORT:8080\} \{$/m,
  );
  assert.equal(rendered.includes("127.0.0.1:3000"), false);
  assert.equal(
    rendered.match(/127\.0\.0\.1:\{\$PORT:3000\}/g)?.length ?? 0,
    5,
  );
});

test("packaged Caddyfile render rejects unexpected source layouts", () => {
  assert.throws(
    () => packageAssetsModule.renderPackagedCaddyfile("{\nadmin off\n}\n"),
    /Expected the development Caddyfile/,
  );
});
