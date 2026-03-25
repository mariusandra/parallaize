#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import process from "node:process";

const root = resolve(process.cwd());
const args = parseArgs(process.argv.slice(2));

const version = (args.version ?? "").trim();
const packageRelease = (args["package-release"] ?? args.release ?? "1").trim();
const dryRun = parseBooleanFlag(args["dry-run"] ?? "false");

if (!version) {
  throw new Error('Missing required --version argument. Use a stable semver like "0.1.1".');
}

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`Unsupported version "${version}". Use stable semver like "0.1.1".`);
}

if (!/^[1-9]\d*$/.test(packageRelease)) {
  throw new Error(`Unsupported package release "${packageRelease}". Use a positive integer like "1".`);
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
