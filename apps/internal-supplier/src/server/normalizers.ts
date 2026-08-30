import type {
  ApiMeta,
  ApiResult,
  AttachmentInfo,
  DemoSupplier,
  QuoteReceipt,
  QuoteVersionReceipt,
  RfqDetail,
  RfqStatus,
  RfqSummary,
} from '@/src/lib/types';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function path(source: unknown, keys: string[]): unknown {
  let current = source;
  for (const key of keys) current = record(current)[key];
  return current;
}

function first(source: unknown, paths: string[][]): unknown {
  for (const keys of paths) {
    const value = path(source, keys);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function textValue(source: unknown, paths: string[][], fallback = ''): string {
  const value = first(source, paths);
  return value === undefined ? fallback : String(value);
}

function numberValue(source: unknown, paths: string[][]): number | undefined {
  const value = first(source, paths);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanValue(source: unknown, paths: string[][]): boolean | undefined {
  const value = first(source, paths);
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  return undefined;
}

function optionalText(source: unknown, paths: string[][]): string | undefined {
  const value = textValue(source, paths);
  return value || undefined;
}

function dateText(source: unknown, paths: string[][], fallback = ''): string {
  const value = textValue(source, paths, fallback);
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function listFrom(source: unknown, keys: string[]): unknown[] {
  if (Array.isArray(source)) return source;
  const container = record(source);
  for (const key of keys) if (Array.isArray(container[key])) return container[key] as unknown[];
  return [];
}

function normalizeStatus(value: unknown): RfqStatus {
  const status = String(value ?? '').toUpperCase();
  return status === 'OPEN' || status === 'BIDDING_OPEN' ? 'OPEN' : 'CLOSED';
}

function capabilitiesOf(source: unknown): string[] {
  const value = first(source, [['capabilities'], ['qualificationTags'], ['tags'], ['categories']]);
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item : textValue(item, [['name'], ['label'], ['value']])))
      .filter(Boolean);
  }
  return typeof value === 'string' ? value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean) : [];
}

export function unwrapCoreResponse(raw: unknown): ApiResult<unknown> {
  const root = record(raw);
  const metaRaw = record(root.meta);
  return {
    data: Object.prototype.hasOwnProperty.call(root, 'data') ? root.data : raw,
    meta: {
      workspaceCode: optionalText(metaRaw, [['workspaceCode']]),
      workspaceInstanceId: optionalText(metaRaw, [['workspaceInstanceId']]),
      revision: numberValue(metaRaw, [['revision']]),
      serverTime: dateText(metaRaw, [['serverTime']], new Date().toISOString()),
      requestId: optionalText(metaRaw, [['requestId']]),
    },
  };
}

export function normalizeSuppliers(raw: unknown): DemoSupplier[] {
  return listFrom(raw, ['suppliers', 'items', 'list', 'records']).flatMap((item) => {
    const supplierNo = textValue(item, [['supplierNo'], ['code'], ['supplier', 'supplierNo']]);
    const supplierName = textValue(item, [['supplierName'], ['name'], ['companyName'], ['supplier', 'supplierName']]);
    if (!supplierNo || !supplierName) return [];
    return [{
      supplierNo,
      supplierName,
      category: optionalText(item, [['category'], ['mainCategory'], ['supplier', 'category']]),
      contactName: optionalText(item, [['contactName'], ['contact', 'name']]),
      invitedCount: numberValue(item, [['invitedCount'], ['rfqCount']]),
      capabilities: capabilitiesOf(item),
    }];
  });
}

function attachment(item: unknown): AttachmentInfo | null {
  const attachmentId = textValue(item, [['attachmentId'], ['id'], ['fileId']]);
  const fileName = textValue(item, [['fileName'], ['name'], ['originalName']]);
  if (!attachmentId || !fileName) return null;
  return {
    attachmentId,
    fileName,
    mimeType: optionalText(item, [['mimeType'], ['contentType']]),
    fileSize: numberValue(item, [['fileSize'], ['sizeBytes'], ['size']]),
  };
}

export function normalizeRfqSummary(item: unknown): RfqSummary | null {
  const rfqNo = textValue(item, [['rfqNo'], ['number'], ['rfq', 'rfqNo']]);
  if (!rfqNo) return null;
  const submittedAt = dateText(item, [['submittedAt'], ['quote', 'submittedAt'], ['myQuote', 'submittedAt']]);
  const rawAttachmentList = listFrom(first(item, [['attachments'], ['request', 'attachments'], ['sourcingRequest', 'attachments']]), ['items']);
  return {
    rfqNo,
    requestNo: optionalText(item, [['requestNo'], ['sourcingRequestNo'], ['request', 'requestNo']]),
    itemName: textValue(item, [['itemName'], ['itemSnapshot', 'name'], ['item', 'name'], ['request', 'itemName']], '未命名采购物品'),
    specification: optionalText(item, [['specification'], ['specificationSnapshot'], ['itemSnapshot', 'specification'], ['request', 'specification']]),
    quantity: optionalText(item, [['quantity'], ['quantitySnapshot'], ['request', 'quantity']]),
    unit: optionalText(item, [['unit'], ['unitSnapshot'], ['request', 'unit']]),
    status: normalizeStatus(first(item, [['status'], ['rfqStatus'], ['rfq', 'status']])),
    deadlineAt: dateText(item, [['deadlineAt'], ['quotationDeadlineAt'], ['rfq', 'deadlineAt']]),
    invitedAt: optionalText(item, [['invitedAt'], ['invitation', 'invitedAt']]),
    viewedAt: optionalText(item, [['viewedAt'], ['invitation', 'viewedAt']]),
    submittedAt: submittedAt || undefined,
    quoteSubmitted: Boolean(submittedAt || first(item, [['quoteSubmitted'], ['hasQuoted'], ['myQuote']])),
    attachmentCount: numberValue(item, [['attachmentCount']]) ?? rawAttachmentList.length,
  };
}

export function normalizeRfqList(raw: unknown): RfqSummary[] {
  return listFrom(raw, ['rfqs', 'items', 'list', 'records']).flatMap((item) => {
    const normalized = normalizeRfqSummary(item);
    return normalized ? [normalized] : [];
  });
}

export function normalizeRfqDetail(raw: unknown): RfqDetail {
  const source = first(raw, [['rfq']]) ?? raw;
  const summary = normalizeRfqSummary(source);
  if (!summary) throw new Error('核心 API 返回的询价详情缺少 rfqNo');
  const attachmentSource = first(source, [['attachments'], ['request', 'attachments'], ['sourcingRequest', 'attachments']])
    ?? first(raw, [['attachments'], ['request', 'attachments'], ['sourcingRequest', 'attachments']]);
  const attachments = listFrom(attachmentSource, ['items']).flatMap((item) => {
    const normalized = attachment(item);
    return normalized ? [normalized] : [];
  });
  const qualificationCodes = first(source, [['qualificationCodes'], ['qualifications']]);
  const qualificationRequirement = Array.isArray(qualificationCodes)
    ? qualificationCodes.map(String).join('、')
    : optionalText(source, [['qualificationRequirement'], ['supplierQualification'], ['request', 'qualificationRequirement']]);
  const requiredDeliveryDays = numberValue(source, [['requiredDeliveryDays'], ['request', 'requiredDeliveryDays']]);
  return {
    ...summary,
    attachmentCount: attachments.length || summary.attachmentCount,
    buyerName: optionalText(source, [['buyerName'], ['buyerOrganization'], ['request', 'buyerName']]),
    qualificationRequirement,
    deliveryRequirement: requiredDeliveryDays ? `${requiredDeliveryDays} 天内` : optionalText(source, [['deliveryRequirement'], ['request', 'deliveryRequirement']]),
    deliveryAddress: optionalText(source, [['deliveryAddress'], ['request', 'deliveryAddress']]),
    description: optionalText(source, [['description'], ['purchaseRequirement'], ['request', 'description']]),
    attachments,
  };
}

function normalizeQuoteVersion(raw: unknown, fallback: unknown): QuoteVersionReceipt | null {
  const source = record(raw);
  if (!Object.keys(source).length) return null;
  if (source === null || source === undefined || (typeof source === 'object' && Object.keys(record(source)).length === 0)) return null;
  const quoteNo = textValue(source, [['quoteNo'], ['number'], ['id']], textValue(fallback, [['quoteNo'], ['number'], ['id']]));
  const totalAmount = textValue(source, [['totalAmount'], ['amount'], ['quotedAmount']]);
  const deliveryDays = numberValue(source, [['deliveryDays'], ['leadTimeDays']]);
  const submittedAt = dateText(source, [['submittedAt'], ['createdAt']]);
  const version = numberValue(source, [['version'], ['quoteVersion']]) ?? 1;
  const competitivenessValue = optionalText(source, [['competitiveness'], ['competitivenessLevel']]);
  const competitiveness = competitivenessValue === 'HIGH' || competitivenessValue === 'MEDIUM' || competitivenessValue === 'LOW'
    ? competitivenessValue
    : null;
  if (!quoteNo || !totalAmount || deliveryDays === undefined || !submittedAt) return null;
  return {
    quoteNo,
    receiptNo: optionalText(source, [['receiptNo']]),
    rfqNo: optionalText(source, [['rfqNo']]) ?? optionalText(fallback, [['rfqNo']]),
    totalAmount,
    deliveryDays,
    remark: optionalText(source, [['remark'], ['notes']]),
    submittedAt,
    status: textValue(source, [['status']], 'SUBMITTED'),
    version,
    competitiveness,
  };
}

export function normalizeQuoteReceipt(raw: unknown): QuoteReceipt | null {
  if (raw === null || raw === undefined) return null;
  const root = record(raw);
  const source = first(raw, [['quote'], ['receipt'], ['myQuote']]) ?? raw;
  const current = normalizeQuoteVersion(source, root);
  if (!current) return null;

  const versionMap = new Map<number, QuoteVersionReceipt>();
  const rawVersions = Array.isArray(root.versions) ? root.versions : [];
  for (const rawVersion of rawVersions) {
    const version = normalizeQuoteVersion(rawVersion, root);
    if (version) versionMap.set(version.version, version);
  }
  versionMap.set(current.version, current);
  const versions = [...versionMap.values()].sort((left, right) => left.version - right.version);
  const versionCount = Math.max(
    current.version,
    versions.length,
    numberValue(source, [['versionCount'], ['submissionCount']]) ?? 0,
    numberValue(root, [['versionCount'], ['submissionCount']]) ?? 0,
  );
  const maxVersions = Math.max(
    2,
    versionCount,
    numberValue(root, [['maxVersions'], ['maxQuoteAttempts']]) ?? 0,
    numberValue(source, [['maxVersions'], ['maxQuoteAttempts']]) ?? 0,
  );
  const explicitCanRequote = booleanValue(root, [['canRequote'], ['editable']])
    ?? booleanValue(source, [['canRequote'], ['editable']]);
  const remainingRequotes = Math.max(
    0,
    numberValue(root, [['remainingRequotes']])
      ?? numberValue(source, [['remainingRequotes']])
      ?? (explicitCanRequote === false ? 0 : maxVersions - versionCount),
  );

  return {
    ...current,
    versionCount,
    maxVersions,
    remainingRequotes,
    canRequote: explicitCanRequote ?? remainingRequotes > 0,
    versions,
  };
}

export function withMeta<T>(data: T, meta: Partial<ApiMeta>): ApiResult<T> {
  return { data, meta: { ...meta, serverTime: meta.serverTime ?? new Date().toISOString() } };
}
