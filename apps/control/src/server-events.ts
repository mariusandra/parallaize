import type { ServerResponse } from "node:http";

import type {
  DashboardSummary,
  SyncVmResolutionControlInput,
  VmLogsSnapshot,
  VmResolutionControlSnapshot,
} from "../../../packages/shared/src/types.js";
import type { DesktopManager } from "./manager.js";
import type { DesktopProvider, VmLogsStreamHandle } from "./providers.js";
import { resolveErrorMessage, writeSseEvent } from "./server-http.js";

interface CreateServerEventStreamsOptions {
  manager: DesktopManager;
  provider: DesktopProvider;
  resolutionControlLeaseTtlMs?: number;
  vmLogTailReconnectDelayMs?: number;
}

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

export function createServerEventStreams({
  manager,
  provider,
  resolutionControlLeaseTtlMs = 5_000,
  vmLogTailReconnectDelayMs = 1_000,
}: CreateServerEventStreamsOptions): {
  close(): void;
  handleSummaryEvents(response: ServerResponse): void;
  handleVmLogEvents(response: ServerResponse, vmId: string): Promise<void>;
  syncVmResolutionControl(
    vmId: string,
    input: SyncVmResolutionControlInput,
  ): VmResolutionControlSnapshot;
} {
  const activeEventStreams = new Set<ServerResponse>();
  const activeVmLogTailSessions = new Map<string, VmLogTailSession>();
  const resolutionControlLeases = new Map<string, ResolutionControlLeaseRecord>();

  function handleSummaryEvents(response: ServerResponse): void {
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
    }, 15_000);

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
    }, 15_000);

    response.on("close", () => {
      clearInterval(heartbeat);
      detachVmLogTailSubscriber(session, response);
    });

    void syncVmLogTailSession(session);
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

    if (!existingLease || existingLease.clientId === clientId || input.force === true) {
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

  function broadcastResolutionControlSnapshot(
    snapshot: VmResolutionControlSnapshot,
  ): void {
    const payload = JSON.stringify(snapshot);

    for (const response of activeEventStreams) {
      writeSseEvent(response, "resolution-control", payload);
    }
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
    if (typeof provider.streamVmLogs === "function" && !shouldPreferVmLogTailSnapshot(vm)) {
      return `${vm.providerRef}|${vm.status}`;
    }

    return `${vm.providerRef}|${vm.status}|${vm.updatedAt}`;
  }

  function shouldPreferVmLogTailSnapshot(vm: DashboardSummary["vms"][number]): boolean {
    return (
      vm.status === "running" &&
      (vm.desktopTransport === "selkies" || vm.session?.kind === "selkies") &&
      !hasVmBrowserDesktopSession(vm.session)
    );
  }

  function hasVmBrowserDesktopSession(
    session: DashboardSummary["vms"][number]["session"],
  ): boolean {
    if (!session) {
      return false;
    }

    switch (session.kind) {
      case "selkies":
        return Boolean(session.browserPath);
      case "vnc":
      case "guacamole":
        return Boolean(session.webSocketPath || session.browserPath);
      default:
        return false;
    }
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

    if (shouldPreferVmLogTailSnapshot(vm)) {
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

  return {
    close(): void {
      closeActiveEventStreams();
      closeActiveVmLogTailSessions();
    },
    handleSummaryEvents,
    handleVmLogEvents,
    syncVmResolutionControl,
  };
}
