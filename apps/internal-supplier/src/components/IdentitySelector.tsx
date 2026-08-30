'use client';

import { SafetyCertificateOutlined, ShopOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Empty, Row, Skeleton, Space, Tag, Typography, message } from 'antd';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import { readableError, requestJson } from '@/src/lib/browser-api';
import type { DemoSupplier, SessionSupplier } from '@/src/lib/types';
import { PortalHeader } from './PortalHeader';

interface IdentitySelectorProps {
  initialSuppliers: DemoSupplier[];
  initialSession: SessionSupplier | null;
  initialError?: string;
}

export function IdentitySelector({ initialSuppliers, initialSession, initialError }: IdentitySelectorProps) {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<DemoSupplier[]>(initialSuppliers);
  const [session, setSession] = useState<SessionSupplier | null>(initialSession);
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState<string>();
  const [error, setError] = useState<string | undefined>(initialError);
  const [messageApi, contextHolder] = message.useMessage();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [supplierResult, sessionResult] = await Promise.all([
        requestJson<DemoSupplier[]>('/api/demo-suppliers'),
        requestJson<SessionSupplier | null>('/api/session'),
      ]);
      setSuppliers(supplierResult.data);
      setSession(sessionResult.data);
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  async function choose(supplier: DemoSupplier) {
    setSelecting(supplier.supplierNo);
    try {
      await requestJson<SessionSupplier>('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ supplierNo: supplier.supplierNo }),
      });
      messageApi.success(`已进入 ${supplier.supplierName}`);
      router.push('/rfqs');
      router.refresh();
    } catch (reason) {
      messageApi.error(readableError(reason));
    } finally {
      setSelecting(undefined);
    }
  }

  return (
    <div className="portal-shell">
      {contextHolder}
      <PortalHeader />
      <main className="portal-main identity-main">
        <section className="identity-hero">
          <div>
            <Tag color="red">内部供应商入口</Tag>
            <Typography.Title level={1}>查看受邀询价并提交正式报价</Typography.Title>
            <Typography.Paragraph>
              请选择一个预置内部供应商身份。进入后只会看到该供应商已受邀的采购询价，首次报价后可根据竞争力分析重新报价一次。
            </Typography.Paragraph>
          </div>
          <div className="security-panel">
            <SafetyCertificateOutlined />
            <div>
              <Typography.Text strong>每个询价最多两版报价</Typography.Text>
              <Typography.Text>首次报价后展示竞争力并保留一次重新报价机会，第二次提交后锁定。</Typography.Text>
            </div>
          </div>
        </section>

        {session ? (
          <Alert
            className="session-alert"
            type="info"
            showIcon
            message={`当前身份：${session.supplierName}`}
            description="可以继续进入询价列表，也可以在下方选择其他演示身份。"
            action={<Button type="primary" onClick={() => router.push('/rfqs')}>继续进入</Button>}
          />
        ) : null}
        {error ? <Alert type="error" showIcon message="无法加载供应商身份" description={error} action={<Button onClick={() => void load()}>重试</Button>} /> : null}

        <div className="section-heading">
          <div>
            <Typography.Title level={3}>选择供应商身份</Typography.Title>
            <Typography.Text type="secondary">身份由服务端校验并写入签名会话，进入后无法在请求中切换。</Typography.Text>
          </div>
        </div>

        {loading ? <Row gutter={[16, 16]}>{[1, 2, 3].map((key) => <Col xs={24} md={12} lg={8} key={key}><Card className="supplier-card"><Skeleton active /></Card></Col>)}</Row> : null}
        {!loading && !error && suppliers.length === 0 ? <Card className="portal-card"><Empty description="暂无可选的内部供应商" /></Card> : null}
        {!loading && suppliers.length > 0 ? (
          <Row gutter={[16, 16]}>
            {suppliers.map((supplier) => (
              <Col xs={24} md={12} lg={8} key={supplier.supplierNo}>
                <Card className="supplier-card" hoverable>
                  <Space direction="vertical" size={14} className="full-width">
                    <div className="supplier-title-row">
                      <span className="supplier-icon"><ShopOutlined /></span>
                      <div>
                        <Typography.Title level={4}>{supplier.supplierName}</Typography.Title>
                        <Typography.Text type="secondary">{supplier.supplierNo}</Typography.Text>
                      </div>
                    </div>
                    <Space wrap>
                      <Tag color="red">内部供应商</Tag>
                      {supplier.category ? <Tag>{supplier.category}</Tag> : null}
                      {supplier.invitedCount !== undefined ? <Tag>{supplier.invitedCount} 条受邀询价</Tag> : null}
                    </Space>
                    {supplier.capabilities.length > 0 ? (
                      <Typography.Text type="secondary">主要能力：{supplier.capabilities.slice(0, 3).join('、')}</Typography.Text>
                    ) : null}
                    <Button block type="primary" loading={selecting === supplier.supplierNo} onClick={() => void choose(supplier)}>使用该身份进入</Button>
                  </Space>
                </Card>
              </Col>
            ))}
          </Row>
        ) : null}
      </main>
    </div>
  );
}
