import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { build } from "esbuild";

const require = createRequire(import.meta.url);
const root = process.cwd();
const outputDir = join(root, "dist", "apps", "web", "static", "assets");
const noVncBundleDir = join(outputDir, "vendor", "novnc");
const noVncSourceDir = join(outputDir, ".novnc-src");
const noVncLibraryDir = join(noVncSourceDir, "lib");
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const appVersion = JSON.stringify(packageJson.version);
const appPackageRelease = JSON.stringify(normalizePackageRelease(process.env.PARALLAIZE_PACKAGE_RELEASE));

await mkdir(outputDir, { recursive: true });

const tailwindPackagePath = require.resolve("@tailwindcss/cli/package.json");
const tailwindCli = join(dirname(tailwindPackagePath), "dist", "index.mjs");
const noVncPackagePath = require.resolve("@novnc/novnc/package.json");
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

await rm(noVncSourceDir, {
  force: true,
  recursive: true,
});
await mkdir(noVncBundleDir, { recursive: true });
await cp(join(dirname(noVncPackagePath), "lib"), noVncLibraryDir, {
  recursive: true,
  force: true,
});
await writeFile(
  join(noVncSourceDir, "package.json"),
  JSON.stringify({ type: "commonjs" }),
);

const browserFeaturePath = join(noVncLibraryDir, "util", "browser.js");
const browserFeatureSource = await readFile(browserFeaturePath, "utf8");
const browserFeaturePatched = browserFeatureSource.replace(
  "exports.supportsWebCodecsH264Decode = supportsWebCodecsH264Decode = await _checkWebCodecsH264DecodeSupport();",
  "_checkWebCodecsH264DecodeSupport().then(function (supported) {\n  exports.supportsWebCodecsH264Decode = supportsWebCodecsH264Decode = supported;\n}).catch(function (error) {\n  Log.Warn(\"WebCodecs H264 support probe failed: \" + error);\n});",
);

if (browserFeaturePatched === browserFeatureSource) {
  throw new Error("Failed to patch noVNC browser feature detection for the web bundle.");
}

await writeFile(browserFeaturePath, browserFeaturePatched);

await build({
  bundle: true,
  define: {
    __PARALLAIZE_PACKAGE_RELEASE__: appPackageRelease,
    __PARALLAIZE_VERSION__: appVersion,
    "process.env.NODE_ENV": '"production"',
  },
  entryPoints: [join(noVncLibraryDir, "rfb.js")],
  format: "esm",
  legalComments: "none",
  logLevel: "info",
  minify: true,
  outfile: join(noVncBundleDir, "rfb.js"),
  platform: "browser",
  target: ["es2022"],
});

await rm(noVncSourceDir, {
  force: true,
  recursive: true,
});

await build({
  bundle: true,
  define: {
    __PARALLAIZE_PACKAGE_RELEASE__: appPackageRelease,
    __PARALLAIZE_VERSION__: appVersion,
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

function normalizePackageRelease(value) {
  const trimmed = value?.trim();
  return /^[1-9]\d*$/.test(trimmed ?? "") ? trimmed : "1";
}
