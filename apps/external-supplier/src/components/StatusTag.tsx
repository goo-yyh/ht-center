import { getRfqStatusTagMeta } from '@haitian/ui-theme';
import { Tag } from 'antd';

export function StatusTag({ status, submittedAt }: { status: string; submittedAt?: string }) {
  const setting = getRfqStatusTagMeta(status);
  if (status === 'CLOSED') return <Tag color={setting.color}>{setting.label}</Tag>;
  if (submittedAt) return <Tag className="theme-status-tag">已提交报价</Tag>;
  return <Tag color={setting.color}>{setting.label}</Tag>;
}

export function isRfqOpen(status: string, deadlineAt?: string, now = Date.now()): boolean {
  const openStatus = status === 'OPEN' || status === 'BIDDING_OPEN';
  return openStatus && (!deadlineAt || Date.parse(deadlineAt) > now);
}
