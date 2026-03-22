import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import type { ApiResponse, AuthStatus, DashboardSummary } from "../packages/shared/src/types.js";
import { startBuiltServer } from "./server-test-helpers.js";

const adminUsername = "admin";
const adminPassword = "change-me";
const sessionCookieName = "parallaize_session";

test("login and logout gate the protected routes behind the browser session cookie", async (context) => {
  const server = await startBuiltServer({
    PARALLAIZE_ADMIN_USERNAME: adminUsername,
    PARALLAIZE_ADMIN_PASSWORD: adminPassword,
  });
  context.after(async () => {
    await server.stop();
  });

  const initialStatus = await fetchOkJson<AuthStatus>(`${server.baseUrl}/api/auth/status`);
  assert.equal(initialStatus.authEnabled, true);
  assert.equal(initialStatus.authenticated, false);
  assert.equal(initialStatus.mode, "unauthenticated");

  const anonymousSummary = await fetch(`${server.baseUrl}/api/summary`);
  assert.equal(anonymousSummary.status, 401);

  const invalidLogin = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      username: adminUsername,
      password: "wrong-password",
    }),
  });
  assert.equal(invalidLogin.status, 401);

  const login = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      username: adminUsername,
      password: adminPassword,
    }),
  });
  const loginPayload = (await login.json()) as ApiResponse<AuthStatus>;
  const sessionCookie = readRequiredSessionCookie(login);

  assert.equal(login.status, 200);
  assert.equal(loginPayload.ok, true);
  assert.ok(sessionCookie.includes(`${sessionCookieName}=`));

  const authenticatedStatus = await fetchOkJson<AuthStatus>(`${server.baseUrl}/api/auth/status`, {
    headers: {
      cookie: sessionCookie,
    },
  });
  assert.equal(authenticatedStatus.authenticated, true);
  assert.equal(authenticatedStatus.mode, "session");

  const summary = await fetchOkJson<DashboardSummary>(`${server.baseUrl}/api/summary`, {
    headers: {
      cookie: sessionCookie,
    },
  });
  assert.ok(summary.vms.length >= 1);

  const logout = await fetch(`${server.baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: {
      cookie: sessionCookie,
      "content-type": "application/json",
    },
    body: "{}",
  });
  const logoutPayload = (await logout.json()) as ApiResponse<AuthStatus>;
  const clearedCookie = logout.headers.get("set-cookie") ?? "";

  assert.equal(logout.status, 200);
  assert.equal(logoutPayload.ok, true);
  assert.match(clearedCookie, /Max-Age=0/);

  const rejectedSummary = await fetch(`${server.baseUrl}/api/summary`, {
    headers: {
      cookie: sessionCookie,
    },
  });
  assert.equal(rejectedSummary.status, 401);
});

test("sessions rotate before expiry and expire after the max age when left idle", async (context) => {
  const server = await startBuiltServer({
    PARALLAIZE_ADMIN_USERNAME: adminUsername,
    PARALLAIZE_ADMIN_PASSWORD: adminPassword,
    PARALLAIZE_SESSION_MAX_AGE_SECONDS: "2",
    PARALLAIZE_SESSION_ROTATION_WINDOW_SECONDS: "1",
  });
  context.after(async () => {
    await server.stop();
  });

  const login = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      username: adminUsername,
      password: adminPassword,
    }),
  });
  const originalCookie = readRequiredSessionCookie(login);

  await delay(1_100);

  const rotatedStatus = await fetch(`${server.baseUrl}/api/auth/status`, {
    headers: {
      cookie: originalCookie,
    },
  });
  const rotatedPayload = (await rotatedStatus.json()) as ApiResponse<AuthStatus>;
  const rotatedCookie = readRequiredSessionCookie(rotatedStatus);

  assert.equal(rotatedStatus.status, 200);
  assert.equal(rotatedPayload.ok, true);
  assert.notEqual(readSessionToken(rotatedCookie), readSessionToken(originalCookie));

  const staleSummary = await fetch(`${server.baseUrl}/api/summary`, {
    headers: {
      cookie: originalCookie,
    },
  });
  assert.equal(staleSummary.status, 401);
  assert.match(staleSummary.headers.get("set-cookie") ?? "", /Max-Age=0/);

  const rotatedSummary = await fetch(`${server.baseUrl}/api/summary`, {
    headers: {
      cookie: rotatedCookie,
    },
  });
  assert.equal(rotatedSummary.status, 200);

  await delay(2_100);

  const expiredStatus = await fetch(`${server.baseUrl}/api/auth/status`, {
    headers: {
      cookie: rotatedCookie,
    },
  });
  const expiredPayload = (await expiredStatus.json()) as ApiResponse<AuthStatus>;

  assert.equal(expiredStatus.status, 200);
  assert.equal(expiredPayload.ok, true);

  if (!expiredPayload.ok) {
    throw new Error("Expected an auth status response.");
  }

  assert.equal(expiredPayload.data.authenticated, false);
  assert.equal(expiredPayload.data.mode, "unauthenticated");
  assert.match(expiredStatus.headers.get("set-cookie") ?? "", /Max-Age=0/);
});

test("browser sessions are intentionally invalidated when the control plane restarts", async (context) => {
  const firstServer = await startBuiltServer({
    PARALLAIZE_ADMIN_USERNAME: adminUsername,
    PARALLAIZE_ADMIN_PASSWORD: adminPassword,
  });
  context.after(async () => {
    await firstServer.stop();
  });

  const login = await fetch(`${firstServer.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      username: adminUsername,
      password: adminPassword,
    }),
  });
  const sessionCookie = readRequiredSessionCookie(login);

  await firstServer.stop();

  const secondServer = await startBuiltServer({
    PARALLAIZE_ADMIN_USERNAME: adminUsername,
    PARALLAIZE_ADMIN_PASSWORD: adminPassword,
  });
  context.after(async () => {
    await secondServer.stop();
  });

  const restartedStatus = await fetch(`${secondServer.baseUrl}/api/auth/status`, {
    headers: {
      cookie: sessionCookie,
    },
  });
  const restartedPayload = (await restartedStatus.json()) as ApiResponse<AuthStatus>;

  assert.equal(restartedStatus.status, 200);
  assert.equal(restartedPayload.ok, true);

  if (!restartedPayload.ok) {
    throw new Error("Expected an auth status response.");
  }

  assert.equal(restartedPayload.data.authenticated, false);
  assert.equal(restartedPayload.data.mode, "unauthenticated");
  assert.match(restartedStatus.headers.get("set-cookie") ?? "", /Max-Age=0/);
});

async function fetchOkJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(5_000),
  });
  const payload = (await response.json()) as ApiResponse<T>;

  assert.equal(response.ok, true, `Expected ${url} to return 2xx, received ${response.status}`);
  assert.equal(payload.ok, true, `Expected ${url} to return an ok payload`);

  if (!payload.ok) {
    throw new Error(`Request returned an error payload for ${url}`);
  }

  return payload.data;
}

function readRequiredSessionCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const token = readSessionToken(setCookie);

  assert.ok(token, `Expected a ${sessionCookieName} cookie to be set.`);
  return `${sessionCookieName}=${token}`;
}

function readSessionToken(cookieHeader: string): string | null {
  const match = cookieHeader.match(new RegExp(`${sessionCookieName}=([^;]+)`));
  return match?.[1] ?? null;
}
