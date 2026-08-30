#!/usr/bin/env bash
set -euo pipefail

workspace_dir="$(cd "$(dirname "$0")/.." && pwd)"
pid_file="${workspace_dir}/.runtime/dev-all.pid"

if [[ ! -f "${pid_file}" ]]; then
  echo "没有发现由 make start 管理的运行中服务。"
  exit 0
fi

managed_pid="$(cat "${pid_file}" 2>/dev/null || true)"
if [[ ! "${managed_pid}" =~ ^[0-9]+$ ]]; then
  rm -f "${pid_file}"
  echo "已清理无效的服务进程记录。"
  exit 0
fi

if ! kill -0 "${managed_pid}" 2>/dev/null; then
  rm -f "${pid_file}"
  echo "服务已经停止，已清理过期进程记录。"
  exit 0
fi

managed_command="$(ps -p "${managed_pid}" -o command= 2>/dev/null || true)"
if [[ "${managed_command}" != *"scripts/dev-all.sh"* ]]; then
  echo "拒绝停止进程 ${managed_pid}：它不再是本项目的 dev-all 服务。" >&2
  exit 1
fi

kill -TERM "${managed_pid}"
for _ in {1..50}; do
  if ! kill -0 "${managed_pid}" 2>/dev/null; then
    rm -f "${pid_file}"
    echo "管理端、内部供应商端和外部供应商端已停止。"
    exit 0
  fi
  sleep 0.1
done

echo "停止请求已发送，但进程 ${managed_pid} 仍在退出；请稍后再次运行 make stop。" >&2
exit 1
