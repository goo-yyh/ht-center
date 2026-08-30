'use client';

import { ArrowLeftOutlined, DownloadOutlined, FileDoneOutlined, FileProtectOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Descriptions, Divider, Empty, Space, Spin, Tag, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { BrowserApiError, readableError, requestJson } from '@/src/lib/browser-api';
import { formatDateTime, formatFileSize } from '@/src/lib/format';
import type { ApiMeta, QuoteReceipt, RfqDetail, SessionSupplier } from '@/src/lib/types';
import { PortalHeader } from './PortalHeader';
import { QuotePanel } from './QuotePanel';
import { DeadlineTag, StatusTag } from './StatusTag';

interface RfqDetailViewProps {
  rfqNo: string;
  initialSession: SessionSupplier;
  initialDetail: RfqDetail;
  initialReceipt: QuoteReceipt | null;
  initialMeta: ApiMeta;
}

export function RfqDetailView({ rfqNo, initialSession, initialDetail, initialReceipt, initialMeta }: RfqDetailViewProps) {
  const router = useRouter();
  const [session, setSession] = useState<SessionSupplier | null>(initialSession);
  const [detail, setDetail] = useState<RfqDetail>(initialDetail);
  const [receipt, setReceipt] = useState<QuoteReceipt | null>(initialReceipt);
  const [meta, setMeta] = useState<ApiMeta>(initialMeta);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const viewRecorded = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const sessionResult = await requestJson<SessionSupplier | null>('/api/session');
      if (!sessionResult.data) {
        router.replace('/');
        return;
      }
      setSession(sessionResult.data);
      const [detailResult, quoteResult] = await Promise.all([
        requestJson<RfqDetail>(`/api/rfqs/${encodeURIComponent(rfqNo)}`),
        requestJson<QuoteReceipt | null>(`/api/rfqs/${encodeURIComponent(rfqNo)}/quote`),
      ]);
      setDetail(detailResult.data);
      setReceipt(quoteResult.data);
      setMeta(detailResult.meta);
      setError(undefined);
    } catch (reason) {
      if (reason instanceof BrowserApiError && reason.status === 401) {
        router.replace('/');
        return;
      }
      setError(readableError(reason));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [rfqNo, router]);

  useEffect(() => {
    const timer = window.setInterval(() => void load(true), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!detail || viewRecorded.current) return;
    viewRecorded.current = true;
    void requestJson(`/api/rfqs/${encodeURIComponent(rfqNo)}/view`, {
      method: 'POST',
      headers: { 'idempotency-key': crypto.randomUUID() },
    }).catch(() => {
      viewRecorded.current = false;
    });
  }, [detail, rfqNo]);

  return (
    <div className="portal-shell">
      <PortalHeader session={session ?? null} />
      <main className="portal-main">
        <div className="detail-toolbar">
          <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/rfqs')}>返回询价列表</Button>
          <Button icon={<ReloadOutlined />} loading={refreshing} onClick={() => void load(true)}>刷新</Button>
        </div>
        {loading && !detail ? <div className="center-loading"><Spin size="large" tip="正在加载询价详情"><div className="spin-space" /></Spin></div> : null}
        {error ? <Alert className="content-alert" type="error" showIcon message="询价详情加载失败" description={error} action={<Button onClick={() => void load()}>重试</Button>} /> : null}
        {detail ? (
          <div className="detail-stack">
            <Card className="portal-card detail-hero-card">
              <div className="detail-title-row">
                <div>
                  <Space wrap className="detail-tags">
                    <Tag color="red">{detail.rfqNo}</Tag>
                    <StatusTag status={detail.status} quoteSubmitted={Boolean(receipt) || detail.quoteSubmitted} />
                    {detail.status === 'OPEN' ? <DeadlineTag deadlineAt={detail.deadlineAt} serverTime={meta?.serverTime} /> : null}
                  </Space>
                  <Typography.Title level={2}>{detail.itemName}</Typography.Title>
                  <Typography.Text type="secondary">采购需求：{detail.requestNo ?? '—'}</Typography.Text>
                </div>
                <div className="quote-policy-badge"><FileDoneOutlined /><span>首次报价后可再报价一次</span></div>
              </div>
              <Divider />
              <Descriptions column={{ xs: 1, sm: 2, lg: 3 }}>
                <Descriptions.Item label="规格与标准">{detail.specification ?? '以采购附件为准'}</Descriptions.Item>
                <Descriptions.Item label="采购数量">{detail.quantity ?? '—'}{detail.unit ? ` ${detail.unit}` : ''}</Descriptions.Item>
                <Descriptions.Item label="报价截止">{formatDateTime(detail.deadlineAt)}</Descriptions.Item>
                <Descriptions.Item label="供应商资质">{detail.qualificationRequirement ?? '符合该品类供应要求'}</Descriptions.Item>
                <Descriptions.Item label="交付要求">{detail.deliveryRequirement ?? '以询价要求为准'}</Descriptions.Item>
                <Descriptions.Item label="交付地点">{detail.deliveryAddress ?? '以采购方通知为准'}</Descriptions.Item>
              </Descriptions>
              {detail.description ? <Alert className="requirement-alert" type="info" showIcon message="采购说明" description={detail.description} /> : null}
            </Card>

            <Card className="portal-card" title={<Space><FileProtectOutlined /><span>采购附件</span></Space>}>
              {detail.attachments.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本询价暂无采购附件" /> : (
                <div className="attachment-list">
                  {detail.attachments.map((file) => (
                    <div className="attachment-row" key={file.attachmentId}>
                      <div>
                        <Typography.Text strong>{file.fileName}</Typography.Text>
                        {file.fileSize !== undefined ? <Typography.Text type="secondary">{formatFileSize(file.fileSize)}</Typography.Text> : null}
                      </div>
                      <Button
                        icon={<DownloadOutlined />}
                        href={`/api/rfqs/${encodeURIComponent(rfqNo)}/attachments/${encodeURIComponent(file.attachmentId)}`}
                        download={file.fileName}
                      >下载查看</Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <QuotePanel
              rfqNo={detail.rfqNo}
              isOpen={detail.status === 'OPEN'}
              receipt={receipt}
              onSubmitted={(submittedReceipt) => {
                if (submittedReceipt) setReceipt(submittedReceipt);
                return load(true);
              }}
            />
            <Typography.Text className="revision-line" type="secondary">每 5 秒自动刷新{meta?.revision !== undefined ? ` · 数据版本 ${meta.revision}` : ''}</Typography.Text>
          </div>
        ) : null}
      </main>
    </div>
  );
}
