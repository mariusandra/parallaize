import assert from "node:assert/strict";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import type { Readable } from "node:stream";
import test from "node:test";

import {
  chromium,
  type Browser,
  type FrameLocator,
  type Locator,
  type Page,
} from "playwright";

type SpawnedServerProcess = ChildProcessByStdio<null, Readable, Readable>;

test("Chromium Playwright dashboard browser integration", async (context) => {
  await context.test("creating a VM yields a live Selkies image end to end", async (subtest) => {
    await withDashboard(subtest, async ({ page }) => {
      const vmName = "selkies-e2e-create";

      await createVm(page, vmName);
      await waitForPreviewDesktop(page, vmName);
    });
  });

  await context.test("all sidebar previews load", async (subtest) => {
    await withDashboard(subtest, async ({ page }) => {
      const vmNames = [
        "selkies-e2e-preview-a",
        "selkies-e2e-preview-b",
      ];

      for (const vmName of vmNames) {
        await createVm(page, vmName);
      }

      for (const vmName of ["alpha-workbench", ...vmNames]) {
        await waitForPreviewDesktop(page, vmName);
      }
    });
  });

  await context.test("opening a VM keeps its sidebar preview active", async (subtest) => {
    await withDashboard(subtest, async ({ page }) => {
      const vmName = "selkies-e2e-active-preview";

      await createVm(page, vmName);
      await openVm(page, vmName);
      await waitForPreviewDesktop(page, vmName);

      const classes = await vmTile(page, vmName).getAttribute("class");
      assert.match(classes ?? "", /\bvm-tile--active\b/);
    });
  });

  await context.test("renaming a Selkies VM keeps dialog focus while typing", async (subtest) => {
    await withDashboard(subtest, async ({ page }) => {
      const vmName = "selkies-e2e-rename-focus";
      const renamedVm = "selkies-e2e-renamed-focus";

      await createVm(page, vmName);

      const sidepanel = page.locator(".workspace-sidepanel");
      await sidepanel.getByRole("button", { name: "Rename" }).click();

      const dialog = page.locator(".dialog-panel");
      await dialog.getByRole("heading", { name: "Rename workspace" }).waitFor();

      const nameField = dialog.getByLabel("Name");
      await nameField.waitFor();
      await nameField.click();
      await page.keyboard.press("Control+A");

      let typedPrefix = "";
      for (const character of renamedVm) {
        await page.keyboard.type(character);
        typedPrefix += character;
        await waitFor(
          `rename dialog keeps focus after typing ${typedPrefix}`,
          async () =>
            (await nameField.inputValue()) === typedPrefix &&
            (await nameField.evaluate((node) => document.activeElement === node)),
        );
      }

      await dialog.getByRole("button", { name: "Save name" }).click();
      await dialog.waitFor({ state: "hidden" });
      await vmTile(page, renamedVm).waitFor();
      await page.locator(".sidepanel-summary__title").getByText(renamedVm).waitFor();
    });
  });

  await context.test("opening a Selkies VM keeps a visible captured preview in the rail", async (subtest) => {
    await withDashboard(subtest, async ({ page }) => {
      const vmName = "selkies-e2e-open-preview-image";

      await createVm(page, vmName);
      const tile = vmTile(page, vmName);

      await waitFor(
        `${vmName} selected tile uses a preview image`,
        async () => (await tile.locator(`img[alt="${vmName} live preview"]`).count()) === 1,
      );
      await waitForPreviewImageLoaded(page, vmName);
      assert.equal(await tile.locator(".vm-tile__preview canvas").count(), 0);
      await tile.getByText("Streaming").waitFor();
    });
  });

  await context.test("Selkies streaming badges follow the actual guest stream state", async (subtest) => {
    await withDashboard(subtest, async ({ page }) => {
      const vmName = "selkies-e2e-stream-state";

      await createVm(page, vmName);
      const tile = vmTile(page, vmName);

      await tile.getByText("Streaming").waitFor();
      await setMockStreamReady(page, vmName, false);
      await waitFor(
        `${vmName} hides the streaming badge while the guest waits for the stream`,
        async () => (await tile.getByText("Streaming").count()) === 0,
      );

      await setMockStreamReady(page, vmName, true);
      await tile.getByText("Streaming").waitFor();
    });
  });

  await context.test("stuck Selkies streams get kicked automatically", async (subtest) => {
    await withDashboard(subtest, async ({ page }) => {
      const vmName = "selkies-e2e-stream-kick";

      await createVm(page, vmName);
      await setMockStreamState(page, vmName, {
        ready: false,
        status: "Connection failed.",
      });

      await waitFor(
        `${vmName} auto-kick restores the Selkies stream`,
        async () =>
          (await mockStreamKickCount(page, vmName)) >= 1 &&
          (await mockStreamReady(page, vmName)) === true,
        6_000,
      );
    });
  });

  await context.test("stuck Selkies streams reload the iframe when a kick cannot recover them", async (subtest) => {
    await withDashboard(subtest, async ({ page }) => {
      const vmName = "selkies-e2e-stream-reload";

      await createVm(page, vmName);
      await requireMockReloadRecovery(page, vmName);

      await waitFor(
        `${vmName} reload recovery restores the Selkies stream`,
        async () =>
          (await mockStreamKickCount(page, vmName)) >= 1 &&
          (await mockStreamReloadCount(page, vmName)) >= 2 &&
          (await mockStreamReady(page, vmName)) === true,
        12_000,
      );
    });
  });

  await context.test("opening a Selkies VM keeps a visible rail preview while the captured image loads", async (subtest) => {
    await withDashboard(subtest, async ({ page }) => {
      const firstVm = "selkies-e2e-preview-handoff-a";
      let previewRequestReleased = false;
      let releasePreviewRequest = (): void => {};
      const previewHold = new Promise<void>((resolve) => {
        releasePreviewRequest = () => {
          if (previewRequestReleased) {
            return;
          }

          previewRequestReleased = true;
          resolve();
        };
      });

      await page.route(`**/api/vms/${firstVm}/preview**`, async (route) => {
        await previewHold;
        await route.continue();
      });

      await createVm(page, firstVm);
      await openVm(page, "alpha-workbench");

      const tile = vmTile(page, firstVm);
      await waitFor(
        `${firstVm} keeps a visible preview after switching away`,
        async () => await tileHasVisiblePreviewSurface(tile),
      );

      await openVm(page, firstVm);
      await waitFor(
        `${firstVm} keeps a visible preview surface while the captured preview waits`,
        async () => await tileHasVisiblePreviewSurface(tile),
      );

      releasePreviewRequest();
      await waitForPreviewImageLoaded(page, firstVm);
      await waitFor(
        `${firstVm} drops the mirrored fallback after the captured preview loads`,
        async () => (await tile.locator(".vm-tile__preview canvas").count()) === 0,
      );
    });
  });

  await context.test("switching away from a Selkies VM keeps its rail preview populated", async (subtest) => {
    await withDashboard(subtest, async ({ page }) => {
      const vmName = "selkies-e2e-preview-handoff-b";
      await createVm(page, vmName);
      const tile = vmTile(page, vmName);
      await waitForPreviewImageLoaded(page, vmName);

      await openVm(page, "alpha-workbench");
      await waitFor(
        `${vmName} keeps visible preview content after switching away`,
        async () => await tilePreviewHasVisibleContent(tile),
      );
      assert.equal(await tile.locator(`img[alt="${vmName} live preview"]`).count(), 1);
      assert.equal(await tile.locator(".vm-tile__preview canvas").count(), 0);
    });
  });

  await context.test("Selkies hides paste-local when browser clipboard APIs are available", async (subtest) => {
    await withDashboard(subtest, async ({ page }) => {
      const vmName = "selkies-e2e-clipboard-available";

      await overrideBrowserClipboard(page, {
        readText: "host clipboard text",
        writeBlocked: true,
      });
      await createVm(page, vmName);

      await waitFor(
        `${vmName} hides the manual paste button while browser clipboard APIs are available`,
        async () => (await page.getByRole("button", { name: "Paste local" }).count()) === 0,
      );
    });
  });

  await context.test("Selkies clipboard controls fall back when browser clipboard APIs are unavailable", async (subtest) => {
    await withDashboard(subtest, async ({ page }) => {
      const vmName = "selkies-e2e-clipboard";

      await overrideBrowserClipboard(page, {
        available: false,
      });
      await createVm(page, vmName);

      await setMockGuestClipboard(page, vmName, "guest clipboard text");
      await page.getByRole("button", { name: "Copy guest" }).waitFor();
      await page.getByText("Guest clipboard is ready. Automatic browser copy was blocked.").waitFor();

      await page.getByRole("button", { name: "Paste local" }).click();
      await page.getByText(/Press (Ctrl|Cmd)\+V in the field below and it will be sent to the guest\./).waitFor();
      const manualPasteField = page.getByLabel("Paste local text");
      await manualPasteField.waitFor();
      await manualPasteField.fill("manual host clipboard text");
      await page.getByRole("button", { name: "Send to guest" }).click();
      await waitFor(
        `${vmName} receives pasted host text through the manual shortcut fallback`,
        async () => (await sessionNoteValue(page, vmName)) === "manual host clipboard text",
      );
    });
  });

  await context.test("Selkies viewport scale defaults high-DPI browsers back to DPR 1", async (subtest) => {
    await withDashboard(subtest, async ({ page }) => {
      const vmName = "selkies-e2e-scale";

      await createVm(page, vmName);

      await waitFor(
        `${vmName} normalizes the mock stream scale back to DPR 1`,
        async () => (await mockStreamScale(page, vmName)) === "1",
      );
      await waitFor(
        `${vmName} marks the stream as pixelated while the browser upscales it`,
        async () => (await mockStreamPixelated(page, vmName)) === true,
      );
    }, {
      deviceScaleFactor: 2,
      viewport: {
        width: 1600,
        height: 1000,
      },
    });
  });

  await context.test("active Selkies sessions stop focus handoff churn after activation", async (subtest) => {
    await withDashboard(subtest, async ({ page }) => {
      const vmName = "selkies-e2e-focus-stable";

      await createVm(page, vmName);
      await page.waitForTimeout(300);
      const settledFocusHandoffCount = await mockFocusHandoffCallCount(page, vmName);

      await page.waitForTimeout(300);
      assert.equal(
        await mockFocusHandoffCallCount(page, vmName),
        settledFocusHandoffCount,
      );
    });
  });

  await context.test("switching between differently scaled Selkies VMs reuses the cached stream scale", async (subtest) => {
    await withDashboard(subtest, async ({ page }) => {
      const firstVm = "selkies-e2e-scale-cache-a";
      const secondVm = "selkies-e2e-scale-cache-b";

      await createVm(page, firstVm);
      await setSelkiesStreamScale(page, 1.25);
      await waitFor(
        `${firstVm} adopts the requested cached stream scale`,
        async () => (await mockStreamScale(page, firstVm)) === "1.25",
      );
      const firstScaleUpdateCount = await mockStreamScaleUpdateCount(page, firstVm);

      await createVm(page, secondVm);
      await setSelkiesStreamScale(page, 1.75);
      await waitFor(
        `${secondVm} adopts the requested cached stream scale`,
        async () => (await mockStreamScale(page, secondVm)) === "1.75",
      );
      const secondScaleUpdateCount = await mockStreamScaleUpdateCount(page, secondVm);

      await openVm(page, firstVm);
      await waitFor(
        `${firstVm} resumes at its existing stream scale`,
        async () => (await mockStreamScale(page, firstVm)) === "1.25",
      );
      await page.waitForTimeout(400);
      assert.equal(await mockStreamScaleUpdateCount(page, firstVm), firstScaleUpdateCount);

      await openVm(page, secondVm);
      await waitFor(
        `${secondVm} resumes at its existing stream scale`,
        async () => (await mockStreamScale(page, secondVm)) === "1.75",
      );
      await page.waitForTimeout(400);
      assert.equal(await mockStreamScaleUpdateCount(page, secondVm), secondScaleUpdateCount);
    });
  });

  await context.test("switching between Selkies VMs flips cached sessions into background mode", async (subtest) => {
    await withDashboard(subtest, async ({ page }) => {
      const firstVm = "selkies-e2e-background-a";
      const secondVm = "selkies-e2e-background-b";

      await createVm(page, firstVm);
      await waitForStageBackgroundMode(page, firstVm, false);

      await createVm(page, secondVm);
      await waitForStageBackgroundMode(page, firstVm, true);
      await waitForStageBackgroundMode(page, secondVm, false);

      await openVm(page, firstVm);
      await waitForStageBackgroundMode(page, firstVm, false);
      await waitForStageBackgroundMode(page, secondVm, true);
    });
  });

  await context.test("switching between VMs resumes their browser sessions", async (subtest) => {
    await withDashboard(subtest, async ({ page }) => {
      const firstVm = "selkies-e2e-resume-a";
      const secondVm = "selkies-e2e-resume-b";

      await createVm(page, firstVm);
      await setSessionNote(page, firstVm, "resume alpha");

      await createVm(page, secondVm);
      await setSessionNote(page, secondVm, "resume bravo");

      await openVm(page, firstVm);
      assert.equal(await sessionNoteValue(page, firstVm), "resume alpha");

      await openVm(page, secondVm);
      assert.equal(await sessionNoteValue(page, secondVm), "resume bravo");
      await waitForPreviewDesktop(page, firstVm);
      await waitForPreviewDesktop(page, secondVm);
      assert.equal(await page.locator(`iframe[title="${firstVm} desktop"]`).count(), 1);

      await openVm(page, firstVm);
      assert.equal(await sessionNoteValue(page, firstVm), "resume alpha");
      await waitForPreviewDesktop(page, firstVm);
      await waitForPreviewDesktop(page, secondVm);
    });
  });

  await context.test("hidden cached sessions keep their own viewport width", async (subtest) => {
    await withDashboard(subtest, async ({ page }) => {
      const firstVm = "selkies-e2e-width-a";
      const secondVm = "selkies-e2e-width-b";

      await createVm(page, firstVm);
      const firstWidth = await stageDesktopWidth(page, firstVm);

      await createVm(page, secondVm);
      await page.getByLabel("Hide inspector").click();

      await waitFor(
        `${secondVm} wider stage after inspector collapse`,
        async () => (await stageDesktopWidth(page, secondVm)) > firstWidth + 40,
      );

      await waitFor(
        `${firstVm} hidden stage width stays pinned`,
        async () => Math.abs((await stageDesktopWidth(page, firstVm)) - firstWidth) <= 1,
      );
    });
  });

  await context.test("hidden cached sessions relinquish when another tab opens them", async (subtest) => {
    await withDashboard(subtest, async ({ browserContext, page, port }) => {
      const firstVm = "selkies-e2e-hidden-handoff-a";
      const secondVm = "selkies-e2e-hidden-handoff-b";
      const secondaryPage = await browserContext.newPage();

      try {
        await createVm(page, firstVm);
        await setSessionNote(page, firstVm, "hidden handoff alpha");

        await createVm(page, secondVm);
        await openVm(page, secondVm);
        await waitForPreviewDesktop(page, firstVm);
        assert.equal(await page.locator(`iframe[title="${firstVm} desktop"]`).count(), 1);

        await secondaryPage.goto(`http://127.0.0.1:${port}/`, {
          waitUntil: "domcontentloaded",
        });
        await secondaryPage.getByRole("button", { name: "New VM" }).waitFor();
        await openVm(secondaryPage, firstVm);
        assert.equal(await sessionNoteValue(secondaryPage, firstVm), "hidden handoff alpha");

        await waitFor(
          `${firstVm} cache removal after foreign claim`,
          async () => (await page.locator(`iframe[title="${firstVm} desktop"]`).count()) === 0,
        );

        await openVm(page, firstVm);
        assert.equal(await sessionNoteValue(page, firstVm), "hidden handoff alpha");

        await secondaryPage.getByRole("heading", { name: "Opened in another tab" }).waitFor();
      } finally {
        await secondaryPage.close();
      }
    });
  });

  await context.test("opening the same VM in another tab hands off the session cleanly", async (subtest) => {
    await withDashboard(subtest, async ({ browserContext, page, port }) => {
      const vmName = "selkies-e2e-handoff";
      const secondaryPage = await browserContext.newPage();

      try {
        await createVm(page, vmName);
        await setSessionNote(page, vmName, "handoff alpha");

        await secondaryPage.goto(`http://127.0.0.1:${port}/`, {
          waitUntil: "domcontentloaded",
        });
        await secondaryPage.getByRole("button", { name: "New VM" }).waitFor();
        await openVm(secondaryPage, vmName);
        assert.equal(await sessionNoteValue(secondaryPage, vmName), "handoff alpha");

        await page.getByRole("heading", { name: "Opened in another tab" }).waitFor();
        await waitFor(
          `${vmName} iframe removal after active handoff`,
          async () => (await page.locator(`iframe[title="${vmName} desktop"]`).count()) === 0,
        );

        await page.getByRole("button", { name: "Reconnect here" }).click();
        assert.equal(await sessionNoteValue(page, vmName), "handoff alpha");

        await secondaryPage.getByRole("heading", { name: "Opened in another tab" }).waitFor();
      } finally {
        await secondaryPage.close();
      }
    });
  });
});

async function withDashboard(
  context: test.TestContext,
  run: (options: {
    browserContext: Awaited<ReturnType<Browser["newContext"]>>;
    page: Page;
    port: number;
  }) => Promise<void>,
  browserContextOptions?: Parameters<Browser["newContext"]>[0],
): Promise<void> {
  const { port } = await startServer(context, {
    extraEnv: {
      PARALLAIZE_MOCK_DESKTOP_TRANSPORT: "selkies",
    },
    tempDirPrefix: "parallaize-playwright-",
  });
  const browser = await launchChromium(context);
  const browserContext = await browser.newContext({
    ...browserContextOptions,
    viewport: browserContextOptions?.viewport ?? {
      width: 1600,
      height: 1000,
    },
  });

  context.after(async () => {
    await browserContext.close();
  });

  const page = await browserContext.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("button", { name: "New VM" }).waitFor();
  await vmTile(page, "alpha-workbench").waitFor();

  await run({
    browserContext,
    page,
    port,
  });
}

async function createVm(page: Page, vmName: string): Promise<void> {
  await page.getByRole("button", { name: "New VM" }).click();

  const dialog = page.locator(".dialog-panel");
  await dialog.getByRole("heading", { name: "Launch a VM" }).waitFor();
  await dialog.getByLabel("Name").fill(vmName);
  await dialog.getByRole("button", { name: "Queue workspace" }).click();
  await dialog.waitFor({ state: "hidden" });

  await waitForStageDesktop(page, vmName);
}

async function openVm(page: Page, vmName: string): Promise<void> {
  const tile = vmTile(page, vmName);

  await tile.scrollIntoViewIfNeeded();
  await tile.locator("button.vm-tile__open").click();
  await waitForStageDesktop(page, vmName);
}

async function setSessionNote(
  page: Page,
  vmName: string,
  value: string,
): Promise<void> {
  const frame = stageDesktopFrame(page, vmName);
  const noteField = frame.getByLabel("Session note");

  await noteField.waitFor();
  await noteField.fill(value);

  await waitFor(
    `session note for ${vmName}`,
    async () => (await noteField.inputValue()) === value,
  );
}

async function setMockGuestClipboard(
  page: Page,
  vmName: string,
  value: string,
): Promise<void> {
  const frame = page.locator(`iframe[title="${vmName} desktop"]`).first();
  await frame.waitFor();
  await frame.evaluate((node, clipboardText) => {
    const target = (node as HTMLIFrameElement).contentWindow as (Window & {
      parallaizeRequestGuestClipboard?: () => boolean;
      parallaizeWriteGuestClipboard?: (text: string) => boolean;
    }) | null;

    target?.parallaizeWriteGuestClipboard?.(clipboardText);
    target?.parallaizeRequestGuestClipboard?.();
  }, value);
}

async function setMockStreamReady(
  page: Page,
  vmName: string,
  ready: boolean,
): Promise<void> {
  const frame = page.locator(`iframe[title="${vmName} desktop"]`).first();
  await frame.waitFor();
  await frame.evaluate((node, streamReady) => {
    const target = (node as HTMLIFrameElement).contentWindow as (Window & {
      parallaizeSetStreamReady?: (ready: boolean) => void;
    }) | null;

    target?.parallaizeSetStreamReady?.(streamReady);
  }, ready);
}

async function setMockStreamState(
  page: Page,
  vmName: string,
  {
    ready,
    status,
  }: {
    ready: boolean;
    status: string;
  },
): Promise<void> {
  const frame = page.locator(`iframe[title="${vmName} desktop"]`).first();
  await frame.waitFor();
  await frame.evaluate((node, nextState) => {
    const target = (node as HTMLIFrameElement).contentWindow as (Window & {
      parallaizeSetStreamReady?: (ready: boolean) => void;
      parallaizeSetStreamStatus?: (status: string) => void;
    }) | null;

    target?.parallaizeSetStreamReady?.(nextState.ready);
    target?.parallaizeSetStreamStatus?.(nextState.status);
  }, {
    ready,
    status,
  });
}

async function mockStreamReady(page: Page, vmName: string): Promise<boolean> {
  const frame = page.locator(`iframe[title="${vmName} desktop"]`).first();
  await frame.waitFor();
  return await frame.evaluate((node) => {
    const target = (node as HTMLIFrameElement).contentWindow as (Window & {
      parallaizeGetStreamState?: () => {
        ready?: boolean;
      };
    }) | null;

    return target?.parallaizeGetStreamState?.().ready === true;
  });
}

async function mockStreamKickCount(page: Page, vmName: string): Promise<number> {
  const frame = page.locator(`iframe[title="${vmName} desktop"]`).first();
  await frame.waitFor();
  return await frame.evaluate((node) => {
    const target = (node as HTMLIFrameElement).contentWindow as (Window & {
      parallaizeGetKickCount?: () => number;
    }) | null;

    return target?.parallaizeGetKickCount?.() ?? 0;
  });
}

async function requireMockReloadRecovery(
  page: Page,
  vmName: string,
): Promise<void> {
  const frame = page.locator(`iframe[title="${vmName} desktop"]`).first();
  await frame.waitFor();
  await frame.evaluate((node) => {
    const target = (node as HTMLIFrameElement).contentWindow as (Window & {
      parallaizeRequireReloadRecovery?: () => boolean;
    }) | null;

    target?.parallaizeRequireReloadRecovery?.();
  });
}

async function mockStreamReloadCount(page: Page, vmName: string): Promise<number> {
  const frame = page.locator(`iframe[title="${vmName} desktop"]`).first();
  await frame.waitFor();
  return await frame.evaluate((node) => {
    const target = (node as HTMLIFrameElement).contentWindow as (Window & {
      parallaizeGetReloadCount?: () => number;
    }) | null;

    return target?.parallaizeGetReloadCount?.() ?? 0;
  });
}

async function mockStreamScale(page: Page, vmName: string): Promise<string> {
  const shell = stageDesktopFrame(page, vmName).locator("main.mock-selkies");
  await shell.waitFor();
  return await shell.evaluate((node) => {
    return node instanceof HTMLElement ? node.dataset.streamScale ?? "" : "";
  });
}

async function mockStreamPixelated(page: Page, vmName: string): Promise<boolean> {
  const shell = stageDesktopFrame(page, vmName).locator("main.mock-selkies");
  await shell.waitFor();
  return await shell.evaluate((node) => {
    return node instanceof HTMLElement && node.dataset.streamPixelated === "true";
  });
}

async function mockStreamScaleUpdateCount(page: Page, vmName: string): Promise<number> {
  const shell = stageDesktopFrame(page, vmName).locator("main.mock-selkies");
  await shell.waitFor();
  return await shell.evaluate((node) => {
    if (!(node instanceof HTMLElement)) {
      return 0;
    }

    return Number(node.dataset.streamScaleUpdates ?? "0");
  });
}

async function mockFocusHandoffCallCount(page: Page, vmName: string): Promise<number> {
  const shell = stageDesktopFrame(page, vmName).locator("main.mock-selkies");
  await shell.waitFor();
  return await shell.evaluate((node) => {
    if (!(node instanceof HTMLElement)) {
      return 0;
    }

    return Number(node.dataset.focusHandoffCalls ?? "0");
  });
}

async function sessionNoteValue(page: Page, vmName: string): Promise<string> {
  const noteField = stageDesktopFrame(page, vmName).getByLabel("Session note");
  await noteField.waitFor();
  return await noteField.inputValue();
}

async function setSelkiesStreamScale(page: Page, scale: number): Promise<void> {
  const streamScaleInput = page.locator(".workspace-sidepanel").getByLabel("Stream scale");
  await streamScaleInput.waitFor();
  await streamScaleInput.focus();

  const currentScale = Number(await streamScaleInput.inputValue());
  const stepDelta = Math.round((scale - currentScale) / 0.25);

  if (stepDelta === 0) {
    return;
  }

  const key = stepDelta > 0 ? "ArrowRight" : "ArrowLeft";
  for (let index = 0; index < Math.abs(stepDelta); index += 1) {
    await page.keyboard.press(key);
  }
}

async function overrideBrowserClipboard(
  page: Page,
  {
    available = true,
    readBlocked = false,
    readText = "",
    writeBlocked = false,
  }: {
    available?: boolean;
    readBlocked?: boolean;
    readText?: string;
    writeBlocked?: boolean;
  },
): Promise<void> {
  await page.evaluate(
    ({ nextAvailable, nextReadBlocked, nextReadText, nextWriteBlocked }) => {
      if (!nextAvailable) {
        Object.defineProperty(window.navigator, "clipboard", {
          configurable: true,
          value: undefined,
        });
        return;
      }

      const clipboard = {
        readText: async () => {
          if (nextReadBlocked) {
            throw new Error("browser clipboard read blocked");
          }

          return nextReadText;
        },
        writeText: async () => {
          if (nextWriteBlocked) {
            throw new Error("browser clipboard write blocked");
          }
        },
      };

      Object.defineProperty(window.navigator, "clipboard", {
        configurable: true,
        value: clipboard,
      });
    },
    {
      nextAvailable: available,
      nextReadBlocked: readBlocked,
      nextReadText: readText,
      nextWriteBlocked: writeBlocked,
    },
  );
}

async function stageDesktopWidth(page: Page, vmName: string): Promise<number> {
  const frame = page.locator(`iframe[title="${vmName} desktop"]`).first();
  await frame.waitFor();
  return await frame.evaluate((node) => Math.round(node.getBoundingClientRect().width));
}

async function waitForStageDesktop(page: Page, vmName: string): Promise<void> {
  const frame = stageDesktopFrame(page, vmName);

  await page.locator(`iframe[title="${vmName} desktop"]`).waitFor();
  await waitForMockSelkiesFrame(frame, vmName, false);
}

async function waitForPreviewDesktop(page: Page, vmName: string): Promise<void> {
  const tile = vmTile(page, vmName);
  await tile.scrollIntoViewIfNeeded();

  if ((await page.locator(`iframe[title="${vmName} live preview"]`).count()) > 0) {
    await waitForMockSelkiesFrame(previewDesktopFrame(page, vmName), vmName, true);
    return;
  }

  if ((await tile.locator(`img[alt="${vmName} live preview"]`).count()) > 0) {
    await waitForPreviewImageLoaded(page, vmName);
    return;
  }

  await waitForMirroredPreviewCanvas(page, vmName);
}

async function waitForMockSelkiesFrame(
  frame: FrameLocator,
  vmName: string,
  preview: boolean,
): Promise<void> {
  await frame.getByText(preview ? "Preview stream" : "Live desktop").waitFor();
  await frame.getByText("Mock Selkies browser session").waitFor();

  const image = frame.getByRole("img", {
    name: `${vmName} desktop image`,
  });

  await image.waitFor();
  await waitForImageLoaded(image);
}

async function waitForImageLoaded(image: Locator): Promise<void> {
  await waitFor("desktop image to finish loading", async () => {
    return await image.evaluate((node) => {
      return node instanceof HTMLImageElement &&
        node.complete &&
        node.naturalWidth > 0;
    });
  });
}

async function waitForPreviewImageLoaded(page: Page, vmName: string): Promise<void> {
  const image = vmTile(page, vmName).locator(`img[alt="${vmName} live preview"]`).first();

  await image.waitFor();
  await waitForImageLoaded(image);
}

async function tileHasVisiblePreviewSurface(tile: Locator): Promise<boolean> {
  return await tile.locator(".vm-tile__preview").evaluate((node) => {
    if (!(node instanceof HTMLElement)) {
      return false;
    }

    const canvas = node.querySelector("canvas");

    if (canvas instanceof HTMLCanvasElement) {
      return true;
    }

    const image = node.querySelector("img");
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
  });
}

async function tilePreviewHasVisibleContent(tile: Locator): Promise<boolean> {
  return await tile.locator(".vm-tile__preview").evaluate((node) => {
    if (!(node instanceof HTMLElement)) {
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

    const canvas = node.querySelector("canvas");

    if (canvas instanceof HTMLCanvasElement) {
      if (canvas.width <= 0 || canvas.height <= 0) {
        return false;
      }

      context.drawImage(canvas, 0, 0, sampleSize, sampleSize);
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
    }

    const image = node.querySelector("img");

    if (
      image instanceof HTMLImageElement &&
      image.complete &&
      image.naturalWidth > 0 &&
      image.naturalHeight > 0
    ) {
      context.drawImage(image, 0, 0, sampleSize, sampleSize);
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
    }

    return false;
  });
}

async function waitForMirroredPreviewCanvas(page: Page, vmName: string): Promise<void> {
  const canvas = vmTile(page, vmName).locator(".vm-tile__preview canvas").first();

  await canvas.waitFor();
  await waitFor(`mirrored preview canvas for ${vmName}`, async () => {
    return await canvas.evaluate((node) => {
      return node instanceof HTMLCanvasElement &&
        node.width > 0 &&
        node.height > 0;
    });
  });
}

async function waitForStageBackgroundMode(
  page: Page,
  vmName: string,
  background: boolean,
): Promise<void> {
  const stageShell = stageDesktopFrame(page, vmName).locator("main.mock-selkies");

  await stageShell.waitFor();
  await waitFor(
    `${vmName} background mode ${background ? "enabled" : "disabled"}`,
    async () => {
      return await stageShell.evaluate((node, expected) => {
        return node instanceof HTMLElement &&
          node.dataset.backgroundMode === (expected ? "true" : "false");
      }, background);
    },
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

function stageDesktopFrame(page: Page, vmName: string): FrameLocator {
  return page.frameLocator(`iframe[title="${vmName} desktop"]`);
}

function previewDesktopFrame(page: Page, vmName: string): FrameLocator {
  return page.frameLocator(`iframe[title="${vmName} live preview"]`);
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

async function startServer(
  context: test.TestContext,
  {
    tempDirPrefix,
    extraEnv,
  }: {
    tempDirPrefix: string;
    extraEnv?: Record<string, string>;
  },
): Promise<{
  port: number;
  serverProcess: SpawnedServerProcess;
}> {
  const tempDir = mkdtempSync(join(tmpdir(), tempDirPrefix));
  const port = await reservePort();
  const serverProcess = spawn(process.execPath, ["dist/apps/control/src/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      PARALLAIZE_PROVIDER: "mock",
      PARALLAIZE_DATA_FILE: join(tempDir, "state.json"),
      PARALLAIZE_ADMIN_PASSWORD: "",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  context.after(async () => {
    if (serverProcess.exitCode === null && serverProcess.signalCode === null) {
      serverProcess.kill("SIGKILL");
      await once(serverProcess, "exit");
    }

    rmSync(tempDir, { recursive: true, force: true });
  });

  await waitForStdoutLine(
    serverProcess,
    /parallaize listening on http:\/\/127\.0\.0\.1:/,
  );

  return {
    port,
    serverProcess,
  };
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

async function waitFor(
  description: string,
  check: () => Promise<boolean>,
  timeoutMs = 8_000,
): Promise<void> {
  const timeoutAt = Date.now() + timeoutMs;

  while (Date.now() < timeoutAt) {
    if (await check()) {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
  }

  throw new Error(`Timed out waiting for ${description}.`);
}
