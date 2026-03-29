import { createReadStream, existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { pipeline } from "node:stream/promises";

import type { ApiResponse } from "../../../packages/shared/src/types.js";

export async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {} as T;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

export function writeAccepted(response: ServerResponse): void {
  writeJson(response, 202, {
    ok: true,
    data: {
      accepted: true,
    },
  });
}

export function writeJson<T>(
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

export async function serveFile(
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

export function serveVmFileDownload(
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

export function resolveAsset(
  staticRoot: string,
  pathname: string,
): {
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

export function writeSseEvent(
  response: ServerResponse,
  event: string,
  data: string,
): void {
  if (response.destroyed || response.writableEnded) {
    return;
  }

  response.write(`event: ${event}\ndata: ${data}\n\n`);
}

export function isBenignConnectionError(error: unknown): boolean {
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

export function resolveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
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
