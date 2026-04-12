import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CloneVmDialog } from "../apps/web/src/dashboardDialogs.js";
import type { CloneVmDialogState } from "../apps/web/src/dashboardShell.js";

function buildCloneDialogState(overrides: Partial<CloneVmDialogState> = {}): CloneVmDialogState {
  return {
    canCaptureRam: true,
    ramMb: 8192,
    sourceVmId: "vm-1",
    sourceVmName: "alpha",
    sourceVmStatus: "running",
    stateful: true,
    wallpaperName: "alpha-clone",
    ...overrides,
  };
}

test("CloneVmDialog hides RAM copy for stopped VMs", () => {
  const html = renderToStaticMarkup(
    createElement(CloneVmDialog, {
      busy: false,
      dialog: buildCloneDialogState({
        canCaptureRam: false,
        sourceVmStatus: "stopped",
        stateful: false,
      }),
      draft: "alpha-clone",
      onClose: () => {},
      onDraftChange: () => {},
      onStatefulChange: () => {},
      onSubmit: async () => {},
    }),
  );

  assert.doesNotMatch(html, /Include RAM for instant resume/);
  assert.doesNotMatch(html, /Keep RAM enabled when you want the fork to resume open apps and terminals\./);
});

test("CloneVmDialog shows RAM copy for running VMs", () => {
  const html = renderToStaticMarkup(
    createElement(CloneVmDialog, {
      busy: false,
      dialog: buildCloneDialogState(),
      draft: "alpha-clone",
      onClose: () => {},
      onDraftChange: () => {},
      onStatefulChange: () => {},
      onSubmit: async () => {},
    }),
  );

  assert.match(html, /Include RAM for instant resume/);
  assert.match(html, /Keep RAM enabled when you want the fork to resume open apps and terminals\./);
});
