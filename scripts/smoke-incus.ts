import { spawnSync } from "node:child_process";
import { createConnection, type Socket } from "node:net";
import process from "node:process";

import type { EnvironmentTemplate } from "../packages/shared/src/types.js";
import {
  FramebufferVisibilityTracker,
  type FramebufferVisibilityStats,
  type VncPixelFormat,
} from "../packages/shared/src/vnc-framebuffer.js";
import { DEFAULT_GUEST_DESKTOP_HEALTH_CHECK } from "../apps/control/src/ubuntu-guest-init.js";
import WebSocket from "ws";

const CONTROL_URL = process.env.PARALLAIZE_SMOKE_CONTROL_URL ?? "http://127.0.0.1:3000";
const PUBLIC_URL = process.env.PARALLAIZE_SMOKE_PUBLIC_URL ?? "http://127.0.0.1:8080";
const DEFAULT_TEMPLATE_LAUNCH_SOURCE = "images:ubuntu/noble/desktop";
const TEMPLATE_ID = normalizeOptionalString(process.env.PARALLAIZE_SMOKE_TEMPLATE_ID);
const TEMPLATE_NAME = normalizeOptionalString(process.env.PARALLAIZE_SMOKE_TEMPLATE_NAME);
const TEMPLATE_LAUNCH_SOURCE =
  normalizeOptionalString(process.env.PARALLAIZE_SMOKE_TEMPLATE_LAUNCH_SOURCE) ??
  DEFAULT_TEMPLATE_LAUNCH_SOURCE;
const VM_NAME_PREFIX = process.env.PARALLAIZE_SMOKE_VM_PREFIX ?? "smoke-incus";
const KEEP_VM = process.env.PARALLAIZE_SMOKE_KEEP_VM === "1";
const GUEST_HTTP_PORT = parseInteger(process.env.PARALLAIZE_SMOKE_GUEST_HTTP_PORT, 3000);
const INCUS_BIN = process.env.PARALLAIZE_INCUS_BIN ?? "incus";
const AUTH_USERNAME =
  process.env.PARALLAIZE_SMOKE_ADMIN_USERNAME ??
  process.env.PARALLAIZE_ADMIN_USERNAME ??
  "admin";
const AUTH_PASSWORD =
  process.env.PARALLAIZE_SMOKE_ADMIN_PASSWORD ??
  process.env.PARALLAIZE_ADMIN_PASSWORD ??
  null;
let authSessionCookie: string | null = null;
const VNC_TIMEOUT_MS = 180_000;
const VM_TIMEOUT_MS = 360_000;
const HTTP_TIMEOUT_MS = 180_000;
const VNC_IO_TIMEOUT_MS = 12_000;

const HTTP_SERVICE_NAME = "smoke-http";
const HTTP_BODY_MARKER = "Parallaize Smoke Service";

interface ApiEnvelope<T> {
  data: T;
  error?: string;
  ok: boolean;
}

interface SmokeSummaryPayload {
  templates: EnvironmentTemplate[];
}

interface SmokeVmDetailPayload {
  vm: {
    forwardedPorts: Array<{
      guestPort: number;
      name: string;
      publicPath: string;
    }>;
    id: string;
    providerRef: string;
    session: SmokeVmSession | null;
    status: string;
  };
}

interface SmokeVmSession {
  display: string | null;
  host: string | null;
  port: number | null;
}

interface VisibleDesktopSample {
  pixelFormat: VncPixelFormat;
  serverName: string;
  stats: FramebufferVisibilityStats;
}

async function main() {
  let vmId: string | null = null;
  let vmName: string | null = null;

  try {
    logStep(`Using control plane ${CONTROL_URL} and public entrypoint ${PUBLIC_URL}`);
    await assertApiHealthy();

    const template = await resolveSmokeTemplate();
    vmName = `${VM_NAME_PREFIX}-${Date.now()}`;
    const createdVm = await createVm(vmName, template);
    vmId = createdVm.id;
    logStep(`Created ${vmId} (${vmName}) from ${template.name}`);

    let detail = await waitForVmRunning(vmId);
    logStep(`VM reported running at ${detail.vm.session?.display ?? "unknown display"}`);

    await waitForVncHandshake(vmId);
    logStep("Browser VNC bridge answered through Caddy");

    await waitForGuestDesktopHealth(detail.vm.providerRef);
    logStep("Guest GNOME session reported healthy");

    const firstDesktopSample = await waitForVisibleDesktop(detail.vm.session);
    logStep(`Guest desktop rendered visible content (${formatVisibilityStats(firstDesktopSample.stats)})`);

    await installGuestHttpService(detail.vm.providerRef);
    logStep(`Installed guest HTTP service on port ${GUEST_HTTP_PORT}`);

    await stopVm(vmId);
    await waitForVmStatus(vmId, "stopped");
    logStep("VM stopped after guest HTTP service installation");

    await startVm(vmId);
    detail = await waitForVmRunning(vmId);
    logStep("VM restarted after guest service injection");

    await waitForVncHandshake(vmId);
    logStep("Browser VNC bridge recovered after restart");

    await waitForGuestDesktopHealth(detail.vm.providerRef);
    logStep("Guest GNOME session recovered after restart");

    const restartedDesktopSample = await waitForVisibleDesktop(detail.vm.session);
    logStep(
      `Guest desktop returned after restart (${formatVisibilityStats(restartedDesktopSample.stats)})`,
    );

    const session = requireVmSession(detail.vm.session);
    await waitForGuestHttp(session.host, GUEST_HTTP_PORT);
    logStep("Guest HTTP service answered directly from the host");

    await configureForward(vmId);
    detail = await getVmDetail(vmId);

    const smokeForward = detail.vm.forwardedPorts.find(
      (forward) => forward.name === HTTP_SERVICE_NAME && forward.guestPort === GUEST_HTTP_PORT,
    );

    if (!smokeForward) {
      throw new Error("Smoke forward was not persisted on the VM.");
    }

    await waitForPublicForward(smokeForward.publicPath);
    logStep(`Caddy forwarded ${smokeForward.publicPath} successfully`);

    process.stdout.write(`Smoke test passed for ${vmId}\n`);
  } finally {
    if (vmId && !KEEP_VM) {
      try {
        await deleteVm(vmId);
        await waitForVmDeletion(vmId);
        logStep(`Deleted smoke VM ${vmId}`);
      } catch (error) {
        process.stderr.write(
          `Cleanup failed for ${vmId}: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    } else if (vmId) {
      logStep(`Keeping smoke VM ${vmId} for inspection`);
    }
  }
}

async function assertApiHealthy() {
  const response = await fetch(new URL("/api/health", CONTROL_URL), {
    headers: await buildAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Control plane health check failed with ${response.status}.`);
  }
}

async function resolveSmokeTemplate(): Promise<EnvironmentTemplate> {
  const summary = await fetchJson<SmokeSummaryPayload>("/api/summary");
  const templates = summary.data.templates;

  if (TEMPLATE_ID) {
    const template = templates.find((entry) => entry.id === TEMPLATE_ID);

    if (!template) {
      throw new Error(`Smoke template id ${TEMPLATE_ID} was not found.`);
    }

    logStep(
      `Selected template ${template.id} (${template.name}) from explicit id ${TEMPLATE_ID}.`,
    );
    return template;
  }

  if (TEMPLATE_NAME) {
    const template = templates.find((entry) => entry.name === TEMPLATE_NAME);

    if (!template) {
      throw new Error(`Smoke template name "${TEMPLATE_NAME}" was not found.`);
    }

    logStep(
      `Selected template ${template.id} (${template.name}) from explicit name ${TEMPLATE_NAME}.`,
    );
    return template;
  }

  const template =
    templates.find(
      (entry) =>
        entry.launchSource === TEMPLATE_LAUNCH_SOURCE &&
        entry.provenance?.kind === "seed",
    ) ??
    templates.find((entry) => entry.launchSource === TEMPLATE_LAUNCH_SOURCE);

  if (!template) {
    throw new Error(
      `No smoke template uses launch source ${TEMPLATE_LAUNCH_SOURCE}.`,
    );
  }

  logStep(
    `Selected Ubuntu 24.04 template ${template.id} (${template.name}) from ${template.launchSource}.`,
  );
  return template;
}

async function createVm(name: string, template: EnvironmentTemplate) {
  const response = await fetchJson<{ id: string }>("/api/vms", {
    body: JSON.stringify({
      name,
      resources: {
        cpu: 2,
        diskGb: Math.max(30, template.defaultResources.diskGb ?? 30),
        ramMb: 4096,
      },
      templateId: template.id,
    }),
    method: "POST",
  });

  return response.data;
}

async function stopVm(vmId: string) {
  await fetchJson(`/api/vms/${vmId}/stop`, {
    method: "POST",
  });
}

async function startVm(vmId: string) {
  await fetchJson(`/api/vms/${vmId}/start`, {
    method: "POST",
  });
}

async function deleteVm(vmId: string) {
  await fetchJson(`/api/vms/${vmId}/delete`, {
    method: "POST",
  });
}

async function configureForward(vmId: string) {
  await fetchJson(`/api/vms/${vmId}/forwards`, {
    body: JSON.stringify({
      forwardedPorts: [
        {
          description: "Smoke-test guest HTTP service",
          guestPort: GUEST_HTTP_PORT,
          name: HTTP_SERVICE_NAME,
          protocol: "http",
        },
      ],
    }),
    method: "POST",
  });
}

async function getVmDetail(vmId: string): Promise<SmokeVmDetailPayload> {
  const payload = await fetchJson<SmokeVmDetailPayload>(`/api/vms/${vmId}`);
  return payload.data;
}

async function waitForVmRunning(vmId: string) {
  return waitFor(
    `VM ${vmId} to reach running state`,
    VM_TIMEOUT_MS,
    5_000,
    async () => {
      const detail = await getVmDetail(vmId);
      return detail.vm.status === "running" && detail.vm.session ? detail : null;
    },
  );
}

async function waitForVmStatus(vmId: string, expectedStatus: string) {
  return waitFor(
    `VM ${vmId} to reach ${expectedStatus}`,
    VM_TIMEOUT_MS,
    3_000,
    async () => {
      const detail = await getVmDetail(vmId);
      return detail.vm.status === expectedStatus ? detail : null;
    },
  );
}

async function waitForVmDeletion(vmId: string) {
  return waitFor(
    `VM ${vmId} deletion`,
    120_000,
    3_000,
    async () => {
      const response = await fetch(new URL(`/api/vms/${vmId}`, CONTROL_URL), {
        headers: await buildAuthHeaders(),
      });
      return response.status === 500 ? true : null;
    },
  );
}

async function waitForVncHandshake(vmId: string) {
  return waitFor(
    `browser VNC handshake for ${vmId}`,
    VNC_TIMEOUT_MS,
    6_000,
    async () => {
      try {
        return await attemptVncHandshake(vmId);
      } catch {
        return null;
      }
    },
  );
}

async function waitForVisibleDesktop(session: SmokeVmSession | null) {
  const resolvedSession = requireVmSession(session);

  return waitFor(
    `visible VNC desktop on ${resolvedSession.host}:${resolvedSession.port}`,
    VNC_TIMEOUT_MS,
    6_000,
    async () => {
      try {
        return await captureVisibleDesktop(resolvedSession.host, resolvedSession.port);
      } catch {
        return null;
      }
    },
  );
}

async function waitForGuestDesktopHealth(providerRef: string) {
  return waitFor(
    `healthy guest desktop on ${providerRef}`,
    VNC_TIMEOUT_MS,
    6_000,
    async () => {
      const result = runCommand(
        "flox",
        [
          "activate",
          "-d",
          ".",
          "--",
          INCUS_BIN,
          "exec",
          providerRef,
          "--",
          "sh",
          "-lc",
          DEFAULT_GUEST_DESKTOP_HEALTH_CHECK,
        ],
        false,
      );

      return result.status === 0 ? true : null;
    },
  );
}

async function waitForGuestHttp(host: string, port: number) {
  return waitFor(
    `guest HTTP service on ${host}:${port}`,
    HTTP_TIMEOUT_MS,
    5_000,
    async () => {
      try {
        const response = await fetch(buildGuestHttpUrl(host, port));
        if (!response.ok) {
          return null;
        }

        const body = await response.text();
        return body.includes(HTTP_BODY_MARKER) ? true : null;
      } catch {
        return null;
      }
    },
  );
}

async function waitForPublicForward(publicPath: string) {
  return waitFor(
    `public forward ${publicPath}`,
    HTTP_TIMEOUT_MS,
    5_000,
    async () => {
      try {
        const response = await fetch(new URL(publicPath, PUBLIC_URL), {
          headers: await buildAuthHeaders(),
        });
        if (!response.ok) {
          return null;
        }

        const body = await response.text();
        return body.includes(HTTP_BODY_MARKER) ? true : null;
      } catch {
        return null;
      }
    },
  );
}

async function attemptVncHandshake(vmId: string) {
  const wsUrl = buildWebSocketUrl(`/api/vms/${vmId}/vnc`);
  const headers = await buildAuthHeaders();

  return await new Promise<string>((resolve, reject) => {
    const socket = new WebSocket(wsUrl, {
      headers,
    });
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error(`Timed out connecting to ${wsUrl}`));
    }, 7_000);

    socket.on("message", (data) => {
      clearTimeout(timer);
      const handshake = data.toString().trim();
      socket.close();

      if (!handshake.startsWith("RFB ")) {
        reject(new Error(`Unexpected VNC handshake: ${handshake}`));
        return;
      }

      resolve(handshake);
    });

    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    socket.on("close", () => {
      clearTimeout(timer);
    });
  });
}

async function captureVisibleDesktop(host: string, port: number): Promise<VisibleDesktopSample> {
  const socket = await connectToVnc(host, port);
  const reader = new SocketByteReader(socket);

  try {
    const serverVersion = (await reader.readExactly(12, VNC_IO_TIMEOUT_MS)).toString("ascii");

    if (!/^RFB \d{3}\.\d{3}\n$/.test(serverVersion)) {
      throw new Error(`Unexpected VNC version banner: ${JSON.stringify(serverVersion)}.`);
    }

    socket.write(Buffer.from(serverVersion === "RFB 003.003\n" ? serverVersion : "RFB 003.008\n", "ascii"));
    await negotiateVncSecurity(reader, socket, serverVersion);
    socket.write(Buffer.from([1]));

    const serverInit = await readServerInit(reader);
    sendSetEncodings(socket);
    sendFramebufferUpdateRequest(socket, serverInit.width, serverInit.height, false);

    const deadline = Date.now() + VNC_IO_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const remainingMs = deadline - Date.now();
      const messageType = (await reader.readExactly(1, remainingMs))[0];

      switch (messageType) {
        case 0: {
          const stats = await readFramebufferUpdate(
            reader,
            remainingMs,
            serverInit.width,
            serverInit.height,
            serverInit.pixelFormat,
          );

          if (stats.hasVisibleContent) {
            return {
              pixelFormat: serverInit.pixelFormat,
              serverName: serverInit.name,
              stats,
            };
          }

          sendFramebufferUpdateRequest(socket, serverInit.width, serverInit.height, true);
          break;
        }

        case 1:
          await skipSetColorMapEntries(reader, remainingMs);
          break;

        case 2:
          break;

        case 3:
          await skipServerCutText(reader, remainingMs);
          break;

        default:
          throw new Error(`Unsupported VNC server message type ${messageType}.`);
      }
    }

    throw new Error(`Timed out waiting for visible VNC content on ${host}:${port}.`);
  } finally {
    socket.destroy();
  }
}

async function negotiateVncSecurity(reader: SocketByteReader, socket: Socket, serverVersion: string) {
  if (serverVersion === "RFB 003.003\n") {
    const securityType = (await reader.readExactly(4, VNC_IO_TIMEOUT_MS)).readUInt32BE(0);

    if (securityType !== 1) {
      throw new Error(`Unsupported VNC security type ${securityType}; expected "None".`);
    }

    return;
  }

  const securityTypeCount = (await reader.readExactly(1, VNC_IO_TIMEOUT_MS))[0];

  if (securityTypeCount === 0) {
    const reasonLength = (await reader.readExactly(4, VNC_IO_TIMEOUT_MS)).readUInt32BE(0);
    const reason = (await reader.readExactly(reasonLength, VNC_IO_TIMEOUT_MS)).toString("utf8");
    throw new Error(`VNC server rejected the connection: ${reason || "unknown reason"}.`);
  }

  const securityTypes = [...await reader.readExactly(securityTypeCount, VNC_IO_TIMEOUT_MS)];

  if (!securityTypes.includes(1)) {
    throw new Error(
      `VNC server did not offer "None" authentication. Offered types: ${securityTypes.join(", ")}.`,
    );
  }

  socket.write(Buffer.from([1]));
  const securityResult = (await reader.readExactly(4, VNC_IO_TIMEOUT_MS)).readUInt32BE(0);

  if (securityResult !== 0) {
    let detail = "";

    if (serverVersion === "RFB 003.008\n") {
      const reasonLength = (await reader.readExactly(4, VNC_IO_TIMEOUT_MS)).readUInt32BE(0);
      detail = (await reader.readExactly(reasonLength, VNC_IO_TIMEOUT_MS)).toString("utf8");
    }

    throw new Error(`VNC authentication failed${detail ? `: ${detail}` : "."}`);
  }
}

async function readServerInit(reader: SocketByteReader) {
  const header = await reader.readExactly(24, VNC_IO_TIMEOUT_MS);
  const width = header.readUInt16BE(0);
  const height = header.readUInt16BE(2);
  const nameLength = header.readUInt32BE(20);
  const name = (await reader.readExactly(nameLength, VNC_IO_TIMEOUT_MS)).toString("utf8");

  return {
    height,
    name,
    pixelFormat: parseVncPixelFormat(header.subarray(4, 20)),
    width,
  };
}

async function readFramebufferUpdate(
  reader: SocketByteReader,
  timeoutMs: number,
  frameWidth: number,
  frameHeight: number,
  pixelFormat: VncPixelFormat,
) {
  const header = await reader.readExactly(3, timeoutMs);
  const rectangleCount = header.readUInt16BE(1);
  const tracker = new FramebufferVisibilityTracker(frameWidth, frameHeight);

  for (let index = 0; index < rectangleCount; index += 1) {
    const rectangleHeader = await reader.readExactly(12, timeoutMs);
    const x = rectangleHeader.readUInt16BE(0);
    const y = rectangleHeader.readUInt16BE(2);
    const width = rectangleHeader.readUInt16BE(4);
    const height = rectangleHeader.readUInt16BE(6);
    const encoding = rectangleHeader.readInt32BE(8);

    switch (encoding) {
      case 0: {
        const bytesPerPixel = pixelFormat.bitsPerPixel / 8;
        const payload = await reader.readExactly(width * height * bytesPerPixel, timeoutMs);
        tracker.recordRawRectangle(x, y, width, height, payload, pixelFormat);
        break;
      }

      case 1:
        await reader.readExactly(4, timeoutMs);
        break;

      case -224:
      case -223:
        break;

      default:
        throw new Error(`Unsupported VNC rectangle encoding ${encoding}.`);
    }
  }

  return tracker.snapshot();
}

async function skipSetColorMapEntries(reader: SocketByteReader, timeoutMs: number) {
  const header = await reader.readExactly(5, timeoutMs);
  const colorCount = header.readUInt16BE(3);
  await reader.readExactly(colorCount * 6, timeoutMs);
}

async function skipServerCutText(reader: SocketByteReader, timeoutMs: number) {
  const header = await reader.readExactly(7, timeoutMs);
  const textLength = header.readUInt32BE(3);
  await reader.readExactly(textLength, timeoutMs);
}

function parseVncPixelFormat(payload: Buffer): VncPixelFormat {
  return {
    bigEndian: payload[2] === 1,
    bitsPerPixel: payload[0] ?? 0,
    blueMax: payload.readUInt16BE(8),
    blueShift: payload[13] ?? 0,
    depth: payload[1] ?? 0,
    greenMax: payload.readUInt16BE(6),
    greenShift: payload[12] ?? 0,
    redMax: payload.readUInt16BE(4),
    redShift: payload[11] ?? 0,
    trueColor: payload[3] === 1,
  };
}

function sendSetEncodings(socket: Socket) {
  const payload = Buffer.alloc(8);
  payload[0] = 2;
  payload.writeUInt16BE(1, 2);
  payload.writeInt32BE(0, 4);
  socket.write(payload);
}

function sendFramebufferUpdateRequest(
  socket: Socket,
  frameWidth: number,
  frameHeight: number,
  incremental: boolean,
) {
  const payload = Buffer.alloc(10);
  payload[0] = 3;
  payload[1] = incremental ? 1 : 0;
  payload.writeUInt16BE(0, 2);
  payload.writeUInt16BE(0, 4);
  payload.writeUInt16BE(frameWidth, 6);
  payload.writeUInt16BE(frameHeight, 8);
  socket.write(payload);
}

async function connectToVnc(host: string, port: number): Promise<Socket> {
  return await new Promise((resolve, reject) => {
    const socket = createConnection({
      host,
      port,
    });
    const timer = setTimeout(() => {
      cleanup();
      socket.destroy();
      reject(new Error(`Timed out connecting to ${host}:${port}.`));
    }, 7_000);

    const cleanup = () => {
      clearTimeout(timer);
      socket.off("connect", onConnect);
      socket.off("error", onError);
    };

    const onConnect = () => {
      cleanup();
      socket.setNoDelay(true);
      resolve(socket);
    };

    const onError = (error: Error) => {
      cleanup();
      socket.destroy();
      reject(error);
    };

    socket.on("connect", onConnect);
    socket.on("error", onError);
  });
}

async function installGuestHttpService(instanceName: string) {
  const installScript = buildGuestHttpInstallScript();

  await waitFor(
    `guest HTTP service install on ${instanceName}`,
    120_000,
    5_000,
    async () => {
      try {
        runCommand(INCUS_BIN, ["exec", instanceName, "--", "sh", "-lc", installScript]);
        return true;
      } catch {
        return null;
      }
    },
  );
}

function buildGuestHttpInstallScript() {
  return `set -eu
mkdir -p /var/www/html /etc/systemd/system
cat > /etc/systemd/system/parallaize-http.service <<'PARALLAIZE_HTTP_SERVICE'
[Unit]
Description=Parallaize smoke HTTP service
After=network.target

[Service]
Type=simple
WorkingDirectory=/var/www/html
ExecStart=/usr/bin/python3 -m http.server ${GUEST_HTTP_PORT} --bind :: --directory /var/www/html
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
PARALLAIZE_HTTP_SERVICE
cat > /var/www/html/index.html <<'PARALLAIZE_SMOKE_HTML'
<!doctype html>
<html lang="en">
  <body style="font-family: sans-serif; padding: 2rem;">
    <h1>${HTTP_BODY_MARKER}</h1>
    <p>Forwarded through the VM on port ${GUEST_HTTP_PORT}.</p>
  </body>
</html>
PARALLAIZE_SMOKE_HTML
systemctl daemon-reload
systemctl enable --now parallaize-http.service`;
}

async function waitFor<T>(
  label: string,
  timeoutMs: number,
  intervalMs: number,
  resolver: () => Promise<T | null>,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await resolver();

    if (result) {
      return result;
    }

    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for ${label}.`);
}

async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<ApiEnvelope<T>> {
  const authHeaders = await buildAuthHeaders();
  const headers = new Headers(init.headers);

  for (const [key, value] of Object.entries(authHeaders)) {
    headers.set(key, value);
  }

  if (init.body) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(new URL(path, CONTROL_URL), {
    ...init,
    headers,
  });
  const payload = await response.json() as ApiEnvelope<T>;

  if (!response.ok || payload.ok === false) {
    throw new Error(
      payload.error
        ? `${response.status} ${payload.error}`
        : `${response.status} request failed for ${path}`,
    );
  }

  return payload;
}

function buildGuestHttpUrl(host: string, port: number) {
  return new URL(`http://${host.includes(":") ? `[${host}]` : host}:${port}/`);
}

async function buildAuthHeaders(): Promise<Record<string, string>> {
  const sessionCookie = await ensureAuthSessionCookie();

  if (!sessionCookie) {
    return {};
  }

  return {
    cookie: sessionCookie,
  };
}

async function ensureAuthSessionCookie() {
  if (!AUTH_PASSWORD) {
    return null;
  }

  if (authSessionCookie) {
    return authSessionCookie;
  }

  const response = await fetch(new URL("/api/auth/login", CONTROL_URL), {
    body: JSON.stringify({
      password: AUTH_PASSWORD,
      username: AUTH_USERNAME,
    }),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    method: "POST",
  });
  const payload = await response.json() as ApiEnvelope<unknown>;

  if (!response.ok || payload.ok === false) {
    throw new Error(
      payload.error
        ? `${response.status} ${payload.error}`
        : `${response.status} login request failed`,
    );
  }

  authSessionCookie = extractSessionCookie(response);
  return authSessionCookie;
}

function extractSessionCookie(response: Response) {
  const setCookieHeaders =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];
  const header = setCookieHeaders[0] ?? response.headers.get("set-cookie");

  if (!header) {
    throw new Error("Login succeeded but did not return a session cookie.");
  }

  return header.split(";", 1)[0];
}

function buildWebSocketUrl(path: string) {
  const base = new URL(PUBLIC_URL);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = path;
  base.search = "";
  return base.toString();
}

function runCommand(command: string, args: string[], strict = true) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
  });

  if (strict && result.status !== 0) {
    throw new Error(
      [`Command failed: ${command} ${args.join(" ")}`, result.stderr.trim(), result.stdout.trim()]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return result;
}

function parseInteger(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeOptionalString(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function requireVmSession(session: SmokeVmSession | null): { display: string | null; host: string; port: number } {
  if (!session?.host || !session.port) {
    throw new Error("VM did not report a reachable VNC session.");
  }

  return {
    display: session.display,
    host: session.host,
    port: session.port,
  };
}

function formatVisibilityStats(stats: FramebufferVisibilityStats) {
  return [
    `${formatPercent(stats.nonBlackPixelRatio)} non-black pixels`,
    `${stats.litTileCount} lit tiles`,
    `${stats.uniqueColorBucketCount} color buckets`,
  ].join(", ");
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function logStep(message: string) {
  process.stdout.write(`[smoke] ${message}\n`);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

class SocketByteReader {
  private readonly buffers: Buffer[] = [];
  private bufferedBytes = 0;
  private ended = false;
  private error: Error | null = null;
  private readonly waiters = new Set<() => void>();

  constructor(socket: Socket) {
    socket.on("data", (chunk: Buffer) => {
      this.buffers.push(chunk);
      this.bufferedBytes += chunk.length;
      this.notifyWaiters();
    });
    socket.on("end", () => {
      this.ended = true;
      this.notifyWaiters();
    });
    socket.on("close", () => {
      this.ended = true;
      this.notifyWaiters();
    });
    socket.on("error", (error) => {
      this.error = error;
      this.notifyWaiters();
    });
  }

  async readExactly(byteCount: number, timeoutMs: number): Promise<Buffer> {
    const deadline = Date.now() + timeoutMs;

    while (this.bufferedBytes < byteCount) {
      if (this.error) {
        throw this.error;
      }

      if (this.ended) {
        throw new Error(`Socket closed while waiting for ${byteCount} bytes.`);
      }

      const remainingMs = deadline - Date.now();

      if (remainingMs <= 0) {
        throw new Error(`Timed out waiting for ${byteCount} bytes from the VNC server.`);
      }

      await this.waitForData(remainingMs);
    }

    return this.consume(byteCount);
  }

  private consume(byteCount: number) {
    const chunks: Buffer[] = [];
    let remaining = byteCount;

    while (remaining > 0) {
      const current = this.buffers[0];

      if (!current) {
        throw new Error(`Requested ${byteCount} buffered bytes, but the queue was empty.`);
      }

      if (current.length <= remaining) {
        chunks.push(current);
        this.buffers.shift();
        remaining -= current.length;
        continue;
      }

      chunks.push(current.subarray(0, remaining));
      this.buffers[0] = current.subarray(remaining);
      remaining = 0;
    }

    this.bufferedBytes -= byteCount;
    return Buffer.concat(chunks, byteCount);
  }

  private async waitForData(timeoutMs: number) {
    return await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(onReady);
        reject(new Error("Timed out waiting for VNC socket data."));
      }, timeoutMs);

      const onReady = () => {
        clearTimeout(timer);
        this.waiters.delete(onReady);
        resolve();
      };

      this.waiters.add(onReady);
    });
  }

  private notifyWaiters() {
    for (const waiter of [...this.waiters]) {
      waiter();
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
