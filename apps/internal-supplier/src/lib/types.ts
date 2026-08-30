import type {
  ApiErrorPayload as SharedApiErrorPayload,
  IsoDateTime,
  QuoteReceiptDto,
  RfqStatus as SharedRfqStatus,
} from '@haitian/sourcing-contracts';

export type RfqStatus = SharedRfqStatus;

export interface ApiMeta {
  workspaceCode?: string;
  workspaceInstanceId?: string;
  revision?: number;
  serverTime: IsoDateTime;
  requestId?: string;
}

export interface ApiResult<T> {
  data: T;
  meta: ApiMeta;
}

export interface DemoSupplier {
  supplierNo: string;
  supplierName: string;
  category?: string;
  contactName?: string;
  invitedCount?: number;
  capabilities: string[];
}

export interface AttachmentInfo {
  attachmentId: string;
  fileName: string;
  mimeType?: string;
  fileSize?: number;
}

export interface RfqSummary {
  rfqNo: string;
  requestNo?: string;
  itemName: string;
  specification?: string;
  quantity?: string;
  unit?: string;
  status: RfqStatus;
  deadlineAt: string;
  invitedAt?: string;
  viewedAt?: string;
  submittedAt?: string;
  quoteSubmitted: boolean;
  attachmentCount: number;
}

export interface RfqDetail extends RfqSummary {
  buyerName?: string;
  qualificationRequirement?: string;
  deliveryRequirement?: string;
  deliveryAddress?: string;
  description?: string;
  attachments: AttachmentInfo[];
}

export interface QuoteVersionReceipt extends Omit<QuoteReceiptDto, 'status'> {
  status: string;
}

export interface QuoteReceipt extends QuoteVersionReceipt {
  versionCount: number;
  maxVersions: number;
  remainingRequotes: number;
  canRequote: boolean;
  versions: QuoteVersionReceipt[];
}

export interface SessionSupplier {
  supplierNo: string;
  supplierName: string;
  workspaceCode: string;
}

export type ApiErrorPayload = SharedApiErrorPayload;
