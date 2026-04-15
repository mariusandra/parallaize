import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";

import { chromium, type Browser } from "playwright";

test("embedded frame focus bridge shifts keyboard targets off a clicked video surface", async (context) => {
  const executablePath = chromium.executablePath();
  if (!existsSync(executablePath)) {
    context.skip(
      `Playwright Chromium is not installed at ${executablePath}. Run "flox activate -d . -- pnpm playwright:install".`,
    );
    return;
  }

  const embeddedFrameFocusModule = readFileSync(
    new URL("../apps/web/src/embeddedFrameFocus.js", import.meta.url),
    "utf8",
  );

  const childDocument = `<!doctype html>
<html lang="en">
  <body style="margin: 0">
    <video id="video-surface" style="width: 400px; height: 220px; display: block; background: #111"></video>
    <script>
      window.__parallaizeKeyboardTargets = [];
      for (const type of ["keydown", "keypress", "keyup"]) {
        window.addEventListener(type, (event) => {
          window.__parallaizeKeyboardTargets.push(
            event.target instanceof Element ? event.target.tagName : "UNKNOWN",
          );
        });
      }
    </script>
  </body>
</html>`;

  const parentDocument = `<!doctype html>
<html lang="en">
  <body>
    <iframe id="workspace-frame" src="/child.html" style="width: 420px; height: 240px"></iframe>
    <script type="module">
      import {
        attachEmbeddedFrameFocusBridge,
        focusEmbeddedFrameTarget,
      } from "/embeddedFrameFocus.js";

      const frame = document.getElementById("workspace-frame");
      frame.addEventListener("load", () => {
        focusEmbeddedFrameTarget(frame);
        attachEmbeddedFrameFocusBridge(frame);
      });
    </script>
  </body>
</html>`;

  const server = createServer((request, response) => {
    if (request.url === "/embeddedFrameFocus.js") {
      response.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
      });
      response.end(embeddedFrameFocusModule);
      return;
    }

    if (request.url === "/child.html") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
      });
      response.end(childDocument);
      return;
    }

    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
    });
    response.end(parentDocument);
  });

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: [
        "--disable-dev-shm-usage",
        "--no-sandbox",
      ],
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`, {
      waitUntil: "domcontentloaded",
    });

    const frame = page.frameLocator("iframe#workspace-frame");
    await frame.locator("#video-surface").click();
    await page.keyboard.type("ab");

    const keyboardTargets = await frame.locator("body").evaluate(() => {
      const targetWindow = window as Window & {
        __parallaizeKeyboardTargets?: string[];
      };
      return targetWindow.__parallaizeKeyboardTargets ?? [];
    });

    assert.deepEqual(keyboardTargets, ["BODY", "BODY", "BODY", "BODY", "BODY", "BODY"]);
  } finally {
    await browser?.close();
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  }
});
