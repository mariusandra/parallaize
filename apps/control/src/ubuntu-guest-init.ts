const DEFAULT_GUEST_USERNAME = "ubuntu";
export const DEFAULT_GUEST_HOME = `/home/${DEFAULT_GUEST_USERNAME}`;
const DEFAULT_GUEST_WALLPAPER = "Monument_valley_by_orbitelambda.jpg";

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
): string {
  return `BOOTSTRAP_FILE="/usr/local/bin/parallaize-desktop-bootstrap"
BOOTSTRAP_SERVICE_FILE="/etc/systemd/system/parallaize-desktop-bootstrap.service"
CURRENT_BOOTSTRAP="$(cat "$BOOTSTRAP_FILE" 2>/dev/null || true)"
DESIRED_BOOTSTRAP="$(cat <<'PARALLAIZE_BOOTSTRAP_SCRIPT'
${buildGuestDesktopBootstrapScript(port)}
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
${buildGuestDesktopBootstrapScript(port)}
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

function buildGuestVncLauncherScript(port: number): string {
  return `#!/bin/sh
set -eu
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

function buildGuestDesktopSessionSetupScript(): string {
  return `#!/bin/sh
set -eu
DASH_TO_DOCK_SCHEMA="org.gnome.shell.extensions.dash-to-dock"
BACKGROUND_SCHEMA="org.gnome.desktop.background"
WALLPAPER_NAME="${DEFAULT_GUEST_WALLPAPER}"
WALLPAPER_ROOTS="/usr/share/backgrounds /usr/share/gnome-background-properties"
PARALLAIZE_CONFIG_DIR="\${XDG_CONFIG_HOME:-$HOME/.config}/parallaize"
WALLPAPER_MARKER_FILE="$PARALLAIZE_CONFIG_DIR/desktop-wallpaper-initialized"
set_dash_to_dock_defaults() {
  gsettings set "$DASH_TO_DOCK_SCHEMA" dock-position RIGHT >/dev/null 2>&1 || true
  gsettings set "$DASH_TO_DOCK_SCHEMA" dash-max-icon-size 32 >/dev/null 2>&1 || true
}
find_named_wallpaper() {
  find $WALLPAPER_ROOTS -type f -name "$WALLPAPER_NAME" 2>/dev/null \
    | sort \
    | head -n 1
}
apply_first_boot_wallpaper() {
  if [ -f "$WALLPAPER_MARKER_FILE" ]; then
    return 0
  fi
  mkdir -p "$PARALLAIZE_CONFIG_DIR"
  wallpaper="$(find_named_wallpaper || true)"
  if [ -n "$wallpaper" ]; then
    wallpaper_uri="file://$wallpaper"
    gsettings set "$BACKGROUND_SCHEMA" picture-uri "$wallpaper_uri" >/dev/null 2>&1 || true
    gsettings set "$BACKGROUND_SCHEMA" picture-uri-dark "$wallpaper_uri" >/dev/null 2>&1 || true
    gsettings set "$BACKGROUND_SCHEMA" picture-options zoom >/dev/null 2>&1 || true
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

function buildGuestDesktopBootstrapScript(port: number): string {
  return `#!/bin/sh
set -eu
GDM_FILE="/etc/gdm3/custom.conf"
LAUNCHER_FILE="/usr/local/bin/parallaize-x11vnc"
SERVICE_FILE="/etc/systemd/system/parallaize-x11vnc.service"
RENDERING_ENV_FILE="/etc/environment.d/90-parallaize-rendering.conf"
SESSION_SETUP_FILE="/usr/local/bin/parallaize-desktop-session-setup"
SESSION_AUTOSTART_FILE="/etc/xdg/autostart/parallaize-desktop-session-setup.desktop"
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
CURRENT_SESSION_SETUP="$(cat "$SESSION_SETUP_FILE" 2>/dev/null || true)"
DESIRED_SESSION_SETUP="$(cat <<'SCRIPT'
${buildGuestDesktopSessionSetupScript()}
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
if [ "$CURRENT_SESSION_SETUP" != "$DESIRED_SESSION_SETUP" ]; then
  mkdir -p /usr/local/bin
  cat > "$SESSION_SETUP_FILE" <<'SCRIPT'
${buildGuestDesktopSessionSetupScript()}
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
  - path: /usr/local/bin/parallaize-desktop-bootstrap
    permissions: '0755'
    content: |
${indentBlock(buildGuestDesktopBootstrapScript(port), "      ")}
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
