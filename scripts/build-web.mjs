import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { build } from "esbuild";

const require = createRequire(import.meta.url);
const root = process.cwd();
const outputDir = join(root, "dist", "apps", "web", "static", "assets");

await mkdir(outputDir, { recursive: true });

const tailwindPackagePath = require.resolve("@tailwindcss/cli/package.json");
const tailwindCli = join(dirname(tailwindPackagePath), "dist", "index.mjs");
const cssInput = join(root, "apps", "web", "src", "styles.css");
const cssOutput = join(outputDir, "main.css");

const cssResult = spawnSync(
  process.execPath,
  [tailwindCli, "-i", cssInput, "-o", cssOutput, "--minify"],
  {
    stdio: "inherit",
  },
);

if (cssResult.status !== 0) {
  throw new Error("Tailwind build failed.");
}

await build({
  bundle: true,
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  entryPoints: [join(root, "apps", "web", "src", "main.tsx")],
  format: "esm",
  legalComments: "none",
  logLevel: "info",
  minify: true,
  outfile: join(outputDir, "main.js"),
  platform: "browser",
  target: ["es2022"],
});
