import type { LatestReleaseMetadata } from "../../../packages/shared/src/types.js";

const defaultLatestReleaseCacheTtlMs = 10 * 60 * 1000;

export function createLatestReleaseMetadataCache(input: {
  releaseMetadataUrl: string;
  ttlMs?: number;
}): {
  getLatestReleaseMetadata(): Promise<LatestReleaseMetadata | null>;
} {
  const ttlMs = input.ttlMs ?? defaultLatestReleaseCacheTtlMs;
  let latestReleaseCache: {
    expiresAtMs: number;
    value: LatestReleaseMetadata | null;
  } | null = null;
  let latestReleasePromise: Promise<LatestReleaseMetadata | null> | null = null;

  return {
    async getLatestReleaseMetadata(): Promise<LatestReleaseMetadata | null> {
      const now = Date.now();

      if (latestReleaseCache && now < latestReleaseCache.expiresAtMs) {
        return latestReleaseCache.value;
      }

      if (latestReleasePromise) {
        return latestReleasePromise;
      }

      latestReleasePromise = loadLatestReleaseMetadata(input.releaseMetadataUrl, ttlMs).finally(
        () => {
          latestReleasePromise = null;
        },
      );

      const nextValue = await latestReleasePromise;
      latestReleaseCache = {
        expiresAtMs: Date.now() + ttlMs,
        value: nextValue,
      };
      return nextValue;
    },
  };
}

export function parseLatestReleaseMetadata(value: unknown): LatestReleaseMetadata | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  const version = normalizeStableSemver(value.version);
  const packageRelease = normalizePackageRelease(value.packageRelease);

  if (!version || !packageRelease) {
    return null;
  }

  const packageLabel =
    normalizeNonEmptyString(value.packageLabel) ?? `${version}-${packageRelease}`;

  return {
    version,
    packageRelease,
    packageLabel,
  };
}

async function loadLatestReleaseMetadata(
  releaseMetadataUrl: string,
  ttlMs: number,
): Promise<LatestReleaseMetadata | null> {
  try {
    const response = await fetch(releaseMetadataUrl, {
      headers: {
        accept: "application/json",
      },
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) {
      return null;
    }

    return parseLatestReleaseMetadata(await response.json());
  } catch {
    return null;
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeStableSemver(value: unknown): string | null {
  const normalized = normalizeNonEmptyString(value);
  return normalized && /^\d+\.\d+\.\d+$/u.test(normalized) ? normalized : null;
}

function normalizePackageRelease(value: unknown): string | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return String(value);
  }

  const normalized = normalizeNonEmptyString(value);
  return normalized && /^[1-9]\d*$/u.test(normalized) ? normalized : null;
}
