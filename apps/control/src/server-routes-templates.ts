import type { IncomingMessage, ServerResponse } from "node:http";

import type {
  CreateTemplateInput,
  UpdateTemplateInput,
} from "../../../packages/shared/src/types.js";
import type { DesktopManager } from "./manager.js";
import { readJsonBody, writeAccepted, writeJson } from "./server-http.js";

interface HandleTemplateRouteOptions {
  manager: DesktopManager;
  method: string;
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
}

export async function handleTemplateRoute({
  manager,
  method,
  request,
  response,
  url,
}: HandleTemplateRouteOptions): Promise<boolean> {
  if (method === "POST" && url.pathname === "/api/templates") {
    const payload = await readJsonBody<CreateTemplateInput>(request);
    writeJson(response, 201, {
      ok: true,
      data: manager.createTemplate(payload),
    });
    return true;
  }

  const templateActionMatch = url.pathname.match(/^\/api\/templates\/([^/]+)\/(update|delete)$/);
  if (method === "POST" && templateActionMatch) {
    const templateId = templateActionMatch[1];
    const action = templateActionMatch[2];

    switch (action) {
      case "update": {
        const payload = await readJsonBody<UpdateTemplateInput>(request);
        writeJson(response, 200, {
          ok: true,
          data: manager.updateTemplate(templateId, payload),
        });
        return true;
      }
      case "delete":
        manager.deleteTemplate(templateId);
        writeAccepted(response);
        return true;
      default:
        break;
    }
  }

  return false;
}
