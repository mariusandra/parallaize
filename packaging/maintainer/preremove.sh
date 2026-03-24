#!/bin/sh
set -eu

case "${1:-}" in
  upgrade|1)
    exit 0
    ;;
esac

if command -v systemctl >/dev/null 2>&1; then
  systemctl stop parallaize-caddy.service parallaize.service >/dev/null 2>&1 || true
fi
