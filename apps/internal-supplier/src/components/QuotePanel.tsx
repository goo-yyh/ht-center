'use client';

import {
  CheckCircleFilled,
  EditOutlined,
  LineChartOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Descriptions, Form, Input, InputNumber, Modal, Space, Tag, Typography, message } from 'antd';
import { useState } from 'react';

import { BrowserApiError, readableError, requestJson } from '@/src/lib/browser-api';
import { formatDateTime, formatMoney } from '@/src/lib/format';
import type { QuoteReceipt } from '@/src/lib/types';
import type { QuoteCompetitiveness } from '@haitian/sourcing-contracts';

interface QuoteFormValue {
  totalAmount: string;
  deliveryDays: number;
  remark?: string;
}

interface QuotePanelProps {
  rfqNo: string;
  isOpen: boolean;
  receipt: QuoteReceipt | null;
  onSubmitted: (submittedReceipt?: QuoteReceipt) => Promise<void>;
}

const competitivenessCopy: Record<QuoteCompetitiveness, { label: string; summary: string; className: string; color?: string }> = {
  HIGH: {
    label: '高',
    summary: '当前报价在价格和交期方面具有较强竞争力。',
    className: 'competitiveness-high',
  },
  MEDIUM: {
    label: '中',
    summary: '当前报价竞争力处于中等水平，可结合价格或交期进一步优化。',
    className: 'competitiveness-medium',
    color: 'warning',
  },
  LOW: {
    label: '低',
    summary: '当前报价竞争力偏低，建议在重新报价时优化价格或交期。',
    className: 'competitiveness-low',
  },
};

function CompetitivenessTag({ value, pendingLabel = '分析中' }: { value: QuoteCompetitiveness | null; pendingLabel?: string }) {
  if (!value) return <Tag>{pendingLabel}</Tag>;
  const presentation = competitivenessCopy[value];
  return <Tag className={value === 'HIGH' ? 'theme-status-tag' : undefined} color={presentation.color}>{presentation.label}</Tag>;
}

export function QuotePanel({ rfqNo, isOpen, receipt, onSubmitted }: QuotePanelProps) {
  const [form] = Form.useForm<QuoteFormValue>();
  const [submitting, setSubmitting] = useState(false);
  const [requoteMode, setRequoteMode] = useState(false);
  const [pendingQuote, setPendingQuote] = useState<QuoteFormValue | null>(null);
  const [pendingQuoteKey, setPendingQuoteKey] = useState<string>();
  const [pendingQuoteMode, setPendingQuoteMode] = useState<'INITIAL' | 'REQUOTE'>('INITIAL');
  const [messageApi, messageContext] = message.useMessage();

  const canRequote = Boolean(isOpen && receipt?.canRequote && receipt.remainingRequotes > 0);
  const pendingQuoteIsAllowed = pendingQuoteMode === 'REQUOTE' ? canRequote : Boolean(isOpen && !receipt);

  function clearPendingQuote() {
    setPendingQuote(null);
    setPendingQuoteKey(undefined);
    setPendingQuoteMode('INITIAL');
  }

  async function submit() {
    if (!pendingQuote || !pendingQuoteIsAllowed) {
      clearPendingQuote();
      setRequoteMode(false);
      messageApi.warning('报价状态已经变化，已取消本次提交并刷新最新详情');
      void onSubmitted().catch(() => messageApi.error('最新报价详情刷新失败，请点击页面刷新按钮重试'));
      return;
    }
    const idempotencyKey = pendingQuoteKey ?? crypto.randomUUID();
    if (!pendingQuoteKey) setPendingQuoteKey(idempotencyKey);
    const isRequote = pendingQuoteMode === 'REQUOTE';
    setSubmitting(true);
    try {
      const result = await requestJson<QuoteReceipt>(`/api/rfqs/${encodeURIComponent(rfqNo)}/quote`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
        body: JSON.stringify(pendingQuote),
      });
      clearPendingQuote();
      setRequoteMode(false);
      form.resetFields();
      messageApi.success(isRequote ? '重新报价提交成功，本次报价已锁定' : '首次报价提交成功，可查看报价竞争力');
      void onSubmitted(result.data).catch(() => messageApi.warning('报价已提交成功，但最新详情刷新失败，请点击页面刷新按钮重试'));
    } catch (reason) {
      if (reason instanceof BrowserApiError && reason.code === 'QUOTE_ALREADY_SUBMITTED') {
        clearPendingQuote();
        setRequoteMode(false);
        messageApi.warning('该询价的重新报价机会已经用完，已为你刷新报价详情');
        void onSubmitted().catch(() => messageApi.error('最新报价详情刷新失败，请点击页面刷新按钮重试'));
      } else {
        messageApi.error(readableError(reason));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function prepareQuote(values: QuoteFormValue, isRequote: boolean) {
    setPendingQuote({ ...values, remark: values.remark?.trim() ?? '' });
    setPendingQuoteKey(crypto.randomUUID());
    setPendingQuoteMode(isRequote ? 'REQUOTE' : 'INITIAL');
  }

  function beginRequote() {
    if (!receipt || !canRequote) return;
    form.setFieldsValue({
      totalAmount: receipt.totalAmount,
      deliveryDays: receipt.deliveryDays,
      remark: receipt.remark ?? '',
    });
    setRequoteMode(true);
  }

  function renderQuoteForm(isRequote: boolean) {
    return (
      <Card
        className="portal-card quote-form-card"
        title={<Space><EditOutlined className="theme-primary-icon" /><span>{isRequote ? '重新报价' : '提交正式报价'}</span></Space>}
        extra={isRequote ? <Tag color="orange">剩余 1 次</Tag> : undefined}
      >
        <Alert
          className="quote-rule-alert"
          type={isRequote ? 'warning' : 'info'}
          showIcon
          message={isRequote ? '这是最后一次报价机会' : '首次报价后可查看竞争力分析'}
          description={isRequote
            ? '请根据竞争力分析调整金额、交期或商务条件。本次提交后报价将锁定，不能再次修改。'
            : '首次报价提交后，系统会分析报价竞争力（高、中、低），并保留一次重新报价机会。'}
        />
        <Form<QuoteFormValue> form={form} layout="vertical" requiredMark="optional" onFinish={(values) => prepareQuote(values, isRequote)}>
          <div className="quote-form-grid">
            <Form.Item
              label="报价总价（元）"
              name="totalAmount"
              rules={[
                { required: true, message: '请输入报价总价' },
                { pattern: /^\d+(?:\.\d{1,2})?$/, message: '请输入大于 0 且最多两位小数的金额' },
                { validator: (_, value) => Number(value) > 0 ? Promise.resolve() : Promise.reject(new Error('报价总价必须大于 0')) },
              ]}
            >
              <Input inputMode="decimal" prefix="¥" placeholder="例如：128000.00" maxLength={16} />
            </Form.Item>
            <Form.Item label="承诺交期（天）" name="deliveryDays" rules={[{ required: true, message: '请输入承诺交期' }]}>
              <InputNumber min={1} max={365} precision={0} placeholder="例如：15" className="full-width" />
            </Form.Item>
          </div>
          <Form.Item label="报价备注" name="remark" rules={[{ max: 500, message: '备注不能超过 500 个字符' }]}>
            <Input.TextArea rows={4} showCount maxLength={500} placeholder="可填写付款条件、包装说明等简要商务信息" />
          </Form.Item>
          <div className="quote-submit-row">
            <Typography.Text type="secondary">点击提交后会再次展示完整内容供您确认。</Typography.Text>
            <Space wrap>
              <Button type="primary" htmlType="submit" size="large" icon={<SendOutlined />}>
                {isRequote ? '预览并确认重新报价' : '预览并提交报价'}
              </Button>
              {isRequote ? <Button size="large" onClick={() => { form.resetFields(); setRequoteMode(false); }}>取消重新报价</Button> : null}
            </Space>
          </div>
        </Form>
      </Card>
    );
  }

  function renderReceiptCard(currentReceipt: QuoteReceipt) {
    const competition = currentReceipt.competitiveness ? competitivenessCopy[currentReceipt.competitiveness] : null;
    return (
      <Card
        className="portal-card quote-receipt"
        title={<Space><CheckCircleFilled className="theme-primary-icon" /><span>报价详情</span></Space>}
        extra={!isOpen
          ? <Tag>报价已结束</Tag>
          : canRequote
            ? <Tag className="theme-status-tag">剩余 1 次重新报价</Tag>
            : <Tag>重新报价机会已用完</Tag>}
      >
        <Alert
          className="quote-state-alert"
          type={canRequote ? 'info' : 'success'}
          showIcon
          message={canRequote ? '首次报价已提交，可根据分析再报价一次' : isOpen ? '当前报价已锁定' : '本轮报价已经结束'}
          description={canRequote
            ? '系统已根据本次提交时的有效报价分析竞争力。你可以保留当前报价，也可以在截止前使用唯一一次重新报价机会。'
            : isOpen ? '重新报价机会已经用完，当前报价不能再次修改。' : '采购方已停止接收报价，当前报价不能再修改。'}
        />

        <div className={`competitiveness-panel ${competition?.className ?? 'competitiveness-pending'}`}>
          <div className="competitiveness-heading">
            <Space><LineChartOutlined /><Typography.Text strong>报价竞争力</Typography.Text></Space>
            <CompetitivenessTag value={currentReceipt.competitiveness} />
          </div>
          <Typography.Text type="secondary">
            {competition?.summary ?? '系统正在结合其他有效报价分析价格与交期竞争力，请稍后刷新查看。'}
          </Typography.Text>
        </div>

        <Descriptions className="receipt-descriptions" bordered column={{ xs: 1, sm: 2 }}>
          <Descriptions.Item label="报价编号">{currentReceipt.quoteNo}</Descriptions.Item>
          <Descriptions.Item label="当前版本"><Tag className="theme-status-tag">V{currentReceipt.version}</Tag></Descriptions.Item>
          {currentReceipt.receiptNo ? <Descriptions.Item label="回执编号">{currentReceipt.receiptNo}</Descriptions.Item> : null}
          <Descriptions.Item label="报价总价"><Typography.Text strong className="amount-text">{formatMoney(currentReceipt.totalAmount)}</Typography.Text></Descriptions.Item>
          <Descriptions.Item label="承诺交期">{currentReceipt.deliveryDays} 天</Descriptions.Item>
          <Descriptions.Item label="提交时间">{formatDateTime(currentReceipt.submittedAt)}</Descriptions.Item>
          <Descriptions.Item label="报价备注" span="filled">{currentReceipt.remark || '无'}</Descriptions.Item>
        </Descriptions>

        <div className="quote-history" aria-label={`报价历史，共 ${currentReceipt.versions.length} 版`}>
          <div className="quote-history-heading">
            <Typography.Text strong>报价历史</Typography.Text>
            <Typography.Text type="secondary">已保留 {currentReceipt.versions.length} / {currentReceipt.maxVersions} 版</Typography.Text>
          </div>
          <div className="quote-version-list">
            {currentReceipt.versions.map((version) => (
              <div className={`quote-version-item${version.version === currentReceipt.version ? ' quote-version-current' : ''}`} key={`${version.quoteNo}-${version.version}`}>
                <div className="quote-version-heading">
                  <Space size={8}>
                    <Tag className={version.version === currentReceipt.version ? 'theme-status-tag' : undefined}>V{version.version}</Tag>
                    {version.version === currentReceipt.version ? <Typography.Text className="quote-current-label">当前版本</Typography.Text> : null}
                  </Space>
                  <CompetitivenessTag value={version.competitiveness} pendingLabel="无分析" />
                </div>
                <div className="quote-version-values">
                  <Typography.Text strong>{formatMoney(version.totalAmount)}</Typography.Text>
                  <Typography.Text>{version.deliveryDays} 天交货</Typography.Text>
                </div>
                <Typography.Text type="secondary" className="quote-version-time">{formatDateTime(version.submittedAt)}</Typography.Text>
                <Typography.Paragraph ellipsis={{ rows: 2, expandable: true, symbol: '展开' }} className="quote-version-remark">
                  {version.remark || '无报价备注'}
                </Typography.Paragraph>
              </div>
            ))}
          </div>
        </div>

        {canRequote && !requoteMode ? (
          <Button type="primary" icon={<EditOutlined />} size="large" className="requote-button" onClick={beginRequote}>
            重新报价（剩余 1 次）
          </Button>
        ) : null}
      </Card>
    );
  }

  const quoteContent = receipt
    ? <>{renderReceiptCard(receipt)}{requoteMode && canRequote ? renderQuoteForm(true) : null}</>
    : isOpen
      ? renderQuoteForm(false)
      : <Card className="portal-card"><Alert type="warning" showIcon message="报价已经结束" description="当前询价不再接受新报价，且本供应商没有已提交的报价。" /></Card>;

  return (
    <>
      {messageContext}
      {quoteContent}
      <Modal
        title={pendingQuoteMode === 'REQUOTE' ? '确认重新报价' : '确认提交正式报价？'}
        open={Boolean(pendingQuote && pendingQuoteIsAllowed)}
        okText={pendingQuoteMode === 'REQUOTE' ? '确认并提交重新报价' : '确认并提交'}
        cancelText="返回检查"
        confirmLoading={submitting}
        closable={!submitting}
        maskClosable={!submitting}
        onCancel={() => { if (!submitting) clearPendingQuote(); }}
        onOk={() => void submit()}
      >
        <div className="quote-confirm">
          <Alert
            type="warning"
            showIcon
            icon={<SafetyCertificateOutlined />}
            message={pendingQuoteMode === 'REQUOTE'
              ? '本次提交将使用唯一一次重新报价机会，提交后不能再次修改。'
              : '首次提交后可查看竞争力分析，并保留一次重新报价机会。'}
          />
          {pendingQuote ? (
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="报价总价">{formatMoney(pendingQuote.totalAmount)}</Descriptions.Item>
              <Descriptions.Item label="承诺交期">{pendingQuote.deliveryDays} 天</Descriptions.Item>
              <Descriptions.Item label="报价备注">{pendingQuote.remark || '无'}</Descriptions.Item>
            </Descriptions>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
