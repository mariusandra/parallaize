import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const releaseNotesModule = await import(pathToFileURL(resolve(process.cwd(), "scripts/generate-release-notes.mjs")).href);

test("release tag helpers sort plain and package-suffixed tags correctly", () => {
  assert.deepEqual(releaseNotesModule.parseReleaseTag("v0.1.8"), {
    raw: "v0.1.8",
    version: "0.1.8",
    packageRelease: 1,
  });
  assert.deepEqual(releaseNotesModule.parseReleaseTag("v0.1.8-2"), {
    raw: "v0.1.8-2",
    version: "0.1.8",
    packageRelease: 2,
  });
  assert.equal(releaseNotesModule.compareReleaseTags("v0.1.8", "v0.1.8-2"), -1);
  assert.equal(
    releaseNotesModule.findPreviousReleaseTagFromList(["v0.1.7", "v0.1.8", "v0.1.8-2"], "v0.1.9"),
    "v0.1.8-2",
  );
});

test("commit batching respects both commit-count and text-size limits", () => {
  const commits = [
    {
      shortSha: "1111111",
      subject: "feat: expand network validation",
      author: "Marius",
      date: "2026-03-27",
      files: ["apps/control/src/network.ts", "tests/network.test.ts"],
      areas: ["Control plane and API", "Test coverage"],
    },
    {
      shortSha: "2222222",
      subject: "fix: keep packaged env vars in sync",
      author: "Marius",
      date: "2026-03-27",
      files: ["packaging/config/parallaize.env", "docs/packaging.md"],
      areas: ["Debian packaging", "Documentation"],
    },
    {
      shortSha: "3333333",
      subject: "docs: capture deployment caveats for live hosts",
      author: "Marius",
      date: "2026-03-27",
      files: ["docs/live-incus-setup.md"],
      areas: ["Documentation"],
    },
  ];

  const batches = releaseNotesModule.createCommitBatches(commits, {
    maxCommitsPerBatch: 2,
    maxBatchChars: 210,
  });

  assert.equal(batches.length, 3);
  assert.deepEqual(
    batches.map((batch: { commits: Array<{ shortSha: string }> }) => batch.commits.map((commit) => commit.shortSha)),
    [["1111111"], ["2222222"], ["3333333"]],
  );
  assert.match(batches[0].promptText, /apps\/control\/src\/network\.ts/);
});

test("fallback release notes include scope, compare link, and commit reference details", () => {
  const body = releaseNotesModule.formatFallbackReleaseNotes({
    releaseVersion: "0.1.9",
    packageRelease: "2",
    releaseTag: "v0.1.9-2",
    previousTag: "v0.1.8",
    compareUrl: "https://github.com/example/parallaize/compare/v0.1.8...v0.1.9-2",
    commits: [
      {
        shortSha: "1111111",
        subject: "feat: expand network validation",
        author: "Marius",
        date: "2026-03-27",
      },
      {
        shortSha: "2222222",
        subject: "fix: keep packaged env vars in sync",
        author: "Marius",
        date: "2026-03-27",
      },
    ],
    diffStats: {
      filesChanged: 4,
      insertions: 44,
      deletions: 11,
    },
    changedFiles: [
      { status: "M", path: "apps/control/src/network.ts" },
      { status: "A", path: "tests/network.test.ts" },
      { status: "M", path: "packaging/config/parallaize.env" },
      { status: "R100", path: "docs/packaging.md", previousPath: "docs/notes.md" },
    ],
    topAreas: [
      { label: "Control plane and API", fileCount: 2, churn: 4 },
      { label: "Debian packaging", fileCount: 1, churn: 2 },
    ],
    topFiles: [
      { path: "apps/control/src/network.ts", additions: 21, deletions: 4, churn: 25 },
      { path: "tests/network.test.ts", additions: 12, deletions: 1, churn: 13 },
    ],
  });

  assert.match(body, /^## Highlights/m);
  assert.match(body, /^## Release Scope/m);
  assert.match(body, /^## Full Compare/m);
  assert.match(body, /^## Commit Reference/m);
  assert.match(body, /v0\.1\.9-2/);
  assert.match(body, /apps\/control\/src\/network\.ts/);
});

test("response text extraction reads output_text content from responses payloads", () => {
  const text = releaseNotesModule.extractResponseText({
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "## Highlights\n- Example release note",
          },
        ],
      },
    ],
  });

  assert.equal(text, "## Highlights\n- Example release note");
});
