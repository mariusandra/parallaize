import type { IncomingMessage, ServerResponse } from "node:http";

import type {
  CaptureTemplateInput,
  CloneVmInput,
  CreateVmInput,
  DashboardSummary,
  InjectCommandInput,
  ReorderVmsInput,
  ResizeVmInput,
  SetVmResolutionInput,
  SnapshotInput,
  SnapshotLaunchInput,
  SyncVmResolutionControlInput,
  UpdateVmForwardedPortsInput,
  UpdateVmInput,
  UpdateVmNetworkInput,
  VmDetail,
  VmDesktopBridgeVersion,
  VmDiskUsageSnapshot,
  VmFileBrowserSnapshot,
  VmLogsSnapshot,
  VmResolutionControlSnapshot,
  VmTouchedFilesSnapshot,
} from "../../../packages/shared/src/types.js";
import type { DesktopManager } from "./manager.js";
import {
  buildMockSelkiesBrowserPath,
  buildMockSelkiesDocument,
} from "./mock-selkies.js";
import {
  readJsonBody,
  serveVmFileDownload,
  writeAccepted,
  writeJson,
} from "./server-http.js";
import { createServerEventStreams } from "./server-events.js";

interface HandleVmRouteOptions {
  events: ReturnType<typeof createServerEventStreams>;
  manager: DesktopManager;
  method: string;
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
}

export async function handleVmRoute({
  events,
  manager,
  method,
  request,
  response,
  url,
}: HandleVmRouteOptions): Promise<boolean> {
  const mockSelkiesMatch = url.pathname.match(/^\/mock-selkies\/([^/]+)\/?$/);
  if (method === "GET" && mockSelkiesMatch) {
    const vm = manager.getVmDetail(mockSelkiesMatch[1]).vm;
    const session = vm.session;

    if (
      session?.kind !== "selkies" ||
      session.browserPath !== buildMockSelkiesBrowserPath(vm.id)
    ) {
      writeJson(response, 404, {
        ok: false,
        error: `Mock Selkies session not found for ${vm.id}.`,
      });
      return true;
    }

    const preview = url.searchParams.get("parallaize_preview") === "1";
    const frameHref = `/api/vms/${encodeURIComponent(vm.id)}/frame.svg?mode=${preview ? "tile" : "detail"}`;

    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(
      buildMockSelkiesDocument({
        frameHref,
        preview,
        vmId: vm.id,
        vmName: vm.name,
      }),
    );
    return true;
  }

  const vmMatch = url.pathname.match(/^\/api\/vms\/([^/]+)$/);
  if (method === "GET" && vmMatch) {
    writeJson<VmDetail>(response, 200, {
      ok: true,
      data: manager.getVmDetail(vmMatch[1]),
    });
    return true;
  }

  const vmLogsLiveMatch = url.pathname.match(/^\/api\/vms\/([^/]+)\/logs\/live$/);
  if (method === "GET" && vmLogsLiveMatch) {
    await events.handleVmLogEvents(response, vmLogsLiveMatch[1]);
    return true;
  }

  const vmLogsMatch = url.pathname.match(/^\/api\/vms\/([^/]+)\/logs$/);
  if (method === "GET" && vmLogsMatch) {
    writeJson<VmLogsSnapshot>(response, 200, {
      ok: true,
      data: await manager.getVmLogs(vmLogsMatch[1]),
    });
    return true;
  }

  const vmDiskUsageMatch = url.pathname.match(/^\/api\/vms\/([^/]+)\/disk-usage$/);
  if (method === "GET" && vmDiskUsageMatch) {
    writeJson<VmDiskUsageSnapshot>(response, 200, {
      ok: true,
      data: await manager.getVmDiskUsage(vmDiskUsageMatch[1]),
    });
    return true;
  }

  const vmTouchedFilesMatch = url.pathname.match(/^\/api\/vms\/([^/]+)\/files\/touched$/);
  if (method === "GET" && vmTouchedFilesMatch) {
    writeJson<VmTouchedFilesSnapshot>(response, 200, {
      ok: true,
      data: await manager.getVmTouchedFiles(vmTouchedFilesMatch[1]),
    });
    return true;
  }

  const vmFileDownloadMatch = url.pathname.match(/^\/api\/vms\/([^/]+)\/files\/download$/);
  if ((method === "GET" || method === "HEAD") && vmFileDownloadMatch) {
    serveVmFileDownload(
      response,
      await manager.readVmFile(vmFileDownloadMatch[1], url.searchParams.get("path") ?? ""),
      method === "HEAD",
    );
    return true;
  }

  const vmFilesMatch = url.pathname.match(/^\/api\/vms\/([^/]+)\/files$/);
  if (method === "GET" && vmFilesMatch) {
    writeJson<VmFileBrowserSnapshot>(response, 200, {
      ok: true,
      data: await manager.browseVmFiles(vmFilesMatch[1], url.searchParams.get("path")),
    });
    return true;
  }

  const vmPreviewMatch = url.pathname.match(/^\/api\/vms\/([^/]+)\/preview$/);
  if ((method === "GET" || method === "HEAD") && vmPreviewMatch) {
    const preview = await manager.getVmPreviewImage(vmPreviewMatch[1]);
    response.writeHead(200, {
      "content-type": preview.contentType,
      "content-length": String(preview.content.byteLength),
      "cache-control": "no-store",
    });

    if (method === "HEAD") {
      response.end();
    } else {
      response.end(preview.content);
    }

    return true;
  }

  const vmDesktopBridgeMatch = url.pathname.match(/^\/api\/vms\/([^/]+)\/desktop-bridge$/);
  if (method === "GET" && vmDesktopBridgeMatch) {
    writeJson<VmDesktopBridgeVersion | null>(response, 200, {
      ok: true,
      data: await manager.getVmDesktopBridgeVersion(vmDesktopBridgeMatch[1]),
    });
    return true;
  }

  const vmDesktopBridgeRepairMatch = url.pathname.match(
    /^\/api\/vms\/([^/]+)\/desktop-bridge\/repair$/,
  );
  if (method === "POST" && vmDesktopBridgeRepairMatch) {
    writeJson<VmDetail>(response, 200, {
      ok: true,
      data: await manager.repairVmDesktopBridge(vmDesktopBridgeRepairMatch[1]),
    });
    return true;
  }

  if (method === "POST" && url.pathname === "/api/vms/reorder") {
    const payload = await readJsonBody<ReorderVmsInput>(request);
    writeJson<DashboardSummary>(response, 200, {
      ok: true,
      data: manager.reorderVms(payload),
    });
    return true;
  }

  const vmUpdateMatch = url.pathname.match(/^\/api\/vms\/([^/]+)\/update$/);
  if (method === "POST" && vmUpdateMatch) {
    const payload = await readJsonBody<UpdateVmInput>(request);
    writeJson(response, 200, {
      ok: true,
      data: await manager.updateVm(vmUpdateMatch[1], payload),
    });
    return true;
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
    return true;
  }

  const snapshotActionMatch = url.pathname.match(
    /^\/api\/vms\/([^/]+)\/snapshots\/([^/]+)\/(launch|restore|delete)$/,
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
      writeJson(response, 202, {
        ok: true,
        data: vm,
      });
      return true;
    }

    if (action === "delete") {
      manager.deleteVmSnapshot(vmId, snapshotId);
      writeAccepted(response);
      return true;
    }

    manager.restoreVmSnapshot(vmId, snapshotId);
    writeAccepted(response);
    return true;
  }

  if (method === "POST" && url.pathname === "/api/vms") {
    const payload = await readJsonBody<CreateVmInput>(request);
    writeJson(response, 202, {
      ok: true,
      data: manager.createVm(payload),
    });
    return true;
  }

  const forwardsMatch = url.pathname.match(/^\/api\/vms\/([^/]+)\/forwards$/);
  if (method === "POST" && forwardsMatch) {
    const payload = await readJsonBody<UpdateVmForwardedPortsInput>(request);
    manager.updateVmForwardedPorts(forwardsMatch[1], payload);
    writeAccepted(response);
    return true;
  }

  const networkModeMatch = url.pathname.match(/^\/api\/vms\/([^/]+)\/network$/);
  if (method === "POST" && networkModeMatch) {
    const payload = await readJsonBody<UpdateVmNetworkInput>(request);
    await manager.setVmNetworkMode(networkModeMatch[1], payload);
    writeAccepted(response);
    return true;
  }

  const resolutionMatch = url.pathname.match(/^\/api\/vms\/([^/]+)\/resolution$/);
  if (method === "POST" && resolutionMatch) {
    const payload = await readJsonBody<SetVmResolutionInput>(request);
    await manager.setVmResolution(resolutionMatch[1], payload);
    writeAccepted(response);
    return true;
  }

  const resolutionControlMatch = url.pathname.match(
    /^\/api\/vms\/([^/]+)\/resolution-control\/claim$/,
  );
  if (method === "POST" && resolutionControlMatch) {
    const vmId = resolutionControlMatch[1];
    manager.getVmDetail(vmId);
    const payload = await readJsonBody<SyncVmResolutionControlInput>(request);
    writeJson<VmResolutionControlSnapshot>(response, 200, {
      ok: true,
      data: events.syncVmResolutionControl(vmId, payload),
    });
    return true;
  }

  const actionMatch = url.pathname.match(
    /^\/api\/vms\/([^/]+)\/(clone|start|stop|restart|delete|snapshot|resize|template|input)$/,
  );
  if (method === "POST" && actionMatch) {
    const vmId = actionMatch[1];
    const action = actionMatch[2];

    switch (action) {
      case "clone": {
        const payload = await readJsonBody<CloneVmInput>(request);
        writeJson(response, 202, {
          ok: true,
          data: manager.cloneVm({
            sourceVmId: vmId,
            name: payload.name,
            resources: payload.resources,
            networkMode: payload.networkMode,
            shutdownSourceBeforeClone: payload.shutdownSourceBeforeClone,
          }),
        });
        return true;
      }
      case "start":
        manager.startVm(vmId);
        writeAccepted(response);
        return true;
      case "stop":
        manager.stopVm(vmId);
        writeAccepted(response);
        return true;
      case "restart":
        manager.restartVm(vmId);
        writeAccepted(response);
        return true;
      case "delete":
        manager.deleteVm(vmId);
        writeAccepted(response);
        return true;
      case "snapshot": {
        const payload = await readJsonBody<SnapshotInput>(request);
        manager.snapshotVm(vmId, payload);
        writeAccepted(response);
        return true;
      }
      case "resize": {
        const payload = await readJsonBody<ResizeVmInput>(request);
        manager.resizeVm(vmId, payload);
        writeAccepted(response);
        return true;
      }
      case "template": {
        const payload = await readJsonBody<CaptureTemplateInput>(request);
        manager.captureTemplate(vmId, payload);
        writeAccepted(response);
        return true;
      }
      case "input": {
        const payload = await readJsonBody<InjectCommandInput>(request);
        manager.injectCommand(vmId, payload.command);
        writeAccepted(response);
        return true;
      }
      default:
        break;
    }
  }

  return false;
}
