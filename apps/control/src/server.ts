import { createServer } from "node:http";
import type { Socket } from "node:net";
import { dirname, join } from "node:path";

import { loadConfig } from "./config.js";
import { DesktopManager } from "./manager.js";
import { VmNetworkBridge } from "./network.js";
import { createProvider } from "./providers.js";
import { createServerAuth } from "./server-auth.js";
import { createServerEventStreams } from "./server-events.js";
import { isBenignConnectionError, writeJson } from "./server-http.js";
import { createLatestReleaseMetadataCache } from "./server-release.js";
import { handlePublicRoute } from "./server-routes-public.js";
import { handleSystemRoute } from "./server-routes-system.js";
import { createVmStreamHealthServer } from "./server-stream-health.js";
import { handleTemplateRoute } from "./server-routes-templates.js";
import { handleVmRoute } from "./server-routes-vms.js";
import { createSeedState } from "./seed.js";
import { createStateStore } from "./store.js";
import { loadOrCreateStreamHealthSecret } from "./stream-health.js";

const config = loadConfig();
const streamHealthSecret = loadOrCreateStreamHealthSecret(
  join(dirname(config.dataFile), "stream-health.secret"),
);
const provider = createProvider(config.providerKind, config.incusBinary, {
  project: config.incusProject ?? undefined,
  storagePool: config.incusStoragePool ?? undefined,
  selkiesHostCacheDir: join(config.appHome, "data", "cache", "selkies"),
  mockDesktopTransport: config.mockDesktopTransport,
  streamHealthSecret,
  controlPlanePort: config.port,
  guestVncPort: config.guestVncPort,
  guestSelkiesPort: config.guestSelkiesPort,
  guestSelkiesRtcConfig: config.guestSelkiesRtcConfig ?? undefined,
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
  streamHealthSecret,
});
const networkBridge = new VmNetworkBridge(manager, {
  guacdHost: config.guacdHost,
  guacdPort: config.guacdPort,
});
const auth = createServerAuth({
  config,
  store,
});
const events = createServerEventStreams({
  manager,
  provider,
});
const streamHealth = createVmStreamHealthServer({
  manager,
});
const releaseMetadataCache = createLatestReleaseMetadataCache({
  releaseMetadataUrl: config.releaseMetadataUrl,
});
manager.start();

const staticRoot = join(config.appHome, "dist", "apps", "web", "static");
const htmlPath = join(staticRoot, "index.html");
const faviconPath = join(staticRoot, "favicon.svg");
const activeSockets = new Set<Socket>();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    const method = request.method ?? "GET";

    if (
      await handlePublicRoute({
        auth,
        faviconPath,
        htmlPath,
        method,
        request,
        response,
        staticRoot,
        url,
      })
    ) {
      return;
    }

    const authContext = auth.resolveAuthContext(request);
    auth.applyAuthContext(response, authContext);

    if (!authContext.status.authenticated) {
      auth.writeAuthRequired(response);
      return;
    }

    if (
      await handleSystemRoute({
        config,
        events,
        manager,
        method,
        request,
        response,
        releaseMetadataCache,
        store,
        url,
      })
    ) {
      return;
    }

    if (await networkBridge.maybeHandleRequest(request, response, url)) {
      return;
    }

    if (
      await handleVmRoute({
        events,
        manager,
        method,
        request,
        response,
        url,
      })
    ) {
      return;
    }

    if (
      await handleTemplateRoute({
        manager,
        method,
        request,
        response,
        url,
      })
    ) {
      return;
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
  if (streamHealth.maybeHandleUpgrade(request, socket as Socket, head)) {
    return;
  }

  if (!auth.resolveAuthContext(request).status.authenticated) {
    auth.writeSocketAuthRequired(socket as Socket);
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

function registerShutdownHandlers(): void {
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    process.stdout.write(`received ${signal}, shutting down parallaize\n`);
    manager.stop();
    events.close();
    streamHealth.close();
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
