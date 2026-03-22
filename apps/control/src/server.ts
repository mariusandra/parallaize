import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { extname, join, normalize } from "node:path";
import { pipeline } from "node:stream/promises";

import type {
  AuthStatus,
  ApiResponse,
  CaptureTemplateInput,
  CloneVmInput,
  CreateVmInput,
  DashboardSummary,
  HealthStatus,
  InjectCommandInput,
  LoginInput,
  ResizeVmInput,
  SetVmResolutionInput,
  SnapshotLaunchInput,
  SnapshotInput,
  UpdateVmForwardedPortsInput,
  VmDetail,
} from "../../../packages/shared/src/types.js";
import {
  AdminSessionStore,
  clearSessionCookie,
  parseCookies,
  serializeSessionCookie,
  type SessionValidationResult,
} from "./auth.js";
import { loadConfig } from "./config.js";
import { DesktopManager } from "./manager.js";
import { VmNetworkBridge } from "./network.js";
import { createProvider } from "./providers.js";
import { createSeedState } from "./seed.js";
import { createStateStore } from "./store.js";

const config = loadConfig();
const provider = createProvider(config.providerKind, config.incusBinary, {
  project: config.incusProject ?? undefined,
  storagePool: config.incusStoragePool ?? undefined,
  guestVncPort: config.guestVncPort,
  templateCompression: config.templateCompression,
});
const store = await createStateStore(
  {
    kind: config.persistenceKind,
    dataFile: config.dataFile,
    databaseUrl: config.databaseUrl,
  },
  () => createSeedState(provider.state),
);
const manager = new DesktopManager(store, provider);
const networkBridge = new VmNetworkBridge(manager);
manager.start();

const distRoot = process.cwd();
const staticRoot = join(distRoot, "dist", "apps", "web", "static");
const htmlPath = join(staticRoot, "index.html");
const faviconPath = join(staticRoot, "favicon.svg");
const sessionCookieName = "parallaize_session";
const sessionStore = new AdminSessionStore({
  maxAgeSeconds: config.sessionMaxAgeSeconds,
  rotationWindowSeconds: config.sessionRotationWindowSeconds,
});

interface RequestAuthResult {
  mode: AuthStatus["mode"];
  responseHeaders: Record<string, string>;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    const method = request.method ?? "GET";
    const auth = resolveRequestAuth(request);

    if (method === "GET" && url.pathname === "/api/auth/status") {
      return writeJson<AuthStatus>(response, 200, {
        ok: true,
        data: buildAuthStatus(auth.mode),
      }, auth.responseHeaders);
    }

    if (method === "POST" && url.pathname === "/api/auth/login") {
      return handleLogin(request, response);
    }

    if (method === "POST" && url.pathname === "/api/auth/logout") {
      return handleLogout(request, response);
    }

    if (!isAuthorized(auth.mode) && !isPublicRoute(method, url.pathname)) {
      writeAuthRequired(response, auth.responseHeaders);
      return;
    }

    if (method === "GET" && url.pathname === "/api/health") {
      const providerState = manager.getProviderState();
      const persistence = store.getDiagnostics();
      const status =
        providerState.available && persistence.status === "ready"
          ? "ok"
          : "degraded";

      return writeJson<HealthStatus>(response, 200, {
        ok: true,
        data: {
          status,
          provider: providerState,
          persistence,
          generatedAt: new Date().toISOString(),
        },
      }, auth.responseHeaders);
    }

    if (method === "GET" && url.pathname === "/api/summary") {
      return writeJson<DashboardSummary>(response, 200, {
        ok: true,
        data: manager.getSummary(),
      }, auth.responseHeaders);
    }

    if (method === "GET" && url.pathname === "/events") {
      return handleEvents(response, auth.responseHeaders);
    }

    if (await networkBridge.maybeHandleRequest(request, response, url)) {
      return;
    }

    const vmMatch = url.pathname.match(/^\/api\/vms\/([^/]+)$/);
    if (method === "GET" && vmMatch) {
      return writeJson<VmDetail>(response, 200, {
        ok: true,
        data: manager.getVmDetail(vmMatch[1]),
      }, auth.responseHeaders);
    }

    const frameMatch = url.pathname.match(/^\/api\/vms\/([^/]+)\/frame\.svg$/);
    if (method === "GET" && frameMatch) {
      const mode = url.searchParams.get("mode") === "detail" ? "detail" : "tile";
      const svg = manager.getVmFrame(frameMatch[1], mode);
      response.writeHead(200, {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "no-store",
        ...auth.responseHeaders,
      });
      response.end(svg);
      return;
    }

    const snapshotActionMatch = url.pathname.match(
      /^\/api\/vms\/([^/]+)\/snapshots\/([^/]+)\/(launch|restore)$/,
    );
    if (method === "POST" && snapshotActionMatch) {
      const vmId = snapshotActionMatch[1];
      const snapshotId = snapshotActionMatch[2];
      const action = snapshotActionMatch[3];

      if (action === "launch") {
        const payload = await readJsonBody<SnapshotLaunchInput>(request);
        const vm = manager.launchVmFromSnapshot(vmId, snapshotId, {
          sourceVmId: vmId,
          name: payload.name,
        });
        return writeJson(response, 202, {
          ok: true,
          data: vm,
        }, auth.responseHeaders);
      }

      manager.restoreVmSnapshot(vmId, snapshotId);
      return writeAccepted(response, auth.responseHeaders);
    }

    if (method === "POST" && url.pathname === "/api/vms") {
      const payload = await readJsonBody<CreateVmInput>(request);
      const vm = manager.createVm(payload);
      return writeJson(response, 202, {
        ok: true,
        data: vm,
      }, auth.responseHeaders);
    }

    const forwardsMatch = url.pathname.match(/^\/api\/vms\/([^/]+)\/forwards$/);
    if (method === "POST" && forwardsMatch) {
      const payload = await readJsonBody<UpdateVmForwardedPortsInput>(request);
      manager.updateVmForwardedPorts(forwardsMatch[1], payload);
      return writeAccepted(response, auth.responseHeaders);
    }

    const resolutionMatch = url.pathname.match(/^\/api\/vms\/([^/]+)\/resolution$/);
    if (method === "POST" && resolutionMatch) {
      const payload = await readJsonBody<SetVmResolutionInput>(request);
      await manager.setVmResolution(resolutionMatch[1], payload);
      return writeAccepted(response, auth.responseHeaders);
    }

    const actionMatch = url.pathname.match(/^\/api\/vms\/([^/]+)\/(clone|start|stop|delete|snapshot|resize|template|input)$/);
    if (method === "POST" && actionMatch) {
      const vmId = actionMatch[1];
      const action = actionMatch[2];

      switch (action) {
        case "clone": {
          const payload = await readJsonBody<CloneVmInput>(request);
          const vm = manager.cloneVm({
            sourceVmId: vmId,
            name: payload.name,
          });
          return writeJson(response, 202, {
            ok: true,
            data: vm,
          }, auth.responseHeaders);
        }
        case "start":
          manager.startVm(vmId);
          return writeAccepted(response, auth.responseHeaders);
        case "stop":
          manager.stopVm(vmId);
          return writeAccepted(response, auth.responseHeaders);
        case "delete":
          manager.deleteVm(vmId);
          return writeAccepted(response, auth.responseHeaders);
        case "snapshot": {
          const payload = await readJsonBody<SnapshotInput>(request);
          manager.snapshotVm(vmId, payload);
          return writeAccepted(response, auth.responseHeaders);
        }
        case "resize": {
          const payload = await readJsonBody<ResizeVmInput>(request);
          manager.resizeVm(vmId, payload);
          return writeAccepted(response, auth.responseHeaders);
        }
        case "template": {
          const payload = await readJsonBody<CaptureTemplateInput>(request);
          manager.captureTemplate(vmId, payload);
          return writeAccepted(response, auth.responseHeaders);
        }
        case "input": {
          const payload = await readJsonBody<InjectCommandInput>(request);
          manager.injectCommand(vmId, payload.command);
          return writeAccepted(response, auth.responseHeaders);
        }
        default:
          break;
      }
    }

    if ((method === "GET" || method === "HEAD") && url.pathname === "/") {
      return serveFile(
        response,
        htmlPath,
        "text/html; charset=utf-8",
        method === "HEAD",
        auth.responseHeaders,
      );
    }

    if (
      (method === "GET" || method === "HEAD") &&
      (url.pathname === "/favicon.svg" || url.pathname === "/favicon.ico")
    ) {
      return serveFile(
        response,
        faviconPath,
        "image/svg+xml; charset=utf-8",
        method === "HEAD",
        auth.responseHeaders,
      );
    }

    if ((method === "GET" || method === "HEAD") && url.pathname.startsWith("/assets/")) {
      const resolved = resolveAsset(url.pathname);
      if (resolved) {
        return serveFile(
          response,
          resolved.path,
          resolved.contentType,
          method === "HEAD",
          auth.responseHeaders,
        );
      }
    }

    writeJson(response, 404, {
      ok: false,
      error: `No route matched ${method} ${url.pathname}`,
    }, auth.responseHeaders);
  } catch (error) {
    if (isBenignConnectionError(error)) {
      return;
    }

    if (response.destroyed || response.writableEnded) {
      return;
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    writeJson(response, 500, {
      ok: false,
      error: message,
    });
  }
});

server.on("upgrade", (request, socket, head) => {
  const auth = resolveRequestAuth(request);

  if (!isAuthorized(auth.mode)) {
    writeSocketAuthRequired(socket as Socket, auth.responseHeaders);
    return;
  }

  if (networkBridge.maybeHandleUpgrade(request, socket as Socket, head)) {
    return;
  }

  socket.destroy();
});

server.listen(config.port, config.host, () => {
  const address = server.address();
  const listenPort =
    address && typeof address !== "string" ? address.port : config.port;
  process.stdout.write(
    `parallaize listening on http://${config.host}:${listenPort} using ${provider.state.kind} provider with ${config.persistenceKind} persistence\n`,
  );
  if (config.adminPassword) {
    process.stdout.write(
      `single-admin auth enabled for ${config.adminUsername} (cookie login + basic auth fallback)\n`,
    );
  }
});

registerShutdownHandlers();

function handleEvents(
  response: ServerResponse,
  headers: Record<string, string> = {},
): void {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    ...headers,
  });

  const unsubscribe = manager.subscribe((summary) => {
    response.write(`event: summary\ndata: ${JSON.stringify(summary)}\n\n`);
  });

  const heartbeat = setInterval(() => {
    response.write(`event: heartbeat\ndata: ${Date.now()}\n\n`);
  }, 15000);

  response.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {} as T;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function writeAccepted(
  response: ServerResponse,
  headers: Record<string, string | string[]> = {},
): void {
  writeJson(response, 202, {
    ok: true,
    data: {
      accepted: true,
    },
  }, headers);
}

function writeJson<T>(
  response: ServerResponse,
  statusCode: number,
  payload: ApiResponse<T> | Record<string, unknown>,
  headers: Record<string, string | string[]> = {},
): void {
  if (response.destroyed || response.writableEnded) {
    return;
  }

  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function isAuthorized(mode: AuthStatus["mode"]): boolean {
  return mode !== "unauthenticated";
}

function resolveRequestAuth(request: IncomingMessage): RequestAuthResult {
  if (!config.adminPassword) {
    return {
      mode: "none",
      responseHeaders: {},
    };
  }

  const sessionToken = parseCookies(request.headers.cookie)[sessionCookieName];
  const session = sessionStore.validateSession(sessionToken);
  const sessionHeaders = buildSessionResponseHeaders(session);

  if (session.mode === "session") {
    return {
      mode: "session",
      responseHeaders: sessionHeaders,
    };
  }

  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Basic ")) {
    return {
      mode: "unauthenticated",
      responseHeaders: sessionHeaders,
    };
  }

  let decoded: string;

  try {
    decoded = Buffer.from(authorization.slice("Basic ".length), "base64").toString("utf8");
  } catch {
    return {
      mode: "unauthenticated",
      responseHeaders: sessionHeaders,
    };
  }

  const separatorIndex = decoded.indexOf(":");

  if (separatorIndex === -1) {
    return {
      mode: "unauthenticated",
      responseHeaders: sessionHeaders,
    };
  }

  const username = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);

  return {
    mode:
      safeEqual(username, config.adminUsername) && safeEqual(password, config.adminPassword)
        ? "basic"
        : "unauthenticated",
    responseHeaders: sessionHeaders,
  };
}

function buildAuthStatus(mode: AuthStatus["mode"]): AuthStatus {
  return {
    authEnabled: Boolean(config.adminPassword),
    authenticated: mode !== "unauthenticated",
    username: mode === "session" || mode === "basic" ? config.adminUsername : null,
    mode,
  };
}

async function handleLogin(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (!config.adminPassword) {
    writeJson<AuthStatus>(response, 200, {
      ok: true,
      data: buildAuthStatus("none"),
    });
    return;
  }

  const payload = await readJsonBody<LoginInput>(request);

  if (
    !safeEqual(payload.username ?? "", config.adminUsername) ||
    !safeEqual(payload.password ?? "", config.adminPassword)
  ) {
    const auth = resolveRequestAuth(request);
    writeJson(response, 401, {
      ok: false,
      error: "Invalid username or password.",
    }, auth.responseHeaders);
    return;
  }

  const token = sessionStore.issueSession();

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
        sessionCookieName,
        token,
        sessionStore.maxAgeSeconds,
      ),
    },
  );
}

function handleLogout(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const sessionToken = parseCookies(request.headers.cookie)[sessionCookieName];

  sessionStore.revokeSession(sessionToken);

  writeJson<AuthStatus>(
    response,
    200,
    {
      ok: true,
      data: {
        authEnabled: Boolean(config.adminPassword),
        authenticated: !config.adminPassword,
        username: null,
        mode: config.adminPassword ? "unauthenticated" : "none",
      },
    },
    {
      "set-cookie": clearSessionCookie(sessionCookieName),
    },
  );
}

function safeEqual(left: string, right: string | null): boolean {
  if (right === null) {
    return false;
  }

  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function writeAuthRequired(
  response: ServerResponse,
  headers: Record<string, string | string[]> = {},
): void {
  writeJson(response, 401, {
    ok: false,
    error: "Authentication required.",
  }, headers);
}

function writeSocketAuthRequired(
  socket: Socket,
  headers: Record<string, string | string[]> = {},
): void {
  const serializedHeaders = Object.entries(headers)
    .map(([key, value]) =>
      `${key}: ${Array.isArray(value) ? value.join(", ") : value}\r\n`,
    )
    .join("");

  socket.write(
    "HTTP/1.1 401 Unauthorized\r\n" +
      serializedHeaders +
      "Connection: close\r\n" +
      "Content-Length: 0\r\n\r\n",
  );
  socket.destroy();
}

function isPublicRoute(method: string, pathname: string): boolean {
  if (method === "GET" || method === "HEAD") {
    if (pathname === "/" || pathname === "/favicon.svg" || pathname === "/favicon.ico") {
      return true;
    }

    if (pathname.startsWith("/assets/")) {
      return true;
    }
  }

  return false;
}

function buildSessionResponseHeaders(
  session: SessionValidationResult,
): Record<string, string> {
  if (session.shouldClearCookie) {
    return {
      "set-cookie": clearSessionCookie(sessionCookieName),
    };
  }

  if (session.rotated && session.token) {
    return {
      "set-cookie": serializeSessionCookie(
        sessionCookieName,
        session.token,
        sessionStore.maxAgeSeconds,
      ),
    };
  }

  return {};
}

async function serveFile(
  response: ServerResponse,
  filePath: string,
  contentType: string,
  headOnly = false,
  headers: Record<string, string | string[]> = {},
): Promise<void> {
  if (!existsSync(filePath)) {
    writeJson(response, 404, {
      ok: false,
      error: `Static asset not found: ${filePath}`,
    }, headers);
    return;
  }

  response.writeHead(200, {
    "content-type": contentType,
    "cache-control": "no-store",
    ...headers,
  });

  if (headOnly) {
    response.end();
    return;
  }

  try {
    await pipeline(createReadStream(filePath), response);
  } catch (error) {
    if (isBenignConnectionError(error)) {
      return;
    }

    throw error;
  }
}

function resolveAsset(pathname: string): {
  path: string;
  contentType: string;
} | null {
  const localPath = normalize(pathname.replace(/^\//, ""));
  const safePath = join(staticRoot, localPath);

  if (!safePath.startsWith(staticRoot)) {
    return null;
  }

  return {
    path: safePath,
    contentType: inferContentType(safePath),
  };
}

function inferContentType(filePath: string): string {
  switch (extname(filePath)) {
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".svg":
      return "image/svg+xml; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "text/plain; charset=utf-8";
  }
}

function isBenignConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const nodeError = error as Error & {
    code?: string;
    cause?: {
      code?: string;
    };
  };

  return (
    nodeError.code === "ERR_STREAM_PREMATURE_CLOSE" ||
    nodeError.code === "ECONNRESET" ||
    nodeError.cause?.code === "ECONNRESET"
  );
}

function registerShutdownHandlers(): void {
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    process.stdout.write(`received ${signal}, shutting down parallaize\n`);
    manager.stop();

    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });

    await store.close();
    process.exit(0);
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }
}
