'use client';

import {
  ArrowLeftOutlined,
  CheckCircleFilled,
  DownloadOutlined,
  EditOutlined,
  FileTextOutlined,
  LineChartOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Skeleton,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  QuoteCompetitiveness,
  QuoteCompetitivenessLevel,
  QuoteInput,
  QuoteReceipt,
  RfqDetail,
} from '@/src/contracts';
import { portalDownload, portalFetch, PortalApiError, shouldReturnToRegister } from '@/src/client/api';
import { PortalShell } from '@/src/components/PortalShell';
import { isRfqOpen, StatusTag } from '@/src/components/StatusTag';

const { Paragraph, Text, Title } = Typography;

const competitivenessPresentation: Record<QuoteCompetitivenessLevel, { color?: string; className: string; tagClassName?: string }> = {
  HIGH: { className: 'competitiveness-high', tagClassName: 'theme-status-tag' },
  MEDIUM: { color: 'warning', className: 'competitiveness-medium' },
  LOW: { className: 'competitiveness-low' },
};

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'long', timeStyle: 'medium' }).format(date);
}

function formatMoney(value: string): string {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(number)
    : value;
}

function formatBytes(value?: number): string {
  if (value == null) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function CompetitivenessTag({ value, pendingLabel = '分析中' }: { value?: QuoteCompetitiveness; pendingLabel?: string }) {
  if (!value) return <Tag>{pendingLabel}</Tag>;
  const presentation = competitivenessPresentation[value.level];
  return (
    <Tag className={presentation.tagClassName} color={presentation.color}>
      {value.label}
    </Tag>
  );
}

function Deadline({ deadlineAt, now }: { deadlineAt?: string; now: number }) {
  if (!deadlineAt) return <Text>未设置</Text>;
  const remaining = Date.parse(deadlineAt) - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return <Tag>报价已截止</Tag>;
  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return <Tag color="orange">剩余 {days > 0 ? `${days}天 ` : ''}{hours}时 {minutes}分 {seconds}秒</Tag>;
}

interface RfqDetailPageClientProps {
  rfqNo: string;
}

export default function RfqDetailPageClient({ rfqNo }: RfqDetailPageClientProps) {
  const router = useRouter();
  const { message } = App.useApp();
  const [form] = Form.useForm<QuoteInput>();
  const [detail, setDetail] = useState<RfqDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState<number>();
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [clientNow, setClientNow] = useState(() => Date.now());
  const [pendingQuote, setPendingQuote] = useState<QuoteInput | null>(null);
  const [pendingQuoteKey, setPendingQuoteKey] = useState<string>();
  const [pendingQuoteMode, setPendingQuoteMode] = useState<'INITIAL' | 'REQUOTE'>('INITIAL');
  const [submitting, setSubmitting] = useState(false);
  const [requoteMode, setRequoteMode] = useState(false);
  const [downloadingAttachmentId, setDownloadingAttachmentId] = useState<string>();
  const viewed = useRef(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const result = await portalFetch<RfqDetail>(`/api/rfqs/${encodeURIComponent(rfqNo)}`);
      setDetail(result.data);
      setRevision(result.meta?.revision);
      if (result.meta?.serverTime) {
        const serverNow = Date.parse(result.meta.serverTime);
        if (Number.isFinite(serverNow)) setServerOffsetMs(serverNow - Date.now());
      }
      setError(undefined);
    } catch (caught) {
      if (shouldReturnToRegister(caught)) {
        router.replace('/register');
        return;
      }
      setError(caught instanceof Error ? caught.message : '询价详情加载失败');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [rfqNo, router]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void load(), 0);
    if (!viewed.current) {
      viewed.current = true;
      void portalFetch(`/api/rfqs/${encodeURIComponent(rfqNo)}/view`, { method: 'POST' }).catch((caught) => {
        viewed.current = false;
        if (shouldReturnToRegister(caught)) router.replace('/register');
        else message.error(caught instanceof Error ? caught.message : '询价查看状态记录失败，将自动重试');
      });
    }
    const timer = window.setInterval(() => void load(true), 5_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [load, message, rfqNo, router]);

  useEffect(() => {
    const timer = window.setInterval(() => setClientNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  async function downloadAttachment(attachmentId: string, fileName: string) {
    setDownloadingAttachmentId(attachmentId);
    try {
      await portalDownload(
        `/api/rfqs/${encodeURIComponent(rfqNo)}/attachments/${encodeURIComponent(attachmentId)}`,
        fileName,
      );
      message.success(`${fileName} 已开始下载`);
    } catch (caught) {
      if (shouldReturnToRegister(caught)) router.replace('/register');
      else message.error(caught instanceof Error ? caught.message : '采购附件下载失败');
    } finally {
      setDownloadingAttachmentId(undefined);
    }
  }

  async function confirmQuote() {
    if (!pendingQuote) return;
    const idempotencyKey = pendingQuoteKey ?? window.crypto.randomUUID();
    if (!pendingQuoteKey) setPendingQuoteKey(idempotencyKey);
    const isRequote = pendingQuoteMode === 'REQUOTE';
    setSubmitting(true);
    try {
      await portalFetch(`/api/rfqs/${encodeURIComponent(rfqNo)}/quotes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify(pendingQuote),
      });
      setPendingQuote(null);
      setPendingQuoteKey(undefined);
      setPendingQuoteMode('INITIAL');
      setRequoteMode(false);
      form.resetFields();
      message.success(isRequote ? '重新报价提交成功，本次报价已锁定' : '首次报价提交成功，可查看报价竞争力');
      await load(true);
    } catch (caught) {
      if (shouldReturnToRegister(caught)) {
        router.replace('/register');
      } else if (caught instanceof PortalApiError && caught.code === 'QUOTE_ALREADY_SUBMITTED') {
        setPendingQuote(null);
        setPendingQuoteKey(undefined);
        setPendingQuoteMode('INITIAL');
        setRequoteMode(false);
        message.warning('该询价的重新报价机会已经用完，已为你刷新报价详情');
        await load(true);
      } else {
        message.error(caught instanceof Error ? caught.message : '报价提交失败');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const serverNow = clientNow + serverOffsetMs;
  const open = detail ? isRfqOpen(detail.status, detail.deadlineAt, serverNow) : false;
  const quoteReceipt = detail?.quoteReceipt;
  const canRequote = Boolean(open && quoteReceipt?.canRequote && quoteReceipt.remainingRequotes > 0);

  function beginRequote() {
    if (!quoteReceipt || !canRequote) return;
    form.setFieldsValue({
      totalAmount: quoteReceipt.totalAmount,
      deliveryDays: quoteReceipt.deliveryDays,
      remark: quoteReceipt.remark ?? '',
    });
    setRequoteMode(true);
  }

  function renderQuoteForm(isRequote: boolean) {
    return (
      <Card
        className="surface-card quote-form-card"
        title={<Space><EditOutlined className="theme-primary-icon" />{isRequote ? '重新报价' : '提交报价'}</Space>}
        extra={isRequote ? <Tag color="orange">剩余 1 次</Tag> : undefined}
      >
        <Alert
          className="quote-guidance-alert"
          type={isRequote ? 'warning' : 'info'}
          showIcon
          message={isRequote ? '这是最后一次报价机会' : '首次报价后可查看竞争力分析'}
          description={isRequote
            ? '请根据竞争力分析调整金额、交期或商务条件。本次提交后报价将锁定，不能再次修改。'
            : '首次报价提交后，系统会分析报价竞争力（高、中、低），并保留一次重新报价机会。'}
          style={{ marginBottom: 20 }}
        />
        <Form<QuoteInput>
          form={form}
          layout="vertical"
          requiredMark="optional"
          onFinish={(values) => {
            setPendingQuote({ ...values, remark: values.remark?.trim() ?? '' });
            setPendingQuoteKey(window.crypto.randomUUID());
            setPendingQuoteMode(isRequote ? 'REQUOTE' : 'INITIAL');
          }}
        >
          <Form.Item label="含税总报价（元）" name="totalAmount" rules={[{ required: true, message: '请输入含税总报价' }, { pattern: /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/, message: '请输入最多两位小数的有效金额' }, { validator: (_, value) => Number(value) > 0 ? Promise.resolve() : Promise.reject(new Error('报价金额必须大于 0')) }]}>
            <Input inputMode="decimal" prefix="¥" placeholder="例如：128000.00" />
          </Form.Item>
          <Form.Item label="交货周期（天）" name="deliveryDays" rules={[{ required: true, message: '请输入交货周期' }, { type: 'number', min: 1, max: 365, message: '交货周期为 1 至 365 天' }]}>
            <InputNumber min={1} max={365} precision={0} style={{ width: '100%' }} placeholder="从订单确认之日起计算" />
          </Form.Item>
          <Form.Item label="商务备注" name="remark" rules={[{ max: 500, message: '备注不能超过 500 个字' }]}>
            <Input.TextArea rows={4} maxLength={500} showCount placeholder="可填写付款条件、报价有效期等补充说明" />
          </Form.Item>
          <Space wrap>
            <Button type="primary" size="large" htmlType="submit">{isRequote ? '预览并确认重新报价' : '预览并确认报价'}</Button>
            {isRequote && <Button size="large" onClick={() => { form.resetFields(); setRequoteMode(false); }}>取消重新报价</Button>}
          </Space>
        </Form>
      </Card>
    );
  }

  function renderQuoteReceiptCard(receipt: QuoteReceipt) {
    return (
      <Card
        className="surface-card receipt-card"
        title={<Space><CheckCircleFilled className="theme-primary-icon" />报价详情</Space>}
        extra={!open
          ? <Tag>报价已结束</Tag>
          : canRequote
            ? <Tag className="theme-status-tag">剩余 1 次重新报价</Tag>
            : <Tag>重新报价机会已用完</Tag>}
      >
        <Alert
          className="quote-state-alert"
          type={canRequote ? 'info' : 'success'}
          showIcon
          message={canRequote ? '首次报价已提交，可根据分析再报价一次' : '当前报价已锁定'}
          description={canRequote
            ? '系统已根据本次提交时的有效报价分析竞争力。你可以保留当前报价，也可以在截止前使用唯一一次重新报价机会。'
            : open ? '重新报价机会已经用完，当前报价不能再次修改。' : '本次报价已经结束，当前报价不能再修改。'}
          style={{ marginBottom: 18 }}
        />
        <div className={`competitiveness-panel ${receipt.competitiveness ? competitivenessPresentation[receipt.competitiveness.level].className : 'competitiveness-pending'}`}>
          <div className="competitiveness-heading">
            <Space>
              <LineChartOutlined />
              <Text strong>报价竞争力</Text>
            </Space>
            <CompetitivenessTag value={receipt.competitiveness} />
          </div>
          <Text type="secondary">
            {receipt.competitiveness?.summary ?? '系统正在结合其他有效报价分析价格与交期竞争力，请稍后刷新查看。'}
          </Text>
        </div>
        <Descriptions column={{ xs: 1, sm: 2, lg: 4 }} bordered size="small">
          <Descriptions.Item label="报价编号">{receipt.quoteNo}</Descriptions.Item>
          <Descriptions.Item label="当前版本">V{receipt.version} / 共 {receipt.versionCount} 版</Descriptions.Item>
          <Descriptions.Item label="总报价">{formatMoney(receipt.totalAmount)}</Descriptions.Item>
          <Descriptions.Item label="交货周期">{receipt.deliveryDays} 天</Descriptions.Item>
          <Descriptions.Item label="提交时间">{formatDate(receipt.submittedAt)}</Descriptions.Item>
          <Descriptions.Item label="商务备注" span="filled">{receipt.remark || '无'}</Descriptions.Item>
        </Descriptions>

        <div className="quote-history" aria-label={`报价历史，共 ${receipt.versions.length} 版`}>
          <div className="quote-history-heading">
            <Text strong>报价历史</Text>
            <Text type="secondary">已保留 {receipt.versions.length} / {receipt.maxVersions} 版</Text>
          </div>
          <div className="quote-version-list">
            {receipt.versions.map((version) => (
              <div className={`quote-version-item${version.version === receipt.version ? ' quote-version-current' : ''}`} key={`${version.quoteNo}-${version.version}`}>
                <div className="quote-version-heading">
                  <Space size={8}>
                    <Tag className={version.version === receipt.version ? 'theme-status-tag' : undefined}>V{version.version}</Tag>
                    {version.version === receipt.version && <Text className="quote-current-label">当前版本</Text>}
                  </Space>
                  <CompetitivenessTag value={version.competitiveness} pendingLabel="无分析" />
                </div>
                <div className="quote-version-values">
                  <Text strong>{formatMoney(version.totalAmount)}</Text>
                  <Text>{version.deliveryDays} 天交货</Text>
                </div>
                <Text type="secondary" className="quote-version-time">{formatDate(version.submittedAt)}</Text>
                <Paragraph ellipsis={{ rows: 2, expandable: true, symbol: '展开' }} className="quote-version-remark">
                  {version.remark || '无商务备注'}
                </Paragraph>
              </div>
            ))}
          </div>
        </div>

        {canRequote && !requoteMode && (
          <Button type="primary" icon={<EditOutlined />} size="large" style={{ marginTop: 18 }} onClick={beginRequote}>
            重新报价（剩余 1 次）
          </Button>
        )}
      </Card>
    );
  }

  return (
    <PortalShell showIdentity identity={detail?.supplier}>
      <div className="page-heading">
        <div>
          <Button type="link" icon={<ArrowLeftOutlined />} style={{ paddingLeft: 0 }} onClick={() => router.push('/rfqs')}>返回询价列表</Button>
          <h1>{detail?.title ?? '询价详情'}</h1>
          <p>{rfqNo} · 仅当前受邀企业可查看和参与</p>
        </div>
        <div className="detail-actions">
          {revision != null && <Tag>数据版本 {revision}</Tag>}
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button>
        </div>
      </div>

      {loading && !detail ? (
        <Card className="surface-card"><Skeleton active paragraph={{ rows: 10 }} /></Card>
      ) : error && !detail ? (
        <Alert type="error" showIcon message="询价详情加载失败" description={error} action={<Button size="small" onClick={() => void load()}>重试</Button>} />
      ) : detail ? (
        <div className="section-stack">
          {error && <Alert type="warning" showIcon message="自动刷新失败" description={error} />}

          {detail.quoteReceipt && renderQuoteReceiptCard(detail.quoteReceipt)}
          {detail.quoteReceipt && requoteMode && renderQuoteForm(true)}

          <Card className="surface-card detail-requirement-card" title="采购需求" extra={<StatusTag status={detail.status} submittedAt={detail.submittedAt} />}>
            <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} bordered size="small">
              <Descriptions.Item label="询价编号">{detail.rfqNo}</Descriptions.Item>
              <Descriptions.Item label="需求编号">{detail.requestNo ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="采购物品">{detail.itemName}</Descriptions.Item>
              <Descriptions.Item label="规格型号">{detail.specification}</Descriptions.Item>
              <Descriptions.Item label="采购数量">{detail.quantity == null ? '—' : `${detail.quantity} ${detail.unit ?? ''}`}</Descriptions.Item>
              <Descriptions.Item label="要求交期">{detail.requiredDeliveryDays == null ? '—' : `${detail.requiredDeliveryDays} 天内`}</Descriptions.Item>
              <Descriptions.Item label="报价截止">{formatDate(detail.deadlineAt)}</Descriptions.Item>
              <Descriptions.Item label="剩余时间">{open ? <Deadline deadlineAt={detail.deadlineAt} now={serverNow} /> : '报价已结束'}</Descriptions.Item>
              {detail.description && <Descriptions.Item label="需求说明" span="filled">{detail.description}</Descriptions.Item>}
              <Descriptions.Item label="执行标准" span="filled">{detail.standards.length ? detail.standards.join('、') : '以采购附件为准'}</Descriptions.Item>
              <Descriptions.Item label="资质要求" span="filled">{detail.qualificationRequirements.length ? detail.qualificationRequirements.join('、') : '以采购附件为准'}</Descriptions.Item>
            </Descriptions>
          </Card>

          <Card className="surface-card" title="采购附件">
            {detail.attachments.length ? detail.attachments.map((attachment) => (
              <div className="attachment-item" key={attachment.attachmentId}>
                <Space align="start">
                  <FileTextOutlined style={{ color: '#e60012', fontSize: 22 }} />
                  <div>
                    <Text strong>{attachment.fileName}</Text><br />
                    <Text type="secondary">{[attachment.mimeType, formatBytes(attachment.sizeBytes)].filter(Boolean).join(' · ') || '采购资料'}</Text>
                  </div>
                </Space>
                <Button
                  icon={<DownloadOutlined />}
                  loading={downloadingAttachmentId === attachment.attachmentId}
                  onClick={() => void downloadAttachment(attachment.attachmentId, attachment.fileName)}
                >
                  下载查看
                </Button>
              </div>
            )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无采购附件" />}
          </Card>

          {!detail.quoteReceipt && (open ? renderQuoteForm(false) : (
            <Alert type="info" showIcon message="本次报价已经结束" description="当前未提交报价，报价截止后不能补交。" />
          ))}
        </div>
      ) : null}

      <Modal
        title={pendingQuoteMode === 'REQUOTE' ? '确认重新报价' : '确认提交报价'}
        open={Boolean(pendingQuote)}
        okText="确认并正式提交"
        cancelText="返回修改"
        confirmLoading={submitting}
        closable={!submitting}
        maskClosable={!submitting}
        onCancel={() => {
          if (!submitting) {
            setPendingQuote(null);
            setPendingQuoteKey(undefined);
            setPendingQuoteMode('INITIAL');
          }
        }}
        onOk={() => void confirmQuote()}
      >
        <Alert
          type="warning"
          showIcon
          message={pendingQuoteMode === 'REQUOTE'
            ? '本次提交将使用唯一一次重新报价机会，提交后不能再次修改'
            : '首次提交后可查看竞争力分析，并保留一次重新报价机会'}
          style={{ marginBottom: 18 }}
        />
        {pendingQuote && (
          <div className="quote-confirm-grid">
            <div><Text type="secondary">含税总报价</Text><Title level={4} style={{ margin: '6px 0 0' }}>{formatMoney(pendingQuote.totalAmount)}</Title></div>
            <div><Text type="secondary">交货周期</Text><Title level={4} style={{ margin: '6px 0 0' }}>{pendingQuote.deliveryDays} 天</Title></div>
            <div style={{ gridColumn: '1 / -1' }}><Text type="secondary">商务备注</Text><Paragraph style={{ margin: '6px 0 0' }}>{pendingQuote.remark || '无'}</Paragraph></div>
          </div>
        )}
      </Modal>
    </PortalShell>
  );
}
