#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const root = resolve(process.cwd());
const execFileAsync = promisify(execFile);
const args = parseArgs(process.argv.slice(2));

const versionInput = (args.version ?? "").trim();
const packageRelease = (args["package-release"] ?? args.release ?? "1").trim();
const dryRun = parseBooleanFlag(args["dry-run"] ?? "false");
const resolveOnly = parseBooleanFlag(args["resolve-only"] ?? "false");
const version = await resolveVersion(versionInput);

if (!/^[1-9]\d*$/.test(packageRelease)) {
  throw new Error(`Unsupported package release "${packageRelease}". Use a positive integer like "1".`);
}

if (resolveOnly) {
  console.log(version);
  process.exit(0);
}

const packageLabel = `${version}-${packageRelease}`;
const changedFiles = [];

await updatePackageJson();
await updateDebArtifactReferences("docs/index.html");
await updateDebArtifactReferences("docs/packaging.md");

if (changedFiles.length === 0) {
  throw new Error(`Managed release files already point at ${packageLabel}.`);
}

const action = dryRun ? "Would update" : "Updated";
console.log(`${action} ${changedFiles.length} files for release ${packageLabel}:`);

for (const filePath of changedFiles) {
  console.log(`- ${filePath}`);
}

async function resolveVersion(input) {
  const normalizedInput = normalizeVersionInput(input);

  if (isReleaseIncrement(normalizedInput)) {
    const baseVersion = (await findLatestTaggedVersion()) ?? (await readPackageVersion());
    return incrementVersion(baseVersion, normalizedInput);
  }

  if (!isStableSemver(normalizedInput)) {
    throw new Error(
      `Unsupported version "${input}". Use stable semver like "0.1.1" or one of patch, minor, major.`,
    );
  }

  return normalizedInput;
}

async function updatePackageJson() {
  const relativePath = "package.json";
  const absolutePath = join(root, relativePath);
  const packageJson = JSON.parse(await readFile(absolutePath, "utf8"));

  if (packageJson.version === version) {
    return;
  }

  packageJson.version = version;
  changedFiles.push(relativePath);

  if (!dryRun) {
    await writeFile(absolutePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  }
}

async function updateDebArtifactReferences(relativePath) {
  const absolutePath = join(root, relativePath);
  const originalContents = await readFile(absolutePath, "utf8");
  let replacements = 0;

  const updatedContents = originalContents.replace(
    /parallaize_\d+\.\d+\.\d+-\d+_(amd64|arm64)\.deb/g,
    (_match, architecture) => {
      replacements += 1;
      return `parallaize_${packageLabel}_${architecture}.deb`;
    },
  );

  if (replacements === 0) {
    throw new Error(`Could not find any managed Debian artifact references in ${relativePath}.`);
  }

  if (updatedContents === originalContents) {
    return;
  }

  changedFiles.push(relative(root, absolutePath));

  if (!dryRun) {
    await writeFile(absolutePath, updatedContents, "utf8");
  }
}

async function findLatestTaggedVersion() {
  let stdout;

  try {
    ({ stdout } = await execFileAsync("git", ["tag", "--list", "v*"], { cwd: root }));
  } catch (error) {
    throw new Error(`Failed to inspect git tags for release version resolution: ${error.message}`);
  }

  const versions = stdout
    .split(/\r?\n/u)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map(parseTaggedVersion)
    .filter(Boolean);

  if (versions.length === 0) {
    return null;
  }

  const uniqueVersions = [...new Set(versions)];
  uniqueVersions.sort(compareSemver);
  return uniqueVersions.at(-1) ?? null;
}

function parseTaggedVersion(tag) {
  const match = /^v(\d+\.\d+\.\d+)(?:-\d+)?$/u.exec(tag);
  return match?.[1] ?? null;
}

async function readPackageVersion() {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const packageVersion = normalizeVersionInput(packageJson.version ?? "");

  if (!isStableSemver(packageVersion)) {
    throw new Error(`Unsupported package.json version "${packageJson.version}". Use stable semver like "0.1.1".`);
  }

  return packageVersion;
}

function normalizeVersionInput(value) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    throw new Error('Missing required --version argument. Use a stable semver like "0.1.1" or patch/minor/major.');
  }

  if (/^[vV]\d+\.\d+\.\d+$/u.test(trimmedValue)) {
    return trimmedValue.slice(1);
  }

  return trimmedValue.toLowerCase();
}

function isReleaseIncrement(value) {
  return value === "patch" || value === "minor" || value === "major";
}

function isStableSemver(value) {
  return /^\d+\.\d+\.\d+$/u.test(value);
}

function incrementVersion(versionString, releaseIncrement) {
  const [major, minor, patch] = versionString.split(".").map((part) => Number.parseInt(part, 10));

  switch (releaseIncrement) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Unsupported release increment "${releaseIncrement}".`);
  }
}

function compareSemver(left, right) {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10));
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10));

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }

  return 0;
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

function parseBooleanFlag(value) {
  switch (value.toLowerCase()) {
    case "true":
    case "1":
    case "yes":
      return true;
    case "false":
    case "0":
    case "no":
      return false;
    default:
      throw new Error(`Unsupported boolean value "${value}". Use true or false.`);
  }
}
