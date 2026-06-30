import type { IncomingMessage, ServerResponse } from "node:http";

import type { AuthStatus, CurrentReleaseMetadata } from "../../../packages/shared/src/types.js";
import { createServerAuth } from "./server-auth.js";
import { resolveAsset, serveFile, writeJson } from "./server-http.js";

interface HandlePublicRouteOptions {
  auth: ReturnType<typeof createServerAuth>;
  currentReleaseMetadata: CurrentReleaseMetadata;
  faviconPath: string;
  htmlPath: string;
  method: string;
  request: IncomingMessage;
  response: ServerResponse;
  staticRoot: string;
  url: URL;
}

export async function handlePublicRoute({
  auth,
  currentReleaseMetadata,
  faviconPath,
  htmlPath,
  method,
  request,
  response,
  staticRoot,
  url,
}: HandlePublicRouteOptions): Promise<boolean> {
  if (method === "POST" && url.pathname === "/api/auth/login") {
    await auth.handleLogin(request, response);
    return true;
  }

  if (method === "GET" && url.pathname === "/api/auth/status") {
    const authContext = auth.resolveAuthContext(request);
    auth.applyAuthContext(response, authContext);
    writeJson<AuthStatus>(response, 200, {
      ok: true,
      data: authContext.status,
    });
    return true;
  }

  if (method === "GET" && url.pathname === "/api/version/current") {
    writeJson<CurrentReleaseMetadata>(response, 200, {
      ok: true,
      data: currentReleaseMetadata,
    });
    return true;
  }

  if (method === "POST" && url.pathname === "/api/auth/logout") {
    auth.handleLogout(request, response);
    return true;
  }

  if ((method === "GET" || method === "HEAD") && url.pathname === "/") {
    await serveFile(response, htmlPath, "text/html; charset=utf-8", method === "HEAD");
    return true;
  }

  if (
    (method === "GET" || method === "HEAD") &&
    (url.pathname === "/favicon.svg" || url.pathname === "/favicon.ico")
  ) {
    await serveFile(
      response,
      faviconPath,
      "image/svg+xml; charset=utf-8",
      method === "HEAD",
    );
    return true;
  }

  if ((method === "GET" || method === "HEAD") && url.pathname.startsWith("/assets/")) {
    const resolved = resolveAsset(staticRoot, url.pathname);
    if (!resolved) {
      return false;
    }

    await serveFile(response, resolved.path, resolved.contentType, method === "HEAD");
    return true;
  }

  return false;
}
