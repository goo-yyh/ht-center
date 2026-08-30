'use client';

import { EyeOutlined, FileProtectOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Empty, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { BrowserApiError, readableError, requestJson } from '@/src/lib/browser-api';
import { formatDateTime } from '@/src/lib/format';
import type { ApiMeta, RfqSummary, SessionSupplier } from '@/src/lib/types';
import { PortalHeader } from './PortalHeader';
import { DeadlineTag, StatusTag } from './StatusTag';

interface RfqListProps {
  initialSession: SessionSupplier;
  initialRfqs: RfqSummary[];
  initialMeta: ApiMeta;
}

export function RfqList({ initialSession, initialRfqs, initialMeta }: RfqListProps) {
  const router = useRouter();
  const [session, setSession] = useState<SessionSupplier | null>(initialSession);
  const [rfqs, setRfqs] = useState<RfqSummary[]>(initialRfqs);
  const [meta, setMeta] = useState<ApiMeta>(initialMeta);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();

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
      const rfqResult = await requestJson<RfqSummary[]>('/api/rfqs');
      setRfqs(rfqResult.data);
      setMeta(rfqResult.meta);
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
  }, [router]);

  useEffect(() => {
    const timer = window.setInterval(() => void load(true), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  const columns = useMemo<ColumnsType<RfqSummary>>(() => [
    {
      title: '询价单', dataIndex: 'rfqNo', key: 'rfqNo', width: 170,
      render: (value: string, row) => <div><Typography.Text strong>{value}</Typography.Text><br /><Typography.Text type="secondary">{row.requestNo ?? '—'}</Typography.Text></div>,
    },
    {
      title: '采购物品', dataIndex: 'itemName', key: 'itemName', width: 320,
      render: (value: string, row) => <div><Typography.Text strong>{value}</Typography.Text><br /><Typography.Text type="secondary">{row.specification ?? '规格以详情为准'}</Typography.Text></div>,
    },
    {
      title: '数量', key: 'quantity', width: 150,
      render: (_, row) => <span className="rfq-quantity">{row.quantity ?? '—'}{row.unit ? ` ${row.unit}` : ''}</span>,
    },
    {
      title: '报价状态', key: 'status', width: 190,
      render: (_, row) => <StatusTag status={row.status} quoteSubmitted={row.quoteSubmitted} />,
    },
    {
      title: '报价截止', dataIndex: 'deadlineAt', key: 'deadlineAt', width: 210,
      render: (value: string, row) => <Space direction="vertical" size={2}><Typography.Text>{formatDateTime(value)}</Typography.Text>{row.status === 'OPEN' ? <DeadlineTag deadlineAt={value} serverTime={meta?.serverTime} /> : null}</Space>,
    },
    {
      title: '附件', dataIndex: 'attachmentCount', key: 'attachmentCount', width: 90,
      render: (value: number) => <Tag icon={<FileProtectOutlined />}>{value}</Tag>,
    },
    {
      title: '操作', key: 'action', fixed: 'right', width: 150,
      render: (_, row) => <Button type="link" icon={<EyeOutlined />} onClick={() => router.push(`/rfqs/${encodeURIComponent(row.rfqNo)}`)}>查看详情</Button>,
    },
  ], [meta?.serverTime, router]);

  return (
    <div className="portal-shell">
      <PortalHeader session={session ?? null} />
      <main className="portal-main">
        <div className="page-heading">
          <div>
            <Space wrap><Typography.Title level={2}>受邀询价</Typography.Title><Tag color="red">共 {rfqs.length} 条</Tag></Space>
            <Typography.Paragraph type="secondary">以下询价均已邀请当前内部供应商。首次报价后可查看竞争力，并可在截止前重新报价一次；第二次提交后锁定。</Typography.Paragraph>
          </div>
          <Button icon={<ReloadOutlined />} loading={refreshing} onClick={() => void load(true)}>刷新</Button>
        </div>
        {error ? <Alert className="content-alert" type="error" showIcon message="询价列表加载失败" description={error} action={<Button onClick={() => void load()}>重试</Button>} /> : null}
        <Card className="portal-card table-card" styles={{ body: { padding: 0 } }}>
          <div className="mobile-table-scroll">
            <div className="mobile-table-hint" role="note">左右滑动查看完整询价信息</div>
            <Table<RfqSummary>
              rowKey="rfqNo"
              columns={columns}
              dataSource={rfqs}
              loading={loading}
              pagination={false}
              scroll={{ x: 1_280 }}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前供应商暂无受邀询价" /> }}
            />
          </div>
        </Card>
        <div className="revision-line">
          <Typography.Text type="secondary">每 5 秒自动刷新{meta?.revision !== undefined ? ` · 数据版本 ${meta.revision}` : ''}</Typography.Text>
        </div>
      </main>
    </div>
  );
}
