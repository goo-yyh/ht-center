SHELL := /bin/bash

.DEFAULT_GOAL := start
.NOTPARALLEL:

APP_PROJECTS := apps/sourcing-center apps/internal-supplier apps/external-supplier
APP_PORTS := 3000 3001 3002

.PHONY: start dev stop check doctor dependencies install prepare reset verify help

## start: 准备数据库并启动管理端、内部供应商端和外部供应商端
start: dependencies doctor
	@for port in $(APP_PORTS); do \
		if lsof -nP -iTCP:$$port -sTCP:LISTEN >/dev/null 2>&1; then \
			echo "端口 $$port 已被占用，请先停止对应服务。" >&2; \
			lsof -nP -iTCP:$$port -sTCP:LISTEN >&2; \
			exit 1; \
		fi; \
	done
	@bash scripts/demo-prepare.sh --runtime
	@npm run dev

## dev: start 的别名
dev: start

## stop: 停止由 make start 启动的三个系统
stop:
	@bash scripts/stop-all.sh

## check: 检查启动所需的本机命令
check:
	@missing=0; \
	for command_name in node npm psql createdb lsof curl; do \
		if ! command -v $$command_name >/dev/null 2>&1; then \
			echo "缺少命令: $$command_name" >&2; \
			missing=1; \
		fi; \
	done; \
	if [[ $$missing -ne 0 ]]; then \
		echo "请先安装 Node.js、npm 和 PostgreSQL 客户端。" >&2; \
		exit 1; \
	fi
	@node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 20 || (major === 20 && minor < 9)) { console.error("Node.js 版本过低：需要 >= 20.9.0，当前为 " + process.version); process.exit(1); }'

## doctor: 检查完整 Agent 流程所需的 DeepSeek 配置
doctor: check
	@set -e; \
	if [[ -f .env ]]; then \
		set -a; source .env; set +a; \
	fi; \
	if [[ -z "$${DEEPSEEK_API_KEY:-}" ]]; then \
		echo "缺少 DEEPSEEK_API_KEY，请在根目录 .env 中配置后再启动。" >&2; \
		exit 1; \
	fi

## dependencies: 仅在缺失或锁文件更新时安装三端依赖
dependencies: check
	@for project_dir in $(APP_PROJECTS); do \
		install_marker="$$project_dir/node_modules/.package-lock.json"; \
		if [[ ! -f "$$install_marker" \
			|| "$$project_dir/package.json" -nt "$$install_marker" \
			|| "$$project_dir/package-lock.json" -nt "$$install_marker" ]] \
			|| ! npm --prefix "$$project_dir" ls --depth=0 >/dev/null 2>&1; then \
			echo "安装 $$project_dir 依赖..."; \
			npm --prefix "$$project_dir" install || exit $$?; \
		fi; \
	done

## install: 安装全部开发、验证依赖和 Playwright Chromium
install: check
	@npm run install:all

## prepare: 严格初始化并校验五条固定演示数据
prepare: dependencies
	@npm run demo:prepare

## reset: 恢复五条固定演示数据（会清除当前演示进度）
reset: dependencies
	@set -e; \
	if [[ -f .env ]]; then \
		set -a; source .env; set +a; \
	fi; \
	bash scripts/demo-prepare.sh --runtime; \
	npm --prefix apps/sourcing-center run demo:reset -- --confirm; \
	npm --prefix apps/sourcing-center run demo:preflight

## verify: 执行三端完整质量检查和跨系统 E2E
verify: check
	@npm run verify

## help: 查看可用命令
help:
	@echo "海天智能寻源"
	@echo ""
	@echo "  make / make start  一键准备数据库并启动三个系统"
	@echo "  make stop          停止由 make start 启动的三个系统"
	@echo "  make reset         恢复固定演示数据"
	@echo "  make prepare       严格初始化并校验演示数据"
	@echo "  make install       安装全部开发和验证依赖"
	@echo "  make verify        执行完整质量检查和 E2E"
	@echo "  make help          查看本帮助"
