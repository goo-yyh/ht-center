'use client';

import { LogoutOutlined, ShopOutlined } from '@ant-design/icons';
import { Button, Space, Tag, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { SessionSupplier } from '@/src/lib/types';
import { requestJson } from '@/src/lib/browser-api';

interface PortalHeaderProps {
  session?: SessionSupplier | null;
  onRefresh?: () => void;
}

export function PortalHeader({ session }: PortalHeaderProps) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  async function leave() {
    setLeaving(true);
    try {
      await requestJson<{ cleared: boolean }>('/api/session', { method: 'DELETE' });
    } finally {
      router.replace('/');
      router.refresh();
    }
  }

  return (
    <header className="portal-header">
      <div className="portal-brand" aria-label="海天内部供应商协同平台">
        <div className="brand-mark"><span>HT</span></div>
        <div>
          <Typography.Text className="brand-title">海天内部供应商协同平台</Typography.Text>
          <Typography.Text className="brand-subtitle">智能寻源 · 询价与报价</Typography.Text>
        </div>
      </div>
      {session ? (
        <Space wrap className="header-session">
          <Tag icon={<ShopOutlined />} color="red">内部供应商</Tag>
          <div className="session-copy">
            <Typography.Text strong>{session.supplierName}</Typography.Text>
            <Typography.Text type="secondary">{session.supplierNo}</Typography.Text>
          </div>
          <Button icon={<LogoutOutlined />} loading={leaving} onClick={leave}>切换身份</Button>
        </Space>
      ) : null}
    </header>
  );
}
