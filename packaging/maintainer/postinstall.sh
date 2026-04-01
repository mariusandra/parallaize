#!/bin/sh
set -eu

PARALLAIZE_POSTINSTALL_HELPER="${PARALLAIZE_POSTINSTALL_HELPER:-/usr/lib/parallaize/install/parallaize-postinstall-configure}"

install -d -m 0750 -o parallaize -g parallaize /var/lib/parallaize

for group in incus incus-admin lxd sudo; do
  if getent group "$group" >/dev/null 2>&1; then
    usermod -a -G "$group" parallaize || true
  fi
done

if [ -x "$PARALLAIZE_POSTINSTALL_HELPER" ]; then
  "$PARALLAIZE_POSTINSTALL_HELPER" "${1:-configure}" "${2:-}"
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload >/dev/null 2>&1 || true
  systemctl enable parallaize-network-fix.service >/dev/null 2>&1 || true
  systemctl restart parallaize-network-fix.service >/dev/null 2>&1 || true
  systemctl enable parallaize.service >/dev/null 2>&1 || true

  case "${2:-}" in
    "")
      systemctl start parallaize.service >/dev/null 2>&1 || true
      ;;
    *)
      systemctl try-restart parallaize.service >/dev/null 2>&1 || systemctl start parallaize.service >/dev/null 2>&1 || true
      ;;
  esac
fi
