import type { LatestReleaseMetadata } from "../../../packages/shared/src/types.js";

declare const __PARALLAIZE_PACKAGE_RELEASE__: string;

export type ReleaseIndicatorSeverity = "patch" | "minor" | "major";

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

export function classifyAvailableRelease(
  currentVersion: string,
  currentPackageRelease: string,
  latestRelease: LatestReleaseMetadata | null,
): ReleaseIndicatorSeverity | null {
  if (
    latestRelease === null ||
    compareReleaseLabels(
      currentVersion,
      currentPackageRelease,
      latestRelease.version,
      latestRelease.packageRelease,
    ) >= 0
  ) {
    return null;
  }

  const currentParts = parseSemver(currentVersion);
  const latestParts = parseSemver(latestRelease.version);

  if (latestParts[0] > currentParts[0]) {
    return "major";
  }

  if (latestParts[1] > currentParts[1]) {
    return "minor";
  }

  return "patch";
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
  const leftParts = parseSemver(leftVersion);
  const rightParts = parseSemver(rightVersion);

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

function parseSemver(version: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = version
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  return [major, minor, patch];
}
