'use client';

import { CheckCircleFilled, SendOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Descriptions, Form, Input, InputNumber, Modal, Space, Tag, Typography, message } from 'antd';
import { useState } from 'react';

import { BrowserApiError, readableError, requestJson } from '@/src/lib/browser-api';
import { formatDateTime, formatMoney } from '@/src/lib/format';
import type { QuoteReceipt } from '@/src/lib/types';

interface QuoteFormValue {
  totalAmount: string;
  deliveryDays: number;
  remark?: string;
}

interface QuotePanelProps {
  rfqNo: string;
  isOpen: boolean;
  receipt: QuoteReceipt | null;
  onSubmitted: () => Promise<void>;
}

export function QuotePanel({ rfqNo, isOpen, receipt, onSubmitted }: QuotePanelProps) {
  const [form] = Form.useForm<QuoteFormValue>();
  const [submitting, setSubmitting] = useState(false);
  const [modal, modalContext] = Modal.useModal();
  const [messageApi, messageContext] = message.useMessage();

  async function submit(values: QuoteFormValue) {
    setSubmitting(true);
    try {
      await requestJson<QuoteReceipt>(`/api/rfqs/${encodeURIComponent(rfqNo)}/quote`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify(values),
      });
      messageApi.success('报价提交成功');
      form.resetFields();
      await onSubmitted();
    } catch (reason) {
      if (reason instanceof BrowserApiError && reason.code === 'QUOTE_ALREADY_SUBMITTED') {
        messageApi.warning('该询价已提交过报价，正在加载报价回执');
        await onSubmitted();
      } else {
        messageApi.error(readableError(reason));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function confirm(values: QuoteFormValue) {
    modal.confirm({
      title: '确认提交正式报价？',
      icon: <SafetyCertificateOutlined className="confirm-icon" />,
      width: 520,
      content: (
        <div className="quote-confirm">
          <Alert type="warning" showIcon message="正式报价只能提交一次，提交后不能修改、撤回或再次报价。" />
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="报价总价">{formatMoney(values.totalAmount)}</Descriptions.Item>
            <Descriptions.Item label="承诺交期">{values.deliveryDays} 天</Descriptions.Item>
            <Descriptions.Item label="报价备注">{values.remark || '无'}</Descriptions.Item>
          </Descriptions>
        </div>
      ),
      okText: '确认并提交',
      cancelText: '返回检查',
      okButtonProps: { danger: true },
      onOk: () => submit(values),
    });
  }

  if (receipt) {
    return (
      <Card className="portal-card quote-receipt" title={<Space><CheckCircleFilled /><span>报价提交回执</span></Space>}>
        {modalContext}{messageContext}
        <Alert
          type="success"
          showIcon
          message={isOpen ? '您的正式报价已经提交' : '本轮报价已经结束'}
          description={isOpen
            ? '采购人员和寻源 Agent 可以查看该报价；内部供应商每个询价只能提交一次，提交后不可修改或撤回。'
            : '采购方已停止接收报价；您的正式报价仍不可修改或撤回。'}
        />
        <Descriptions className="receipt-descriptions" bordered column={{ xs: 1, sm: 2 }}>
          <Descriptions.Item label="报价编号">{receipt.quoteNo}</Descriptions.Item>
          <Descriptions.Item label="提交状态"><Tag color="success">已正式提交</Tag></Descriptions.Item>
          <Descriptions.Item label="报价版本"><Tag>V{receipt.version}</Tag></Descriptions.Item>
          {receipt.receiptNo ? <Descriptions.Item label="回执编号">{receipt.receiptNo}</Descriptions.Item> : null}
          <Descriptions.Item label="报价总价"><Typography.Text strong className="amount-text">{formatMoney(receipt.totalAmount)}</Typography.Text></Descriptions.Item>
          <Descriptions.Item label="承诺交期">{receipt.deliveryDays} 天</Descriptions.Item>
          <Descriptions.Item label="提交时间" span="filled">{formatDateTime(receipt.submittedAt)}</Descriptions.Item>
          <Descriptions.Item label="报价备注" span="filled">{receipt.remark || '无'}</Descriptions.Item>
        </Descriptions>
      </Card>
    );
  }

  if (!isOpen) {
    return (
      <Card className="portal-card">
        {modalContext}{messageContext}
        <Alert type="warning" showIcon message="报价已经结束" description="当前询价不再接受新报价，且本供应商没有已提交的报价。" />
      </Card>
    );
  }

  return (
    <Card className="portal-card" title={<Space><SendOutlined /><span>提交正式报价</span></Space>}>
      {modalContext}{messageContext}
      <Alert
        className="quote-rule-alert"
        type="info"
        showIcon
        message="内部供应商仅有一次正式报价机会"
        description="采购人员和寻源 Agent 会实时查看报价内容，请在提交前仔细核对总价、交期和备注。"
      />
      <Form<QuoteFormValue> form={form} layout="vertical" requiredMark="optional" onFinish={confirm}>
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
          <Button type="primary" htmlType="submit" size="large" icon={<SendOutlined />} loading={submitting}>预览并提交报价</Button>
        </div>
      </Form>
    </Card>
  );
}
