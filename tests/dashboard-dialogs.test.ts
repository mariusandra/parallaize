import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CloneVmDialog,
  CreateProjectDialog,
} from "../apps/web/src/dashboardDialogs.js";
import type {
  CloneVmDialogState,
  ProjectDraft,
} from "../apps/web/src/dashboardShell.js";

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

test("CreateProjectDialog asks for a name and GitHub URL", () => {
  const draft: ProjectDraft = {
    name: "Client Alpha",
    githubUrl: "",
  };
  const html = renderToStaticMarkup(
    createElement(CreateProjectDialog, {
      busy: false,
      currentProject: null,
      draft,
      mode: "create",
      onClose: () => {},
      onFieldChange: () => {},
      onSubmit: async () => {},
    }),
  );

  assert.match(html, /Create project/);
  assert.match(html, /GitHub URL \(optional\)/);
  assert.match(html, /https:\/\/github\.com\/org\/repo/);
  assert.doesNotMatch(html, /<button[^>]*disabled[^>]*>Create project<\/button>/);
});

test("CreateProjectDialog disables save when editing without changes", () => {
  const draft: ProjectDraft = {
    name: "Client Alpha",
    githubUrl: "https://github.com/openai/openai",
  };
  const html = renderToStaticMarkup(
    createElement(CreateProjectDialog, {
      busy: false,
      currentProject: draft,
      draft,
      mode: "edit",
      onClose: () => {},
      onFieldChange: () => {},
      onSubmit: async () => {},
    }),
  );

  assert.match(html, /Edit project/);
  assert.match(html, /Save project/);
  assert.match(html, /<button[^>]*disabled[^>]*>Save project<\/button>/);
});
