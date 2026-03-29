import {
  buildResolutionControlLeaseStorageKey,
  canClaimResolutionControlLease,
  createResolutionControlLease,
  parseResolutionControlLease,
  resolutionControlLeaseTtlMs,
} from "./desktopResolution.js";
import {
  clearStoredString,
  readStoredString,
  resolutionControlClientIdStorageKey,
  writeStoredString,
} from "./dashboardPersistence.js";

export type ResolutionControlLeaseOwner = "self" | "other";

export function readOrCreateResolutionControlClientId(): string {
  const existing = readStoredString(resolutionControlClientIdStorageKey)?.trim();

  if (existing) {
    return existing;
  }

  const clientId = `client-${createTabId()}`;
  writeStoredString(resolutionControlClientIdStorageKey, clientId);
  return clientId;
}

export function createTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function claimResolutionControlLease(
  vmId: string,
  tabId: string,
  force = false,
): ResolutionControlLeaseOwner {
  if (typeof window === "undefined") {
    return "self";
  }

  const key = buildResolutionControlLeaseStorageKey(vmId);
  const now = Date.now();
  const existingLease = parseResolutionControlLease(readStoredString(key));

  if (
    !force &&
    !canClaimResolutionControlLease({
      lease: existingLease,
      now,
      tabId,
      ttlMs: resolutionControlLeaseTtlMs,
      vmId,
    })
  ) {
    return "other";
  }

  writeStoredString(key, JSON.stringify(createResolutionControlLease(vmId, tabId, now)));
  const confirmedLease = parseResolutionControlLease(readStoredString(key));

  return confirmedLease?.tabId === tabId ? "self" : "other";
}

export function releaseResolutionControlLease(vmId: string, tabId: string): void {
  const key = buildResolutionControlLeaseStorageKey(vmId);
  const existingLease = parseResolutionControlLease(readStoredString(key));

  if (!existingLease || existingLease.tabId !== tabId) {
    return;
  }

  clearStoredString(key);
}
