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
  publicHostname: string | null;
  routeKind: "host" | "path" | "selkies";
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

  close(): void {
    for (const client of this.vncServer.clients) {
      client.terminate();
    }

    this.vncServer.close();
  }

  async maybeHandleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    let route: ResolvedProxyRoute | null;

    try {
      route = this.resolveProxyRoute(request, url);
    } catch (error) {
      writePlainError(
        response,
        error instanceof ProxyRouteError ? error.statusCode : 502,
        error instanceof Error ? error.message : "Forward target resolution failed.",
      );
      return true;
    }

    if (!route) {
      return false;
    }

    const proxyRequest = httpRequest(
      {
        host: route.target.host,
        port: route.target.port,
        method: request.method,
        path: buildTargetPath(route.remainder, url.search),
        headers: buildForwardHeaders(request, route.target),
      },
      (proxyResponse) => {
        response.writeHead(
          proxyResponse.statusCode ?? 502,
          rewriteForwardResponseHeaders(proxyResponse.headers, route.target.publicPath),
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

    let route: ResolvedProxyRoute | null;

    try {
      route = this.resolveProxyRoute(request, url);
    } catch (error) {
      writeSocketError(
        socket,
        error instanceof ProxyRouteError ? error.statusCode : 502,
        error instanceof Error ? error.message : "Forward target resolution failed.",
      );
      return true;
    }

    if (route) {
      this.handleForwardUpgrade(request, socket, head, route, url);
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
      // Keep the bridge in raw Buffer mode so RFB control frames and pixel data
      // are forwarded byte-for-byte between noVNC and the guest VNC server.
      const webSocketStream = createWebSocketStream(client);

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

      webSocketStream.pipe(upstream);
      upstream.pipe(webSocketStream);
    });
  }

  private handleForwardUpgrade(
    request: IncomingMessage,
    socket: Socket,
    head: Buffer,
    route: ResolvedProxyRoute,
    url: URL,
  ): void {
    let target: ResolvedForwardTarget;

    try {
      target = route.target;
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
      const requestLine = `${request.method ?? "GET"} ${buildTargetPath(route.remainder, url.search)} HTTP/${request.httpVersion}`;
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

  private resolveProxyRoute(
    request: IncomingMessage,
    url: URL,
  ): ResolvedProxyRoute | null {
    const hostTarget = this.resolveForwardTargetFromHost(request.headers.host);

    if (hostTarget) {
      return {
        remainder: trimLeadingSlash(url.pathname),
        target: hostTarget,
      };
    }

    const selkiesMatch = matchSelkiesPath(url.pathname);

    if (selkiesMatch) {
      return {
        remainder: selkiesMatch.remainder,
        target: this.resolveSelkiesTarget(selkiesMatch.vmId),
      };
    }

    const pathMatch = matchForwardPath(url.pathname);

    if (!pathMatch) {
      return null;
    }

    return {
      remainder: pathMatch.remainder,
      target: this.resolveForwardTarget(pathMatch.vmId, pathMatch.forwardId, "path"),
    };
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

  private resolveSelkiesTarget(vmId: string): ResolvedForwardTarget {
    const vm = this.manager.getVmDetail(vmId).vm;

    if (vm.status !== "running") {
      throw new ProxyRouteError(`VM ${vm.name} is not running.`, 409);
    }

    const session = requireGuestSession(vm.name, vm.session, "selkies");

    return {
      host: session.host,
      port: session.port,
      publicPath: buildSelkiesPublicPath(vmId),
      publicHostname: null,
      routeKind: "selkies",
    };
  }

  private resolveForwardTarget(
    vmId: string,
    forwardId: string,
    routeKind: ResolvedForwardTarget["routeKind"] = "path",
  ): ResolvedForwardTarget {
    const vm = this.manager.getVmDetail(vmId).vm;

    if (vm.status !== "running") {
      throw new ProxyRouteError(`VM ${vm.name} is not running.`, 409);
    }

    const session = requireGuestSession(vm.name, vm.session);
    const forward = vm.forwardedPorts.find((entry) => entry.id === forwardId);

    if (!forward) {
      throw new ProxyRouteError(`Forward ${forwardId} is not configured on ${vm.name}.`, 404);
    }

    return {
      host: session.host,
      port: forward.guestPort,
      publicPath: routeKind === "host" ? "/" : forward.publicPath,
      publicHostname: forward.publicHostname ?? null,
      routeKind,
    };
  }

  private resolveForwardTargetFromHost(
    hostHeader: IncomingMessage["headers"]["host"],
  ): ResolvedForwardTarget | null {
    const normalizedHost = normalizeHostHeader(hostHeader);

    if (!normalizedHost) {
      return null;
    }

    const summary = this.manager.getSummary();

    for (const vm of summary.vms) {
      const forward = vm.forwardedPorts.find(
        (entry) => normalizeHostHeader(entry.publicHostname ?? undefined) === normalizedHost,
      );

      if (forward) {
        return this.resolveForwardTarget(vm.id, forward.id, "host");
      }
    }

    return null;
  }
}

interface ForwardPathMatch {
  vmId: string;
  forwardId: string;
  remainder: string;
}

interface SelkiesPathMatch {
  vmId: string;
  remainder: string;
}

interface ResolvedProxyRoute {
  remainder: string;
  target: ResolvedForwardTarget;
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

function matchSelkiesPath(pathname: string): SelkiesPathMatch | null {
  const match = pathname.match(/^\/selkies-([^/]+)(?:\/(.*))?$/);

  if (!match) {
    return null;
  }

  return {
    vmId: match[1],
    remainder: match[2] ?? "",
  };
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

function normalizeHostHeader(
  value: IncomingMessage["headers"]["host"] | string | undefined,
): string | null {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const trimmed = rawValue?.trim();

  if (!trimmed) {
    return null;
  }

  try {
    return new URL(`http://${trimmed}`).hostname.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

function requireGuestSession(
  vmName: string,
  session: VmSession | null,
  expectedKind?: "vnc" | "selkies",
): ResolvedVncTarget {
  if (
    !session ||
    session.kind === "synthetic" ||
    (expectedKind && session.kind !== expectedKind) ||
    session.reachable === false ||
    !session.host ||
    !session.port
  ) {
    const transportLabel =
      expectedKind === "selkies"
        ? "Selkies"
        : expectedKind === "vnc"
          ? "VNC"
          : "guest network";
    throw new ProxyRouteError(
      `VM ${vmName} does not have a reachable ${transportLabel} endpoint yet.`,
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

function buildSelkiesPublicPath(vmId: string): string {
  return `/selkies-${vmId}/`;
}

function trimLeadingSlash(pathname: string): string {
  return pathname.replace(/^\/+/, "");
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
  if (target.routeKind === "path") {
    headers["x-forwarded-prefix"] = target.publicPath.replace(/\/$/, "");
  } else {
    delete headers["x-forwarded-prefix"];
  }
  headers["x-parallaize-vm-forward"] =
    target.routeKind === "host"
      ? (target.publicHostname ?? "")
      : target.publicPath;

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
