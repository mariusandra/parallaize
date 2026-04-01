import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const helperPath = resolve(
  process.cwd(),
  "packaging",
  "install",
  "parallaize-postinstall-configure",
);

test("postinstall helper points the env file at an existing lvm pool", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "parallaize-postinstall-existing-lvm-"));
  const envFile = join(tempRoot, "etc", "parallaize", "parallaize.env");
  const fakeBinDir = join(tempRoot, "bin");

  try {
    await mkdir(dirname(envFile), { recursive: true });
    await mkdir(fakeBinDir, { recursive: true });
    await writeFile(
      envFile,
      "PARALLAIZE_INCUS_STORAGE_POOL=default\nPARALLAIZE_ADMIN_PASSWORD=change-me\n",
      "utf8",
    );
    await writeExecutable(
      join(fakeBinDir, "incus"),
      `#!/bin/sh
set -eu
if [ "$1" = "storage" ] && [ "$2" = "list" ] && [ "$3" = "--format" ] && [ "$4" = "csv" ] && [ "$5" = "-c" ] && [ "$6" = "nd" ]; then
  printf 'default,btrfs\\nparallaize-lvm,lvm\\n'
  exit 0
fi
exit 1
`,
    );

    const result = runHelper(tempRoot, {
      PARALLAIZE_APP_ENV_FILE: envFile,
      PARALLAIZE_CREATE_LVM_POOL_RESPONSE: "no",
      PARALLAIZE_INSTALL_APT_REPO_RESPONSE: "no",
      PARALLAIZE_SKIP_BLANK_INCUS_BOOTSTRAP: "1",
    });

    assert.equal(result.status, 0, result.stderr);
    const nextEnv = await readFile(envFile, "utf8");
    assert.match(nextEnv, /^PARALLAIZE_INCUS_STORAGE_POOL=parallaize-lvm$/m);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

test("postinstall helper can create a loop-backed lvm pool on first install", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "parallaize-postinstall-create-lvm-"));
  const envFile = join(tempRoot, "etc", "parallaize", "parallaize.env");
  const fakeBinDir = join(tempRoot, "bin");
  const commandLogPath = join(tempRoot, "incus-create.log");

  try {
    await mkdir(dirname(envFile), { recursive: true });
    await mkdir(fakeBinDir, { recursive: true });
    await writeFile(
      envFile,
      "PARALLAIZE_INCUS_STORAGE_POOL=default\nPARALLAIZE_ADMIN_PASSWORD=change-me\n",
      "utf8",
    );
    await writeExecutable(
      join(fakeBinDir, "incus"),
      `#!/bin/sh
set -eu
if [ "$1" = "storage" ] && [ "$2" = "list" ] && [ "$3" = "--format" ] && [ "$4" = "csv" ] && [ "$5" = "-c" ] && [ "$6" = "nd" ]; then
  printf 'default,btrfs\\n'
  exit 0
fi
if [ "$1" = "storage" ] && [ "$2" = "create" ]; then
  printf '%s\\n' "$*" > ${shellQuote(commandLogPath)}
  exit 0
fi
exit 1
`,
    );

    const result = runHelper(tempRoot, {
      PARALLAIZE_APP_ENV_FILE: envFile,
      PARALLAIZE_CREATE_LVM_POOL_RESPONSE: "yes",
      PARALLAIZE_INSTALL_APT_REPO_RESPONSE: "no",
      PARALLAIZE_LVM_POOL_SIZE: "120GiB",
      PARALLAIZE_SKIP_BLANK_INCUS_BOOTSTRAP: "1",
    });

    assert.equal(result.status, 0, result.stderr);
    const nextEnv = await readFile(envFile, "utf8");
    assert.match(nextEnv, /^PARALLAIZE_INCUS_STORAGE_POOL=parallaize-lvm$/m);
    const commandLog = await readFile(commandLogPath, "utf8");
    assert.match(commandLog, /storage create parallaize-lvm lvm size=120GiB lvm\.use_thinpool=true/);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

test("postinstall helper installs the apt repo when requested", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "parallaize-postinstall-apt-repo-"));
  const envFile = join(tempRoot, "etc", "parallaize", "parallaize.env");
  const aptRoot = join(tempRoot, "apt");
  const aptHelperPath = join(tempRoot, "apt-helper");
  const downloadsDir = join(tempRoot, "downloads");
  const sourcesOutputPath = join(aptRoot, "sources.list.d", "parallaize.sources");
  const keyringOutputPath = join(aptRoot, "keyrings", "parallaize-archive-keyring.gpg");

  try {
    await mkdir(dirname(envFile), { recursive: true });
    await mkdir(downloadsDir, { recursive: true });
    await writeFile(
      envFile,
      "PARALLAIZE_INCUS_STORAGE_POOL=default\nPARALLAIZE_ADMIN_PASSWORD=change-me\n",
      "utf8",
    );
    await writeFile(join(downloadsDir, "parallaize.sources"), "Types: deb\nURIs: https://archive.parallaize.com/apt\n", "utf8");
    await writeFile(join(downloadsDir, "parallaize-archive-keyring.gpg"), "fake-keyring", "utf8");
    await writeExecutable(
      aptHelperPath,
      `#!/bin/sh
set -eu
if [ "$1" != "download-file" ]; then
  exit 1
fi
cp "$2" "$3"
`,
    );

    const result = runHelper(tempRoot, {
      PARALLAIZE_APP_ENV_FILE: envFile,
      PARALLAIZE_APT_HELPER_BIN: aptHelperPath,
      PARALLAIZE_APT_KEYRING_FILE: keyringOutputPath,
      PARALLAIZE_APT_KEYRING_URL: join(downloadsDir, "parallaize-archive-keyring.gpg"),
      PARALLAIZE_APT_SEARCH_ROOT: aptRoot,
      PARALLAIZE_APT_SOURCES_FILE: sourcesOutputPath,
      PARALLAIZE_APT_SOURCES_URL: join(downloadsDir, "parallaize.sources"),
      PARALLAIZE_CREATE_LVM_POOL_RESPONSE: "no",
      PARALLAIZE_INSTALL_APT_REPO_RESPONSE: "yes",
      PARALLAIZE_SKIP_BLANK_INCUS_BOOTSTRAP: "1",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(sourcesOutputPath, "utf8"), "Types: deb\nURIs: https://archive.parallaize.com/apt\n");
    assert.equal(await readFile(keyringOutputPath, "utf8"), "fake-keyring");
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

function runHelper(tempRoot: string, extraEnv: Record<string, string>) {
  const fakePath = join(tempRoot, "bin");
  return spawnSync("sh", [helperPath, "configure"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fakePath}:${process.env.PATH ?? ""}`,
      ...extraEnv,
    },
  });
}

async function writeExecutable(path: string, contents: string) {
  await writeFile(path, contents, { encoding: "utf8", mode: 0o755 });
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
