# 海天外部供应商协同平台

独立的 Next.js 外部供应商演示应用。浏览器只访问本应用的同源 BFF，由 BFF 使用服务凭证调用 `apps/sourcing-center/app/api/demo/v1` 核心业务 API。本项目不连接数据库，也不保存独立的询价、邀请或报价数据。

## 已实现流程

1. `/register` 从核心 API 加载 `EXT-SUP-DEMO-004` 的固定企业资料。
2. 浏览器只提交联系人、邮箱和密码；供应商编号固定由服务端请求头注入。
3. 注册成功后由本应用签发 HMAC 签名的 HttpOnly Cookie。
4. `/rfqs` 只展示该供应商原本已经受邀的 RFQ。
5. `/rfqs/[rfqNo]` 支持查看详情、记录查看时间和受控下载采购附件。
6. 报价提交前进行二次确认；首次提交后显示当前供应商的报价详情与竞争力分析，并允许在截止前重新报价一次，第二次提交后锁定。
7. 列表和详情每 5 秒轮询，使用核心 API 的 `revision` 和 `serverTime` 刷新状态及校准倒计时。

## 本地运行

```bash
cp .env.example .env.local
npm install
npm run dev
```

打开 <http://127.0.0.1:3002/register>。开发环境在未配置变量时使用与管理端一致的本地默认服务 Token 和会话 Secret；Production 必须显式配置 Secret。

环境变量：

| 变量 | 说明 |
| --- | --- |
| `CORE_API_URL` | 核心 API 根地址，默认 `http://127.0.0.1:3000/api/demo/v1` |
| `DEMO_SERVICE_TOKEN` | BFF 调用核心 API 的服务凭证 |
| `DEMO_SESSION_SECRET` | 外部供应商会话 HMAC 签名 Secret |

## BFF 边界

- 所有核心请求携带 `x-demo-service-token`；注册和供应商业务请求携带固定 `x-demo-supplier-no: EXT-SUP-DEMO-004`。
- 浏览器提交的注册数据会由 Zod 裁剪为 `contactName`、`email`、`password`，不能覆盖供应商身份或角色。
- `/api/rfqs/**` 同时校验 HttpOnly 会话；核心 API 仍负责最终邀请、状态、截止时间及最多两次报价校验。
- 报价 BFF 会将浏览器本次确认生成的稳定幂等键原样传给核心 API，网络重试不会误消耗重新报价机会。
- 附件下载由 BFF 流式转发，只保留必要响应头，不向浏览器暴露服务凭证。

## 质量检查

```bash
npm test
npm run typecheck
npm run build
```

测试覆盖输入边界、伪造身份裁剪、RFQ DTO 兼容解析、会话签名/篡改/过期以及核心 API 的服务端身份请求头。
