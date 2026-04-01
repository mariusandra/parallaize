#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/infra/parallaize.env.local"
DEFAULT_PROVIDER="${1:-incus}"
DEFAULT_DATA_FILE="${2:-data/incus-state.json}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

export PARALLAIZE_PROVIDER="${PARALLAIZE_PROVIDER:-$DEFAULT_PROVIDER}"
export PARALLAIZE_DATA_FILE="${PARALLAIZE_DATA_FILE:-$DEFAULT_DATA_FILE}"

exec node "$ROOT_DIR/dist/apps/control/src/server.js"
