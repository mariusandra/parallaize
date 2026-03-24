import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";

import { loadConfig } from "../apps/control/src/config.js";

test("loadConfig uses PARALLAIZE_APP_HOME for packaged default paths", () => {
  const previousEnv = { ...process.env };

  try {
    process.env.PARALLAIZE_APP_HOME = "/usr/lib/parallaize";
    process.env.PARALLAIZE_PROVIDER = "incus";
    delete process.env.PARALLAIZE_DATA_FILE;
    delete process.env.PARALLAIZE_PERSISTENCE;
    delete process.env.PARALLAIZE_DATABASE_URL;
    delete process.env.DATABASE_URL;

    const config = loadConfig();

    assert.equal(config.appHome, "/usr/lib/parallaize");
    assert.equal(config.dataFile, "/usr/lib/parallaize/data/state.json");
    assert.equal(config.persistenceKind, "json");
  } finally {
    process.env = previousEnv;
  }
});
