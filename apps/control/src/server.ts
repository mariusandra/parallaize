import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { extname, join, normalize } from "node:path";
import { pipeline } from "node:stream/promises";

import type {
  AuthStatus,
  ApiResponse,
  CaptureTemplateInput,
  CloneVmInput,
  CreateTemplateInput,
  CreateVmInput,
  DashboardSummary,
  HealthStatus,
  IncusStorageActionResult,
  InjectCommandInput,
  LoginInput,
  LatestReleaseMetadata,
  ReorderVmsInput,
  RunIncusStorageActionInput,
  ResizeVmInput,
  SetVmResolutionInput,
  SnapshotLaunchInput,
  SnapshotInput,
  SyncVmResolutionControlInput,
  UpdateTemplateInput,
  UpdateVmInput,
  UpdateVmForwardedPortsInput,
  UpdateVmNetworkInput,
  VmDetail,
  VmDiskUsageSnapshot,
  VmFileBrowserSnapshot,
  VmLogsSnapshot,
  VmResolutionControlSnapshot,
  VmTouchedFilesSnapshot,
} from "../../../packages/shared/src/types.js";
import { loadConfig } from "./config.js";
import { collectIncusStorageDiagnostics, runIncusStorageAction } from "./incus-storage.js";
import { DesktopManager } from "./manager.js";
import { VmNetworkBridge } from "./network.js";
import { createProvider, type VmLogsStreamHandle } from "./providers.js";
import { createSeedState } from "./seed.js";
import { createStateStore } from "./store.js";

const config = loadConfig();
const provider = createProvider(config.providerKind, config.incusBinary, {
  project: config.incusProject ?? undefined,
  storagePool: config.incusStoragePool ?? undefined,
  guestVncPort: config.guestVncPort,
  guestInotifyMaxUserWatches: config.guestInotifyMaxUserWatches,
  guestInotifyMaxUserInstances: config.guestInotifyMaxUserInstances,
  templateCompression: config.templateCompression,
});
const store = await createStateStore(
  {
    kind: config.persistenceKind,
    dataFile: config.dataFile,
    databaseUrl: config.databaseUrl,
    defaultTemplateLaunchSource: config.defaultTemplateLaunchSource,
  },
  () =>
    createSeedState(provider.state, {
      defaultTemplateLaunchSource: config.defaultTemplateLaunchSource,
    }),
);
const manager = new DesktopManager(store, provider, {
  forwardedServiceHostBase: config.forwardedServiceHostBase,
  defaultTemplateLaunchSource: config.configuredDefaultTemplateLaunchSource,
});
const networkBridge = new VmNetworkBridge(manager);
manager.start();

const staticRoot = join(config.appHome, "dist", "apps", "web", "static");
const htmlPath = join(staticRoot, "index.html");
const faviconPath = join(staticRoot, "favicon.svg");
const sessionCookieName = "parallaize_session";
const resolutionControlLeaseTtlMs = 5_000;
const maxAdminSessions = 32;
const activeSockets = new Set<Socket>();
const activeEventStreams = new Set<ServerResponse>();
const activeVmLogTailSessions = new Map<string, VmLogTailSession>();
const resolutionControlLeases = new Map<string, ResolutionControlLeaseRecord>();
const latestReleaseCacheTtlMs = 10 * 60 * 1000;
const vmLogTailReconnectDelayMs = 1_000;
let latestReleaseCache: {
  expiresAtMs: number;
  value: LatestReleaseMetadata | null;
} | null = null;
let latestReleasePromise: Promise<LatestReleaseMetadata | null> | null = null;

interface ResolutionControlLeaseRecord {
  clientId: string;
  claimedAtMs: number;
  heartbeatAtMs: number;
  vmId: string;
}

interface ActiveVmLogStream {
  closed: boolean;
  handle: VmLogsStreamHandle;
  providerRef: string;
}

interface VmLogTailSession {
  closed: boolean;
  lastSnapshot: VmLogsSnapshot | null;
  liveStream: ActiveVmLogStream | null;
  readyPromise: Promise<void> | null;
  refreshPromise: Promise<void> | null;
  restartTimer: NodeJS.Timeout | null;
  stateKey: string | null;
  subscribers: Set<ServerResponse>;
  summaryUnsubscribe: (() => void) | null;
  vmId: string;
}

interface VmLogsAppendEvent {
  chunk: string;
  fetchedAt: string;
  source: string;
}

interface ParsedSessionCookie {
  sessionId: string;
  secret: string;
}

interface AuthContext {
  sessionId: string | null;
  setCookie: string | null;
  status: AuthStatus;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    const method = request.method ?? "GET";

    if (method === "POST" && url.pathname === "/api/auth/login") {
      return handleLogin(request, response);
    }

    if (method === "GET" && url.pathname === "/api/auth/status") {
      const authContext = resolveAuthContext(request);
      applyAuthContext(response, authContext);
      return writeJson<AuthStatus>(response, 200, {
        ok: true,
        data: authContext.status,
      });
    }

    if (method === "POST" && url.pathname === "/api/auth/logout") {
      return handleLogout(request, response);
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

    const authContext = resolveAuthContext(request);
    applyAuthContext(response, authContext);

    if (!authContext.status.authenticated) {
      writeAuthRequired(response);
      return;
    }

    if (method === "GET" && url.pathname === "/api/health") {
      const providerState = manager.getProviderState();
      const persistence = store.getDiagnostics();
      const incusStorage = collectIncusStorageDiagnostics(config);
      const status =
        providerState.hostStatus === "ready" &&
        persistence.status === "ready" &&
        (incusStorage === null || incusStorage.status === "ready")
          ? "ok"
          : "degraded";

      return writeJson<HealthStatus>(response, 200, {
        ok: true,
        data: {
          status,
          provider: providerState,
          persistence,
          incusStorage,
          generatedAt: new Date().toISOString(),
        },
      });
    }

    if (method === "POST" && url.pathname === "/api/incus/storage/action") {
      const payload = await readJsonBody<RunIncusStorageActionInput>(request);
      return writeJson<IncusStorageActionResult>(response, 200, {
        ok: true,
        data: runIncusStorageAction(config, payload.action),
      });
    }

    if (method === "GET" && url.pathname === "/api/summary") {
      return writeJson<DashboardSummary>(response, 200, {
        ok: true,
        data: manager.getSummary(),
      });
    }

    if (method === "GET" && url.pathname === "/api/version/latest") {
      return writeJson<LatestReleaseMetadata | null>(response, 200, {
        ok: true,
        data: await getLatestReleaseMetadata(),
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

    const vmLogsLiveMatch = url.pathname.match(/^\/api\/vms\/([^/]+)\/logs\/live$/);
    if (method === "GET" && vmLogsLiveMatch) {
      return handleVmLogEvents(response, vmLogsLiveMatch[1]);
    }

    const vmLogsMatch = url.pathname.match(/^\/api\/vms\/([^/]+)\/logs$/);
    if (method === "GET" && vmLogsMatch) {
      return writeJson<VmLogsSnapshot>(response, 200, {
        ok: true,
        data: await manager.getVmLogs(vmLogsMatch[1]),
      });
    }

    const vmDiskUsageMatch = url.pathname.match(/^\/api\/vms\/([^/]+)\/disk-usage$/);
    if (method === "GET" && vmDiskUsageMatch) {
      return writeJson<VmDiskUsageSnapshot>(response, 200, {
        ok: true,
        data: await manager.getVmDiskUsage(vmDiskUsageMatch[1]),
      });
    }

    const vmTouchedFilesMatch = url.pathname.match(/^\/api\/vms\/([^/]+)\/files\/touched$/);
    if (method === "GET" && vmTouchedFilesMatch) {
      return writeJson<VmTouchedFilesSnapshot>(response, 200, {
        ok: true,
        data: await manager.getVmTouchedFiles(vmTouchedFilesMatch[1]),
      });
    }

    const vmFileDownloadMatch = url.pathname.match(/^\/api\/vms\/([^/]+)\/files\/download$/);
    if ((method === "GET" || method === "HEAD") && vmFileDownloadMatch) {
      return serveVmFileDownload(
        response,
        await manager.readVmFile(vmFileDownloadMatch[1], url.searchParams.get("path") ?? ""),
        method === "HEAD",
      );
    }

    const vmFilesMatch = url.pathname.match(/^\/api\/vms\/([^/]+)\/files$/);
    if (method === "GET" && vmFilesMatch) {
      return writeJson<VmFileBrowserSnapshot>(response, 200, {
        ok: true,
        data: await manager.browseVmFiles(
          vmFilesMatch[1],
          url.searchParams.get("path"),
        ),
      });
    }

    if (method === "POST" && url.pathname === "/api/vms/reorder") {
      const payload = await readJsonBody<ReorderVmsInput>(request);
      return writeJson<DashboardSummary>(response, 200, {
        ok: true,
        data: manager.reorderVms(payload),
      });
    }

    const vmUpdateMatch = url.pathname.match(/^\/api\/vms\/([^/]+)\/update$/);
    if (method === "POST" && vmUpdateMatch) {
      const payload = await readJsonBody<UpdateVmInput>(request);
      const vm = manager.updateVm(vmUpdateMatch[1], payload);
      return writeJson(response, 200, {
        ok: true,
        data: vm,
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
        });
      }

      manager.restoreVmSnapshot(vmId, snapshotId);
      return writeAccepted(response);
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

    const networkModeMatch = url.pathname.match(/^\/api\/vms\/([^/]+)\/network$/);
    if (method === "POST" && networkModeMatch) {
      const payload = await readJsonBody<UpdateVmNetworkInput>(request);
      await manager.setVmNetworkMode(networkModeMatch[1], payload);
      return writeAccepted(response);
    }

    const resolutionMatch = url.pathname.match(/^\/api\/vms\/([^/]+)\/resolution$/);
    if (method === "POST" && resolutionMatch) {
      const payload = await readJsonBody<SetVmResolutionInput>(request);
      await manager.setVmResolution(resolutionMatch[1], payload);
      return writeAccepted(response);
    }

    const resolutionControlMatch = url.pathname.match(
      /^\/api\/vms\/([^/]+)\/resolution-control\/claim$/,
    );
    if (method === "POST" && resolutionControlMatch) {
      const vmId = resolutionControlMatch[1];
      manager.getVmDetail(vmId);
      const payload = await readJsonBody<SyncVmResolutionControlInput>(request);
      return writeJson<VmResolutionControlSnapshot>(response, 200, {
        ok: true,
        data: syncVmResolutionControl(vmId, payload),
      });
    }

    const actionMatch = url.pathname.match(/^\/api\/vms\/([^/]+)\/(clone|start|stop|restart|delete|snapshot|resize|template|input)$/);
    if (method === "POST" && actionMatch) {
      const vmId = actionMatch[1];
      const action = actionMatch[2];

      switch (action) {
        case "clone": {
          const payload = await readJsonBody<CloneVmInput>(request);
          const vm = manager.cloneVm({
            sourceVmId: vmId,
            name: payload.name,
            resources: payload.resources,
            networkMode: payload.networkMode,
            shutdownSourceBeforeClone: payload.shutdownSourceBeforeClone,
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
        case "restart":
          manager.restartVm(vmId);
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

    if (method === "POST" && url.pathname === "/api/templates") {
      const payload = await readJsonBody<CreateTemplateInput>(request);
      const template = manager.createTemplate(payload);
      return writeJson(response, 201, {
        ok: true,
        data: template,
      });
    }

    const templateActionMatch = url.pathname.match(/^\/api\/templates\/([^/]+)\/(update|delete)$/);
    if (method === "POST" && templateActionMatch) {
      const templateId = templateActionMatch[1];
      const action = templateActionMatch[2];

      switch (action) {
        case "update": {
          const payload = await readJsonBody<UpdateTemplateInput>(request);
          const template = manager.updateTemplate(templateId, payload);
          return writeJson(response, 200, {
            ok: true,
            data: template,
          });
        }
        case "delete":
          manager.deleteTemplate(templateId);
          return writeAccepted(response);
        default:
          break;
      }
    }

    writeJson(response, 404, {
      ok: false,
      error: `No route matched ${method} ${url.pathname}`,
    });
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

server.on("connection", (socket) => {
  activeSockets.add(socket);
  socket.on("close", () => {
    activeSockets.delete(socket);
  });
});

server.on("upgrade", (request, socket, head) => {
  if (!resolveAuthContext(request).status.authenticated) {
    writeSocketAuthRequired(socket as Socket);
    return;
  }

  if (networkBridge.maybeHandleUpgrade(request, socket as Socket, head)) {
    return;
  }

  socket.destroy();
});

server.listen(config.port, config.host, () => {
  const boundAddress = server.address();
  const boundPort =
    boundAddress && typeof boundAddress === "object"
      ? boundAddress.port
      : config.port;
  process.stdout.write(
    `parallaize listening on http://${config.host}:${boundPort} using ${provider.state.kind} provider with ${config.persistenceKind} persistence\n`,
  );
  if (config.adminPassword) {
    process.stdout.write(
      `single-admin auth enabled for ${config.adminUsername} (persisted cookie sessions)\n`,
    );
  }
});

registerShutdownHandlers();

function handleEvents(response: ServerResponse): void {
  activeEventStreams.add(response);
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });

  const unsubscribe = manager.subscribe((summary) => {
    writeSseEvent(response, "summary", JSON.stringify(summary));
  });

  const heartbeat = setInterval(() => {
    writeSseEvent(response, "heartbeat", String(Date.now()));
  }, 15000);

  response.on("close", () => {
    activeEventStreams.delete(response);
    clearInterval(heartbeat);
    unsubscribe();
  });
}

async function handleVmLogEvents(
  response: ServerResponse,
  vmId: string,
): Promise<void> {
  const session = await getOrCreateVmLogTailSession(vmId);
  const initialSnapshot = session.lastSnapshot;

  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  response.write("retry: 1000\n\n");

  if (initialSnapshot) {
    writeSseEvent(response, "snapshot", JSON.stringify(initialSnapshot));
  }

  session.subscribers.add(response);

  if (
    initialSnapshot &&
    session.lastSnapshot &&
    !sameVmLogsSnapshot(initialSnapshot, session.lastSnapshot)
  ) {
    writeSseEvent(response, "snapshot", JSON.stringify(session.lastSnapshot));
  }

  const heartbeat = setInterval(() => {
    writeSseEvent(response, "heartbeat", String(Date.now()));
  }, 15000);

  response.on("close", () => {
    clearInterval(heartbeat);
    detachVmLogTailSubscriber(session, response);
  });

  void syncVmLogTailSession(session);
}

async function getOrCreateVmLogTailSession(vmId: string): Promise<VmLogTailSession> {
  const existing = activeVmLogTailSessions.get(vmId);

  if (existing) {
    await existing.readyPromise;
    return existing;
  }

  const session: VmLogTailSession = {
    closed: false,
    lastSnapshot: null,
    liveStream: null,
    readyPromise: null,
    refreshPromise: null,
    restartTimer: null,
    stateKey: null,
    subscribers: new Set<ServerResponse>(),
    summaryUnsubscribe: null,
    vmId,
  };

  activeVmLogTailSessions.set(vmId, session);
  session.readyPromise = initializeVmLogTailSession(session);

  try {
    await session.readyPromise;
    return session;
  } catch (error) {
    destroyVmLogTailSession(session, false);
    throw error;
  }
}

async function initializeVmLogTailSession(session: VmLogTailSession): Promise<void> {
  await refreshVmLogTailSnapshot(session, false);

  if (session.closed) {
    return;
  }

  const vm = manager.getVmDetail(session.vmId).vm;
  session.stateKey = buildVmLogTailStateKey(vm);
  session.summaryUnsubscribe = manager.subscribe((summary) => {
    void handleVmLogTailSummary(session, summary);
  });
}

async function handleVmLogTailSummary(
  session: VmLogTailSession,
  summary: DashboardSummary,
): Promise<void> {
  if (session.closed) {
    return;
  }

  const vm = summary.vms.find((entry) => entry.id === session.vmId);

  if (!vm) {
    broadcastVmLogTailError(session, "Workspace no longer exists.");
    destroyVmLogTailSession(session);
    return;
  }

  const nextStateKey = buildVmLogTailStateKey(vm);

  if (nextStateKey === session.stateKey) {
    return;
  }

  session.stateKey = nextStateKey;
  syncVmLogTailStream(session, vm);

  try {
    await refreshVmLogTailSnapshot(session);
  } catch (error) {
    if (!session.closed) {
      broadcastVmLogTailError(session, resolveErrorMessage(error));
    }
  }
}

async function refreshVmLogTailSnapshot(
  session: VmLogTailSession,
  broadcastChanges = true,
): Promise<void> {
  if (session.refreshPromise) {
    await session.refreshPromise;
    return;
  }

  session.refreshPromise = (async () => {
    const snapshot = await manager.getVmLogs(session.vmId);

    if (session.closed) {
      return;
    }

    const changed = !sameVmLogsSnapshot(session.lastSnapshot, snapshot);
    session.lastSnapshot = snapshot;

    if (broadcastChanges && changed) {
      broadcastVmLogTailSnapshot(session, snapshot);
    }
  })().finally(() => {
    session.refreshPromise = null;
  });

  await session.refreshPromise;
}

function buildVmLogTailStateKey(vm: DashboardSummary["vms"][number]): string {
  if (typeof provider.streamVmLogs === "function") {
    return `${vm.providerRef}|${vm.status}`;
  }

  return `${vm.providerRef}|${vm.status}|${vm.updatedAt}`;
}

async function syncVmLogTailSession(session: VmLogTailSession): Promise<void> {
  if (session.closed) {
    return;
  }

  try {
    syncVmLogTailStream(session, manager.getVmDetail(session.vmId).vm);
  } catch (error) {
    broadcastVmLogTailError(session, resolveErrorMessage(error));
  }
}

function syncVmLogTailStream(
  session: VmLogTailSession,
  vm: DashboardSummary["vms"][number],
): void {
  if (typeof provider.streamVmLogs !== "function") {
    return;
  }

  if (session.closed || session.subscribers.size === 0 || vm.status !== "running") {
    clearVmLogTailRestartTimer(session);
    stopVmLogTailStream(session);
    return;
  }

  if (session.liveStream?.providerRef === vm.providerRef) {
    return;
  }

  clearVmLogTailRestartTimer(session);
  stopVmLogTailStream(session);

  const activeStream: ActiveVmLogStream = {
    closed: false,
    handle: {
      close() {},
    },
    providerRef: vm.providerRef,
  };

  activeStream.handle = provider.streamVmLogs(vm, {
    onAppend: (chunk) => {
      if (session.closed || activeStream.closed || session.liveStream !== activeStream) {
        return;
      }

      const fetchedAt = new Date().toISOString();
      const source = "incus console live tail";
      const currentSnapshot = session.lastSnapshot ?? {
        provider: vm.provider,
        providerRef: vm.providerRef,
        source,
        content: "",
        fetchedAt,
      };

      session.lastSnapshot = {
        ...currentSnapshot,
        provider: vm.provider,
        providerRef: vm.providerRef,
        source,
        content: `${currentSnapshot.content}${chunk}`,
        fetchedAt,
      };

      broadcastVmLogTailAppend(session, {
        chunk,
        fetchedAt,
        source,
      });
    },
    onClose: () => {
      if (session.closed || activeStream.closed || session.liveStream !== activeStream) {
        return;
      }

      session.liveStream = null;
      scheduleVmLogTailRestart(session);
    },
    onError: (error) => {
      if (session.closed || activeStream.closed || session.liveStream !== activeStream) {
        return;
      }

      session.liveStream = null;
      broadcastVmLogTailError(session, resolveErrorMessage(error));
      scheduleVmLogTailRestart(session);
    },
  });

  session.liveStream = activeStream;
}

function stopVmLogTailStream(session: VmLogTailSession): void {
  const activeStream = session.liveStream;

  if (!activeStream) {
    return;
  }

  session.liveStream = null;
  activeStream.closed = true;
  activeStream.handle.close();
}

function scheduleVmLogTailRestart(session: VmLogTailSession): void {
  if (
    session.closed ||
    session.restartTimer !== null ||
    session.subscribers.size === 0 ||
    typeof provider.streamVmLogs !== "function"
  ) {
    return;
  }

  session.restartTimer = setTimeout(() => {
    session.restartTimer = null;
    void (async () => {
      if (session.closed) {
        return;
      }

      try {
        await refreshVmLogTailSnapshot(session);
      } catch (error) {
        if (!session.closed) {
          broadcastVmLogTailError(session, resolveErrorMessage(error));
        }
      }

      await syncVmLogTailSession(session);
    })();
  }, vmLogTailReconnectDelayMs);
}

function clearVmLogTailRestartTimer(session: VmLogTailSession): void {
  if (session.restartTimer === null) {
    return;
  }

  clearTimeout(session.restartTimer);
  session.restartTimer = null;
}

function detachVmLogTailSubscriber(
  session: VmLogTailSession,
  response: ServerResponse,
): void {
  session.subscribers.delete(response);

  if (session.subscribers.size === 0) {
    destroyVmLogTailSession(session, false);
  }
}

function destroyVmLogTailSession(
  session: VmLogTailSession,
  closeSubscribers = true,
): void {
  if (session.closed) {
    return;
  }

  session.closed = true;
  activeVmLogTailSessions.delete(session.vmId);
  clearVmLogTailRestartTimer(session);
  stopVmLogTailStream(session);
  session.summaryUnsubscribe?.();
  session.summaryUnsubscribe = null;

  const subscribers = [...session.subscribers];
  session.subscribers.clear();

  if (!closeSubscribers) {
    return;
  }

  for (const subscriber of subscribers) {
    if (subscriber.destroyed || subscriber.writableEnded) {
      continue;
    }

    subscriber.end();
    subscriber.socket?.end();
  }
}

function broadcastVmLogTailSnapshot(
  session: VmLogTailSession,
  snapshot: VmLogsSnapshot,
): void {
  const payload = JSON.stringify(snapshot);

  for (const subscriber of session.subscribers) {
    writeSseEvent(subscriber, "snapshot", payload);
  }
}

function broadcastVmLogTailAppend(
  session: VmLogTailSession,
  appendEvent: VmLogsAppendEvent,
): void {
  const payload = JSON.stringify(appendEvent);

  for (const subscriber of session.subscribers) {
    writeSseEvent(subscriber, "append", payload);
  }
}

function broadcastVmLogTailError(
  session: VmLogTailSession,
  message: string,
): void {
  const payload = JSON.stringify({
    message,
  });

  for (const subscriber of session.subscribers) {
    writeSseEvent(subscriber, "stream-error", payload);
  }
}

function sameVmLogsSnapshot(
  left: VmLogsSnapshot | null,
  right: VmLogsSnapshot | null,
): boolean {
  return (
    left?.provider === right?.provider &&
    left?.providerRef === right?.providerRef &&
    left?.source === right?.source &&
    left?.content === right?.content
  );
}

async function getLatestReleaseMetadata(): Promise<LatestReleaseMetadata | null> {
  const now = Date.now();

  if (latestReleaseCache && now < latestReleaseCache.expiresAtMs) {
    return latestReleaseCache.value;
  }

  if (latestReleasePromise) {
    return latestReleasePromise;
  }

  latestReleasePromise = loadLatestReleaseMetadata().finally(() => {
    latestReleasePromise = null;
  });

  return latestReleasePromise;
}

async function loadLatestReleaseMetadata(): Promise<LatestReleaseMetadata | null> {
  try {
    const response = await fetch(config.releaseMetadataUrl, {
      headers: {
        accept: "application/json",
      },
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) {
      cacheLatestReleaseMetadata(null);
      return null;
    }

    const payload = parseLatestReleaseMetadata(await response.json());
    cacheLatestReleaseMetadata(payload);
    return payload;
  } catch {
    cacheLatestReleaseMetadata(null);
    return null;
  }
}

function cacheLatestReleaseMetadata(value: LatestReleaseMetadata | null): void {
  latestReleaseCache = {
    expiresAtMs: Date.now() + latestReleaseCacheTtlMs,
    value,
  };
}

function parseLatestReleaseMetadata(value: unknown): LatestReleaseMetadata | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  const version = normalizeStableSemver(value.version);
  const packageRelease = normalizePackageRelease(value.packageRelease);

  if (!version || !packageRelease) {
    return null;
  }

  const packageLabel =
    normalizeNonEmptyString(value.packageLabel) ?? `${version}-${packageRelease}`;

  return {
    version,
    packageRelease,
    packageLabel,
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeStableSemver(value: unknown): string | null {
  const normalized = normalizeNonEmptyString(value);
  return normalized && /^\d+\.\d+\.\d+$/u.test(normalized) ? normalized : null;
}

function normalizePackageRelease(value: unknown): string | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return String(value);
  }

  const normalized = normalizeNonEmptyString(value);
  return normalized && /^[1-9]\d*$/u.test(normalized) ? normalized : null;
}

function syncVmResolutionControl(
  vmId: string,
  input: SyncVmResolutionControlInput,
): VmResolutionControlSnapshot {
  const clientId = input.clientId?.trim();

  if (!clientId) {
    throw new Error("Resolution control client ID is required.");
  }

  const now = Date.now();
  const existingLease = getActiveResolutionControlLease(vmId, now);

  if (
    !existingLease ||
    existingLease.clientId === clientId ||
    input.force === true
  ) {
    const nextLease: ResolutionControlLeaseRecord = {
      clientId,
      claimedAtMs:
        existingLease && existingLease.clientId === clientId
          ? existingLease.claimedAtMs
          : now,
      heartbeatAtMs: now,
      vmId,
    };
    const previousClientId = existingLease?.clientId ?? null;

    resolutionControlLeases.set(vmId, nextLease);

    if (previousClientId !== nextLease.clientId) {
      broadcastResolutionControlSnapshot(buildResolutionControlSnapshot(vmId, nextLease));
    }

    return buildResolutionControlSnapshot(vmId, nextLease);
  }

  return buildResolutionControlSnapshot(vmId, existingLease);
}

function getActiveResolutionControlLease(
  vmId: string,
  now = Date.now(),
): ResolutionControlLeaseRecord | null {
  const lease = resolutionControlLeases.get(vmId);

  if (!lease) {
    return null;
  }

  if (now - lease.heartbeatAtMs > resolutionControlLeaseTtlMs) {
    resolutionControlLeases.delete(vmId);
    return null;
  }

  return lease;
}

function buildResolutionControlSnapshot(
  vmId: string,
  lease: ResolutionControlLeaseRecord | null,
): VmResolutionControlSnapshot {
  return {
    vmId,
    controller:
      lease === null
        ? null
        : {
            clientId: lease.clientId,
            claimedAt: new Date(lease.claimedAtMs).toISOString(),
            heartbeatAt: new Date(lease.heartbeatAtMs).toISOString(),
          },
  };
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

function applyAuthContext(response: ServerResponse, authContext: AuthContext): void {
  if (authContext.setCookie) {
    response.setHeader("set-cookie", authContext.setCookie);
  }
}

function resolveAuthContext(request: IncomingMessage): AuthContext {
  if (!config.adminPassword) {
    return {
      sessionId: null,
      setCookie: null,
      status: buildNoAuthStatus(),
    };
  }

  const sessionCookie = parseCookies(request.headers.cookie)[sessionCookieName];

  if (!sessionCookie) {
    return {
      sessionId: null,
      setCookie: null,
      status: buildUnauthenticatedStatus(),
    };
  }

  const parsedSession = parseSessionCookie(sessionCookie);

  if (!parsedSession) {
    return {
      sessionId: null,
      setCookie: clearSessionCookie(),
      status: buildUnauthenticatedStatus(),
    };
  }

  const now = new Date();
  const credentialFingerprint = buildCredentialFingerprint(
    config.adminUsername,
    config.adminPassword,
  );
  let sessionId: string | null = null;
  let setCookie: string | null = null;

  store.update((draft) => {
    let dirty = pruneAdminSessions(draft, now, credentialFingerprint);
    const session = draft.adminSessions.find((entry) => entry.id === parsedSession.sessionId);

    if (!session) {
      return dirty;
    }

    if (
      !safeEqual(hashSessionSecret(parsedSession.secret), session.secretHash) ||
      !safeEqual(session.username, config.adminUsername)
    ) {
      return dirty;
    }

    sessionId = session.id;

    if (shouldRotateAdminSession(session, now)) {
      const rotatedSecret = createSessionSecret();
      const nowIso = now.toISOString();

      session.secretHash = hashSessionSecret(rotatedSecret);
      session.lastAuthenticatedAt = nowIso;
      session.lastRotatedAt = nowIso;
      session.idleExpiresAt = addSeconds(now, config.sessionIdleTimeoutSeconds).toISOString();
      setCookie = serializeSessionCookie(buildSessionCookieValue(session.id, rotatedSecret));
      dirty = true;
    }

    return dirty;
  });

  if (!sessionId) {
    return {
      sessionId: null,
      setCookie: clearSessionCookie(),
      status: buildUnauthenticatedStatus(),
    };
  }

  return {
    sessionId,
    setCookie,
    status: {
      authEnabled: true,
      authenticated: true,
      username: config.adminUsername,
      mode: "session",
    },
  };
}

async function handleLogin(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (!config.adminPassword) {
    writeJson<AuthStatus>(response, 200, {
      ok: true,
      data: buildNoAuthStatus(),
    });
    return;
  }

  const payload = await readJsonBody<LoginInput>(request);

  if (
    !safeEqual(payload.username ?? "", config.adminUsername) ||
    !safeEqual(payload.password ?? "", config.adminPassword)
  ) {
    writeJson(response, 401, {
      ok: false,
      error: "Invalid username or password.",
    });
    return;
  }

  const now = new Date();
  const sessionId = createSessionId();
  const sessionSecret = createSessionSecret();
  const credentialFingerprint = buildCredentialFingerprint(
    config.adminUsername,
    config.adminPassword,
  );

  store.update((draft) => {
    pruneAdminSessions(draft, now, credentialFingerprint);
    draft.adminSessions.unshift({
      id: sessionId,
      username: config.adminUsername,
      credentialFingerprint,
      secretHash: hashSessionSecret(sessionSecret),
      createdAt: now.toISOString(),
      lastAuthenticatedAt: now.toISOString(),
      lastRotatedAt: now.toISOString(),
      expiresAt: addSeconds(now, config.sessionMaxAgeSeconds).toISOString(),
      idleExpiresAt: addSeconds(now, config.sessionIdleTimeoutSeconds).toISOString(),
    });
    draft.adminSessions = draft.adminSessions.slice(0, maxAdminSessions);
  });

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
      "set-cookie": serializeSessionCookie(buildSessionCookieValue(sessionId, sessionSecret)),
    },
  );
}

function handleLogout(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const parsedSession = parseSessionCookie(
    parseCookies(request.headers.cookie)[sessionCookieName] ?? "",
  );

  if (parsedSession) {
    store.update((draft) => {
      const nextSessions = draft.adminSessions.filter((entry) => entry.id !== parsedSession.sessionId);

      if (nextSessions.length === draft.adminSessions.length) {
        return false;
      }

      draft.adminSessions = nextSessions;
      return true;
    });
  }

  writeJson<AuthStatus>(
    response,
    200,
    {
      ok: true,
      data: config.adminPassword ? buildUnauthenticatedStatus() : buildNoAuthStatus(),
    },
    {
      "set-cookie": clearSessionCookie(),
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

function writeAuthRequired(response: ServerResponse): void {
  writeJson(response, 401, {
    ok: false,
    error: "Authentication required.",
  });
}

function writeSocketAuthRequired(socket: Socket): void {
  socket.write(
    "HTTP/1.1 401 Unauthorized\r\n" +
      "Connection: close\r\n" +
      "Content-Length: 0\r\n\r\n",
  );
  socket.destroy();
}

function buildNoAuthStatus(): AuthStatus {
  return {
    authEnabled: false,
    authenticated: true,
    username: null,
    mode: "none",
  };
}

function buildUnauthenticatedStatus(): AuthStatus {
  return {
    authEnabled: true,
    authenticated: false,
    username: null,
    mode: "unauthenticated",
  };
}

function createSessionId(): string {
  return randomBytes(12).toString("base64url");
}

function createSessionSecret(): string {
  return randomBytes(24).toString("base64url");
}

function buildSessionCookieValue(sessionId: string, secret: string): string {
  return `${sessionId}.${secret}`;
}

function parseSessionCookie(raw: string): ParsedSessionCookie | null {
  const separatorIndex = raw.indexOf(".");

  if (separatorIndex <= 0 || separatorIndex === raw.length - 1) {
    return null;
  }

  return {
    sessionId: raw.slice(0, separatorIndex),
    secret: raw.slice(separatorIndex + 1),
  };
}

function hashSessionSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function buildCredentialFingerprint(username: string, password: string): string {
  return createHash("sha256").update(`${username}\n${password}`).digest("hex");
}

function shouldRotateAdminSession(
  session: {
    idleExpiresAt: string;
    lastRotatedAt: string;
  },
  now: Date,
): boolean {
  const lastRotatedAtMs = Date.parse(session.lastRotatedAt);
  const idleExpiresAtMs = Date.parse(session.idleExpiresAt);

  if (!Number.isFinite(lastRotatedAtMs) || !Number.isFinite(idleExpiresAtMs)) {
    return true;
  }

  return (
    now.getTime() >= lastRotatedAtMs + config.sessionRotationSeconds * 1000 ||
    now.getTime() >= idleExpiresAtMs - config.sessionRotationSeconds * 1000
  );
}

function pruneAdminSessions(
  draft: {
    adminSessions: Array<{
      credentialFingerprint: string;
      createdAt: string;
      expiresAt: string;
      idleExpiresAt: string;
      lastAuthenticatedAt: string;
      lastRotatedAt: string;
      secretHash: string;
      username: string;
      id: string;
    }>;
  },
  now: Date,
  credentialFingerprint: string,
): boolean {
  const nextSessions = draft.adminSessions
    .filter(
      (session) =>
        session.credentialFingerprint === credentialFingerprint &&
        !isExpiredAdminSession(session, now),
    )
    .sort((left, right) => {
      const rightMs = Date.parse(right.lastAuthenticatedAt);
      const leftMs = Date.parse(left.lastAuthenticatedAt);
      return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
    })
    .slice(0, maxAdminSessions);

  if (
    nextSessions.length === draft.adminSessions.length &&
    nextSessions.every((session, index) => sameAdminSessionRecord(session, draft.adminSessions[index]))
  ) {
    return false;
  }

  draft.adminSessions = nextSessions;
  return true;
}

function sameAdminSessionRecord(
  left: {
    credentialFingerprint: string;
    createdAt: string;
    expiresAt: string;
    idleExpiresAt: string;
    lastAuthenticatedAt: string;
    lastRotatedAt: string;
    secretHash: string;
    username: string;
    id: string;
  } | undefined,
  right: {
    credentialFingerprint: string;
    createdAt: string;
    expiresAt: string;
    idleExpiresAt: string;
    lastAuthenticatedAt: string;
    lastRotatedAt: string;
    secretHash: string;
    username: string;
    id: string;
  } | undefined,
): boolean {
  return (
    Boolean(left) &&
    Boolean(right) &&
    left?.id === right?.id &&
    left?.username === right?.username &&
    left?.credentialFingerprint === right?.credentialFingerprint &&
    left?.secretHash === right?.secretHash &&
    left?.createdAt === right?.createdAt &&
    left?.lastAuthenticatedAt === right?.lastAuthenticatedAt &&
    left?.lastRotatedAt === right?.lastRotatedAt &&
    left?.expiresAt === right?.expiresAt &&
    left?.idleExpiresAt === right?.idleExpiresAt
  );
}

function isExpiredAdminSession(
  session: {
    createdAt: string;
    expiresAt: string;
    idleExpiresAt: string;
  },
  now: Date,
): boolean {
  const createdAtMs = Date.parse(session.createdAt);
  const expiresAtMs = Date.parse(session.expiresAt);
  const idleExpiresAtMs = Date.parse(session.idleExpiresAt);

  if (
    !Number.isFinite(createdAtMs) ||
    !Number.isFinite(expiresAtMs) ||
    !Number.isFinite(idleExpiresAtMs)
  ) {
    return true;
  }

  return now.getTime() >= expiresAtMs || now.getTime() >= idleExpiresAtMs;
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function serializeSessionCookie(token: string): string {
  return `${sessionCookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.sessionMaxAgeSeconds}`;
}

function clearSessionCookie(): string {
  return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) {
    return {};
  }

  const entries = header.split(";").map((part) => part.trim()).filter(Boolean);
  const cookies: Record<string, string> = {};

  for (const entry of entries) {
    const separatorIndex = entry.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1).trim();

    if (!key) {
      continue;
    }

    cookies[key] = value;
  }

  return cookies;
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

  try {
    await pipeline(createReadStream(filePath), response);
  } catch (error) {
    if (isBenignConnectionError(error)) {
      return;
    }

    throw error;
  }
}

function serveVmFileDownload(
  response: ServerResponse,
  file: {
    content: Buffer;
    name: string;
  },
  headOnly = false,
): void {
  response.writeHead(200, {
    "content-type": inferDownloadContentType(file.name),
    "content-disposition": buildDownloadContentDisposition(file.name),
    "content-length": String(file.content.byteLength),
    "cache-control": "no-store",
  });

  if (headOnly) {
    response.end();
    return;
  }

  response.end(file.content);
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

function inferDownloadContentType(fileName: string): string {
  switch (extname(fileName).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
    case ".ts":
    case ".tsx":
      return "text/plain; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".log":
    case ".md":
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".svg":
      return "image/svg+xml; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function buildDownloadContentDisposition(fileName: string): string {
  const safeFileName = fileName.replace(/["\r\n]/g, "_");
  return `attachment; filename="${safeFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
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
    closeActiveEventStreams();
    closeActiveVmLogTailSessions();
    networkBridge.close();

    await new Promise<void>((resolve) => {
      const forceCloseTimer = setTimeout(() => {
        if (typeof server.closeAllConnections === "function") {
          server.closeAllConnections();
        }

        for (const socket of activeSockets) {
          socket.destroy();
        }
      }, 250);

      server.close(() => {
        clearTimeout(forceCloseTimer);
        resolve();
      });

      if (typeof server.closeIdleConnections === "function") {
        server.closeIdleConnections();
      }
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

function writeSseEvent(
  response: ServerResponse,
  event: string,
  data: string,
): void {
  if (response.destroyed || response.writableEnded) {
    return;
  }

  response.write(`event: ${event}\ndata: ${data}\n\n`);
}

function resolveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function broadcastResolutionControlSnapshot(
  snapshot: VmResolutionControlSnapshot,
): void {
  const payload = JSON.stringify(snapshot);

  for (const response of activeEventStreams) {
    writeSseEvent(response, "resolution-control", payload);
  }
}

function closeActiveEventStreams(): void {
  for (const response of activeEventStreams) {
    if (response.destroyed || response.writableEnded) {
      continue;
    }

    response.end();
    response.socket?.end();
  }
}

function closeActiveVmLogTailSessions(): void {
  for (const session of activeVmLogTailSessions.values()) {
    destroyVmLogTailSession(session);
  }
}
