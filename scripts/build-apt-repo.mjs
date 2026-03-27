#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp } from "node:fs/promises";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(process.cwd());

if (isMainModule(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const summary = await buildAptRepository(resolveCliOptions(args));
  console.log(JSON.stringify(summary, null, 2));
}

export async function buildAptRepository(options) {
  const resolvedOptions = normalizeOptions(options);
  ensureBuildInputs(resolvedOptions);

  await rm(resolvedOptions.outputDir, { force: true, recursive: true });
  await mkdir(resolvedOptions.outputDir, { recursive: true });

  const stagedPackages = await stagePackages(resolvedOptions);
  const packageParagraphs = await buildPackageParagraphs(resolvedOptions.outputDir);
  const packageParagraphsByArchitecture = groupPackageParagraphsByArchitecture(
    packageParagraphs,
    resolvedOptions.architectures,
  );

  for (const architecture of resolvedOptions.architectures) {
    const architectureParagraphs = packageParagraphsByArchitecture.get(architecture) ?? [];
    await writePackagesIndex({
      architecture,
      component: resolvedOptions.component,
      outputDir: resolvedOptions.outputDir,
      packageParagraphs: architectureParagraphs,
      suite: resolvedOptions.suite,
    });
  }

  const signingKeyFingerprint = resolvedOptions.signingKeyId
    ? resolvePrimaryKeyFingerprint({
        gpgHomeDir: resolvedOptions.gpgHomeDir,
        signingKeyId: resolvedOptions.signingKeyId,
      })
    : null;

  await writeReleaseMetadata({
    architectures: resolvedOptions.architectures,
    codename: resolvedOptions.codename,
    component: resolvedOptions.component,
    description: resolvedOptions.description,
    outputDir: resolvedOptions.outputDir,
    origin: resolvedOptions.origin,
    label: resolvedOptions.label,
    signingKeyFingerprint,
    suite: resolvedOptions.suite,
  });
  await writeSourceListExamples(resolvedOptions);

  if (resolvedOptions.signingKeyId) {
    await exportPublicKeyArtifacts({
      gpgHomeDir: resolvedOptions.gpgHomeDir,
      outputDir: resolvedOptions.outputDir,
      signingKeyId: resolvedOptions.signingKeyId,
    });
    signReleaseFiles({
      gpgHomeDir: resolvedOptions.gpgHomeDir,
      outputDir: resolvedOptions.outputDir,
      passphrase: resolvedOptions.passphrase,
      signingKeyId: resolvedOptions.signingKeyId,
      suite: resolvedOptions.suite,
    });
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl: resolvedOptions.baseUrl,
    suite: resolvedOptions.suite,
    codename: resolvedOptions.codename,
    component: resolvedOptions.component,
    architectures: resolvedOptions.architectures,
    signed: Boolean(resolvedOptions.signingKeyId),
    signingKeyFingerprint,
    packages: stagedPackages.map((entry) => ({
      package: entry.packageName,
      version: entry.version,
      architecture: entry.architecture,
      poolPath: entry.poolRelativePath,
    })),
    sourceList: buildOneLineSourceEntry(resolvedOptions),
    sourcesFile: buildDeb822SourceEntry(resolvedOptions),
  };

  await writeFile(
    join(resolvedOptions.outputDir, "manifest.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );

  return summary;
}

export function buildOneLineSourceEntry({
  architectures,
  baseUrl,
  component,
  signedByPath,
  suite,
}) {
  return `deb [arch=${architectures.join(",")} signed-by=${signedByPath}] ${baseUrl} ${suite} ${component}`;
}

export function buildDeb822SourceEntry({
  architectures,
  baseUrl,
  component,
  signedByPath,
  suite,
}) {
  return [
    "Types: deb",
    `URIs: ${baseUrl}`,
    `Suites: ${suite}`,
    `Components: ${component}`,
    `Architectures: ${architectures.join(" ")}`,
    `Signed-By: ${signedByPath}`,
    "",
  ].join("\n");
}

export function parseDebianControlParagraph(paragraph) {
  const fields = {};
  let currentField = null;

  for (const rawLine of paragraph.split(/\r?\n/u)) {
    if (!rawLine) {
      continue;
    }

    if (/^[ \t]/u.test(rawLine)) {
      if (!currentField) {
        throw new Error(`Encountered a continuation line before any field: "${rawLine}"`);
      }

      fields[currentField] = `${fields[currentField]}\n${rawLine}`;
      continue;
    }

    const separatorIndex = rawLine.indexOf(":");
    if (separatorIndex <= 0) {
      throw new Error(`Malformed Debian control line "${rawLine}".`);
    }

    currentField = rawLine.slice(0, separatorIndex);
    fields[currentField] = rawLine.slice(separatorIndex + 1).trimStart();
  }

  return fields;
}

function normalizeOptions(options) {
  return {
    debDir: resolve(root, options.debDir),
    outputDir: resolve(root, options.outputDir),
    suite: normalizeArchiveSegment(options.suite),
    codename: normalizeArchiveSegment(options.codename ?? options.suite),
    component: normalizeArchiveSegment(options.component),
    architectures: normalizeArchitectures(options.architectures),
    origin: normalizeRequiredText(options.origin, "origin"),
    label: normalizeRequiredText(options.label, "label"),
    description: normalizeRequiredText(options.description, "description"),
    baseUrl: normalizeBaseUrl(options.baseUrl),
    signedByPath: normalizeAbsolutePath(options.signedByPath, "signedByPath"),
    signingKeyId: normalizeOptionalText(options.signingKeyId),
    gpgHomeDir: normalizeOptionalText(options.gpgHomeDir),
    passphrase: options.passphrase ?? "",
  };
}

function resolveCliOptions(args) {
  const passphraseEnvName = normalizeOptionalText(args["passphrase-env"]) ?? "APT_GPG_PASSPHRASE";

  return {
    debDir: args["deb-dir"] ?? "artifacts/packages",
    outputDir: args["output-dir"] ?? "artifacts/apt",
    suite: args.suite ?? "noble",
    codename: args.codename ?? args.suite ?? "noble",
    component: args.component ?? "main",
    architectures: normalizeArchitectures(args.arch ?? "amd64"),
    origin: args.origin ?? "Parallaize",
    label: args.label ?? "Parallaize",
    description: args.description ?? "Parallaize Ubuntu 24.04 APT archive",
    baseUrl: args["base-url"] ?? "https://archive.parallaize.com/apt",
    signedByPath: args["signed-by-path"] ?? "/etc/apt/keyrings/parallaize-archive-keyring.gpg",
    signingKeyId: args["signing-key-id"] ?? null,
    gpgHomeDir: args["gpg-homedir"] ?? process.env.GNUPGHOME ?? null,
    passphrase: process.env[passphraseEnvName] ?? "",
  };
}

function ensureBuildInputs(options) {
  if (!existsSync(options.debDir)) {
    throw new Error(`Missing Debian package directory ${options.debDir}. Build packages before creating the APT archive.`);
  }

  for (const command of ["apt-ftparchive", "dpkg-deb"]) {
    ensureCommandExists(command);
  }

  if (options.signingKeyId) {
    ensureCommandExists("gpg");
  }
}

async function stagePackages(options) {
  const fileNames = (await readdir(options.debDir))
    .filter((entry) => entry.endsWith(".deb"))
    .sort();

  if (fileNames.length === 0) {
    throw new Error(`Did not find any .deb packages in ${options.debDir}.`);
  }

  const stagedPackages = [];

  for (const fileName of fileNames) {
    const sourcePath = join(options.debDir, fileName);
    const fields = parseDebianControlParagraph(
      spawnCheckedText("dpkg-deb", ["-f", sourcePath]),
    );
    const packageName = normalizePackageName(fields.Package ?? "");
    const architecture = normalizeDebArchitecture(fields.Architecture ?? "");

    if (architecture !== "all" && !options.architectures.includes(architecture)) {
      continue;
    }

    const version = normalizeRequiredText(fields.Version ?? "", `${fileName} Version`);
    const poolRelativePath = join(
      "pool",
      options.component,
      packageName.slice(0, 1),
      packageName,
      basename(sourcePath),
    );
    const targetPath = join(options.outputDir, poolRelativePath);

    await mkdir(join(targetPath, ".."), { recursive: true });
    await cp(sourcePath, targetPath, { force: true });

    stagedPackages.push({
      architecture,
      packageName,
      poolRelativePath,
      version,
    });
  }

  if (stagedPackages.length === 0) {
    throw new Error(
      `No staged packages matched the requested architectures ${options.architectures.join(", ")}.`,
    );
  }

  return stagedPackages;
}

async function buildPackageParagraphs(outputDir) {
  const packagesOutput = spawnCheckedText("apt-ftparchive", ["packages", "pool"], {
    cwd: outputDir,
  });

  return packagesOutput
    .trim()
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function groupPackageParagraphsByArchitecture(packageParagraphs, architectures) {
  const groupedParagraphs = new Map(architectures.map((entry) => [entry, []]));

  for (const paragraph of packageParagraphs) {
    const fields = parseDebianControlParagraph(paragraph);
    const architecture = normalizeDebArchitecture(fields.Architecture ?? "");

    if (architecture === "all") {
      for (const targetArchitecture of architectures) {
        groupedParagraphs.get(targetArchitecture)?.push(paragraph);
      }
      continue;
    }

    if (groupedParagraphs.has(architecture)) {
      groupedParagraphs.get(architecture)?.push(paragraph);
    }
  }

  return groupedParagraphs;
}

async function writePackagesIndex({
  architecture,
  component,
  outputDir,
  packageParagraphs,
  suite,
}) {
  const packagesDir = join(outputDir, "dists", suite, component, `binary-${architecture}`);
  const packagesPath = join(packagesDir, "Packages");
  const packagesGzipPath = join(packagesDir, "Packages.gz");
  const packagesContents = packageParagraphs.length === 0 ? "" : `${packageParagraphs.join("\n\n")}\n`;

  await mkdir(packagesDir, { recursive: true });
  await writeFile(packagesPath, packagesContents, "utf8");
  await writeFile(packagesGzipPath, gzipSync(Buffer.from(packagesContents, "utf8"), { level: 9 }));
}

async function writeReleaseMetadata({
  architectures,
  codename,
  component,
  description,
  outputDir,
  origin,
  label,
  signingKeyFingerprint,
  suite,
}) {
  const releasePath = join(outputDir, "dists", suite, "Release");
  const releaseArgs = [
    "-o",
    `APT::FTPArchive::Release::Origin=${origin}`,
    "-o",
    `APT::FTPArchive::Release::Label=${label}`,
    "-o",
    `APT::FTPArchive::Release::Suite=${suite}`,
    "-o",
    `APT::FTPArchive::Release::Codename=${codename}`,
    "-o",
    `APT::FTPArchive::Release::Architectures=${architectures.join(" ")}`,
    "-o",
    `APT::FTPArchive::Release::Components=${component}`,
    "-o",
    `APT::FTPArchive::Release::Description=${description}`,
  ];

  if (signingKeyFingerprint) {
    releaseArgs.push("-o", `APT::FTPArchive::Release::Signed-By=${signingKeyFingerprint}`);
  }

  releaseArgs.push("release", join("dists", suite));

  await mkdir(join(releasePath, ".."), { recursive: true });
  await writeFile(
    releasePath,
    spawnCheckedText("apt-ftparchive", releaseArgs, { cwd: outputDir }),
    "utf8",
  );
}

async function writeSourceListExamples(options) {
  await writeFile(
    join(options.outputDir, "parallaize.list"),
    `${buildOneLineSourceEntry(options)}\n`,
    "utf8",
  );
  await writeFile(
    join(options.outputDir, "parallaize.sources"),
    buildDeb822SourceEntry(options),
    "utf8",
  );
}

async function exportPublicKeyArtifacts({ gpgHomeDir, outputDir, signingKeyId }) {
  const binaryKeyPath = join(outputDir, "parallaize-archive-keyring.gpg");
  const armoredKeyPath = join(outputDir, "parallaize-archive-keyring.asc");
  const fingerprintPath = join(outputDir, "parallaize-archive-keyring.fingerprint");
  const fingerprint = resolvePrimaryKeyFingerprint({ gpgHomeDir, signingKeyId });

  spawnChecked("gpg", buildGpgArgs(gpgHomeDir, ["--batch", "--yes", "--export", "--output", binaryKeyPath, signingKeyId]));
  spawnChecked(
    "gpg",
    buildGpgArgs(gpgHomeDir, [
      "--batch",
      "--yes",
      "--armor",
      "--export",
      "--output",
      armoredKeyPath,
      signingKeyId,
    ]),
  );
  await writeFile(fingerprintPath, `${fingerprint}\n`, "utf8");
}

function signReleaseFiles({
  gpgHomeDir,
  outputDir,
  passphrase,
  signingKeyId,
  suite,
}) {
  const releaseDir = join(outputDir, "dists", suite);
  const releasePath = join(releaseDir, "Release");
  const inReleasePath = join(releaseDir, "InRelease");
  const releaseSignaturePath = join(releaseDir, "Release.gpg");

  const passphraseArgs = buildGpgPassphraseArgs(passphrase);
  const baseArgs = ["--batch", "--yes", "--local-user", signingKeyId, ...passphraseArgs];

  spawnChecked("gpg", buildGpgArgs(gpgHomeDir, [
    ...baseArgs,
    "--clearsign",
    "--output",
    inReleasePath,
    releasePath,
  ]), {
    input: passphrase,
  });

  spawnChecked("gpg", buildGpgArgs(gpgHomeDir, [
    ...baseArgs,
    "--armor",
    "--detach-sign",
    "--output",
    releaseSignaturePath,
    releasePath,
  ]), {
    input: passphrase,
  });
}

function resolvePrimaryKeyFingerprint({ gpgHomeDir, signingKeyId }) {
  const output = spawnCheckedText(
    "gpg",
    buildGpgArgs(gpgHomeDir, ["--batch", "--with-colons", "--list-secret-keys", signingKeyId]),
  );
  const lines = output.split(/\r?\n/u);

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith("sec:")) {
      continue;
    }

    for (let fingerprintIndex = index + 1; fingerprintIndex < lines.length; fingerprintIndex += 1) {
      const line = lines[fingerprintIndex];

      if (line.startsWith("sec:")) {
        break;
      }

      if (line.startsWith("fpr:")) {
        const segments = line.split(":");
        const fingerprint = segments[9]?.trim();

        if (!fingerprint) {
          break;
        }

        return fingerprint;
      }
    }
  }

  throw new Error(`Could not resolve a primary fingerprint for signing key "${signingKeyId}".`);
}

function ensureCommandExists(command) {
  const result = spawnSync("bash", ["-lc", `command -v ${shellEscape(command)}`], {
    stdio: "ignore",
  });

  if (result.status !== 0) {
    throw new Error(`Missing required command "${command}".`);
  }
}

function buildGpgArgs(gpgHomeDir, args) {
  if (!gpgHomeDir) {
    return args;
  }

  return ["--homedir", gpgHomeDir, ...args];
}

function buildGpgPassphraseArgs(passphrase) {
  if (!passphrase) {
    return [];
  }

  return ["--pinentry-mode", "loopback", "--passphrase-fd", "0"];
}

function spawnCheckedText(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    input: options.input,
    stdio: ["pipe", "pipe", "inherit"],
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }

  return result.stdout;
}

function spawnChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    input: options.input,
    stdio: ["pipe", "inherit", "inherit"],
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function parseArgs(argv) {
  const parsedArgs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (!current.startsWith("--")) {
      continue;
    }

    const withoutPrefix = current.slice(2);
    const equalsIndex = withoutPrefix.indexOf("=");

    if (equalsIndex >= 0) {
      parsedArgs[withoutPrefix.slice(0, equalsIndex)] = withoutPrefix.slice(equalsIndex + 1);
      continue;
    }

    const nextValue = argv[index + 1];
    if (nextValue && !nextValue.startsWith("--")) {
      parsedArgs[withoutPrefix] = nextValue;
      index += 1;
      continue;
    }

    parsedArgs[withoutPrefix] = "true";
  }

  return parsedArgs;
}

function normalizeArchitectures(value) {
  const rawArchitectures = Array.isArray(value) ? value : splitCsv(value);
  if (rawArchitectures.includes("all")) {
    return ["amd64", "arm64"];
  }

  return rawArchitectures.map((entry) => {
    switch (entry) {
      case "amd64":
      case "x86_64":
        return "amd64";
      case "arm64":
      case "aarch64":
        return "arm64";
      default:
        throw new Error(`Unsupported architecture "${entry}". Use amd64 or arm64.`);
    }
  });
}

function normalizeDebArchitecture(value) {
  const normalized = normalizeRequiredText(value, "deb architecture").toLowerCase();

  switch (normalized) {
    case "all":
    case "amd64":
    case "arm64":
      return normalized;
    default:
      throw new Error(`Unsupported Debian package architecture "${value}".`);
  }
}

function normalizePackageName(value) {
  const normalized = normalizeRequiredText(value, "package name").toLowerCase();

  if (!/^[a-z0-9][a-z0-9+.-]*$/u.test(normalized)) {
    throw new Error(`Unsupported package name "${value}".`);
  }

  return normalized;
}

function normalizeArchiveSegment(value) {
  const normalized = normalizeRequiredText(value, "archive segment").toLowerCase();

  if (!/^[a-z0-9][a-z0-9+.-]*$/u.test(normalized)) {
    throw new Error(`Unsupported archive segment "${value}".`);
  }

  return normalized;
}

function normalizeBaseUrl(value) {
  const normalized = normalizeRequiredText(value, "baseUrl").replace(/\/+$/u, "");

  if (!/^https?:\/\/[^/]+(?:\/.*)?$/u.test(normalized)) {
    throw new Error(`Unsupported base URL "${value}".`);
  }

  return normalized;
}

function normalizeAbsolutePath(value, label) {
  const normalized = normalizeRequiredText(value, label);

  if (!normalized.startsWith("/")) {
    throw new Error(`Expected ${label} to be an absolute path, received "${value}".`);
  }

  return normalized;
}

function normalizeRequiredText(value, label) {
  const normalized = `${value ?? ""}`.trim();

  if (!normalized) {
    throw new Error(`Missing required ${label}.`);
  }

  return normalized;
}

function normalizeOptionalText(value) {
  const normalized = `${value ?? ""}`.trim();
  return normalized || null;
}

function splitCsv(value) {
  return `${value}`
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function shellEscape(value) {
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

function isMainModule(importMetaUrl) {
  const entryPoint = process.argv[1];

  if (!entryPoint) {
    return false;
  }

  return fileURLToPath(importMetaUrl) === resolve(entryPoint);
}
