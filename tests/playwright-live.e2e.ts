import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import process from "node:process";
import test from "node:test";

import {
  chromium,
  type Browser,
  type FrameLocator,
  type Locator,
  type Page,
} from "playwright";

import type {
  DashboardSummary,
  EnvironmentTemplate,
  VmDetail,
  VmInstance,
} from "../packages/shared/src/types.js";

const BASE_URL = process.env.PARALLAIZE_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const AUTH_USERNAME = process.env.PARALLAIZE_E2E_ADMIN_USERNAME ?? "admin";
const AUTH_PASSWORD = normalizeOptionalString(process.env.PARALLAIZE_E2E_ADMIN_PASSWORD);
const KEEP_VMS = process.env.PARALLAIZE_E2E_KEEP_VMS === "1";
const TEMPLATE_ID = normalizeOptionalString(process.env.PARALLAIZE_E2E_TEMPLATE_ID);
const TEMPLATE_NAME = normalizeOptionalString(process.env.PARALLAIZE_E2E_TEMPLATE_NAME);
const VM_PREFIX = process.env.PARALLAIZE_E2E_VM_PREFIX ?? "playwright-live";
const ENABLE_GUACAMOLE = process.env.PARALLAIZE_E2E_ENABLE_GUACAMOLE === "1";
const VM_TIMEOUT_MS = parseInteger(
  process.env.PARALLAIZE_E2E_VM_TIMEOUT_MS,
  12 * 60 * 1000,
);
const RESUME_TIMEOUT_MS = parseInteger(
  process.env.PARALLAIZE_E2E_RESUME_TIMEOUT_MS,
  90 * 1000,
);
const DELETE_TIMEOUT_MS = parseInteger(
  process.env.PARALLAIZE_E2E_DELETE_TIMEOUT_MS,
  5 * 60 * 1000,
);
const SUITE_TIMEOUT_MS = parseInteger(
  process.env.PARALLAIZE_E2E_SUITE_TIMEOUT_MS,
  30 * 60 * 1000,
);

type LiveDesktopTransport = "selkies" | "vnc" | "guacamole";

interface ApiEnvelope<T> {
  data: T;
  error?: string;
  ok: boolean;
}

interface LiveVmTarget {
  desktopTransport: LiveDesktopTransport;
  id: string;
  name: string;
}

test(
  "Live Incus browser coverage",
  { timeout: SUITE_TIMEOUT_MS },
  async (context) => {
    const browser = await launchChromium(context);
    const browserContext = await browser.newContext({
      viewport: {
        width: 1600,
        height: 1000,
      },
    });

    context.after(async () => {
      await browserContext.close();
    });

    const page = await browserContext.newPage();
    page.on("console", (message) => {
      console.log(`[browser:${message.type()}] ${message.text()}`);
    });
    page.on("pageerror", (error) => {
      console.log(`[pageerror] ${error.stack ?? error.message}`);
    });
    page.on("crash", () => {
      console.log("[page] crashed");
    });
    const createdVms: LiveVmTarget[] = [];
    const runId = Date.now();

    try {
      await page.goto(BASE_URL, {
        waitUntil: "domcontentloaded",
      });
      await loginIfRequired(page);
      await waitForDashboardReady(page);

      const summary = await fetchJson<DashboardSummary>(page, "/api/summary");
      assert.equal(
        summary.provider.kind,
        "incus",
        `Live Playwright coverage expects an Incus-backed server at ${BASE_URL}.`,
      );

      const template = resolveLiveTemplate(summary.templates);
      const firstVmName = `${VM_PREFIX}-${runId}-a`;
      const secondVmName = `${VM_PREFIX}-${runId}-b`;
      const vncVmName = `${VM_PREFIX}-${runId}-vnc`;
      const guacamoleVmName = `${VM_PREFIX}-${runId}-guac`;

      await context.test(
        "creating a VM yields a live Selkies stage session",
        { timeout: VM_TIMEOUT_MS },
        async () => {
          const firstVm = await createLiveVm(page, template, firstVmName);
          createdVms.push(firstVm);
          await waitForStageSelkiesVideo(page, firstVm.name, VM_TIMEOUT_MS);
        },
      );

      await context.test(
        "created sidebar previews load against the real server",
        { timeout: VM_TIMEOUT_MS },
        async () => {
          const secondVm = await createLiveVm(page, template, secondVmName);
          createdVms.push(secondVm);

          for (const vm of createdVms) {
            await waitForLivePreview(page, vm.name, VM_TIMEOUT_MS);
          }
        },
      );

      await context.test(
        "opening a VM keeps its sidebar preview active on live data",
        { timeout: RESUME_TIMEOUT_MS },
        async () => {
          const secondVm = requireVm(createdVms, secondVmName);

          await openVm(page, secondVm.name, RESUME_TIMEOUT_MS);
          await waitForLivePreview(page, secondVm.name, RESUME_TIMEOUT_MS);
        },
      );

      await context.test(
        "switching between VMs resumes both live browser sessions",
        { timeout: VM_TIMEOUT_MS },
        async () => {
          const firstVm = requireVm(createdVms, firstVmName);
          const secondVm = requireVm(createdVms, secondVmName);

          await openVm(page, firstVm.name, RESUME_TIMEOUT_MS);
          await waitForStageSelkiesVideo(page, firstVm.name, RESUME_TIMEOUT_MS);

          await openVm(page, secondVm.name, RESUME_TIMEOUT_MS);
          await waitForStageSelkiesVideo(page, secondVm.name, RESUME_TIMEOUT_MS);
          await waitForLivePreview(page, firstVm.name, RESUME_TIMEOUT_MS);
          await waitForLivePreview(page, secondVm.name, RESUME_TIMEOUT_MS);
          assert.equal(await page.locator(`iframe[title="${firstVm.name} desktop"]`).count(), 1);

          await openVm(page, firstVm.name, RESUME_TIMEOUT_MS);
          await waitForStageSelkiesVideo(page, firstVm.name, RESUME_TIMEOUT_MS);
          await waitForLivePreview(page, firstVm.name, RESUME_TIMEOUT_MS);
          await waitForLivePreview(page, secondVm.name, RESUME_TIMEOUT_MS);
        },
      );

      await context.test(
        "creating a VM with VNC yields a live socket desktop session that survives stage switches",
        { timeout: VM_TIMEOUT_MS },
        async () => {
          const firstVm = requireVm(createdVms, firstVmName);
          const vncVm = await createLiveVm(page, template, vncVmName, "vnc");
          createdVms.push(vncVm);

          await waitForStageSocketDesktopCanvas(page, vncVm.name, VM_TIMEOUT_MS);
          await waitForLivePreview(page, vncVm.name, RESUME_TIMEOUT_MS);

          await openVm(page, firstVm.name, RESUME_TIMEOUT_MS);
          await waitForStageSelkiesVideo(page, firstVm.name, RESUME_TIMEOUT_MS);
          await waitForLivePreview(page, vncVm.name, RESUME_TIMEOUT_MS);

          await openSocketDesktopVm(page, vncVm.name);
          await waitForStageSocketDesktopCanvas(page, vncVm.name, RESUME_TIMEOUT_MS);
          assert.equal(await page.locator(`iframe[title="${firstVm.name} desktop"]`).count(), 1);
          await waitForLivePreview(page, firstVm.name, RESUME_TIMEOUT_MS);

          await openVm(page, firstVm.name, RESUME_TIMEOUT_MS);
          await waitForStageSelkiesVideo(page, firstVm.name, RESUME_TIMEOUT_MS);
        },
      );

      if (ENABLE_GUACAMOLE) {
        await context.test(
          "creating a VM with Guacamole yields a live canvas session that survives stage switches",
          { timeout: VM_TIMEOUT_MS },
          async () => {
            const firstVm = requireVm(createdVms, firstVmName);
            const guacamoleVm = await createLiveVm(page, template, guacamoleVmName, "guacamole");
            createdVms.push(guacamoleVm);

            await waitForStageSocketDesktopCanvas(page, guacamoleVm.name, VM_TIMEOUT_MS);

            await openVm(page, firstVm.name, RESUME_TIMEOUT_MS);
            await waitForStageSelkiesVideo(page, firstVm.name, RESUME_TIMEOUT_MS);

            await openSocketDesktopVm(page, guacamoleVm.name);
            await waitForStageSocketDesktopCanvas(page, guacamoleVm.name, RESUME_TIMEOUT_MS);

            await openVm(page, firstVm.name, RESUME_TIMEOUT_MS);
            await waitForStageSelkiesVideo(page, firstVm.name, RESUME_TIMEOUT_MS);
          },
        );
      }

      await context.test(
        "opening the same VM in another tab hands off the live session cleanly",
        { timeout: VM_TIMEOUT_MS },
        async () => {
          const firstVm = requireVm(createdVms, firstVmName);
          const secondaryPage = await browserContext.newPage();

          secondaryPage.on("console", (message) => {
            console.log(`[browser:secondary:${message.type()}] ${message.text()}`);
          });
          secondaryPage.on("pageerror", (error) => {
            console.log(`[pageerror:secondary] ${error.stack ?? error.message}`);
          });

          try {
            await openVm(page, firstVm.name, RESUME_TIMEOUT_MS);
            await waitForStageSelkiesVideo(page, firstVm.name, RESUME_TIMEOUT_MS);

            await secondaryPage.goto(BASE_URL, {
              waitUntil: "domcontentloaded",
            });
            await loginIfRequired(secondaryPage);
            await waitForDashboardReady(secondaryPage);
            await openVm(secondaryPage, firstVm.name, RESUME_TIMEOUT_MS);
            await waitForStageSelkiesVideo(secondaryPage, firstVm.name, RESUME_TIMEOUT_MS);

            await page.getByRole("heading", { name: "Opened in another tab" }).waitFor({
              timeout: RESUME_TIMEOUT_MS,
            });

            await page.getByRole("button", { name: "Reconnect here" }).click();
            await waitForStageSelkiesVideo(page, firstVm.name, RESUME_TIMEOUT_MS);

            await secondaryPage.getByRole("heading", { name: "Opened in another tab" }).waitFor(
              {
                timeout: RESUME_TIMEOUT_MS,
              },
            );
          } finally {
            await secondaryPage.close();
          }
        },
      );
    } finally {
      if (!KEEP_VMS) {
        for (const vm of createdVms.reverse()) {
          await deleteVm(page, vm.id);
          await waitForVmDeletion(page, vm.id, DELETE_TIMEOUT_MS);
        }
      }
    }
  },
);

async function loginIfRequired(page: Page): Promise<void> {
  if (!(await isVisible(page.getByRole("heading", { name: "Sign in" }), 2_000))) {
    return;
  }

  if (!AUTH_PASSWORD) {
    throw new Error(
      "The target server requires admin auth. Set PARALLAIZE_E2E_ADMIN_PASSWORD before running the live Playwright suite.",
    );
  }

  await page.getByLabel("Username").fill(AUTH_USERNAME);
  await page.getByLabel("Password").fill(AUTH_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function waitForDashboardReady(page: Page): Promise<void> {
  await page.getByRole("button", { name: "New VM" }).waitFor({
    timeout: 30_000,
  });
}

async function createLiveVm(
  page: Page,
  template: EnvironmentTemplate,
  vmName: string,
  desktopTransport: LiveDesktopTransport = "selkies",
): Promise<LiveVmTarget> {
  await page.getByRole("button", { name: "New VM" }).click();

  const dialog = page.locator(".dialog-panel");
  await dialog.getByRole("heading", { name: "Launch a VM" }).waitFor();
  await dialog.locator("select").selectOption(`template:${template.id}`);

  const transportChoice = dialog.locator(
    `input[name="desktopTransport"][value="${desktopTransport}"]`,
  );

  if ((await transportChoice.count()) > 0) {
    await transportChoice.check();
  }

  await dialog.getByLabel("Name").fill(vmName);
  await dialog.getByRole("button", { name: "Queue workspace" }).click();
  await dialog.waitFor({ state: "hidden" });

  const createdVm = await waitForValue(
    `VM ${vmName} to appear`,
    async () => {
      const summary = await fetchJson<DashboardSummary>(page, "/api/summary");
      return summary.vms.find((vm) => vm.name === vmName) ?? null;
    },
    VM_TIMEOUT_MS,
    2_000,
  );

  await waitForVmDesktopSession(page, createdVm.id, desktopTransport, VM_TIMEOUT_MS);

  return {
    desktopTransport,
    id: createdVm.id,
    name: vmName,
  };
}

async function waitForVmSelkiesSession(
  page: Page,
  vmId: string,
  timeoutMs: number,
): Promise<VmDetail> {
  return await waitForVmDesktopSession(page, vmId, "selkies", timeoutMs);
}

async function waitForVmDesktopSession(
  page: Page,
  vmId: string,
  desktopTransport: LiveDesktopTransport,
  timeoutMs: number,
): Promise<VmDetail> {
  return await waitForValue(
    `${desktopTransport} browser session for ${vmId}`,
    async () => {
      const detail = await fetchJson<VmDetail>(page, `/api/vms/${vmId}`);
      const session = detail.vm.session;

      if (detail.vm.status !== "running") {
        return null;
      }

      if (
        desktopTransport === "selkies" &&
        session?.kind === "selkies" &&
        Boolean(session.browserPath)
      ) {
        return detail;
      }

      if (
        (desktopTransport === "vnc" || desktopTransport === "guacamole") &&
        session?.kind === desktopTransport &&
        Boolean(session.webSocketPath)
      ) {
        return detail;
      }

      return null;
    },
    timeoutMs,
    2_000,
  );
}

async function openVm(
  page: Page,
  vmName: string,
  timeoutMs: number,
): Promise<void> {
  await selectVm(page, vmName);
  await page.locator(`iframe[title="${vmName} desktop"]`).waitFor({
    timeout: timeoutMs,
  });
}

async function openSocketDesktopVm(page: Page, vmName: string): Promise<void> {
  await selectVm(page, vmName);
}

async function selectVm(page: Page, vmName: string): Promise<void> {
  const tile = vmTile(page, vmName);

  await tile.scrollIntoViewIfNeeded();
  await tile.locator("button.vm-tile__open").click();
}

async function waitForStageSelkiesVideo(
  page: Page,
  vmName: string,
  timeoutMs: number,
): Promise<void> {
  await page.locator(`iframe[title="${vmName} desktop"]`).waitFor({
    timeout: timeoutMs,
  });
  await waitForFrameVideoReady(
    page.frameLocator(`iframe[title="${vmName} desktop"]`),
    `${vmName} stage video`,
    timeoutMs,
  );
}

async function waitForStageSocketDesktopCanvas(
  page: Page,
  vmName: string,
  timeoutMs: number,
): Promise<void> {
  const canvas = page.locator(".workspace-stage .novnc-surface canvas").first();

  await canvas.waitFor({ timeout: timeoutMs });
  await waitForCondition(
    `${vmName} VNC stage canvas`,
    async () => {
      try {
        return await canvas.evaluate((node) => {
          if (
            !(node instanceof HTMLCanvasElement) ||
            node.width < 320 ||
            node.height < 200 ||
            node.clientWidth <= 0 ||
            node.clientHeight <= 0
          ) {
            return false;
          }

          const sampleSize = 64;
          const probe = document.createElement("canvas");
          probe.width = sampleSize;
          probe.height = sampleSize;
          const context = probe.getContext("2d", {
            willReadFrequently: true,
          });

          if (!context) {
            return false;
          }

          context.drawImage(node, 0, 0, sampleSize, sampleSize);
          const pixels = context.getImageData(0, 0, sampleSize, sampleSize).data;
          let nonBlackPixelCount = 0;
          const litTiles = new Set<number>();
          const uniqueColorBuckets = new Set<number>();

          for (let y = 0; y < sampleSize; y += 1) {
            for (let x = 0; x < sampleSize; x += 1) {
              const offset = ((y * sampleSize) + x) * 4;
              const red = pixels[offset] ?? 0;
              const green = pixels[offset + 1] ?? 0;
              const blue = pixels[offset + 2] ?? 0;

              if (Math.max(red, green, blue) <= 8) {
                continue;
              }

              nonBlackPixelCount += 1;
              litTiles.add(Math.floor(x / 16) + (Math.floor(y / 16) * 4));
              uniqueColorBuckets.add(((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4));
            }
          }

          const pixelCount = sampleSize * sampleSize;

          return (
            litTiles.size >= 4 ||
            nonBlackPixelCount / pixelCount >= 0.02 ||
            (
              uniqueColorBuckets.size >= 8 &&
              nonBlackPixelCount >= 128
            )
          );
        });
      } catch {
        return false;
      }
    },
    timeoutMs,
    1_000,
  );
}

async function waitForLivePreview(
  page: Page,
  vmName: string,
  timeoutMs: number,
): Promise<void> {
  const tile = vmTile(page, vmName);

  await tile.scrollIntoViewIfNeeded();

  if ((await page.locator(`iframe[title="${vmName} live preview"]`).count()) > 0) {
    await waitForFrameVideoReady(
      page.frameLocator(`iframe[title="${vmName} live preview"]`),
      `${vmName} preview video`,
      timeoutMs,
    );
    return;
  }

  if ((await tile.locator(`img[alt="${vmName} live preview"]`).count()) > 0) {
    await waitForPreviewImage(page, vmName, timeoutMs);
    return;
  }

  await waitForMirroredPreviewCanvas(page, vmName, timeoutMs);
}

async function waitForFrameVideoReady(
  frame: FrameLocator,
  description: string,
  timeoutMs: number,
): Promise<void> {
  const video = frame.locator("video").first();

  await video.waitFor({ timeout: timeoutMs });
  await waitForCondition(
    description,
    async () => {
      try {
        return await video.evaluate((node) => {
          return node instanceof HTMLVideoElement &&
            node.readyState >= 2 &&
            node.videoWidth >= 320 &&
            node.videoHeight >= 200 &&
            node.currentTime >= 1 &&
            !node.paused;
        });
      } catch {
        return false;
      }
    },
    timeoutMs,
    1_000,
  );
}

async function waitForMirroredPreviewCanvas(
  page: Page,
  vmName: string,
  timeoutMs: number,
): Promise<void> {
  const canvas = vmTile(page, vmName).locator(".vm-tile__preview canvas").first();

  await canvas.waitFor({ timeout: timeoutMs });
  await waitForCondition(
    `${vmName} mirrored preview canvas`,
    async () => {
      try {
        return await canvas.evaluate((node) => {
          return node instanceof HTMLCanvasElement &&
            node.width > 0 &&
            node.height > 0;
        });
      } catch {
        return false;
      }
    },
    timeoutMs,
    500,
  );
}

async function waitForPreviewImage(
  page: Page,
  vmName: string,
  timeoutMs: number,
): Promise<void> {
  const image = vmTile(page, vmName).locator(`img[alt="${vmName} live preview"]`).first();

  await image.waitFor({ timeout: timeoutMs });
  await waitForCondition(
    `${vmName} preview image`,
    async () => {
      try {
        return await image.evaluate((node) => {
          return node instanceof HTMLImageElement &&
            node.complete &&
            node.naturalWidth > 0 &&
            node.naturalHeight > 0;
        });
      } catch {
        return false;
      }
    },
    timeoutMs,
    500,
  );

  const source = await image.getAttribute("src");
  assert.ok(source, `Expected ${vmName} preview image to expose a src.`);

  const response = await fetch(new URL(source!, BASE_URL), {
    headers: await buildAuthHeaders(page),
    method: "HEAD",
  });
  assert.equal(
    response.headers.get("content-type")?.startsWith("image/png"),
    true,
    `Expected ${vmName} preview image to come from a real PNG capture.`,
  );
}

async function deleteVm(page: Page, vmId: string): Promise<void> {
  await fetchJson(page, `/api/vms/${vmId}/delete`, {
    method: "POST",
  });
}

async function waitForVmDeletion(
  page: Page,
  vmId: string,
  timeoutMs: number,
): Promise<void> {
  await waitForCondition(
    `VM ${vmId} to delete`,
    async () => {
      const summary = await fetchJson<DashboardSummary>(page, "/api/summary");
      return !summary.vms.some((vm) => vm.id === vmId);
    },
    timeoutMs,
    2_000,
  );
}

async function fetchJson<T>(
  page: Page,
  path: string,
  init?: {
    body?: string;
    method?: string;
  },
): Promise<T> {
  const headers = await buildAuthHeaders(page);

  if (init?.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(new URL(path, BASE_URL), {
    body: init?.body,
    headers,
    method: init?.method ?? "GET",
  });
  const envelope = (await response.json()) as ApiEnvelope<T>;

  if (response.status >= 400 || envelope.ok !== true) {
    throw new Error(
      `Request to ${path} failed with ${response.status}: ${envelope.error ?? "Unknown error"}`,
    );
  }

  return envelope.data;
}

async function buildAuthHeaders(page: Page): Promise<Headers> {
  const cookies = await page.context().cookies(BASE_URL);
  const headers = new Headers();

  if (cookies.length > 0) {
    headers.set(
      "cookie",
      cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
    );
  }

  return headers;
}

function resolveLiveTemplate(
  templates: EnvironmentTemplate[],
): EnvironmentTemplate {
  if (TEMPLATE_ID) {
    const template = templates.find((entry) => entry.id === TEMPLATE_ID);

    if (!template) {
      throw new Error(`Template id ${TEMPLATE_ID} was not found on ${BASE_URL}.`);
    }

    return template;
  }

  if (TEMPLATE_NAME) {
    const template = templates.find((entry) => entry.name === TEMPLATE_NAME);

    if (!template) {
      throw new Error(`Template name "${TEMPLATE_NAME}" was not found on ${BASE_URL}.`);
    }

    return template;
  }

  const template =
    templates.find(
      (entry) =>
        entry.defaultDesktopTransport === "selkies" &&
        entry.provenance?.kind === "seed",
    ) ??
    templates.find((entry) => entry.defaultDesktopTransport === "selkies");

  if (!template) {
    throw new Error(
      "No Selkies-capable template is available. Set PARALLAIZE_E2E_TEMPLATE_ID or PARALLAIZE_E2E_TEMPLATE_NAME explicitly.",
    );
  }

  return template;
}

function requireVm(vms: LiveVmTarget[], vmName: string): LiveVmTarget {
  const vm = vms.find((entry) => entry.name === vmName);

  if (!vm) {
    throw new Error(`VM ${vmName} was not recorded during the live run.`);
  }

  return vm;
}

function vmTile(page: Page, vmName: string): Locator {
  return page
    .locator("article.vm-tile")
    .filter({
      has: page.getByRole("heading", { name: vmName }),
    })
    .first();
}

async function launchChromium(context: test.TestContext): Promise<Browser> {
  const executablePath = chromium.executablePath();

  if (!existsSync(executablePath)) {
    throw new Error(
      `Playwright Chromium is not installed at ${executablePath}. Run "flox activate -d . -- pnpm playwright:install".`,
    );
  }

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      "--disable-dev-shm-usage",
      "--no-sandbox",
    ],
  });

  context.after(async () => {
    await browser.close();
  });

  return browser;
}

async function isVisible(locator: Locator, timeoutMs: number): Promise<boolean> {
  try {
    await locator.waitFor({
      timeout: timeoutMs,
    });
    return true;
  } catch {
    return false;
  }
}

async function waitForCondition(
  description: string,
  check: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs: number,
): Promise<void> {
  await waitForValue(
    description,
    async () => (await check()) ? true : null,
    timeoutMs,
    intervalMs,
  );
}

async function waitForValue<T>(
  description: string,
  getValue: () => Promise<T | null>,
  timeoutMs: number,
  intervalMs: number,
): Promise<T> {
  const timeoutAt = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (Date.now() < timeoutAt) {
    try {
      const value = await getValue();

      if (value !== null) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }

  throw new Error(
    `Timed out waiting for ${description}${lastError instanceof Error ? `: ${lastError.message}` : ""}`,
  );
}

function normalizeOptionalString(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
