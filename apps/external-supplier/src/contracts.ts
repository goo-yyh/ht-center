import { DEMO_EXTERNAL_SUPPLIER_NO } from '@haitian/sourcing-contracts';
import { createSourcingContractSchemas } from '@haitian/sourcing-contracts/schemas';
import type {
  ExternalRegistrationInput,
  PortalApiMeta,
  QuoteSubmissionInput,
} from '@haitian/sourcing-contracts';
import { z } from 'zod';

export {
  DEMO_EXTERNAL_SUPPLIER_NO,
  DEMO_WORKSPACE_CODE,
} from '@haitian/sourcing-contracts';

export const {
  externalRegistrationSchema: registrationInputSchema,
  quoteSubmissionSchema: quoteInputSchema,
} = createSourcingContractSchemas(z);

export type RegistrationInput = ExternalRegistrationInput;
export type QuoteInput = QuoteSubmissionInput;
export type ApiMeta = PortalApiMeta;

export type SupplierRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface RegistrationProfile {
  supplierNo: string;
  name: string;
  source: string;
  sourceDetail: string;
  region: string;
  unifiedSocialCreditCode?: string;
  address: string;
  primaryCapabilities: string[];
  qualifications: string[];
  riskLevel: SupplierRiskLevel;
  riskSummary: string;
  registered: boolean;
}

export interface RfqSummary {
  rfqNo: string;
  requestNo?: string;
  title: string;
  itemName: string;
  specification: string;
  quantity?: number;
  unit?: string;
  status: string;
  deadlineAt?: string;
  invitedAt?: string;
  viewedAt?: string;
  submittedAt?: string;
  attachmentCount?: number;
}

export interface SupplierIdentity {
  supplierNo: string;
  supplierName: string;
  supplierType: 'EXTERNAL';
}

export interface RfqListResult {
  supplier: SupplierIdentity;
  rfqs: RfqSummary[];
}

export interface RfqAttachment {
  attachmentId: string;
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
}

export type QuoteCompetitivenessLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface QuoteCompetitiveness {
  level: QuoteCompetitivenessLevel;
  label: string;
  summary: string;
}

export interface QuoteVersionReceipt {
  quoteNo: string;
  receiptNo?: string;
  rfqNo?: string;
  totalAmount: string;
  deliveryDays: number;
  remark?: string;
  submittedAt: string;
  status?: string;
  version: number;
  competitiveness?: QuoteCompetitiveness;
}

export interface QuoteReceipt extends QuoteVersionReceipt {
  versionCount: number;
  maxVersions: number;
  remainingRequotes: number;
  canRequote: boolean;
  versions: QuoteVersionReceipt[];
}

export interface RfqDetail extends RfqSummary {
  supplier: SupplierIdentity;
  description?: string;
  standards: string[];
  qualificationRequirements: string[];
  requiredDeliveryDays?: number;
  attachments: RfqAttachment[];
  quoteReceipt: QuoteReceipt | null;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function firstString(source: UnknownRecord, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number') return String(value);
  }
  return fallback;
}

function optionalString(source: UnknownRecord, keys: string[]): string | undefined {
  const value = firstString(source, keys);
  return value || undefined;
}

function optionalNumber(source: UnknownRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

function optionalBoolean(source: UnknownRecord, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'boolean') return value;
  }
  return undefined;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item : firstString(asRecord(item), ['name', 'label', 'value', 'description'])))
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) return value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function qualificationLabel(value: string): string {
  if (value === 'NONE') return '无特殊要求';
  if (value === 'ISO9001') return 'ISO 9001';
  if (value === 'IATF16949') return 'IATF 16949';
  return value;
}

function normalizeRiskLevel(value: unknown): SupplierRiskLevel {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return normalized === 'MEDIUM' || normalized === 'HIGH' ? normalized : 'LOW';
}

function normalizeCompetitivenessLevel(value: unknown): QuoteCompetitivenessLevel | undefined {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (normalized === 'HIGH' || normalized === '高') return 'HIGH';
  if (normalized === 'MEDIUM' || normalized === '中') return 'MEDIUM';
  if (normalized === 'LOW' || normalized === '低') return 'LOW';
  return undefined;
}

const competitivenessCopy: Record<QuoteCompetitivenessLevel, { label: string; summary: string }> = {
  HIGH: { label: '高', summary: '当前报价在价格和交期方面具有较强竞争力。' },
  MEDIUM: { label: '中', summary: '当前报价竞争力处于中等水平，可结合价格或交期进一步优化。' },
  LOW: { label: '低', summary: '当前报价竞争力偏低，建议在重新报价时优化价格或交期。' },
};

function normalizeCompetitiveness(value: unknown, source: UnknownRecord): QuoteCompetitiveness | undefined {
  const input = asRecord(value);
  const level = normalizeCompetitivenessLevel(
    typeof value === 'string'
      ? value
      : input.level ?? input.grade ?? source.competitivenessLevel ?? source.competitionLevel,
  );
  if (!level) return undefined;
  return {
    level,
    label: firstString(input, ['label', 'name'], competitivenessCopy[level].label),
    summary: firstString(
      input,
      ['summary', 'description', 'analysis'],
      firstString(source, ['competitivenessSummary', 'competitionSummary'], competitivenessCopy[level].summary),
    ),
  };
}

function normalizeSupplierIdentity(input: unknown): SupplierIdentity {
  const root = asRecord(input);
  const supplier = asRecord(root.supplier ?? root.identity ?? root);
  return {
    supplierNo: firstString(supplier, ['supplierNo', 'code'], DEMO_EXTERNAL_SUPPLIER_NO),
    supplierName: firstString(supplier, ['supplierName', 'name', 'companyName'], '外部供应商'),
    supplierType: 'EXTERNAL',
  };
}

function safeSourceDetail(value: string, source: string): string {
  if (/(本地|仿真|模拟|预置)/.test(value)) return value;
  const date = value.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  return `资料来自本地仿真供应商库，外部来源标识为${source}${date ? `；数据校验日期：${date}` : ''}。未实时调用外部平台。`;
}

export function normalizeRegistrationProfile(input: unknown): RegistrationProfile {
  const root = asRecord(input);
  const profile = asRecord(root.profile ?? root.supplier ?? root);
  const source = firstString(profile, ['source', 'sourcePlatform', 'origin'], '企业信息库');
  const region = firstString(profile, ['region', 'registeredRegion'], '浙江');
  const primaryCapabilities = stringList(profile.primaryCapabilities ?? profile.capabilities ?? profile.categories);
  const qualifications = stringList(profile.qualifications ?? profile.certifications);
  const riskLevel = normalizeRiskLevel(profile.riskLevel ?? profile.risk);
  const sourceDetail = firstString(profile, ['sourceDetail', 'sourceSummary']);
  return {
    supplierNo: firstString(profile, ['supplierNo', 'code'], DEMO_EXTERNAL_SUPPLIER_NO),
    name: firstString(profile, ['name', 'supplierName', 'companyName'], '外部供应商'),
    source,
    sourceDetail: safeSourceDetail(sourceDetail, source),
    region,
    unifiedSocialCreditCode: optionalString(profile, ['unifiedSocialCreditCode', 'creditCode']),
    address: firstString(profile, ['address', 'registeredAddress'], '浙江省宁波市北仑区春晓大道 88 号'),
    primaryCapabilities: primaryCapabilities.length
      ? primaryCapabilities
      : ['M12 紧固件批量供货', 'Q235 钢板切割加工'],
    qualifications: qualifications.length ? qualifications : ['ISO 9001', 'IATF 16949'],
    riskLevel,
    riskSummary: firstString(
      profile,
      ['riskSummary', 'riskDescription'],
      riskLevel === 'LOW' ? '当前企业风险等级低，未发现影响本次询价的异常。' : riskLevel === 'MEDIUM' ? '存在一般风险提示，建议结合报价条件复核。' : '风险等级较高，建议谨慎纳入候选。',
    ),
    registered: Boolean(profile.registered ?? profile.isRegistered ?? false),
  };
}

export function normalizeRfqSummary(input: unknown): RfqSummary {
  const root = asRecord(input);
  const item = asRecord(root.item ?? root.material);
  const invitation = asRecord(root.invitation ?? root.participation);
  const itemName = firstString(root, ['itemName', 'materialName'], firstString(item, ['name'], '—'));
  return {
    rfqNo: firstString(root, ['rfqNo', 'number', 'code']),
    requestNo: optionalString(root, ['requestNo', 'sourcingRequestNo']),
    title: firstString(root, ['title', 'name', 'subject'], itemName === '—' ? '采购询价' : `${itemName}采购询价`),
    itemName,
    specification: firstString(root, ['specification', 'spec'], firstString(item, ['specification', 'spec'], '—')),
    quantity: optionalNumber(root, ['quantity']) ?? optionalNumber(item, ['quantity']),
    unit: optionalString(root, ['unit']) ?? optionalString(item, ['unit']),
    status: firstString(root, ['status', 'rfqStatus'], 'OPEN'),
    deadlineAt: optionalString(root, ['deadlineAt', 'quoteDeadlineAt', 'quotationDeadline']),
    invitedAt: optionalString(root, ['invitedAt']) ?? optionalString(invitation, ['invitedAt']),
    viewedAt: optionalString(root, ['viewedAt']) ?? optionalString(invitation, ['viewedAt']),
    submittedAt: optionalString(root, ['submittedAt']) ?? optionalString(invitation, ['submittedAt']),
    attachmentCount: optionalNumber(root, ['attachmentCount']),
  };
}

function normalizeQuoteVersion(input: unknown, fallback: UnknownRecord = {}): QuoteVersionReceipt | null {
  const source = asRecord(input);
  if (!Object.keys(source).length) return null;
  const quoteNo = firstString(source, ['quoteNo', 'number', 'id'], firstString(fallback, ['quoteNo', 'number', 'id']));
  const submittedAt = firstString(source, ['submittedAt', 'createdAt']);
  const totalAmount = optionalString(source, ['totalAmount', 'amount']);
  const deliveryDays = optionalNumber(source, ['deliveryDays', 'leadTimeDays']);
  if (!quoteNo || !submittedAt || totalAmount === undefined || deliveryDays === undefined) return null;
  return {
    quoteNo,
    receiptNo: optionalString(source, ['receiptNo']),
    rfqNo: optionalString(source, ['rfqNo']) ?? optionalString(fallback, ['rfqNo']),
    totalAmount,
    deliveryDays,
    remark: optionalString(source, ['remark', 'notes']),
    submittedAt,
    status: optionalString(source, ['status']),
    version: Math.max(1, optionalNumber(source, ['version', 'quoteVersion', 'submissionNo']) ?? 1),
    competitiveness: normalizeCompetitiveness(source.competitiveness, source),
  };
}

export function normalizeQuoteReceipt(input: unknown): QuoteReceipt | null {
  if (!input) return null;
  const root = asRecord(input);
  const source = asRecord(root.quote ?? root.receipt ?? root.myQuote ?? input);
  const current = normalizeQuoteVersion(source, root);
  if (!current) return null;
  const versionMap = new Map<number, QuoteVersionReceipt>();
  if (Array.isArray(root.versions)) {
    for (const value of root.versions) {
      const version = normalizeQuoteVersion(value, root);
      if (version) versionMap.set(version.version, version);
    }
  }
  versionMap.set(current.version, current);
  const versions = [...versionMap.values()].sort((left, right) => left.version - right.version);
  const versionCount = Math.max(current.version, versions.length, optionalNumber(source, ['versionCount', 'submissionCount'])
    ?? optionalNumber(root, ['versionCount', 'submissionCount'])
    ?? current.version);
  const maxVersions = Math.max(versionCount, optionalNumber(root, ['maxVersions', 'maxQuoteAttempts'])
    ?? optionalNumber(source, ['maxVersions', 'maxQuoteAttempts'])
    ?? 2);
  const explicitCanRequote = optionalBoolean(root, ['canRequote', 'editable'])
    ?? optionalBoolean(source, ['canRequote', 'editable']);
  const remainingRequotes = Math.max(0, optionalNumber(root, ['remainingRequotes'])
    ?? optionalNumber(source, ['remainingRequotes'])
    ?? (explicitCanRequote === false ? 0 : maxVersions - versionCount));
  return {
    ...current,
    versionCount,
    maxVersions,
    remainingRequotes,
    canRequote: explicitCanRequote ?? remainingRequotes > 0,
    competitiveness: normalizeCompetitiveness(source.competitiveness ?? root.competitiveness, source),
    versions,
  };
}

export function normalizeRfqDetail(input: unknown): RfqDetail {
  const root = asRecord(input);
  const rfq = asRecord(root.rfq ?? root);
  const summary = normalizeRfqSummary(rfq);
  const attachmentInput = root.attachments ?? rfq.attachments;
  const attachments = Array.isArray(attachmentInput)
    ? attachmentInput.map((entry) => {
        const item = asRecord(entry);
        return {
          attachmentId: firstString(item, ['attachmentId', 'id']),
          fileName: firstString(item, ['fileName', 'name', 'originalName'], '采购附件'),
          mimeType: optionalString(item, ['mimeType', 'contentType']),
          sizeBytes: optionalNumber(item, ['sizeBytes', 'size']),
        };
      }).filter((item) => item.attachmentId)
    : [];

  return {
    ...summary,
    supplier: normalizeSupplierIdentity(root),
    description: optionalString(rfq, ['description', 'notes']),
    standards: stringList(rfq.standards ?? rfq.standardRequirements),
    qualificationRequirements: stringList(
      rfq.qualificationRequirements ?? rfq.qualifications ?? rfq.qualificationCodes,
    ).map(qualificationLabel),
    requiredDeliveryDays: optionalNumber(rfq, ['requiredDeliveryDays']),
    attachments,
    quoteReceipt: normalizeQuoteReceipt(root.quoteReceipt ?? root.myQuote ?? rfq.quoteReceipt),
  };
}

export function normalizeRfqList(input: unknown): RfqSummary[] {
  const root = asRecord(input);
  const list = Array.isArray(input) ? input : root.rfqs ?? root.items ?? root.list;
  return Array.isArray(list) ? list.map(normalizeRfqSummary).filter((item) => item.rfqNo) : [];
}

export function normalizeRfqListResult(input: unknown): RfqListResult {
  return {
    supplier: normalizeSupplierIdentity(input),
    rfqs: normalizeRfqList(input),
  };
}
