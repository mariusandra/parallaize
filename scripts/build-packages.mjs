import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import process from "node:process";

import { renderPackagedCaddyfile } from "./package-assets.mjs";

const root = resolve(process.cwd());
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const packagedCaddyfile = renderPackagedCaddyfile(
  await readFile(join(root, "infra", "Caddyfile"), "utf8"),
);
const args = parseArgs(process.argv.slice(2));

const appName = "parallaize";
const packageVersion = (args.version ?? packageJson.version).trim();
const packageRelease = (args.release ?? process.env.PARALLAIZE_PACKAGE_RELEASE ?? "1").trim();
const outputDir = resolve(root, args["output-dir"] ?? "artifacts/packages");
const workDir = resolve(root, args["work-dir"] ?? ".artifacts/package-work");
const nodeVersion = process.version.replace(/^v/, "");
const buildRunId = `${Date.now()}-${process.pid}`;
const formats = normalizeFormats(args.format ?? "deb");
const architectures = normalizeArchitectures(args.arch ?? "amd64");

const archMatrix = {
  amd64: {
    deb: "amd64",
    node: "x64",
    debDepends: [
      "bash",
      "incus",
      "btrfs-progs",
      "attr",
      "genisoimage",
      "ovmf",
      "qemu-system-x86",
      "qemu-utils",
    ],
  },
  arm64: {
    deb: "arm64",
    node: "arm64",
    debDepends: [
      "bash",
      "incus",
      "btrfs-progs",
      "attr",
      "genisoimage",
      "qemu-efi-aarch64",
      "qemu-system-arm",
      "qemu-utils",
    ],
  },
};

ensureBuildInputs();
await rm(outputDir, { force: true, recursive: true });
await mkdir(outputDir, { recursive: true });

const manifestEntries = [];

for (const architecture of architectures) {
  const archConfig = archMatrix[architecture];
  const nodeRuntimeDir = await ensureNodeRuntime(nodeVersion, archConfig.node, workDir);
  const rootfsDir = await stageRootFilesystem({
    architecture,
    nodeRuntimeDir,
    packageRelease,
    packageVersion,
  });

  for (const format of formats) {
    const packagePath = await buildDebPackage({
      architecture,
      depends: archConfig.debDepends,
      outputDir,
      packageRelease,
      packageVersion,
      rootfsDir,
    });

    manifestEntries.push(await buildManifestEntry(packagePath, format, architecture));
  }
}

await writeChecksums(outputDir, manifestEntries);
await writeFile(
  join(outputDir, "manifest.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      nodeVersion,
      packageRelease,
      packageVersion,
      packages: manifestEntries,
    },
    null,
    2,
  ),
);

function ensureBuildInputs() {
  const requiredPaths = [
    join(root, "dist", "package", "server.mjs"),
    join(root, "dist", "package", "persistence-cli.mjs"),
    join(root, "dist", "package", "smoke-incus.mjs"),
    join(root, "dist", "apps", "web", "static", "index.html"),
  ];

  for (const requiredPath of requiredPaths) {
    if (!existsSync(requiredPath)) {
      throw new Error(
        `Missing build artifact ${requiredPath}. Run "pnpm package:prepare" before building packages.`,
      );
    }
  }
}

async function ensureNodeRuntime(nodeVersion, nodeArchitecture, workDir) {
  const cacheDir = join(workDir, "cache", "node");
  const runtimeName = `node-v${nodeVersion}-linux-${nodeArchitecture}`;
  const tarballName = `${runtimeName}.tar.xz`;
  const tarballPath = join(cacheDir, tarballName);
  const extractedPath = join(cacheDir, runtimeName);
  const shasumsUrl = `https://nodejs.org/dist/v${nodeVersion}/SHASUMS256.txt`;
  const tarballUrl = `https://nodejs.org/dist/v${nodeVersion}/${tarballName}`;

  await mkdir(cacheDir, { recursive: true });

  if (!existsSync(tarballPath)) {
    await downloadFile(tarballUrl, tarballPath);
  }

  const expectedChecksum = await resolveExpectedChecksum(shasumsUrl, tarballName);
  const actualChecksum = await sha256File(tarballPath);

  if (expectedChecksum !== actualChecksum) {
    await rm(tarballPath, { force: true });
    throw new Error(
      `Checksum mismatch for ${tarballName}. Expected ${expectedChecksum}, received ${actualChecksum}.`,
    );
  }

  if (!existsSync(extractedPath)) {
    await rm(extractedPath, { force: true, recursive: true });
    spawnChecked("tar", ["-xJf", tarballPath, "-C", cacheDir]);
  }

  return extractedPath;
}

async function stageRootFilesystem({
  architecture,
  nodeRuntimeDir,
  packageRelease,
  packageVersion,
}) {
  const rootfsDir = join(workDir, "rootfs", architecture);
  const installRoot = join(rootfsDir, "usr", "lib", appName);
  const buildInfo = {
    architecture,
    builtAt: new Date().toISOString(),
    nodeVersion,
    packageRelease,
    packageVersion,
  };

  await rm(rootfsDir, { force: true, recursive: true });

  await copyTree(join(root, "dist", "apps", "web", "static"), join(installRoot, "dist", "apps", "web", "static"));
  await copyTree(join(root, "dist", "package"), join(installRoot, "dist", "package"));
  await copyFileWithMode(
    join(nodeRuntimeDir, "bin", "node"),
    join(installRoot, "runtime", "bin", "node"),
    0o755,
  );

  await copyFileWithMode(
    join(root, "packaging", "bin", "parallaize"),
    join(rootfsDir, "usr", "bin", "parallaize"),
    0o755,
  );
  await copyFileWithMode(
    join(root, "packaging", "bin", "parallaize-persistence"),
    join(rootfsDir, "usr", "bin", "parallaize-persistence"),
    0o755,
  );
  await copyFileWithMode(
    join(root, "packaging", "bin", "parallaize-smoke-incus"),
    join(rootfsDir, "usr", "bin", "parallaize-smoke-incus"),
    0o755,
  );
  await copyFileWithMode(
    join(root, "packaging", "bin", "parallaize-network-fix"),
    join(rootfsDir, "usr", "bin", "parallaize-network-fix"),
    0o755,
  );
  await copyFileWithMode(
    join(root, "packaging", "install", "parallaize-postinstall-configure"),
    join(installRoot, "install", "parallaize-postinstall-configure"),
    0o755,
  );

  await copyFileWithMode(
    join(root, "packaging", "systemd", "parallaize.service"),
    join(rootfsDir, "usr", "lib", "systemd", "system", "parallaize.service"),
  );
  await copyFileWithMode(
    join(root, "packaging", "systemd", "parallaize-caddy.service"),
    join(rootfsDir, "usr", "lib", "systemd", "system", "parallaize-caddy.service"),
  );
  await copyFileWithMode(
    join(root, "packaging", "systemd", "parallaize-network-fix.service"),
    join(rootfsDir, "usr", "lib", "systemd", "system", "parallaize-network-fix.service"),
  );

  await copyFileWithMode(
    join(root, "packaging", "config", "parallaize.env"),
    join(rootfsDir, "etc", appName, "parallaize.env"),
  );
  await writeTextFile(
    join(rootfsDir, "etc", appName, "Caddyfile"),
    packagedCaddyfile,
  );

  await copyFileWithMode(
    join(root, "README.md"),
    join(rootfsDir, "usr", "share", "doc", appName, "README.md"),
  );
  await copyFileWithMode(
    join(root, "docs", "packaging.md"),
    join(rootfsDir, "usr", "share", "doc", appName, "packaging.md"),
  );

  await writeTextFile(
    join(installRoot, "BUILD_INFO.json"),
    JSON.stringify(buildInfo, null, 2),
  );

  return rootfsDir;
}

async function buildDebPackage({
  architecture,
  depends,
  outputDir,
  packageRelease,
  packageVersion,
  rootfsDir,
}) {
  const debRootDir = join(workDir, "deb", buildRunId, architecture, "rootfs");
  const controlDir = join(debRootDir, "DEBIAN");
  const outputPath = join(
    outputDir,
    `${appName}_${packageVersion}-${packageRelease}_${archMatrix[architecture].deb}.deb`,
  );

  await rm(debRootDir, { force: true, recursive: true });
  await copyTree(rootfsDir, debRootDir);
  await mkdir(controlDir, { recursive: true });
  await writeTextFile(
    join(controlDir, "control"),
    [
      `Package: ${appName}`,
      `Version: ${packageVersion}-${packageRelease}`,
      "Section: admin",
      "Priority: optional",
      `Architecture: ${archMatrix[architecture].deb}`,
      "Maintainer: Parallaize Maintainers <maintainers@parallaize.invalid>",
      `Depends: ${depends.join(", ")}`,
      "Recommends: caddy",
      "Suggests: postgresql",
      "Description: Server-first control plane for many isolated desktop workspaces",
      " Parallaize packages the control plane, bundled Node runtime, static web UI,",
      " systemd service units, and packaged install defaults for host deployments.",
      "",
    ].join("\n"),
  );
  await writeTextFile(
    join(controlDir, "conffiles"),
    ["/etc/parallaize/parallaize.env", "/etc/parallaize/Caddyfile", ""].join("\n"),
  );

  for (const [sourceName, targetName] of [
    ["preinstall.sh", "preinst"],
    ["postinstall.sh", "postinst"],
    ["preremove.sh", "prerm"],
    ["postremove.sh", "postrm"],
  ]) {
    await copyFileWithMode(
      join(root, "packaging", "maintainer", sourceName),
      join(controlDir, targetName),
      0o755,
    );
  }

  spawnChecked("dpkg-deb", ["--root-owner-group", "--build", debRootDir, outputPath]);
  return outputPath;
}

async function buildManifestEntry(packagePath, format, architecture) {
  return {
    architecture,
    format,
    path: relative(root, packagePath),
    sha256: await sha256File(packagePath),
    support: format === "deb" && architecture === "amd64" ? "supported" : "experimental",
  };
}

async function writeChecksums(outputDir, manifestEntries) {
  const lines = manifestEntries
    .map((entry) => `${entry.sha256}  ${entry.path}`)
    .sort();
  lines.push("");

  await writeTextFile(join(outputDir, "SHA256SUMS"), lines.join("\n"));
}

async function copyTree(source, target) {
  await mkdir(join(target, ".."), { recursive: true });
  await cp(source, target, { force: true, recursive: true });
}

async function copyFileWithMode(source, target, mode = 0o644) {
  await mkdir(join(target, ".."), { recursive: true });
  await cp(source, target, { force: true });
  await chmod(target, mode);
}

async function downloadFile(url, targetPath) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(targetPath, buffer);
}

function normalizeArchitectures(value) {
  const rawArchitectures = splitCsv(value);
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

function normalizeFormats(value) {
  const rawFormats = splitCsv(value);
  if (rawFormats.includes("all") || rawFormats.includes("both")) {
    return ["deb"];
  }

  return rawFormats.map((entry) => {
    if (entry !== "deb") {
      throw new Error(`Unsupported package format "${entry}". Use deb.`);
    }

    return entry;
  });
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

async function resolveExpectedChecksum(shasumsUrl, tarballName) {
  const response = await fetch(shasumsUrl);

  if (!response.ok) {
    throw new Error(`Failed to download ${shasumsUrl}: ${response.status} ${response.statusText}`);
  }

  const shasums = await response.text();
  const matchingLine = shasums
    .split("\n")
    .find((line) => line.trim().endsWith(` ${tarballName}`));

  if (!matchingLine) {
    throw new Error(`Could not find checksum for ${tarballName} in ${shasumsUrl}.`);
  }

  return matchingLine.trim().split(/\s+/)[0];
}

async function sha256File(filePath) {
  const fileContents = await readFile(filePath);
  return createHash("sha256").update(fileContents).digest("hex");
}

function spawnChecked(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function splitCsv(value) {
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

async function writeTextFile(path, contents, mode = 0o644) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, contents, "utf8");
  await chmod(path, mode);
}
