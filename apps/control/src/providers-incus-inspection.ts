import { buildGuestDisplayDiscoveryScript } from "./ubuntu-guest-init.js";
import { formatByteCount } from "./providers-incus-progress.js";
import type {
  VmDiskUsageSnapshot,
  VmFileBrowserSnapshot,
  VmFileEntry,
  VmFileEntryKind,
  VmTouchedFile,
  VmTouchedFileReason,
  VmTouchedFilesSnapshot,
  VmInstance,
} from "../../../packages/shared/src/types.js";
import {
  BYTES_PER_GIB,
  DEFAULT_GUEST_HOME,
  DEFAULT_GUEST_WORKSPACE,
  VM_DISK_CRITICAL_FREE_BYTES,
  VM_DISK_WARNING_FREE_BYTES,
  type VmFileContent,
} from "./providers-contracts.js";

export function buildMockVmFileBrowserSnapshot(
  vm: VmInstance,
  path?: string | null,
): VmFileBrowserSnapshot {
  const currentPath = normalizeGuestPath(path ?? resolveMockVmBrowsePath(vm));
  const generatedAt = new Date().toISOString();
  const entries = buildMockVmFileEntries(vm, currentPath, generatedAt);

  return {
    vmId: vm.id,
    workspacePath: vm.workspacePath,
    homePath: resolveMockVmHomePath(),
    currentPath,
    parentPath: resolveGuestParentPath(currentPath),
    entries,
    generatedAt,
  };
}

export function buildMockVmFileContent(vm: VmInstance, path: string): VmFileContent {
  const normalizedPath = normalizeGuestPath(path);

  if (isMockDirectoryPath(vm, normalizedPath)) {
    throw new Error(`${normalizedPath} is a directory.`);
  }

  const contentByPath = new Map<string, string>([
    ["/home/ubuntu/.bashrc", "export EDITOR=vim\nalias ll='ls -alF'\n"],
    ["/home/ubuntu/notes.txt", "Remember to collect logs before deleting this workspace.\n"],
    ["/home/ubuntu/Desktop/Parralaize.url", "[InternetShortcut]\nURL=https://parallaize.local/\n"],
    ["/home/ubuntu/Downloads/session.log", "mock session log\n"],
    ["/etc/hosts", "127.0.0.1 localhost\n127.0.1.1 ubuntu\n"],
  ]);

  const workspacePath = normalizeGuestPath(vm.workspacePath || DEFAULT_GUEST_WORKSPACE);
  contentByPath.set(`${workspacePath}/README.md`, "# Mock workspace\n");
  contentByPath.set(`${workspacePath}/src/main.ts`, "console.log('mock workspace');\n");
  contentByPath.set(
    `${workspacePath}/src/DashboardApp.tsx`,
    "export function DashboardApp() {\n  return null;\n}\n",
  );
  contentByPath.set(`${workspacePath}/src/styles.css`, ".workspace {}\n");
  contentByPath.set(
    `${workspacePath}/.config/settings.json`,
    JSON.stringify({ theme: "light", autosave: true }, null, 2),
  );
  contentByPath.set(`${workspacePath}/logs/session.log`, "mock workspace log\n");

  return {
    content: Buffer.from(contentByPath.get(normalizedPath) ?? "mock file\n", "utf8"),
    name: normalizedPath.split("/").pop() ?? "download",
    path: normalizedPath,
  };
}

export function buildMockVmTouchedFilesSnapshot(vm: VmInstance): VmTouchedFilesSnapshot {
  const generatedAt = new Date().toISOString();
  const baselineStartedAt = vm.liveSince ?? vm.createdAt ?? null;
  const workspacePath = vm.workspacePath;
  const commandPaths = Array.from(
    new Set((vm.commandHistory ?? []).map((entry) => normalizeGuestPath(entry.workspacePath))),
  ).filter((path) => !isIgnoredTouchedFilesPath(workspacePath, path));
  const entries: VmTouchedFile[] =
    commandPaths.length > 0
      ? commandPaths.map((path) => ({
          name: path === workspacePath ? "." : path.split("/").pop() ?? path,
          path,
          kind: "directory",
          sizeBytes: null,
          modifiedAt: generatedAt,
          changedAt: generatedAt,
          reasons: ["command-history"],
        }))
      : [
          {
            name: "README.md",
            path: `${workspacePath}/README.md`,
            kind: "file",
            sizeBytes: 1902,
            modifiedAt: generatedAt,
            changedAt: generatedAt,
            reasons: ["mtime"],
          },
        ];

  return {
    vmId: vm.id,
    workspacePath,
    scanPath: workspacePath,
    baselineStartedAt,
    baselineLabel:
      vm.liveSince !== null
        ? "Best effort since the VM last started."
        : "Best effort since the workspace was first created.",
    limitationSummary:
      "Mock mode uses command history and synthetic timestamps only. It is a UI stand-in for the real guest scan.",
    entries,
    generatedAt,
  };
}

export function buildMockVmDiskUsageSnapshot(vm: VmInstance): VmDiskUsageSnapshot {
  const workspacePath = normalizeGuestPath(vm.workspacePath || DEFAULT_GUEST_WORKSPACE);
  const sizeBytes = Math.max(vm.resources.diskGb, 1) * BYTES_PER_GIB;
  const usedPercent = Math.min(96, 68 + (vm.screenSeed % 25));
  const usedBytes = Math.round((sizeBytes * usedPercent) / 100);
  const availableBytes = Math.max(0, sizeBytes - usedBytes);
  const sharedMount = {
    mountPath: "/",
    filesystem: "mockfs",
    sizeBytes,
    usedBytes,
    availableBytes,
    usedPercent,
  };

  return buildVmDiskUsageSnapshot(
    vm,
    {
      path: "/",
      ...sharedMount,
    },
    {
      path: workspacePath,
      ...sharedMount,
    },
  );
}

export function buildReadVmDiskUsageScript(workspacePath: string): string {
  return `python3 - <<'PY'
import json
import os
import subprocess

workspace_path = ${JSON.stringify(workspacePath)}

def resolve_existing_path(candidate: str) -> str:
  current = os.path.abspath(candidate or "/")
  while not os.path.exists(current):
    parent = os.path.dirname(current)
    if parent == current:
      return "/"
    current = parent
  return current

def read_usage(target_path: str):
  existing_path = resolve_existing_path(target_path)
  output = subprocess.check_output(["df", "-B1", "-P", existing_path], text=True)
  lines = [line for line in output.splitlines() if line.strip()]
  if len(lines) < 2:
    raise RuntimeError(f"Unexpected df output for {existing_path}: {output!r}")
  parts = lines[-1].split()
  if len(parts) < 6:
    raise RuntimeError(f"Unexpected df row for {existing_path}: {lines[-1]!r}")
  filesystem = parts[0]
  size_bytes = int(parts[1])
  used_bytes = int(parts[2])
  available_bytes = int(parts[3])
  used_percent = int(parts[4].rstrip("%")) if parts[4].endswith("%") else None
  mount_path = " ".join(parts[5:])
  return {
    "path": os.path.abspath(target_path),
    "mountPath": mount_path,
    "filesystem": filesystem,
    "sizeBytes": size_bytes,
    "usedBytes": used_bytes,
    "availableBytes": available_bytes,
    "usedPercent": used_percent,
  }

print(json.dumps({
  "root": read_usage("/"),
  "workspace": read_usage(workspace_path),
}))
PY`;
}

export function buildBrowseVmFilesScript(
  workspacePath: string,
  requestedPath: string | null,
): string {
  const requestedPathLiteral = requestedPath === null
    ? "None"
    : JSON.stringify(requestedPath);

  return `python3 - <<'PY'
import datetime
import json
import os
import stat

workspace_path = ${JSON.stringify(workspacePath)}
requested_path = ${requestedPathLiteral}
home_path = "/home/ubuntu" if os.path.isdir("/home/ubuntu") else None

def isoformat(timestamp: float) -> str:
  return datetime.datetime.fromtimestamp(
    timestamp,
    datetime.timezone.utc,
  ).isoformat().replace("+00:00", "Z")

def entry_kind(mode: int) -> str:
  if stat.S_ISDIR(mode):
    return "directory"
  if stat.S_ISREG(mode):
    return "file"
  if stat.S_ISLNK(mode):
    return "symlink"
  return "other"

if requested_path is not None:
  browse_path = requested_path
else:
  browse_path = next(
    (
      candidate
      for candidate in (home_path, workspace_path, "/")
      if candidate is not None and os.path.isdir(candidate)
    ),
    "/",
  )

if not os.path.isdir(browse_path):
  raise NotADirectoryError(f"{browse_path} is not a directory")

os.chdir(browse_path)
current_path = os.getcwd()
entries = []

for entry in sorted(
  os.scandir(current_path),
  key=lambda item: (not item.is_dir(follow_symlinks=False), item.name.lower(), item.name),
):
  stats = entry.stat(follow_symlinks=False)
  kind = entry_kind(stats.st_mode)
  entries.append({
    "name": entry.name,
    "path": entry.path,
    "kind": kind,
    "sizeBytes": None if kind == "directory" else int(stats.st_size),
    "modifiedAt": isoformat(stats.st_mtime),
    "changedAt": isoformat(stats.st_ctime),
  })

print(json.dumps({
  "homePath": home_path,
  "currentPath": current_path,
  "entries": entries,
}))
PY`;
}

export function buildReadVmFileScript(path: string): string {
  return `python3 - <<'PY'
import base64
import json
import os

file_path = ${JSON.stringify(path)}

if not os.path.exists(file_path):
  raise FileNotFoundError(file_path)

if os.path.isdir(file_path):
  raise IsADirectoryError(file_path)

with open(file_path, "rb") as handle:
  content = handle.read()

print(json.dumps({
  "contentBase64": base64.b64encode(content).decode("ascii"),
  "name": os.path.basename(file_path) or "download",
  "path": os.path.abspath(file_path),
}))
PY`;
}

export function buildReadVmPreviewImageScript(): string {
  return `set -eu
${buildGuestDisplayDiscoveryScript()}
DISPLAY_NUMBER="$(find_guest_display_number)"
AUTH_FILE="$(find_guest_auth_file || true)"
if [ -z "$AUTH_FILE" ] || [ ! -f "$AUTH_FILE" ]; then
  echo "Unable to locate an Xauthority file for the desktop session." >&2
  exit 1
fi
if ! command -v import >/dev/null 2>&1; then
  echo "Preview capture requires ImageMagick import." >&2
  exit 1
fi
CAPTURE_FILE="$(mktemp /tmp/parallaize-preview-XXXXXX.png)"
OUTPUT_FILE="$(mktemp /tmp/parallaize-preview-output-XXXXXX.png)"
cleanup() {
  rm -f "$CAPTURE_FILE" "$OUTPUT_FILE"
}
trap cleanup EXIT
DISPLAY="$DISPLAY_NUMBER" XAUTHORITY="$AUTH_FILE" HOME="\${HOME:-/root}" import -quiet -display "$DISPLAY_NUMBER" -window root "$CAPTURE_FILE"
if command -v convert >/dev/null 2>&1; then
  convert "$CAPTURE_FILE" -strip -resize '960x540>' "$OUTPUT_FILE"
else
  cp "$CAPTURE_FILE" "$OUTPUT_FILE"
fi
python3 - "$OUTPUT_FILE" <<'PY'
from pathlib import Path
import base64
import json
import sys

path = Path(sys.argv[1])
print(json.dumps({
  "contentBase64": base64.b64encode(path.read_bytes()).decode("ascii"),
  "contentType": "image/png",
}))
PY`;
}

export function buildReadVmTouchedFilesScript(
  workspacePath: string,
  baselineStartedAt: string | null,
): string {
  const parsedBaselineMs = baselineStartedAt ? Date.parse(baselineStartedAt) : Number.NaN;
  const baselineSeconds = Number.isFinite(parsedBaselineMs)
    ? Math.max(0, parsedBaselineMs / 1000)
    : 0;

  return `python3 - <<'PY'
import datetime
import json
import os
import stat

workspace_path = ${JSON.stringify(workspacePath)}
scan_path = ${JSON.stringify(DEFAULT_GUEST_HOME)} if os.path.isdir(${JSON.stringify(DEFAULT_GUEST_HOME)}) else workspace_path
ignored_paths = {
  os.path.normpath(${JSON.stringify(`${DEFAULT_GUEST_HOME}/.cache`)})
} if scan_path == ${JSON.stringify(DEFAULT_GUEST_HOME)} else set()
baseline = ${baselineSeconds}
max_scanned = 5000
max_returned = 200
scanned = 0
truncated = False
entries = []

def isoformat(timestamp: float) -> str:
  return datetime.datetime.fromtimestamp(
    timestamp,
    datetime.timezone.utc,
  ).isoformat().replace("+00:00", "Z")

def entry_kind(mode: int) -> str:
  if stat.S_ISDIR(mode):
    return "directory"
  if stat.S_ISREG(mode):
    return "file"
  if stat.S_ISLNK(mode):
    return "symlink"
  return "other"

for root, dirnames, filenames in os.walk(scan_path):
  dirnames.sort()
  filenames.sort()
  dirnames[:] = [
    name
    for name in dirnames
    if os.path.normpath(os.path.join(root, name)) not in ignored_paths
  ]
  for name in [*dirnames, *filenames]:
    path = os.path.join(root, name)
    try:
      stats = os.lstat(path)
    except OSError:
      continue
    scanned += 1
    reasons = []
    if stats.st_mtime >= baseline:
      reasons.append("mtime")
    if stats.st_ctime >= baseline:
      reasons.append("ctime")
    if reasons:
      entries.append({
        "name": name,
        "path": path,
        "kind": entry_kind(stats.st_mode),
        "sizeBytes": None if stat.S_ISDIR(stats.st_mode) else int(stats.st_size),
        "modifiedAt": isoformat(stats.st_mtime),
        "changedAt": isoformat(stats.st_ctime),
        "reasons": reasons,
        "_sort": max(stats.st_mtime, stats.st_ctime),
      })
    if scanned >= max_scanned:
      truncated = True
      break
  if truncated:
    break

entries.sort(key=lambda item: item["_sort"], reverse=True)
for entry in entries:
  del entry["_sort"]

print(json.dumps({
  "entries": entries[:max_returned],
  "scanPath": scan_path,
  "truncated": truncated,
}))
PY`;
}

export function mergeTouchedFilesWithCommandHistory(
  entries: VmTouchedFile[],
  commandHistory: VmInstance["commandHistory"],
  workspacePath: string,
): VmTouchedFile[] {
  const merged = new Map<string, VmTouchedFile>();

  for (const entry of entries) {
    merged.set(entry.path, {
      ...entry,
      reasons: sortTouchedFileReasons(entry.reasons),
    });
  }

  for (const commandEntry of commandHistory ?? []) {
    const candidatePath = normalizeGuestPath(commandEntry.workspacePath);

    if (!isWithinGuestWorkspacePath(workspacePath, candidatePath)) {
      continue;
    }

    if (isIgnoredTouchedFilesPath(workspacePath, candidatePath)) {
      continue;
    }

    const existing = merged.get(candidatePath);

    if (existing) {
      if (!existing.reasons.includes("command-history")) {
        existing.reasons = sortTouchedFileReasons([
          ...existing.reasons,
          "command-history",
        ]);
      }
      continue;
    }

    merged.set(candidatePath, {
      name: candidatePath === workspacePath ? "." : candidatePath.split("/").pop() ?? candidatePath,
      path: candidatePath,
      kind: "directory",
      sizeBytes: null,
      modifiedAt: null,
      changedAt: null,
      reasons: ["command-history"],
    });
  }

  return [...merged.values()]
    .sort((left, right) => touchedFileSortValue(right) - touchedFileSortValue(left))
    .slice(0, 200);
}

export function buildVmDiskUsageSnapshot(
  vm: VmInstance,
  root: VmDiskUsageSnapshot["root"],
  workspace: VmDiskUsageSnapshot["workspace"],
): VmDiskUsageSnapshot {
  const focus = pickVmDiskUsageFocus(root, workspace);
  const status = resolveVmDiskUsageStatus(root, workspace);

  return {
    vmId: vm.id,
    workspacePath: vm.workspacePath || DEFAULT_GUEST_WORKSPACE,
    checkedAt: new Date().toISOString(),
    status,
    detail: describeVmDiskUsageStatus(status, focus),
    warningThresholdBytes: VM_DISK_WARNING_FREE_BYTES,
    criticalThresholdBytes: VM_DISK_CRITICAL_FREE_BYTES,
    root,
    workspace,
  };
}

export function resolveGuestParentPath(currentPath: string): string | null {
  const normalizedCurrentPath = normalizeGuestPath(currentPath);

  if (normalizedCurrentPath === "/") {
    return null;
  }

  return normalizeGuestPath(
    normalizedCurrentPath.slice(0, normalizedCurrentPath.lastIndexOf("/")) || "/",
  );
}

export function normalizeGuestPath(path: string): string {
  const normalized = path.replace(/\/+/g, "/");

  if (!normalized.startsWith("/")) {
    return `/${normalized}`;
  }

  return normalized.length > 1 && normalized.endsWith("/")
    ? normalized.slice(0, -1)
    : normalized;
}

export function isWithinGuestWorkspacePath(
  workspacePath: string,
  candidatePath: string,
): boolean {
  const normalizedWorkspacePath = normalizeGuestPath(workspacePath);
  const normalizedCandidatePath = normalizeGuestPath(candidatePath);

  if (normalizedWorkspacePath === "/") {
    return normalizedCandidatePath.startsWith("/");
  }

  return (
    normalizedCandidatePath === normalizedWorkspacePath ||
    normalizedCandidatePath.startsWith(`${normalizedWorkspacePath}/`)
  );
}

function buildMockVmFileEntries(
  vm: VmInstance,
  currentPath: string,
  generatedAt: string,
): VmFileEntry[] {
  const workspacePath = normalizeGuestPath(vm.workspacePath || DEFAULT_GUEST_WORKSPACE);
  const workspaceLeaf = workspacePath.split("/").pop() ?? "workspace";
  const buildEntry = (
    name: string,
    kind: VmFileEntryKind,
    sizeBytes: number | null,
  ): VmFileEntry => ({
    name,
    path: currentPath === "/" ? `/${name}` : `${currentPath}/${name}`,
    kind,
    sizeBytes,
    modifiedAt: generatedAt,
    changedAt: generatedAt,
  });

  if (currentPath === "/") {
    return [
      buildEntry("etc", "directory", null),
      buildEntry("home", "directory", null),
      buildEntry("srv", "directory", null),
      buildEntry("var", "directory", null),
    ];
  }

  if (currentPath === "/etc") {
    return [
      buildEntry("hosts", "file", 188),
      buildEntry("ssh", "directory", null),
    ];
  }

  if (currentPath === "/home") {
    return [buildEntry("ubuntu", "directory", null)];
  }

  if (currentPath === "/home/ubuntu") {
    return [
      buildEntry(".bashrc", "file", 3771),
      buildEntry("Desktop", "directory", null),
      buildEntry("Downloads", "directory", null),
      buildEntry("notes.txt", "file", 184),
    ];
  }

  if (currentPath === "/home/ubuntu/Desktop") {
    return [buildEntry("Parralaize.url", "file", 92)];
  }

  if (currentPath === "/home/ubuntu/Downloads") {
    return [buildEntry("session.log", "file", 4096)];
  }

  if (currentPath === "/srv") {
    return [buildEntry("workspaces", "directory", null)];
  }

  if (currentPath === "/srv/workspaces") {
    return [buildEntry(workspaceLeaf, "directory", null)];
  }

  if (currentPath.endsWith("/src")) {
    return [
      buildEntry("main.ts", "file", 1324),
      buildEntry("DashboardApp.tsx", "file", 8421),
      buildEntry("styles.css", "file", 2440),
    ];
  }

  if (currentPath.endsWith("/.config")) {
    return [buildEntry("settings.json", "file", 612)];
  }

  if (currentPath.endsWith("/logs")) {
    return [buildEntry("session.log", "file", 4096)];
  }

  if (currentPath === workspacePath) {
    return [
      buildEntry("src", "directory", null),
      buildEntry(".config", "directory", null),
      buildEntry("logs", "directory", null),
      buildEntry("README.md", "file", 1902),
    ];
  }

  return [
    buildEntry("src", "directory", null),
    buildEntry(".config", "directory", null),
    buildEntry("logs", "directory", null),
    buildEntry("README.md", "file", 1902),
  ];
}

function isIgnoredTouchedFilesPath(scanPath: string, candidatePath: string): boolean {
  const normalizedScanPath = normalizeGuestPath(scanPath);
  const normalizedCandidatePath = normalizeGuestPath(candidatePath);

  if (normalizedScanPath !== DEFAULT_GUEST_HOME) {
    return false;
  }

  const ignoredPath = `${DEFAULT_GUEST_HOME}/.cache`;
  return (
    normalizedCandidatePath === ignoredPath ||
    normalizedCandidatePath.startsWith(`${ignoredPath}/`)
  );
}

function touchedFileSortValue(entry: VmTouchedFile): number {
  const modifiedAt = entry.modifiedAt ? Date.parse(entry.modifiedAt) : 0;
  const changedAt = entry.changedAt ? Date.parse(entry.changedAt) : 0;
  return Math.max(
    Number.isFinite(modifiedAt) ? modifiedAt : 0,
    Number.isFinite(changedAt) ? changedAt : 0,
  );
}

function sortTouchedFileReasons(
  reasons: VmTouchedFileReason[],
): VmTouchedFileReason[] {
  return [...reasons].sort((left, right) => left.localeCompare(right));
}

function pickVmDiskUsageFocus(
  root: VmDiskUsageSnapshot["root"],
  workspace: VmDiskUsageSnapshot["workspace"],
): VmDiskUsageSnapshot["root"] {
  if (!root) {
    return workspace;
  }

  if (!workspace) {
    return root;
  }

  const rootAvailable = root.availableBytes ?? Number.POSITIVE_INFINITY;
  const workspaceAvailable = workspace.availableBytes ?? Number.POSITIVE_INFINITY;

  return workspaceAvailable <= rootAvailable ? workspace : root;
}

function resolveVmDiskUsageStatus(
  root: VmDiskUsageSnapshot["root"],
  workspace: VmDiskUsageSnapshot["workspace"],
): VmDiskUsageSnapshot["status"] {
  const entries = [workspace, root].filter(
    (entry): entry is NonNullable<VmDiskUsageSnapshot["root"]> => entry !== null,
  );

  if (entries.length === 0) {
    return "unavailable";
  }

  if (
    entries.some(
      (entry) =>
        entry.availableBytes !== null &&
        entry.availableBytes <= VM_DISK_CRITICAL_FREE_BYTES,
    )
  ) {
    return "critical";
  }

  if (
    entries.some(
      (entry) =>
        entry.availableBytes !== null &&
        entry.availableBytes <= VM_DISK_WARNING_FREE_BYTES,
    )
  ) {
    return "warning";
  }

  return "ready";
}

function describeVmDiskUsageStatus(
  status: VmDiskUsageSnapshot["status"],
  focus: VmDiskUsageSnapshot["root"],
): string {
  if (!focus || focus.availableBytes === null) {
    return "Parallaize could not inspect guest disk usage from the running VM.";
  }

  const freeLabel = formatByteCount(focus.availableBytes);
  const locationLabel =
    focus.path === "/"
      ? `root filesystem at ${focus.mountPath}`
      : `workspace path ${focus.path} on ${focus.mountPath}`;

  switch (status) {
    case "critical":
      return `Only ${freeLabel} free on the ${locationLabel}. Resize or clean the guest before writes fail.`;
    case "warning":
      return `${freeLabel} free on the ${locationLabel}. Resize or clean the guest before it drops under 1 GB free.`;
    case "ready":
      return `${freeLabel} free on the ${locationLabel}.`;
    case "unavailable":
    default:
      return "Parallaize could not inspect guest disk usage from the running VM.";
  }
}

function resolveMockVmHomePath(): string {
  return "/home/ubuntu";
}

function resolveMockVmBrowsePath(vm: VmInstance): string {
  const workspacePath = normalizeGuestPath(vm.workspacePath || DEFAULT_GUEST_WORKSPACE);
  const homePath = resolveMockVmHomePath();

  return homePath || workspacePath || "/";
}

function isMockDirectoryPath(vm: VmInstance, path: string): boolean {
  const workspacePath = normalizeGuestPath(vm.workspacePath || DEFAULT_GUEST_WORKSPACE);
  const directoryPaths = new Set([
    "/",
    "/etc",
    "/home",
    "/home/ubuntu",
    "/home/ubuntu/Desktop",
    "/home/ubuntu/Downloads",
    "/srv",
    "/srv/workspaces",
    workspacePath,
    `${workspacePath}/src`,
    `${workspacePath}/.config`,
    `${workspacePath}/logs`,
  ]);

  return directoryPaths.has(path);
}
