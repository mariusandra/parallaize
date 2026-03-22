import { randomBytes } from "node:crypto";

export interface AdminSessionStoreConfig {
  maxAgeSeconds: number;
  rotationWindowSeconds: number;
  now?: () => number;
  createToken?: () => string;
}

interface SessionRecord {
  expiresAt: number;
}

export interface SessionValidationResult {
  mode: "session" | "unauthenticated";
  token: string | null;
  shouldClearCookie: boolean;
  rotated: boolean;
}

export class AdminSessionStore {
  readonly maxAgeSeconds: number;

  private readonly sessions = new Map<string, SessionRecord>();
  private readonly now: () => number;
  private readonly createToken: () => string;
  private readonly maxAgeMs: number;
  private readonly rotationWindowMs: number;

  constructor(config: AdminSessionStoreConfig) {
    this.maxAgeSeconds = normalizeSeconds(config.maxAgeSeconds, 60 * 60 * 24 * 7);
    this.maxAgeMs = this.maxAgeSeconds * 1000;
    this.rotationWindowMs =
      normalizeSeconds(config.rotationWindowSeconds, 60 * 60 * 24) * 1000;
    this.now = config.now ?? (() => Date.now());
    this.createToken = config.createToken ?? defaultCreateSessionToken;
  }

  issueSession(): string {
    this.pruneExpiredSessions();
    this.sessions.clear();

    const token = this.createToken();
    this.sessions.set(token, {
      expiresAt: this.now() + this.maxAgeMs,
    });

    return token;
  }

  revokeSession(token: string | undefined): void {
    if (!token) {
      return;
    }

    this.sessions.delete(token);
  }

  validateSession(token: string | undefined): SessionValidationResult {
    this.pruneExpiredSessions();

    if (!token) {
      return {
        mode: "unauthenticated",
        token: null,
        shouldClearCookie: false,
        rotated: false,
      };
    }

    const session = this.sessions.get(token);

    if (!session) {
      return {
        mode: "unauthenticated",
        token: null,
        shouldClearCookie: true,
        rotated: false,
      };
    }

    const now = this.now();
    if (session.expiresAt <= now) {
      this.sessions.delete(token);
      return {
        mode: "unauthenticated",
        token: null,
        shouldClearCookie: true,
        rotated: false,
      };
    }

    if (session.expiresAt - now <= this.rotationWindowMs) {
      this.sessions.delete(token);

      const nextToken = this.createToken();
      this.sessions.set(nextToken, {
        expiresAt: now + this.maxAgeMs,
      });

      return {
        mode: "session",
        token: nextToken,
        shouldClearCookie: false,
        rotated: true,
      };
    }

    return {
      mode: "session",
      token,
      shouldClearCookie: false,
      rotated: false,
    };
  }

  private pruneExpiredSessions(): void {
    const now = this.now();

    for (const [token, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) {
        this.sessions.delete(token);
      }
    }
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) {
    return {};
  }

  const entries = header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  const cookies: Record<string, string> = {};

  for (const entry of entries) {
    const separatorIndex = entry.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1).trim();

    if (!key) {
      continue;
    }

    cookies[key] = value;
  }

  return cookies;
}

export function serializeSessionCookie(
  cookieName: string,
  token: string,
  maxAgeSeconds: number,
): string {
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie(cookieName: string): string {
  return `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function normalizeSeconds(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.trunc(value));
}

function defaultCreateSessionToken(): string {
  return randomBytes(24).toString("base64url");
}
