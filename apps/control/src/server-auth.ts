import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";

import type {
  AdminSessionRecord,
  AuthStatus,
  LoginInput,
} from "../../../packages/shared/src/types.js";
import type { AppConfig } from "./config.js";
import { readJsonBody, writeJson } from "./server-http.js";
import type { StateStore } from "./store.js";

export interface AuthContext {
  sessionId: string | null;
  setCookie: string | null;
  status: AuthStatus;
}

interface ParsedSessionCookie {
  sessionId: string;
  secret: string;
}

interface ServerAuthOptions {
  config: AppConfig;
  maxAdminSessions?: number;
  sessionCookieName?: string;
  store: StateStore;
}

export function createServerAuth({
  config,
  maxAdminSessions = 32,
  sessionCookieName = "parallaize_session",
  store,
}: ServerAuthOptions): {
  applyAuthContext(response: ServerResponse, authContext: AuthContext): void;
  handleLogin(request: IncomingMessage, response: ServerResponse): Promise<void>;
  handleLogout(request: IncomingMessage, response: ServerResponse): void;
  resolveAuthContext(request: IncomingMessage): AuthContext;
  writeAuthRequired(response: ServerResponse): void;
  writeSocketAuthRequired(socket: Socket): void;
} {
  function applyAuthContext(response: ServerResponse, authContext: AuthContext): void {
    if (authContext.setCookie) {
      response.setHeader("set-cookie", authContext.setCookie);
    }
  }

  function resolveAuthContext(request: IncomingMessage): AuthContext {
    const adminPassword = config.adminPassword;

    if (!adminPassword) {
      return {
        sessionId: null,
        setCookie: null,
        status: buildNoAuthStatus(),
      };
    }

    const sessionCookie = parseCookies(request.headers.cookie)[sessionCookieName];

    if (!sessionCookie) {
      return {
        sessionId: null,
        setCookie: null,
        status: buildUnauthenticatedStatus(),
      };
    }

    const parsedSession = parseSessionCookie(sessionCookie);

    if (!parsedSession) {
      return {
        sessionId: null,
        setCookie: clearSessionCookie(sessionCookieName),
        status: buildUnauthenticatedStatus(),
      };
    }

    const now = new Date();
    const credentialFingerprint = buildCredentialFingerprint(
      config.adminUsername,
      adminPassword,
    );
    let sessionId: string | null = null;
    let setCookie: string | null = null;

    store.update((draft) => {
      let dirty = pruneAdminSessions(
        draft,
        now,
        credentialFingerprint,
        maxAdminSessions,
      );
      const session = draft.adminSessions.find((entry) => entry.id === parsedSession.sessionId);

      if (!session) {
        return dirty;
      }

      if (
        !safeEqual(hashSessionSecret(parsedSession.secret), session.secretHash) ||
        !safeEqual(session.username, config.adminUsername)
      ) {
        return dirty;
      }

      sessionId = session.id;

      if (shouldRotateAdminSession(session, now, config.sessionRotationSeconds)) {
        const rotatedSecret = createSessionSecret();
        const nowIso = now.toISOString();

        session.secretHash = hashSessionSecret(rotatedSecret);
        session.lastAuthenticatedAt = nowIso;
        session.lastRotatedAt = nowIso;
        session.idleExpiresAt = addSeconds(now, config.sessionIdleTimeoutSeconds).toISOString();
        setCookie = serializeSessionCookie(
          buildSessionCookieValue(session.id, rotatedSecret),
          sessionCookieName,
          config.sessionMaxAgeSeconds,
        );
        dirty = true;
      }

      return dirty;
    });

    if (!sessionId) {
      return {
        sessionId: null,
        setCookie: clearSessionCookie(sessionCookieName),
        status: buildUnauthenticatedStatus(),
      };
    }

    return {
      sessionId,
      setCookie,
      status: {
        authEnabled: true,
        authenticated: true,
        username: config.adminUsername,
        mode: "session",
      },
    };
  }

  async function handleLogin(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const adminPassword = config.adminPassword;

    if (!adminPassword) {
      writeJson<AuthStatus>(response, 200, {
        ok: true,
        data: buildNoAuthStatus(),
      });
      return;
    }

    const payload = await readJsonBody<LoginInput>(request);

    if (
      !safeEqual(payload.username ?? "", config.adminUsername) ||
      !safeEqual(payload.password ?? "", adminPassword)
    ) {
      writeJson(response, 401, {
        ok: false,
        error: "Invalid username or password.",
      });
      return;
    }

    const now = new Date();
    const sessionId = createSessionId();
    const sessionSecret = createSessionSecret();
    const credentialFingerprint = buildCredentialFingerprint(
      config.adminUsername,
      adminPassword,
    );

    store.update((draft) => {
      pruneAdminSessions(draft, now, credentialFingerprint, maxAdminSessions);
      draft.adminSessions.unshift({
        id: sessionId,
        username: config.adminUsername,
        credentialFingerprint,
        secretHash: hashSessionSecret(sessionSecret),
        createdAt: now.toISOString(),
        lastAuthenticatedAt: now.toISOString(),
        lastRotatedAt: now.toISOString(),
        expiresAt: addSeconds(now, config.sessionMaxAgeSeconds).toISOString(),
        idleExpiresAt: addSeconds(now, config.sessionIdleTimeoutSeconds).toISOString(),
      });
      draft.adminSessions = draft.adminSessions.slice(0, maxAdminSessions);
    });

    writeJson<AuthStatus>(
      response,
      200,
      {
        ok: true,
        data: {
          authEnabled: true,
          authenticated: true,
          username: config.adminUsername,
          mode: "session",
        },
      },
      {
        "set-cookie": serializeSessionCookie(
          buildSessionCookieValue(sessionId, sessionSecret),
          sessionCookieName,
          config.sessionMaxAgeSeconds,
        ),
      },
    );
  }

  function handleLogout(
    request: IncomingMessage,
    response: ServerResponse,
  ): void {
    const parsedSession = parseSessionCookie(
      parseCookies(request.headers.cookie)[sessionCookieName] ?? "",
    );

    if (parsedSession) {
      store.update((draft) => {
        const nextSessions = draft.adminSessions.filter(
          (entry) => entry.id !== parsedSession.sessionId,
        );

        if (nextSessions.length === draft.adminSessions.length) {
          return false;
        }

        draft.adminSessions = nextSessions;
        return true;
      });
    }

    writeJson<AuthStatus>(
      response,
      200,
      {
        ok: true,
        data: config.adminPassword ? buildUnauthenticatedStatus() : buildNoAuthStatus(),
      },
      {
        "set-cookie": clearSessionCookie(sessionCookieName),
      },
    );
  }

  function writeAuthRequired(response: ServerResponse): void {
    writeJson(response, 401, {
      ok: false,
      error: "Authentication required.",
    });
  }

  function writeSocketAuthRequired(socket: Socket): void {
    socket.write(
      "HTTP/1.1 401 Unauthorized\r\n" +
        "Connection: close\r\n" +
        "Content-Length: 0\r\n\r\n",
    );
    socket.destroy();
  }

  return {
    applyAuthContext,
    handleLogin,
    handleLogout,
    resolveAuthContext,
    writeAuthRequired,
    writeSocketAuthRequired,
  };
}

function safeEqual(left: string, right: string | null): boolean {
  if (right === null) {
    return false;
  }

  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function buildNoAuthStatus(): AuthStatus {
  return {
    authEnabled: false,
    authenticated: true,
    username: null,
    mode: "none",
  };
}

function buildUnauthenticatedStatus(): AuthStatus {
  return {
    authEnabled: true,
    authenticated: false,
    username: null,
    mode: "unauthenticated",
  };
}

function createSessionId(): string {
  return randomBytes(12).toString("base64url");
}

function createSessionSecret(): string {
  return randomBytes(24).toString("base64url");
}

function buildSessionCookieValue(sessionId: string, secret: string): string {
  return `${sessionId}.${secret}`;
}

function parseSessionCookie(raw: string): ParsedSessionCookie | null {
  const separatorIndex = raw.indexOf(".");

  if (separatorIndex <= 0 || separatorIndex === raw.length - 1) {
    return null;
  }

  return {
    sessionId: raw.slice(0, separatorIndex),
    secret: raw.slice(separatorIndex + 1),
  };
}

function hashSessionSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function buildCredentialFingerprint(username: string, password: string): string {
  return createHash("sha256").update(`${username}\n${password}`).digest("hex");
}

function shouldRotateAdminSession(
  session: Pick<AdminSessionRecord, "idleExpiresAt" | "lastRotatedAt">,
  now: Date,
  sessionRotationSeconds: number,
): boolean {
  const lastRotatedAtMs = Date.parse(session.lastRotatedAt);
  const idleExpiresAtMs = Date.parse(session.idleExpiresAt);

  if (!Number.isFinite(lastRotatedAtMs) || !Number.isFinite(idleExpiresAtMs)) {
    return true;
  }

  return (
    now.getTime() >= lastRotatedAtMs + sessionRotationSeconds * 1000 ||
    now.getTime() >= idleExpiresAtMs - sessionRotationSeconds * 1000
  );
}

function pruneAdminSessions(
  draft: {
    adminSessions: AdminSessionRecord[];
  },
  now: Date,
  credentialFingerprint: string,
  maxAdminSessions: number,
): boolean {
  const nextSessions = draft.adminSessions
    .filter(
      (session) =>
        session.credentialFingerprint === credentialFingerprint &&
        !isExpiredAdminSession(session, now),
    )
    .sort((left, right) => {
      const rightMs = Date.parse(right.lastAuthenticatedAt);
      const leftMs = Date.parse(left.lastAuthenticatedAt);
      return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
    })
    .slice(0, maxAdminSessions);

  if (
    nextSessions.length === draft.adminSessions.length &&
    nextSessions.every((session, index) =>
      sameAdminSessionRecord(session, draft.adminSessions[index]),
    )
  ) {
    return false;
  }

  draft.adminSessions = nextSessions;
  return true;
}

function sameAdminSessionRecord(
  left: AdminSessionRecord | undefined,
  right: AdminSessionRecord | undefined,
): boolean {
  return (
    Boolean(left) &&
    Boolean(right) &&
    left?.id === right?.id &&
    left?.username === right?.username &&
    left?.credentialFingerprint === right?.credentialFingerprint &&
    left?.secretHash === right?.secretHash &&
    left?.createdAt === right?.createdAt &&
    left?.lastAuthenticatedAt === right?.lastAuthenticatedAt &&
    left?.lastRotatedAt === right?.lastRotatedAt &&
    left?.expiresAt === right?.expiresAt &&
    left?.idleExpiresAt === right?.idleExpiresAt
  );
}

function isExpiredAdminSession(
  session: Pick<AdminSessionRecord, "createdAt" | "expiresAt" | "idleExpiresAt">,
  now: Date,
): boolean {
  const createdAtMs = Date.parse(session.createdAt);
  const expiresAtMs = Date.parse(session.expiresAt);
  const idleExpiresAtMs = Date.parse(session.idleExpiresAt);

  if (
    !Number.isFinite(createdAtMs) ||
    !Number.isFinite(expiresAtMs) ||
    !Number.isFinite(idleExpiresAtMs)
  ) {
    return true;
  }

  return now.getTime() >= expiresAtMs || now.getTime() >= idleExpiresAtMs;
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function serializeSessionCookie(
  token: string,
  sessionCookieName: string,
  sessionMaxAgeSeconds: number,
): string {
  return `${sessionCookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionMaxAgeSeconds}`;
}

function clearSessionCookie(sessionCookieName: string): string {
  return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) {
    return {};
  }

  const entries = header.split(";").map((part) => part.trim()).filter(Boolean);
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
