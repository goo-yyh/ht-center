# 海天智能寻源

这是一个可完整演示“创建寻源需求 → Agent 匹配供应商 → 供应商报价 → Agent 评估 → 创建采购申请 PR”的三端项目。三个应用共享 `apps/sourcing-center` 提供的核心 API 和同一个 PostgreSQL 数据库，日常开发只需要在本目录执行一条启动命令，不需要分别进入三个子项目。

| 应用 | 目录 | 地址 | 作用 |
| --- | --- | --- | --- |
| 寻源管理端 | `apps/sourcing-center` | <http://127.0.0.1:3000/agents/sourcing> | 寻源大盘、DeepSeek Agent、报价管理、评估与 PR 创建 |
| 内部供应商端 | `apps/internal-supplier` | <http://127.0.0.1:3001> | 选择内部供应商身份、查看询价、下载附件并报价 |
| 外部供应商端 | `apps/external-supplier` | <http://127.0.0.1:3002/register> | 注册外部供应商、查看询价、首次报价及一次重新报价 |

主要目录：

```text
ht/
├── apps/
│   ├── sourcing-center/       # 寻源管理端与核心业务 API
│   ├── internal-supplier/     # 内部供应商端
│   └── external-supplier/     # 外部供应商端
├── packages/                  # 三端共享合约与 UI 主题
├── specs/                     # 产品规格
├── scripts/                   # 工作区脚本
└── tests/                     # 跨系统 E2E
```

## 快速启动

### 1. 准备本机环境

需要以下命令：

| 依赖 | 要求 |
| --- | --- |
| Node.js | `>= 20.9.0`，建议使用当前 LTS |
| npm | 随 Node.js 安装 |
| PostgreSQL | 本地实例，需包含 `psql` 和 `createdb` |
| make、curl、lsof | macOS 通常已内置 |

macOS 尚未安装 Node.js 和 PostgreSQL 时，可以使用 Homebrew：

```bash
brew install node postgresql@16
brew services start postgresql@16
```

如果安装后仍找不到 `psql`，把 Homebrew 的 PostgreSQL 命令目录加入当前 Shell：

```bash
echo 'export PATH="$(brew --prefix postgresql@16)/bin:$PATH"' >> ~/.zshrc
exec zsh
```

确认 PostgreSQL 可以连接：

```bash
psql postgres -c "select current_user, current_database();"
```

### 2. 创建演示数据库

创建一个只供本项目使用的数据库：

```bash
createdb haitian_sourcing_demo
```

如果提示数据库已经存在，可以继续下一步。数据库迁移会自动创建 `pgcrypto` 扩展，因此当前 PostgreSQL 用户需要有创建扩展的权限。

### 3. 配置根目录 `.env`

在本 README 所在目录执行：

```bash
cp .env.example .env
```

必须填写 DeepSeek API Key；默认数据库连接会使用当前系统用户，如本机配置不同再调整 `DATABASE_URL`：

```dotenv
# 默认无需填写用户名；如数据库需要密码，可改成
# postgresql://用户名:密码@127.0.0.1:5432/haitian_sourcing_demo
DATABASE_URL=postgresql://127.0.0.1:5432/haitian_sourcing_demo

# 必须是可用的 DeepSeek API Key；寻源和报价评估会发起真实调用。
DEEPSEEK_API_KEY=你的_DeepSeek_API_Key
```

其余本地演示配置已有安全范围内的默认值，一般不需要修改。三个应用都会读取根目录 `.env`，使用一键启动时不需要再创建各子项目的 `.env.local`。

> 不要提交包含真实 API Key、数据库密码或生产 Secret 的 `.env` 文件。

### 4. 一键启动三个系统

```bash
make start
```

也可以直接执行 `make`。首次运行会自动完成以下操作：

1. 检查 Node.js、PostgreSQL 客户端及其他必要命令；
2. 按需安装三个应用的 npm 依赖；
3. 迁移数据库并补齐五条演示基线数据；
4. 同时启动管理端、内部供应商端和外部供应商端。

看到三个 `Ready` 后即可打开：

- 管理端：<http://127.0.0.1:3000/agents/sourcing>
- 内部供应商端：<http://127.0.0.1:3001>
- 外部供应商注册：<http://127.0.0.1:3002/register>

`make start` 会占用当前终端并持续显示日志。可以按 `Ctrl+C` 停止，也可以在另一个终端进入本目录后执行：

```bash
make stop
```

## 建议演示路线

初始化完成后，管理端会有五条分别处于不同阶段的寻源需求，可以直接查看每个阶段，也可以从头创建新需求。

从头演示时建议按以下顺序：

1. 在管理端创建寻源需求，进入 Agent 对话并运行寻源；
2. 查看分步执行过程和候选供应商，确认并发布询价；
3. 在内部供应商端选择受邀身份后提交报价；
4. 在外部供应商端完成一次注册并报价；首次报价后可查看竞争力，并有一次重新报价机会；
5. 回到管理端等待报价，必要时使用“一键模拟报价”补齐其余报价；
6. 停止报价并运行 Agent 评估，选择一家供应商创建采购申请 PR。

现场演示身份：

- 内部供应商可选择 `INT-SUP-DEMO-003`；
- 外部注册固定使用演示企业 `EXT-SUP-DEMO-004`；
- 寻源和评估使用根目录 `.env` 中的真实 DeepSeek 配置，不会生成伪 Agent 结果。

## 数据初始化与重置

普通 `make start` 只会迁移并补齐缺失数据，不会清除已经进行中的演示进度。

```bash
make prepare  # 迁移数据库、补齐数据并校验五个阶段是否完整
make reset    # 清除当前演示进度，恢复五条固定基线需求
```

`make reset` 会同时影响三个应用，因为它们共享数据库。执行前请确认当前演示进度可以丢弃。

如果 `DATABASE_URL` 指向的数据库名称不是 `haitian_sourcing_demo`，初始化和重置默认会拒绝执行。只有确认它是专用演示库后，才可以在 `.env` 中设置：

```dotenv
CONFIRM_DEMO_DATABASE=yes
```

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `make start` / `make` | 准备数据库并启动三个系统 |
| `make stop` | 停止由 `make start` 管理的三个系统 |
| `make check` | 检查本机命令和 Node.js 版本 |
| `make prepare` | 迁移、初始化并校验演示数据 |
| `make reset` | 恢复五条固定演示数据，会清除当前进度 |
| `make install` | 安装三端依赖及 Playwright Chromium |
| `make verify` | 运行三端完整质量检查和真实跨系统 E2E |
| `make help` | 查看命令帮助 |

## 完整质量检查

第一次运行完整检查时，先安装工作区验证依赖和 Playwright Chromium：

```bash
make install
```

之后先执行 `make stop`，再运行：

```bash
make verify
```

该命令会依次执行：

- 三个应用的 ESLint 和 TypeScript 检查；
- 后端及两个供应商端的自动化测试；
- 三个 Next.js 应用的生产构建；
- Playwright 跨系统 E2E。

E2E 会真实调用 DeepSeek，并覆盖创建需求、Agent 寻源、内部报价、外部注册与一次重报、停止报价、Agent 评估、单一中选 PR 和统一重置。运行时会产生少量 DeepSeek API 调用，并会在结束时恢复固定演示数据。

只重跑跨系统 E2E：

```bash
npm run test:e2e
```

## 环境变量

完整示例见 [`.env.example`](./.env.example)。模板只启用下面 3 项；其他高级和生产配置均为注释，使用本地默认值：

| 变量 | 是否必需 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 是 | 专用 PostgreSQL 演示数据库连接串 |
| `DEEPSEEK_API_KEY` | 是 | DeepSeek API Key，寻源和评估真实调用 |
| `DEEPSEEK_MODEL` | 是 | 当前演示使用的模型，保持为 `deepseek-chat` |

如需切换 DeepSeek 地址、请求超时或演示步骤延迟，可取消 `.env.example` 中对应高级配置的注释。生产部署还必须显式配置服务 Token、会话 Secret 和加密密钥，不能使用本地演示默认值。

旧迁移中仍保留报价加密相关变量，只用于兼容历史表结构；当前产品使用明文报价及外部供应商一次重新报价，不采用密封报价。

## 常见问题

### `缺少 DEEPSEEK_API_KEY`

确认根目录存在 `.env`，并且 `DEEPSEEK_API_KEY` 不是空值。修改后重新执行 `make start`。

### PostgreSQL `connection refused`

确认服务已启动：

```bash
pg_isready
psql postgres -c "select 1;"
```

然后检查 `.env` 中的主机、端口、用户名、密码和数据库名。

### `role ... does not exist` 或密码认证失败

把 `DATABASE_URL` 中的用户名改为 `psql postgres -Atqc 'select current_user'` 返回的角色；如果本机 PostgreSQL 要求密码，在连接串中补充密码。

### 端口 3000、3001 或 3002 已被占用

先尝试：

```bash
make stop
```

如果占用进程不是本项目启动的，可以通过下面的命令定位：

```bash
lsof -nP -iTCP:3000 -iTCP:3001 -iTCP:3002 -sTCP:LISTEN
```

### DeepSeek 显示 `fetch failed`

先确认 API Key 和地址正确，再检查代理、Clash 或公司网络是否允许当前 Node.js 进程访问 `DEEPSEEK_BASE_URL`。应用不会在 DeepSeek 失败时伪造成功结果，网络恢复后可以重新发起 Agent 操作。

### `make verify` 提示 Next.js 开发服务仍在运行

完整验证包含生产构建，执行前必须先运行 `make stop`，确认三个开发端口已经释放。
