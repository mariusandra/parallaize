import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";

import {
  WebSocketServer,
  type RawData,
  type WebSocket,
} from "ws";

import type { DesktopManager } from "./manager.js";
import { parseVmGuestStreamHealthSample } from "./stream-health.js";

interface CreateVmStreamHealthServerOptions {
  manager: DesktopManager;
}

export function createVmStreamHealthServer({
  manager,
}: CreateVmStreamHealthServerOptions): {
  close(): void;
  maybeHandleUpgrade(
    request: IncomingMessage,
    socket: Socket,
    head: Buffer,
  ): boolean;
} {
  const webSocketServer = new WebSocketServer({ noServer: true });
  const connectionCounts = new Map<string, number>();

  function maybeHandleUpgrade(
    request: IncomingMessage,
    socket: Socket,
    head: Buffer,
  ): boolean {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    const match = url.pathname.match(/^\/api\/vms\/([^/]+)\/stream-health$/);

    if (!match) {
      return false;
    }

    const vmId = decodeURIComponent(match[1] ?? "");
    const token = url.searchParams.get("token") ?? "";

    if (!manager.validateVmStreamHealthToken(vmId, token)) {
      socket.write(
        "HTTP/1.1 403 Forbidden\r\n" +
          "Connection: close\r\n" +
          "Content-Length: 0\r\n\r\n",
      );
      socket.destroy();
      return true;
    }

    webSocketServer.handleUpgrade(request, socket, head, (client) => {
      attachConnection(client, vmId);
    });

    return true;
  }

  function attachConnection(client: WebSocket, vmId: string): void {
    const connectionCount = connectionCounts.get(vmId) ?? 0;
    connectionCounts.set(vmId, connectionCount + 1);

    if (connectionCount === 0) {
      manager.handleVmStreamHealthConnected(vmId);
    }

    client.on("message", (data, isBinary) => {
      handleMessage(client, vmId, data, isBinary);
    });

    client.on("close", () => {
      const currentCount = connectionCounts.get(vmId) ?? 0;
      const nextCount = Math.max(0, currentCount - 1);

      if (nextCount === 0) {
        connectionCounts.delete(vmId);
        manager.handleVmStreamHealthDisconnected(vmId);
        return;
      }

      connectionCounts.set(vmId, nextCount);
    });
  }

  function handleMessage(
    client: WebSocket,
    vmId: string,
    data: RawData,
    isBinary: boolean,
  ): void {
    if (isBinary) {
      client.close(1008, "Stream health payloads must be JSON text.");
      return;
    }

    try {
      const payload = JSON.parse(rawDataToString(data)) as unknown;
      const sample = parseVmGuestStreamHealthSample(payload);
      manager.handleVmStreamHealthHeartbeat(vmId, sample);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid stream health payload.";
      client.close(1008, message);
    }
  }

  return {
    close(): void {
      for (const client of webSocketServer.clients) {
        client.close();
      }

      webSocketServer.close();
      connectionCounts.clear();
    },
    maybeHandleUpgrade,
  };
}

function rawDataToString(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }

  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }

  return Buffer.from(data).toString("utf8");
}
