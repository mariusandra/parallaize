import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import WebSocket from "ws";

const CONTROL_URL = process.env.PARALLAIZE_SMOKE_CONTROL_URL ?? "http://127.0.0.1:3000";
const PUBLIC_URL = process.env.PARALLAIZE_SMOKE_PUBLIC_URL ?? "http://127.0.0.1:8080";
const TEMPLATE_ID = process.env.PARALLAIZE_SMOKE_TEMPLATE_ID ?? "tpl-0001";
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
let authSessionCookie = null;
const VNC_TIMEOUT_MS = 180_000;
const VM_TIMEOUT_MS = 360_000;
const HTTP_TIMEOUT_MS = 180_000;

const HTTP_SERVICE_NAME = "smoke-http";
const HTTP_BODY_MARKER = "Parallaize Smoke Service";

async function main() {
  let vmId = null;
  let vmName = null;

  try {
    logStep(`Using control plane ${CONTROL_URL} and public entrypoint ${PUBLIC_URL}`);
    await assertApiHealthy();

    vmName = `${VM_NAME_PREFIX}-${Date.now()}`;
    const createdVm = await createVm(vmName);
    vmId = createdVm.id;
    logStep(`Created ${vmId} (${vmName})`);

    let detail = await waitForVmRunning(vmId);
    logStep(`VM reported running at ${detail.vm.session?.display ?? "unknown display"}`);

    await waitForVncHandshake(vmId);
    logStep("Browser VNC bridge answered through Caddy");

    await stopVm(vmId);
    await waitForVmStatus(vmId, "stopped");
    logStep("VM stopped for guest HTTP service injection");

    await installGuestHttpService(detail.vm.providerRef);
    logStep(`Injected guest HTTP service on port ${GUEST_HTTP_PORT}`);

    await startVm(vmId);
    detail = await waitForVmRunning(vmId);
    logStep("VM restarted after guest service injection");

    await waitForVncHandshake(vmId);
    logStep("Browser VNC bridge recovered after restart");

    await waitForGuestHttp(detail.vm.session.host, GUEST_HTTP_PORT);
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

async function createVm(name) {
  const response = await fetchJson("/api/vms", {
    method: "POST",
    body: JSON.stringify({
      templateId: TEMPLATE_ID,
      name,
      resources: {
        cpu: 2,
        ramMb: 4096,
        diskGb: 30,
      },
    }),
  });

  return response.data;
}

async function stopVm(vmId) {
  await fetchJson(`/api/vms/${vmId}/stop`, {
    method: "POST",
  });
}

async function startVm(vmId) {
  await fetchJson(`/api/vms/${vmId}/start`, {
    method: "POST",
  });
}

async function deleteVm(vmId) {
  await fetchJson(`/api/vms/${vmId}/delete`, {
    method: "POST",
  });
}

async function configureForward(vmId) {
  await fetchJson(`/api/vms/${vmId}/forwards`, {
    method: "POST",
    body: JSON.stringify({
      forwardedPorts: [
        {
          name: HTTP_SERVICE_NAME,
          guestPort: GUEST_HTTP_PORT,
          protocol: "http",
          description: "Smoke-test guest HTTP service",
        },
      ],
    }),
  });
}

async function getVmDetail(vmId) {
  const payload = await fetchJson(`/api/vms/${vmId}`);
  return payload.data;
}

async function waitForVmRunning(vmId) {
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

async function waitForVmStatus(vmId, expectedStatus) {
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

async function waitForVmDeletion(vmId) {
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

async function waitForVncHandshake(vmId) {
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

async function waitForGuestHttp(host, port) {
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

async function waitForPublicForward(publicPath) {
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

async function attemptVncHandshake(vmId) {
  const wsUrl = buildWebSocketUrl(`/api/vms/${vmId}/vnc`);
  const headers = await buildAuthHeaders();

  return await new Promise((resolve, reject) => {
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

async function installGuestHttpService(instanceName) {
  const poolName = resolveStoragePool(instanceName);
  const rootImagePath = `/var/lib/incus/storage-pools/${poolName}/virtual-machines/${instanceName}/root.img`;
  const workingDir = await mkdtemp(join(tmpdir(), "parallaize-smoke-root-"));
  const mountDir = join(workingDir, "mnt");

  const serviceContent = `[Unit]
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
`;

  const htmlContent = `<!doctype html>
<html lang="en">
  <body style="font-family: sans-serif; padding: 2rem;">
    <h1>${HTTP_BODY_MARKER}</h1>
    <p>Forwarded through the VM on port ${GUEST_HTTP_PORT}.</p>
  </body>
</html>
`;

  const rootPartition = resolveRootPartition(rootImagePath);
  const servicePath = join(workingDir, "parallaize-http.service");
  const htmlPath = join(workingDir, "index.html");

  await mkdir(mountDir, {
    recursive: true,
  });
  await writeFile(servicePath, serviceContent);
  await writeFile(htmlPath, htmlContent);

  try {
    runCommand("sudo", [
      "mount",
      "-o",
      `rw,loop,offset=${rootPartition.offsetBytes}`,
      rootImagePath,
      mountDir,
    ]);
    runCommand(
      "sudo",
      ["mkdir", "-p", `${mountDir}/var/www/html`],
    );
    runCommand("sudo", ["install", "-Dm644", servicePath, `${mountDir}/etc/systemd/system/parallaize-http.service`]);
    runCommand("sudo", ["install", "-Dm644", htmlPath, `${mountDir}/var/www/html/index.html`]);
    runCommand(
      "sudo",
      [
        "systemctl",
        `--root=${mountDir}`,
        "enable",
        "parallaize-http.service",
      ],
    );
  } finally {
    runCommand("sudo", ["umount", mountDir], false);
    await rm(workingDir, {
      force: true,
      recursive: true,
    });
  }
}

function resolveStoragePool(instanceName) {
  const payload = JSON.parse(runCommand(INCUS_BIN, ["query", `/1.0/instances/${instanceName}`]).stdout);
  const poolName =
    payload?.devices?.root?.pool ??
    payload?.expanded_devices?.root?.pool;

  if (!poolName) {
    throw new Error(`Could not resolve root storage pool for ${instanceName}.`);
  }

  return poolName;
}

function resolveRootPartition(rootImagePath) {
  const payload = JSON.parse(
    runCommand("sudo", ["sfdisk", "--json", rootImagePath]).stdout,
  );
  const partitions = payload?.partitiontable?.partitions;
  const sectorSize = Number.parseInt(payload?.partitiontable?.sectorsize ?? "512", 10);

  if (!Array.isArray(partitions) || partitions.length === 0) {
    throw new Error(`No partitions were found in ${rootImagePath}.`);
  }

  const linuxFilesystemType = "0FC63DAF-8483-4772-8E79-3D69D8477DE4";
  const rootPartition = partitions
    .filter((partition) => Number.isFinite(Number.parseInt(String(partition.start), 10)))
    .map((partition) => ({
      startSector: Number.parseInt(String(partition.start), 10),
      sizeSectors: Number.parseInt(String(partition.size), 10),
      type: String(partition.type ?? "").toUpperCase(),
    }))
    .sort((left, right) => right.sizeSectors - left.sizeSectors)
    .find((partition) => partition.type === linuxFilesystemType)
    ?? partitions
      .filter((partition) => Number.isFinite(Number.parseInt(String(partition.start), 10)))
      .map((partition) => ({
        startSector: Number.parseInt(String(partition.start), 10),
        sizeSectors: Number.parseInt(String(partition.size), 10),
      }))
      .sort((left, right) => right.sizeSectors - left.sizeSectors)[0];

  if (!rootPartition) {
    throw new Error(`Could not determine a Linux root partition in ${rootImagePath}.`);
  }

  return {
    offsetBytes: rootPartition.startSector * sectorSize,
  };
}

async function waitFor(label, timeoutMs, intervalMs, resolver) {
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

async function fetchJson(path, init = {}) {
  const authHeaders = await buildAuthHeaders();
  const response = await fetch(new URL(path, CONTROL_URL), {
    headers: {
      ...authHeaders,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
    ...init,
  });
  const payload = await response.json();

  if (!response.ok || payload.ok === false) {
    throw new Error(
      payload?.error
        ? `${response.status} ${payload.error}`
        : `${response.status} request failed for ${path}`,
    );
  }

  return payload;
}

function buildGuestHttpUrl(host, port) {
  return new URL(`http://${host.includes(":") ? `[${host}]` : host}:${port}/`);
}

async function buildAuthHeaders() {
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
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      username: AUTH_USERNAME,
      password: AUTH_PASSWORD,
    }),
  });
  const payload = await response.json();

  if (!response.ok || payload.ok === false) {
    throw new Error(
      payload?.error
        ? `${response.status} ${payload.error}`
        : `${response.status} login request failed`,
    );
  }

  authSessionCookie = extractSessionCookie(response);
  return authSessionCookie;
}

function extractSessionCookie(response) {
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

function buildWebSocketUrl(path) {
  const base = new URL(PUBLIC_URL);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = path;
  base.search = "";
  return base.toString();
}

function runCommand(command, args, strict = true) {
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

function parseInteger(value, fallback) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function logStep(message) {
  process.stdout.write(`[smoke] ${message}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
