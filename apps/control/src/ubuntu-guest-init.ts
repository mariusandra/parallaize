import { slugify } from "../../../packages/shared/src/helpers.js";

const DEFAULT_GUEST_USERNAME = "ubuntu";
export const DEFAULT_GUEST_HOME = `/home/${DEFAULT_GUEST_USERNAME}`;
export const DEFAULT_GUEST_DESKTOP_HEALTH_CHECK =
  "/usr/local/bin/parallaize-desktop-health-check";
export type GuestDesktopBootstrapRepairProfile = "standard" | "aggressive";
const DEFAULT_GUEST_WALLPAPER = "Monument_valley_by_orbitelambda.jpg";
const DEFAULT_GUEST_WALLPAPER_BASE_URL = "https://wallpapers.parallaize.com/24.04";
const DEFAULT_GUEST_DESKTOP_HEALTH_GRACE_SECONDS = 30;
const DEFAULT_GUEST_DESKTOP_GDM_RESTART_COOLDOWN_SECONDS = 30;
const AGGRESSIVE_GUEST_DESKTOP_HEALTH_GRACE_SECONDS = 10;
const AGGRESSIVE_GUEST_DESKTOP_GDM_RESTART_COOLDOWN_SECONDS = 15;

export interface GuestInotifySettings {
  maxUserWatches: number;
  maxUserInstances: number;
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
): string {
  return `BOOTSTRAP_FILE="/usr/local/bin/parallaize-desktop-bootstrap"
BOOTSTRAP_SERVICE_FILE="/etc/systemd/system/parallaize-desktop-bootstrap.service"
CURRENT_BOOTSTRAP="$(cat "$BOOTSTRAP_FILE" 2>/dev/null || true)"
DESIRED_BOOTSTRAP="$(cat <<'PARALLAIZE_BOOTSTRAP_SCRIPT'
${buildGuestDesktopBootstrapScript(port, vmName, repairProfile)}
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
${buildGuestDesktopBootstrapScript(port, vmName, repairProfile)}
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
exec /usr/bin/x11vnc -display "$DISPLAY_NUMBER" -auth "$AUTH_FILE" -forever -shared -xrandr newfbsize -noxdamage -noshm -nopw -repeat -rfbport ${port} -o /var/log/x11vnc.log`;
}

function buildGuestVncServiceUnit(): string {
  return `[Unit]
Description=Parallaize x11vnc bridge
After=display-manager.service parallaize-desktop-bootstrap.service
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

function buildGuestDesktopBootstrapScript(
  port: number,
  vmName?: string,
  repairProfile: GuestDesktopBootstrapRepairProfile = "standard",
): string {
  const repairTimings = resolveGuestDesktopBootstrapRepairTimings(repairProfile);

  return `#!/bin/sh
set -eu
GDM_FILE="/etc/gdm3/custom.conf"
LAUNCHER_FILE="/usr/local/bin/parallaize-x11vnc"
SERVICE_FILE="/etc/systemd/system/parallaize-x11vnc.service"
RENDERING_ENV_FILE="/etc/environment.d/90-parallaize-rendering.conf"
SESSION_HEALTH_FILE="${DEFAULT_GUEST_DESKTOP_HEALTH_CHECK}"
SESSION_SETUP_FILE="/usr/local/bin/parallaize-desktop-session-setup"
SESSION_AUTOSTART_FILE="/etc/xdg/autostart/parallaize-desktop-session-setup.desktop"
REPAIR_STATE_DIR="/var/lib/parallaize"
DESKTOP_HEALTH_PENDING_FILE="$REPAIR_STATE_DIR/desktop-session-unhealthy-at"
DESKTOP_GDM_RESTART_FILE="$REPAIR_STATE_DIR/desktop-session-last-gdm-restart"
DESKTOP_HEALTH_GRACE_SECONDS=${repairTimings.healthGraceSeconds}
DESKTOP_GDM_RESTART_COOLDOWN_SECONDS=${repairTimings.gdmRestartCooldownSeconds}
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
${buildGuestVncLauncherScript(port)}
SCRIPT
)"
CURRENT_SERVICE="$(cat "$SERVICE_FILE" 2>/dev/null || true)"
DESIRED_SERVICE="$(cat <<'UNIT'
${buildGuestVncServiceUnit()}
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
DESIRED_WELCOME_AUTOSTART="$(cat <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=GNOME Initial Setup
Hidden=true
X-GNOME-Autostart-enabled=false
DESKTOP
)"
RESTART_GDM=0
RESTART_VNC=0
MISSING_PACKAGES=""
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
  RESTART_VNC=1
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
${buildGuestVncLauncherScript(port)}
SCRIPT
  chmod 0755 "$LAUNCHER_FILE"
  RESTART_VNC=1
fi
if [ "$CURRENT_SERVICE" != "$DESIRED_SERVICE" ]; then
  mkdir -p /etc/systemd/system
  cat > "$SERVICE_FILE" <<'UNIT'
${buildGuestVncServiceUnit()}
UNIT
  RESTART_VNC=1
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
if ! command -v x11vnc >/dev/null 2>&1; then
  MISSING_PACKAGES="$MISSING_PACKAGES x11vnc"
fi
if ! dpkg-query -W -f='\${Status}' indicator-multiload 2>/dev/null | grep -q 'install ok installed'; then
  MISSING_PACKAGES="$MISSING_PACKAGES indicator-multiload"
fi
if [ -n "$MISSING_PACKAGES" ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=0 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 update
  apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=0 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 install -y $MISSING_PACKAGES
  RESTART_VNC=1
fi
systemctl daemon-reload
systemctl enable parallaize-x11vnc.service >/dev/null 2>&1 || true
if [ "$RESTART_GDM" -eq 1 ]; then
  systemctl restart gdm3 || true
  sleep 2
fi
repair_guest_desktop_if_unhealthy
if [ "$RESTART_VNC" -eq 1 ] || ! systemctl is-active --quiet parallaize-x11vnc.service; then
  systemctl restart --no-block parallaize-x11vnc.service
fi`;
}

function buildGuestDesktopBootstrapServiceUnit(): string {
  return `[Unit]
Description=Parallaize desktop bootstrap
After=network-online.target display-manager.service
Wants=network-online.target display-manager.service
StartLimitIntervalSec=0

[Service]
Type=oneshot
ExecStart=/usr/local/bin/parallaize-desktop-bootstrap
Restart=on-failure
RestartSec=15

[Install]
WantedBy=multi-user.target`;
}

function buildGuestInotifySysctlConfig(settings: GuestInotifySettings): string {
  return `# Raised inotify limits for Node/Vite-style dev watchers inside the guest.
fs.inotify.max_user_watches=${settings.maxUserWatches}
fs.inotify.max_user_instances=${settings.maxUserInstances}`;
}

export function buildGuestVncCloudInit(
  port: number,
  inotifySettings: GuestInotifySettings,
  vmName?: string,
): string {
  return `#cloud-config
write_files:
  - path: /etc/gdm3/custom.conf
    permissions: '0644'
    content: |
${indentBlock(buildGuestGdmCustomConfig(), "      ")}
  - path: /usr/local/bin/parallaize-x11vnc
    permissions: '0755'
    content: |
${indentBlock(buildGuestVncLauncherScript(port), "      ")}
  - path: /etc/systemd/system/parallaize-x11vnc.service
    permissions: '0644'
    content: |
${indentBlock(buildGuestVncServiceUnit(), "      ")}
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
${indentBlock(buildGuestDesktopBootstrapScript(port, vmName), "      ")}
  - path: /etc/systemd/system/parallaize-desktop-bootstrap.service
    permissions: '0644'
    content: |
${indentBlock(buildGuestDesktopBootstrapServiceUnit(), "      ")}
  - path: /etc/sysctl.d/60-parallaize-inotify.conf
    permissions: '0644'
    content: |
${indentBlock(buildGuestInotifySysctlConfig(inotifySettings), "      ")}
runcmd:
  - sysctl --load /etc/sysctl.d/60-parallaize-inotify.conf || true
  - systemctl daemon-reload
  - systemctl disable --now gnome-remote-desktop.service || true
  - systemctl mask gnome-remote-desktop.service || true
  - mkdir -p /etc/systemd/user
  - ln -sf /dev/null /etc/systemd/user/gnome-remote-desktop.service
  - ln -sf /dev/null /etc/systemd/user/gnome-remote-desktop-handover.service
  - ln -sf /dev/null /etc/systemd/user/gnome-remote-desktop-headless.service
  - mkdir -p /mnt/incus-agent
  - |
      if mount /dev/disk/by-label/incus-agent /mnt/incus-agent; then
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
      fi
  - systemctl enable parallaize-desktop-bootstrap.service
  - systemctl restart gdm3 || true
  - systemctl start parallaize-desktop-bootstrap.service || true
`;
}

function indentBlock(value: string, prefix: string): string {
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}
