'use client';

import { FileSearchOutlined, LineChartOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, Empty, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RfqListResult, RfqSummary, SupplierIdentity } from '@/src/contracts';
import { portalFetch, shouldReturnToRegister } from '@/src/client/api';
import { PortalShell } from '@/src/components/PortalShell';
import { StatusTag } from '@/src/components/StatusTag';

const { Text } = Typography;

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function RfqListPageClient() {
  const router = useRouter();
  const { message } = App.useApp();
  const [rfqs, setRfqs] = useState<RfqSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState<number>();
  const [identity, setIdentity] = useState<SupplierIdentity>();

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const result = await portalFetch<RfqListResult>('/api/rfqs');
      setRfqs(result.data.rfqs);
      setIdentity(result.data.supplier);
      setRevision(result.meta?.revision);
      setError(undefined);
    } catch (caught) {
      if (shouldReturnToRegister(caught)) {
        router.replace('/register');
        return;
      }
      const text = caught instanceof Error ? caught.message : '询价列表加载失败';
      setError(text);
      if (quiet) message.error(text);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [message, router]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(true), 5_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [load]);

  const columns = useMemo<ColumnsType<RfqSummary>>(() => [
    {
      title: '询价需求',
      key: 'title',
      width: 330,
      render: (_, record) => (
        <div>
          <div className="rfq-number">{record.rfqNo}</div>
          <div className="rfq-title">{record.title}</div>
          <Text type="secondary">{record.itemName} · {record.specification}</Text>
        </div>
      ),
    },
    {
      title: '采购数量',
      key: 'quantity',
      width: 150,
      render: (_, record) => <span className="rfq-quantity">{record.quantity == null ? '—' : `${record.quantity} ${record.unit ?? ''}`}</span>,
    },
    {
      title: '报价截止',
      dataIndex: 'deadlineAt',
      width: 200,
      render: (value: string | undefined) => <span className="deadline-text">{formatDate(value)}</span>,
    },
    {
      title: '参与状态',
      key: 'status',
      width: 175,
      render: (_, record) => <StatusTag status={record.status} submittedAt={record.submittedAt} />,
    },
    {
      title: '操作',
      key: 'action',
      fixed: 'right',
      width: 150,
      render: (_, record) => <Button type="link" onClick={() => router.push(`/rfqs/${encodeURIComponent(record.rfqNo)}`)}>查看详情</Button>,
    },
  ], [router]);

  return (
    <PortalShell showIdentity identity={identity}>
      <div className="page-heading">
        <div>
          <h1>采购询价</h1>
          <p>这里仅展示当前企业已经收到邀请的采购询价。</p>
        </div>
        <Space wrap>
          {revision != null && <Tag>数据版本 {revision}</Tag>}
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button>
        </Space>
      </div>
      <div className="section-stack">
        <Alert
          type="info"
          showIcon
          icon={<LineChartOutlined />}
          message="首次报价后可查看竞争力分析"
          description="每次提交时，系统会根据当时的有效报价分析价格与交期竞争力（高、中、低）。每个询价有一次重新报价机会，第二次提交后锁定。"
        />
        {error ? (
          <Alert type="error" showIcon message="询价列表加载失败" description={error} action={<Button size="small" onClick={() => void load()}>重试</Button>} />
        ) : (
          <Card className="surface-card" styles={{ body: { padding: 0 } }}>
            <div className="mobile-table-scroll">
              <div className="mobile-table-hint" role="note">左右滑动查看完整询价信息</div>
              <Table<RfqSummary>
                rowKey="rfqNo"
                columns={columns}
                dataSource={rfqs}
                loading={loading}
                pagination={false}
                scroll={{ x: 1_005 }}
                locale={{ emptyText: <Empty image={<FileSearchOutlined style={{ fontSize: 52, color: '#d5c8c0' }} />} description="当前没有已邀请的询价" /> }}
              />
            </div>
          </Card>
        )}
      </div>
    </PortalShell>
  );
}
