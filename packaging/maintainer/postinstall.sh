#!/bin/sh
set -eu

install -d -m 0750 -o parallaize -g parallaize /var/lib/parallaize

for group in incus incus-admin lxd sudo; do
  if getent group "$group" >/dev/null 2>&1; then
    usermod -a -G "$group" parallaize || true
  fi
done

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload >/dev/null 2>&1 || true
fi
