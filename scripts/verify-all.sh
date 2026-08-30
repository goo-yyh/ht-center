#!/usr/bin/env bash
set -euo pipefail

workspace_dir="$(cd "$(dirname "$0")/.." && pwd)"

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
export DEMO_RESET_ENABLED="${DEMO_RESET_ENABLED:-true}"

database_target="$(psql "${DATABASE_URL}" -Atqc "SELECT current_database()")"
if [[ "${database_target}" != "haitian_sourcing_demo" && "${CONFIRM_DEMO_DATABASE:-}" != "yes" ]]; then
  echo "拒绝重置数据库 ${database_target}；如确认它是专用演示库，请设置 CONFIRM_DEMO_DATABASE=yes。" >&2
  exit 1
fi

for project_dir in apps/sourcing-center apps/internal-supplier apps/external-supplier; do
  dev_lock="${workspace_dir}/${project_dir}/.next/dev/lock"
  if [[ -f "${dev_lock}" ]] && lsof "${dev_lock}" >/dev/null 2>&1; then
    echo "请先停止 ${project_dir} 的 Next.js 开发服务，再运行完整验证。" >&2
    exit 1
  fi
  # Playwright 终止整组三端开发服务后，Next.js 偶尔会留下未被任何
  # 进程持有的 lock。它属于生成物，可安全清理后再进行生产构建。
  rm -f "${dev_lock}"
  rm -rf "${workspace_dir}/${project_dir}/.next/dev/types"
done

cd "${workspace_dir}/apps/sourcing-center"
npm run lint
npm run typecheck
env -u DEEPSEEK_API_KEY npm run test:backend
npm run build
npm run demo:reset -- --confirm
npm run demo:preflight

cd "${workspace_dir}/apps/internal-supplier"
npm run verify

cd "${workspace_dir}/apps/external-supplier"
npm run verify

cd "${workspace_dir}"
npm run test:e2e
