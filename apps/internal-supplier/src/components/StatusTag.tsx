import { CheckCircleOutlined, ClockCircleOutlined, StopOutlined } from '@ant-design/icons';
import { getRfqStatusTagMeta } from '@haitian/ui-theme';
import { Tag } from 'antd';

interface StatusTagProps {
  status: 'OPEN' | 'CLOSED';
  quoteSubmitted?: boolean;
}

export function StatusTag({ status, quoteSubmitted }: StatusTagProps) {
  const setting = getRfqStatusTagMeta(status);
  if (status === 'CLOSED') return <Tag icon={<StopOutlined />} color={setting.color}>报价已结束</Tag>;
  if (quoteSubmitted) {
    const submitted = getRfqStatusTagMeta('SUBMITTED');
    return <Tag icon={<CheckCircleOutlined />} color={submitted.color}>报价已提交</Tag>;
  }
  return <Tag icon={<ClockCircleOutlined />} color={setting.color}>报价进行中</Tag>;
}

export function DeadlineTag({ deadlineAt, serverTime }: { deadlineAt: string; serverTime?: string }) {
  const deadline = new Date(deadlineAt).getTime();
  if (!serverTime) return <Tag icon={<ClockCircleOutlined />}>截止时间以服务端为准</Tag>;
  const server = new Date(serverTime).getTime();
  const minutes = Number.isFinite(deadline) && Number.isFinite(server) ? Math.max(0, Math.ceil((deadline - server) / 60000)) : 0;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainderMinutes = minutes % 60;
  const remainingLabel = days > 0
    ? `剩余约 ${days} 天 ${hours} 小时`
    : hours > 0
      ? `剩余约 ${hours} 小时 ${remainderMinutes} 分钟`
      : `剩余约 ${minutes} 分钟`;
  return <Tag icon={<ClockCircleOutlined />} color={minutes <= 10 ? 'warning' : 'default'}>{minutes > 0 ? remainingLabel : '已到截止时间'}</Tag>;
}
