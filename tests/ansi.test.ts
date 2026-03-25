import assert from "node:assert/strict";
import test from "node:test";

import { parseAnsiText, resolveAnsiSegmentStyle } from "../apps/web/src/ansi.js";

test("parseAnsiText renders common systemd bold and green segments", () => {
  const segments = parseAnsiText(
    `Starting \x1b[0;1;39mmodprobe@loop.service\x1b[0m...\n` +
      `[\x1b[0;32m  OK  \x1b[0m] Finished\n`,
  );

  assert.equal(segments.length, 5);
  assert.equal(segments[0]?.text, "Starting ");
  assert.equal(segments[1]?.text, "modprobe@loop.service");
  assert.equal(segments[2]?.text, "...\n[");
  assert.equal(segments[3]?.text, "  OK  ");
  assert.equal(segments[4]?.text, "] Finished\n");
  assert.deepEqual(resolveAnsiSegmentStyle(segments[1]!), {
    fontWeight: "bold",
  });
  assert.deepEqual(resolveAnsiSegmentStyle(segments[3]!), {
    color: "#22c55e",
  });
});

test("parseAnsiText normalizes carriage returns and supports 256-color output", () => {
  const segments = parseAnsiText("boot\r\n\x1b[38;5;214mwarn\x1b[0m");

  assert.equal(segments[0]?.text, "boot\n");
  assert.equal(segments[1]?.text, "warn");
  assert.deepEqual(resolveAnsiSegmentStyle(segments[1]!), {
    color: "rgb(255 175 0)",
  });
});

test("parseAnsiText supports inverse styling with log-window defaults", () => {
  const segments = parseAnsiText("\x1b[7mreversed\x1b[0m");
  const style = resolveAnsiSegmentStyle(segments[0]!);

  assert.deepEqual(style, {
    backgroundColor: "var(--vm-log-fg)",
    color: "var(--vm-log-bg)",
  });
});
