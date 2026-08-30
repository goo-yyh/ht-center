import type { ReactNode } from 'react';
import { Tag } from 'antd';
import type { SupplierIdentity } from '@/src/contracts';

interface PortalShellProps {
  children: ReactNode;
  showIdentity?: boolean;
  identity?: SupplierIdentity;
}

export function PortalShell({ children, showIdentity = false, identity }: PortalShellProps) {
  return (
    <div className="portal-shell">
      <header className="portal-header">
        <div className="portal-brand" aria-label="海天外部供应商协同平台">
          <div className="portal-brand-mark"><span>HT</span></div>
          <div>
            <span className="portal-brand-title">海天资源湖</span>
            <span className="portal-brand-subtitle">外部供应商协同平台</span>
          </div>
        </div>
        {showIdentity ? (
          <div className="portal-identity" aria-label={`当前企业：${identity?.supplierName ?? '外部供应商'}，${identity?.supplierNo ?? 'EXT-SUP-DEMO-004'}`}>
            <span className="portal-identity-name">{identity?.supplierName ?? '外部供应商'}</span>
            <Tag color="red">{identity?.supplierNo ?? 'EXT-SUP-DEMO-004'}</Tag>
          </div>
        ) : <Tag className="portal-registration-tag">供应商注册</Tag>}
      </header>
      <main className="portal-content">{children}</main>
    </div>
  );
}
