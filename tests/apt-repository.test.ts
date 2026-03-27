import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const aptRepositoryModule = await import(
  pathToFileURL(resolve(process.cwd(), "scripts/build-apt-repo.mjs")).href
);

test("APT repo builder writes Ubuntu noble metadata and source-list examples", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "parallaize-apt-repo-"));
  const packageDir = join(tempRoot, "package-input");
  const buildDir = join(tempRoot, "build");
  const debRootDir = join(tempRoot, "deb-root");
  const controlDir = join(debRootDir, "DEBIAN");
  const debPath = join(packageDir, "parallaize_0.1.8-1_amd64.deb");

  try {
    await mkdir(controlDir, { recursive: true });
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      join(controlDir, "control"),
      [
        "Package: parallaize",
        "Version: 0.1.8-1",
        "Section: admin",
        "Priority: optional",
        "Architecture: amd64",
        "Maintainer: Test Maintainer <maintainers@parallaize.invalid>",
        "Depends: bash",
        "Description: Test package",
        " Test package for apt archive metadata generation.",
        "",
      ].join("\n"),
      "utf8",
    );

    const buildResult = spawnSync("dpkg-deb", ["--build", debRootDir, debPath], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    assert.equal(buildResult.status, 0);

    const summary = await aptRepositoryModule.buildAptRepository({
      debDir: packageDir,
      outputDir: buildDir,
      suite: "noble",
      codename: "noble",
      component: "main",
      architectures: ["amd64"],
      origin: "Parallaize",
      label: "Parallaize",
      description: "Parallaize Ubuntu 24.04 APT archive",
      baseUrl: "https://archive.parallaize.com/apt",
      signedByPath: "/etc/apt/keyrings/parallaize-archive-keyring.gpg",
      signingKeyId: null,
    });

    assert.equal(summary.signed, false);
    assert.equal(summary.packages.length, 1);
    assert.equal(summary.packages[0].poolPath, "pool/main/p/parallaize/parallaize_0.1.8-1_amd64.deb");
    assert.equal(
      summary.sourceList,
      "deb [arch=amd64 signed-by=/etc/apt/keyrings/parallaize-archive-keyring.gpg] https://archive.parallaize.com/apt noble main",
    );

    const packagesContents = await readFile(
      join(buildDir, "dists", "noble", "main", "binary-amd64", "Packages"),
      "utf8",
    );
    assert.match(packagesContents, /^Package: parallaize$/m);
    assert.match(packagesContents, /^Filename: pool\/main\/p\/parallaize\/parallaize_0\.1\.8-1_amd64\.deb$/m);
    assert.match(packagesContents, /^Architecture: amd64$/m);

    const releaseContents = await readFile(join(buildDir, "dists", "noble", "Release"), "utf8");
    assert.match(releaseContents, /^Suite: noble$/m);
    assert.match(releaseContents, /^Codename: noble$/m);
    assert.match(releaseContents, /^Components: main$/m);
    assert.match(releaseContents, /^Architectures: amd64$/m);

    const listContents = await readFile(join(buildDir, "parallaize.list"), "utf8");
    assert.equal(
      listContents,
      "deb [arch=amd64 signed-by=/etc/apt/keyrings/parallaize-archive-keyring.gpg] https://archive.parallaize.com/apt noble main\n",
    );

    const sourcesContents = await readFile(join(buildDir, "parallaize.sources"), "utf8");
    assert.match(sourcesContents, /^Types: deb$/m);
    assert.match(sourcesContents, /^URIs: https:\/\/archive\.parallaize\.com\/apt$/m);
    assert.match(sourcesContents, /^Suites: noble$/m);
    assert.match(sourcesContents, /^Architectures: amd64$/m);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

test("Debian control parser preserves multiline description values", () => {
  const fields = aptRepositoryModule.parseDebianControlParagraph([
    "Package: parallaize",
    "Description: Short description",
    " Long description line one.",
    " .",
    " Long description line two.",
  ].join("\n"));

  assert.equal(fields.Package, "parallaize");
  assert.equal(
    fields.Description,
    "Short description\n Long description line one.\n .\n Long description line two.",
  );
});
