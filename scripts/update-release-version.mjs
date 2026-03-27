#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const directRunPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;

if (directRunPath === import.meta.url) {
  await main();
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const versionInput = (args.version ?? "").trim();
  const packageReleaseInput = (args["package-release"] ?? args.release ?? "1").trim();
  const dryRun = parseBooleanFlag(args["dry-run"] ?? "false");
  const resolveOnly = parseBooleanFlag(args["resolve-only"] ?? "false");

  const result = await updateManagedReleaseFiles({
    dryRun,
    packageReleaseInput,
    resolveOnly,
    versionInput,
  });

  if (resolveOnly) {
    console.log(result.version);
    return result;
  }

  const action = dryRun ? "Would update" : "Updated";
  console.log(`${action} ${result.changedFiles.length} files for release ${result.packageLabel}:`);

  for (const filePath of result.changedFiles) {
    console.log(`- ${filePath}`);
  }

  return result;
}

export async function updateManagedReleaseFiles({
  rootDir = process.cwd(),
  versionInput,
  packageReleaseInput = "1",
  dryRun = false,
  resolveOnly = false,
}) {
  const root = resolve(rootDir);
  const version = await resolveVersion(versionInput, root);
  const packageRelease = packageReleaseInput.trim();

  if (!/^[1-9]\d*$/.test(packageRelease)) {
    throw new Error(`Unsupported package release "${packageRelease}". Use a positive integer like "1".`);
  }

  if (resolveOnly) {
    return {
      changedFiles: [],
      packageLabel: `${version}-${packageRelease}`,
      packageRelease,
      version,
    };
  }

  const packageLabel = `${version}-${packageRelease}`;
  const changedFiles = [];

  await updatePackageJson(root, version, changedFiles, dryRun);
  await updateDebArtifactReferences(root, "docs/index.html", packageLabel, changedFiles, dryRun);
  await updateDebArtifactReferences(root, "docs/packaging.md", packageLabel, changedFiles, dryRun);
  await updateLatestReleaseMetadata(
    root,
    "docs/latest.json",
    buildLatestReleaseMetadata(version, packageRelease),
    changedFiles,
    dryRun,
  );

  if (changedFiles.length === 0) {
    throw new Error(`Managed release files already point at ${packageLabel}.`);
  }

  return {
    changedFiles,
    packageLabel,
    packageRelease,
    version,
  };
}

export async function resolveVersion(input, rootDir = process.cwd()) {
  const normalizedInput = normalizeVersionInput(input);

  if (isReleaseIncrement(normalizedInput)) {
    const baseVersion = (await findLatestTaggedVersion(rootDir)) ?? (await readPackageVersion(rootDir));
    return incrementVersion(baseVersion, normalizedInput);
  }

  if (!isStableSemver(normalizedInput)) {
    throw new Error(
      `Unsupported version "${input}". Use stable semver like "0.1.1" or one of patch, minor, major.`,
    );
  }

  return normalizedInput;
}

async function updatePackageJson(root, version, changedFiles, dryRun) {
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

async function updateDebArtifactReferences(root, relativePath, packageLabel, changedFiles, dryRun) {
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

async function updateLatestReleaseMetadata(root, relativePath, metadata, changedFiles, dryRun) {
  const absolutePath = join(root, relativePath);
  const nextContents = `${JSON.stringify(metadata, null, 2)}\n`;
  let originalContents = null;

  try {
    originalContents = await readFile(absolutePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  if (originalContents === nextContents) {
    return;
  }

  changedFiles.push(relative(root, absolutePath));

  if (!dryRun) {
    await writeFile(absolutePath, nextContents, "utf8");
  }
}

export function buildLatestReleaseMetadata(version, packageRelease) {
  return {
    version,
    packageRelease,
    packageLabel: `${version}-${packageRelease}`,
  };
}

async function findLatestTaggedVersion(root) {
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

async function readPackageVersion(root) {
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
