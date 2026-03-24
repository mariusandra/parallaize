#!/bin/sh
set -eu

if ! getent group parallaize >/dev/null 2>&1; then
  groupadd --system parallaize
fi

if ! getent passwd parallaize >/dev/null 2>&1; then
  NOLOGIN_BIN="$(command -v nologin || true)"
  if [ -z "$NOLOGIN_BIN" ]; then
    NOLOGIN_BIN=/usr/sbin/nologin
  fi

  useradd \
    --system \
    --gid parallaize \
    --home-dir /var/lib/parallaize \
    --create-home \
    --shell "$NOLOGIN_BIN" \
    parallaize
fi
