import type { VmDesktopTransport } from "../../../packages/shared/src/types.js";
import { slugify } from "../../../packages/shared/src/helpers.js";
import { resolveDesktopTransportRuntime } from "../../../packages/shared/src/desktopTransport.js";

const DEFAULT_GUEST_USERNAME = "ubuntu";
export const DEFAULT_GUEST_HOME = `/home/${DEFAULT_GUEST_USERNAME}`;
export const DEFAULT_GUEST_DESKTOP_HEALTH_CHECK =
  "/usr/local/bin/parallaize-desktop-health-check";
export type GuestDesktopBootstrapRepairProfile = "standard" | "aggressive";
const DEFAULT_GUEST_SELKIES_PORT = 6080;
export const DEFAULT_GUEST_SELKIES_VERSION = "1.6.2";
export const DEFAULT_GUEST_SELKIES_ARCHIVE_URL =
  `https://github.com/selkies-project/selkies/releases/download/v${DEFAULT_GUEST_SELKIES_VERSION}/selkies-gstreamer-portable-v${DEFAULT_GUEST_SELKIES_VERSION}_amd64.tar.gz`;
export const DEFAULT_GUEST_SELKIES_ARCHIVE_FILE =
  `/var/cache/parallaize/selkies/v${DEFAULT_GUEST_SELKIES_VERSION}.tar.gz`;
const DEFAULT_GUEST_SELKIES_PATCH_LEVEL = "2026-04-01-1";
export const DEFAULT_GUEST_DESKTOP_BRIDGE_PATCH_LEVEL = "2026-04-01-1";
export const DEFAULT_GUEST_DESKTOP_BRIDGE_VERSION_FILE =
  "/var/lib/parallaize/desktop-bridge-version.json";
const DEFAULT_GUEST_WALLPAPER = "Monument_valley_by_orbitelambda.jpg";
const DEFAULT_GUEST_WALLPAPER_BASE_URL = "https://wallpapers.parallaize.com/24.04";
const DEFAULT_GUEST_HOSTNAME_STATE_DIR = "/etc/parallaize";
const DEFAULT_GUEST_HOSTNAME_STATE_FILE =
  `${DEFAULT_GUEST_HOSTNAME_STATE_DIR}/desired-hostname`;
const DEFAULT_GUEST_HOSTNAME_SYNC_FILE = "/usr/local/bin/parallaize-hostname-sync";
const DEFAULT_GUEST_HOSTNAME_SYNC_SERVICE_FILE =
  "/etc/systemd/system/parallaize-hostname-sync.service";
const DEFAULT_GUEST_DESKTOP_HEALTH_GRACE_SECONDS = 30;
const DEFAULT_GUEST_DESKTOP_GDM_RESTART_COOLDOWN_SECONDS = 30;
const AGGRESSIVE_GUEST_DESKTOP_HEALTH_GRACE_SECONDS = 10;
const AGGRESSIVE_GUEST_DESKTOP_GDM_RESTART_COOLDOWN_SECONDS = 15;

export interface GuestInotifySettings {
  maxUserWatches: number;
  maxUserInstances: number;
}

export interface GuestSelkiesRtcConfig {
  stunHost?: string | null;
  stunPort?: number | null;
  turnHost?: string | null;
  turnPort?: number | null;
  turnProtocol?: "tcp" | "udp" | null;
  turnTls?: boolean | null;
  turnSharedSecret?: string | null;
  turnUsername?: string | null;
  turnPassword?: string | null;
  turnRestUri?: string | null;
  turnRestUsername?: string | null;
  turnRestUsernameAuthHeader?: string | null;
  turnRestProtocolHeader?: string | null;
  turnRestTlsHeader?: string | null;
}

export interface GuestDesktopBridgeVersionRecord {
  bridgePatchLevel: string;
  label: string;
  selkiesPatchLevel: string | null;
  selkiesVersion: string | null;
  transport: VmDesktopTransport;
}

export function buildExpectedGuestDesktopBridgeVersionRecord(
  transport: VmDesktopTransport,
): GuestDesktopBridgeVersionRecord {
  const runtime = resolveDesktopTransportRuntime(transport);
  const selkiesVersion =
    runtime === "selkies" ? `v${DEFAULT_GUEST_SELKIES_VERSION}` : null;
  const selkiesPatchLevel =
    runtime === "selkies" ? DEFAULT_GUEST_SELKIES_PATCH_LEVEL : null;
  const label =
    runtime === "selkies"
      ? `bridge:${DEFAULT_GUEST_DESKTOP_BRIDGE_PATCH_LEVEL};selkies:${selkiesVersion}+${selkiesPatchLevel}`
      : `bridge:${DEFAULT_GUEST_DESKTOP_BRIDGE_PATCH_LEVEL};runtime:${runtime}`;

  return {
    bridgePatchLevel: DEFAULT_GUEST_DESKTOP_BRIDGE_PATCH_LEVEL,
    label,
    selkiesPatchLevel,
    selkiesVersion,
    transport,
  };
}

function buildGuestGdmCustomConfig(): string {
  return `[daemon]
AutomaticLoginEnable=true
AutomaticLogin=${DEFAULT_GUEST_USERNAME}
WaylandEnable=false`;
}

export function buildEnsureGuestDesktopBootstrapScript(
  port: number,
  strictStart: boolean,
  vmName?: string,
  repairProfile: GuestDesktopBootstrapRepairProfile = "standard",
  transport: VmDesktopTransport = "vnc",
  selkiesPort: number = DEFAULT_GUEST_SELKIES_PORT,
  selkiesRtcConfig: GuestSelkiesRtcConfig | null = null,
  vmId?: string,
  streamHealthToken?: string | null,
  controlPlanePort = 3000,
): string {
  return `BOOTSTRAP_FILE="/usr/local/bin/parallaize-desktop-bootstrap"
BOOTSTRAP_SERVICE_FILE="/etc/systemd/system/parallaize-desktop-bootstrap.service"
CURRENT_BOOTSTRAP="$(cat "$BOOTSTRAP_FILE" 2>/dev/null || true)"
DESIRED_BOOTSTRAP="$(cat <<'PARALLAIZE_BOOTSTRAP_SCRIPT'
${buildGuestDesktopBootstrapScript(
    port,
    vmName,
    repairProfile,
    transport,
    selkiesPort,
    selkiesRtcConfig,
    vmId,
    streamHealthToken,
    controlPlanePort,
  )}
PARALLAIZE_BOOTSTRAP_SCRIPT
)"
CURRENT_BOOTSTRAP_SERVICE="$(cat "$BOOTSTRAP_SERVICE_FILE" 2>/dev/null || true)"
DESIRED_BOOTSTRAP_SERVICE="$(cat <<'PARALLAIZE_BOOTSTRAP_UNIT'
${buildGuestDesktopBootstrapServiceUnit()}
PARALLAIZE_BOOTSTRAP_UNIT
)"
if [ "$CURRENT_BOOTSTRAP" != "$DESIRED_BOOTSTRAP" ] || [ "$CURRENT_BOOTSTRAP_SERVICE" != "$DESIRED_BOOTSTRAP_SERVICE" ]; then
  mkdir -p /usr/local/bin /etc/systemd/system
  cat > "$BOOTSTRAP_FILE" <<'PARALLAIZE_BOOTSTRAP_SCRIPT'
${buildGuestDesktopBootstrapScript(
    port,
    vmName,
    repairProfile,
    transport,
    selkiesPort,
    selkiesRtcConfig,
    vmId,
    streamHealthToken,
    controlPlanePort,
  )}
PARALLAIZE_BOOTSTRAP_SCRIPT
  chmod 0755 "$BOOTSTRAP_FILE"
  cat > "$BOOTSTRAP_SERVICE_FILE" <<'PARALLAIZE_BOOTSTRAP_UNIT'
${buildGuestDesktopBootstrapServiceUnit()}
PARALLAIZE_BOOTSTRAP_UNIT
fi
systemctl daemon-reload
systemctl enable parallaize-desktop-bootstrap.service >/dev/null 2>&1 || true
"$BOOTSTRAP_FILE"${strictStart ? "" : " || true"}`;
}

export function buildEnsureGuestHostnameScript(vmName?: string): string {
  const guestHostname = resolveGuestHostname(vmName) ?? "";

  return `HOSTNAME_STATE_DIR="${DEFAULT_GUEST_HOSTNAME_STATE_DIR}"
HOSTNAME_STATE_FILE="${DEFAULT_GUEST_HOSTNAME_STATE_FILE}"
HOSTNAME_SYNC_FILE="${DEFAULT_GUEST_HOSTNAME_SYNC_FILE}"
HOSTNAME_SYNC_SERVICE_NAME="parallaize-hostname-sync.service"
HOSTNAME_SYNC_SERVICE_FILE="${DEFAULT_GUEST_HOSTNAME_SYNC_SERVICE_FILE}"
CURRENT_HOSTNAME_SYNC="$(cat "$HOSTNAME_SYNC_FILE" 2>/dev/null || true)"
DESIRED_HOSTNAME_SYNC="$(cat <<'PARALLAIZE_HOSTNAME_SYNC_SCRIPT'
${buildGuestHostnameSyncScript()}
PARALLAIZE_HOSTNAME_SYNC_SCRIPT
)"
CURRENT_HOSTNAME_SYNC_SERVICE="$(cat "$HOSTNAME_SYNC_SERVICE_FILE" 2>/dev/null || true)"
DESIRED_HOSTNAME_SYNC_SERVICE="$(cat <<'PARALLAIZE_HOSTNAME_SYNC_UNIT'
${buildGuestHostnameSyncServiceUnit()}
PARALLAIZE_HOSTNAME_SYNC_UNIT
)"
DESIRED_HOSTNAME="${guestHostname}"
CURRENT_DESIRED_HOSTNAME="$(cat "$HOSTNAME_STATE_FILE" 2>/dev/null || true)"
if [ "$CURRENT_HOSTNAME_SYNC" != "$DESIRED_HOSTNAME_SYNC" ] || [ "$CURRENT_HOSTNAME_SYNC_SERVICE" != "$DESIRED_HOSTNAME_SYNC_SERVICE" ]; then
  mkdir -p /usr/local/bin /etc/systemd/system
  cat > "$HOSTNAME_SYNC_FILE" <<'PARALLAIZE_HOSTNAME_SYNC_SCRIPT'
${buildGuestHostnameSyncScript()}
PARALLAIZE_HOSTNAME_SYNC_SCRIPT
  chmod 0755 "$HOSTNAME_SYNC_FILE"
  cat > "$HOSTNAME_SYNC_SERVICE_FILE" <<'PARALLAIZE_HOSTNAME_SYNC_UNIT'
${buildGuestHostnameSyncServiceUnit()}
PARALLAIZE_HOSTNAME_SYNC_UNIT
fi
if [ "$CURRENT_DESIRED_HOSTNAME" != "$DESIRED_HOSTNAME" ]; then
  mkdir -p "$HOSTNAME_STATE_DIR"
  printf '%s\\n' "$DESIRED_HOSTNAME" > "$HOSTNAME_STATE_FILE"
fi
systemctl daemon-reload
systemctl enable "$HOSTNAME_SYNC_SERVICE_NAME" >/dev/null 2>&1 || true
"$HOSTNAME_SYNC_FILE" || true`;
}

export function buildGuestDisplayDiscoveryScript(): string {
  return `find_guest_display_number() {
  CURRENT_DISPLAY="$(ps -C x11vnc -o args= 2>/dev/null | sed -n 's/.* -display \\([^ ]*\\).*/\\1/p' | head -n 1)"
  if [ -n "$CURRENT_DISPLAY" ]; then
    printf '%s\\n' "$CURRENT_DISPLAY"
    return 0
  fi
  CURRENT_DISPLAY="$(ps -C Xorg -o args= 2>/dev/null | sed -n 's/.* \\(:[0-9][0-9]*\\)\\( \\|$\\).*/\\1/p' | head -n 1)"
  if [ -n "$CURRENT_DISPLAY" ]; then
    printf '%s\\n' "$CURRENT_DISPLAY"
    return 0
  fi
  CURRENT_DISPLAY="$(ps -C Xwayland -o args= 2>/dev/null | sed -n 's/.* \\(:[0-9][0-9]*\\)\\( \\|$\\).*/\\1/p' | head -n 1)"
  if [ -n "$CURRENT_DISPLAY" ]; then
    printf '%s\\n' "$CURRENT_DISPLAY"
    return 0
  fi
  printf '%s\\n' ':0'
}

find_guest_auth_file() {
  CURRENT_AUTH_FILE="$(ps -C x11vnc -o args= 2>/dev/null | sed -n 's/.* -auth \\([^ ]*\\).*/\\1/p' | head -n 1)"
  if [ -n "$CURRENT_AUTH_FILE" ] && [ -f "$CURRENT_AUTH_FILE" ]; then
    printf '%s\\n' "$CURRENT_AUTH_FILE"
    return 0
  fi
  for CURRENT_AUTH_FILE in $(ps -C Xorg -o args= 2>/dev/null | sed -n 's/.* -auth \\([^ ]*\\).*/\\1/p'; ps -C Xwayland -o args= 2>/dev/null | sed -n 's/.* -auth \\([^ ]*\\).*/\\1/p'); do
    if [ -f "$CURRENT_AUTH_FILE" ]; then
      printf '%s\\n' "$CURRENT_AUTH_FILE"
      return 0
    fi
  done
  if command -v loginctl >/dev/null 2>&1; then
    for CURRENT_SESSION in $(loginctl list-sessions --no-legend 2>/dev/null | awk '{print $1}'); do
      CURRENT_UID="$(loginctl show-session "$CURRENT_SESSION" -p User --value 2>/dev/null || true)"
      CURRENT_NAME="$(loginctl show-session "$CURRENT_SESSION" -p Name --value 2>/dev/null || true)"
      CURRENT_TYPE="$(loginctl show-session "$CURRENT_SESSION" -p Type --value 2>/dev/null || true)"
      CURRENT_STATE="$(loginctl show-session "$CURRENT_SESSION" -p State --value 2>/dev/null || true)"
      CURRENT_REMOTE="$(loginctl show-session "$CURRENT_SESSION" -p Remote --value 2>/dev/null || true)"
      if [ -z "$CURRENT_UID" ] || [ "$CURRENT_REMOTE" = "yes" ]; then
        continue
      fi
      if [ "$CURRENT_STATE" != "active" ] && [ "$CURRENT_TYPE" != "x11" ] && [ "$CURRENT_TYPE" != "wayland" ]; then
        continue
      fi
      for CURRENT_AUTH_FILE in \
        /run/user/"$CURRENT_UID"/gdm/Xauthority \
        /run/user/"$CURRENT_UID"/Xauthority \
        /run/user/"$CURRENT_UID"/.Xauthority \
        /run/user/"$CURRENT_UID"/.mutter-Xwaylandauth.* \
        /run/user/"$CURRENT_UID"/gdm/.mutter-Xwaylandauth.* \
        /home/"$CURRENT_NAME"/.Xauthority; do
        if [ -f "$CURRENT_AUTH_FILE" ]; then
          printf '%s\\n' "$CURRENT_AUTH_FILE"
          return 0
        fi
      done
    done
  fi
  for CURRENT_AUTH_FILE in \
    /run/user/*/gdm/Xauthority \
    /run/user/*/Xauthority \
    /run/user/*/.Xauthority \
    /run/user/*/.mutter-Xwaylandauth.* \
    /run/user/*/gdm/.mutter-Xwaylandauth.* \
    /var/run/gdm3/auth-for-*/database \
    /var/lib/gdm3/.local/share/xorg/Xauthority \
    /home/*/.Xauthority; do
    if [ -f "$CURRENT_AUTH_FILE" ]; then
      printf '%s\\n' "$CURRENT_AUTH_FILE"
      return 0
    fi
  done
  return 1
}`;
}

function buildGuestDesktopHealthFunctions(): string {
  return `guest_desktop_has_visible_stage() {
  if ! command -v xwininfo >/dev/null 2>&1; then
    return 0
  fi
  DISPLAY_NUMBER="$(find_guest_display_number)"
  AUTH_FILE="$(find_guest_auth_file || true)"
  if [ -z "$AUTH_FILE" ] || [ ! -f "$AUTH_FILE" ]; then
    return 1
  fi
  DISPLAY="$DISPLAY_NUMBER" XAUTHORITY="$AUTH_FILE" xwininfo -root -tree 2>/dev/null | awk '
    /mutter guard window/ { next }
    {
      for (i = 1; i <= NF; i += 1) {
        if ($i ~ /^[0-9]+x[0-9]+[+][+-]?[0-9]+[+][+-]?[0-9]+$/) {
          split($i, dims, /[x+]/)
          if ((dims[1] + 0) >= 200 && (dims[2] + 0) >= 200) {
            found = 1
          }
        }
      }
    }
    END { exit found ? 0 : 1 }
  '
}

guest_desktop_session_ready() {
  if ! id ${DEFAULT_GUEST_USERNAME} >/dev/null 2>&1; then
    return 1
  fi
  if ! pgrep -u ${DEFAULT_GUEST_USERNAME} -x gnome-shell >/dev/null 2>&1; then
    return 1
  fi
  if ! ps -u ${DEFAULT_GUEST_USERNAME} -o args= | grep -F "/usr/libexec/gnome-session-binary" >/dev/null 2>&1; then
    return 1
  fi
  if command -v loginctl >/dev/null 2>&1; then
    for CURRENT_SESSION in $(loginctl list-sessions --no-legend 2>/dev/null | awk '{print $1}'); do
      CURRENT_UID="$(loginctl show-session "$CURRENT_SESSION" -p User --value 2>/dev/null || true)"
      CURRENT_NAME="$(loginctl show-session "$CURRENT_SESSION" -p Name --value 2>/dev/null || true)"
      CURRENT_TYPE="$(loginctl show-session "$CURRENT_SESSION" -p Type --value 2>/dev/null || true)"
      CURRENT_CLASS="$(loginctl show-session "$CURRENT_SESSION" -p Class --value 2>/dev/null || true)"
      CURRENT_STATE="$(loginctl show-session "$CURRENT_SESSION" -p State --value 2>/dev/null || true)"
      CURRENT_REMOTE="$(loginctl show-session "$CURRENT_SESSION" -p Remote --value 2>/dev/null || true)"
      if [ -z "$CURRENT_UID" ] || [ "$CURRENT_REMOTE" = "yes" ]; then
        continue
      fi
      if [ "$CURRENT_NAME" != "${DEFAULT_GUEST_USERNAME}" ]; then
        continue
      fi
      if [ "$CURRENT_CLASS" != "user" ] || [ "$CURRENT_STATE" != "active" ]; then
        continue
      fi
      if [ "$CURRENT_TYPE" = "x11" ] || [ "$CURRENT_TYPE" = "wayland" ]; then
        guest_desktop_has_visible_stage
        return $?
      fi
    done
    return 1
  fi
  guest_desktop_has_visible_stage
}`;
}

export function buildGuestDesktopHealthCheckScript(): string {
  return `#!/bin/sh
set -eu
${buildGuestDisplayDiscoveryScript()}
${buildGuestDesktopHealthFunctions()}
if guest_desktop_session_ready; then
  exit 0
fi
exit 1`;
}

function buildGuestVncLauncherScript(port: number): string {
  return `#!/bin/sh
set -eu
${buildGuestDisplayDiscoveryScript()}
${buildGuestDesktopHealthFunctions()}
ATTEMPT=0
AUTH_FILE=""
DISPLAY_NUMBER=":0"
while [ "$ATTEMPT" -lt 45 ]; do
  DISPLAY_NUMBER="$(find_guest_display_number)"
  AUTH_FILE="$(find_guest_auth_file || true)"
  if [ -n "$AUTH_FILE" ] && [ -f "$AUTH_FILE" ]; then
    break
  fi
  ATTEMPT=$((ATTEMPT + 1))
  sleep 2
done
if [ -z "$AUTH_FILE" ]; then
  echo "Unable to locate an Xauthority file for the desktop session." >&2
  exit 1
fi
export DISPLAY="$DISPLAY_NUMBER"
export XAUTHORITY="$AUTH_FILE"
export HOME="\${HOME:-/root}"
xset r on || true
# GNOME Shell uses a compositor. x11vnc's X DAMAGE path can get stuck on a
# stale black frame there, so disable it for the browser bridge.
exec /usr/bin/x11vnc -display "$DISPLAY_NUMBER" -auth "$AUTH_FILE" -forever -shared -xrandr newfbsize -noxdamage -noshm -nopw -norepeat -rfbport ${port} -o /var/log/x11vnc.log`;
}

function buildGuestVncServiceUnit(): string {
  return `[Unit]
Description=Parallaize x11vnc bridge
After=display-manager.service
Wants=display-manager.service
ConditionPathExists=/usr/bin/x11vnc

[Service]
Type=simple
ExecStart=/usr/local/bin/parallaize-x11vnc
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target`;
}

function escapeShellDoubleQuoted(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("$", "\\$")
    .replaceAll("`", "\\`");
}

function buildGuestSelkiesRtcEnvironment(
  config: GuestSelkiesRtcConfig | null = null,
): string {
  if (!config) {
    return "";
  }

  const lines: string[] = [];

  const pushString = (name: string, value: string | null | undefined): void => {
    if (!value) {
      return;
    }

    lines.push(`export ${name}="${escapeShellDoubleQuoted(value)}"`);
  };

  const pushNumber = (name: string, value: number | null | undefined): void => {
    if (!Number.isFinite(value)) {
      return;
    }

    lines.push(`export ${name}="${Math.trunc(value ?? 0)}"`);
  };

  const pushBoolean = (name: string, value: boolean | null | undefined): void => {
    if (typeof value !== "boolean") {
      return;
    }

    lines.push(`export ${name}="${value ? "true" : "false"}"`);
  };

  pushString("SELKIES_STUN_HOST", config.stunHost);
  pushNumber("SELKIES_STUN_PORT", config.stunPort);
  pushString("SELKIES_TURN_HOST", config.turnHost);
  pushNumber("SELKIES_TURN_PORT", config.turnPort);
  pushString("SELKIES_TURN_PROTOCOL", config.turnProtocol);
  pushBoolean("SELKIES_TURN_TLS", config.turnTls);
  pushString("SELKIES_TURN_SHARED_SECRET", config.turnSharedSecret);
  pushString("SELKIES_TURN_USERNAME", config.turnUsername);
  pushString("SELKIES_TURN_PASSWORD", config.turnPassword);
  pushString("SELKIES_TURN_REST_URI", config.turnRestUri);
  pushString("SELKIES_TURN_REST_USERNAME", config.turnRestUsername);
  pushString(
    "SELKIES_TURN_REST_USERNAME_AUTH_HEADER",
    config.turnRestUsernameAuthHeader,
  );
  pushString(
    "SELKIES_TURN_REST_PROTOCOL_HEADER",
    config.turnRestProtocolHeader,
  );
  pushString("SELKIES_TURN_REST_TLS_HEADER", config.turnRestTlsHeader);

  return lines.join("\n");
}

function buildGuestSelkiesLauncherScript(
  port: number,
  rtcConfig: GuestSelkiesRtcConfig | null = null,
): string {
  const rtcEnvironment = buildGuestSelkiesRtcEnvironment(rtcConfig);

  return `#!/bin/sh
set -eu
SELKIES_DIR="/opt/parallaize/selkies-gstreamer"
SELKIES_RUNNER="$SELKIES_DIR/bin/selkies-gstreamer-run"
${buildGuestDisplayDiscoveryScript()}
ATTEMPT=0
AUTH_FILE=""
DISPLAY_NUMBER=":0"
while [ "$ATTEMPT" -lt 45 ]; do
  DISPLAY_NUMBER="$(find_guest_display_number)"
  AUTH_FILE="$(find_guest_auth_file || true)"
  if [ -n "$AUTH_FILE" ] && [ -f "$AUTH_FILE" ]; then
    break
  fi
  ATTEMPT=$((ATTEMPT + 1))
  sleep 2
done
if [ ! -x "$SELKIES_RUNNER" ]; then
  echo "Selkies portable runtime is missing at $SELKIES_RUNNER." >&2
  exit 1
fi
if [ -z "$AUTH_FILE" ] || [ ! -f "$AUTH_FILE" ]; then
  echo "Unable to locate an Xauthority file for the desktop session." >&2
  exit 1
fi
if ! id ${DEFAULT_GUEST_USERNAME} >/dev/null 2>&1; then
  echo "Selkies desktop user ${DEFAULT_GUEST_USERNAME} is missing." >&2
  exit 1
fi
if ! command -v runuser >/dev/null 2>&1; then
  echo "runuser is required to launch Selkies as ${DEFAULT_GUEST_USERNAME}." >&2
  exit 1
fi
DESKTOP_UID="$(id -u ${DEFAULT_GUEST_USERNAME})"
DESKTOP_GID="$(id -g ${DEFAULT_GUEST_USERNAME})"
DESKTOP_HOME="${DEFAULT_GUEST_HOME}"
DESKTOP_RUNTIME_DIR="/run/user/$DESKTOP_UID"
SELKIES_STATE_DIR="$DESKTOP_HOME/.cache/parallaize-selkies"
install -d -m 700 -o "$DESKTOP_UID" -g "$DESKTOP_GID" "$SELKIES_STATE_DIR"
export DISPLAY="$DISPLAY_NUMBER"
export XAUTHORITY="$AUTH_FILE"
export HOME="$DESKTOP_HOME"
export USER="${DEFAULT_GUEST_USERNAME}"
export LOGNAME="${DEFAULT_GUEST_USERNAME}"
export XDG_RUNTIME_DIR="$DESKTOP_RUNTIME_DIR"
export SELKIES_ADDR="0.0.0.0"
export SELKIES_PORT="${port}"
export SELKIES_ENABLE_HTTPS="false"
export SELKIES_ENABLE_BASIC_AUTH="false"
export SELKIES_ENABLE_RESIZE="true"
export SELKIES_CURSOR_SIZE="\${SELKIES_CURSOR_SIZE:-24}"
export SELKIES_ENABLE_WEBRTC_STATISTICS="false"
export SELKIES_ENABLE_METRICS_HTTP="false"
export SELKIES_ENCODER="\${SELKIES_ENCODER:-x264enc}"
export SELKIES_WEB_ROOT="$SELKIES_DIR/share/selkies-web"
export SELKIES_JSON_CONFIG="$SELKIES_STATE_DIR/selkies_config.json"
export SELKIES_RTC_CONFIG_JSON="$SELKIES_STATE_DIR/rtc.json"
${rtcEnvironment ? `${rtcEnvironment}
` : ""}exec runuser -u ${DEFAULT_GUEST_USERNAME} --preserve-environment -- "$SELKIES_RUNNER" --addr "$SELKIES_ADDR" --port "$SELKIES_PORT" --enable_basic_auth "$SELKIES_ENABLE_BASIC_AUTH" --enable_resize "$SELKIES_ENABLE_RESIZE"`;
}

function buildGuestSelkiesServiceUnit(): string {
  return `[Unit]
Description=Parallaize Selkies bridge
After=display-manager.service
Wants=display-manager.service
ConditionPathExists=/usr/local/bin/parallaize-selkies

[Service]
Type=simple
ExecStart=/usr/local/bin/parallaize-selkies
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target`;
}

function buildGuestSelkiesStreamHealthScript(
  vmId: string,
  token: string,
  controlPlanePort: number,
  selkiesPort: number,
): string {
  return `#!/usr/bin/env python3
import asyncio
from datetime import datetime
import json
import subprocess
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import websockets

VM_ID = ${JSON.stringify(vmId)}
TOKEN = ${JSON.stringify(token)}
CONTROL_PLANE_PORT = ${Math.max(1, Math.round(controlPlanePort))}
SELKIES_PORT = ${Math.max(1, Math.round(selkiesPort))}
DESKTOP_HEALTH_CHECK = ${JSON.stringify(DEFAULT_GUEST_DESKTOP_HEALTH_CHECK)}
HEARTBEAT_INTERVAL_SECONDS = 15
RECONNECT_DELAY_SECONDS = 3
SOURCE = "parallaize-selkies-heartbeat"

def resolve_default_gateway():
    try:
        result = subprocess.run(
            ["ip", "route", "show", "default"],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return "127.0.0.1"
    for line in result.stdout.splitlines():
        tokens = line.strip().split()
        if len(tokens) >= 3 and tokens[0] == "default":
            return tokens[2]
    return "127.0.0.1"

def build_websocket_url():
    host = resolve_default_gateway()
    return f"ws://{host}:{CONTROL_PLANE_PORT}/api/vms/{VM_ID}/stream-health?token={TOKEN}"

def service_is_active(name):
    try:
        result = subprocess.run(
            ["systemctl", "is-active", "--quiet", name],
            check=False,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0

def run_desktop_health_check():
    try:
        result = subprocess.run(
            [DESKTOP_HEALTH_CHECK],
            check=False,
            timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0

def probe_local_selkies():
    for path in ("/health", "/"):
        try:
            request = Request(
                f"http://127.0.0.1:{SELKIES_PORT}{path}",
                headers={"User-Agent": SOURCE},
            )
            with urlopen(request, timeout=5) as response:
                if response.status >= 200 and response.status < 500:
                    return True
        except HTTPError as exc:
            if path == "/health" and exc.code == 404:
                continue
        except URLError:
            continue
        except OSError:
            continue
    return False

def collect_sample():
    service_active = service_is_active("parallaize-selkies.service")
    desktop_healthy = run_desktop_health_check()
    local_reachable = probe_local_selkies()
    reason = None
    status = "ready"
    if not service_active:
        status = "unhealthy"
        reason = "guest desktop bridge service is inactive"
    elif not desktop_healthy:
        status = "unhealthy"
        reason = "guest desktop health check is failing"
    elif not local_reachable:
        status = "degraded"
        reason = "guest Selkies endpoint is not reachable locally"
    return {
        "desktopHealthy": desktop_healthy,
        "localReachable": local_reachable,
        "reason": reason,
        "sampledAt": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "serviceActive": service_active,
        "source": SOURCE,
        "status": status,
    }

async def run():
    while True:
        try:
            async with websockets.connect(
                build_websocket_url(),
                open_timeout=10,
                ping_interval=20,
                ping_timeout=20,
            ) as websocket:
                while True:
                    await websocket.send(json.dumps(collect_sample()))
                    await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
        except Exception:
            await asyncio.sleep(RECONNECT_DELAY_SECONDS)

asyncio.run(run())
`;
}

function buildGuestSelkiesStreamHealthServiceUnit(): string {
  return `[Unit]
Description=Parallaize Selkies stream health
After=parallaize-selkies.service
Wants=parallaize-selkies.service
ConditionPathExists=/usr/local/bin/parallaize-selkies-heartbeat

[Service]
Type=simple
ExecStart=/usr/local/bin/parallaize-selkies-heartbeat
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target`;
}

function buildGuestSelkiesInstallScript(): string {
  return `patch_selkies_bundle() {
  SELKIES_MAIN_FILE="$SELKIES_INSTALL_DIR/lib/python3.12/site-packages/selkies_gstreamer/__main__.py"
  if [ -f "$SELKIES_MAIN_FILE" ]; then
    python3 - "$SELKIES_MAIN_FILE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
contents = path.read_text()
contents = contents.replace(
    "           time.sleep(2)\\n           await signalling.setup_call()",
    "           await asyncio.sleep(1.5)\\n           await signalling.setup_call()",
)
contents = contents.replace(
    "           time.sleep(2)\\n           await audio_signalling.setup_call()",
    "           await asyncio.sleep(1.5)\\n           await audio_signalling.setup_call()",
)
if "preview_peer_id = 11" not in contents:
    contents = contents.replace(
        '''    my_id = 0
    peer_id = 1
    my_audio_id = 2
    audio_peer_id = 3
''',
        '''    my_id = 0
    peer_id = 1
    preview_my_id = 10
    preview_peer_id = 11
    my_audio_id = 2
    audio_peer_id = 3
''',
    )
if "preview_signalling = WebRTCSignalling" not in contents:
    contents = contents.replace(
        '''    audio_signalling = WebRTCSignalling('%s//127.0.0.1:%s/ws' % (ws_protocol, args.port), my_audio_id, audio_peer_id,
        enable_https=using_https,
        enable_basic_auth=using_basic_auth,
        basic_auth_user=args.basic_auth_user,
        basic_auth_password=args.basic_auth_password)
''',
        '''    audio_signalling = WebRTCSignalling('%s//127.0.0.1:%s/ws' % (ws_protocol, args.port), my_audio_id, audio_peer_id,
        enable_https=using_https,
        enable_basic_auth=using_basic_auth,
        basic_auth_user=args.basic_auth_user,
        basic_auth_password=args.basic_auth_password)
    preview_signalling = WebRTCSignalling('%s//127.0.0.1:%s/ws' % (ws_protocol, args.port), preview_my_id, preview_peer_id,
        enable_https=using_https,
        enable_basic_auth=using_basic_auth,
        basic_auth_user=args.basic_auth_user,
        basic_auth_password=args.basic_auth_password)
''',
    )
if "async def on_preview_signalling_error" not in contents:
    contents = contents.replace(
        '''    signalling.on_error = on_signalling_error
    audio_signalling.on_error = on_audio_signalling_error
''',
        '''    async def on_preview_signalling_error(e):
       if isinstance(e, WebRTCSignallingErrorNoPeer):
           await asyncio.sleep(1.5)
           await preview_signalling.setup_call()
       else:
           logger.error("preview signalling error: %s", str(e))
           app.stop_pipeline()
    signalling.on_error = on_signalling_error
    audio_signalling.on_error = on_audio_signalling_error
    preview_signalling.on_error = on_preview_signalling_error
''',
    )
if "preview_signalling.on_disconnect = lambda: app.stop_pipeline()" not in contents:
    contents = contents.replace(
        '''    signalling.on_disconnect = lambda: app.stop_pipeline()
    audio_signalling.on_disconnect = lambda: audio_app.stop_pipeline()
''',
        '''    signalling.on_disconnect = lambda: app.stop_pipeline()
    audio_signalling.on_disconnect = lambda: audio_app.stop_pipeline()
    preview_signalling.on_disconnect = lambda: app.stop_pipeline()
''',
    )
if "preview_signalling.on_connect = preview_signalling.setup_call" not in contents:
    contents = contents.replace(
        '''    signalling.on_connect = signalling.setup_call
    audio_signalling.on_connect = audio_signalling.setup_call
''',
        '''    signalling.on_connect = signalling.setup_call
    audio_signalling.on_connect = audio_signalling.setup_call
    preview_signalling.on_connect = preview_signalling.setup_call
''',
    )
if "def schedule_setup_call(signalling_client, retry_key, delay=0.0):" not in contents:
    contents = contents.replace(
        '''    # Handle errors from the signalling server
    async def on_signalling_error(e):
       if isinstance(e, WebRTCSignallingErrorNoPeer):
           # Waiting for peer to connect, retry in 2 seconds.
           await asyncio.sleep(1.5)
           await signalling.setup_call()
       else:
           logger.error("signalling error: %s", str(e))
           app.stop_pipeline()
    async def on_audio_signalling_error(e):
       if isinstance(e, WebRTCSignallingErrorNoPeer):
           # Waiting for peer to connect, retry in 2 seconds.
           await asyncio.sleep(1.5)
           await audio_signalling.setup_call()
       else:
           logger.error("signalling error: %s", str(e))
           audio_app.stop_pipeline()
    async def on_preview_signalling_error(e):
       if isinstance(e, WebRTCSignallingErrorNoPeer):
           await asyncio.sleep(1.5)
           await preview_signalling.setup_call()
       else:
           logger.error("preview signalling error: %s", str(e))
           app.stop_pipeline()
    signalling.on_error = on_signalling_error
    audio_signalling.on_error = on_audio_signalling_error
    preview_signalling.on_error = on_preview_signalling_error

    signalling.on_disconnect = lambda: app.stop_pipeline()
    audio_signalling.on_disconnect = lambda: audio_app.stop_pipeline()
    preview_signalling.on_disconnect = lambda: app.stop_pipeline()

    # After connecting, attempt to setup call to peer
    signalling.on_connect = signalling.setup_call
    audio_signalling.on_connect = audio_signalling.setup_call
    preview_signalling.on_connect = preview_signalling.setup_call
''',
        '''    setup_call_retry_tasks = {}

    def schedule_setup_call(signalling_client, retry_key, delay=0.0):
        existing_task = setup_call_retry_tasks.get(retry_key)
        if existing_task is not None and not existing_task.done():
            return existing_task

        async def run_setup_call():
            try:
                if delay > 0:
                    await asyncio.sleep(delay)
                await signalling_client.setup_call()
            except Exception as exc:
                logger.warning("setup call for %s failed: %s", retry_key, str(exc))
            finally:
                current_task = setup_call_retry_tasks.get(retry_key)
                if current_task is asyncio.current_task():
                    setup_call_retry_tasks.pop(retry_key, None)

        task = asyncio.ensure_future(run_setup_call())
        setup_call_retry_tasks[retry_key] = task
        return task

    def clear_setup_call_retry(retry_key):
        task = setup_call_retry_tasks.pop(retry_key, None)
        if task is not None and not task.done():
            task.cancel()

    # Handle errors from the signalling server
    async def on_signalling_connect():
       await schedule_setup_call(signalling, "video")
    async def on_signalling_error(e):
       if isinstance(e, WebRTCSignallingErrorNoPeer):
           schedule_setup_call(signalling, "video", 1.5)
       else:
           logger.error("signalling error: %s", str(e))
           app.stop_pipeline()
    async def on_audio_signalling_connect():
       await schedule_setup_call(audio_signalling, "audio")
    async def on_audio_signalling_error(e):
       if isinstance(e, WebRTCSignallingErrorNoPeer):
           schedule_setup_call(audio_signalling, "audio", 1.5)
       else:
           logger.error("signalling error: %s", str(e))
           audio_app.stop_pipeline()
    async def on_preview_signalling_connect():
       await schedule_setup_call(preview_signalling, "preview")
    async def on_preview_signalling_error(e):
       if isinstance(e, WebRTCSignallingErrorNoPeer):
           schedule_setup_call(preview_signalling, "preview", 1.5)
       else:
           logger.error("preview signalling error: %s", str(e))
           app.stop_pipeline()
    signalling.on_error = on_signalling_error
    audio_signalling.on_error = on_audio_signalling_error
    preview_signalling.on_error = on_preview_signalling_error

    signalling.on_disconnect = lambda: app.stop_pipeline()
    audio_signalling.on_disconnect = lambda: audio_app.stop_pipeline()
    preview_signalling.on_disconnect = lambda: app.stop_pipeline()

    # After connecting, attempt to setup call to peer
    signalling.on_connect = on_signalling_connect
    audio_signalling.on_connect = on_audio_signalling_connect
    preview_signalling.on_connect = on_preview_signalling_connect
''',
    )
    contents = contents.replace(
        '''    # Handle errors from the signalling server
    async def on_signalling_error(e):
       if isinstance(e, WebRTCSignallingErrorNoPeer):
           # Waiting for peer to connect, retry in 2 seconds.
           await asyncio.sleep(0.2)
           await signalling.setup_call()
       else:
           logger.error("signalling error: %s", str(e))
           app.stop_pipeline()
    async def on_audio_signalling_error(e):
       if isinstance(e, WebRTCSignallingErrorNoPeer):
           # Waiting for peer to connect, retry in 2 seconds.
           await asyncio.sleep(0.2)
           await audio_signalling.setup_call()
       else:
           logger.error("signalling error: %s", str(e))
           audio_app.stop_pipeline()
    async def on_preview_signalling_error(e):
       if isinstance(e, WebRTCSignallingErrorNoPeer):
           await asyncio.sleep(0.2)
           await preview_signalling.setup_call()
       else:
           logger.error("preview signalling error: %s", str(e))
           app.stop_pipeline()
    signalling.on_error = on_signalling_error
    audio_signalling.on_error = on_audio_signalling_error
    preview_signalling.on_error = on_preview_signalling_error

    signalling.on_disconnect = lambda: app.stop_pipeline()
    audio_signalling.on_disconnect = lambda: audio_app.stop_pipeline()
    preview_signalling.on_disconnect = lambda: app.stop_pipeline()

    # After connecting, attempt to setup call to peer
    signalling.on_connect = signalling.setup_call
    audio_signalling.on_connect = audio_signalling.setup_call
    preview_signalling.on_connect = preview_signalling.setup_call
''',
        '''    setup_call_retry_tasks = {}

    def schedule_setup_call(signalling_client, retry_key, delay=0.0):
        existing_task = setup_call_retry_tasks.get(retry_key)
        if existing_task is not None and not existing_task.done():
            return existing_task

        async def run_setup_call():
            try:
                if delay > 0:
                    await asyncio.sleep(delay)
                await signalling_client.setup_call()
            except Exception as exc:
                logger.warning("setup call for %s failed: %s", retry_key, str(exc))
            finally:
                current_task = setup_call_retry_tasks.get(retry_key)
                if current_task is asyncio.current_task():
                    setup_call_retry_tasks.pop(retry_key, None)

        task = asyncio.ensure_future(run_setup_call())
        setup_call_retry_tasks[retry_key] = task
        return task

    def clear_setup_call_retry(retry_key):
        task = setup_call_retry_tasks.pop(retry_key, None)
        if task is not None and not task.done():
            task.cancel()

    # Handle errors from the signalling server
    async def on_signalling_connect():
       await schedule_setup_call(signalling, "video")
    async def on_signalling_error(e):
       if isinstance(e, WebRTCSignallingErrorNoPeer):
           schedule_setup_call(signalling, "video", 1.5)
       else:
           logger.error("signalling error: %s", str(e))
           app.stop_pipeline()
    async def on_audio_signalling_connect():
       await schedule_setup_call(audio_signalling, "audio")
    async def on_audio_signalling_error(e):
       if isinstance(e, WebRTCSignallingErrorNoPeer):
           schedule_setup_call(audio_signalling, "audio", 1.5)
       else:
           logger.error("signalling error: %s", str(e))
           audio_app.stop_pipeline()
    async def on_preview_signalling_connect():
       await schedule_setup_call(preview_signalling, "preview")
    async def on_preview_signalling_error(e):
       if isinstance(e, WebRTCSignallingErrorNoPeer):
           schedule_setup_call(preview_signalling, "preview", 1.5)
       else:
           logger.error("preview signalling error: %s", str(e))
           app.stop_pipeline()
    signalling.on_error = on_signalling_error
    audio_signalling.on_error = on_audio_signalling_error
    preview_signalling.on_error = on_preview_signalling_error

    signalling.on_disconnect = lambda: app.stop_pipeline()
    audio_signalling.on_disconnect = lambda: audio_app.stop_pipeline()
    preview_signalling.on_disconnect = lambda: app.stop_pipeline()

    # After connecting, attempt to setup call to peer
    signalling.on_connect = on_signalling_connect
    audio_signalling.on_connect = on_audio_signalling_connect
    preview_signalling.on_connect = on_preview_signalling_connect
''',
    )
if "def schedule_signalling_restart(signalling_client, retry_key, delay=0.0):" not in contents:
    contents = contents.replace(
        '''    setup_call_retry_tasks = {}

    def schedule_setup_call(signalling_client, retry_key, delay=0.0):
        existing_task = setup_call_retry_tasks.get(retry_key)
        if existing_task is not None and not existing_task.done():
            return existing_task

        async def run_setup_call():
            try:
                if delay > 0:
                    await asyncio.sleep(delay)
                await signalling_client.setup_call()
            except Exception as exc:
                logger.warning("setup call for %s failed: %s", retry_key, str(exc))
            finally:
                current_task = setup_call_retry_tasks.get(retry_key)
                if current_task is asyncio.current_task():
                    setup_call_retry_tasks.pop(retry_key, None)

        task = asyncio.ensure_future(run_setup_call())
        setup_call_retry_tasks[retry_key] = task
        return task

    def clear_setup_call_retry(retry_key):
        task = setup_call_retry_tasks.pop(retry_key, None)
        if task is not None and not task.done():
            task.cancel()
''',
        '''    main_loop = asyncio.get_event_loop()
    setup_call_retry_tasks = {}
    signalling_reconnect_tasks = {}

    def schedule_setup_call(signalling_client, retry_key, delay=0.0):
        try:
            running_loop = asyncio.get_running_loop()
        except RuntimeError:
            if not main_loop.is_closed():
                main_loop.call_soon_threadsafe(
                    schedule_setup_call,
                    signalling_client,
                    retry_key,
                    delay,
                )
            return None

        if running_loop is not main_loop:
            if not main_loop.is_closed():
                main_loop.call_soon_threadsafe(
                    schedule_setup_call,
                    signalling_client,
                    retry_key,
                    delay,
                )
            return None

        existing_task = setup_call_retry_tasks.get(retry_key)
        if existing_task is not None and not existing_task.done():
            return existing_task

        async def run_setup_call():
            try:
                if delay > 0:
                    await asyncio.sleep(delay)
                await signalling_client.setup_call()
            except Exception as exc:
                logger.warning("setup call for %s failed: %s", retry_key, str(exc))
            finally:
                current_task = setup_call_retry_tasks.get(retry_key)
                if current_task is asyncio.current_task():
                    setup_call_retry_tasks.pop(retry_key, None)

        task = main_loop.create_task(run_setup_call())
        setup_call_retry_tasks[retry_key] = task
        return task

    def clear_setup_call_retry(retry_key):
        task = setup_call_retry_tasks.pop(retry_key, None)
        if task is not None and not task.done():
            task.cancel()

    def schedule_signalling_restart(signalling_client, retry_key, delay=0.0):
        try:
            running_loop = asyncio.get_running_loop()
        except RuntimeError:
            if not main_loop.is_closed():
                main_loop.call_soon_threadsafe(
                    schedule_signalling_restart,
                    signalling_client,
                    retry_key,
                    delay,
                )
            return None

        if running_loop is not main_loop:
            if not main_loop.is_closed():
                main_loop.call_soon_threadsafe(
                    schedule_signalling_restart,
                    signalling_client,
                    retry_key,
                    delay,
                )
            return None

        existing_task = signalling_reconnect_tasks.get(retry_key)
        if existing_task is not None and not existing_task.done():
            return existing_task

        async def run_signalling_restart():
            try:
                if delay > 0:
                    await asyncio.sleep(delay)
                await signalling_client.connect()
                main_loop.create_task(signalling_client.start())
            except Exception as exc:
                logger.warning("signalling restart for %s failed: %s", retry_key, str(exc))
            finally:
                current_task = signalling_reconnect_tasks.get(retry_key)
                if current_task is asyncio.current_task():
                    signalling_reconnect_tasks.pop(retry_key, None)

        task = main_loop.create_task(run_signalling_restart())
        signalling_reconnect_tasks[retry_key] = task
        return task
''',
    )
if "preview_signalling.on_sdp = app.set_sdp" not in contents:
    contents = contents.replace(
        '''    signalling.on_sdp = app.set_sdp
    audio_signalling.on_sdp = audio_app.set_sdp
''',
        '''    signalling.on_sdp = app.set_sdp
    preview_signalling.on_sdp = app.set_sdp
    audio_signalling.on_sdp = audio_app.set_sdp
''',
    )
if "preview_signalling.on_ice = app.set_ice" not in contents:
    contents = contents.replace(
        '''    signalling.on_ice = app.set_ice
    audio_signalling.on_ice = audio_app.set_ice
''',
        '''    signalling.on_ice = app.set_ice
    preview_signalling.on_ice = app.set_ice
    audio_signalling.on_ice = audio_app.set_ice
''',
    )
if "elif str(session_peer_id) == str(preview_peer_id):" not in contents:
    session_handler_start = contents.find(
        '''    def on_session_handler(session_peer_id, meta=None):
'''
    )
    session_handler_end = contents.find(
        '''
    signalling.on_session = on_session_handler
''',
        session_handler_start,
    )
    if session_handler_start < 0 or session_handler_end < 0:
        raise RuntimeError("failed to locate Selkies session handler for preview support")
    contents = (
        contents[:session_handler_start]
        + '''    def on_session_handler(session_peer_id, meta=None):
        logger.info("starting session for peer id {} with meta: {}".format(session_peer_id, meta))
        if str(session_peer_id) == str(peer_id):
            app.on_sdp = signalling.send_sdp
            app.on_ice = signalling.send_ice
            app.stop_pipeline()
            if meta:
                if enable_resize:
                    if meta["res"]:
                        on_resize_handler(meta["res"])
                    if meta["scale"]:
                        on_scaling_ratio_handler(meta["scale"])
                else:
                    logger.info("setting cursor to default size")
                    set_cursor_size(16)
            logger.info("starting video pipeline")
            app.start_pipeline()
        elif str(session_peer_id) == str(preview_peer_id):
            app.on_sdp = preview_signalling.send_sdp
            app.on_ice = preview_signalling.send_ice
            app.stop_pipeline()
            logger.info("starting preview video pipeline")
            app.start_pipeline()
        elif str(session_peer_id) == str(audio_peer_id):
            logger.info("starting audio pipeline")
            audio_app.stop_pipeline()
            audio_app.start_pipeline(audio_only=True)
        else:
            logger.error("failed to start pipeline for peer_id: %s" % peer_id)

'''
        + contents[session_handler_end:]
    )
elif "audio_app.stop_pipeline()" not in contents:
    contents = contents.replace(
        '''            logger.info("starting audio pipeline")
            audio_app.start_pipeline(audio_only=True)''',
        '''            logger.info("starting audio pipeline")
            audio_app.stop_pipeline()
            audio_app.start_pipeline(audio_only=True)''',
    )
if 'clear_setup_call_retry("video")' not in contents:
    contents = contents.replace(
        '''        if str(session_peer_id) == str(peer_id):
            app.on_sdp = signalling.send_sdp
''',
        '''        if str(session_peer_id) == str(peer_id):
            clear_setup_call_retry("video")
            app.on_sdp = signalling.send_sdp
''',
    )
if 'clear_setup_call_retry("preview")' not in contents:
    contents = contents.replace(
        '''        elif str(session_peer_id) == str(preview_peer_id):
            app.on_sdp = preview_signalling.send_sdp
''',
        '''        elif str(session_peer_id) == str(preview_peer_id):
            clear_setup_call_retry("preview")
            app.on_sdp = preview_signalling.send_sdp
''',
    )
if 'clear_setup_call_retry("audio")' not in contents:
    contents = contents.replace(
        '''        elif str(session_peer_id) == str(audio_peer_id):
            logger.info("starting audio pipeline")
''',
        '''        elif str(session_peer_id) == str(audio_peer_id):
            clear_setup_call_retry("audio")
            logger.info("starting audio pipeline")
''',
    )
if "loop.run_until_complete(preview_signalling.connect())" not in contents:
    contents = contents.replace(
        '''            loop.run_until_complete(signalling.connect())
            loop.run_until_complete(audio_signalling.connect())
''',
        '''            loop.run_until_complete(signalling.connect())
            loop.run_until_complete(preview_signalling.connect())
            loop.run_until_complete(audio_signalling.connect())
''',
    )
if "asyncio.ensure_future(preview_signalling.start(), loop=loop)" not in contents:
    contents = contents.replace(
        '''            # asyncio.ensure_future(signalling.start(), loop=loop)
            asyncio.ensure_future(audio_signalling.start(), loop=loop)
            loop.run_until_complete(signalling.start())
''',
        '''            # asyncio.ensure_future(signalling.start(), loop=loop)
            asyncio.ensure_future(preview_signalling.start(), loop=loop)
            asyncio.ensure_future(audio_signalling.start(), loop=loop)
            loop.run_until_complete(signalling.start())
''',
    )
if "preview_signalling.on_session = on_session_handler" not in contents:
    contents = contents.replace(
        '''    signalling.on_session = on_session_handler
    audio_signalling.on_session = on_session_handler
''',
        '''    signalling.on_session = on_session_handler
    preview_signalling.on_session = on_session_handler
    audio_signalling.on_session = on_session_handler
''',
    )
if "preview_app = GSTWebRTCApp(" not in contents:
    contents = contents.replace(
        '''    app = GSTWebRTCApp(stun_servers, turn_servers, audio_channels, curr_fps, args.encoder, gpu_id, curr_video_bitrate, curr_audio_bitrate, keyframe_distance, congestion_control, video_packetloss_percent, audio_packetloss_percent)
    audio_app = GSTWebRTCApp(stun_servers, turn_servers, audio_channels, curr_fps, args.encoder, gpu_id, curr_video_bitrate, curr_audio_bitrate, keyframe_distance, congestion_control, video_packetloss_percent, audio_packetloss_percent)
''',
        '''    app = GSTWebRTCApp(stun_servers, turn_servers, audio_channels, curr_fps, args.encoder, gpu_id, curr_video_bitrate, curr_audio_bitrate, keyframe_distance, congestion_control, video_packetloss_percent, audio_packetloss_percent)
    preview_app = GSTWebRTCApp(stun_servers, turn_servers, audio_channels, curr_fps, args.encoder, gpu_id, curr_video_bitrate, curr_audio_bitrate, keyframe_distance, congestion_control, video_packetloss_percent, audio_packetloss_percent)
    audio_app = GSTWebRTCApp(stun_servers, turn_servers, audio_channels, curr_fps, args.encoder, gpu_id, curr_video_bitrate, curr_audio_bitrate, keyframe_distance, congestion_control, video_packetloss_percent, audio_packetloss_percent)
''',
    )
if "preview_signalling.on_sdp = preview_app.set_sdp" not in contents:
    contents = contents.replace(
        "preview_signalling.on_sdp = app.set_sdp",
        "preview_signalling.on_sdp = preview_app.set_sdp",
    )
if "preview_signalling.on_ice = preview_app.set_ice" not in contents:
    contents = contents.replace(
        "preview_signalling.on_ice = app.set_ice",
        "preview_signalling.on_ice = preview_app.set_ice",
    )
if "preview_signalling.on_disconnect = lambda: preview_app.stop_pipeline()" not in contents:
    contents = contents.replace(
        "preview_signalling.on_disconnect = lambda: app.stop_pipeline()",
        "preview_signalling.on_disconnect = lambda: preview_app.stop_pipeline()",
    )
if "def on_preview_signalling_disconnect():" not in contents:
    contents = contents.replace(
        '''    signalling.on_disconnect = lambda: app.stop_pipeline()
    audio_signalling.on_disconnect = lambda: audio_app.stop_pipeline()
    preview_signalling.on_disconnect = lambda: preview_app.stop_pipeline()
''',
        '''    def on_audio_signalling_disconnect():
        clear_setup_call_retry("audio")
        audio_app.stop_pipeline()
        schedule_signalling_restart(audio_signalling, "audio-signalling", 1.0)

    def on_preview_signalling_disconnect():
        clear_setup_call_retry("preview")
        preview_app.stop_pipeline()
        schedule_signalling_restart(preview_signalling, "preview-signalling", 1.0)

    signalling.on_disconnect = lambda: app.stop_pipeline()
    audio_signalling.on_disconnect = on_audio_signalling_disconnect
    preview_signalling.on_disconnect = on_preview_signalling_disconnect
''',
    )
contents = contents.replace(
    '''    def on_audio_signalling_disconnect():
        clear_setup_call_retry("audio")
        audio_app.stop_pipeline()

    def on_preview_signalling_disconnect():
''',
    '''    def on_audio_signalling_disconnect():
        clear_setup_call_retry("audio")
        audio_app.stop_pipeline()
        schedule_signalling_restart(audio_signalling, "audio-signalling", 1.0)

    def on_preview_signalling_disconnect():
''',
)
contents = contents.replace(
    '''    def on_preview_signalling_disconnect():
        clear_setup_call_retry("preview")
        preview_app.stop_pipeline()

    signalling.on_disconnect = lambda: app.stop_pipeline()
''',
    '''    def on_preview_signalling_disconnect():
        clear_setup_call_retry("preview")
        preview_app.stop_pipeline()
        schedule_signalling_restart(preview_signalling, "preview-signalling", 1.0)

    signalling.on_disconnect = lambda: app.stop_pipeline()
''',
)
contents = contents.replace(
    '''           logger.error("preview signalling error: %s", str(e))
           app.stop_pipeline()''',
    '''           logger.error("preview signalling error: %s", str(e))
           preview_app.stop_pipeline()''',
)
if "preview_app.on_sdp = preview_signalling.send_sdp" not in contents:
    contents = contents.replace(
        '''        elif str(session_peer_id) == str(preview_peer_id):
            clear_setup_call_retry("preview")
            app.on_sdp = preview_signalling.send_sdp
            app.on_ice = preview_signalling.send_ice
            app.stop_pipeline()
            logger.info("starting preview video pipeline")
            app.start_pipeline()''',
        '''        elif str(session_peer_id) == str(preview_peer_id):
            clear_setup_call_retry("preview")
            preview_app.on_sdp = preview_signalling.send_sdp
            preview_app.on_ice = preview_signalling.send_ice
            preview_app.stop_pipeline()
            logger.info("starting preview video pipeline")
            preview_app.start_pipeline()''',
    )
if 'preview_app.on_data_open = lambda: logger.info("opened preview data channel")' not in contents:
    contents = contents.replace(
        '''    app.on_data_open = lambda: data_channel_ready()
''',
        '''    app.on_data_open = lambda: data_channel_ready()
    preview_app.on_data_open = lambda: logger.info("opened preview data channel")
    preview_app.on_data_message = lambda msg: None
''',
    )
contents = contents.replace(
    'preview_app.on_data_close = lambda: (preview_app.stop_pipeline(), schedule_setup_call(preview_signalling, "preview", 1.0))',
    'preview_app.on_data_close = lambda: schedule_setup_call(preview_signalling, "preview", 1.0)',
)
contents = contents.replace(
    'preview_app.on_data_error = lambda: (preview_app.stop_pipeline(), schedule_setup_call(preview_signalling, "preview", 1.0))',
    'preview_app.on_data_error = lambda: schedule_setup_call(preview_signalling, "preview", 1.0)',
)
contents = contents.replace(
    '''    preview_app.on_data_close = lambda: None
    preview_app.on_data_error = lambda: None
''',
    '''    preview_app.on_data_close = lambda: None
    preview_app.on_data_error = lambda: None
''',
)
contents = contents.replace(
    'preview_app.on_data_close = lambda: schedule_setup_call(preview_signalling, "preview", 1.0)',
    'preview_app.on_data_close = lambda: None',
)
contents = contents.replace(
    'preview_app.on_data_error = lambda: schedule_setup_call(preview_signalling, "preview", 1.0)',
    'preview_app.on_data_error = lambda: None',
)
if 'preview_app.on_data_close = lambda: None' not in contents:
    contents = contents.replace(
        '''    preview_app.on_data_open = lambda: logger.info("opened preview data channel")
    preview_app.on_data_message = lambda msg: None
''',
        '''    preview_app.on_data_open = lambda: logger.info("opened preview data channel")
    preview_app.on_data_message = lambda msg: None
    preview_app.on_data_close = lambda: None
    preview_app.on_data_error = lambda: None
''',
    )
if "preview_app.handle_bus_calls()" not in contents:
    contents = contents.replace(
        '''            asyncio.ensure_future(app.handle_bus_calls(), loop=loop)
            asyncio.ensure_future(audio_app.handle_bus_calls(), loop=loop)
''',
        '''            asyncio.ensure_future(app.handle_bus_calls(), loop=loop)
            asyncio.ensure_future(preview_app.handle_bus_calls(), loop=loop)
            asyncio.ensure_future(audio_app.handle_bus_calls(), loop=loop)
''',
    )
if '''            app.stop_pipeline()
            preview_app.stop_pipeline()
            audio_app.stop_pipeline()
            webrtc_input.stop_js_server()
''' not in contents:
    contents = contents.replace(
        '''            app.stop_pipeline()
            audio_app.stop_pipeline()
            webrtc_input.stop_js_server()
''',
        '''            app.stop_pipeline()
            preview_app.stop_pipeline()
            audio_app.stop_pipeline()
            webrtc_input.stop_js_server()
''',
    )
    contents = contents.replace(
        '''    finally:
        app.stop_pipeline()
        audio_app.stop_pipeline()
''',
        '''    finally:
        app.stop_pipeline()
        preview_app.stop_pipeline()
        audio_app.stop_pipeline()
''',
    )
if "if preview_app.webrtcbin:" not in contents:
    contents = contents.replace(
        '''    def mon_rtc_config(stun_servers, turn_servers, rtc_config):
        if app.webrtcbin:
            logger.info("updating STUN server")
            app.webrtcbin.set_property("stun-server", stun_servers[0])
            for i, turn_server in enumerate(turn_servers):
                logger.info("updating TURN server")
                if i == 0:
                    app.webrtcbin.set_property("turn-server", turn_server)
                else:
                    app.webrtcbin.emit("add-turn-server", turn_server)
        server.set_rtc_config(rtc_config)
''',
        '''    def mon_rtc_config(stun_servers, turn_servers, rtc_config):
        for active_app in (app, preview_app):
            if active_app.webrtcbin:
                logger.info("updating STUN server")
                active_app.webrtcbin.set_property("stun-server", stun_servers[0])
                for i, turn_server in enumerate(turn_servers):
                    logger.info("updating TURN server")
                    if i == 0:
                        active_app.webrtcbin.set_property("turn-server", turn_server)
                    else:
                        active_app.webrtcbin.emit("add-turn-server", turn_server)
        server.set_rtc_config(rtc_config)
''',
    )
for auxiliary_signalling_handler_source, auxiliary_signalling_handler_target in (
    (
        '''    async def on_audio_signalling_connect():
       await schedule_setup_call(audio_signalling, "audio")
''',
        '''    async def on_audio_signalling_connect():
       return
''',
    ),
    (
        '''    async def on_preview_signalling_connect():
       await schedule_setup_call(preview_signalling, "preview")
''',
        '''    async def on_preview_signalling_connect():
       return
''',
    ),
    (
        '''    async def on_audio_signalling_error(e):
       if isinstance(e, WebRTCSignallingErrorNoPeer):
           schedule_setup_call(audio_signalling, "audio", 1.5)
       else:
           logger.error("signalling error: %s", str(e))
           audio_app.stop_pipeline()
''',
        '''    async def on_audio_signalling_error(e):
       return
''',
    ),
    (
        '''    async def on_preview_signalling_error(e):
       if isinstance(e, WebRTCSignallingErrorNoPeer):
           schedule_setup_call(preview_signalling, "preview", 1.5)
       else:
           logger.error("preview signalling error: %s", str(e))
           app.stop_pipeline()
''',
        '''    async def on_preview_signalling_error(e):
       return
''',
    ),
    (
        '''    async def on_preview_signalling_error(e):
       if isinstance(e, WebRTCSignallingErrorNoPeer):
           schedule_setup_call(preview_signalling, "preview", 1.5)
       else:
           logger.error("preview signalling error: %s", str(e))
           preview_app.stop_pipeline()
''',
        '''    async def on_preview_signalling_error(e):
       return
''',
    ),
    (
        '''    def on_audio_signalling_disconnect():
        clear_setup_call_retry("audio")
        audio_app.stop_pipeline()
        schedule_signalling_restart(audio_signalling, "audio-signalling", 1.0)
''',
        '''    def on_audio_signalling_disconnect():
        clear_setup_call_retry("audio")
        audio_app.stop_pipeline()
''',
    ),
    (
        '''    def on_preview_signalling_disconnect():
        clear_setup_call_retry("preview")
        preview_app.stop_pipeline()
        schedule_signalling_restart(preview_signalling, "preview-signalling", 1.0)
''',
        '''    def on_preview_signalling_disconnect():
        clear_setup_call_retry("preview")
        preview_app.stop_pipeline()
''',
    ),
):
    contents = contents.replace(
        auxiliary_signalling_handler_source,
        auxiliary_signalling_handler_target,
    )
required_preview_tokens = [
    "preview_peer_id = 11",
    "preview_signalling = WebRTCSignalling",
    "def schedule_setup_call(signalling_client, retry_key, delay=0.0):",
    "def schedule_signalling_restart(signalling_client, retry_key, delay=0.0):",
    'async def on_audio_signalling_connect():\\n       return',
    'async def on_preview_signalling_connect():\\n       return',
    "preview_app = GSTWebRTCApp",
    "def on_preview_signalling_disconnect():",
    "preview_signalling.on_sdp = preview_app.set_sdp",
    "preview_signalling.on_ice = preview_app.set_ice",
    "elif str(session_peer_id) == str(preview_peer_id):",
    'clear_setup_call_retry("preview")',
    "preview_app.on_sdp = preview_signalling.send_sdp",
    "preview_app.on_ice = preview_signalling.send_ice",
    "preview_app.on_data_close = lambda: None",
    "preview_app.handle_bus_calls()",
    "preview_signalling.on_session = on_session_handler",
    "loop.run_until_complete(preview_signalling.connect())",
    "asyncio.ensure_future(preview_signalling.start(), loop=loop)",
]
missing_preview_tokens = [
    token for token in required_preview_tokens if token not in contents
]
if missing_preview_tokens:
    raise RuntimeError(
        "Selkies preview patch is incomplete: " + ", ".join(missing_preview_tokens)
    )
path.write_text(contents)
PY
  fi
  SELKIES_SIGNALING_SERVER_FILE="$SELKIES_INSTALL_DIR/lib/python3.12/site-packages/selkies_gstreamer/signalling_web.py"
  if [ -f "$SELKIES_SIGNALING_SERVER_FILE" ]; then
    python3 - "$SELKIES_SIGNALING_SERVER_FILE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
contents = path.read_text()

peer_reconnect_block = '''        if uid in self.peers:
            logger.warning("Replacing existing peer %r at %r with a new connection from %r", uid, self.peers[uid][1], raddr)
            await self.remove_peer(uid)
'''
if peer_reconnect_block not in contents:
    contents = contents.replace(
        '''        if not uid or uid in self.peers or uid.split() != [uid]: # no whitespace
            await ws.close(code=1002, reason='invalid peer uid')
            raise Exception("Invalid uid {!r} from {!r}".format(uid, raddr))
''',
        '''        if not uid or uid.split() != [uid]: # no whitespace
            await ws.close(code=1002, reason='invalid peer uid')
            raise Exception("Invalid uid {!r} from {!r}".format(uid, raddr))
        if uid in self.peers:
            logger.warning("Replacing existing peer %r at %r with a new connection from %r", uid, self.peers[uid][1], raddr)
            await self.remove_peer(uid)
''',
    )

stale_disconnect_block = '''    async def remove_peer(self, uid, ws=None):
        if uid not in self.peers:
            return
        current_ws, raddr, status, _ = self.peers[uid]
        if ws is not None and current_ws is not ws:
            logger.info("Ignoring stale disconnect for peer %r at %r", uid, raddr)
            return
        await self.cleanup_session(uid)
        if uid in self.peers:
            ws, raddr, status, _ = self.peers[uid]
            if status and status != 'session':
                await self.cleanup_room(uid, status)
            del self.peers[uid]
            await ws.close()
            logger.info("Disconnected from peer {!r} at {!r}".format(uid, raddr))
'''
if stale_disconnect_block not in contents:
    contents = contents.replace(
        '''    async def remove_peer(self, uid):
        await self.cleanup_session(uid)
        if uid in self.peers:
            ws, raddr, status, _ = self.peers[uid]
            if status and status != 'session':
                await self.cleanup_room(uid, status)
            del self.peers[uid]
            await ws.close()
            logger.info("Disconnected from peer {!r} at {!r}".format(uid, raddr))
''',
        stale_disconnect_block,
    )

if "await self.remove_peer(peer_id, ws)" not in contents:
    contents = contents.replace(
        '''                await self.remove_peer(peer_id)
''',
        '''                await self.remove_peer(peer_id, ws)
''',
    )

required_tokens = [
    'logger.warning("Replacing existing peer %r at %r with a new connection from %r", uid, self.peers[uid][1], raddr)',
    "await self.remove_peer(uid)",
    'logger.info("Ignoring stale disconnect for peer %r at %r", uid, raddr)',
    "await self.remove_peer(peer_id, ws)",
]
missing_tokens = [token for token in required_tokens if token not in contents]
if missing_tokens:
    raise RuntimeError(
        "Selkies signalling reconnect patch is incomplete: " + ", ".join(missing_tokens)
    )

path.write_text(contents)
PY
  fi
  SELKIES_SIGNALING_CLIENT_FILE="$SELKIES_INSTALL_DIR/lib/python3.12/site-packages/selkies_gstreamer/webrtc_signalling.py"
  if [ -f "$SELKIES_SIGNALING_CLIENT_FILE" ]; then
    python3 - "$SELKIES_SIGNALING_CLIENT_FILE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
contents = path.read_text()

start_marker = "    async def start(self):\\n"
start_offset = contents.find(start_marker)
if start_offset == -1:
    raise RuntimeError("Unable to locate Selkies signalling start() for disconnect patching")

contents = contents[:start_offset] + '''    async def start(self):
        """Handles messages from the signalling server websocket.

        Message types:
          HELLO: response from server indicating peer is registered.
          ERROR*: error messages from server.
          {"sdp": ...}: JSON SDP message
          {"ice": ...}: JSON ICE message

        Callbacks:

        on_connect: fired when HELLO is received.
        on_session: fired after setup_call() succeeds and SESSION_OK is received.
        on_error(WebRTCSignallingErrorNoPeer): fired when setup_call() fails and peer not found message is received.
        on_error(WebRTCSignallingError): fired when message parsing fails or unexpected message is received.

        """
        try:
            async for message in self.conn:
                if message == 'HELLO':
                    logger.info("connected")
                    await self.on_connect()
                elif message.startswith('SESSION_OK'):
                    toks = message.split()
                    meta = {}
                    if len(toks) > 1:
                        meta = json.loads(base64.b64decode(toks[1]))
                    logger.info("started session with peer: %s, meta: %s", self.peer_id, json.dumps(meta))
                    self.on_session(self.peer_id, (meta))
                elif message.startswith('ERROR'):
                    if message == "ERROR peer '%s' not found" % self.peer_id:
                        await self.on_error(WebRTCSignallingErrorNoPeer("'%s' not found" % self.peer_id))
                    else:
                        await self.on_error(WebRTCSignallingError("unhandled signalling message: %s" % message))
                else:
                    # Attempt to parse JSON SDP or ICE message
                    data = None
                    try:
                        data = json.loads(message)
                    except Exception as e:
                        if isinstance(e, json.decoder.JSONDecodeError):
                            await self.on_error(WebRTCSignallingError("error parsing message as JSON: %s" % message))
                        else:
                            await self.on_error(WebRTCSignallingError("failed to prase message: %s" % message))
                        continue
                    if data.get("sdp", None):
                        logger.info("received SDP")
                        logger.debug("SDP:\\\\n%s" % data["sdp"])
                        self.on_sdp(data['sdp'].get('type'),
                                    data['sdp'].get('sdp'))
                    elif data.get("ice", None):
                        logger.info("received ICE")
                        logger.debug("ICE:\\\\n%s" % data.get("ice"))
                        self.on_ice(data['ice'].get('sdpMLineIndex'),
                                    data['ice'].get('candidate'))
                    else:
                        await self.on_error(WebRTCSignallingError("unhandled JSON message: %s", json.dumps(data)))
        finally:
            self.on_disconnect()
'''

required_tokens = [
    "try:",
    "async for message in self.conn:\\n                if message == 'HELLO':",
    "finally:",
    "self.on_disconnect()",
]
missing_tokens = [token for token in required_tokens if token not in contents]
if missing_tokens:
    raise RuntimeError(
        "Selkies signalling client disconnect patch is incomplete: " + ", ".join(missing_tokens)
    )

path.write_text(contents)
PY
  fi
  SELKIES_GST_APP_FILE="$SELKIES_INSTALL_DIR/lib/python3.12/site-packages/selkies_gstreamer/gstwebrtc_app.py"
  if [ -f "$SELKIES_GST_APP_FILE" ]; then
    python3 - "$SELKIES_GST_APP_FILE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
contents = path.read_text()
contents = contents.replace(
    '''        logger.info("starting pipeline")

        self.pipeline = Gst.Pipeline.new()''',
    '''        logger.info("starting pipeline")
        if self.pipeline is not None or self.webrtcbin is not None:
            logger.info("existing pipeline detected, tearing it down before restart")
            self.stop_pipeline()

        self.pipeline = Gst.Pipeline.new()''',
)
contents = contents.replace(
    '''        if t == Gst.MessageType.EOS:
            logger.error("End-of-stream\\n")
            return False
        elif t == Gst.MessageType.ERROR:
            err, debug = message.parse_error()
            logger.error("Error: %s: %s\\n" % (err, debug))
            return False''',
    '''        if t == Gst.MessageType.EOS:
            logger.error("End-of-stream\\n")
            self.stop_pipeline()
            return True
        elif t == Gst.MessageType.ERROR:
            err, debug = message.parse_error()
            logger.error("Error: %s: %s\\n" % (err, debug))
            error_detail = f"{err} {debug}".lower()
            if self.encoder == "x264enc" and "x264" in error_detail:
                logger.warning("x264enc failed, falling back to vp8enc for the next attempt")
                self.encoder = "vp8enc"
            self.stop_pipeline()
            return True''',
)
contents = contents.replace(
    '''                if (old_state.value_nick == "paused" and new_state.value_nick == "ready"):
                    logger.info("stopping bus message loop")
                    return False''',
    '''                if (old_state.value_nick == "paused" and new_state.value_nick == "ready"):
                    logger.info("pipeline returned to ready state")''',
)
contents = contents.replace(
    '''        # Data channel events
        self.on_data_open = lambda: logger.warn('unhandled on_data_open')
        self.on_data_close = lambda: logger.warn('unhandled on_data_close')
        self.on_data_error = lambda: logger.warn('unhandled on_data_error')
        self.on_data_message = lambda msg: logger.warn(
            'unhandled on_data_message')
''',
    '''        # Data channel events
        self.on_data_open = lambda: logger.warn('unhandled on_data_open')
        self.on_data_close = lambda: logger.warn('unhandled on_data_close')
        self.on_data_error = lambda: logger.warn('unhandled on_data_error')
        self.on_data_message = lambda msg: logger.warn(
            'unhandled on_data_message')
        self._stopping_pipeline = False
''',
)
contents = contents.replace(
    '''    def stop_pipeline(self):
        logger.info("stopping pipeline")
        if self.data_channel:
            self.data_channel.emit('close')
            self.data_channel = None
            logger.info("data channel closed")
        if self.pipeline:
            logger.info("setting pipeline state to NULL")
            self.pipeline.set_state(Gst.State.NULL)
            self.pipeline = None
            logger.info("pipeline set to state NULL")
        if self.webrtcbin:
            self.webrtcbin.set_state(Gst.State.NULL)
            self.webrtcbin = None
            logger.info("webrtcbin set to state NULL")
        logger.info("pipeline stopped")
''',
    '''    def stop_pipeline(self):
        if self._stopping_pipeline:
            logger.info("pipeline stop already in progress")
            return

        self._stopping_pipeline = True
        try:
            logger.info("stopping pipeline")
            if self.data_channel:
                data_channel = self.data_channel
                self.data_channel = None
                data_channel.emit('close')
                logger.info("data channel closed")
            if self.pipeline:
                logger.info("setting pipeline state to NULL")
                self.pipeline.set_state(Gst.State.NULL)
                self.pipeline = None
                logger.info("pipeline set to state NULL")
            if self.webrtcbin:
                self.webrtcbin.set_state(Gst.State.NULL)
                self.webrtcbin = None
                logger.info("webrtcbin set to state NULL")
            logger.info("pipeline stopped")
        finally:
            self._stopping_pipeline = False
''',
)
path.write_text(contents)
PY
  fi
  SELKIES_WEBRTC_INPUT_FILE="$SELKIES_INSTALL_DIR/lib/python3.12/site-packages/selkies_gstreamer/webrtc_input.py"
  if [ -f "$SELKIES_WEBRTC_INPUT_FILE" ]; then
    python3 - "$SELKIES_WEBRTC_INPUT_FILE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
contents = path.read_text()

contents = contents.replace(
    '''        except subprocess.SubprocessError as e:
            logger.warning(f"Error while capturing clipboard: {e}")
''',
    '''        except (subprocess.SubprocessError, OSError) as e:
            logger.warning(f"Error while capturing clipboard: {e}")
''',
)
contents = contents.replace(
    '''        except subprocess.SubprocessError as e:
            logger.warning(f"Error while writing to clipboard: {e}")
            return False
''',
    '''        except (subprocess.SubprocessError, OSError) as e:
            logger.warning(f"Error while writing to clipboard: {e}")
            return False
''',
)

required_tokens = [
    "except (subprocess.SubprocessError, OSError) as e:",
]
missing_tokens = [token for token in required_tokens if token not in contents]
if missing_tokens:
    raise RuntimeError(
        "Selkies clipboard guard patch is incomplete: " + ", ".join(missing_tokens)
    )

path.write_text(contents)
PY
  fi
  SELKIES_APP_FILE="$SELKIES_INSTALL_DIR/share/selkies-web/app.js"
  if [ -f "$SELKIES_APP_FILE" ]; then
    python3 - "$SELKIES_APP_FILE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
contents = path.read_text()

contents = contents.replace('fetch("/turn")', 'fetch("turn")')
contents = contents.replace(
    'var checkconnect = app.status == checkconnect;',
    'var checkconnect = app.status === "checkconnect";',
)

preview_flag = 'var parallaizePreviewMode = new URLSearchParams(window.location.search).get("parallaize_preview") === "1";\\n'
if preview_flag not in contents:
    contents = contents.replace(
        '// Fetch scale local settings\\napp.scaleLocal = app.getBoolParam("scaleLocal", !app.resizeRemote);\\n',
        '// Fetch scale local settings\\napp.scaleLocal = app.getBoolParam("scaleLocal", !app.resizeRemote);\\n' + preview_flag,
    )

peer_id_block = '''var browserVideoPeerId = parallaizePreviewMode ? 11 : 1;
var browserAudioPeerId = parallaizePreviewMode ? 13 : 3;
'''
contents = contents.replace(
    '''var browserVideoPeerId = 1;
var browserAudioPeerId = 3;
''',
    "",
)
if peer_id_block not in contents:
    contents = contents.replace(
        '''var protocol = (location.protocol == "http:" ? "ws://" : "wss://");
''',
        '''var protocol = (location.protocol == "http:" ? "ws://" : "wss://");
var browserVideoPeerId = parallaizePreviewMode ? 11 : 1;
var browserAudioPeerId = parallaizePreviewMode ? 13 : 3;
''',
    )
contents = contents.replace(
    'var webrtc = new WebRTCDemo(signalling, videoElement, 1);',
    'var webrtc = new WebRTCDemo(signalling, videoElement, browserVideoPeerId);',
)

preview_media_block = '''if (parallaizePreviewMode) {
    videoElement.autoplay = true;
    videoElement.muted = true;
    videoElement.playsInline = true;
    audioElement.muted = true;
}
'''
parallaize_media_block = '''videoElement.autoplay = true;
videoElement.muted = true;
videoElement.playsInline = true;
if (parallaizePreviewMode) {
    audioElement.muted = true;
}
'''
contents = contents.replace(
    preview_media_block,
    parallaize_media_block,
)
contents = contents.replace(
    '''videoElement.autoplay = true;
videoElement.playsInline = true;
if (parallaizePreviewMode) {
    audioElement.muted = true;
}
''',
    parallaize_media_block,
)
if parallaize_media_block not in contents:
    contents = contents.replace(
        '''if (audioElement === null) {
    throw 'audioElement not found on page';
}
''',
        '''if (audioElement === null) {
    throw 'audioElement not found on page';
}
''' + parallaize_media_block,
    )
old_parallaize_autoplay_block = '''var parallaizeVideoPlayRetryTimer = null;
function parallaizeMaybeAutoplayVideo(delay = 0) {
    if (parallaizePreviewMode) {
        return;
    }
    if (parallaizeVideoPlayRetryTimer !== null) {
        clearTimeout(parallaizeVideoPlayRetryTimer);
        parallaizeVideoPlayRetryTimer = null;
    }
    const attemptPlay = () => {
        if (parallaizePreviewMode || videoConnected !== "connected" || videoElement.srcObject === null) {
            return;
        }
        const playPromise = videoElement.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                app.showStart = false;
                app.loadingText = "";
            }).catch(() => {
                parallaizeVideoPlayRetryTimer = window.setTimeout(() => {
                    parallaizeVideoPlayRetryTimer = null;
                    parallaizeMaybeAutoplayVideo();
                }, 500);
            });
        }
    };
    if (delay > 0) {
        parallaizeVideoPlayRetryTimer = window.setTimeout(() => {
            parallaizeVideoPlayRetryTimer = null;
            attemptPlay();
        }, delay);
        return;
    }
    attemptPlay();
}

videoElement.addEventListener('loadeddata', (e) => {
    webrtc.input.getCursorScaleFactor();
    parallaizeMaybeAutoplayVideo(50);
})
'''
parallaize_autoplay_block = '''var parallaizeVideoPlayRetryTimer = null;
var parallaizeVideoPlayRetryCount = 0;
var parallaizeDataChannelOpen = false;
var parallaizePendingDataChannelMessages = [];
function parallaizeHasRenderableVideo() {
    return (
        videoElement.srcObject !== null &&
        videoElement.readyState >= 2 &&
        videoElement.videoWidth > 0 &&
        videoElement.videoHeight > 0
    );
}
function parallaizeHasActiveVideoPlayback() {
    return parallaizeHasRenderableVideo() && !videoElement.paused && !videoElement.ended;
}
function parallaizeSyncPlayableStreamState() {
    if (!parallaizeHasRenderableVideo()) {
        return false;
    }
    parallaizeVideoPlayRetryCount = 0;
    app.showStart = false;
    app.loadingText = "";
    app.status = "connected";
    return true;
}
function parallaizeQueueDataChannelMessage(message) {
    if (typeof message !== "string" || message.length === 0 || parallaizePreviewMode) {
        return;
    }
    if (parallaizePendingDataChannelMessages.length >= 64) {
        parallaizePendingDataChannelMessages.shift();
    }
    parallaizePendingDataChannelMessages.push(message);
}
function parallaizeSendDataChannelMessage(message, queueIfUnavailable = true) {
    if (parallaizePreviewMode) {
        return false;
    }
    if (!parallaizeDataChannelOpen) {
        if (queueIfUnavailable) {
            parallaizeQueueDataChannelMessage(message);
        }
        return false;
    }
    try {
        webrtc.sendDataChannelMessage(message);
        return true;
    } catch (err) {
        parallaizeDataChannelOpen = false;
        if (queueIfUnavailable) {
            parallaizeQueueDataChannelMessage(message);
        }
        console.warn("Parallaize control channel send failed", err);
        return false;
    }
}
function parallaizeFlushPendingDataChannelMessages() {
    if (!parallaizeDataChannelOpen || parallaizePendingDataChannelMessages.length === 0) {
        return;
    }
    var pendingMessages = parallaizePendingDataChannelMessages.slice();
    parallaizePendingDataChannelMessages = [];
    for (var index = 0; index < pendingMessages.length; index += 1) {
        try {
            webrtc.sendDataChannelMessage(pendingMessages[index]);
        } catch (err) {
            parallaizeDataChannelOpen = false;
            parallaizePendingDataChannelMessages = pendingMessages.slice(index).concat(
                parallaizePendingDataChannelMessages,
            );
            console.warn("Parallaize control channel flush failed", err);
            return;
        }
    }
}
function parallaizeScheduleAutoplayRetry(delay) {
    if (parallaizeVideoPlayRetryTimer !== null) {
        clearTimeout(parallaizeVideoPlayRetryTimer);
    }
    parallaizeVideoPlayRetryTimer = window.setTimeout(() => {
        parallaizeVideoPlayRetryTimer = null;
        parallaizeMaybeAutoplayVideo();
    }, delay);
}
function parallaizeMaybeAutoplayVideo(delay = 0) {
    if (parallaizePreviewMode) {
        return;
    }
    if (delay > 0) {
        parallaizeScheduleAutoplayRetry(delay);
        return;
    }
    if (videoElement.srcObject === null) {
        if (parallaizeVideoPlayRetryCount < 60) {
            parallaizeVideoPlayRetryCount += 1;
            parallaizeScheduleAutoplayRetry(250);
        }
        return;
    }
    const playPromise = videoElement.play();
    if (playPromise !== undefined) {
        playPromise.then(() => {
            parallaizeSyncPlayableStreamState();
            parallaizeMaybeConnectAudio();
        }).catch(() => {
            if (parallaizeVideoPlayRetryCount < 60) {
                parallaizeVideoPlayRetryCount += 1;
                parallaizeScheduleAutoplayRetry(500);
            }
        });
        return;
    }
    parallaizeSyncPlayableStreamState();
    parallaizeMaybeConnectAudio();
}

videoElement.addEventListener('loadeddata', (e) => {
    webrtc.input.getCursorScaleFactor();
    parallaizeMaybeAutoplayVideo(50);
})
videoElement.addEventListener('playing', () => {
    if (parallaizePreviewMode) {
        return;
    }
    parallaizeSyncPlayableStreamState();
    parallaizeMaybeConnectAudio();
    parallaizeMaybeActivateAudio();
})
'''
contents = contents.replace(old_parallaize_autoplay_block, parallaize_autoplay_block)
if "var parallaizeVideoPlayRetryCount = 0;" not in contents:
    contents = contents.replace(
        '''videoElement.addEventListener('loadeddata', (e) => {
    webrtc.input.getCursorScaleFactor();
})
''',
        parallaize_autoplay_block,
    )

preview_audio_block = '''var audio_signalling = parallaizePreviewMode
    ? {
        disconnect() {},
    }
    : new WebRTCDemoSignalling(new URL(protocol + window.location.host + "/" + app.appName + "/signalling/"));
var audio_webrtc = parallaizePreviewMode
    ? {
        connect() {},
        forceTurn: false,
        getConnectionStats() {
            return Promise.resolve({
                general: {
                    availableReceiveBandwidth: 0,
                    bytesReceived: 0,
                    bytesSent: 0,
                    connectionType: "preview",
                    currentRoundTripTime: null,
                },
                audio: {
                    bytesReceived: 0,
                    codecName: "preview",
                    jitterBufferDelay: 0,
                    jitterBufferEmittedCount: 0,
                    packetsLost: 0,
                    packetsReceived: 0,
                },
                allReports: [],
            });
        },
        playStream() {},
        reset() {},
        rtcPeerConfig: null,
    }
    : new WebRTCDemo(audio_signalling, audioElement, browserAudioPeerId);
'''
if 'connectionType: "preview"' not in contents:
    contents = contents.replace(
        '''var audio_signalling = new WebRTCDemoSignalling(new URL(protocol + window.location.host + "/" + app.appName + "/signalling/"));
var audio_webrtc = new WebRTCDemo(audio_signalling, audioElement, 3);
''',
        preview_audio_block,
    )

if 'var audioConnected = parallaizePreviewMode ? "connected" : "";' not in contents:
    contents = contents.replace(
        'var audioConnected = "";',
        'var audioConnected = parallaizePreviewMode ? "connected" : "";',
    )
if "var parallaizeAudioActivationPending = !parallaizePreviewMode;" not in contents:
    contents = contents.replace(
        'var audioConnected = parallaizePreviewMode ? "connected" : "";',
        '''var audioConnected = parallaizePreviewMode ? "connected" : "";
var parallaizeAudioActivationPending = !parallaizePreviewMode;
var parallaizeAudioConnectRequested = parallaizePreviewMode;
function parallaizeMaybeConnectAudio() {
    if (parallaizePreviewMode || parallaizeAudioConnectRequested) {
        return;
    }
    parallaizeAudioConnectRequested = true;
    audio_webrtc.connect();
}
function parallaizeMaybeActivateAudio() {
    if (parallaizePreviewMode || !parallaizeAudioActivationPending || audioElement.srcObject === null) {
        return;
    }
    const playPromise = audioElement.play();
    if (playPromise !== undefined) {
        playPromise.then(() => {
            parallaizeAudioActivationPending = false;
        }).catch(() => {});
        return;
    }
    parallaizeAudioActivationPending = false;
}
window.addEventListener("pointerdown", parallaizeMaybeActivateAudio, { capture: true });
window.addEventListener("keydown", parallaizeMaybeActivateAudio, { capture: true });
''',
    )
if "var parallaizeAudioConnectRequested = parallaizePreviewMode;" not in contents:
    contents = contents.replace(
        '''var parallaizeAudioActivationPending = !parallaizePreviewMode;
''',
        '''var parallaizeAudioActivationPending = !parallaizePreviewMode;
var parallaizeAudioConnectRequested = parallaizePreviewMode;
function parallaizeMaybeConnectAudio() {
    if (parallaizePreviewMode || parallaizeAudioConnectRequested) {
        return;
    }
    parallaizeAudioConnectRequested = true;
    audio_webrtc.connect();
}
''',
    )

contents = contents.replace(
    '''        webrtc.rtcPeerConfig = config;
        audio_webrtc.rtcPeerConfig = config;
        webrtc.connect();
        audio_webrtc.connect();
''',
    '''        webrtc.rtcPeerConfig = config;
        audio_webrtc.rtcPeerConfig = config;
        webrtc.connect();
''',
)

contents = contents.replace(
    '''signalling.onstatus = (message) => {
    app.loadingText = message;
    app.logEntries.push(applyTimestamp("[signalling] " + message));
};
''',
    '''signalling.onstatus = (message) => {
    if (!parallaizeHasActiveVideoPlayback()) {
        app.loadingText = message;
    }
    app.logEntries.push(applyTimestamp("[signalling] " + message));
};
''',
)

contents = contents.replace(
    '''audio_signalling.onstatus = (message) => {
    app.loadingText = message;
    app.logEntries.push(applyTimestamp("[audio signalling] " + message));
};
''',
    '''audio_signalling.onstatus = (message) => {
    if (!parallaizeHasActiveVideoPlayback()) {
        app.loadingText = message;
    }
    app.logEntries.push(applyTimestamp("[audio signalling] " + message));
};
''',
)

audio_signalling_disconnect_target = '''audio_signalling.ondisconnect = () => {
    console.log("audio signalling disconnected");
    audioConnected = "";
    if (videoConnected === "connected") {
        app.status = "connected";
        app.showStart = false;
        app.loadingText = "";
    }
}
'''
for audio_signalling_disconnect_source in (
    '''audio_signalling.ondisconnect = () => {
    var checkconnect = app.status === "checkconnect";
    // if (app.status !== "connected") return;
    console.log("audio signalling disconnected");
    if (videoConnected === "connected") {
        audioConnected = "";
        app.status = "connected";
        app.showStart = false;
        app.loadingText = "";
        return;
    }
    app.status = 'connecting';
    videoElement.style.cursor = "auto";
    audio_webrtc.reset();
    app.status = 'checkconnect';
}
''',
    '''audio_signalling.ondisconnect = () => {
    var checkconnect = app.status == checkconnect;
    // if (app.status !== "connected") return;
    console.log("audio signalling disconnected");
    app.status = 'connecting';
    videoElement.style.cursor = "auto";
    audio_webrtc.reset();
    app.status = 'checkconnect';
    if (!checkconnect) signalling.disconnect();
}
''',
    '''audio_signalling.ondisconnect = () => {
    var checkconnect = app.status === "checkconnect";
    // if (app.status !== "connected") return;
    console.log("audio signalling disconnected");
    app.status = 'connecting';
    videoElement.style.cursor = "auto";
    audio_webrtc.reset();
    app.status = 'checkconnect';
    if (!checkconnect) signalling.disconnect();
}
''',
):
    contents = contents.replace(
        audio_signalling_disconnect_source,
        audio_signalling_disconnect_target,
    )

contents = contents.replace(
    '''            if (audioConnected === "connected" && !statWatchEnabled) {
                enableStatWatch();
            }
''',
    '''            parallaizeMaybeConnectAudio();
            if (audioConnected === "connected" && !statWatchEnabled) {
                enableStatWatch();
            }
''',
)

contents = contents.replace(
    '''webrtc.onconnectionstatechange = (state) => {
    videoConnected = state;
    if (videoConnected === "connected") {
        // Repeatedly emit minimum latency target
        webrtc.peerConnection.getReceivers().forEach((receiver) => {
            let intervalLoop = setInterval(async () => {
                if (receiver.track.readyState !== "live" || receiver.transport.state !== "connected") {
                    clearInterval(intervalLoop);
                    return;
                } else {
                    receiver.jitterBufferTarget = receiver.jitterBufferDelayHint = receiver.playoutDelayHint = 0;
                }
            }, 15);
        });
    }
    if (videoConnected === "connected" && audioConnected === "connected") {
        app.status = state;
        if (!statWatchEnabled) {
            enableStatWatch();
        }
    } else {
        app.status = state === "connected" ? audioConnected : videoConnected;
    }
};
''',
    '''webrtc.onconnectionstatechange = (state) => {
    videoConnected = state;
    if (videoConnected === "connected") {
        webrtc.playStream();
        parallaizeMaybeAutoplayVideo(50);
        app.status = "connected";
        if (parallaizePreviewMode) {
            app.showStart = false;
        }
        app.loadingText = "";
        if (!parallaizePreviewMode) {
            // Repeatedly emit minimum latency target
            webrtc.peerConnection.getReceivers().forEach((receiver) => {
                let intervalLoop = setInterval(async () => {
                    if (receiver.track.readyState !== "live" || receiver.transport.state !== "connected") {
                        clearInterval(intervalLoop);
                        return;
                    } else {
                        receiver.jitterBufferTarget = receiver.jitterBufferDelayHint = receiver.playoutDelayHint = 0;
                    }
                }, 15);
            });
            if (parallaizeBackgroundMode) {
                parallaizeApplyBackgroundStreamProfile();
            }
            parallaizeMaybeConnectAudio();
            if (audioConnected === "connected" && !statWatchEnabled) {
                enableStatWatch();
            }
        }
    } else {
        if (parallaizeVideoPlayRetryTimer !== null) {
            clearTimeout(parallaizeVideoPlayRetryTimer);
            parallaizeVideoPlayRetryTimer = null;
        }
        parallaizeVideoPlayRetryCount = 0;
        app.status = videoConnected;
    }
};
''',
)
contents = contents.replace(
    '''webrtc.onconnectionstatechange = (state) => {
    videoConnected = state;
    if (videoConnected === "connected") {
        if (parallaizePreviewMode) {
            webrtc.playStream();
        }
        app.status = "connected";
        app.showStart = false;
        app.loadingText = "";
        if (!parallaizePreviewMode) {
            // Repeatedly emit minimum latency target
            webrtc.peerConnection.getReceivers().forEach((receiver) => {
                let intervalLoop = setInterval(async () => {
                    if (receiver.track.readyState !== "live" || receiver.transport.state !== "connected") {
                        clearInterval(intervalLoop);
                        return;
                    } else {
                        receiver.jitterBufferTarget = receiver.jitterBufferDelayHint = receiver.playoutDelayHint = 0;
                    }
                }, 15);
            });
            if (parallaizeBackgroundMode) {
                parallaizeApplyBackgroundStreamProfile();
            }
            if (audioConnected === "connected" && !statWatchEnabled) {
                enableStatWatch();
            }
        }
    } else {
        app.status = videoConnected;
    }
};
''',
    '''webrtc.onconnectionstatechange = (state) => {
    videoConnected = state;
    if (videoConnected === "connected") {
        webrtc.playStream();
        parallaizeMaybeAutoplayVideo(50);
        app.status = "connected";
        if (parallaizePreviewMode) {
            app.showStart = false;
        }
        app.loadingText = "";
        if (!parallaizePreviewMode) {
            // Repeatedly emit minimum latency target
            webrtc.peerConnection.getReceivers().forEach((receiver) => {
                let intervalLoop = setInterval(async () => {
                    if (receiver.track.readyState !== "live" || receiver.transport.state !== "connected") {
                        clearInterval(intervalLoop);
                        return;
                    } else {
                        receiver.jitterBufferTarget = receiver.jitterBufferDelayHint = receiver.playoutDelayHint = 0;
                    }
                }, 15);
            });
            if (audioConnected === "connected" && !statWatchEnabled) {
                enableStatWatch();
            }
        }
    } else {
        if (parallaizeVideoPlayRetryTimer !== null) {
            clearTimeout(parallaizeVideoPlayRetryTimer);
            parallaizeVideoPlayRetryTimer = null;
        }
        parallaizeVideoPlayRetryCount = 0;
        app.status = videoConnected;
    }
};
''',
)

contents = contents.replace(
    '''audio_webrtc.onconnectionstatechange = (state) => {
    audioConnected = state;
    if (audioConnected === "connected") {
        // Repeatedly emit minimum latency target
        audio_webrtc.peerConnection.getReceivers().forEach((receiver) => {
            let intervalLoop = setInterval(async () => {
                if (receiver.track.readyState !== "live" || receiver.transport.state !== "connected") {
                    clearInterval(intervalLoop);
                    return;
                } else {
                    receiver.jitterBufferTarget = receiver.jitterBufferDelayHint = receiver.playoutDelayHint = 0;
                }
            }, 15);
        });
    }
    if (audioConnected === "connected" && videoConnected === "connected") {
        app.status = state;
        if (!statWatchEnabled) {
            enableStatWatch();
        }
    } else {
        app.status = state === "connected" ? videoConnected : audioConnected;
    }
};
''',
    '''audio_webrtc.onconnectionstatechange = (state) => {
    audioConnected = state;
    if (audioConnected === "connected") {
        if (!parallaizePreviewMode) {
            // Repeatedly emit minimum latency target
            audio_webrtc.peerConnection.getReceivers().forEach((receiver) => {
                let intervalLoop = setInterval(async () => {
                    if (receiver.track.readyState !== "live" || receiver.transport.state !== "connected") {
                        clearInterval(intervalLoop);
                        return;
                    } else {
                        receiver.jitterBufferTarget = receiver.jitterBufferDelayHint = receiver.playoutDelayHint = 0;
                    }
                }, 15);
            });
        }
    }
    if (videoConnected === "connected") {
        app.status = "connected";
        app.loadingText = "";
        if (!parallaizePreviewMode && audioConnected === "connected" && !statWatchEnabled) {
            enableStatWatch();
        }
    } else {
        app.status = videoConnected;
    }
};
''',
)

if 'if (!parallaizePreviewMode) {\\n                audio_webrtc.playStream();\\n            }' not in contents:
    contents = contents.replace(
        '''        playStream() {
            webrtc.playStream();
            audio_webrtc.playStream();
            this.showStart = false;
        },
''',
        '''        playStream() {
            webrtc.playStream();
            if (!parallaizePreviewMode) {
                audio_webrtc.playStream();
            }
            this.showStart = false;
        },
''',
    )

if 'if (parallaizePreviewMode) {\\n        return;\\n    }' not in contents:
    contents = contents.replace(
        '''webrtc.ondatachannelopen = () => {
    // Bind gamepad connected handler.
''',
        '''webrtc.ondatachannelopen = () => {
    if (parallaizePreviewMode) {
        return;
    }
    parallaizeDataChannelOpen = true;
    parallaizeSyncStreamScale(true);
    if (parallaizeBackgroundMode) {
        parallaizeApplyBackgroundStreamProfile();
    }
    parallaizeFlushPendingDataChannelMessages();
    // Bind gamepad connected handler.
''',
    )

if 'webrtc.ondatachannelclose = () => {\\n    if (!parallaizePreviewMode) {' not in contents:
    contents = contents.replace(
        '''webrtc.ondatachannelclose = () => {
    webrtc.input.detach();
}
''',
        '''webrtc.ondatachannelclose = () => {
    parallaizeDataChannelOpen = false;
    if (!parallaizePreviewMode) {
        webrtc.input.detach();
    }
}
''',
    )

if 'webrtc.onplaystreamrequired = () => {\\n    if (parallaizePreviewMode) {' not in contents:
    contents = contents.replace(
        '''webrtc.onplaystreamrequired = () => {
    app.showStart = true;
}
''',
        '''webrtc.onplaystreamrequired = () => {
    if (parallaizePreviewMode) {
        webrtc.playStream();
        app.showStart = false;
        return;
    }
    parallaizeMaybeAutoplayVideo(250);
    app.showStart = true;
}
''',
    )
contents = contents.replace(
    '''webrtc.onplaystreamrequired = () => {
    if (parallaizePreviewMode) {
        webrtc.playStream();
        app.showStart = false;
        return;
    }
    app.showStart = true;
}
''',
    '''webrtc.onplaystreamrequired = () => {
    if (parallaizePreviewMode) {
        webrtc.playStream();
        app.showStart = false;
        return;
    }
    parallaizeMaybeAutoplayVideo(250);
    app.showStart = true;
}
''',
)

if 'audio_webrtc.onplaystreamrequired = () => {\\n    if (parallaizePreviewMode || videoConnected === "connected" || parallaizeHasActiveVideoPlayback()) {' not in contents:
    contents = contents.replace(
        '''audio_webrtc.onplaystreamrequired = () => {
    app.showStart = true;
}
''',
        '''audio_webrtc.onplaystreamrequired = () => {
    if (parallaizePreviewMode || videoConnected === "connected" || parallaizeHasActiveVideoPlayback()) {
        app.showStart = false;
        return;
    }
    app.showStart = true;
}
''',
    )
    contents = contents.replace(
        '''audio_webrtc.onplaystreamrequired = () => {
    if (parallaizePreviewMode) {
        webrtc.playStream();
        app.showStart = false;
        return;
    }
    app.showStart = true;
}
''',
        '''audio_webrtc.onplaystreamrequired = () => {
    if (parallaizePreviewMode || videoConnected === "connected" || parallaizeHasActiveVideoPlayback()) {
        app.showStart = false;
        return;
    }
    app.showStart = true;
}
''',
    )
    contents = contents.replace(
        '''audio_webrtc.onplaystreamrequired = () => {
    if (parallaizePreviewMode) {
        webrtc.playStream();
        app.showStart = false;
        return;
    }
    parallaizeMaybeAutoplayVideo(250);
    app.showStart = true;
}
''',
        '''audio_webrtc.onplaystreamrequired = () => {
    if (parallaizePreviewMode || videoConnected === "connected" || parallaizeHasActiveVideoPlayback()) {
        app.showStart = false;
        return;
    }
    app.showStart = true;
}
''',
    )
    contents = contents.replace(
        '''audio_webrtc.onplaystreamrequired = () => {
    if (parallaizePreviewMode) {
        return;
    }
    app.showStart = true;
}
''',
        '''audio_webrtc.onplaystreamrequired = () => {
    if (parallaizePreviewMode || videoConnected === "connected" || parallaizeHasActiveVideoPlayback()) {
        app.showStart = false;
        return;
    }
    app.showStart = true;
}
''',
    )

if 'function shutdownSelkiesStream() {' not in contents:
    contents = contents.replace(
        '''audio_webrtc.onplaystreamrequired = () => {
    if (parallaizePreviewMode || videoConnected === "connected" || parallaizeHasActiveVideoPlayback()) {
        app.showStart = false;
        return;
    }
    app.showStart = true;
}
''',
        '''audio_webrtc.onplaystreamrequired = () => {
    if (parallaizePreviewMode || videoConnected === "connected" || parallaizeHasActiveVideoPlayback()) {
        app.showStart = false;
        return;
    }
    app.showStart = true;
}

var parallaizeBackgroundMode = false;
var parallaizeBackgroundRestoreProfile = null;
function parallaizeApplyTransientStreamProfile(profile) {
    if (typeof profile.videoBitRate === "number") {
        parallaizeSendDataChannelMessage('vb,' + profile.videoBitRate);
    }
    if (typeof profile.videoFramerate === "number") {
        parallaizeSendDataChannelMessage('_arg_fps,' + profile.videoFramerate);
    }
    if (typeof profile.audioBitRate === "number") {
        parallaizeSendDataChannelMessage('ab,' + profile.audioBitRate);
    }
}
function parallaizeApplyBackgroundStreamProfile() {
    audioElement.muted = true;
    try {
        audioElement.pause();
    } catch (error) {
        console.warn("failed to pause background audio cleanly", error);
    }
    parallaizeApplyTransientStreamProfile({
        audioBitRate: 24000,
        videoBitRate: 1500,
        videoFramerate: 15,
    });
}
function parallaizeSetBackgroundMode(background) {
    if (parallaizePreviewMode) {
        return;
    }
    if (background) {
        if (!parallaizeBackgroundMode) {
            parallaizeBackgroundRestoreProfile = {
                audioBitRate: app.audioBitRate,
                audioMuted: audioElement.muted,
                videoBitRate: app.videoBitRate,
                videoFramerate: app.videoFramerate,
            };
        }
        parallaizeBackgroundMode = true;
        parallaizeApplyBackgroundStreamProfile();
        return;
    }
    if (!parallaizeBackgroundMode) {
        return;
    }
    parallaizeBackgroundMode = false;
    const restoreProfile = parallaizeBackgroundRestoreProfile;
    parallaizeBackgroundRestoreProfile = null;
    if (!restoreProfile) {
        return;
    }
    audioElement.muted = restoreProfile.audioMuted;
    parallaizeApplyTransientStreamProfile(restoreProfile);
    parallaizeMaybeConnectAudio();
    parallaizeMaybeActivateAudio();
}
window.parallaizeSetBackgroundMode = parallaizeSetBackgroundMode;

var parallaizeStreamClosing = false;
function shutdownSelkiesStream() {
    if (parallaizeStreamClosing) {
        return;
    }
    parallaizeStreamClosing = true;
    if ("ondisconnect" in signalling) {
        signalling.ondisconnect = null;
    }
    if ("onconnectionstatechange" in webrtc) {
        webrtc.onconnectionstatechange = null;
    }
    if ("connect" in signalling) {
        signalling.connect = () => {};
    }
    if ("connect" in webrtc) {
        webrtc.connect = () => {};
    }
    if ("_retryTimer" in signalling && signalling._retryTimer !== null) {
        clearTimeout(signalling._retryTimer);
        signalling._retryTimer = null;
    }
    if ("_reconnectTimer" in webrtc && webrtc._reconnectTimer !== null) {
        clearTimeout(webrtc._reconnectTimer);
        webrtc._reconnectTimer = null;
    }
    try {
        if ("shutdown" in signalling) {
            signalling.shutdown();
        } else {
            signalling.disconnect();
        }
    } catch (error) {
        console.warn("failed to close signalling cleanly", error);
    }
    if (webrtc.peerConnection !== null) {
        webrtc.peerConnection.close();
    }
    if (!parallaizePreviewMode) {
        if ("ondisconnect" in audio_signalling) {
            audio_signalling.ondisconnect = null;
        }
        if ("onconnectionstatechange" in audio_webrtc) {
            audio_webrtc.onconnectionstatechange = null;
        }
        if ("connect" in audio_signalling) {
            audio_signalling.connect = () => {};
        }
        if ("connect" in audio_webrtc) {
            audio_webrtc.connect = () => {};
        }
        if ("_retryTimer" in audio_signalling && audio_signalling._retryTimer !== null) {
            clearTimeout(audio_signalling._retryTimer);
            audio_signalling._retryTimer = null;
        }
        if ("_reconnectTimer" in audio_webrtc && audio_webrtc._reconnectTimer !== null) {
            clearTimeout(audio_webrtc._reconnectTimer);
            audio_webrtc._reconnectTimer = null;
        }
        try {
            if ("shutdown" in audio_signalling) {
                audio_signalling.shutdown();
            } else {
                audio_signalling.disconnect();
            }
        } catch (error) {
            console.warn("failed to close audio signalling cleanly", error);
        }
        if (audio_webrtc.peerConnection !== null) {
            audio_webrtc.peerConnection.close();
        }
    }
}
window.addEventListener("pagehide", shutdownSelkiesStream);
window.addEventListener("beforeunload", shutdownSelkiesStream);
''',
    )

if 'function parallaizeSetBackgroundMode(background) {' not in contents:
    contents = contents.replace(
        '''var parallaizeStreamClosing = false;
''',
        '''var parallaizeBackgroundMode = false;
var parallaizeBackgroundRestoreProfile = null;
function parallaizeApplyTransientStreamProfile(profile) {
    if (typeof profile.videoBitRate === "number") {
        parallaizeSendDataChannelMessage('vb,' + profile.videoBitRate);
    }
    if (typeof profile.videoFramerate === "number") {
        parallaizeSendDataChannelMessage('_arg_fps,' + profile.videoFramerate);
    }
    if (typeof profile.audioBitRate === "number") {
        parallaizeSendDataChannelMessage('ab,' + profile.audioBitRate);
    }
}
function parallaizeApplyBackgroundStreamProfile() {
    audioElement.muted = true;
    try {
        audioElement.pause();
    } catch (error) {
        console.warn("failed to pause background audio cleanly", error);
    }
    parallaizeApplyTransientStreamProfile({
        audioBitRate: 24000,
        videoBitRate: 1500,
        videoFramerate: 15,
    });
}
function parallaizeSetBackgroundMode(background) {
    if (parallaizePreviewMode) {
        return;
    }
    if (background) {
        if (!parallaizeBackgroundMode) {
            parallaizeBackgroundRestoreProfile = {
                audioBitRate: app.audioBitRate,
                audioMuted: audioElement.muted,
                videoBitRate: app.videoBitRate,
                videoFramerate: app.videoFramerate,
            };
        }
        parallaizeBackgroundMode = true;
        parallaizeApplyBackgroundStreamProfile();
        return;
    }
    if (!parallaizeBackgroundMode) {
        return;
    }
    parallaizeBackgroundMode = false;
    const restoreProfile = parallaizeBackgroundRestoreProfile;
    parallaizeBackgroundRestoreProfile = null;
    if (!restoreProfile) {
        return;
    }
    audioElement.muted = restoreProfile.audioMuted;
    parallaizeApplyTransientStreamProfile(restoreProfile);
    parallaizeMaybeConnectAudio();
    parallaizeMaybeActivateAudio();
}
window.parallaizeSetBackgroundMode = parallaizeSetBackgroundMode;

var parallaizeStreamClosing = false;
''',
    )

if 'function freezeParallaizePreviewFrame() {' not in contents:
    contents = contents.replace(
        '''window.addEventListener("pagehide", shutdownSelkiesStream);
window.addEventListener("beforeunload", shutdownSelkiesStream);
''',
        '''window.addEventListener("pagehide", shutdownSelkiesStream);
window.addEventListener("beforeunload", shutdownSelkiesStream);

var parallaizePreviewFrameFrozen = false;
var parallaizePreviewCanvas = null;
function freezeParallaizePreviewFrame() {
    if (!parallaizePreviewMode || parallaizePreviewFrameFrozen) {
        return;
    }
    if (videoElement.readyState < 2 || videoElement.videoWidth <= 0 || videoElement.videoHeight <= 0) {
        return;
    }
    if (parallaizePreviewCanvas === null) {
        parallaizePreviewCanvas = document.createElement("canvas");
        parallaizePreviewCanvas.style.width = "100%";
        parallaizePreviewCanvas.style.height = "100%";
        parallaizePreviewCanvas.style.display = "block";
        parallaizePreviewCanvas.style.background = "#040608";
        if (videoElement.parentElement !== null) {
            videoElement.parentElement.insertBefore(parallaizePreviewCanvas, videoElement.nextSibling);
        } else {
            document.body.appendChild(parallaizePreviewCanvas);
        }
    }
    parallaizePreviewCanvas.width = videoElement.videoWidth;
    parallaizePreviewCanvas.height = videoElement.videoHeight;
    var previewContext = parallaizePreviewCanvas.getContext("2d");
    if (previewContext === null) {
        return;
    }
    previewContext.drawImage(
        videoElement,
        0,
        0,
        parallaizePreviewCanvas.width,
        parallaizePreviewCanvas.height,
    );
    parallaizePreviewFrameFrozen = true;
    console.log("Parallaize preview frame frozen");
    videoElement.style.display = "none";
    shutdownSelkiesStream();
}
if (parallaizePreviewMode) {
    var armParallaizePreviewFreeze = () => {
        if (parallaizePreviewFrameFrozen) {
            return;
        }
        if ("requestVideoFrameCallback" in videoElement) {
            videoElement.requestVideoFrameCallback(() => {
                console.log("Parallaize preview frame callback ready");
                window.setTimeout(freezeParallaizePreviewFrame, 0);
            });
            return;
        }
        console.log("Parallaize preview frame fallback ready");
        window.setTimeout(freezeParallaizePreviewFrame, 120);
    };
    videoElement.addEventListener("loadeddata", armParallaizePreviewFreeze);
    videoElement.addEventListener("playing", armParallaizePreviewFreeze);
}
''',
    )

if 'webrtc.input.onresizeend = () => {\\n    if (parallaizePreviewMode || app.resizeRemote !== true) {' not in contents:
    contents = contents.replace(
        '''webrtc.input.onresizeend = () => {
    app.windowResolution = webrtc.input.getWindowResolution();
    var newRes = parseInt(app.windowResolution[0]) + "x" + parseInt(app.windowResolution[1]);
    console.log(\`Window size changed: \${app.windowResolution[0]}x\${app.windowResolution[1]}, scaled to: \${newRes}\`);
    webrtc.sendDataChannelMessage("r," + newRes);
    webrtc.sendDataChannelMessage("s," + window.devicePixelRatio);
}
''',
        '''webrtc.input.onresizeend = () => {
    if (parallaizePreviewMode || app.resizeRemote !== true) {
        return;
    }
    parallaizeSyncStreamScale(true);
}
''',
    )

if 'window.parallaizeWriteGuestClipboard = (text) => {' not in contents:
    contents = contents.replace(
        '''// Actions to take whenever window changes focus
window.addEventListener('focus', () => {
    // reset keyboard to avoid stuck keys.
    webrtc.sendDataChannelMessage("kr");

    // Send clipboard contents.
    navigator.clipboard.readText()
        .then(text => {
            webrtc.sendDataChannelMessage("cw," + stringToBase64(text))
        })
        .catch(err => {
            webrtc._setStatus('Failed to read clipboard contents: ' + err);
        });
});
window.addEventListener('blur', () => {
    // reset keyboard to avoid stuck keys.
    webrtc.sendDataChannelMessage("kr");
});

webrtc.onclipboardcontent = (content) => {
    if (app.clipboardStatus === 'enabled') {
        navigator.clipboard.writeText(content)
            .catch(err => {
                webrtc._setStatus('Could not copy text to clipboard: ' + err);
        });
    }
}
''',
        '''// Actions to take whenever window changes focus
var parallaizeRequestedStreamScale = null;
var parallaizeGuestClipboardListeners = new Set();
function parallaizeNotifyGuestClipboardListeners(content) {
    parallaizeGuestClipboardListeners.forEach((listener) => {
        try {
            listener(content);
        } catch (err) {
            console.error('Parallaize clipboard listener failed', err);
        }
    });
}
function parallaizeSendClipboardMessage(message) {
    return parallaizeSendDataChannelMessage(message);
}
function parallaizeResolveStreamScale() {
    var scale =
        Number.isFinite(parallaizeRequestedStreamScale) && parallaizeRequestedStreamScale > 0
            ? parallaizeRequestedStreamScale
            : window.devicePixelRatio;
    if (!Number.isFinite(scale) || scale <= 0) {
        return 1;
    }
    return Math.round(scale * 100) / 100;
}
function parallaizeApplyStreamPixelation() {
    var streamScale = parallaizeResolveStreamScale();
    var devicePixelRatio =
        Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
            ? window.devicePixelRatio
            : 1;
    var pixelated = streamScale + 0.01 < devicePixelRatio;
    if (
        document &&
        document.head &&
        !document.getElementById("parallaize-stream-pixelation-style")
    ) {
        var styleElement = document.createElement("style");
        styleElement.id = "parallaize-stream-pixelation-style";
        styleElement.textContent =
            ':root[data-parallaize-stream-pixelated="true"] video, :root[data-parallaize-stream-pixelated="true"] canvas, :root[data-parallaize-stream-pixelated="true"] .video { image-rendering: crisp-edges; image-rendering: pixelated; }';
        document.head.appendChild(styleElement);
    }
    if (document && document.documentElement) {
        document.documentElement.dataset.parallaizeStreamPixelated = pixelated ? "true" : "false";
    }
    return pixelated;
}
function parallaizeSyncStreamScale(sendResolution = true) {
    if (parallaizePreviewMode || app.resizeRemote !== true) {
        return false;
    }
    try {
        app.windowResolution = webrtc.input.getWindowResolution();
        if (sendResolution) {
            var newRes = parseInt(app.windowResolution[0]) + "x" + parseInt(app.windowResolution[1]);
            console.log(\`Window size changed: \${app.windowResolution[0]}x\${app.windowResolution[1]}, scaled to: \${newRes} @ \${parallaizeResolveStreamScale()}\`);
            parallaizeSendDataChannelMessage("r," + newRes);
        }
        parallaizeSendDataChannelMessage("s," + parallaizeResolveStreamScale());
        parallaizeApplyStreamPixelation();
        return true;
    } catch (err) {
        console.warn('Parallaize could not update stream scale', err);
        return false;
    }
}
window.parallaizeWriteGuestClipboard = (text) => {
    if (typeof text !== 'string') {
        return false;
    }
    return parallaizeSendClipboardMessage("cw," + stringToBase64(text));
};
window.parallaizeRequestGuestClipboard = () => {
    return parallaizeSendClipboardMessage("cr");
};
window.parallaizeGetStreamScale = () => {
    return parallaizeResolveStreamScale();
};
window.parallaizeSetStreamScale = (scale) => {
    var nextScale = Number(scale);
    if (!Number.isFinite(nextScale) || nextScale <= 0) {
        return false;
    }
    parallaizeRequestedStreamScale = Math.round(nextScale * 100) / 100;
    return parallaizeSyncStreamScale(true);
};
window.parallaizeTriggerGuestPaste = () => {
    if (!parallaizeSendClipboardMessage("kd,65507")) {
        return false;
    }
    parallaizeSendClipboardMessage("kd,118");
    parallaizeSendClipboardMessage("ku,118");
    parallaizeSendClipboardMessage("ku,65507");
    return true;
};
window.parallaizeSubscribeGuestClipboard = (listener) => {
    if (typeof listener !== 'function') {
        return () => {};
    }
    parallaizeGuestClipboardListeners.add(listener);
    return () => {
        parallaizeGuestClipboardListeners.delete(listener);
    };
};
window.parallaizeGetStreamState = () => {
    const activeVideoPlayback = parallaizeHasActiveVideoPlayback();
    return {
        ready: activeVideoPlayback && !app.showStart,
        status:
            typeof app.loadingText === 'string' && app.loadingText.length > 0
                ? app.loadingText
                : app.status,
    };
};
window.parallaizeKickStream = (reason = 'manual') => {
    if (parallaizePreviewMode) {
        return false;
    }
    const normalizedReason =
        typeof reason === 'string' && reason.length > 0
            ? reason
            : 'manual';
    if (parallaizeVideoPlayRetryTimer !== null) {
        clearTimeout(parallaizeVideoPlayRetryTimer);
        parallaizeVideoPlayRetryTimer = null;
    }
    parallaizeVideoPlayRetryCount = 0;
    parallaizeDataChannelOpen = false;
    parallaizePendingDataChannelMessages = [];
    videoElement.style.cursor = "auto";
    app.showStart = false;
    app.status = "connecting";
    app.loadingText = "Reconnecting stream.";
    if (Array.isArray(app.logEntries)) {
        app.logEntries.push(
            applyTimestamp("[parallaize] kicking stream: " + normalizedReason),
        );
    }
    try {
        if (
            signalling &&
            signalling._ws_conn !== null &&
            signalling._ws_conn !== undefined &&
            typeof signalling.disconnect === "function"
        ) {
            signalling.disconnect();
            return true;
        }
    } catch {
        // fall through to direct WebRTC reset
    }
    try {
        if (typeof webrtc.reset === "function" && webrtc.peerConnection !== null) {
            webrtc.reset();
            return true;
        }
    } catch {
        // fall through to direct connect
    }
    try {
        if (typeof webrtc.connect === "function") {
            webrtc.connect();
            return true;
        }
    } catch {
        return false;
    }
    return false;
};
window.addEventListener('focus', () => {
    // reset keyboard to avoid stuck keys.
    parallaizeSendDataChannelMessage("kr");

    // Send clipboard contents.
    navigator.clipboard.readText()
        .then(text => {
            parallaizeSendClipboardMessage("cw," + stringToBase64(text))
        })
        .catch(err => {
            webrtc._setStatus('Failed to read clipboard contents: ' + err);
        });
});
window.addEventListener('blur', () => {
    // reset keyboard to avoid stuck keys.
    parallaizeSendDataChannelMessage("kr");
});

webrtc.onclipboardcontent = (content) => {
    parallaizeNotifyGuestClipboardListeners(content);
    if (app.clipboardStatus === 'enabled') {
        navigator.clipboard.writeText(content)
            .catch(err => {
                webrtc._setStatus('Could not copy text to clipboard: ' + err);
        });
    }
}
''',
    )

old_cursor_patch_start = contents.find(
    '''function parallaizeReadCursorPngDimensions(curdata) {
'''
)
if old_cursor_patch_start >= 0:
    old_cursor_patch_end = contents.find(
        '''
webrtc.onsystemaction = (action) => {
''',
        old_cursor_patch_start,
    )
    if old_cursor_patch_end < 0:
        raise RuntimeError("failed to locate Selkies cursor patch block")
    contents = (
        contents[:old_cursor_patch_start]
        + '''webrtc.oncursorchange = (handle, curdata, hotspot, override) => {
    if (parseInt(handle) === 0) {
        videoElement.style.cursor = "auto";
        return;
    }
    if (override) {
        videoElement.style.cursor = override;
        return;
    }
    if (!webrtc.cursor_cache.has(handle)) {
        // Add cursor to cache.
        const cursor_url = "url('data:image/png;base64," + curdata + "')";
        webrtc.cursor_cache.set(handle, cursor_url);
    }
    var cursor_url = webrtc.cursor_cache.get(handle);
    if (hotspot) {
        cursor_url += " " + hotspot.x + " " + hotspot.y + ", auto";
    } else {
        cursor_url += ", auto";
    }
    videoElement.style.cursor = cursor_url;
}
'''
        + contents[old_cursor_patch_end:]
    )

path.write_text(contents)
PY
  fi
  SELKIES_SIGNALING_FILE="$SELKIES_INSTALL_DIR/share/selkies-web/signalling.js"
  if [ -f "$SELKIES_SIGNALING_FILE" ]; then
    python3 - "$SELKIES_SIGNALING_FILE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
contents = path.read_text()

contents = contents.replace(
    '        this.peer_id = 1;',
    '        this.peer_id = new URLSearchParams(window.location.search).get("parallaize_preview") === "1" ? 11 : 1;',
)
if '        this._retryTimer = null;' not in contents:
    contents = contents.replace(
        '''        this.retry_count = 0;
''',
        '''        this.retry_count = 0;

        /**
         * @type {number | null}
         */
        this._retryTimer = null;

        /**
         * @type {boolean}
         */
        this._suppressDisconnect = false;
''',
    )
contents = contents.replace(
    '''        this.state = 'connected';
        this._ws_conn.send('HELLO ' + this.peer_id + ' ' + btoa(JSON.stringify(meta)));
''',
    '''        this.state = 'connected';
        this._suppressDisconnect = false;
        if (this._retryTimer !== null) {
            clearTimeout(this._retryTimer);
            this._retryTimer = null;
        }
        this._ws_conn.send('HELLO ' + this.peer_id + ' ' + btoa(JSON.stringify(meta)));
''',
)
contents = contents.replace(
    '''        this._setStatus("Connection error, retry in 3 seconds.");
        this.retry_count++;
        if (this._ws_conn.readyState === this._ws_conn.CLOSED) {
            setTimeout(() => {
                if (this.retry_count > 3) {
                    window.location.replace(window.location.href.replace(window.location.pathname, "/"));
                } else {
                    this.connect();
                }
            }, 3000);
        }
''',
    '''        this._setStatus("Connection error, retrying.");
        this.retry_count++;
        if (this._ws_conn.readyState === this._ws_conn.CLOSED) {
            setTimeout(() => {
                if (this.retry_count > 3) {
                    this.retry_count = 0;
                }
                this.connect();
            }, 500);
        }
''',
)
contents = contents.replace(
    '''        this._setStatus("Connection error, retrying.");
        this.retry_count++;
        if (this._ws_conn.readyState === this._ws_conn.CLOSED) {
            setTimeout(() => {
                if (this.retry_count > 3) {
                    this.retry_count = 0;
                }
                this.connect();
            }, 500);
        }
''',
    '''        if (this._suppressDisconnect) {
            return;
        }
        this._setStatus("Connection error, retrying.");
        this.retry_count++;
        if (this._retryTimer !== null) {
            return;
        }
        if (this._ws_conn.readyState === this._ws_conn.CLOSED) {
            this._retryTimer = setTimeout(() => {
                this._retryTimer = null;
                if (this.retry_count > 3) {
                    this.retry_count = 0;
                }
                this.connect();
            }, 1500);
        }
''',
)
contents = contents.replace(
    '''    _onServerClose() {
        if (this.state !== 'connecting') {
            this.state = 'disconnected';
            this._setError("Server closed connection.");
            if (this.ondisconnect !== null) this.ondisconnect();
        }
    }
''',
    '''    _onServerClose() {
        this._ws_conn = null;
        if (this._suppressDisconnect) {
            this.state = 'disconnected';
            return;
        }
        if (this.state !== 'connecting') {
            this.state = 'disconnected';
            this._setError("Server closed connection.");
            if (this.ondisconnect !== null) this.ondisconnect();
        }
    }
''',
)
contents = contents.replace(
    '''    connect() {
        this.state = 'connecting';
        this._setStatus("Connecting to server.");
''',
    '''    connect() {
        if (this._retryTimer !== null) {
            clearTimeout(this._retryTimer);
            this._retryTimer = null;
        }
        this._suppressDisconnect = false;
        if (this._ws_conn !== null &&
            (this._ws_conn.readyState === WebSocket.OPEN ||
             this._ws_conn.readyState === WebSocket.CONNECTING)) {
            return;
        }
        this.state = 'connecting';
        this._setStatus("Connecting to server.");
''',
)
contents = contents.replace(
    '''    disconnect() {
        this._ws_conn.close();
    }
''',
    '''    disconnect() {
        this._suppressDisconnect = false;
        if (this._ws_conn !== null) {
            this._ws_conn.close();
        }
    }

    shutdown() {
        this._suppressDisconnect = true;
        if (this._retryTimer !== null) {
            clearTimeout(this._retryTimer);
            this._retryTimer = null;
        }
        if (this._ws_conn !== null) {
            this._ws_conn.close();
        }
    }
''',
)

path.write_text(contents)
PY
  fi
  SELKIES_WEBRTC_FILE="$SELKIES_INSTALL_DIR/share/selkies-web/webrtc.js"
  if [ -f "$SELKIES_WEBRTC_FILE" ]; then
    python3 - "$SELKIES_WEBRTC_FILE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
contents = path.read_text()

if '        this._reconnectTimer = null;' not in contents:
    contents = contents.replace(
        '''        this.onclipboardcontent = null;

        /**
         * @type {function}
         */
        this.onsystemaction = null;
''',
        '''        this.onclipboardcontent = null;

        /**
         * @type {number | null}
         */
        this._reconnectTimer = null;

        /**
         * @type {function}
         */
        this.onsystemaction = null;
''',
    )
contents = contents.replace(
    '''    connect() {
        // Create the peer connection object and bind callbacks.
''',
    '''    connect() {
        if (this._reconnectTimer !== null) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
        // Create the peer connection object and bind callbacks.
''',
)
contents = contents.replace(
    '''        var signalState = this.peerConnection.signalingState;
''',
    '''        var signalState = this.peerConnection !== null ? this.peerConnection.signalingState : "closed";
''',
)
contents = contents.replace(
    '''        if (signalState !== "stable") {
            setTimeout(() => {
                this.connect();
            }, 3000);
        } else {
            this.connect();
        }
''',
    '''        if (this._reconnectTimer !== null) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }

        if (signalState !== "stable" && signalState !== "closed") {
            this._reconnectTimer = setTimeout(() => {
                this._reconnectTimer = null;
                this.connect();
            }, 1000);
        } else {
            this.connect();
        }
''',
)
contents = contents.replace(
    '''        if (signalState !== "stable") {
            setTimeout(() => {
                this.connect();
            }, 250);
        } else {
            this.connect();
        }
''',
    '''        if (this._reconnectTimer !== null) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }

        if (signalState !== "stable" && signalState !== "closed") {
            this._reconnectTimer = setTimeout(() => {
                this._reconnectTimer = null;
                this.connect();
            }, 1000);
        } else {
            this.connect();
        }
''',
)

path.write_text(contents)
PY
  fi
  SELKIES_INDEX_FILE="$SELKIES_INSTALL_DIR/share/selkies-web/index.html"
  if [ -f "$SELKIES_INDEX_FILE" ]; then
    python3 - "$SELKIES_INDEX_FILE" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
contents = path.read_text()

launcher_button_pattern = re.compile(
    r'(?:^|\\n)[ \\t]*<v-tooltip bottom>\\n'
    r'[ \\t]*<template v-slot:activator="\\{ on \\}">\\n'
    r'[ \\t]*<v-btn icon href="/">\\n'
    r'[ \\t]*<v-icon color="black" v-on="on">home</v-icon>\\n'
    r'[ \\t]*</v-btn>\\n'
    r'[ \\t]*</template>\\n'
    r'[ \\t]*<span>Return to launcher</span>\\n'
    r'[ \\t]*</v-tooltip>\\n',
)

contents, replaced = launcher_button_pattern.subn("\\n", contents, count=1)

if replaced > 1:
    raise RuntimeError("Selkies launcher button patch removed multiple toolbar blocks unexpectedly")

if 'href="/"' in contents and "Return to launcher" in contents:
    raise RuntimeError("Selkies launcher button patch did not remove the launcher shortcut")

path.write_text(contents)
PY
  fi
}
validate_selkies_bundle() {
  python3 - "$SELKIES_INSTALL_DIR/share/selkies-web/app.js" "$SELKIES_INSTALL_DIR/share/selkies-web/signalling.js" "$SELKIES_INSTALL_DIR/share/selkies-web/index.html" <<'PY'
from pathlib import Path
import re
import sys

app_path = Path(sys.argv[1])
signalling_path = Path(sys.argv[2])
index_path = Path(sys.argv[3])
app_contents = app_path.read_text()
signalling_contents = signalling_path.read_text()
index_contents = index_path.read_text()

required_app_tokens = [
    "window.parallaizeGetStreamState = () => {",
    "window.parallaizeKickStream = (reason = 'manual') => {",
    "window.parallaizeSetStreamScale = (scale) => {",
    "window.parallaizeSetBackgroundMode = parallaizeSetBackgroundMode;",
    "var parallaizeGuestClipboardListeners = new Set();",
    "function parallaizeApplyStreamPixelation() {",
    "function parallaizeHasActiveVideoPlayback() {",
    "function parallaizeSendDataChannelMessage(message, queueIfUnavailable = true) {",
    ':root[data-parallaize-stream-pixelated="true"] .video { image-rendering: crisp-edges; image-rendering: pixelated; }',
    "function parallaizeMaybeConnectAudio() {",
]
required_signalling_tokens = [
    'this._setStatus("Connection error, retrying.");',
    "this._retryTimer = null;",
    "this._suppressDisconnect = false;",
]

errors = []
for token in required_app_tokens:
    if token not in app_contents:
        errors.append(f"app.js missing token: {token}")
for token in required_signalling_tokens:
    if token not in signalling_contents:
        errors.append(f"signalling.js missing token: {token}")

if app_contents.count("window.parallaizeGetStreamState = () => {") != 1:
    errors.append("app.js contains duplicated stream-state bridge")
if app_contents.count("window.parallaizeKickStream = (reason = 'manual') => {") != 1:
    errors.append("app.js contains duplicated kick-stream bridge")
if re.search(r"(?:\\n[ \\t]*parallaizeMaybeConnectAudio\\(\\);){2,}", app_contents):
    errors.append("app.js contains duplicated audio-connect insertions")
if 'href="/"' in index_contents and "Return to launcher" in index_contents:
    errors.append("index.html still contains the launcher shortcut")

if errors:
    raise SystemExit("; ".join(errors))
PY
}
ensure_selkies_bundle() {
  SELKIES_VERSION="v${DEFAULT_GUEST_SELKIES_VERSION}"
  SELKIES_PATCH_LEVEL="${DEFAULT_GUEST_SELKIES_PATCH_LEVEL}"
  SELKIES_PARENT_DIR="/opt/parallaize"
  SELKIES_INSTALL_DIR="$SELKIES_PARENT_DIR/selkies-gstreamer"
  SELKIES_CACHE_DIR="/var/cache/parallaize/selkies"
  SELKIES_ARCHIVE_URL="${DEFAULT_GUEST_SELKIES_ARCHIVE_URL}"
  SELKIES_ARCHIVE_FILE="$SELKIES_CACHE_DIR/\${SELKIES_VERSION}.tar.gz"
  SELKIES_VERSION_FILE="$SELKIES_INSTALL_DIR/.parallaize-selkies-version"
  SELKIES_PATCH_LEVEL_FILE="$SELKIES_INSTALL_DIR/.parallaize-selkies-patch-level"
  CURRENT_SELKIES_VERSION="$(cat "$SELKIES_VERSION_FILE" 2>/dev/null || true)"
  CURRENT_SELKIES_PATCH_LEVEL="$(cat "$SELKIES_PATCH_LEVEL_FILE" 2>/dev/null || true)"
  if [ "$CURRENT_SELKIES_VERSION" = "$SELKIES_VERSION" ] && [ "$CURRENT_SELKIES_PATCH_LEVEL" = "$SELKIES_PATCH_LEVEL" ] && [ -x "$SELKIES_INSTALL_DIR/bin/selkies-gstreamer-run" ] && [ -f "$SELKIES_INSTALL_DIR/share/selkies-web/app.js" ] && [ -f "$SELKIES_INSTALL_DIR/share/selkies-web/signalling.js" ]; then
    if validate_selkies_bundle; then
      return 0
    fi
    echo "Selkies bundle validation failed, reinstalling runtime from a clean archive." >&2
  elif [ "$CURRENT_SELKIES_VERSION" = "$SELKIES_VERSION" ] && [ -x "$SELKIES_INSTALL_DIR/bin/selkies-gstreamer-run" ] && [ -f "$SELKIES_INSTALL_DIR/share/selkies-web/app.js" ]; then
    echo "Selkies patch-level drift detected, reinstalling runtime from a clean archive." >&2
  fi
  mkdir -p "$SELKIES_CACHE_DIR" "$SELKIES_PARENT_DIR"
  if [ ! -f "$SELKIES_ARCHIVE_FILE" ]; then
    TEMP_ARCHIVE="$SELKIES_ARCHIVE_FILE.tmp"
    rm -f "$TEMP_ARCHIVE"
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL --connect-timeout 20 --max-time 900 "$SELKIES_ARCHIVE_URL" -o "$TEMP_ARCHIVE"
    elif command -v wget >/dev/null 2>&1; then
      wget -q -T 900 -O "$TEMP_ARCHIVE" "$SELKIES_ARCHIVE_URL"
    else
      echo "curl or wget is required to download Selkies." >&2
      return 1
    fi
    mv "$TEMP_ARCHIVE" "$SELKIES_ARCHIVE_FILE"
  fi
  TEMP_DIR="$(mktemp -d)"
  tar -xzf "$SELKIES_ARCHIVE_FILE" -C "$TEMP_DIR"
  if [ ! -d "$TEMP_DIR/selkies-gstreamer" ]; then
    rm -rf "$TEMP_DIR"
    echo "Selkies archive did not contain the expected selkies-gstreamer directory." >&2
    return 1
  fi
  rm -rf "$SELKIES_INSTALL_DIR"
  mv "$TEMP_DIR/selkies-gstreamer" "$SELKIES_INSTALL_DIR"
  rm -rf "$TEMP_DIR"
  if [ -x "$SELKIES_INSTALL_DIR/bin/conda-unpack" ]; then
    "$SELKIES_INSTALL_DIR/bin/conda-unpack" >/dev/null 2>&1 || true
  fi
  patch_selkies_bundle
  validate_selkies_bundle
  printf '%s\\n' "$SELKIES_VERSION" > "$SELKIES_VERSION_FILE"
  printf '%s\\n' "$SELKIES_PATCH_LEVEL" > "$SELKIES_PATCH_LEVEL_FILE"
  chmod -R a+rX "$SELKIES_INSTALL_DIR"
  RESTART_DESKTOP=1
}`;
}

function buildGuestDesktopSessionSetupScript(vmName?: string): string {
  const wallpaperUrl = buildGuestWallpaperUrl(vmName);
  return `#!/bin/sh
set -eu
DASH_TO_DOCK_SCHEMA="org.gnome.shell.extensions.dash-to-dock"
BACKGROUND_SCHEMA="org.gnome.desktop.background"
SESSION_SCHEMA="org.gnome.desktop.session"
POWER_SCHEMA="org.gnome.settings-daemon.plugins.power"
WALLPAPER_NAME="${DEFAULT_GUEST_WALLPAPER}"
WALLPAPER_REMOTE_URL="${wallpaperUrl ?? ""}"
WALLPAPER_ROOTS="/usr/share/backgrounds /usr/share/gnome-background-properties"
PARALLAIZE_CONFIG_DIR="\${XDG_CONFIG_HOME:-$HOME/.config}/parallaize"
WALLPAPER_DOWNLOAD_DIR="$PARALLAIZE_CONFIG_DIR/wallpapers"
WALLPAPER_DOWNLOAD_FILE="$WALLPAPER_DOWNLOAD_DIR/initial-wallpaper.jpg"
WALLPAPER_DOWNLOAD_TEMP="$WALLPAPER_DOWNLOAD_DIR/initial-wallpaper.jpg.tmp"
WALLPAPER_MARKER_FILE="$PARALLAIZE_CONFIG_DIR/desktop-wallpaper-initialized"
WALLPAPER_STATE_FILE="$PARALLAIZE_CONFIG_DIR/desktop-wallpaper-source"
RESOLVED_WALLPAPER_URI=""
RESOLVED_WALLPAPER_STATE=""
set_dash_to_dock_defaults() {
  gsettings set "$DASH_TO_DOCK_SCHEMA" dock-position RIGHT >/dev/null 2>&1 || true
  gsettings set "$DASH_TO_DOCK_SCHEMA" dash-max-icon-size 32 >/dev/null 2>&1 || true
}
set_power_defaults() {
  gsettings set "$SESSION_SCHEMA" idle-delay 'uint32 0' >/dev/null 2>&1 || true
  gsettings set "$POWER_SCHEMA" sleep-inactive-ac-type 'nothing' >/dev/null 2>&1 || true
  gsettings set "$POWER_SCHEMA" sleep-inactive-ac-timeout 'uint32 0' >/dev/null 2>&1 || true
  gsettings set "$POWER_SCHEMA" sleep-inactive-battery-type 'nothing' >/dev/null 2>&1 || true
  gsettings set "$POWER_SCHEMA" sleep-inactive-battery-timeout 'uint32 0' >/dev/null 2>&1 || true
}
find_named_wallpaper() {
  find $WALLPAPER_ROOTS -type f -name "$WALLPAPER_NAME" 2>/dev/null \
    | sort \
    | head -n 1
}
download_remote_wallpaper() {
  if [ -z "$WALLPAPER_REMOTE_URL" ]; then
    return 1
  fi
  mkdir -p "$WALLPAPER_DOWNLOAD_DIR"
  rm -f "$WALLPAPER_DOWNLOAD_TEMP"
  if command -v curl >/dev/null 2>&1; then
    if curl -fsSL --connect-timeout 10 --max-time 60 "$WALLPAPER_REMOTE_URL" -o "$WALLPAPER_DOWNLOAD_TEMP"; then
      mv "$WALLPAPER_DOWNLOAD_TEMP" "$WALLPAPER_DOWNLOAD_FILE"
      printf '%s\\n' "$WALLPAPER_DOWNLOAD_FILE"
      return 0
    fi
  elif command -v wget >/dev/null 2>&1; then
    if wget -q -T 60 -O "$WALLPAPER_DOWNLOAD_TEMP" "$WALLPAPER_REMOTE_URL"; then
      mv "$WALLPAPER_DOWNLOAD_TEMP" "$WALLPAPER_DOWNLOAD_FILE"
      printf '%s\\n' "$WALLPAPER_DOWNLOAD_FILE"
      return 0
    fi
  fi
  rm -f "$WALLPAPER_DOWNLOAD_TEMP"
  return 1
}
resolve_first_boot_wallpaper_uri() {
  downloaded_wallpaper="$(download_remote_wallpaper || true)"
  if [ -n "$downloaded_wallpaper" ] && [ -f "$downloaded_wallpaper" ]; then
    RESOLVED_WALLPAPER_URI="file://$downloaded_wallpaper"
    RESOLVED_WALLPAPER_STATE="remote:$WALLPAPER_REMOTE_URL"
    return 0
  fi
  fallback_wallpaper="$(find_named_wallpaper || true)"
  if [ -n "$fallback_wallpaper" ]; then
    RESOLVED_WALLPAPER_URI="file://$fallback_wallpaper"
    RESOLVED_WALLPAPER_STATE="named:$WALLPAPER_NAME"
    return 0
  fi

  RESOLVED_WALLPAPER_URI=""
  RESOLVED_WALLPAPER_STATE=""
  return 1
}
apply_first_boot_wallpaper() {
  desired_wallpaper_state="named:$WALLPAPER_NAME"
  if [ -n "$WALLPAPER_REMOTE_URL" ]; then
    desired_wallpaper_state="remote:$WALLPAPER_REMOTE_URL"
  fi
  current_wallpaper_state="$(cat "$WALLPAPER_STATE_FILE" 2>/dev/null || true)"
  if [ -f "$WALLPAPER_MARKER_FILE" ] && [ "$current_wallpaper_state" = "$desired_wallpaper_state" ]; then
    return 0
  fi
  mkdir -p "$PARALLAIZE_CONFIG_DIR"
  resolve_first_boot_wallpaper_uri || true
  if [ -n "$RESOLVED_WALLPAPER_URI" ]; then
    gsettings set "$BACKGROUND_SCHEMA" picture-uri "$RESOLVED_WALLPAPER_URI" >/dev/null 2>&1 || true
    gsettings set "$BACKGROUND_SCHEMA" picture-uri-dark "$RESOLVED_WALLPAPER_URI" >/dev/null 2>&1 || true
    gsettings set "$BACKGROUND_SCHEMA" picture-options zoom >/dev/null 2>&1 || true
    printf '%s\\n' "$RESOLVED_WALLPAPER_STATE" > "$WALLPAPER_STATE_FILE"
  fi
  : > "$WALLPAPER_MARKER_FILE"
}
ensure_indicator_multiload() {
  if ! command -v indicator-multiload >/dev/null 2>&1; then
    return 0
  fi
  if pgrep -u "$(id -u)" -x indicator-multiload >/dev/null 2>&1; then
    return 0
  fi
  nohup indicator-multiload >/dev/null 2>&1 &
}
set_dash_to_dock_defaults
set_power_defaults
apply_first_boot_wallpaper
ensure_indicator_multiload`;
}

function buildGuestDesktopSessionAutostartEntry(): string {
  return `[Desktop Entry]
Type=Application
Version=1.0
Name=Parallaize Desktop Session Setup
Comment=Apply Parallaize Ubuntu desktop defaults for dashboard-launched workspaces
Exec=/usr/local/bin/parallaize-desktop-session-setup
OnlyShowIn=GNOME;Ubuntu;
X-GNOME-Autostart-enabled=true
NoDisplay=true`;
}

function buildGuestRenderingEnvironmentConfig(): string {
  return `# Force GNOME onto software rendering so the guest X11 framebuffer stays
# readable to x11vnc on newer Ubuntu desktop images.
LIBGL_ALWAYS_SOFTWARE=1
GALLIUM_DRIVER=llvmpipe`;
}

function resolveGuestDesktopBootstrapRepairTimings(
  repairProfile: GuestDesktopBootstrapRepairProfile,
): { healthGraceSeconds: number; gdmRestartCooldownSeconds: number } {
  if (repairProfile === "aggressive") {
    return {
      healthGraceSeconds: AGGRESSIVE_GUEST_DESKTOP_HEALTH_GRACE_SECONDS,
      gdmRestartCooldownSeconds: AGGRESSIVE_GUEST_DESKTOP_GDM_RESTART_COOLDOWN_SECONDS,
    };
  }

  return {
    healthGraceSeconds: DEFAULT_GUEST_DESKTOP_HEALTH_GRACE_SECONDS,
    gdmRestartCooldownSeconds: DEFAULT_GUEST_DESKTOP_GDM_RESTART_COOLDOWN_SECONDS,
  };
}

export function buildGuestWallpaperUrl(vmName?: string): string | null {
  const slug = typeof vmName === "string" ? slugify(vmName) : "";

  if (!slug) {
    return null;
  }

  return `${DEFAULT_GUEST_WALLPAPER_BASE_URL}/${slug}.jpg`;
}

export function resolveGuestHostname(vmName?: string): string | null {
  const normalized =
    typeof vmName === "string"
      ? vmName
          .trim()
          .normalize("NFKD")
          .replace(/[^\x00-\x7F]+/g, "")
          .toLowerCase()
      : "";
  const hostname = normalized
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/^-+|-+$/g, "");

  return hostname || null;
}

function buildGuestDesktopBootstrapScript(
  port: number,
  vmName?: string,
  repairProfile: GuestDesktopBootstrapRepairProfile = "standard",
  transport: VmDesktopTransport = "vnc",
  selkiesPort: number = DEFAULT_GUEST_SELKIES_PORT,
  selkiesRtcConfig: GuestSelkiesRtcConfig | null = null,
  vmId?: string,
  streamHealthToken?: string | null,
  controlPlanePort = 3000,
): string {
  const runtime = resolveDesktopTransportRuntime(transport);
  const repairTimings = resolveGuestDesktopBootstrapRepairTimings(repairProfile);
  const resetDisplayStateOnRepair = repairProfile === "aggressive";
  const desiredDesktopBridgeVersion = JSON.stringify(
    buildExpectedGuestDesktopBridgeVersionRecord(transport),
    null,
    2,
  );
  const desktopServiceName =
    runtime === "selkies" ? "parallaize-selkies.service" : "parallaize-x11vnc.service";
  const launcherFile =
    runtime === "selkies"
      ? "/usr/local/bin/parallaize-selkies"
      : "/usr/local/bin/parallaize-x11vnc";
  const serviceFile = `/etc/systemd/system/${desktopServiceName}`;
  const desiredLauncher =
    runtime === "selkies"
      ? buildGuestSelkiesLauncherScript(selkiesPort, selkiesRtcConfig)
      : buildGuestVncLauncherScript(port);
  const desiredService =
    runtime === "selkies"
      ? buildGuestSelkiesServiceUnit()
      : buildGuestVncServiceUnit();
  const streamHealthEnabled =
    runtime === "selkies" &&
    typeof vmId === "string" &&
    vmId.length > 0 &&
    typeof streamHealthToken === "string" &&
    streamHealthToken.length > 0;
  const streamHealthScriptFile = "/usr/local/bin/parallaize-selkies-heartbeat";
  const streamHealthServiceName = "parallaize-selkies-heartbeat.service";
  const streamHealthServiceFile = `/etc/systemd/system/${streamHealthServiceName}`;
  const desiredStreamHealthScript =
    streamHealthEnabled && vmId && streamHealthToken
      ? buildGuestSelkiesStreamHealthScript(
          vmId,
          streamHealthToken,
          controlPlanePort,
          selkiesPort,
        )
      : "";
  const desiredStreamHealthService = streamHealthEnabled
    ? buildGuestSelkiesStreamHealthServiceUnit()
    : "";
  const desktopPackageChecks =
    runtime === "selkies"
      ? `if ! command -v xrandr >/dev/null 2>&1 || ! command -v cvt >/dev/null 2>&1; then
  MISSING_PACKAGES="$MISSING_PACKAGES x11-xserver-utils"
fi
if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
  MISSING_PACKAGES="$MISSING_PACKAGES curl"
fi
if ! command -v import >/dev/null 2>&1; then
  MISSING_PACKAGES="$MISSING_PACKAGES imagemagick"
fi
if ! command -v xsel >/dev/null 2>&1; then
  MISSING_PACKAGES="$MISSING_PACKAGES xsel"
fi
if ! python3 -c 'import websockets' >/dev/null 2>&1; then
  MISSING_PACKAGES="$MISSING_PACKAGES python3-websockets"
fi
${buildGuestSelkiesInstallScript()}`
      : `if ! command -v x11vnc >/dev/null 2>&1; then
  MISSING_PACKAGES="$MISSING_PACKAGES x11vnc"
fi
if ! command -v import >/dev/null 2>&1; then
  MISSING_PACKAGES="$MISSING_PACKAGES imagemagick"
fi`;
  const desktopInstallStep =
    runtime === "selkies" ? "ensure_selkies_bundle" : "";

  return `#!/bin/sh
set -eu
GDM_FILE="/etc/gdm3/custom.conf"
DESKTOP_SERVICE_NAME="${desktopServiceName}"
LAUNCHER_FILE="${launcherFile}"
SERVICE_FILE="${serviceFile}"
STREAM_HEALTH_SERVICE_NAME="${streamHealthServiceName}"
STREAM_HEALTH_SCRIPT_FILE="${streamHealthScriptFile}"
STREAM_HEALTH_SERVICE_FILE="${streamHealthServiceFile}"
RENDERING_ENV_FILE="/etc/environment.d/90-parallaize-rendering.conf"
SESSION_HEALTH_FILE="${DEFAULT_GUEST_DESKTOP_HEALTH_CHECK}"
SESSION_SETUP_FILE="/usr/local/bin/parallaize-desktop-session-setup"
SESSION_AUTOSTART_FILE="/etc/xdg/autostart/parallaize-desktop-session-setup.desktop"
REPAIR_STATE_DIR="/var/lib/parallaize"
DESKTOP_BRIDGE_VERSION_FILE="${DEFAULT_GUEST_DESKTOP_BRIDGE_VERSION_FILE}"
DESKTOP_HEALTH_PENDING_FILE="$REPAIR_STATE_DIR/desktop-session-unhealthy-at"
DESKTOP_GDM_RESTART_FILE="$REPAIR_STATE_DIR/desktop-session-last-gdm-restart"
RESET_DISPLAY_STATE_ON_REPAIR=${resetDisplayStateOnRepair ? 1 : 0}
GUEST_MONITORS_FILE="${DEFAULT_GUEST_HOME}/.config/monitors.xml"
GDM_MONITORS_FILE="/var/lib/gdm3/.config/monitors.xml"
DESKTOP_HEALTH_GRACE_SECONDS=${repairTimings.healthGraceSeconds}
DESKTOP_GDM_RESTART_COOLDOWN_SECONDS=${repairTimings.gdmRestartCooldownSeconds}
NETWORK_WAIT_ONLINE_OVERRIDE_FILE="/etc/systemd/system/systemd-networkd-wait-online.service.d/10-parallaize.conf"
PLYMOUTH_QUIT_WAIT_OVERRIDE_FILE="/etc/systemd/system/plymouth-quit-wait.service.d/10-parallaize.conf"
WELCOME_STATE_DIR="${DEFAULT_GUEST_HOME}/.config"
WELCOME_DONE_FILE="$WELCOME_STATE_DIR/gnome-initial-setup-done"
WELCOME_AUTOSTART_DIR="$WELCOME_STATE_DIR/autostart"
WELCOME_AUTOSTART_FILE="$WELCOME_AUTOSTART_DIR/gnome-initial-setup-first-login.desktop"
CURRENT_GDM="$(cat "$GDM_FILE" 2>/dev/null || true)"
DESIRED_GDM="$(cat <<'CONF'
${buildGuestGdmCustomConfig()}
CONF
)"
CURRENT_LAUNCHER="$(cat "$LAUNCHER_FILE" 2>/dev/null || true)"
DESIRED_LAUNCHER="$(cat <<'SCRIPT'
${desiredLauncher}
SCRIPT
)"
CURRENT_SERVICE="$(cat "$SERVICE_FILE" 2>/dev/null || true)"
DESIRED_SERVICE="$(cat <<'UNIT'
${desiredService}
UNIT
)"
CURRENT_STREAM_HEALTH_SCRIPT="$(cat "$STREAM_HEALTH_SCRIPT_FILE" 2>/dev/null || true)"
DESIRED_STREAM_HEALTH_SCRIPT="$(cat <<'SCRIPT'
${desiredStreamHealthScript}
SCRIPT
)"
CURRENT_STREAM_HEALTH_SERVICE="$(cat "$STREAM_HEALTH_SERVICE_FILE" 2>/dev/null || true)"
DESIRED_STREAM_HEALTH_SERVICE="$(cat <<'UNIT'
${desiredStreamHealthService}
UNIT
)"
CURRENT_RENDERING_ENV="$(cat "$RENDERING_ENV_FILE" 2>/dev/null || true)"
DESIRED_RENDERING_ENV="$(cat <<'ENV'
${buildGuestRenderingEnvironmentConfig()}
ENV
)"
CURRENT_SESSION_HEALTH="$(cat "$SESSION_HEALTH_FILE" 2>/dev/null || true)"
DESIRED_SESSION_HEALTH="$(cat <<'SCRIPT'
${buildGuestDesktopHealthCheckScript()}
SCRIPT
)"
CURRENT_SESSION_SETUP="$(cat "$SESSION_SETUP_FILE" 2>/dev/null || true)"
DESIRED_SESSION_SETUP="$(cat <<'SCRIPT'
${buildGuestDesktopSessionSetupScript(vmName)}
SCRIPT
)"
CURRENT_SESSION_AUTOSTART="$(cat "$SESSION_AUTOSTART_FILE" 2>/dev/null || true)"
DESIRED_SESSION_AUTOSTART="$(cat <<'DESKTOP'
${buildGuestDesktopSessionAutostartEntry()}
DESKTOP
)"
CURRENT_NETWORK_WAIT_ONLINE_OVERRIDE="$(cat "$NETWORK_WAIT_ONLINE_OVERRIDE_FILE" 2>/dev/null || true)"
DESIRED_NETWORK_WAIT_ONLINE_OVERRIDE="$(cat <<'CONF'
${buildGuestNetworkWaitOnlineOverride()}
CONF
)"
CURRENT_PLYMOUTH_QUIT_WAIT_OVERRIDE="$(cat "$PLYMOUTH_QUIT_WAIT_OVERRIDE_FILE" 2>/dev/null || true)"
DESIRED_PLYMOUTH_QUIT_WAIT_OVERRIDE="$(cat <<'CONF'
${buildGuestPlymouthQuitWaitOverride()}
CONF
)"
CURRENT_DESKTOP_BRIDGE_VERSION="$(cat "$DESKTOP_BRIDGE_VERSION_FILE" 2>/dev/null || true)"
DESIRED_DESKTOP_BRIDGE_VERSION="$(cat <<'JSON'
${desiredDesktopBridgeVersion}
JSON
)"
DESIRED_WELCOME_AUTOSTART="$(cat <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=GNOME Initial Setup
Hidden=true
X-GNOME-Autostart-enabled=false
DESKTOP
)"
RESTART_GDM=0
RESTART_DESKTOP=0
RESTART_STREAM_HEALTH=0
RESTART_WAIT_ONLINE=0
STOP_PLYMOUTH_QUIT_WAIT=0
MISSING_PACKAGES=""
enable_desktop_service() {
  if systemctl enable "$DESKTOP_SERVICE_NAME" >/dev/null 2>&1; then
    return 0
  fi
  mkdir -p /etc/systemd/system/multi-user.target.wants
  ln -sf "$SERVICE_FILE" "/etc/systemd/system/multi-user.target.wants/$DESKTOP_SERVICE_NAME"
  systemctl daemon-reload
}
enable_stream_health_service() {
  if [ -z "$DESIRED_STREAM_HEALTH_SCRIPT" ] || [ -z "$DESIRED_STREAM_HEALTH_SERVICE" ]; then
    return 0
  fi
  if systemctl enable "$STREAM_HEALTH_SERVICE_NAME" >/dev/null 2>&1; then
    return 0
  fi
  mkdir -p /etc/systemd/system/multi-user.target.wants
  ln -sf "$STREAM_HEALTH_SERVICE_FILE" "/etc/systemd/system/multi-user.target.wants/$STREAM_HEALTH_SERVICE_NAME"
  systemctl daemon-reload
}
reset_guest_display_state() {
  if [ "$RESET_DISPLAY_STATE_ON_REPAIR" -ne 1 ]; then
    return 0
  fi
  RESET_DISPLAY_STATE=0
  for DISPLAY_STATE_FILE in "$GUEST_MONITORS_FILE" "$GDM_MONITORS_FILE"; do
    if [ -f "$DISPLAY_STATE_FILE" ]; then
      rm -f "$DISPLAY_STATE_FILE"
      RESET_DISPLAY_STATE=1
    fi
  done
  if [ "$RESET_DISPLAY_STATE" -eq 1 ]; then
    rm -f "$DESKTOP_HEALTH_PENDING_FILE" "$DESKTOP_GDM_RESTART_FILE"
    RESTART_GDM=1
    RESTART_DESKTOP=1
  fi
}
repair_guest_desktop_if_unhealthy() {
  if [ ! -x "$SESSION_HEALTH_FILE" ]; then
    return 0
  fi
  if "$SESSION_HEALTH_FILE"; then
    rm -f "$DESKTOP_HEALTH_PENDING_FILE" "$DESKTOP_GDM_RESTART_FILE"
    return 0
  fi
  mkdir -p "$REPAIR_STATE_DIR"
  NOW_EPOCH="$(date +%s)"
  PENDING_AT="$(cat "$DESKTOP_HEALTH_PENDING_FILE" 2>/dev/null || true)"
  case "$PENDING_AT" in
    ''|*[!0-9]*)
      PENDING_AT=0
      ;;
  esac
  if [ "$PENDING_AT" -eq 0 ]; then
    printf '%s\\n' "$NOW_EPOCH" > "$DESKTOP_HEALTH_PENDING_FILE"
    return 0
  fi
  if [ $((NOW_EPOCH - PENDING_AT)) -lt "$DESKTOP_HEALTH_GRACE_SECONDS" ]; then
    return 0
  fi
  LAST_GDM_RESTART_AT="$(cat "$DESKTOP_GDM_RESTART_FILE" 2>/dev/null || true)"
  case "$LAST_GDM_RESTART_AT" in
    ''|*[!0-9]*)
      LAST_GDM_RESTART_AT=0
      ;;
  esac
  if [ $((NOW_EPOCH - LAST_GDM_RESTART_AT)) -lt "$DESKTOP_GDM_RESTART_COOLDOWN_SECONDS" ]; then
    return 0
  fi
  printf '%s\\n' "$NOW_EPOCH" > "$DESKTOP_GDM_RESTART_FILE"
  systemctl restart gdm3 || true
  RESTART_DESKTOP=1
  sleep 2
}
if id ${DEFAULT_GUEST_USERNAME} >/dev/null 2>&1 && [ -d "${DEFAULT_GUEST_HOME}" ]; then
  install -d -m 0755 -o ${DEFAULT_GUEST_USERNAME} -g ${DEFAULT_GUEST_USERNAME} "$WELCOME_STATE_DIR" "$WELCOME_AUTOSTART_DIR"
  touch "$WELCOME_DONE_FILE"
  chown ${DEFAULT_GUEST_USERNAME}:${DEFAULT_GUEST_USERNAME} "$WELCOME_DONE_FILE"
  CURRENT_WELCOME_AUTOSTART="$(cat "$WELCOME_AUTOSTART_FILE" 2>/dev/null || true)"
  if [ "$CURRENT_WELCOME_AUTOSTART" != "$DESIRED_WELCOME_AUTOSTART" ]; then
    cat > "$WELCOME_AUTOSTART_FILE" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=GNOME Initial Setup
Hidden=true
X-GNOME-Autostart-enabled=false
DESKTOP
    chown ${DEFAULT_GUEST_USERNAME}:${DEFAULT_GUEST_USERNAME} "$WELCOME_AUTOSTART_FILE"
  fi
fi
if [ "$CURRENT_GDM" != "$DESIRED_GDM" ]; then
  mkdir -p /etc/gdm3
  cat > "$GDM_FILE" <<'CONF'
${buildGuestGdmCustomConfig()}
CONF
  RESTART_GDM=1
fi
if [ "$CURRENT_LAUNCHER" != "$DESIRED_LAUNCHER" ]; then
  mkdir -p /usr/local/bin
  cat > "$LAUNCHER_FILE" <<'SCRIPT'
${desiredLauncher}
SCRIPT
  chmod 0755 "$LAUNCHER_FILE"
  RESTART_DESKTOP=1
fi
if [ "$CURRENT_SERVICE" != "$DESIRED_SERVICE" ]; then
  mkdir -p /etc/systemd/system
  cat > "$SERVICE_FILE" <<'UNIT'
${desiredService}
UNIT
  RESTART_DESKTOP=1
fi
if [ -n "$DESIRED_STREAM_HEALTH_SCRIPT" ] && [ "$CURRENT_STREAM_HEALTH_SCRIPT" != "$DESIRED_STREAM_HEALTH_SCRIPT" ]; then
  mkdir -p /usr/local/bin
  cat > "$STREAM_HEALTH_SCRIPT_FILE" <<'SCRIPT'
${desiredStreamHealthScript}
SCRIPT
  chmod 0755 "$STREAM_HEALTH_SCRIPT_FILE"
  RESTART_STREAM_HEALTH=1
fi
if [ -n "$DESIRED_STREAM_HEALTH_SERVICE" ] && [ "$CURRENT_STREAM_HEALTH_SERVICE" != "$DESIRED_STREAM_HEALTH_SERVICE" ]; then
  mkdir -p /etc/systemd/system
  cat > "$STREAM_HEALTH_SERVICE_FILE" <<'UNIT'
${desiredStreamHealthService}
UNIT
  RESTART_STREAM_HEALTH=1
fi
if [ -z "$DESIRED_STREAM_HEALTH_SCRIPT" ] || [ -z "$DESIRED_STREAM_HEALTH_SERVICE" ]; then
  systemctl disable --now "$STREAM_HEALTH_SERVICE_NAME" >/dev/null 2>&1 || true
  rm -f "$STREAM_HEALTH_SCRIPT_FILE" "$STREAM_HEALTH_SERVICE_FILE"
fi
if [ "$CURRENT_RENDERING_ENV" != "$DESIRED_RENDERING_ENV" ]; then
  mkdir -p /etc/environment.d
  cat > "$RENDERING_ENV_FILE" <<'ENV'
${buildGuestRenderingEnvironmentConfig()}
ENV
  RESTART_GDM=1
fi
if [ "$CURRENT_SESSION_HEALTH" != "$DESIRED_SESSION_HEALTH" ]; then
  mkdir -p /usr/local/bin
  cat > "$SESSION_HEALTH_FILE" <<'SCRIPT'
${buildGuestDesktopHealthCheckScript()}
SCRIPT
  chmod 0755 "$SESSION_HEALTH_FILE"
fi
if [ "$CURRENT_SESSION_SETUP" != "$DESIRED_SESSION_SETUP" ]; then
  mkdir -p /usr/local/bin
  cat > "$SESSION_SETUP_FILE" <<'SCRIPT'
${buildGuestDesktopSessionSetupScript(vmName)}
SCRIPT
  chmod 0755 "$SESSION_SETUP_FILE"
fi
if [ "$CURRENT_SESSION_AUTOSTART" != "$DESIRED_SESSION_AUTOSTART" ]; then
  mkdir -p /etc/xdg/autostart
  cat > "$SESSION_AUTOSTART_FILE" <<'DESKTOP'
${buildGuestDesktopSessionAutostartEntry()}
DESKTOP
fi
if [ "$CURRENT_NETWORK_WAIT_ONLINE_OVERRIDE" != "$DESIRED_NETWORK_WAIT_ONLINE_OVERRIDE" ]; then
  mkdir -p /etc/systemd/system/systemd-networkd-wait-online.service.d
  cat > "$NETWORK_WAIT_ONLINE_OVERRIDE_FILE" <<'CONF'
${buildGuestNetworkWaitOnlineOverride()}
CONF
  RESTART_WAIT_ONLINE=1
fi
if [ "$CURRENT_PLYMOUTH_QUIT_WAIT_OVERRIDE" != "$DESIRED_PLYMOUTH_QUIT_WAIT_OVERRIDE" ]; then
  mkdir -p /etc/systemd/system/plymouth-quit-wait.service.d
  cat > "$PLYMOUTH_QUIT_WAIT_OVERRIDE_FILE" <<'CONF'
${buildGuestPlymouthQuitWaitOverride()}
CONF
  STOP_PLYMOUTH_QUIT_WAIT=1
fi
${desktopPackageChecks}
if ! dpkg-query -W -f='\${Status}' indicator-multiload 2>/dev/null | grep -q 'install ok installed'; then
  MISSING_PACKAGES="$MISSING_PACKAGES indicator-multiload"
fi
if [ -n "$MISSING_PACKAGES" ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=0 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 update
  apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=0 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 install -y $MISSING_PACKAGES
  RESTART_DESKTOP=1
fi
${desktopInstallStep}
reset_guest_display_state
if [ "$CURRENT_DESKTOP_BRIDGE_VERSION" != "$DESIRED_DESKTOP_BRIDGE_VERSION" ]; then
  mkdir -p "$REPAIR_STATE_DIR"
  cat > "$DESKTOP_BRIDGE_VERSION_FILE" <<'JSON'
${desiredDesktopBridgeVersion}
JSON
fi
systemctl daemon-reload
if [ "$RESTART_WAIT_ONLINE" -eq 1 ]; then
  systemctl restart systemd-networkd-wait-online.service >/dev/null 2>&1 || true
fi
if [ "$STOP_PLYMOUTH_QUIT_WAIT" -eq 1 ]; then
  systemctl stop --no-block plymouth-quit-wait.service >/dev/null 2>&1 || true
fi
enable_desktop_service
enable_stream_health_service
if [ "$RESTART_GDM" -eq 1 ]; then
  systemctl restart gdm3 || true
  sleep 2
fi
repair_guest_desktop_if_unhealthy
if [ "$RESTART_DESKTOP" -eq 1 ] || ! systemctl is-active --quiet "$DESKTOP_SERVICE_NAME"; then
  systemctl restart --no-block "$DESKTOP_SERVICE_NAME"
fi
if [ -n "$DESIRED_STREAM_HEALTH_SCRIPT" ] && [ -n "$DESIRED_STREAM_HEALTH_SERVICE" ]; then
  if [ "$RESTART_STREAM_HEALTH" -eq 1 ] || ! systemctl is-active --quiet "$STREAM_HEALTH_SERVICE_NAME"; then
    systemctl restart --no-block "$STREAM_HEALTH_SERVICE_NAME" || true
  fi
fi`;
}

function buildGuestDesktopBootstrapServiceUnit(): string {
  return `[Unit]
Description=Parallaize desktop bootstrap
After=display-manager.service
Wants=display-manager.service
StartLimitIntervalSec=0

[Service]
Type=oneshot
ExecStart=/usr/local/bin/parallaize-desktop-bootstrap
Restart=on-failure
RestartSec=15

[Install]
WantedBy=multi-user.target`;
}

function buildGuestHostnameSyncServiceUnit(): string {
  return `[Unit]
Description=Parallaize guest hostname sync
After=local-fs.target

[Service]
Type=oneshot
ExecStart=${DEFAULT_GUEST_HOSTNAME_SYNC_FILE}

[Install]
WantedBy=multi-user.target`;
}

function buildGuestNetworkWaitOnlineOverride(): string {
  return `[Service]
ExecStart=
ExecStart=/bin/true`;
}

function buildGuestPlymouthQuitWaitOverride(): string {
  return `[Service]
ExecStart=
ExecStart=/bin/true`;
}

function buildGuestEarlyBootOverrideScript(): string {
  return `set -eu
mkdir -p /etc/systemd/system/systemd-networkd-wait-online.service.d
cat > /etc/systemd/system/systemd-networkd-wait-online.service.d/10-parallaize.conf <<'CONF'
${buildGuestNetworkWaitOnlineOverride()}
CONF
mkdir -p /etc/systemd/system/plymouth-quit-wait.service.d
cat > /etc/systemd/system/plymouth-quit-wait.service.d/10-parallaize.conf <<'CONF'
${buildGuestPlymouthQuitWaitOverride()}
CONF
systemctl daemon-reload || true
systemctl restart systemd-networkd-wait-online.service || true
systemctl stop --no-block plymouth-quit-wait.service || true`;
}

function buildGuestHostnameSyncScript(): string {
  return `#!/bin/sh
set -eu
HOSTNAME_STATE_FILE="${DEFAULT_GUEST_HOSTNAME_STATE_FILE}"
HOSTS_FILE="/etc/hosts"
if [ ! -s "$HOSTNAME_STATE_FILE" ]; then
  exit 0
fi
DESIRED_HOSTNAME="$(tr -d '\\r\\n' < "$HOSTNAME_STATE_FILE")"
DESIRED_HOSTNAME="$(printf '%s' "$DESIRED_HOSTNAME" | tr '[:upper:]' '[:lower:]')"
case "$DESIRED_HOSTNAME" in
  ''|*[!a-z0-9-]*)
    exit 0
    ;;
esac
CURRENT_HOSTNAME="$(cat /etc/hostname 2>/dev/null || hostname 2>/dev/null || true)"
if [ "$CURRENT_HOSTNAME" != "$DESIRED_HOSTNAME" ]; then
  if command -v hostnamectl >/dev/null 2>&1; then
    hostnamectl set-hostname "$DESIRED_HOSTNAME" || true
  else
    printf '%s\\n' "$DESIRED_HOSTNAME" > /etc/hostname
    hostname "$DESIRED_HOSTNAME" || true
  fi
fi
CURRENT_HOSTS="$(cat "$HOSTS_FILE" 2>/dev/null || true)"
if printf '%s\\n' "$CURRENT_HOSTS" | grep -Eq '^127\\.0\\.1\\.1([[:space:]]|$)'; then
  NEXT_HOSTS="$(printf '%s\\n' "$CURRENT_HOSTS" | sed -E "s/^127\\.0\\.1\\.1([[:space:]].*)?$/127.0.1.1 $DESIRED_HOSTNAME/")"
else
  NEXT_HOSTS="$(printf '%s\\n127.0.1.1 %s\\n' "$CURRENT_HOSTS" "$DESIRED_HOSTNAME")"
fi
if [ "$CURRENT_HOSTS" != "$NEXT_HOSTS" ]; then
  printf '%s\\n' "$NEXT_HOSTS" > "$HOSTS_FILE"
fi`;
}

function buildGuestIncusAgentInstallScript(): string {
  return `if mount /dev/disk/by-label/incus-agent /mnt/incus-agent; then
  (
    cd /mnt/incus-agent
    ./install.sh || true
  )
  umount /mnt/incus-agent || true
  agent_target=""
  for candidate in /usr/lib /lib /etc; do
    if [ -f "$candidate/systemd/system/incus-agent.service" ]; then
      agent_target="$candidate"
      break
    fi
  done
  if [ -n "$agent_target" ]; then
    mkdir -p /etc/systemd/system/multi-user.target.wants
    ln -sf "$agent_target/systemd/system/incus-agent.service" /etc/systemd/system/multi-user.target.wants/incus-agent.service
  fi
  systemctl start incus-agent.service || true
fi`;
}

function buildGuestInotifySysctlConfig(settings: GuestInotifySettings): string {
  return `# Raised inotify limits for Node/Vite-style dev watchers inside the guest.
fs.inotify.max_user_watches=${settings.maxUserWatches}
fs.inotify.max_user_instances=${settings.maxUserInstances}`;
}

function buildGuestCloudInit(
  transport: VmDesktopTransport,
  port: number,
  inotifySettings: GuestInotifySettings,
  vmName?: string,
  selkiesRtcConfig: GuestSelkiesRtcConfig | null = null,
  vmId?: string,
  streamHealthToken?: string | null,
  controlPlanePort = 3000,
): string {
  const launcherPath =
    transport === "selkies"
      ? "/usr/local/bin/parallaize-selkies"
      : "/usr/local/bin/parallaize-x11vnc";
  const launcherScript =
    transport === "selkies"
      ? buildGuestSelkiesLauncherScript(port, selkiesRtcConfig)
      : buildGuestVncLauncherScript(port);
  const servicePath =
    transport === "selkies"
      ? "/etc/systemd/system/parallaize-selkies.service"
      : "/etc/systemd/system/parallaize-x11vnc.service";
  const serviceUnit =
    transport === "selkies"
      ? buildGuestSelkiesServiceUnit()
      : buildGuestVncServiceUnit();

  return `#cloud-config
write_files:
  - path: /etc/gdm3/custom.conf
    permissions: '0644'
    content: |
${indentBlock(buildGuestGdmCustomConfig(), "      ")}
  - path: ${launcherPath}
    permissions: '0755'
    content: |
${indentBlock(launcherScript, "      ")}
  - path: ${servicePath}
    permissions: '0644'
    content: |
${indentBlock(serviceUnit, "      ")}
  - path: /etc/environment.d/90-parallaize-rendering.conf
    permissions: '0644'
    content: |
${indentBlock(buildGuestRenderingEnvironmentConfig(), "      ")}
  - path: ${DEFAULT_GUEST_DESKTOP_HEALTH_CHECK}
    permissions: '0755'
    content: |
${indentBlock(buildGuestDesktopHealthCheckScript(), "      ")}
  - path: /usr/local/bin/parallaize-desktop-bootstrap
    permissions: '0755'
    content: |
${indentBlock(
        buildGuestDesktopBootstrapScript(
          port,
          vmName,
          "standard",
          transport,
          port,
          selkiesRtcConfig,
          vmId,
          streamHealthToken,
          controlPlanePort,
        ),
        "      ",
      )}
  - path: /etc/systemd/system/parallaize-desktop-bootstrap.service
    permissions: '0644'
    content: |
${indentBlock(buildGuestDesktopBootstrapServiceUnit(), "      ")}
  - path: /etc/sysctl.d/60-parallaize-inotify.conf
    permissions: '0644'
    content: |
${indentBlock(buildGuestInotifySysctlConfig(inotifySettings), "      ")}
  - path: /etc/systemd/system/systemd-networkd-wait-online.service.d/10-parallaize.conf
    permissions: '0644'
    content: |
${indentBlock(buildGuestNetworkWaitOnlineOverride(), "      ")}
  - path: /etc/systemd/system/plymouth-quit-wait.service.d/10-parallaize.conf
    permissions: '0644'
    content: |
${indentBlock(buildGuestPlymouthQuitWaitOverride(), "      ")}
bootcmd:
  - |
${indentBlock(buildGuestEarlyBootOverrideScript(), "      ")}
runcmd:
  - sysctl --load /etc/sysctl.d/60-parallaize-inotify.conf || true
  - systemctl daemon-reload
  - systemctl restart systemd-networkd-wait-online.service || true
  - systemctl stop --no-block plymouth-quit-wait.service || true
  - systemctl disable --now gnome-remote-desktop.service || true
  - systemctl mask gnome-remote-desktop.service || true
  - mkdir -p /etc/systemd/user
  - ln -sf /dev/null /etc/systemd/user/gnome-remote-desktop.service
  - ln -sf /dev/null /etc/systemd/user/gnome-remote-desktop-handover.service
  - ln -sf /dev/null /etc/systemd/user/gnome-remote-desktop-headless.service
  - mkdir -p /mnt/incus-agent
  - |
${indentBlock(buildGuestIncusAgentInstallScript(), "      ")}
  - systemctl enable parallaize-desktop-bootstrap.service
  - systemctl restart gdm3 || true
  - systemctl start parallaize-desktop-bootstrap.service || true
`;
}

export function buildGuestVncCloudInit(
  port: number,
  inotifySettings: GuestInotifySettings,
  vmName?: string,
): string {
  return buildGuestCloudInit("vnc", port, inotifySettings, vmName);
}

export function buildGuestSelkiesCloudInit(
  port: number,
  inotifySettings: GuestInotifySettings,
  vmName?: string,
  selkiesRtcConfig: GuestSelkiesRtcConfig | null = null,
  vmId?: string,
  streamHealthToken?: string | null,
  controlPlanePort = 3000,
): string {
  return buildGuestCloudInit(
    "selkies",
    port,
    inotifySettings,
    vmName,
    selkiesRtcConfig,
    vmId,
    streamHealthToken,
    controlPlanePort,
  );
}

function indentBlock(value: string, prefix: string): string {
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}
