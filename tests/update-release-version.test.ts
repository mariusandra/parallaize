import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const releaseVersionModule = await import(
  pathToFileURL(resolve(process.cwd(), "scripts/update-release-version.mjs")).href,
);

test("release version updater rewrites docs metadata alongside artifact references", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "parallaize-release-version-"));
  const docsDir = join(tempRoot, "docs");

  try {
    await mkdir(docsDir, { recursive: true });
    await writeFile(
      join(tempRoot, "package.json"),
      `${JSON.stringify({
        name: "parallaize",
        version: "0.1.8",
        private: true,
      }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      join(docsDir, "index.html"),
      "Download parallaize_0.1.8-1_amd64.deb and parallaize_0.1.8-1_arm64.deb\n",
      "utf8",
    );
    await writeFile(
      join(docsDir, "packaging.md"),
      [
        "sudo apt install ./parallaize_0.1.8-1_amd64.deb",
        "curl -fLo /tmp/parallaize_0.1.8-1_amd64.deb https://archive.parallaize.com/packages/parallaize_0.1.8-1_amd64.deb",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await releaseVersionModule.updateManagedReleaseFiles({
      rootDir: tempRoot,
      versionInput: "0.1.9",
      packageReleaseInput: "2",
    });

    assert.deepEqual(result.changedFiles.sort(), [
      "docs/index.html",
      "docs/latest.json",
      "docs/packaging.md",
      "package.json",
    ]);

    const packageJson = JSON.parse(await readFile(join(tempRoot, "package.json"), "utf8"));
    assert.equal(packageJson.version, "0.1.9");

    const indexContents = await readFile(join(docsDir, "index.html"), "utf8");
    assert.match(indexContents, /parallaize_0\.1\.9-2_amd64\.deb/);
    assert.match(indexContents, /parallaize_0\.1\.9-2_arm64\.deb/);

    const packagingContents = await readFile(join(docsDir, "packaging.md"), "utf8");
    assert.match(packagingContents, /parallaize_0\.1\.9-2_amd64\.deb/);

    const latestMetadata = JSON.parse(await readFile(join(docsDir, "latest.json"), "utf8"));
    assert.deepEqual(latestMetadata, {
      version: "0.1.9",
      packageRelease: "2",
      packageLabel: "0.1.9-2",
    });
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});
