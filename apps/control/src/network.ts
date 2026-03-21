import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { connect as connectTcp, type Socket } from "node:net";
import { pipeline } from "node:stream/promises";

import { createWebSocketStream, WebSocketServer } from "ws";

import type { VmSession } from "../../../packages/shared/src/types.js";
import type { DesktopManager } from "./manager.js";

interface ResolvedVncTarget {
  host: string;
  port: number;
}

interface ResolvedForwardTarget extends ResolvedVncTarget {
  publicPath: string;
}

class ProxyRouteError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export class VmNetworkBridge {
  private readonly vncServer = new WebSocketServer({ noServer: true });

  constructor(private readonly manager: DesktopManager) {}

  async maybeHandleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    const match = matchForwardPath(url.pathname);

    if (!match) {
      return false;
    }

    let target: ResolvedForwardTarget;

    try {
      target = this.resolveForwardTarget(match.vmId, match.forwardId);
    } catch (error) {
      writePlainError(
        response,
        error instanceof ProxyRouteError ? error.statusCode : 502,
        error instanceof Error ? error.message : "Forward target resolution failed.",
      );
      return true;
    }

    const proxyRequest = httpRequest(
      {
        host: target.host,
        port: target.port,
        method: request.method,
        path: buildTargetPath(match.remainder, url.search),
        headers: buildForwardHeaders(request, target),
      },
      (proxyResponse) => {
        response.writeHead(
          proxyResponse.statusCode ?? 502,
          rewriteForwardResponseHeaders(proxyResponse.headers, target.publicPath),
        );
        void pipeline(proxyResponse, response).catch(() => {
          response.destroy();
        });
      },
    );

    proxyRequest.on("error", (error) => {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }

      writePlainError(response, 502, error.message);
    });

    request.pipe(proxyRequest);
    return true;
  }

  maybeHandleUpgrade(
    request: IncomingMessage,
    socket: Socket,
    head: Buffer,
  ): boolean {
    const url = safeUrl(request);

    if (!url) {
      return false;
    }

    const vncVmId = matchVncPath(url.pathname);

    if (vncVmId) {
      this.handleVncUpgrade(request, socket, head, vncVmId);
      return true;
    }

    const match = matchForwardPath(url.pathname);

    if (match) {
      this.handleForwardUpgrade(request, socket, head, match, url);
      return true;
    }

    return false;
  }

  private handleVncUpgrade(
    request: IncomingMessage,
    socket: Socket,
    head: Buffer,
    vmId: string,
  ): void {
    let target: ResolvedVncTarget;

    try {
      target = this.resolveVncTarget(vmId);
    } catch (error) {
      writeSocketError(
        socket,
        error instanceof ProxyRouteError ? error.statusCode : 502,
        error instanceof Error ? error.message : "VNC target resolution failed.",
      );
      return;
    }

    this.vncServer.handleUpgrade(request, socket, head, (client) => {
      const upstream = connectTcp({
        host: target.host,
        port: target.port,
      });
      const webSocketStream = createWebSocketStream(client, {
        encoding: "binary",
      });

      upstream.setNoDelay(true);

      upstream.on("error", () => {
        client.terminate();
      });

      webSocketStream.on("error", () => {
        upstream.destroy();
      });

      client.on("close", () => {
        upstream.destroy();
      });

      upstream.on("close", () => {
        client.close();
      });

      void pipeline(webSocketStream, upstream).catch(() => {
        upstream.destroy();
      });
      void pipeline(upstream, webSocketStream).catch(() => {
        client.terminate();
      });
    });
  }

  private handleForwardUpgrade(
    request: IncomingMessage,
    socket: Socket,
    head: Buffer,
    match: ForwardPathMatch,
    url: URL,
  ): void {
    let target: ResolvedForwardTarget;

    try {
      target = this.resolveForwardTarget(match.vmId, match.forwardId);
    } catch (error) {
      writeSocketError(
        socket,
        error instanceof ProxyRouteError ? error.statusCode : 502,
        error instanceof Error ? error.message : "Forward target resolution failed.",
      );
      return;
    }

    const upstream = connectTcp({
      host: target.host,
      port: target.port,
    });

    upstream.setNoDelay(true);
    socket.setNoDelay(true);

    upstream.on("connect", () => {
      const requestLine = `${request.method ?? "GET"} ${buildTargetPath(match.remainder, url.search)} HTTP/${request.httpVersion}`;
      const headers = buildForwardHeaders(request, target, true);
      const serializedHeaders = Object.entries(headers)
        .flatMap(([key, value]) => {
          if (value === undefined) {
            return [];
          }

          if (Array.isArray(value)) {
            return value.map((entry) => `${key}: ${entry}`);
          }

          return [`${key}: ${value}`];
        })
        .join("\r\n");

      upstream.write(`${requestLine}\r\n${serializedHeaders}\r\n\r\n`);

      if (head.length > 0) {
        upstream.write(head);
      }

      socket.pipe(upstream);
      upstream.pipe(socket);
    });

    upstream.on("error", (error) => {
      writeSocketError(socket, 502, error.message);
    });

    socket.on("error", () => {
      upstream.destroy();
    });
  }

  private resolveVncTarget(vmId: string): ResolvedVncTarget {
    const vm = this.manager.getVmDetail(vmId).vm;
    const session = vm.session;

    if (vm.status !== "running") {
      throw new ProxyRouteError(`VM ${vm.name} is not running.`, 409);
    }

    if (!session || session.kind !== "vnc" || !session.host || !session.port) {
      throw new ProxyRouteError(
        `VM ${vm.name} does not have a reachable VNC endpoint yet.`,
        502,
      );
    }

    return {
      host: session.host,
      port: session.port,
    };
  }

  private resolveForwardTarget(
    vmId: string,
    forwardId: string,
  ): ResolvedForwardTarget {
    const vm = this.manager.getVmDetail(vmId).vm;

    if (vm.status !== "running") {
      throw new ProxyRouteError(`VM ${vm.name} is not running.`, 409);
    }

    const session = requireVncSession(vm.name, vm.session);
    const forward = vm.forwardedPorts.find((entry) => entry.id === forwardId);

    if (!forward) {
      throw new ProxyRouteError(`Forward ${forwardId} is not configured on ${vm.name}.`, 404);
    }

    return {
      host: session.host,
      port: forward.guestPort,
      publicPath: forward.publicPath,
    };
  }
}

interface ForwardPathMatch {
  vmId: string;
  forwardId: string;
  remainder: string;
}

function safeUrl(request: IncomingMessage): URL | null {
  try {
    return new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
  } catch {
    return null;
  }
}

function matchVncPath(pathname: string): string | null {
  const match = pathname.match(/^\/api\/vms\/([^/]+)\/vnc$/);
  return match?.[1] ?? null;
}

function matchForwardPath(pathname: string): ForwardPathMatch | null {
  const match = pathname.match(/^\/vm\/([^/]+)\/forwards\/([^/]+)(?:\/(.*))?$/);

  if (!match) {
    return null;
  }

  return {
    vmId: match[1],
    forwardId: match[2],
    remainder: match[3] ?? "",
  };
}

function requireVncSession(
  vmName: string,
  session: VmSession | null,
): ResolvedVncTarget {
  if (!session || session.kind !== "vnc" || !session.host || !session.port) {
    throw new ProxyRouteError(
      `VM ${vmName} does not have a reachable guest network address yet.`,
      502,
    );
  }

  return {
    host: session.host,
    port: session.port,
  };
}

function buildTargetPath(remainder: string, search: string): string {
  const path = remainder ? `/${remainder}` : "/";
  return `${path}${search}`;
}

function buildForwardHeaders(
  request: IncomingMessage,
  target: ResolvedForwardTarget,
  keepUpgradeHeaders = false,
): IncomingMessage["headers"] {
  const headers: IncomingMessage["headers"] = { ...request.headers };

  if (!keepUpgradeHeaders) {
    delete headers.connection;
    delete headers["keep-alive"];
    delete headers["proxy-connection"];
    delete headers["transfer-encoding"];
    delete headers.upgrade;
  }

  headers.host = formatHostHeader(target.host, target.port);
  headers["x-forwarded-host"] = request.headers.host ?? "";
  headers["x-forwarded-proto"] = forwardedProto(request);
  headers["x-forwarded-prefix"] = target.publicPath.replace(/\/$/, "");
  headers["x-parallaize-vm-forward"] = target.publicPath;

  return headers;
}

function joinForwardLocation(publicPath: string, location: string): string {
  const trimmedBase = publicPath.replace(/\/$/, "");
  return `${trimmedBase}${location}`;
}

function writePlainError(
  response: ServerResponse,
  statusCode: number,
  message: string,
): void {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${message}\n`);
}

function writeSocketError(
  socket: Socket,
  statusCode: number,
  message: string,
): void {
  if (socket.destroyed) {
    return;
  }

  const payload = `${message}\n`;
  socket.end(
    `HTTP/1.1 ${statusCode} ${statusText(statusCode)}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n` +
      payload,
  );
}

function statusText(statusCode: number): string {
  switch (statusCode) {
    case 404:
      return "Not Found";
    case 409:
      return "Conflict";
    case 502:
      return "Bad Gateway";
    default:
      return "Error";
  }
}

function isHopByHopHeader(key: string): boolean {
  return [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ].includes(key.toLowerCase());
}

function forwardedProto(request: IncomingMessage): string {
  const headerValue = request.headers["x-forwarded-proto"];

  if (typeof headerValue === "string" && headerValue.trim()) {
    return headerValue;
  }

  if (Array.isArray(headerValue) && headerValue[0]) {
    return headerValue[0];
  }

  return "http";
}

function formatHostHeader(host: string, port: number): string {
  return host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
}

function rewriteForwardResponseHeaders(
  headers: IncomingMessage["headers"],
  publicPath: string,
): Record<string, string | string[] | number> {
  const nextHeaders: Record<string, string | string[] | number> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    if (isHopByHopHeader(key)) {
      continue;
    }

    nextHeaders[key] = value;
  }

  const location = nextHeaders.location;

  if (typeof location === "string" && location.startsWith("/") && !location.startsWith("//")) {
    nextHeaders.location = joinForwardLocation(publicPath, location);
  }

  const setCookie = nextHeaders["set-cookie"];

  if (Array.isArray(setCookie)) {
    nextHeaders["set-cookie"] = setCookie.map((cookie) =>
      cookie.replace(/;\s*Path=\//i, `; Path=${publicPath}`),
    );
  }

  return nextHeaders;
}
