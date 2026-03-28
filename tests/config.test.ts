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
    assert.equal(config.configuredDefaultTemplateLaunchSource, null);
    assert.equal(config.sessionMaxAgeSeconds, 60 * 60 * 24 * 7);
    assert.equal(config.sessionIdleTimeoutSeconds, 60 * 60 * 24);
    assert.equal(config.sessionRotationSeconds, 60 * 60 * 6);
  } finally {
    process.env = previousEnv;
  }
});

test("loadConfig rejects session rotation windows that are longer than the idle timeout", () => {
  const previousEnv = { ...process.env };

  try {
    process.env.PARALLAIZE_SESSION_IDLE_TIMEOUT_SECONDS = "60";
    process.env.PARALLAIZE_SESSION_ROTATION_SECONDS = "120";

    assert.throws(
      () => loadConfig(),
      /PARALLAIZE_SESSION_ROTATION_SECONDS must be lower than PARALLAIZE_SESSION_IDLE_TIMEOUT_SECONDS/,
    );
  } finally {
    process.env = previousEnv;
  }
});

test("loadConfig reads a pinned default template launch source", () => {
  const previousEnv = { ...process.env };

  try {
    process.env.PARALLAIZE_DEFAULT_TEMPLATE_LAUNCH_SOURCE = "local:ubuntu-noble-desktop-20260320";

    const config = loadConfig();

    assert.equal(
      config.configuredDefaultTemplateLaunchSource,
      "local:ubuntu-noble-desktop-20260320",
    );
    assert.equal(
      config.defaultTemplateLaunchSource,
      "local:ubuntu-noble-desktop-20260320",
    );
  } finally {
    process.env = previousEnv;
  }
});
