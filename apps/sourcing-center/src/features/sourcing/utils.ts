import { SOURCING_STATUS_TAG_META } from '@haitian/ui-theme';
import type { EvaluationStrategy, SourcingStatus, SupplierType } from './types';

export const statusMeta = SOURCING_STATUS_TAG_META satisfies Record<
  SourcingStatus,
  { label: string; color: string; step: number }
>;

export const evaluationStrategyLabel: Record<EvaluationStrategy, string> = {
  BALANCED: '综合均衡',
  PRICE_FIRST: '价格优先',
  DELIVERY_FIRST: '交期优先',
};

export const supplierTypeLabel: Record<SupplierType, string> = {
  INTERNAL: '内部',
  EXTERNAL: '外部',
};

export function formatDateTime(value?: string | null): string {
  if (!value) {
    return '-';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

export function formatCurrency(value: string | number): string {
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount)) {
    return String(value);
  }

  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 2,
  }).format(amount);
}

export function getCountdown(deadlineAt?: string | null, serverTime?: string): string {
  if (!deadlineAt) {
    return '-';
  }

  const remaining = Math.max(0, new Date(deadlineAt).getTime() - new Date(serverTime || Date.now()).getTime());
  if (remaining <= 0) {
    return '已到期';
  }

  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  if (days > 0) {
    return `${days} 天 ${hours} 小时`;
  }
  if (hours > 0) {
    return `${hours} 小时 ${minutes % 60} 分`;
  }
  return `${minutes} 分 ${seconds.toString().padStart(2, '0')} 秒`;
}
