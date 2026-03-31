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

test("loadConfig reads Selkies STUN and TURN overrides", () => {
  const previousEnv = { ...process.env };

  try {
    process.env.PARALLAIZE_SELKIES_STUN_HOST = "stun.example.com";
    process.env.PARALLAIZE_SELKIES_STUN_PORT = "3478";
    process.env.PARALLAIZE_SELKIES_TURN_HOST = "turn.example.com";
    process.env.PARALLAIZE_SELKIES_TURN_PORT = "5349";
    process.env.PARALLAIZE_SELKIES_TURN_PROTOCOL = "tcp";
    process.env.PARALLAIZE_SELKIES_TURN_TLS = "true";
    process.env.PARALLAIZE_SELKIES_TURN_SHARED_SECRET = "shared-secret";
    process.env.PARALLAIZE_SELKIES_TURN_USERNAME = "turn-user";
    process.env.PARALLAIZE_SELKIES_TURN_PASSWORD = "turn-password";
    process.env.PARALLAIZE_SELKIES_TURN_REST_URI = "https://turn.example.com/api";
    process.env.PARALLAIZE_SELKIES_TURN_REST_USERNAME = "selkies-host";
    process.env.PARALLAIZE_SELKIES_TURN_REST_USERNAME_AUTH_HEADER = "x-turn-user";
    process.env.PARALLAIZE_SELKIES_TURN_REST_PROTOCOL_HEADER = "x-turn-proto";
    process.env.PARALLAIZE_SELKIES_TURN_REST_TLS_HEADER = "x-turn-tls";

    const config = loadConfig();

    assert.deepEqual(config.guestSelkiesRtcConfig, {
      stunHost: "stun.example.com",
      stunPort: 3478,
      turnHost: "turn.example.com",
      turnPort: 5349,
      turnProtocol: "tcp",
      turnTls: true,
      turnSharedSecret: "shared-secret",
      turnUsername: "turn-user",
      turnPassword: "turn-password",
      turnRestUri: "https://turn.example.com/api",
      turnRestUsername: "selkies-host",
      turnRestUsernameAuthHeader: "x-turn-user",
      turnRestProtocolHeader: "x-turn-proto",
      turnRestTlsHeader: "x-turn-tls",
    });
  } finally {
    process.env = previousEnv;
  }
});
