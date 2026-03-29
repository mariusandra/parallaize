import type {
  ApiResponse,
  VmLogsSnapshot,
} from "../../../packages/shared/src/types.js";

export interface VmLogsAppendEvent {
  chunk: string;
  fetchedAt: string;
  source: string;
}

interface VmLogsStreamErrorEvent {
  message: string;
}

export function openVmLogsEventSource(
  vmId: string,
  handlers: {
    onSnapshot(logs: VmLogsSnapshot): void;
    onAppend(appendEvent: VmLogsAppendEvent): void;
    onStreamError(message: string): void;
    onConnectionError(): void;
  },
): () => void {
  const eventSource = new EventSource(`/api/vms/${encodeURIComponent(vmId)}/logs/live`);

  eventSource.addEventListener("snapshot", (event) => {
    handlers.onSnapshot(parseEventSourceData<VmLogsSnapshot>(event));
  });

  eventSource.addEventListener("append", (event) => {
    handlers.onAppend(parseEventSourceData<VmLogsAppendEvent>(event));
  });

  eventSource.addEventListener("stream-error", (event) => {
    handlers.onStreamError(
      parseEventSourceData<VmLogsStreamErrorEvent>(event).message,
    );
  });

  eventSource.addEventListener("error", () => {
    handlers.onConnectionError();
  });

  return () => {
    eventSource.close();
  };
}

export function applyVmLogsAppend(
  logs: VmLogsSnapshot | null,
  appendEvent: VmLogsAppendEvent,
): VmLogsSnapshot | null {
  if (!logs) {
    return logs;
  }

  return {
    ...logs,
    source: appendEvent.source,
    content: `${logs.content}${appendEvent.chunk}`,
    fetchedAt: appendEvent.fetchedAt,
  };
}

export async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: {
      accept: "application/json",
    },
  });

  const payload = (await response.json()) as ApiResponse<T>;

  if (response.status === 401) {
    throw new AuthRequiredError();
  }

  if (!response.ok || !payload.ok) {
    throw new Error(payload.ok ? `Request failed with ${response.status}` : payload.error);
  }

  return payload.data;
}

export async function postJson<T = unknown, Body = unknown>(
  path: string,
  body: Body,
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json()) as ApiResponse<T>;

  if (response.status === 401) {
    throw new AuthRequiredError(
      payload.ok ? "Authentication required." : payload.error,
    );
  }

  if (!response.ok || !payload.ok) {
    throw new Error(payload.ok ? `Request failed with ${response.status}` : payload.error);
  }

  return payload.data;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export class AuthRequiredError extends Error {
  constructor(message = "Authentication required.") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

function parseEventSourceData<T>(event: Event): T {
  return JSON.parse((event as MessageEvent<string>).data) as T;
}
