import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { extname, join, normalize } from "node:path";
import { pipeline } from "node:stream/promises";

import type {
  ApiResponse,
  CaptureTemplateInput,
  CloneVmInput,
  CreateVmInput,
  DashboardSummary,
  InjectCommandInput,
  ResizeVmInput,
  SnapshotInput,
  UpdateVmForwardedPortsInput,
  VmDetail,
} from "../../../packages/shared/src/types.js";
import { loadConfig } from "./config.js";
import { DesktopManager } from "./manager.js";
import { VmNetworkBridge } from "./network.js";
import { createProvider } from "./providers.js";
import { createSeedState } from "./seed.js";
import { JsonStateStore } from "./store.js";

const config = loadConfig();
const provider = createProvider(config.providerKind, config.incusBinary, {
  project: config.incusProject ?? undefined,
  guestVncPort: config.guestVncPort,
});
const store = new JsonStateStore(config.dataFile, () => createSeedState(provider.state));
const manager = new DesktopManager(store, provider);
const networkBridge = new VmNetworkBridge(manager);
manager.start();

const distRoot = process.cwd();
const staticRoot = join(distRoot, "dist", "apps", "web", "static");
const htmlPath = join(staticRoot, "index.html");
const faviconPath = join(staticRoot, "favicon.svg");

const server = createServer(async (request, response) => {
  try {
    if (!isAuthorized(request)) {
      writeAuthRequired(response);
      return;
    }

    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    const method = request.method ?? "GET";

    if (method === "GET" && url.pathname === "/api/health") {
      return writeJson(response, 200, {
        ok: true,
        data: {
          status: "ok",
          provider: manager.getProviderState(),
          generatedAt: new Date().toISOString(),
        },
      });
    }

    if (method === "GET" && url.pathname === "/api/summary") {
      return writeJson<DashboardSummary>(response, 200, {
        ok: true,
        data: manager.getSummary(),
      });
    }

    if (method === "GET" && url.pathname === "/events") {
      return handleEvents(response);
    }

    if (await networkBridge.maybeHandleRequest(request, response, url)) {
      return;
    }

    const vmMatch = url.pathname.match(/^\/api\/vms\/([^/]+)$/);
    if (method === "GET" && vmMatch) {
      return writeJson<VmDetail>(response, 200, {
        ok: true,
        data: manager.getVmDetail(vmMatch[1]),
      });
    }

    const frameMatch = url.pathname.match(/^\/api\/vms\/([^/]+)\/frame\.svg$/);
    if (method === "GET" && frameMatch) {
      const mode = url.searchParams.get("mode") === "detail" ? "detail" : "tile";
      const svg = manager.getVmFrame(frameMatch[1], mode);
      response.writeHead(200, {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(svg);
      return;
    }

    if (method === "POST" && url.pathname === "/api/vms") {
      const payload = await readJsonBody<CreateVmInput>(request);
      const vm = manager.createVm(payload);
      return writeJson(response, 202, {
        ok: true,
        data: vm,
      });
    }

    const forwardsMatch = url.pathname.match(/^\/api\/vms\/([^/]+)\/forwards$/);
    if (method === "POST" && forwardsMatch) {
      const payload = await readJsonBody<UpdateVmForwardedPortsInput>(request);
      manager.updateVmForwardedPorts(forwardsMatch[1], payload);
      return writeAccepted(response);
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
          });
        }
        case "start":
          manager.startVm(vmId);
          return writeAccepted(response);
        case "stop":
          manager.stopVm(vmId);
          return writeAccepted(response);
        case "delete":
          manager.deleteVm(vmId);
          return writeAccepted(response);
        case "snapshot": {
          const payload = await readJsonBody<SnapshotInput>(request);
          manager.snapshotVm(vmId, payload);
          return writeAccepted(response);
        }
        case "resize": {
          const payload = await readJsonBody<ResizeVmInput>(request);
          manager.resizeVm(vmId, payload);
          return writeAccepted(response);
        }
        case "template": {
          const payload = await readJsonBody<CaptureTemplateInput>(request);
          manager.captureTemplate(vmId, payload);
          return writeAccepted(response);
        }
        case "input": {
          const payload = await readJsonBody<InjectCommandInput>(request);
          manager.injectCommand(vmId, payload.command);
          return writeAccepted(response);
        }
        default:
          break;
      }
    }

    if ((method === "GET" || method === "HEAD") && url.pathname === "/") {
      return serveFile(response, htmlPath, "text/html; charset=utf-8", method === "HEAD");
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
        );
      }
    }

    writeJson(response, 404, {
      ok: false,
      error: `No route matched ${method} ${url.pathname}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    writeJson(response, 500, {
      ok: false,
      error: message,
    });
  }
});

server.on("upgrade", (request, socket, head) => {
  if (!isAuthorized(request)) {
    writeSocketAuthRequired(socket as Socket);
    return;
  }

  if (networkBridge.maybeHandleUpgrade(request, socket as Socket, head)) {
    return;
  }

  socket.destroy();
});

server.listen(config.port, config.host, () => {
  process.stdout.write(
    `parallaize listening on http://${config.host}:${config.port} using ${provider.state.kind} provider\n`,
  );
  if (config.adminPassword) {
    process.stdout.write(
      `basic auth enabled for ${config.adminUsername}\n`,
    );
  }
});

function handleEvents(response: ServerResponse): void {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
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

function writeAccepted(response: ServerResponse): void {
  writeJson(response, 202, {
    ok: true,
    data: {
      accepted: true,
    },
  });
}

function writeJson<T>(
  response: ServerResponse,
  statusCode: number,
  payload: ApiResponse<T> | Record<string, unknown>,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function isAuthorized(request: IncomingMessage): boolean {
  if (!config.adminPassword) {
    return true;
  }

  const authorization = request.headers.authorization;

  if (!authorization?.startsWith("Basic ")) {
    return false;
  }

  let decoded: string;

  try {
    decoded = Buffer.from(authorization.slice("Basic ".length), "base64").toString("utf8");
  } catch {
    return false;
  }

  const separatorIndex = decoded.indexOf(":");

  if (separatorIndex === -1) {
    return false;
  }

  const username = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);

  return safeEqual(username, config.adminUsername) && safeEqual(password, config.adminPassword);
}

function safeEqual(left: string, right: string | null): boolean {
  if (right === null) {
    return false;
  }

  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function writeAuthRequired(response: ServerResponse): void {
  response.writeHead(401, {
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
    "www-authenticate": 'Basic realm="Parallaize"',
  });
  response.end("Authentication required.\n");
}

function writeSocketAuthRequired(socket: Socket): void {
  socket.write(
    "HTTP/1.1 401 Unauthorized\r\n" +
      'WWW-Authenticate: Basic realm="Parallaize"\r\n' +
      "Connection: close\r\n" +
      "Content-Length: 0\r\n\r\n",
  );
  socket.destroy();
}

async function serveFile(
  response: ServerResponse,
  filePath: string,
  contentType: string,
  headOnly = false,
): Promise<void> {
  if (!existsSync(filePath)) {
    writeJson(response, 404, {
      ok: false,
      error: `Static asset not found: ${filePath}`,
    });
    return;
  }

  response.writeHead(200, {
    "content-type": contentType,
    "cache-control": "no-store",
  });

  if (headOnly) {
    response.end();
    return;
  }

  await pipeline(createReadStream(filePath), response);
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
