import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type VmGuestStreamHealthStatus = "ready" | "degraded" | "unhealthy";

export interface VmGuestStreamHealthSample {
  desktopHealthy: boolean;
  localReachable: boolean;
  reason: string | null;
  sampledAt: string;
  serviceActive: boolean;
  source: string | null;
  status: VmGuestStreamHealthStatus;
}

export function loadOrCreateStreamHealthSecret(filePath: string): string {
  const existing =
    existsSync(filePath) ? readFileSync(filePath, "utf8").trim() : "";

  if (existing) {
    return existing;
  }

  const secret = createStreamHealthSecret();
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${secret}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return secret;
}

export function createStreamHealthSecret(): string {
  return randomBytes(24).toString("base64url");
}

export function buildVmStreamHealthToken(secret: string, vmId: string): string {
  return createHash("sha256").update(`${secret}\n${vmId}`).digest("hex");
}

export function sameVmStreamHealthToken(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    leftBuffer.length > 0 &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function parseVmGuestStreamHealthSample(
  value: unknown,
): VmGuestStreamHealthSample {
  if (!value || typeof value !== "object") {
    throw new Error("Stream health payload must be an object.");
  }

  const payload = value as Record<string, unknown>;
  const sampledAt = normalizeIsoTimestamp(payload.sampledAt);
  const status = normalizeStatus(payload.status);

  return {
    desktopHealthy: payload.desktopHealthy === true,
    localReachable: payload.localReachable === true,
    reason: normalizeOptionalString(payload.reason),
    sampledAt,
    serviceActive: payload.serviceActive === true,
    source: normalizeOptionalString(payload.source),
    status,
  };
}

function normalizeIsoTimestamp(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return new Date().toISOString();
  }

  const parsedAt = Date.parse(value);
  return Number.isFinite(parsedAt) ? new Date(parsedAt).toISOString() : new Date().toISOString();
}

function normalizeStatus(value: unknown): VmGuestStreamHealthStatus {
  switch (value) {
    case "ready":
    case "degraded":
    case "unhealthy":
      return value;
    default:
      throw new Error("Stream health status must be ready, degraded, or unhealthy.");
  }
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
