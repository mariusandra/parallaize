#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <instance-name>" >&2
  echo "env: PARALLAIZE_TEMPLATE_EXTRA_PACKAGES='kubuntu-desktop' PARALLAIZE_GUEST_VNC_PORT=5900" >&2
  exit 1
fi

INSTANCE_NAME="$1"
INCUS_BIN="${PARALLAIZE_INCUS_BIN:-incus}"
GUEST_VNC_PORT="${PARALLAIZE_GUEST_VNC_PORT:-5900}"
AUTOLOGIN_USER="${PARALLAIZE_TEMPLATE_AUTOLOGIN_USER:-ubuntu}"
EXTRA_PACKAGES="${PARALLAIZE_TEMPLATE_EXTRA_PACKAGES:-}"

"$INCUS_BIN" exec "$INSTANCE_NAME" -- env \
  GUEST_VNC_PORT="$GUEST_VNC_PORT" \
  AUTOLOGIN_USER="$AUTOLOGIN_USER" \
  EXTRA_PACKAGES="$EXTRA_PACKAGES" \
  sh -lc '
set -eu

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This prep helper currently supports apt-based guests only." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
set -- x11vnc
if [ -n "$EXTRA_PACKAGES" ]; then
  # shellcheck disable=SC2086
  set -- "$@" $EXTRA_PACKAGES
fi

apt-get update
apt-get install -y "$@"

if [ -f /etc/gdm3/custom.conf ]; then
  cat > /etc/gdm3/custom.conf <<EOF
[daemon]
AutomaticLoginEnable=true
AutomaticLogin=$AUTOLOGIN_USER
WaylandEnable=false
EOF
fi

mkdir -p /etc/systemd/user
ln -sf /dev/null /etc/systemd/user/gnome-remote-desktop.service
ln -sf /dev/null /etc/systemd/user/gnome-remote-desktop-handover.service
ln -sf /dev/null /etc/systemd/user/gnome-remote-desktop-headless.service

cat > /usr/local/bin/parallaize-x11vnc <<EOF
#!/bin/sh
set -eu
AUTH_FILE=""
for candidate in /run/user/*/gdm/Xauthority /run/user/*/Xauthority /home/*/.Xauthority; do
  if [ -f "$candidate" ]; then
    AUTH_FILE="$candidate"
    break
  fi
done
if [ -z "$AUTH_FILE" ]; then
  echo "Unable to locate an Xauthority file for the desktop session." >&2
  exit 1
fi
export HOME="\${HOME:-/root}"
exec /usr/bin/x11vnc -display :0 -auth "$AUTH_FILE" -forever -shared -xrandr newfbsize -noshm -nopw -rfbport $GUEST_VNC_PORT -o /var/log/x11vnc.log
EOF
chmod 0755 /usr/local/bin/parallaize-x11vnc

cat > /etc/systemd/system/parallaize-x11vnc.service <<EOF
[Unit]
Description=Parallaize x11vnc bridge
After=display-manager.service
Wants=display-manager.service

[Service]
Type=simple
ExecStart=/usr/local/bin/parallaize-x11vnc
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl disable --now gnome-remote-desktop.service >/dev/null 2>&1 || true
systemctl mask gnome-remote-desktop.service >/dev/null 2>&1 || true
systemctl enable parallaize-x11vnc.service >/dev/null 2>&1 || true
systemctl restart gdm3 >/dev/null 2>&1 || true
systemctl restart display-manager >/dev/null 2>&1 || true
systemctl restart parallaize-x11vnc.service
systemctl status --no-pager parallaize-x11vnc.service | sed -n "1,12p"
'

printf 'Prepared %s with guest VNC bootstrap on port %s.\n' "$INSTANCE_NAME" "$GUEST_VNC_PORT"
if [[ -n "$EXTRA_PACKAGES" ]]; then
  printf 'Installed extra packages: %s\n' "$EXTRA_PACKAGES"
fi
