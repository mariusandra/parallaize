import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import type { CurrentReleaseMetadata } from "../../../packages/shared/src/types.js";

declare const __PARALLAIZE_PACKAGE_RELEASE__: string | undefined;
declare const __PARALLAIZE_VERSION__: string | undefined;

export function resolveCurrentReleaseMetadata(appHome = process.cwd()): CurrentReleaseMetadata {
  const version =
    normalizeStableSemver(resolveBuildConstant("__PARALLAIZE_VERSION__")) ??
    normalizeStableSemver(readPackageVersion(appHome)) ??
    "0.0.0";
  const packageRelease =
    normalizePackageRelease(resolveBuildConstant("__PARALLAIZE_PACKAGE_RELEASE__")) ??
    normalizePackageRelease(process.env.PARALLAIZE_PACKAGE_RELEASE) ??
    "1";

  return {
    version,
    packageRelease,
    packageLabel: `${version}-${packageRelease}`,
  };
}

function resolveBuildConstant(
  name: "__PARALLAIZE_PACKAGE_RELEASE__" | "__PARALLAIZE_VERSION__",
): string | null {
  try {
    if (name === "__PARALLAIZE_VERSION__" && typeof __PARALLAIZE_VERSION__ === "string") {
      return __PARALLAIZE_VERSION__;
    }

    if (
      name === "__PARALLAIZE_PACKAGE_RELEASE__" &&
      typeof __PARALLAIZE_PACKAGE_RELEASE__ === "string"
    ) {
      return __PARALLAIZE_PACKAGE_RELEASE__;
    }
  } catch {
    return null;
  }

  return null;
}

function readPackageVersion(appHome: string): string | null {
  try {
    const packageJson = JSON.parse(readFileSync(join(appHome, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof packageJson.version === "string" ? packageJson.version : null;
  } catch {
    return null;
  }
}

function normalizeStableSemver(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed && /^\d+\.\d+\.\d+$/u.test(trimmed) ? trimmed : null;
}

function normalizePackageRelease(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed && /^[1-9]\d*$/u.test(trimmed) ? trimmed : null;
}
