import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';

const BUYER_BASE = process.env.E2E_BUYER_BASE_URL ?? 'http://127.0.0.1:3000';
const INTERNAL_BASE = process.env.E2E_INTERNAL_BASE_URL ?? 'http://127.0.0.1:3001';
const EXTERNAL_BASE = process.env.E2E_EXTERNAL_BASE_URL ?? 'http://127.0.0.1:3002';

type ApiEnvelope<T> = {
  data: T;
  meta: { revision: number; serverTime: string };
};

type RequestSummary = {
  requestNo: string;
  status: string;
};

type Candidate = {
  supplierNo: string;
  supplierName: string;
  supplierType: 'INTERNAL' | 'EXTERNAL';
};

type EvaluationItem = {
  quoteNo: string;
  supplierNo: string;
  supplierName: string;
  totalAmount: string;
  deliveryDays: number;
};

type RequestDetail = {
  requestNo: string;
  status: string;
  itemName: string;
  specification: string;
  quantity: number;
  quoteDurationMinutes: number;
  evaluationStrategy: string;
  requiredDeliveryDays: number;
  candidates: Candidate[];
  agentActions: Array<{ actionType: string }>;
  rfq?: {
    rfqNo: string;
    status: string;
    counts: { invited: number; submitted: number };
  } | null;
  revealedQuotes?: Array<{ quoteNo: string; totalAmount: string; deliveryDays: number; version: number; competitiveness: 'HIGH' | 'MEDIUM' | 'LOW' | null }>;
  evaluation?: { items: EvaluationItem[] } | null;
  purchaseRequisition?: {
    prNo: string;
    quoteNo: string;
    supplierNo: string;
    totalAmount: string;
    deliveryDays: number;
  } | null;
};

function idempotencyKey(scope: string): string {
  return `e2e-${scope}-${crypto.randomUUID()}`;
}

async function readEnvelope<T>(response: Awaited<ReturnType<APIRequestContext['get']>>): Promise<ApiEnvelope<T>> {
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json() as Promise<ApiEnvelope<T>>;
}

async function resetDemo(request: APIRequestContext): Promise<void> {
  const response = await request.post(`${BUYER_BASE}/api/demo/v1/demo/reset`, {
    headers: { 'idempotency-key': idempotencyKey('reset') },
    data: { confirmation: '重置 Demo 数据' },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function getDashboard(request: APIRequestContext): Promise<{ stats: { total: number }; requests: RequestSummary[] }> {
  const response = await request.get(`${BUYER_BASE}/api/demo/v1/dashboard`);
  return (await readEnvelope<{ stats: { total: number }; requests: RequestSummary[] }>(response)).data;
}

async function getDetail(request: APIRequestContext, requestNo: string): Promise<RequestDetail> {
  const response = await request.get(`${BUYER_BASE}/api/demo/v1/sourcing-requests/${encodeURIComponent(requestNo)}`);
  return (await readEnvelope<RequestDetail>(response)).data;
}

async function waitForRequestStatus(
  request: APIRequestContext,
  requestNo: string,
  expectedStatus: string,
  timeout = 100_000,
): Promise<RequestDetail> {
  let detail: RequestDetail | undefined;
  await expect.poll(async () => {
    detail = await getDetail(request, requestNo);
    return detail.status;
  }, { timeout, intervals: [500, 1_000, 2_000] }).toBe(expectedStatus);
  return detail as RequestDetail;
}

async function selectInternalIdentity(page: Page, supplierNo: string): Promise<void> {
  await page.goto(INTERNAL_BASE);
  const supplierCard = page.locator('.supplier-card').filter({ hasText: supplierNo });
  await expect(supplierCard).toBeVisible();
  await supplierCard.getByRole('button', { name: '使用该身份进入' }).click();
  await expect(page).toHaveURL(/\/rfqs$/);
}

async function openRfqFromTable(page: Page, rfqNo: string): Promise<void> {
  const row = page.locator('tr').filter({ hasText: rfqNo });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: '查看详情' }).click();
  await expect(page).toHaveURL(new RegExp(`/rfqs/${rfqNo}$`));
}

async function expectNoPageHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    pageWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.pageWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
}

async function expectAttachmentDownload(page: Page, fileName: string): Promise<void> {
  const standardDownloadLink = page.getByRole('link', { name: '下载查看' });
  const downloadControl = await standardDownloadLink.count()
    ? standardDownloadLink
    : page.getByRole('button', { name: '下载查看' });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    downloadControl.click(),
  ]);
  expect(download.suggestedFilename()).toBe(fileName);
}

function monitorPageErrors(page: Page, errors: string[]): void {
  page.on('pageerror', (error) => errors.push(`${page.url()}: ${error.message}`));
}

async function submitInternalQuote(page: Page, amount: string, deliveryDays: string): Promise<void> {
  await page.getByLabel('报价总价（元）').fill(amount);
  await page.getByLabel('承诺交期（天）').fill(deliveryDays);
  await page.getByLabel('报价备注').fill('Playwright 内部供应商正式报价');
  await page.getByRole('button', { name: '预览并提交报价' }).click();
  const modal = page.getByRole('dialog', { name: '确认提交正式报价？' });
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: '确认并提交' }).click();
  await expect(page.getByText('报价提交回执')).toBeVisible();
  await expect(page.getByText('您的正式报价已经提交')).toBeVisible();
}

async function registerExternalSupplier(page: Page): Promise<void> {
  await page.goto(`${EXTERNAL_BASE}/register`);
  await expect(page.getByText('EXT-SUP-DEMO-004')).toBeVisible();
  await expect(page.getByText('91330206MA2H8X4N6P')).toBeVisible();
  await expect(page.getByText(/稳定供货能力/).first()).toBeVisible();
  await page.getByLabel('联系人').fill('演示联系人');
  await page.getByLabel('联系邮箱').fill('e2e-supplier@example.com');
  await page.getByLabel('设置密码').fill('DemoPass2026!');
  await page.getByRole('button', { name: '确认注册并进入询价' }).click();
  await expect(page).toHaveURL(/\/rfqs$/);
}

async function submitExternalQuote(page: Page, amount: string, deliveryDays: string, requote = false): Promise<void> {
  await page.getByLabel('含税总报价（元）').fill(amount);
  await page.getByLabel('交货周期（天）').fill(deliveryDays);
  await page.getByLabel('商务备注').fill(requote ? 'Playwright 外部供应商重新报价' : 'Playwright 外部供应商首次报价');
  await page.getByRole('button', { name: requote ? '预览并确认重新报价' : '预览并确认报价' }).click();
  const modal = page.getByRole('dialog', { name: requote ? '确认重新报价' : '确认提交报价' });
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: '确认并正式提交' }).click();
  await expect(page.getByText(requote ? '重新报价提交成功，本次报价已锁定' : '首次报价提交成功，可查看报价竞争力')).toBeVisible();
}

test('三端完成真实寻源、明文报价与一次重报、评估、单一中选 PR 与统一重置', async ({ browser, request }) => {
  test.slow();

  const health = await readEnvelope<{
    status: string;
    deepSeek: { configured: boolean; state: string };
    quoteEncryptionConfigured: boolean;
  }>(await request.get(`${BUYER_BASE}/api/demo/v1/health`));
  expect(health.data).toMatchObject({
    status: 'ok',
    deepSeek: { configured: true },
    quoteEncryptionConfigured: true,
  });

  await resetDemo(request);

  const contexts: BrowserContext[] = [];
  const browserErrors: string[] = [];
  const buyerContext = await browser.newContext({ viewport: { width: 1536, height: 1000 } });
  contexts.push(buyerContext);
  const buyerPage = await buyerContext.newPage();
  monitorPageErrors(buyerPage, browserErrors);

  try {
    await buyerPage.goto(`${BUYER_BASE}/agents/sourcing`);
    await expect(buyerPage.getByRole('heading', { name: '从寻源需求到采购申请，一页完成智能闭环' })).toBeVisible();
    await expect(buyerPage.getByText('SR-DEMO-0001')).toBeVisible();
    expect((await getDashboard(request)).stats.total).toBe(5);

    await buyerPage.getByRole('button', { name: '创建寻源需求' }).click();
    const createDrawer = buyerPage.getByRole('dialog', { name: '创建寻源需求' });
    await expect(createDrawer).toBeVisible();
    const attachmentName = 'E2E-采购规格.pdf';
    await createDrawer.locator('input[type="file"]').setInputFiles({
      name: attachmentName,
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n海天寻源 E2E 采购规格\n%%EOF', 'utf8'),
    });
    await expect(createDrawer.getByText(attachmentName)).toBeVisible();
    await createDrawer.getByRole('button', { name: '创建并进入 Agent 寻源' }).click();

    let requestNo = '';
    await expect.poll(async () => {
      const dashboard = await getDashboard(request);
      requestNo = dashboard.requests.find((entry) => !entry.requestNo.startsWith('SR-DEMO-'))?.requestNo ?? '';
      return dashboard.stats.total;
    }).toBe(6);
    expect(requestNo).toMatch(/^SR-LIVE-/);
    await expect(buyerPage.getByText(requestNo, { exact: false }).first()).toBeVisible();

    const agentInput = buyerPage.getByPlaceholder('可以要求 Agent 在固定条件范围内调整并重新寻源');
    await agentInput.fill('请基于内部供应商库，以及已同步的 1688、企查查、行业平台和公开网页采集数据完成寻源。');
    await buyerPage.getByRole('button', { name: '发送' }).click();
    let detail = await waitForRequestStatus(request, requestNo, 'SOURCING_READY');
    expect(detail.candidates.length).toBeGreaterThanOrEqual(4);
    expect(detail.candidates.every((candidate) => /^(INT|EXT)-SUP-DEMO-\d{3}$/.test(candidate.supplierNo))).toBeTruthy();
    expect(detail.candidates.some((candidate) => candidate.supplierNo === 'EXT-SUP-DEMO-004')).toBeTruthy();

    const previousAdjustmentActionCount = detail.agentActions.filter((action) => action.actionType === 'APPLY_FIXED_OPTIONS').length;
    await agentInput.fill('把采购物品调整为 Q235 钢板加工，规格选择 Q235B、12mm、按图切割，数量改为 50 吨，资质保持 ISO9001，交付改为 15 天，报价截止改为 30 分钟，评估策略改为价格优先，然后重新寻源。');
    await buyerPage.getByRole('button', { name: '发送' }).click();
    await expect.poll(async () => {
      detail = await getDetail(request, requestNo);
      return detail.agentActions.filter((action) => action.actionType === 'APPLY_FIXED_OPTIONS').length;
    }, { timeout: 100_000, intervals: [1_000, 2_000] }).toBeGreaterThan(previousAdjustmentActionCount);
    detail = await waitForRequestStatus(request, requestNo, 'SOURCING_READY');
    expect(detail.requiredDeliveryDays).toBe(15);
    expect(detail).toMatchObject({
      itemName: 'Q235 钢板加工',
      specification: 'Q235B、12mm、按图切割',
      quantity: 50,
      quoteDurationMinutes: 30,
      evaluationStrategy: 'PRICE_FIRST',
    });
    expect(detail.candidates.some((candidate) => candidate.supplierNo === 'EXT-SUP-DEMO-004')).toBeTruthy();

    const publishButton = buyerPage.getByRole('button', { name: /邀请全部 \d+ 家并发布询价/ });
    await expect(publishButton).toBeVisible();
    await publishButton.click();
    detail = await waitForRequestStatus(request, requestNo, 'BIDDING_OPEN');
    const rfqNo = detail.rfq?.rfqNo;
    expect(rfqNo).toMatch(/^RFQ-LIVE-/);
    expect(detail.rfq?.counts.invited).toBe(detail.candidates.length);
    await expect(buyerPage.getByText(/通知.*记录/).first()).toBeVisible();

    const internalSupplier = detail.candidates.find((candidate) => candidate.supplierType === 'INTERNAL');
    expect(internalSupplier, 'Agent 必须返回至少一家内部供应商').toBeTruthy();

    const internalContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    contexts.push(internalContext);
    const internalPage = await internalContext.newPage();
    monitorPageErrors(internalPage, browserErrors);
    await selectInternalIdentity(internalPage, internalSupplier!.supplierNo);
    await openRfqFromTable(internalPage, rfqNo!);
    await expectAttachmentDownload(internalPage, attachmentName);
    await submitInternalQuote(internalPage, '181234.56', '12');

    const duplicateInternal = await internalContext.request.post(`${INTERNAL_BASE}/api/rfqs/${encodeURIComponent(rfqNo!)}/quote`, {
      headers: { 'idempotency-key': idempotencyKey('duplicate-internal') },
      data: { totalAmount: '180000', deliveryDays: 10, remark: '不应成功的第二次报价' },
    });
    expect(duplicateInternal.status()).toBe(409);
    expect((await duplicateInternal.json()).error.code).toBe('QUOTE_ALREADY_SUBMITTED');

    const externalContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    contexts.push(externalContext);
    const externalPage = await externalContext.newPage();
    monitorPageErrors(externalPage, browserErrors);
    await registerExternalSupplier(externalPage);
    await openRfqFromTable(externalPage, rfqNo!);
    await expectAttachmentDownload(externalPage, attachmentName);
    await submitExternalQuote(externalPage, '176543.21', '13');
    const competitivenessPanel = externalPage.locator('.competitiveness-panel');
    await expect(competitivenessPanel.getByText('报价竞争力', { exact: true })).toBeVisible();
    await expect(competitivenessPanel).toContainText(/高|中|低/);
    await expect(externalPage.getByRole('button', { name: '重新报价（剩余 1 次）' })).toBeVisible();
    await externalPage.getByRole('button', { name: '重新报价（剩余 1 次）' }).click();
    await submitExternalQuote(externalPage, '175000.00', '11', true);
    await expect(externalPage.getByText('重新报价机会已用完')).toBeVisible();

    detail = await getDetail(request, requestNo);
    expect(detail.status).toBe('BIDDING_OPEN');
    expect(detail.rfq?.counts.submitted).toBe(2);
    expect(detail.revealedQuotes ?? []).toHaveLength(2);
    expect(detail.evaluation).toBeNull();
    expect(detail.revealedQuotes).toEqual(expect.arrayContaining([
      expect.objectContaining({ totalAmount: '181234.56', version: 1 }),
      expect.objectContaining({ totalAmount: '175000.00', version: 2 }),
    ]));
    const buyerPayload = JSON.stringify(detail);
    expect(buyerPayload).toContain('Playwright 内部供应商正式报价');
    expect(buyerPayload).toContain('Playwright 外部供应商重新报价');

    await buyerPage.getByRole('button', { name: '刷新' }).click();
    await expect(buyerPage.getByText('当前为实时报价阶段')).toBeVisible();
    await expect(
      buyerPage.locator('.ant-statistic').filter({ hasText: '已提交报价' }).getByText('2', { exact: true }),
    ).toBeVisible();
    await expect(buyerPage.getByText('¥181,234.56')).toBeVisible();
    await expect(buyerPage.getByText('¥175,000.00')).toBeVisible();

    const earlyEvaluation = await request.post(`${BUYER_BASE}/api/demo/v1/rfqs/${encodeURIComponent(rfqNo!)}/evaluations`, {
      headers: { 'idempotency-key': idempotencyKey('early-evaluation') },
      data: {},
    });
    expect(earlyEvaluation.status()).toBe(409);
    expect((await earlyEvaluation.json()).error.code).toBe('ILLEGAL_STATE_TRANSITION');

    await buyerPage.getByRole('button', { name: '提前停止报价' }).click();
    const stopDialog = buyerPage.getByRole('dialog', { name: '确认提前停止报价？' });
    await expect(stopDialog).toBeVisible();
    await stopDialog.getByRole('button', { name: '停止并进入评估' }).click();
    detail = await waitForRequestStatus(request, requestNo, 'EVALUATION_PENDING');
    expect(detail.revealedQuotes).toHaveLength(2);

    await externalPage.getByRole('button', { name: '刷新' }).click();
    await expect(externalPage.getByText('本次报价已经结束')).toBeVisible();
    await internalPage.getByRole('button', { name: '刷新' }).click();
    await expect(internalPage.getByText('本轮报价已经结束')).toBeVisible();

    const lateContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    contexts.push(lateContext);
    const latePage = await lateContext.newPage();
    monitorPageErrors(latePage, browserErrors);
    const lateSupplier = detail.candidates.find((candidate) => candidate.supplierType === 'INTERNAL' && candidate.supplierNo !== internalSupplier!.supplierNo);
    if (lateSupplier) {
      await selectInternalIdentity(latePage, lateSupplier.supplierNo);
      const lateQuote = await lateContext.request.post(`${INTERNAL_BASE}/api/rfqs/${encodeURIComponent(rfqNo!)}/quote`, {
        headers: { 'idempotency-key': idempotencyKey('late-quote') },
        data: { totalAmount: '170000', deliveryDays: 9, remark: '停止后报价' },
      });
      expect(lateQuote.status()).toBe(409);
      expect((await lateQuote.json()).error.code).toBe('RFQ_CLOSED');
    }

    await buyerPage.getByRole('button', { name: 'Agent 评估报价' }).click();
    detail = await waitForRequestStatus(request, requestNo, 'AWARD_PENDING', 120_000);
    expect(detail.evaluation?.items).toHaveLength(2);
    expect(detail.evaluation!.items.length).toBeLessThanOrEqual(10);
    expect(detail.evaluation?.items.some((quote) => quote.totalAmount === '175000.00')).toBe(true);
    expect(detail.evaluation?.items.some((quote) => quote.totalAmount === '176543.21')).toBe(false);

    const selectedQuote = detail.evaluation!.items[0];
    await expect(buyerPage.getByRole('button', { name: '选择一家并创建采购申请 PR' })).toBeVisible();
    await buyerPage.getByRole('button', { name: '选择一家并创建采购申请 PR' }).click();
    const prDialog = buyerPage.getByRole('dialog', { name: '确认创建采购申请 PR？' });
    await expect(prDialog).toContainText(selectedQuote.supplierName);
    await expect(prDialog).toContainText(selectedQuote.quoteNo);
    await prDialog.getByRole('button', { name: '确认创建 PR' }).click();
    detail = await waitForRequestStatus(request, requestNo, 'COMPLETED');
    expect(detail.purchaseRequisition).toMatchObject({
      quoteNo: selectedQuote.quoteNo,
      supplierNo: selectedQuote.supplierNo,
      totalAmount: selectedQuote.totalAmount,
      deliveryDays: selectedQuote.deliveryDays,
    });
    await expect(buyerPage.getByText(new RegExp(`采购申请 ${detail.purchaseRequisition!.prNo} 已创建`))).toBeVisible();

    const mobileBuyerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    contexts.push(mobileBuyerContext);
    const mobileBuyerPage = await mobileBuyerContext.newPage();
    monitorPageErrors(mobileBuyerPage, browserErrors);
    await mobileBuyerPage.goto(`${BUYER_BASE}/agents/sourcing`);
    await expect(mobileBuyerPage.getByRole('heading', { name: '从寻源需求到采购申请，一页完成智能闭环' })).toBeVisible();
    await expect(mobileBuyerPage.getByText('SR-DEMO-0001')).toBeVisible();
    const mobileContent = await mobileBuyerPage.locator('.app-content').boundingBox();
    expect(mobileContent?.width).toBeGreaterThanOrEqual(350);
    await expectNoPageHorizontalOverflow(mobileBuyerPage);

    await internalPage.setViewportSize({ width: 390, height: 844 });
    await internalPage.goto(`${INTERNAL_BASE}/rfqs`);
    await expectNoPageHorizontalOverflow(internalPage);
    await externalPage.setViewportSize({ width: 390, height: 844 });
    await externalPage.goto(`${EXTERNAL_BASE}/rfqs`);
    await expectNoPageHorizontalOverflow(externalPage);

    const repeatPr = await request.post(`${BUYER_BASE}/api/demo/v1/sourcing-requests/${encodeURIComponent(requestNo)}/purchase-requisition`, {
      headers: { 'idempotency-key': idempotencyKey('repeat-pr') },
      data: { quoteNo: selectedQuote.quoteNo },
    });
    expect(repeatPr.ok(), await repeatPr.text()).toBeTruthy();
    expect(((await repeatPr.json()) as ApiEnvelope<RequestDetail>).data.purchaseRequisition?.prNo).toBe(detail.purchaseRequisition!.prNo);
    expect(browserErrors, `浏览器页面出现未处理异常：\n${browserErrors.join('\n')}`).toEqual([]);

    await resetDemo(request);
    expect((await getDashboard(request)).stats.total).toBe(5);
    await externalPage.reload();
    await expect(externalPage).toHaveURL(/\/register$/);
    await internalPage.reload();
    await expect(internalPage).toHaveURL(/\/$/);
  } finally {
    await resetDemo(request).catch(() => undefined);
    await Promise.all(contexts.map((context) => context.close()));
  }
});
