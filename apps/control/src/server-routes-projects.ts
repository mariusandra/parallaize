import type { IncomingMessage, ServerResponse } from "node:http";

import type {
  CreateProjectInput,
  UpdateProjectInput,
  WorkspaceProject,
} from "../../../packages/shared/src/types.js";
import type { DesktopManager } from "./manager.js";
import {
  readJsonBody,
  writeAccepted,
  writeJson,
} from "./server-http.js";

interface HandleProjectRouteOptions {
  manager: DesktopManager;
  method: string;
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
}

export async function handleProjectRoute({
  manager,
  method,
  request,
  response,
  url,
}: HandleProjectRouteOptions): Promise<boolean> {
  if (method === "POST" && url.pathname === "/api/projects") {
    const payload = await readJsonBody<CreateProjectInput>(request);
    writeJson<WorkspaceProject>(response, 201, {
      ok: true,
      data: manager.createProject(payload),
    });
    return true;
  }

  const updateMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/update$/);
  if (method === "POST" && updateMatch) {
    const payload = await readJsonBody<UpdateProjectInput>(request);
    writeJson<WorkspaceProject>(response, 200, {
      ok: true,
      data: manager.updateProject(updateMatch[1], payload),
    });
    return true;
  }

  const actionMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/(start|stop|restart|delete)$/);
  if (method === "POST" && actionMatch) {
    const projectId = actionMatch[1];
    const action = actionMatch[2];

    switch (action) {
      case "start":
        manager.startProject(projectId);
        writeAccepted(response);
        return true;
      case "stop":
        manager.stopProject(projectId);
        writeAccepted(response);
        return true;
      case "restart":
        manager.restartProject(projectId);
        writeAccepted(response);
        return true;
      case "delete":
        manager.deleteProject(projectId);
        writeAccepted(response);
        return true;
      default:
        break;
    }
  }

  return false;
}
