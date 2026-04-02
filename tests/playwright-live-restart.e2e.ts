import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcessByStdio } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import type { Readable } from "node:stream";
import test from "node:test";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type FrameLocator,
  type Locator,
  type Page,
} from "playwright";

import type {
  DashboardSummary,
  EnvironmentTemplate,
  VmDetail,
} from "../packages/shared/src/types.js";

const AUTH_USERNAME = process.env.PARALLAIZE_E2E_ADMIN_USERNAME ?? "admin";
const AUTH_PASSWORD = normalizeOptionalString(process.env.PARALLAIZE_E2E_ADMIN_PASSWORD);
const KEEP_VM = process.env.PARALLAIZE_E2E_KEEP_VMS === "1";
const TARGET_RECONNECT_MS = parseInteger(
  process.env.PARALLAIZE_E2E_RESTART_TARGET_MS,
  10_000,
);
const RESTART_ITERATIONS = Math.max(
  1,
  parseInteger(process.env.PARALLAIZE_E2E_RESTART_ITERATIONS, 3),
);
const VM_PREFIX = process.env.PARALLAIZE_E2E_VM_PREFIX ?? "playwright-live-restart";
const VM_TIMEOUT_MS = parseInteger(
  process.env.PARALLAIZE_E2E_VM_TIMEOUT_MS,
  12 * 60 * 1000,
);
const RECONNECT_TIMEOUT_MS = parseInteger(
  process.env.PARALLAIZE_E2E_RESUME_TIMEOUT_MS,
  20_000,
);
const DELETE_TIMEOUT_MS = parseInteger(
  process.env.PARALLAIZE_E2E_DELETE_TIMEOUT_MS,
  5 * 60 * 1000,
);
const SUITE_TIMEOUT_MS = parseInteger(
  process.env.PARALLAIZE_E2E_SUITE_TIMEOUT_MS,
  45 * 60 * 1000,
);
const SERVER_START_COMMAND = process.env.PARALLAIZE_E2E_SERVER_START_COMMAND
  ?? "exec flox activate -d . -- pnpm start";

type SpawnedServerProcess = ChildProcessByStdio<null, Readable, Readable>;

interface ApiEnvelope<T> {
  data: T;
  error?: string;
  ok: boolean;
}

interface BrowserRun {
  browser: Browser;
  browserContext: BrowserContext;
  page: Page;
}

interface LiveVmTarget {
  id: string;
  name: string;
}

interface RestartMeasurement {
  browserReadyMs: number;
  cycle: number;
  endToEndMs: number;
  hostReadyMs: number;
  pictureReadyMs: number;
  screenshotPath: string;
}

type RecoveryAction = "none" | "kick" | "frame-reload";

interface RecoveryScenario {
  action: RecoveryAction;
  name: string;
  reloadPage: boolean;
  restartServer: boolean;
}

interface SelkiesStageDiagnostics {
  currentTime: number;
  iceConnectionState: string | null;
  paused: boolean;
  peerConnectionState: string | null;
  ready: boolean;
  readyState: number;
  recentLogs: string[];
  showStart: boolean | null;
  status: string | null;
  videoHeight: number;
  videoWidth: number;
}

const recoveryScenarios: RecoveryScenario[] = [
  {
    action: "none",
    name: "browser full reload reconnects the selected Selkies stage",
    reloadPage: true,
    restartServer: false,
  },
  {
    action: "kick",
    name: "browser full reload plus manual kick reconnects the selected Selkies stage",
    reloadPage: true,
    restartServer: false,
  },
  {
    action: "none",
    name: "server restart without a browser reload reconnects the selected Selkies stage",
    reloadPage: false,
    restartServer: true,
  },
  {
    action: "kick",
    name: "server restart plus kick stream reconnects the selected Selkies stage",
    reloadPage: false,
    restartServer: true,
  },
  {
    action: "frame-reload",
    name: "server restart plus frame reload reconnects the selected Selkies stage",
    reloadPage: false,
    restartServer: true,
  },
  {
    action: "none",
    name: "server restart plus browser full reload reconnects the selected Selkies stage",
    reloadPage: true,
    restartServer: true,
  },
];

test(
  "Live Incus Selkies reload and restart recovery",
  { timeout: SUITE_TIMEOUT_MS },
  async (context) => {
    const fixture = createLiveStateFixture();
    const artifactsDir = mkdtempSync(join(tmpdir(), "parallaize-live-restart-artifacts-"));
    const port = await reservePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const measurements: RestartMeasurement[] = [];
    let browserRun: BrowserRun | null = null;
    let createdVm: LiveVmTarget | null = null;
    let serverProcess: SpawnedServerProcess | null = null;

    try {
      serverProcess = await startIncusServer(port, baseUrl, fixture.stateFile);
      browserRun = await openBrowserRun(baseUrl);
      await loginIfRequired(browserRun.page);
      await waitForDashboardReady(browserRun.page);

      const summary = await fetchJson<DashboardSummary>(browserRun.page, baseUrl, "/api/summary");
      assert.equal(
        summary.provider.kind,
        "incus",
        `Live restart coverage expects an Incus-backed server at ${baseUrl}.`,
      );

      const template = resolveLiveTemplate(summary.templates);
      createdVm = await createLiveVm(
        browserRun.page,
        baseUrl,
        template,
        `${VM_PREFIX}-${Date.now()}`,
      );
      const targetVm = createdVm;

      assert.ok(targetVm, "Expected the live restart suite to create a VM.");

      await browserRun.page.goto(`${baseUrl}/?vm=${encodeURIComponent(targetVm.id)}`, {
        waitUntil: "domcontentloaded",
      });
      await loginIfRequired(browserRun.page);
      await waitForDashboardReady(browserRun.page);
      await waitForHealthySelkiesStage(browserRun.page, baseUrl, targetVm, VM_TIMEOUT_MS);

      const initialScreenshotPath = join(artifactsDir, "initial-stage.png");
      await browserRun.page.screenshot({
        fullPage: true,
        path: initialScreenshotPath,
      });
      console.log(`Saved initial live desktop screenshot to ${initialScreenshotPath}`);

      for (const scenario of recoveryScenarios) {
        await context.test(
          scenario.name,
          { timeout: Math.max(RECONNECT_TIMEOUT_MS * 2, 90_000) },
          async () => {
            assert.ok(browserRun, "Browser context should be active before recovery checks.");
            assert.ok(serverProcess, "Server process should be active before recovery checks.");

            console.log(`[live-restart] scenario start: ${scenario.name}`);

            await waitForHealthySelkiesStage(
              browserRun.page,
              baseUrl,
              targetVm,
              RECONNECT_TIMEOUT_MS,
            );

            if (scenario.restartServer) {
              serverProcess = await restartServer({
                baseUrl,
                port,
                serverProcess,
                stateFile: fixture.stateFile,
              });
            }

            if (scenario.reloadPage) {
              await browserRun.page.goto(`${baseUrl}/?vm=${encodeURIComponent(targetVm.id)}`, {
                waitUntil: "domcontentloaded",
              });
              await loginIfRequired(browserRun.page);
              await waitForDashboardReady(browserRun.page);
            }

            if (scenario.action !== "none") {
              await openVm(browserRun.page, targetVm.name, RECONNECT_TIMEOUT_MS);
              await applyRecoveryAction(browserRun.page, scenario.action, RECONNECT_TIMEOUT_MS);
            }

            await waitForHealthySelkiesStage(
              browserRun.page,
              baseUrl,
              targetVm,
              RECONNECT_TIMEOUT_MS,
            );

            await browserRun.page.screenshot({
              fullPage: true,
              path: join(
                artifactsDir,
                `${slugifyScenarioName(scenario.name)}.png`,
              ),
            });

            console.log(`[live-restart] scenario complete: ${scenario.name}`);
          },
        );
      }

      await context.test(
        "repeated full host and browser restarts still return to a live Selkies stream under the reconnect target",
        { timeout: Math.max(SUITE_TIMEOUT_MS - 60_000, 5 * 60 * 1000) },
        async () => {
          for (let cycle = 1; cycle <= RESTART_ITERATIONS; cycle += 1) {
            assert.ok(browserRun, "Browser context should still be active before restart cycles.");
            assert.ok(serverProcess, "Server process should still be active before restart cycles.");
            console.log(`[live-restart] full restart cycle ${cycle}/${RESTART_ITERATIONS}`);
            const restartResult = await runRestartCycle({
              artifactsDir,
              baseUrl,
              browserRun,
              cycle,
              port,
              stateFile: fixture.stateFile,
              vm: targetVm,
              serverProcess,
            });

            browserRun = restartResult.browserRun;
            serverProcess = restartResult.serverProcess;
            measurements.push(restartResult.measurement);
          }

          console.log("Live restart reconnect measurements:");
          console.log(JSON.stringify(measurements, null, 2));

          const slowestReconnectMs = Math.max(
            ...measurements.map((entry) => entry.pictureReadyMs),
          );
          assert.ok(
            slowestReconnectMs < TARGET_RECONNECT_MS,
            `Expected every browser restart to return a live picture under ${TARGET_RECONNECT_MS}ms, but the slowest reconnect took ${slowestReconnectMs}ms.`,
          );
        },
      );
    } finally {
      if (createdVm && !KEEP_VM) {
        try {
          if (!serverProcess || serverProcess.exitCode !== null || serverProcess.signalCode !== null) {
            serverProcess = await startIncusServer(port, baseUrl, fixture.stateFile);
          }

          if (!browserRun) {
            browserRun = await openBrowserRun(baseUrl);
            await loginIfRequired(browserRun.page);
            await waitForDashboardReady(browserRun.page);
          }

          await deleteVm(browserRun.page, baseUrl, createdVm.id);
          await waitForVmDeletion(browserRun.page, baseUrl, createdVm.id, DELETE_TIMEOUT_MS);
        } catch (error) {
          console.error(
            `Cleanup failed for ${createdVm.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      if (browserRun) {
        await closeBrowserRun(browserRun);
      }

      if (serverProcess) {
        await stopServer(serverProcess, baseUrl);
      }

      rmSync(fixture.tempDir, { force: true, recursive: true });
    }
  },
);

async function runRestartCycle({
  artifactsDir,
  baseUrl,
  browserRun,
  cycle,
  port,
  stateFile,
  vm,
  serverProcess,
}: {
  artifactsDir: string;
  baseUrl: string;
  browserRun: BrowserRun;
  cycle: number;
  port: number;
  stateFile: string;
  vm: LiveVmTarget;
  serverProcess: SpawnedServerProcess;
}): Promise<{
  browserRun: BrowserRun;
  measurement: RestartMeasurement;
  serverProcess: SpawnedServerProcess;
}> {
  const cycleStartedAt = Date.now();
  await stopServer(serverProcess, baseUrl);
  await closeBrowserRun(browserRun);
  const restartedServerProcess = await startIncusServer(port, baseUrl, stateFile);
  const hostReadyAt = Date.now();

  const browserRestartStartedAt = Date.now();
  const restartedBrowserRun = await openBrowserRun(
    `${baseUrl}/?vm=${encodeURIComponent(vm.id)}`,
  );
  await loginIfRequired(restartedBrowserRun.page);
  await waitForDashboardReady(restartedBrowserRun.page);
  const browserReadyAt = Date.now();

  await waitForVmSelkiesSession(
    restartedBrowserRun.page,
    baseUrl,
    vm.id,
    RECONNECT_TIMEOUT_MS,
  );
  await waitForHealthySelkiesStage(
    restartedBrowserRun.page,
    baseUrl,
    vm,
    RECONNECT_TIMEOUT_MS,
  );
  const pictureReadyAt = Date.now();

  const screenshotPath = join(artifactsDir, `cycle-${String(cycle).padStart(2, "0")}.png`);
  await restartedBrowserRun.page.screenshot({
    fullPage: true,
    path: screenshotPath,
  });

  return {
    browserRun: restartedBrowserRun,
    measurement: {
      browserReadyMs: browserReadyAt - browserRestartStartedAt,
      cycle,
      endToEndMs: pictureReadyAt - cycleStartedAt,
      hostReadyMs: hostReadyAt - cycleStartedAt,
      pictureReadyMs: pictureReadyAt - browserRestartStartedAt,
      screenshotPath,
    },
    serverProcess: restartedServerProcess,
  };
}

function createLiveStateFixture(): {
  stateFile: string;
  tempDir: string;
} {
  const tempDir = mkdtempSync(join(tmpdir(), "parallaize-live-restart-state-"));
  const stateFile = join(tempDir, "state.json");
  const sourceState = JSON.parse(readFileSync("data/incus-state.json", "utf8")) as {
    adminSessions?: unknown[];
    jobs?: unknown[];
    lastUpdated?: string;
    vms?: unknown[];
  };

  sourceState.vms = [];
  sourceState.jobs = [];
  sourceState.adminSessions = [];
  sourceState.lastUpdated = new Date().toISOString();
  writeFileSync(stateFile, `${JSON.stringify(sourceState, null, 2)}\n`);

  return {
    stateFile,
    tempDir,
  };
}

async function startIncusServer(
  port: number,
  baseUrl: string,
  stateFile: string,
): Promise<SpawnedServerProcess> {
  console.log(`[live-restart] starting server on ${baseUrl} via ${SERVER_START_COMMAND}`);

  const serverProcess = spawn("bash", ["-lc", SERVER_START_COMMAND], {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PARALLAIZE_ADMIN_PASSWORD: "",
      PARALLAIZE_DATA_FILE: stateFile,
      PARALLAIZE_PROVIDER: "incus",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForStdoutLine(serverProcess, /parallaize listening on http:\/\/127\.0\.0\.1:/);
  await waitForHttpOk(baseUrl, 15_000);
  console.log(`[live-restart] server ready on ${baseUrl}`);
  return serverProcess;
}

async function stopServer(
  serverProcess: SpawnedServerProcess,
  baseUrl: string,
): Promise<void> {
  const port = readBaseUrlPort(baseUrl);

  if (serverProcess.exitCode !== null || serverProcess.signalCode !== null) {
    await ensurePortReleased(port, 10_000);
    return;
  }

  console.log("[live-restart] stopping server");

  try {
    process.kill(-serverProcess.pid!, "SIGTERM");
  } catch {
    serverProcess.kill("SIGTERM");
  }

  const exited = await Promise.race([
    once(serverProcess, "exit").then(() => true),
    sleep(10_000).then(() => false),
  ]);

  if (!exited) {
    try {
      process.kill(-serverProcess.pid!, "SIGKILL");
    } catch {
      serverProcess.kill("SIGKILL");
    }
    await once(serverProcess, "exit");
  }

  await waitForHttpDown(baseUrl, 10_000);
  await ensurePortReleased(port, 10_000);

  console.log("[live-restart] server stopped");
}

async function sleep(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function openBrowserRun(url: string): Promise<BrowserRun> {
  const browser = await launchChromium();
  const browserContext = await browser.newContext({
    viewport: {
      height: 1000,
      width: 1600,
    },
  });
  const page = await browserContext.newPage();

  attachPageDiagnostics(page, "primary");
  await page.goto(url, {
    waitUntil: "domcontentloaded",
  });

  return {
    browser,
    browserContext,
    page,
  };
}

async function closeBrowserRun(browserRun: BrowserRun): Promise<void> {
  await browserRun.browser.close();
}

function attachPageDiagnostics(page: Page, label: string): void {
  page.on("console", (message) => {
    console.log(`[browser:${label}:${message.type()}] ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    console.log(`[pageerror:${label}] ${error.stack ?? error.message}`);
  });
  page.on("crash", () => {
    console.log(`[page:${label}] crashed`);
  });
}

async function launchChromium(): Promise<Browser> {
  const executablePath = chromium.executablePath();

  if (!existsSync(executablePath)) {
    throw new Error(
      `Playwright Chromium is not installed at ${executablePath}. Run "flox activate -d . -- pnpm playwright:install".`,
    );
  }

  return await chromium.launch({
    args: [
      "--disable-dev-shm-usage",
      "--no-sandbox",
    ],
    executablePath,
    headless: true,
  });
}

async function loginIfRequired(page: Page): Promise<void> {
  if (!(await isVisible(page.getByRole("heading", { name: "Sign in" }), 2_000))) {
    return;
  }

  if (!AUTH_PASSWORD) {
    throw new Error(
      "The target server requires admin auth. Set PARALLAIZE_E2E_ADMIN_PASSWORD before running the live restart suite.",
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
  baseUrl: string,
  template: EnvironmentTemplate,
  vmName: string,
): Promise<LiveVmTarget> {
  await page.getByRole("button", { name: "New VM" }).click();

  const dialog = page.locator(".dialog-panel");
  await dialog.getByRole("heading", { name: "Launch a VM" }).waitFor();
  await dialog.locator("select").selectOption(`template:${template.id}`);
  await dialog.locator(`input[name="desktopTransport"][value="selkies"]`).check();
  await dialog.getByLabel("Name").fill(vmName);
  await dialog.getByRole("button", { name: "Queue workspace" }).click();
  await dialog.waitFor({ state: "hidden" });

  const createdVm = await waitForValue(
    `VM ${vmName} to appear`,
    async () => {
      const summary = await fetchJson<DashboardSummary>(page, baseUrl, "/api/summary");
      return summary.vms.find((vm) => vm.name === vmName) ?? null;
    },
    VM_TIMEOUT_MS,
    2_000,
  );

  await waitForVmSelkiesSession(page, baseUrl, createdVm.id, VM_TIMEOUT_MS);

  return {
    id: createdVm.id,
    name: vmName,
  };
}

async function waitForVmSelkiesSession(
  page: Page,
  baseUrl: string,
  vmId: string,
  timeoutMs: number,
): Promise<VmDetail> {
  return await waitForValue(
    `Selkies browser session for ${vmId}`,
    async () => {
      const detail = await fetchJson<VmDetail>(page, baseUrl, `/api/vms/${vmId}`);
      const session = detail.vm.session;

      if (
        detail.vm.status === "running" &&
        session?.kind === "selkies" &&
        Boolean(session.browserPath)
      ) {
        return detail;
      }

      return null;
    },
    timeoutMs,
    1_000,
  );
}

function vmTile(page: Page, vmName: string): Locator {
  return page
    .locator("article.vm-tile")
    .filter({
      has: page.getByRole("heading", { name: vmName }),
    })
    .first();
}

async function openVm(page: Page, vmName: string, timeoutMs: number): Promise<void> {
  const tile = vmTile(page, vmName);

  await tile.scrollIntoViewIfNeeded();
  await tile.locator("button.vm-tile__open").click();
  await page.locator(`iframe[title="${vmName} desktop"]`).waitFor({
    timeout: timeoutMs,
  });
}

async function waitForStreamingBadge(
  page: Page,
  vmName: string,
  timeoutMs: number,
): Promise<void> {
  const tile = vmTile(page, vmName);

  await tile.scrollIntoViewIfNeeded();
  await tile.getByText("Streaming").waitFor({
    timeout: timeoutMs,
  });
}

async function readSelkiesStageDiagnostics(
  page: Page,
  vmName: string,
): Promise<SelkiesStageDiagnostics | null> {
  const frame = page.locator(`iframe[title="${vmName} desktop"]`).first();

  if ((await frame.count()) === 0) {
    return null;
  }

  try {
    return await frame.evaluate((node) => {
      if (!(node instanceof HTMLIFrameElement)) {
        return null;
      }

      const target = node.contentWindow as (Window & {
        app?: {
          logEntries?: unknown;
          showStart?: unknown;
        };
        parallaizeGetStreamState?:
          | (() => { ready?: unknown; status?: unknown } | boolean | null | undefined)
          | undefined;
        webrtc?: {
          peerConnection?: {
            connectionState?: unknown;
            iceConnectionState?: unknown;
          } | null;
        } | null;
      }) | null;
      const sourceDocument = node.contentDocument ?? target?.document ?? null;
      const video = sourceDocument?.querySelector("video");

      const isVideoElement = (candidate: unknown): candidate is HTMLVideoElement => {
        if (!candidate || typeof candidate !== "object") {
          return false;
        }

        if (candidate instanceof HTMLVideoElement) {
          return true;
        }

        const ownerWindow = (candidate as {
          ownerDocument?: {
            defaultView?: (Window & { HTMLVideoElement?: typeof HTMLVideoElement }) | null;
          };
        })
          .ownerDocument?.defaultView;

        return typeof ownerWindow?.HTMLVideoElement === "function" &&
          candidate instanceof ownerWindow.HTMLVideoElement;
      };

      if (!isVideoElement(video)) {
        return null;
      }

      const bridgedState = target?.parallaizeGetStreamState?.();
      const normalizedState =
        typeof bridgedState === "boolean"
          ? {
              ready: bridgedState,
              status: null,
            }
          : bridgedState && typeof bridgedState === "object"
            ? {
                ready: bridgedState.ready === true,
                status: typeof bridgedState.status === "string" ? bridgedState.status : null,
              }
            : {
                ready: false,
                status: null,
              };
      const peerConnection = target?.webrtc?.peerConnection ?? null;

      return {
        currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
        iceConnectionState:
          typeof peerConnection?.iceConnectionState === "string"
            ? peerConnection.iceConnectionState
            : null,
        paused: video.paused,
        peerConnectionState:
          typeof peerConnection?.connectionState === "string"
            ? peerConnection.connectionState
            : null,
        ready: normalizedState.ready,
        readyState: video.readyState,
        recentLogs: Array.isArray(target?.app?.logEntries)
          ? target.app.logEntries
              .filter((entry): entry is string => typeof entry === "string")
              .slice(-8)
          : [],
        showStart: typeof target?.app?.showStart === "boolean" ? target.app.showStart : null,
        status: normalizedState.status,
        videoHeight: video.videoHeight,
        videoWidth: video.videoWidth,
      };
    });
  } catch {
    return null;
  }
}

async function waitForAdvancingSelkiesStage(
  page: Page,
  vmName: string,
  timeoutMs: number,
): Promise<void> {
  const timeoutAt = Date.now() + timeoutMs;
  let lastDiagnostics: SelkiesStageDiagnostics | null = null;
  let lastCurrentTime = Number.NaN;
  let sawAdvance = false;

  while (Date.now() < timeoutAt) {
    const diagnostics = await readSelkiesStageDiagnostics(page, vmName);
    lastDiagnostics = diagnostics;

    if (diagnostics) {
      const normalizedStatus = diagnostics.status?.trim().toLowerCase() ?? "";
      const badStatus =
        normalizedStatus.includes("waiting for stream") ||
        normalizedStatus.includes("reconnecting stream") ||
        normalizedStatus.includes("connection failed");

      if (
        diagnostics.ready &&
        diagnostics.readyState >= 2 &&
        diagnostics.videoWidth >= 320 &&
        diagnostics.videoHeight >= 200 &&
        diagnostics.paused === false &&
        diagnostics.showStart !== true &&
        !badStatus
      ) {
        if (
          Number.isFinite(lastCurrentTime) &&
          diagnostics.currentTime > lastCurrentTime + 0.4
        ) {
          sawAdvance = true;
        }

        lastCurrentTime = diagnostics.currentTime;

        if (sawAdvance) {
          return;
        }
      } else {
        lastCurrentTime = Number.NaN;
        sawAdvance = false;
      }
    }

    await sleep(500);
  }

  throw new Error(
    `Timed out waiting for ${vmName} to resume active Selkies playback: ${JSON.stringify(lastDiagnostics)}`,
  );
}

async function waitForHealthySelkiesStage(
  page: Page,
  baseUrl: string,
  vm: LiveVmTarget,
  timeoutMs: number,
): Promise<void> {
  await openVm(page, vm.name, timeoutMs);
  await waitForVmSelkiesSession(page, baseUrl, vm.id, timeoutMs);
  await waitForStageSelkiesPicture(page, vm.name, timeoutMs);
  await waitForStreamingBadge(page, vm.name, timeoutMs);
  await waitForAdvancingSelkiesStage(page, vm.name, timeoutMs);
}

async function applyRecoveryAction(
  page: Page,
  action: RecoveryAction,
  timeoutMs: number,
): Promise<void> {
  if (action === "none") {
    return;
  }

  const buttonName = action === "kick" ? "Kick stream" : "Reload frame";
  const button = page.getByRole("button", { name: buttonName });

  await button.waitFor({ timeout: timeoutMs });
  await button.click();
}

async function restartServer({
  baseUrl,
  port,
  serverProcess,
  stateFile,
}: {
  baseUrl: string;
  port: number;
  serverProcess: SpawnedServerProcess;
  stateFile: string;
}): Promise<SpawnedServerProcess> {
  await stopServer(serverProcess, baseUrl);
  return await startIncusServer(port, baseUrl, stateFile);
}

async function waitForHttpDown(baseUrl: string, timeoutMs: number): Promise<void> {
  await waitForCondition(
    `${baseUrl} shutdown`,
    async () => {
      try {
        const response = await fetch(new URL("/api/health", baseUrl));
        return !response.ok;
      } catch {
        return true;
      }
    },
    timeoutMs,
    200,
  );
}

function readBaseUrlPort(baseUrl: string): number {
  const port = Number.parseInt(new URL(baseUrl).port, 10);

  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Unable to read a TCP port from ${baseUrl}.`);
  }

  return port;
}

function listPidsListeningOnPort(port: number): number[] {
  const result = spawnSync("lsof", ["-ti", `tcp:${port}`], {
    encoding: "utf8",
  });

  if ((result.status ?? 0) !== 0 && result.stdout.trim().length === 0) {
    return [];
  }

  return result.stdout
    .split(/\s+/)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 0);
}

async function ensurePortReleased(port: number, timeoutMs: number): Promise<void> {
  await waitForCondition(
    `tcp:${port} to stop listening`,
    async () => {
      const pids = listPidsListeningOnPort(port);

      if (pids.length === 0) {
        return true;
      }

      for (const pid of pids) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // Ignore races where a listener dies between lsof and kill.
        }
      }

      await sleep(200);

      const remainingPids = listPidsListeningOnPort(port);

      for (const pid of remainingPids) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Ignore races where a listener dies between lsof and kill.
        }
      }

      return listPidsListeningOnPort(port).length === 0;
    },
    timeoutMs,
    200,
  );
}

function slugifyScenarioName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function waitForStageSelkiesPicture(
  page: Page,
  vmName: string,
  timeoutMs: number,
): Promise<void> {
  await page.locator(`iframe[title="${vmName} desktop"]`).waitFor({
    timeout: timeoutMs,
  });
  await waitForFrameVideoPicture(
    page.frameLocator(`iframe[title="${vmName} desktop"]`),
    `${vmName} stage picture`,
    timeoutMs,
  );
}

async function waitForFrameVideoPicture(
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
          if (
            !(node instanceof HTMLVideoElement) ||
            node.readyState < 2 ||
            node.videoWidth < 320 ||
            node.videoHeight < 200 ||
            node.currentTime < 0.5 ||
            node.paused
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

          try {
            context.drawImage(node, 0, 0, sampleSize, sampleSize);
          } catch {
            return false;
          }

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
    250,
  );
}

async function deleteVm(page: Page, baseUrl: string, vmId: string): Promise<void> {
  await fetchJson(page, baseUrl, `/api/vms/${vmId}/delete`, {
    method: "POST",
  });
}

async function waitForVmDeletion(
  page: Page,
  baseUrl: string,
  vmId: string,
  timeoutMs: number,
): Promise<void> {
  await waitForCondition(
    `VM ${vmId} to delete`,
    async () => {
      const summary = await fetchJson<DashboardSummary>(page, baseUrl, "/api/summary");
      return !summary.vms.some((vm) => vm.id === vmId);
    },
    timeoutMs,
    2_000,
  );
}

async function fetchJson<T>(
  page: Page,
  baseUrl: string,
  path: string,
  init?: {
    body?: string;
    method?: string;
  },
): Promise<T> {
  const headers = await buildAuthHeaders(page, baseUrl);

  if (init?.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(new URL(path, baseUrl), {
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

async function buildAuthHeaders(page: Page, baseUrl: string): Promise<Headers> {
  const cookies = await page.context().cookies(baseUrl);
  const headers = new Headers();

  if (cookies.length > 0) {
    headers.set(
      "cookie",
      cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
    );
  }

  return headers;
}

function resolveLiveTemplate(templates: EnvironmentTemplate[]): EnvironmentTemplate {
  const template =
    templates.find(
      (entry) =>
        entry.defaultDesktopTransport === "selkies" &&
        entry.provenance?.kind === "seed",
    ) ??
    templates.find((entry) => entry.defaultDesktopTransport === "selkies");

  if (!template) {
    throw new Error("No Selkies-capable template is available for the live restart suite.");
  }

  return template;
}

async function waitForHttpOk(baseUrl: string, timeoutMs: number): Promise<void> {
  await waitForCondition(
    `${baseUrl} health check`,
    async () => {
      try {
        const response = await fetch(new URL("/api/health", baseUrl));
        return response.ok;
      } catch {
        return false;
      }
    },
    timeoutMs,
    200,
  );
}

async function waitForStdoutLine(
  serverProcess: SpawnedServerProcess,
  matcher: RegExp,
): Promise<string> {
  let output = "";

  return await new Promise<string>((resolve, reject) => {
    const onStdout = (chunk: Buffer | string) => {
      output += chunk.toString("utf8");

      if (matcher.test(output)) {
        cleanup();
        resolve(output);
      }
    };
    const onStderr = (chunk: Buffer | string) => {
      output += chunk.toString("utf8");
    };
    const onExit = () => {
      cleanup();
      reject(new Error(`Server exited before startup completed.\n${output}`));
    };
    const cleanup = () => {
      serverProcess.stdout.off("data", onStdout);
      serverProcess.stderr.off("data", onStderr);
      serverProcess.off("exit", onExit);
    };

    serverProcess.stdout.on("data", onStdout);
    serverProcess.stderr.on("data", onStderr);
    serverProcess.once("exit", onExit);
  });
}

async function reservePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Failed to reserve an inet port.");
    }

    return address.port;
  } finally {
    server.close();
    await once(server, "close");
  }
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
