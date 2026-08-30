#!/usr/bin/env bash
set -euo pipefail

workspace_dir="$(cd "$(dirname "$0")/.." && pwd)"
database_name="haitian_sourcing_demo"
default_database_url="postgresql://127.0.0.1:5432/${database_name}"
run_preflight=true

if [[ "${1:-}" == "--runtime" ]]; then
  run_preflight=false
  shift
fi

if [[ "$#" -ne 0 ]]; then
  echo "用法: $0 [--runtime]" >&2
  exit 2
fi

if [[ -f "${workspace_dir}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${workspace_dir}/.env"
  set +a
fi

export DATABASE_URL="${DATABASE_URL:-${default_database_url}}"
export QUOTE_ENCRYPTION_KEY="${QUOTE_ENCRYPTION_KEY:-aGFpdGlhbi1kZW1vLXNlYWxlZC1rZXktMzItYnl0ZSE=}"
export QUOTE_KEY_VERSION="${QUOTE_KEY_VERSION:-demo-v1}"
export DEMO_SERVICE_TOKEN="${DEMO_SERVICE_TOKEN:-haitian-demo-service-local}"
export DEMO_RESET_ENABLED="${DEMO_RESET_ENABLED:-true}"

if [[ "${DATABASE_URL}" == "${default_database_url}" ]]; then
  if ! psql postgres -Atqc "SELECT 1 FROM pg_database WHERE datname='${database_name}'" | grep -qx 1; then
    createdb "${database_name}"
  fi
elif ! psql "${DATABASE_URL}" -Atqc "SELECT 1" >/dev/null; then
  echo "自定义 DATABASE_URL 无法连接；请先创建并授权该数据库。" >&2
  exit 1
fi

database_target="$(psql "${DATABASE_URL}" -Atqc "SELECT current_database()")"
if [[ "${database_target}" != "haitian_sourcing_demo" && "${CONFIRM_DEMO_DATABASE:-}" != "yes" ]]; then
  echo "拒绝在数据库 ${database_target} 初始化 Demo；如确认它是专用演示库，请设置 CONFIRM_DEMO_DATABASE=yes。" >&2
  exit 1
fi

cd "${workspace_dir}/apps/sourcing-center"
npm run db:migrate
npm run demo:init
if [[ "${run_preflight}" == "true" ]]; then
  npm run demo:preflight
fi
