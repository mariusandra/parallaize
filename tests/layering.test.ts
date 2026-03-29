import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const webRoot = resolve(repoRoot, "apps/web/src");
const controlRoot = resolve(repoRoot, "apps/control/src");
const sharedRoot = resolve(repoRoot, "packages/shared/src");
const dashboardTransportPath = resolve(webRoot, "dashboardTransport.ts");
const dashboardFullscreenPath = resolve(webRoot, "dashboardFullscreen.ts");
const dashboardPersistencePath = resolve(webRoot, "dashboardPersistence.ts");
const dashboardResolutionControlPath = resolve(
  webRoot,
  "dashboardResolutionControl.ts",
);
const storeNormalizePath = resolve(controlRoot, "store-normalize.ts");
const storeJsonPath = resolve(controlRoot, "store-json.ts");
const storePostgresPath = resolve(controlRoot, "store-postgres.ts");

test("web and control runtimes stay separated by import boundaries", () => {
  const violations: string[] = [];

  for (const filePath of listSourceFiles(webRoot)) {
    for (const specifier of readImportSpecifiers(filePath)) {
      const resolved = resolveInternalImport(filePath, specifier);
      if (resolved && isWithinRoot(resolved, controlRoot)) {
        violations.push(`${relativeToRepo(filePath)} imports control module ${specifier}`);
      }
    }
  }

  for (const filePath of listSourceFiles(controlRoot)) {
    for (const specifier of readImportSpecifiers(filePath)) {
      const resolved = resolveInternalImport(filePath, specifier);
      if (resolved && isWithinRoot(resolved, webRoot)) {
        violations.push(`${relativeToRepo(filePath)} imports web module ${specifier}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("shared contracts stay free of Node, React, and app-runtime imports", () => {
  const violations: string[] = [];

  for (const filePath of listSourceFiles(sharedRoot)) {
    for (const specifier of readImportSpecifiers(filePath)) {
      if (
        specifier.startsWith("node:") ||
        specifier === "react" ||
        specifier.startsWith("react/")
      ) {
        violations.push(`${relativeToRepo(filePath)} imports runtime dependency ${specifier}`);
        continue;
      }

      const resolved = resolveInternalImport(filePath, specifier);
      if (
        resolved &&
        (isWithinRoot(resolved, webRoot) || isWithinRoot(resolved, controlRoot))
      ) {
        violations.push(`${relativeToRepo(filePath)} imports app module ${specifier}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("extracted runtime helpers keep transport and persistence boundaries narrow", () => {
  const violations: string[] = [];

  for (const specifier of readImportSpecifiers(dashboardTransportPath)) {
    if (specifier === "react" || specifier.startsWith("react/")) {
      violations.push("apps/web/src/dashboardTransport.ts imports React");
    }
  }

  for (const specifier of readImportSpecifiers(dashboardFullscreenPath)) {
    if (specifier === "react" || specifier.startsWith("react/")) {
      violations.push("apps/web/src/dashboardFullscreen.ts imports React");
    }
  }

  for (const specifier of readImportSpecifiers(dashboardPersistencePath)) {
    if (specifier === "react" || specifier.startsWith("react/")) {
      violations.push("apps/web/src/dashboardPersistence.ts imports React");
    }
  }

  for (const specifier of readImportSpecifiers(dashboardResolutionControlPath)) {
    if (specifier === "react" || specifier.startsWith("react/")) {
      violations.push("apps/web/src/dashboardResolutionControl.ts imports React");
    }
  }

  for (const specifier of readImportSpecifiers(storeNormalizePath)) {
    if (specifier.startsWith("node:") || specifier === "pg") {
      violations.push(`apps/control/src/store-normalize.ts imports runtime adapter ${specifier}`);
    }
  }

  for (const specifier of readImportSpecifiers(storeJsonPath)) {
    if (specifier === "pg") {
      violations.push("apps/control/src/store-json.ts imports pg");
    }
  }

  for (const specifier of readImportSpecifiers(storePostgresPath)) {
    if (specifier.startsWith("node:fs")) {
      violations.push(`apps/control/src/store-postgres.ts imports filesystem helper ${specifier}`);
    }
  }

  assert.deepEqual(violations, []);
});

function listSourceFiles(root: string): string[] {
  const entries = readdirSync(root);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = resolve(root, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
      continue;
    }

    if (fullPath.endsWith(".ts") || fullPath.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }

  return files;
}

function readImportSpecifiers(filePath: string): string[] {
  const source = readFileSync(filePath, "utf8");
  const matches = source.matchAll(
    /(?:import|export)\s[\s\S]*?\bfrom\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g,
  );

  return [...matches].map((match) => match[1] ?? match[2]).filter(Boolean);
}

function resolveInternalImport(filePath: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }

  return resolve(dirname(filePath), specifier);
}

function isWithinRoot(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

function relativeToRepo(filePath: string): string {
  return filePath.slice(repoRoot.length + 1);
}
