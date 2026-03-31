import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { chromium } from "playwright";

const baseUrl = process.env.PARALLAIZE_E2E_BASE_URL ?? "http://127.0.0.1:3001";
const templateId = process.env.PARALLAIZE_E2E_TEMPLATE_ID ?? "tpl-default-ubuntu-24-04";
const executablePath = chromium.executablePath();
const timeoutMs = 12 * 60 * 1000;

if (!existsSync(executablePath)) {
  throw new Error(`Playwright Chromium is not installed at ${executablePath}.`);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForValue(description, getValue, timeoutMs, intervalMs) {
  const timeoutAt = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < timeoutAt) {
    try {
      const value = await getValue();

      if (value !== null) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(intervalMs);
  }

  throw new Error(
    `Timed out waiting for ${description}${lastError instanceof Error ? `: ${lastError.message}` : ""}`,
  );
}

async function fetchJson(page, path, init) {
  const response = await page.evaluate(
    async ({ init, path }) => {
      const requestInit = {
        method: init?.method ?? "GET",
      };

      if (init?.body !== undefined) {
        requestInit.body = init.body;
        requestInit.headers = {
          "content-type": "application/json",
        };
      }

      const response = await fetch(path, requestInit);
      return {
        payload: await response.json(),
        status: response.status,
      };
    },
    {
      init,
      path,
    },
  );

  if (response.status >= 400 || response.payload.ok !== true) {
    throw new Error(
      `Request to ${path} failed with ${response.status}: ${response.payload.error ?? "Unknown error"}`,
    );
  }

  return response.payload.data;
}

function vmTile(page, vmName) {
  return page
    .locator("article.vm-tile")
    .filter({
      has: page.getByRole("heading", { name: vmName }),
    })
    .first();
}

async function createVm(page, vmName) {
  await page.getByRole("button", { name: "New VM" }).click();

  const dialog = page.locator(".dialog-panel");
  await dialog.getByRole("heading", { name: "Launch a VM" }).waitFor();
  await dialog.locator("select").selectOption(`template:${templateId}`);
  await dialog.getByLabel("Name").fill(vmName);
  await dialog.getByRole("button", { name: "Queue workspace" }).click();
  await dialog.waitFor({ state: "hidden" });

  const createdVm = await waitForValue(
    `VM ${vmName}`,
    async () => {
      const summary = await fetchJson(page, "/api/summary");
      return summary.vms.find((vm) => vm.name === vmName) ?? null;
    },
    timeoutMs,
    2_000,
  );

  await waitForValue(
    `Selkies session for ${vmName}`,
    async () => {
      const detail = await fetchJson(page, `/api/vms/${createdVm.id}`);
      return detail.vm.status === "running" &&
          detail.vm.session?.kind === "selkies" &&
          detail.vm.session.browserPath
        ? detail
        : null;
    },
    timeoutMs,
    2_000,
  );

  return createdVm;
}

async function deleteVm(page, vmId) {
  await fetchJson(page, `/api/vms/${vmId}/delete`, {
    method: "POST",
  });
}

async function dumpPageState(page, label) {
  const url = new URL(page.url());
  const iframeTitles = await page.locator("iframe").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("title")),
  );
  console.log(label, {
    iframeTitles,
    selectedVm: url.searchParams.get("vm"),
  });
}

async function waitForFrameVideoReady(page, iframeTitle, label, timeoutMs) {
  const iframe = page.locator(`iframe[title="${iframeTitle}"]`);
  await iframe.waitFor({ timeout: timeoutMs });

  const video = page.frameLocator(`iframe[title="${iframeTitle}"]`).locator("video").first();
  await video.waitFor({ timeout: timeoutMs });

  await waitForValue(
    label,
    async () => {
      try {
        return await video.evaluate((node) => {
          return node instanceof HTMLVideoElement &&
            node.readyState >= 2 &&
            node.videoWidth > 0 &&
            node.videoHeight > 0
            ? {
                height: node.videoHeight,
                paused: node.paused,
                readyState: node.readyState,
                width: node.videoWidth,
              }
            : null;
        });
      } catch {
        return null;
      }
    },
    timeoutMs,
    1_000,
  );

  console.log(`video ready: ${label}`);
}

const browser = await chromium.launch({
  args: [
    "--disable-dev-shm-usage",
    "--no-sandbox",
  ],
  executablePath,
  headless: true,
});

const context = await browser.newContext({
  viewport: {
    height: 1000,
    width: 1600,
  },
});

const page = await context.newPage();
page.on("console", (message) => {
  console.log("[console]", message.type(), message.text());
});
page.on("pageerror", (error) => {
  console.error("[pageerror]", error);
});
const createdVmIds = [];
const runId = Date.now();
const firstName = `debug-click-${runId}-a`;
const secondName = `debug-click-${runId}-b`;

try {
  await page.goto(baseUrl, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("button", { name: "New VM" }).waitFor({
    timeout: 30_000,
  });

  const firstVm = await createVm(page, firstName);
  createdVmIds.push(firstVm.id);
  await waitForFrameVideoReady(page, `${firstName} desktop`, `${firstName} stage`, timeoutMs);
  const secondVm = await createVm(page, secondName);
  createdVmIds.push(secondVm.id);
  for (const vmName of [firstName, secondName]) {
    await vmTile(page, vmName).scrollIntoViewIfNeeded();
    await waitForFrameVideoReady(page, `${vmName} live preview`, `${vmName} preview`, timeoutMs);
  }

  await dumpPageState(page, "after create");

  const firstTile = vmTile(page, firstName);
  await firstTile.scrollIntoViewIfNeeded();
  const firstOpen = firstTile.locator("button.vm-tile__open");
  await firstOpen.waitFor();

  const box = await firstOpen.boundingBox();
  assert.ok(box, "first tile open button did not expose a bounding box");
  console.log("first button box", box);

  await firstOpen.click();

  await sleep(1_000);
  await dumpPageState(page, "after center click");
  await waitForFrameVideoReady(page, `${firstName} desktop`, `${firstName} stage-after-center-click`, timeoutMs);

  await firstOpen.click({
    position: {
      x: 24,
      y: 24,
    },
  });

  await sleep(1_000);
  await dumpPageState(page, "after corner click");
  await waitForFrameVideoReady(page, `${firstName} desktop`, `${firstName} stage-after-corner-click`, timeoutMs);

  const secondTile = vmTile(page, secondName);
  await secondTile.scrollIntoViewIfNeeded();
  await secondTile.locator("button.vm-tile__open").click();
  await sleep(1_000);
  await dumpPageState(page, "after reopen second");
  await waitForFrameVideoReady(page, `${secondName} desktop`, `${secondName} stage-after-reopen`, timeoutMs);
} finally {
  for (const vmId of createdVmIds.reverse()) {
    try {
      await deleteVm(page, vmId);
    } catch (error) {
      console.error("delete failed", vmId, error);
    }
  }

  await context.close();
  await browser.close();
}
