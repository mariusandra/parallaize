#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/infra/parallaize.env.local"
DEFAULT_PROVIDER="${1:-incus}"
DEFAULT_DATA_FILE="${2:-data/incus-state.json}"

declare -A PRESERVED_ENV=()

while IFS='=' read -r env_name env_value; do
  case "$env_name" in
    HOST|PORT|DATABASE_URL|PARALLAIZE_*)
      PRESERVED_ENV["$env_name"]="$env_value"
      ;;
  esac
done < <(env)

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

for env_name in "${!PRESERVED_ENV[@]}"; do
  export "$env_name=${PRESERVED_ENV[$env_name]}"
done

export PARALLAIZE_PROVIDER="${PARALLAIZE_PROVIDER:-$DEFAULT_PROVIDER}"
export PARALLAIZE_DATA_FILE="${PARALLAIZE_DATA_FILE:-$DEFAULT_DATA_FILE}"

exec node "$ROOT_DIR/dist/apps/control/src/server.js"
