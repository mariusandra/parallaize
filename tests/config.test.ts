import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../apps/control/src/config.js";

test("guest VNC port defaults to the template bootstrap port", () => {
  const previous = process.env.PARALLAIZE_GUEST_VNC_PORT;

  delete process.env.PARALLAIZE_GUEST_VNC_PORT;

  try {
    assert.equal(loadConfig().guestVncPort, 5900);
  } finally {
    if (previous === undefined) {
      delete process.env.PARALLAIZE_GUEST_VNC_PORT;
    } else {
      process.env.PARALLAIZE_GUEST_VNC_PORT = previous;
    }
  }
});
