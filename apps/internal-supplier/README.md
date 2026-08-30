# 海天内部供应商协同平台

独立的 Next.js 16 内部供应商应用，运行在 `http://127.0.0.1:3001`。它通过同源 BFF 访问 `haitian` 核心业务 API，不连接数据库，不在浏览器中保存服务凭证，也不维护独立的询价或报价 Mock JSON。

## 功能范围

- 从核心 API 读取并选择固定内部供应商身份。
- 服务端校验身份后签发 HMAC 签名的 HttpOnly Cookie。
- 只展示当前供应商受邀的 RFQ。
- 查看采购要求并通过受邀校验下载同一份采购附件。
- 预览并二次确认后提交首版正式报价。
- 首次报价后展示本供应商的报价正文、竞争力分析和剩余机会。
- 截止前允许重新报价一次，第二版新增历史版本并锁定，首版不覆盖。
- 每 5 秒刷新详情和工作区 revision，写入后立即重新读取。

## 本地启动

前置条件：`haitian` 核心 API 已运行在 3000 端口，并已完成 Demo 数据初始化。

```bash
cp .env.example .env.local
npm install
npm run dev
```

打开 `http://127.0.0.1:3001`。本地开发在没有环境变量时也会使用与核心端统一的本地缺省值；production 必须显式配置全部 Secret。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `CORE_API_URL` | 核心 API 根地址，默认包含 `/api/demo/v1` |
| `DEMO_SERVICE_TOKEN` | 仅 BFF 使用的核心服务凭证 |
| `DEMO_SESSION_SECRET` | 至少 32 字符的会话签名 Secret |
| `DEMO_COOKIE_SECURE` | HTTPS 部署设置为 `true` |

不得增加 `NEXT_PUBLIC_` 形式的服务 Token、会话 Secret 或数据库地址。

## 核心 API 对接契约

BFF 通过 `x-demo-service-token`（同时兼容 Bearer）调用核心 API；已选择身份的请求额外携带 `x-demo-supplier-no`。浏览器的 RFQ 查询、详情、附件和报价请求体均没有 `supplierNo`。

| 方法 | 核心路径 | 用途 |
| --- | --- | --- |
| GET | `/internal/demo-suppliers` | 可选内部供应商列表 |
| POST | `/internal/session` | 校验/记录演示会话；身份位于服务端请求头，body 为 `{}` |
| GET | `/internal/rfqs` | 当前供应商受邀询价 |
| GET | `/internal/rfqs/{rfqNo}` | 当前供应商可见详情 |
| POST | `/internal/rfqs/{rfqNo}/view` | 幂等记录查看时间 |
| GET | `/internal/rfqs/{rfqNo}/attachments/{attachmentId}` | 校验邀请并下载附件 |
| POST | `/internal/rfqs/{rfqNo}/quotes` | 提交 `{ totalAmount, deliveryDays, remark }` |
| GET | `/internal/rfqs/{rfqNo}/quotes/me` | 当前供应商自己的报价回执 |

JSON 成功响应使用 `{ data, meta }`，其中 `meta` 建议包含 `workspaceCode`、`revision`、`serverTime` 和 `requestId`。BFF 对列表容器及少量字段别名做了容错，但输出给页面的是固定且裁剪过的 DTO。错误响应使用 `{ error: { code, message, requestId? } }`。

附件接口需要保留 `Content-Type`、`Content-Length` 和 `Content-Disposition: attachment`。报价接口必须由核心服务执行受邀校验、RFQ 状态与数据库时间校验、最多两版限制、竞争力分析和幂等处理。

## 验证

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

也可以一次执行 `npm run verify`。BFF 健康检查地址为 `GET /api/health`。

当前项目的自动化测试覆盖：签名会话防篡改和过期、核心服务身份头、核心 DTO 容错裁剪、报价版本与竞争力、报价金额与交期校验。跨数据库的两版上限、并发重报、附件 checksum 和重置流程由核心服务集成测试与跨应用 E2E 验证。
