import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { build } from "esbuild";

const root = process.cwd();
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const outputDir = join(root, "dist", "package");
const nodeBanner =
  'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);';
const appVersion = JSON.stringify(packageJson.version);
const appPackageRelease = JSON.stringify(
  normalizePackageRelease(process.env.PARALLAIZE_PACKAGE_RELEASE),
);

const bundles = [
  {
    entryPoint: join(root, "apps", "control", "src", "server.ts"),
    outputFile: join(outputDir, "server.mjs"),
  },
  {
    entryPoint: join(root, "apps", "control", "src", "persistence-cli.ts"),
    outputFile: join(outputDir, "persistence-cli.mjs"),
  },
  {
    entryPoint: join(root, "scripts", "smoke-incus.ts"),
    outputFile: join(outputDir, "smoke-incus.mjs"),
  },
];

await rm(outputDir, {
  force: true,
  recursive: true,
});
await mkdir(outputDir, { recursive: true });

for (const bundleTarget of bundles) {
  await build({
    banner: {
      js: nodeBanner,
    },
    bundle: true,
    define: {
      __PARALLAIZE_PACKAGE_RELEASE__: appPackageRelease,
      __PARALLAIZE_VERSION__: appVersion,
    },
    entryPoints: [bundleTarget.entryPoint],
    format: "esm",
    legalComments: "none",
    logLevel: "info",
    outfile: bundleTarget.outputFile,
    platform: "node",
    target: ["node24"],
  });
}

function normalizePackageRelease(value) {
  const trimmed = value?.trim();
  return /^[1-9]\d*$/.test(trimmed ?? "") ? trimmed : "1";
}
