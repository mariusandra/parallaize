import { normalizeVmNetworkMode } from "../../../packages/shared/src/helpers.js";
import type {
  ActionJob,
  VmDetail,
  VmInstance,
} from "../../../packages/shared/src/types.js";

type SelectedVmLike = VmDetail["vm"] | VmInstance | null | undefined;
export interface RetainedDesktopSession {
  session: VmInstance["session"];
  vmId: string;
}

export function hasBrowserDesktopSession(
  session: VmInstance["session"] | null | undefined,
): boolean {
  if (!session) {
    return false;
  }

  if (session.kind === "vnc") {
    return Boolean(session.webSocketPath);
  }

  if (session.kind === "selkies") {
    return Boolean(session.browserPath);
  }

  return false;
}

export function hasBrowserVncSession(
  session: VmInstance["session"] | null | undefined,
): boolean {
  return session?.kind === "vnc" && hasBrowserDesktopSession(session);
}

export function hasBrowserSelkiesSession(
  session: VmInstance["session"] | null | undefined,
): boolean {
  return session?.kind === "selkies" && hasBrowserDesktopSession(session);
}

export function buildSelkiesPreviewBrowserPath(
  session: VmInstance["session"] | null | undefined,
): string | null {
  if (!session || !hasBrowserSelkiesSession(session) || !session.browserPath) {
    return null;
  }

  return appendQueryParam(session.browserPath, "parallaize_preview", "1");
}

export function shouldShowLiveVmPreview(
  vm: Pick<VmInstance, "status" | "session">,
  showLivePreview: boolean,
  selected = false,
): boolean {
  void selected;

  if (!showLivePreview || vm.status !== "running") {
    return false;
  }

  if (hasBrowserVncSession(vm.session)) {
    return true;
  }

  return hasBrowserSelkiesSession(vm.session);
}

export function mergeSelectedVmDetail(
  selectedVm: SelectedVmLike,
  detail: VmDetail | null | undefined,
): VmDetail | null {
  if (!selectedVm || detail?.vm.id !== selectedVm.id) {
    return null;
  }

  return {
    ...detail,
    vm: {
      ...detail.vm,
      ...selectedVm,
      session: resolvePreferredVmSession(selectedVm.session, detail.vm.session),
    },
  };
}

export function shouldRefreshSelectedVmDetail(
  selectedVm: SelectedVmLike,
  detail: VmDetail | null | undefined,
  summaryJobs: readonly ActionJob[] | null | undefined,
): boolean {
  if (!selectedVm) {
    return false;
  }

  if (!detail || detail.vm.id !== selectedVm.id) {
    return true;
  }

  if (
    selectedVm.updatedAt !== detail.vm.updatedAt ||
    selectedVm.status !== detail.vm.status ||
    selectedVm.frameRevision !== detail.vm.frameRevision ||
    selectedVm.lastAction !== detail.vm.lastAction ||
    selectedVm.templateId !== detail.vm.templateId ||
    normalizeVmNetworkMode(selectedVm.networkMode) !==
      normalizeVmNetworkMode(detail.vm.networkMode) ||
    !sameStringArray(selectedVm.snapshotIds, detail.vm.snapshotIds)
  ) {
    return true;
  }

  if (
    hasBrowserDesktopSession(selectedVm.session) &&
    !sameVmSession(selectedVm.session, detail.vm.session)
  ) {
    return true;
  }

  const detailGeneratedAtMs = Date.parse(detail.generatedAt);

  if (!Number.isFinite(detailGeneratedAtMs)) {
    return true;
  }

  return (summaryJobs ?? []).some((job) => {
    if (job.targetVmId !== selectedVm.id) {
      return false;
    }

    const updatedAtMs = Date.parse(job.updatedAt);
    return Number.isFinite(updatedAtMs) && updatedAtMs > detailGeneratedAtMs;
  });
}

export function resolveSelectedDesktopSession(
  selectedVm: SelectedVmLike,
  detail: VmDetail | null | undefined,
): VmInstance["session"] | null {
  if (!selectedVm) {
    return null;
  }

  if (detail?.vm.id === selectedVm.id) {
    return detail.vm.session ?? selectedVm.session ?? null;
  }

  return selectedVm.session ?? null;
}

export function resolveDisplayedDesktopSession(
  currentStageVm: SelectedVmLike,
  currentStageSession: VmInstance["session"] | null,
  retainedSession: RetainedDesktopSession | null | undefined,
): VmInstance["session"] | null {
  if (hasBrowserDesktopSession(currentStageSession)) {
    return currentStageSession;
  }

  if (
    !currentStageVm ||
    currentStageVm.status !== "running" ||
    retainedSession?.vmId !== currentStageVm.id ||
    !hasBrowserDesktopSession(retainedSession.session)
  ) {
    return currentStageSession ?? null;
  }

  return retainedSession.session;
}

function resolvePreferredVmSession(
  summarySession: VmInstance["session"] | null | undefined,
  detailSession: VmInstance["session"] | null | undefined,
): VmInstance["session"] | null {
  if (sessionRank(detailSession) > sessionRank(summarySession)) {
    return detailSession ?? null;
  }

  return summarySession ?? detailSession ?? null;
}

function sessionRank(session: VmInstance["session"] | null | undefined): number {
  if (!session) {
    return 0;
  }

  if (hasBrowserDesktopSession(session)) {
    return 3;
  }

  if (session.kind === "vnc" || session.kind === "selkies") {
    return 2;
  }

  return 1;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameVmSession(
  left: VmInstance["session"] | null | undefined,
  right: VmInstance["session"] | null | undefined,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.kind === right.kind &&
    left.host === right.host &&
    left.port === right.port &&
    left.reachable === right.reachable &&
    left.webSocketPath === right.webSocketPath &&
    left.browserPath === right.browserPath &&
    left.display === right.display
  );
}

function appendQueryParam(path: string, key: string, value: string): string {
  const hashIndex = path.indexOf("#");
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";
  const basePath = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const separator = basePath.includes("?") ? "&" : "?";
  return `${basePath}${separator}${key}=${encodeURIComponent(value)}${hash}`;
}
