import { randomUUID } from "node:crypto";
import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { connect as connectTcp, type Socket } from "node:net";
import { pipeline } from "node:stream/promises";

import WebSocket, { createWebSocketStream, WebSocketServer, type RawData } from "ws";

import type { VmSession } from "../../../packages/shared/src/types.js";
import { isSocketDesktopSessionKind } from "../../../packages/shared/src/desktopTransport.js";
import type { DesktopManager } from "./manager.js";

const selkiesProxyRetryTimeoutMs = 5_000;
const selkiesProxyRetryDelayMs = 250;
const defaultGuacdHost = "127.0.0.1";
const defaultGuacdPort = 4822;
const defaultGuacamoleWidth = 1280;
const defaultGuacamoleHeight = 800;
const defaultGuacamoleDpi = 96;
const guacamoleStatusServerError = 0x0200;
const guacamoleStatusUpstreamUnavailable = 0x0208;

interface ResolvedVncTarget {
  host: string;
  port: number;
}

interface ResolvedForwardTarget extends ResolvedVncTarget {
  publicPath: string;
  publicHostname: string | null;
  routeKind: "host" | "path" | "selkies";
}

interface VmNetworkBridgeOptions {
  guacdHost?: string | null;
  guacdPort?: number | null;
}

interface ParsedGuacamoleInstruction {
  opcode: string;
  parameters: string[];
  serialized: string;
}

interface GuacamoleHandshakeContext {
  dpi: number;
  height: number;
  imageMimetypes: string[];
  readOnly: boolean;
  width: number;
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
  private readonly guacamoleServer = new WebSocketServer({
    handleProtocols(protocols) {
      return protocols.has("guacamole") ? "guacamole" : false;
    },
    noServer: true,
  });
  private readonly guacdHost: string;
  private readonly guacdPort: number;

  constructor(
    private readonly manager: DesktopManager,
    options: VmNetworkBridgeOptions = {},
  ) {
    this.guacdHost = options.guacdHost?.trim() || defaultGuacdHost;
    this.guacdPort =
      typeof options.guacdPort === "number" && Number.isFinite(options.guacdPort)
        ? Math.max(1, Math.round(options.guacdPort))
        : defaultGuacdPort;
  }

  close(): void {
    for (const client of this.vncServer.clients) {
      client.terminate();
    }

    for (const client of this.guacamoleServer.clients) {
      client.terminate();
    }

    this.vncServer.close();
    this.guacamoleServer.close();
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

    const guacamoleVmId = matchGuacamolePath(url.pathname);

    if (guacamoleVmId) {
      this.handleGuacamoleUpgrade(request, socket, head, guacamoleVmId, url);
      return true;
    }

    const selkiesMatch = matchSelkiesPath(url.pathname);

    if (selkiesMatch) {
      void this.handleRetriedSelkiesUpgrade(request, socket, head, url, selkiesMatch);
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

  private handleGuacamoleUpgrade(
    request: IncomingMessage,
    socket: Socket,
    head: Buffer,
    vmId: string,
    url: URL,
  ): void {
    let target: ResolvedVncTarget;

    try {
      target = this.resolveGuacamoleTarget(vmId);
    } catch (error) {
      writeSocketError(
        socket,
        error instanceof ProxyRouteError ? error.statusCode : 502,
        error instanceof Error ? error.message : "Guacamole target resolution failed.",
      );
      return;
    }

    this.guacamoleServer.handleUpgrade(request, socket, head, (client) => {
      void this.bindGuacamoleTunnel(client, target, url);
    });
  }

  private async handleRetriedSelkiesUpgrade(
    request: IncomingMessage,
    socket: Socket,
    head: Buffer,
    url: URL,
    match: SelkiesPathMatch,
  ): Promise<void> {
    const deadlineAt = Date.now() + selkiesProxyRetryTimeoutMs;
    let lastError: Error | null = null;

    while (Date.now() < deadlineAt) {
      let target: ResolvedForwardTarget;

      try {
        target = this.resolveSelkiesTarget(match.vmId);
      } catch (error) {
        if (!(error instanceof ProxyRouteError) || error.statusCode !== 502) {
          writeSocketError(
            socket,
            error instanceof ProxyRouteError ? error.statusCode : 502,
            error instanceof Error ? error.message : "Forward target resolution failed.",
          );
          return;
        }

        lastError = error;
        await sleep(selkiesProxyRetryDelayMs);
        continue;
      }

      const upstream = await connectUpstreamWithRetry(
        target.host,
        target.port,
        deadlineAt,
      );

      if (!upstream) {
        lastError = new Error(
          `VM ${this.manager.getVmDetail(match.vmId).vm.name} does not have a reachable Selkies endpoint yet.`,
        );
        continue;
      }

      this.bindForwardUpgrade(
        request,
        socket,
        head,
        {
          remainder: match.remainder,
          target,
        },
        url,
        upstream,
      );
      return;
    }

    writeSocketError(socket, 502, lastError?.message ?? "Selkies guest bridge is unavailable.");
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

  private bindForwardUpgrade(
    request: IncomingMessage,
    socket: Socket,
    head: Buffer,
    route: ResolvedProxyRoute,
    url: URL,
    upstream: Socket,
  ): void {
    const target = route.target;
    let upstreamResponseStarted = false;

    upstream.setNoDelay(true);
    socket.setNoDelay(true);
    upstream.once("data", () => {
      upstreamResponseStarted = true;
    });

    const startProxying = () => {
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
    };

    if (upstream.connecting) {
      upstream.once("connect", startProxying);
    } else {
      startProxying();
    }

    upstream.on("error", (error) => {
      if (upstreamResponseStarted) {
        socket.destroy();
        return;
      }

      writeSocketError(socket, 502, error.message);
    });

    socket.on("error", () => {
      upstream.destroy();
    });
  }

  private async bindGuacamoleTunnel(
    client: WebSocket,
    target: ResolvedVncTarget,
    url: URL,
  ): Promise<void> {
    const handshake = buildGuacamoleHandshakeContext(url);
    let upstream: Socket | null = null;
    let closed = false;

    const closeUpstream = () => {
      upstream?.destroy();
      upstream = null;
    };

    const closeClient = (reason = "0") => {
      if (
        client.readyState === WebSocket.CLOSING ||
        client.readyState === WebSocket.CLOSED
      ) {
        return;
      }

      client.close(1000, reason);
    };

    const fail = (message: string, code = guacamoleStatusServerError) => {
      if (closed) {
        return;
      }

      writeGuacamoleError(client, message, code);
      closeUpstream();
      closed = true;
    };

    client.once("close", () => {
      closed = true;
      closeUpstream();
    });
    client.once("error", () => {
      closed = true;
      closeUpstream();
    });

    try {
      client.send(encodeGuacamoleInstruction("", [randomUUID()]));
      upstream = await connectOnce(this.guacdHost, this.guacdPort);
      upstream.setNoDelay(true);

      let handshakeComplete = false;
      let prefetched = "";
      let handshakeBuffer = "";

      upstream.write(encodeGuacamoleInstruction("select", ["vnc"]));

      while (!handshakeComplete && !closed) {
        handshakeBuffer += (await nextSocketChunk(upstream)).toString("utf8");
        const parsed = parseGuacamoleInstructions(handshakeBuffer);

        if (parsed.instructions.length === 0) {
          handshakeBuffer = parsed.remainder;
          continue;
        }

        const [instruction, ...remainder] = parsed.instructions;
        handshakeBuffer = parsed.remainder;

        if (instruction.opcode !== "args") {
          throw new Error(
            `Unexpected Guacamole handshake opcode "${instruction.opcode || "<empty>"}".`,
          );
        }

        upstream.write(
          encodeGuacamoleInstruction("size", [handshake.width, handshake.height]) +
            encodeGuacamoleInstruction("audio", []) +
            encodeGuacamoleInstruction("video", []) +
            encodeGuacamoleInstruction("image", handshake.imageMimetypes) +
            encodeGuacamoleInstruction("connect", buildGuacamoleConnectValues(
              instruction.parameters,
              target,
              handshake,
              url,
            )),
        );

        prefetched = remainder.map((entry) => entry.serialized).join("");
        handshakeComplete = true;
      }

      if (closed || !upstream) {
        return;
      }

      if (prefetched) {
        client.send(prefetched);
      }

      let upstreamMessageBuffer = handshakeBuffer;

      upstream.on("data", (chunk) => {
        if (closed || client.readyState !== WebSocket.OPEN) {
          return;
        }

        upstreamMessageBuffer += chunk.toString("utf8");

        const parsed = parseGuacamoleInstructions(upstreamMessageBuffer);
        const payload = parsed.instructions.map((instruction) => instruction.serialized).join("");
        upstreamMessageBuffer = parsed.remainder;

        if (payload) {
          client.send(payload);
        }
      });
      upstream.on("close", () => {
        if (closed) {
          return;
        }

        closed = true;
        closeClient();
      });
      upstream.on("error", () => {
        fail("Guacamole upstream is unavailable.", guacamoleStatusUpstreamUnavailable);
      });

      client.on("message", (data) => {
        if (!upstream || closed) {
          return;
        }

        let forwardedPayload = "";
        const message = rawDataToString(data);

        try {
          const parsed = parseGuacamoleInstructions(message);

          if (parsed.remainder) {
            throw new Error("Incomplete Guacamole websocket frame.");
          }

          for (const instruction of parsed.instructions) {
            if (
              instruction.opcode === "" &&
              instruction.parameters[0] === "ping"
            ) {
              if (client.readyState === WebSocket.OPEN) {
                client.send(instruction.serialized);
              }
              continue;
            }

            forwardedPayload += instruction.serialized;
          }
        } catch {
          forwardedPayload = message;
        }

        if (forwardedPayload) {
          upstream.write(forwardedPayload);
        }
      });
    } catch (error) {
      fail(
        error instanceof Error ? error.message : "Failed to establish the Guacamole bridge.",
        guacamoleStatusUpstreamUnavailable,
      );
    }
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

  private resolveGuacamoleTarget(vmId: string): ResolvedVncTarget {
    const vm = this.manager.getVmDetail(vmId).vm;

    if (vm.status !== "running") {
      throw new ProxyRouteError(`VM ${vm.name} is not running.`, 409);
    }

    return requireGuestSession(vm.name, vm.session, "guacamole");
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

function matchGuacamolePath(pathname: string): string | null {
  const match = pathname.match(/^\/api\/vms\/([^/]+)\/guacamole$/);
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
  expectedKind?: "vnc" | "selkies" | "guacamole",
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
        : expectedKind === "guacamole"
          ? "Guacamole"
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

async function nextSocketChunk(socket: Socket): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const cleanup = () => {
      socket.removeListener("data", handleData);
      socket.removeListener("close", handleClose);
      socket.removeListener("end", handleClose);
      socket.removeListener("error", handleError);
    };
    const handleData = (chunk: Buffer) => {
      cleanup();
      resolve(Buffer.from(chunk));
    };
    const handleClose = () => {
      cleanup();
      reject(new Error("Guacamole upstream closed during handshake."));
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };

    socket.once("data", handleData);
    socket.once("close", handleClose);
    socket.once("end", handleClose);
    socket.once("error", handleError);
  });
}

function parseGuacamoleInstructions(payload: string): {
  instructions: ParsedGuacamoleInstruction[];
  remainder: string;
} {
  const instructions: ParsedGuacamoleInstruction[] = [];
  let index = 0;

  while (index < payload.length) {
    const instructionStart = index;
    const elements: string[] = [];

    while (index < payload.length) {
      const lengthEnd = payload.indexOf(".", index);

      if (lengthEnd < 0) {
        return {
          instructions,
          remainder: payload.slice(instructionStart),
        };
      }

      const length = Number.parseInt(payload.slice(index, lengthEnd), 10);

      if (!Number.isFinite(length) || length < 0) {
        throw new Error("Malformed Guacamole instruction length.");
      }

      const valueStart = lengthEnd + 1;
      const valueEnd = valueStart + length;

      if (valueEnd >= payload.length) {
        return {
          instructions,
          remainder: payload.slice(instructionStart),
        };
      }

      const terminator = payload[valueEnd];

      if (terminator !== "," && terminator !== ";") {
        throw new Error("Malformed Guacamole instruction terminator.");
      }

      elements.push(payload.slice(valueStart, valueEnd));
      index = valueEnd + 1;

      if (terminator === ";") {
        instructions.push({
          opcode: elements[0] ?? "",
          parameters: elements.slice(1),
          serialized: payload.slice(instructionStart, index),
        });
        break;
      }
    }
  }

  return {
    instructions,
    remainder: "",
  };
}

function encodeGuacamoleInstruction(
  opcode: string,
  parameters: readonly (number | string)[],
): string {
  const elements = [opcode, ...parameters.map(String)];
  return `${elements.map(encodeGuacamoleElement).join(",")};`;
}

function encodeGuacamoleElement(value: string): string {
  return `${value.length}.${value}`;
}

function buildGuacamoleHandshakeContext(url: URL): GuacamoleHandshakeContext {
  return {
    dpi: readPositiveInt(url.searchParams.get("dpi"), defaultGuacamoleDpi),
    height: readPositiveInt(url.searchParams.get("height"), defaultGuacamoleHeight),
    imageMimetypes: ["image/webp", "image/png", "image/jpeg"],
    readOnly: url.searchParams.get("readOnly") === "1",
    width: readPositiveInt(url.searchParams.get("width"), defaultGuacamoleWidth),
  };
}

function buildGuacamoleConnectValues(
  argNames: readonly string[],
  target: ResolvedVncTarget,
  handshake: GuacamoleHandshakeContext,
  url: URL,
): string[] {
  return argNames.map((name) => {
    switch (name) {
      case "hostname":
      case "host":
        return target.host;
      case "port":
        return String(target.port);
      case "width":
        return String(handshake.width);
      case "height":
        return String(handshake.height);
      case "dpi":
        return String(handshake.dpi);
      case "read-only":
        return handshake.readOnly ? "true" : "false";
      case "cursor":
        return "true";
      case "clipboard-encoding":
        return "UTF-8";
      case "disable-copy":
      case "disable-paste":
      case "swap-red-blue":
      case "reverse-connect":
      case "create-recording-path":
      case "recording-exclude-output":
      case "recording-exclude-mouse":
      case "recording-include-keys":
        return "false";
      case "password":
      case "encodings":
      case "color-depth":
      case "dest-host":
      case "dest-port":
      case "display":
      case "recording-name":
      case "recording-path":
      case "username":
        return "";
      default:
        return url.searchParams.get(name) ?? "";
    }
  });
}

function readPositiveInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function rawDataToString(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data.map((entry) => Buffer.from(entry))).toString("utf8");
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(data)).toString("utf8");
  }

  return Buffer.from(data).toString("utf8");
}

function writeGuacamoleError(
  client: WebSocket,
  message: string,
  code = guacamoleStatusServerError,
): void {
  if (client.readyState !== WebSocket.OPEN) {
    return;
  }

  client.send(encodeGuacamoleInstruction("error", [message, String(code)]));
  client.close(1011, String(code));
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

async function connectUpstreamWithRetry(
  host: string,
  port: number,
  deadlineAt: number,
): Promise<Socket | null> {
  while (Date.now() < deadlineAt) {
    try {
      return await connectOnce(host, port);
    } catch (error) {
      if (!isRetryableUpstreamError(error)) {
        throw error;
      }

      await sleep(selkiesProxyRetryDelayMs);
    }
  }

  return null;
}

async function connectOnce(host: string, port: number): Promise<Socket> {
  return await new Promise((resolve, reject) => {
    const socket = connectTcp({
      host,
      port,
    });

    socket.once("connect", () => {
      resolve(socket);
    });
    socket.once("error", (error) => {
      socket.destroy();
      reject(error);
    });
  });
}

function isRetryableUpstreamError(error: unknown): error is NodeJS.ErrnoException {
  const code = (error as NodeJS.ErrnoException | null | undefined)?.code;

  return (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH" ||
    code === "ETIMEDOUT"
  );
}

async function sleep(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
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
