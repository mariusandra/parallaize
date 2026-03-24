import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { build } from "esbuild";

const root = process.cwd();
const outputDir = join(root, "dist", "package");
const nodeBanner =
  'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);';

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
    entryPoint: join(root, "scripts", "smoke-incus.mjs"),
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
    entryPoints: [bundleTarget.entryPoint],
    format: "esm",
    legalComments: "none",
    logLevel: "info",
    outfile: bundleTarget.outputFile,
    platform: "node",
    target: ["node24"],
  });
}
