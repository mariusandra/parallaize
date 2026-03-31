import assert from "node:assert/strict";
import test from "node:test";

import { SpawnIncusCommandRunner } from "../apps/control/src/providers-incus-runtime.js";

test("SpawnIncusCommandRunner preserves large JSON-like stdout payloads", () => {
  const runner = new SpawnIncusCommandRunner(process.execPath);
  const payloadSize = 2 * 1024 * 1024;
  const result = runner.execute([
    "-e",
    `process.stdout.write(JSON.stringify([{cloudInit: "x".repeat(${payloadSize})}]));`,
  ]);
  const parsed = JSON.parse(result.stdout) as Array<{ cloudInit: string }>;

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(parsed[0]?.cloudInit.length, payloadSize);
});

test("SpawnIncusCommandRunner forwards stdin input to child commands", () => {
  const runner = new SpawnIncusCommandRunner(process.execPath);
  const result = runner.execute(
    [
      "-e",
      "process.stdin.setEncoding('utf8');let data='';process.stdin.on('data', (chunk) => data += chunk);process.stdin.on('end', () => process.stdout.write(data));",
    ],
    {
      input: "bridge bootstrap payload",
    },
  );

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "bridge bootstrap payload");
  assert.equal(result.stderr, "");
});
