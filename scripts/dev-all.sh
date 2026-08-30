#!/usr/bin/env bash
set -euo pipefail

workspace_dir="$(cd "$(dirname "$0")/.." && pwd)"
runtime_dir="${workspace_dir}/.runtime"
pid_file="${runtime_dir}/dev-all.pid"

mkdir -p "${runtime_dir}"
if [[ -f "${pid_file}" ]]; then
  existing_pid="$(cat "${pid_file}" 2>/dev/null || true)"
  if [[ "${existing_pid}" =~ ^[0-9]+$ ]] && kill -0 "${existing_pid}" 2>/dev/null; then
    echo "三个系统已经由进程 ${existing_pid} 管理，请先运行 make stop。" >&2
    exit 1
  fi
  rm -f "${pid_file}"
fi
printf '%s\n' "$$" > "${pid_file}"

if [[ -f "${workspace_dir}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${workspace_dir}/.env"
  set +a
fi

export DATABASE_URL="${DATABASE_URL:-postgresql://127.0.0.1:5432/haitian_sourcing_demo}"
export QUOTE_ENCRYPTION_KEY="${QUOTE_ENCRYPTION_KEY:-aGFpdGlhbi1kZW1vLXNlYWxlZC1rZXktMzItYnl0ZSE=}"
export QUOTE_KEY_VERSION="${QUOTE_KEY_VERSION:-demo-v1}"
export DEMO_SERVICE_TOKEN="${DEMO_SERVICE_TOKEN:-haitian-demo-service-local}"
export DEMO_SESSION_SECRET="${DEMO_SESSION_SECRET:-haitian-demo-session-secret-local-2026}"
export DEMO_RESET_ENABLED="${DEMO_RESET_ENABLED:-true}"
export CORE_API_URL="${CORE_API_URL:-http://127.0.0.1:3000/api/demo/v1}"

child_pids=()

terminate_tree() {
  local parent_pid="$1"
  local child_pid
  while read -r child_pid; do
    [[ -n "${child_pid}" ]] && terminate_tree "${child_pid}"
  done < <(pgrep -P "${parent_pid}" 2>/dev/null || true)
  kill -TERM "${parent_pid}" 2>/dev/null || true
}

cleanup() {
  for child_pid in "${child_pids[@]:-}"; do
    terminate_tree "${child_pid}"
  done
  if [[ "$(cat "${pid_file}" 2>/dev/null || true)" == "$$" ]]; then
    rm -f "${pid_file}"
  fi
}

trap cleanup EXIT INT TERM

(cd "${workspace_dir}/apps/sourcing-center" && PORT=3000 npm run dev) &
child_pids+=("$!")
(cd "${workspace_dir}/apps/internal-supplier" && npm run dev) &
child_pids+=("$!")
(cd "${workspace_dir}/apps/external-supplier" && npm run dev) &
child_pids+=("$!")

echo "寻源管理端: http://127.0.0.1:3000/agents/sourcing"
echo "内部供应商端: http://127.0.0.1:3001"
echo "外部供应商端: http://127.0.0.1:3002/register"

wait
