#!/usr/bin/env bash
set -euo pipefail

workspace_dir="$(cd "$(dirname "$0")/.." && pwd)"

echo "安装工作区验证依赖..."
(cd "${workspace_dir}" && npm install)
(cd "${workspace_dir}" && npx playwright install chromium)

for project_dir in apps/sourcing-center apps/internal-supplier apps/external-supplier; do
  echo "安装 ${project_dir} 依赖..."
  (cd "${workspace_dir}/${project_dir}" && npm install)
done
