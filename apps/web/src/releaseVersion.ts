import type { LatestReleaseMetadata } from "../../../packages/shared/src/types.js";

declare const __PARALLAIZE_PACKAGE_RELEASE__: string;

export const appPackageReleaseLabel =
  typeof __PARALLAIZE_PACKAGE_RELEASE__ === "string"
    ? normalizePackageRelease(__PARALLAIZE_PACKAGE_RELEASE__)
    : "1";

export function hasNewerReleaseAvailable(
  currentVersion: string,
  currentPackageRelease: string,
  latestRelease: LatestReleaseMetadata | null,
): boolean {
  if (latestRelease === null) {
    return false;
  }

  return (
    compareReleaseLabels(
      currentVersion,
      currentPackageRelease,
      latestRelease.version,
      latestRelease.packageRelease,
    ) < 0
  );
}

export function compareReleaseLabels(
  leftVersion: string,
  leftPackageRelease: string,
  rightVersion: string,
  rightPackageRelease: string,
): number {
  const versionComparison = compareSemver(leftVersion, rightVersion);

  if (versionComparison !== 0) {
    return versionComparison;
  }

  return (
    Number.parseInt(normalizePackageRelease(leftPackageRelease), 10) -
    Number.parseInt(normalizePackageRelease(rightPackageRelease), 10)
  );
}

export function compareSemver(leftVersion: string, rightVersion: string): number {
  const leftParts = leftVersion.split(".").map((part) => Number.parseInt(part, 10));
  const rightParts = rightVersion.split(".").map((part) => Number.parseInt(part, 10));

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }

  return 0;
}

function normalizePackageRelease(value: string): string {
  const trimmed = value.trim();
  return /^[1-9]\d*$/.test(trimmed) ? trimmed : "1";
}
