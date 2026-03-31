import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer as createHttpServer, request as sendHttpRequest } from "node:http";
import {
  createServer as createTcpServer,
  type AddressInfo,
  type Server as TcpServer,
  type Socket,
} from "node:net";
import test from "node:test";

import WebSocket, { type RawData } from "ws";

import type { DesktopManager } from "../apps/control/src/manager.js";
import { VmNetworkBridge } from "../apps/control/src/network.js";

test("VNC bridge preserves binary traffic in both directions", async () => {
  const vmId = "vm-4242";
  const upstreamPayload = Buffer.from([0x00, 0x7f, 0x80, 0xff, 0x42]);
  const clientPayload = Buffer.from([0xff, 0x80, 0x01, 0x00, 0x7f]);
  const upstreamServer = createTcpServer();
  const controlServer = createHttpServer();
  let webSocket: WebSocket | undefined;

  try {
    const receivedClientPayloadPromise = new Promise<Buffer>((resolve, reject) => {
      upstreamServer.once("connection", (socket) => {
        socket.write(upstreamPayload);

        const chunks: Buffer[] = [];
        socket.on("data", (chunk) => {
          chunks.push(Buffer.from(chunk));
          const combined = Buffer.concat(chunks);

          if (combined.length >= clientPayload.length) {
            resolve(combined.subarray(0, clientPayload.length));
            socket.end();
          }
        });
        socket.once("error", reject);
      });
      upstreamServer.once("error", reject);
    });

    upstreamServer.listen(0, "127.0.0.1");
    await once(upstreamServer, "listening");
    const upstreamPort = portOf(upstreamServer);

    const bridge = new VmNetworkBridge({
      getVmDetail(requestedVmId: string) {
        assert.equal(requestedVmId, vmId);
        return {
          vm: {
            id: vmId,
            name: "binary-bridge-test",
            status: "running",
            session: {
              kind: "vnc",
              host: "127.0.0.1",
              port: upstreamPort,
              webSocketPath: `/api/vms/${vmId}/vnc`,
              browserPath: `/?vm=${vmId}`,
              display: `127.0.0.1:${upstreamPort}`,
            },
            forwardedPorts: [],
          },
        };
      },
    } as unknown as DesktopManager);

    controlServer.on("upgrade", (request, socket, head) => {
      if (!bridge.maybeHandleUpgrade(request, socket as Socket, head)) {
        socket.destroy();
      }
    });
    controlServer.listen(0, "127.0.0.1");
    await once(controlServer, "listening");

    const serverMessagePromise = new Promise<Buffer>((resolve, reject) => {
      const client = new WebSocket(`ws://127.0.0.1:${portOf(controlServer)}/api/vms/${vmId}/vnc`);
      webSocket = client;
      client.once("message", (data) => {
        resolve(bufferFromRawData(data));
      });
      client.once("error", reject);
    });

    if (!webSocket) {
      throw new Error("WebSocket was not created.");
    }

    await waitForSocketOpen(webSocket);
    webSocket.send(clientPayload);

    const [receivedServerPayload, receivedClientPayload] = await Promise.all([
      serverMessagePromise,
      receivedClientPayloadPromise,
    ]);

    assert.deepEqual(receivedServerPayload, upstreamPayload);
    assert.deepEqual(receivedClientPayload, clientPayload);
  } finally {
    webSocket?.terminate();
    await closeServer(controlServer);
    await closeServer(upstreamServer);
  }
});

test("VNC bridge flushes upstream bytes before a fast upstream close", async () => {
  const vmId = "vm-4343";
  const upstreamPayload = Buffer.from("RFB 003.008\n", "binary");
  const upstreamServer = createTcpServer();
  const controlServer = createHttpServer();
  let webSocket: WebSocket | undefined;

  try {
    upstreamServer.once("error", (error) => {
      throw error;
    });
    upstreamServer.once("connection", (socket) => {
      socket.end(upstreamPayload);
    });

    upstreamServer.listen(0, "127.0.0.1");
    await once(upstreamServer, "listening");
    const upstreamPort = portOf(upstreamServer);

    const bridge = new VmNetworkBridge({
      getVmDetail(requestedVmId: string) {
        assert.equal(requestedVmId, vmId);
        return {
          vm: {
            id: vmId,
            name: "fast-close-bridge-test",
            status: "running",
            session: {
              kind: "vnc",
              host: "127.0.0.1",
              port: upstreamPort,
              webSocketPath: `/api/vms/${vmId}/vnc`,
              browserPath: `/?vm=${vmId}`,
              display: `127.0.0.1:${upstreamPort}`,
            },
            forwardedPorts: [],
          },
        };
      },
    } as unknown as DesktopManager);

    controlServer.on("upgrade", (request, socket, head) => {
      if (!bridge.maybeHandleUpgrade(request, socket as Socket, head)) {
        socket.destroy();
      }
    });
    controlServer.listen(0, "127.0.0.1");
    await once(controlServer, "listening");

    const browserMessagePromise = new Promise<Buffer>((resolve, reject) => {
      const client = new WebSocket(`ws://127.0.0.1:${portOf(controlServer)}/api/vms/${vmId}/vnc`);
      webSocket = client;
      client.once("message", (data) => {
        resolve(bufferFromRawData(data));
      });
      client.once("error", reject);
    });
    const browserClosePromise = new Promise<number>((resolve, reject) => {
      if (!webSocket) {
        reject(new Error("WebSocket was not created."));
        return;
      }

      webSocket.once("close", (code) => {
        resolve(code);
      });
      webSocket.once("error", reject);
    });

    const [browserMessage, closeCode] = await Promise.all([
      browserMessagePromise,
      browserClosePromise,
    ]);

    assert.deepEqual(browserMessage, upstreamPayload);
    assert.ok(closeCode >= 1000);
  } finally {
    webSocket?.terminate();
    await closeServer(controlServer);
    await closeServer(upstreamServer);
  }
});

test("forward bridge routes hostname-based forwarded service traffic", async () => {
  const vmId = "vm-4545";
  const publicHostname = `app-ui--${vmId}.localhost`;
  const upstreamServer = createHttpServer((request, response) => {
    assert.equal(request.url, "/deep/path?ok=1");
    response.writeHead(200, {
      "content-type": "application/json",
    });
    response.end(
      JSON.stringify({
        forwardedHost: request.headers["x-forwarded-host"],
        routedAs: request.headers["x-parallaize-vm-forward"],
      }),
    );
  });
  const controlServer = createHttpServer();

  try {
    upstreamServer.listen(0, "127.0.0.1");
    await once(upstreamServer, "listening");
    const upstreamPort = portOf(upstreamServer);

    const bridge = new VmNetworkBridge({
      getSummary() {
        return {
          vms: [
            {
              id: vmId,
              forwardedPorts: [
                {
                  id: "port-01",
                  name: "app-ui",
                  guestPort: upstreamPort,
                  protocol: "http",
                  description: "Forwarded host route",
                  publicPath: `/vm/${vmId}/forwards/port-01/`,
                  publicHostname,
                },
              ],
            },
          ],
        };
      },
      getVmDetail(requestedVmId: string) {
        assert.equal(requestedVmId, vmId);
        return {
          vm: {
            id: vmId,
            name: "hostname-forward-test",
            status: "running",
            session: {
              kind: "vnc",
              host: "127.0.0.1",
              port: 5900,
              webSocketPath: `/api/vms/${vmId}/vnc`,
              browserPath: `/?vm=${vmId}`,
              display: "127.0.0.1:5900",
            },
            forwardedPorts: [
              {
                id: "port-01",
                name: "app-ui",
                guestPort: upstreamPort,
                protocol: "http",
                description: "Forwarded host route",
                publicPath: `/vm/${vmId}/forwards/port-01/`,
                publicHostname,
              },
            ],
          },
        };
      },
    } as unknown as DesktopManager);

    controlServer.on("request", (request, response) => {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

      void bridge.maybeHandleRequest(request, response, url).then((handled) => {
        if (!handled) {
          response.writeHead(404);
          response.end("no route");
        }
      });
    });
    controlServer.listen(0, "127.0.0.1");
    await once(controlServer, "listening");

    const { body, statusCode } = await requestText({
      headers: {
        host: publicHostname,
      },
      path: "/deep/path?ok=1",
      port: portOf(controlServer),
    });

    assert.equal(statusCode, 200);
    assert.match(body, new RegExp(publicHostname));
  } finally {
    await closeServer(controlServer);
    await closeServer(upstreamServer);
  }
});

test("Selkies bridge proxies the VM-scoped browser path to the guest web app", async () => {
  const vmId = "vm-4646";
  const upstreamServer = createHttpServer((request, response) => {
    response.writeHead(200, {
      "content-type": "application/json",
    });
    response.end(
      JSON.stringify({
        forwardedPrefix: request.headers["x-forwarded-prefix"],
        routedAs: request.headers["x-parallaize-vm-forward"],
        url: request.url,
      }),
    );
  });
  const controlServer = createHttpServer();

  try {
    upstreamServer.listen(0, "127.0.0.1");
    await once(upstreamServer, "listening");
    const upstreamPort = portOf(upstreamServer);

    const bridge = new VmNetworkBridge({
      getSummary() {
        return {
          vms: [],
        };
      },
      getVmDetail(requestedVmId: string) {
        assert.equal(requestedVmId, vmId);
        return {
          vm: {
            id: vmId,
            name: "selkies-route-test",
            status: "running",
            session: {
              kind: "selkies",
              host: "127.0.0.1",
              port: upstreamPort,
              webSocketPath: null,
              browserPath: `/selkies-${vmId}/`,
              display: `127.0.0.1:${upstreamPort}`,
            },
            forwardedPorts: [],
          },
        };
      },
    } as unknown as DesktopManager);

    controlServer.on("request", (request, response) => {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

      void bridge.maybeHandleRequest(request, response, url).then((handled) => {
        if (!handled) {
          response.writeHead(404);
          response.end("no route");
        }
      });
    });
    controlServer.listen(0, "127.0.0.1");
    await once(controlServer, "listening");

    const { body, statusCode } = await requestText({
      path: `/selkies-${vmId}/signalling/config?ok=1`,
      port: portOf(controlServer),
    });

    assert.equal(statusCode, 200);
    assert.match(body, /"url":"\/signalling\/config\?ok=1"/);
    assert.match(body, new RegExp(`"routedAs":"\\/selkies-${vmId}\\/"`));
    assert.doesNotMatch(body, /forwardedPrefix/);
  } finally {
    await closeServer(controlServer);
    await closeServer(upstreamServer);
  }
});

test("forward bridge still works for Selkies-backed VMs", async () => {
  const vmId = "vm-4747";
  const upstreamServer = createHttpServer((request, response) => {
    assert.equal(request.url, "/status?ok=1");
    response.writeHead(200, {
      "content-type": "application/json",
    });
    response.end(
      JSON.stringify({
        routedAs: request.headers["x-parallaize-vm-forward"],
      }),
    );
  });
  const controlServer = createHttpServer();

  try {
    upstreamServer.listen(0, "127.0.0.1");
    await once(upstreamServer, "listening");
    const upstreamPort = portOf(upstreamServer);

    const bridge = new VmNetworkBridge({
      getSummary() {
        return {
          vms: [],
        };
      },
      getVmDetail(requestedVmId: string) {
        assert.equal(requestedVmId, vmId);
        return {
          vm: {
            id: vmId,
            name: "selkies-forward-test",
            status: "running",
            session: {
              kind: "selkies",
              host: "127.0.0.1",
              port: 6080,
              webSocketPath: null,
              browserPath: `/selkies-${vmId}/`,
              display: "127.0.0.1:6080",
            },
            forwardedPorts: [
              {
                id: "port-01",
                name: "status",
                guestPort: upstreamPort,
                protocol: "http",
                description: "Forwarded status endpoint",
                publicPath: `/vm/${vmId}/forwards/port-01/`,
                publicHostname: null,
              },
            ],
          },
        };
      },
    } as unknown as DesktopManager);

    controlServer.on("request", (request, response) => {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

      void bridge.maybeHandleRequest(request, response, url).then((handled) => {
        if (!handled) {
          response.writeHead(404);
          response.end("no route");
        }
      });
    });
    controlServer.listen(0, "127.0.0.1");
    await once(controlServer, "listening");

    const { body, statusCode } = await requestText({
      path: `/vm/${vmId}/forwards/port-01/status?ok=1`,
      port: portOf(controlServer),
    });

    assert.equal(statusCode, 200);
    assert.match(body, new RegExp(`"routedAs":"\\/vm\\/${vmId}\\/forwards\\/port-01\\/"`));
  } finally {
    await closeServer(controlServer);
    await closeServer(upstreamServer);
  }
});

function bufferFromRawData(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data.map((entry) => Buffer.from(entry)));
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  throw new Error("Unsupported WebSocket frame payload.");
}

async function waitForSocketOpen(socket: WebSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => {
      resolve();
    });
    socket.once("error", reject);
  });
}

async function requestText({
  headers,
  path,
  port,
}: {
  headers?: Record<string, string>;
  path: string;
  port: number;
}): Promise<{ body: string; statusCode: number }> {
  return await new Promise((resolve, reject) => {
    const request = sendHttpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            statusCode: response.statusCode ?? 0,
          });
        });
      },
    );

    request.once("error", reject);
    request.end();
  });
}

function portOf(server: TcpServer | ReturnType<typeof createHttpServer>): number {
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Server did not expose an inet address.");
  }

  return (address as AddressInfo).port;
}

async function closeServer(server: TcpServer | ReturnType<typeof createHttpServer>): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
