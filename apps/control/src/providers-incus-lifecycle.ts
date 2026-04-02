import { slugify } from "../../../packages/shared/src/helpers.js";
import type { VmDesktopTransport, VmInstance } from "../../../packages/shared/src/types.js";
import {
  buildEnsureGuestDesktopBootstrapScript,
  buildGuestDisplayDiscoveryScript,
  type GuestSelkiesRtcConfig,
} from "./ubuntu-guest-init.js";
import { DEFAULT_GUEST_INIT_LOG_PATH } from "./providers-contracts.js";

export function parseSnapshotName(providerRef: string, instanceName: string): string {
  const prefix = `${instanceName}/`;

  if (providerRef.startsWith(prefix)) {
    return providerRef.slice(prefix.length);
  }

  const slashIndex = providerRef.lastIndexOf("/");

  if (slashIndex >= 0 && slashIndex < providerRef.length - 1) {
    return providerRef.slice(slashIndex + 1);
  }

  throw new Error(`Snapshot provider ref ${providerRef} is not attached to ${instanceName}.`);
}

export function validateDisplayResolution(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error("Display resolution width and height must be integers.");
  }

  if (width < 320 || width > 8192 || height < 200 || height > 8192) {
    throw new Error("Display resolution is outside the supported range.");
  }
}

export function buildSetDisplayResolutionScript(
  width: number,
  height: number,
  port: number,
  guestWallpaperName?: string,
  transport: VmDesktopTransport = "vnc",
  selkiesPort = port,
  selkiesRtcConfig: GuestSelkiesRtcConfig | null = null,
): string {
  return `set -eu
WIDTH=${width}
HEIGHT=${height}
${buildEnsureGuestDesktopBootstrapScript(
    port,
    true,
    guestWallpaperName,
    "standard",
    transport,
    selkiesPort,
    selkiesRtcConfig,
  )}
${buildGuestDisplayDiscoveryScript()}
ATTEMPT=0
AUTH_FILE=""
DISPLAY_NUMBER=":0"
while [ "$ATTEMPT" -lt 30 ]; do
  DISPLAY_NUMBER="$(find_guest_display_number)"
  AUTH_FILE="$(find_guest_auth_file || true)"
  if [ -n "$AUTH_FILE" ] && [ -f "$AUTH_FILE" ]; then
    break
  fi
  ATTEMPT=$((ATTEMPT + 1))
  sleep 2
done
if [ -z "$AUTH_FILE" ] || [ ! -f "$AUTH_FILE" ]; then
  echo "Unable to locate an Xauthority file for the desktop session." >&2
  exit 1
fi
export DISPLAY="$DISPLAY_NUMBER"
export XAUTHORITY="$AUTH_FILE"
ATTEMPT=0
OUTPUT=""
while [ "$ATTEMPT" -lt 15 ]; do
  OUTPUT="$(xrandr --query | awk '/ connected/ { print $1; exit }')"
  if [ -n "$OUTPUT" ]; then
    break
  fi
  ATTEMPT=$((ATTEMPT + 1))
  sleep 2
done
if [ -z "$OUTPUT" ]; then
  echo "No connected XRANDR output was found." >&2
  exit 1
fi
TARGET_MODE="${width}x${height}"
MODE_TO_APPLY="$(xrandr --query | awk -v target="$TARGET_MODE" '$1 == target || $1 ~ ("^" target "(_|R|$)") { print $1; exit }')"
if [ -n "$MODE_TO_APPLY" ]; then
  xrandr --output "$OUTPUT" --mode "$MODE_TO_APPLY"
else
  if ! command -v cvt >/dev/null 2>&1; then
    echo "cvt is required to generate a display mode for $TARGET_MODE." >&2
    exit 1
  fi
  MODELINE="$(cvt "$WIDTH" "$HEIGHT" 60)"
  MODE_NAME="$(printf '%s\n' "$MODELINE" | awk -F'"' '/^Modeline / { print $2; exit }')"
  MODE_ARGS="$(printf '%s\n' "$MODELINE" | sed -n 's/^Modeline "[^"]*" //p')"
  if [ -z "$MODE_NAME" ] || [ -z "$MODE_ARGS" ]; then
    echo "Failed to generate an XRANDR modeline for $TARGET_MODE." >&2
    exit 1
  fi
  xrandr --newmode "$MODE_NAME" $MODE_ARGS 2>/dev/null || true
  xrandr --addmode "$OUTPUT" "$MODE_NAME" 2>/dev/null || true
  MODE_TO_APPLY="$MODE_NAME"
  xrandr --output "$OUTPUT" --mode "$MODE_TO_APPLY"
fi`;
}

export function buildGuestInitCommandsScript(initCommands: string[]): string {
  return `set -eu
LOG_FILE="${DEFAULT_GUEST_INIT_LOG_PATH}"
mkdir -p "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"
TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM
run_init_command() {
  command_index="$1"
  script_path="$2"
  printf '%s\\n' "==> init command $command_index started" >> "$LOG_FILE"
  sh "$script_path" >> "$LOG_FILE" 2>&1
  printf '%s\\n' "==> init command $command_index finished" >> "$LOG_FILE"
}
${initCommands.map((command, index) => {
  const scriptName = `"$TMP_DIR/${String(index + 1).padStart(2, "0")}.sh"`;
  const marker = `PARALLAIZE_INIT_${String(index + 1).padStart(2, "0")}`;
  return `cat > ${scriptName} <<'${marker}'
${command}
${marker}
run_init_command ${index + 1} ${scriptName}`;
}).join("\n")}`;
}

export function formatMemoryLimit(ramMb: number): string {
  return `${ramMb}MiB`;
}

export function formatStateVolumeSize(ramMb: number): string {
  const minimumHeadroomMb = 512;
  const targetMb = Math.max(ramMb + minimumHeadroomMb, Math.ceil(ramMb * 1.1));
  return `${targetMb}MiB`;
}

export function formatDiskSize(diskGb: number): string {
  return `${diskGb}GiB`;
}

export function buildSnapshotName(label: string): string {
  const slug = slugify(label) || "snapshot";
  return `parallaize-${Date.now().toString(36)}-${slug}`;
}

export function buildTemplateSnapshotName(templateId: string): string {
  return `parallaize-template-${slugify(templateId)}-${Date.now().toString(36)}`;
}

export function buildTemplateAlias(templateId: string): string {
  return `parallaize-template-${slugify(templateId)}`;
}

export function buildTemplatePublisherInstanceName(templateId: string): string {
  return `parallaize-template-publish-${slugify(templateId)}-${Date.now().toString(36)}`;
}

export function resolveGuestWallpaperName(
  vm: Pick<VmInstance, "name" | "wallpaperName">,
): string {
  const wallpaperName =
    typeof vm.wallpaperName === "string" ? vm.wallpaperName.trim() : "";

  return wallpaperName || vm.name;
}
