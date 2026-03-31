import {
  clearStoredString,
  readStoredString,
  writeStoredString,
} from "./dashboardPersistence.js";

export interface DesktopSessionLease {
  claimedAt: number;
  tabId: string;
  vmId: string;
}

export const desktopSessionLeaseStorageKeyPrefix = "parallaize.desktopSessionLease.";

export function buildDesktopSessionLeaseStorageKey(vmId: string): string {
  return `${desktopSessionLeaseStorageKeyPrefix}${vmId}`;
}

export function parseDesktopSessionLease(
  value: string | null | undefined,
): DesktopSessionLease | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<DesktopSessionLease>;

    if (
      typeof parsed.vmId !== "string" ||
      parsed.vmId.length === 0 ||
      typeof parsed.tabId !== "string" ||
      parsed.tabId.length === 0 ||
      typeof parsed.claimedAt !== "number" ||
      !Number.isFinite(parsed.claimedAt)
    ) {
      return null;
    }

    return {
      claimedAt: parsed.claimedAt,
      tabId: parsed.tabId,
      vmId: parsed.vmId,
    };
  } catch {
    return null;
  }
}

export function readDesktopSessionLease(vmId: string): DesktopSessionLease | null {
  return parseDesktopSessionLease(
    readStoredString(buildDesktopSessionLeaseStorageKey(vmId)),
  );
}

export function claimDesktopSessionLease(
  vmId: string,
  tabId: string,
): DesktopSessionLease {
  const lease = {
    claimedAt: Date.now(),
    tabId,
    vmId,
  } satisfies DesktopSessionLease;

  if (typeof window === "undefined") {
    return lease;
  }

  writeStoredString(
    buildDesktopSessionLeaseStorageKey(vmId),
    JSON.stringify(lease),
  );
  return lease;
}

export function releaseDesktopSessionLease(vmId: string, tabId: string): void {
  const existingLease = readDesktopSessionLease(vmId);

  if (!existingLease || existingLease.tabId !== tabId) {
    return;
  }

  clearStoredString(buildDesktopSessionLeaseStorageKey(vmId));
}
