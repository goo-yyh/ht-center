export const SOURCING_STATUSES = [
  'SOURCING_RUNNING',
  'SOURCING_READY',
  'BIDDING_OPEN',
  'EVALUATION_PENDING',
  'AWARD_PENDING',
  'COMPLETED',
] as const;

export const RFQ_STATUSES = ['OPEN', 'CLOSED'] as const;
export const SUPPLIER_TYPES = ['INTERNAL', 'EXTERNAL'] as const;
export const EVALUATION_STRATEGIES = ['BALANCED', 'PRICE_FIRST', 'DELIVERY_FIRST'] as const;
export const QUOTE_COMPETITIVENESS = ['HIGH', 'MEDIUM', 'LOW'] as const;

export const SOURCING_AGENT_ACTION_LABELS = {
  CLASSIFY_AGENT_INTENT: '识别对话意图',
  PARSE_SOURCING_REQUEST: '解析寻源需求',
  APPLY_FIXED_OPTIONS: '应用固定选项调整',
  QUERY_INTERNAL_SUPPLIERS: '查询内部供应商库',
  QUERY_EXTERNAL_SUPPLIERS: '查询已同步的外部供应商数据',
  CHECK_QUALIFICATION: '核验供应商资质',
  CHECK_DELIVERY: '核验交付能力',
  ANALYZE_WITH_DEEPSEEK: 'DeepSeek 分析候选供应商',
  VALIDATE_AGENT_OUTPUT: '校验 Agent 输出白名单',
  SAVE_CANDIDATES: '保存候选供应商',
  BUILD_CANDIDATE_LIST: '生成候选供应商清单',
  LOAD_REVEALED_QUOTES: '读取最终报价',
  LOAD_CURRENT_QUOTES: '读取最终报价',
  VERIFY_QUOTE_SET: '校验有效报价集合',
  CALCULATE_PRICE_SCORE: '计算价格得分',
  CALCULATE_DELIVERY_SCORE: '计算交期得分',
  CALCULATE_MATCH_RISK_SCORE: '计算匹配与风险得分',
  APPLY_EVALUATION_WEIGHTS: '应用评估权重并生成排名',
  ANALYZE_EVALUATION_WITH_DEEPSEEK: 'DeepSeek 生成推荐与风险说明',
  VALIDATE_EVALUATION_OUTPUT: '校验 DeepSeek 评估结果',
  SAVE_EVALUATION_RANKING: '保存 Top 报价排名',
  CALCULATE_QUOTE_SCORE: '计算报价评分',
} as const;

export const AGENT_MESSAGE_INTENTS = ['RUN_SOURCING', 'ADJUST_AND_SOURCE', 'CONVERSATION', 'OUT_OF_SCOPE'] as const;

export const BUSINESS_ERROR_CODES = [
  'INVALID_INPUT',
  'NOT_FOUND',
  'ILLEGAL_STATE_TRANSITION',
  'STALE_VERSION',
  'SUPPLIER_NOT_INVITED',
  'REGISTRATION_REQUIRED',
  'SUPPLIER_NOT_REGISTRABLE',
  'SUPPLIER_ALREADY_REGISTERED',
  'RFQ_CLOSED',
  'QUOTE_ALREADY_SUBMITTED',
  'SEALED_CONTENT_FORBIDDEN',
  'NO_VALID_QUOTES',
  'AGENT_SERVICE_UNAVAILABLE',
  'AGENT_OUTPUT_INVALID',
  'IDEMPOTENCY_KEY_REUSED',
  'DEMO_RESET_IN_PROGRESS',
] as const;

export const DEMO_EXTERNAL_SUPPLIER_NO = 'EXT-SUP-DEMO-004' as const;
export const DEMO_WORKSPACE_CODE = 'DEMO-DEFAULT' as const;

export type SourcingStatus = (typeof SOURCING_STATUSES)[number];
export type RfqStatus = (typeof RFQ_STATUSES)[number];
export type SupplierType = (typeof SUPPLIER_TYPES)[number];
export type EvaluationStrategy = (typeof EVALUATION_STRATEGIES)[number];
export type QuoteCompetitiveness = (typeof QUOTE_COMPETITIVENESS)[number];
export type AgentMessageIntent = (typeof AGENT_MESSAGE_INTENTS)[number];
export type BusinessErrorCode = (typeof BUSINESS_ERROR_CODES)[number];
export type SerializedMoney = string;
export type IsoDateTime = string;
export type QuoteSubmissionInput = {
  totalAmount: SerializedMoney;
  deliveryDays: number;
  remark: string;
};
export type ExternalRegistrationInput = {
  contactName: string;
  email: string;
  password: string;
};

export type ApiMeta = {
  workspaceCode?: string;
  workspaceInstanceId?: string;
  revision: number;
  serverTime: IsoDateTime;
  requestId?: string;
};

export type PortalApiMeta = Partial<Omit<ApiMeta, 'serverTime'>> & {
  serverTime?: IsoDateTime;
};

export type ApiEnvelope<T> = {
  data: T;
  meta: ApiMeta;
};

export type ApiErrorPayload = {
  error: {
    code: BusinessErrorCode | string;
    message: string;
    requestId?: string;
  };
};

export type DashboardStats = {
  total: number;
  sourcing: number;
  bidding: number;
  evaluating: number;
  awardPending: number;
  completed: number;
};

export type QuoteProgressCounts = {
  invited: number;
  registeredExternal: number;
  viewed: number;
  submitted: number;
};

export type SourcingRequestSummary = {
  requestNo: string;
  itemCode: string;
  itemName: string;
  specification: string;
  quantity: number;
  unit: string;
  status: SourcingStatus;
  deadlineAt?: IsoDateTime | null;
  createdAt: IsoDateTime;
  quoteProgress?: QuoteProgressCounts | null;
};

export type CatalogQuantity = {
  label: string;
  value: number;
  unit: string;
};

export type CatalogItem = {
  code: string;
  name: string;
  unit: string;
  specifications: Array<{ code: string; label: string }>;
  quantities: CatalogQuantity[];
  qualifications: Array<{ code: string; label: string }>;
  deliveryOptions: number[];
};

export type CatalogResponse = {
  items: CatalogItem[];
  quoteDurations?: number[];
  evaluationStrategies?: Array<{ value: EvaluationStrategy; label: string }>;
};

export type AgentMessage = {
  id: string;
  agentRunId: string | null;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM_RESULT';
  content: string;
  isSeeded: boolean;
  createdAt: IsoDateTime;
};

export type AgentAction = {
  id: string;
  agentRunId: string;
  runType: 'SOURCING' | 'EVALUATION';
  actionType: string;
  label?: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  summary: string;
  hitCount?: number | null;
  isSeeded: boolean;
  startedAt: IsoDateTime;
  finishedAt?: IsoDateTime | null;
};

export type SourcingAgentRun = {
  id: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  model: string;
  promptVersion: string;
  isSeeded: boolean;
  startedAt: IsoDateTime;
  finishedAt: IsoDateTime | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type SourcingCandidate = {
  supplierNo: string;
  supplierName: string;
  supplierType: SupplierType;
  sourcePlatform: string;
  matchScore: number;
  qualifications: string[];
  expectedDeliveryDays: number;
  recommendation: string;
  riskSummary: string;
  selectedForRfq?: boolean;
};

export type SupplierProgress = {
  supplierNo: string;
  supplierName: string;
  supplierType: SupplierType;
  invitedAt: IsoDateTime;
  registeredAt?: IsoDateTime | null;
  viewedAt?: IsoDateTime | null;
  submittedAt?: IsoDateTime | null;
  latestQuote?: (QuoteReceiptDto & { versionCount: number; competitiveness: QuoteCompetitiveness | null }) | null;
};

export type RfqProgress = {
  rfqNo: string;
  status: RfqStatus;
  deadlineAt: IsoDateTime;
  closedAt?: IsoDateTime | null;
  closeReason?: 'EARLY_STOP' | 'DEADLINE_REACHED' | null;
  counts: QuoteProgressCounts;
  suppliers: SupplierProgress[];
};

export type RevealedQuote = {
  quoteNo: string;
  supplierNo: string;
  supplierName: string;
  supplierType: SupplierType;
  totalAmount: SerializedMoney;
  deliveryDays: number;
  remark?: string | null;
  submittedAt: IsoDateTime;
  version: number;
  versionCount: number;
  competitiveness: QuoteCompetitiveness | null;
};

export type EvaluationItem = RevealedQuote & {
  rank: number;
  priceScore: number;
  deliveryScore: number;
  matchScore: number;
  riskScore: number;
  totalScore: number;
  recommendation: string;
  riskSummary: string;
};

export type Evaluation = {
  evaluationNo: string;
  strategy: EvaluationStrategy;
  createdAt: IsoDateTime;
  items: EvaluationItem[];
};

export type NotificationRecord = {
  id: string;
  supplierNo: string;
  supplierName: string;
  recipientAddress: string;
  notificationType: 'RFQ_NOTICE';
  status: 'SIMULATED_SENT';
  generatedAt: IsoDateTime;
};

export type PurchaseRequisition = {
  prNo: string;
  requestNo: string;
  rfqNo: string;
  quoteNo: string;
  supplierNo: string;
  supplierName: string;
  itemName: string;
  specification: string;
  quantity: number;
  unit: string;
  totalAmount: SerializedMoney;
  deliveryDays: number;
  createdAt: IsoDateTime;
};

export type SourcingRequestDetail = SourcingRequestSummary & {
  qualificationCodes: string[];
  qualificationLabels?: string[];
  requiredDeliveryDays: number;
  quoteDurationMinutes: number;
  evaluationStrategy: EvaluationStrategy;
  version: number;
  attachment?: {
    id: string;
    fileName: string;
    sizeBytes: number;
  } | null;
  agentMessages: AgentMessage[];
  agentActions: AgentAction[];
  activeSourcingAgentRun: SourcingAgentRun | null;
  latestSourcingAgentRun: SourcingAgentRun | null;
  activeEvaluationAgentRun: SourcingAgentRun | null;
  latestEvaluationAgentRun: SourcingAgentRun | null;
  candidateSourcingAgentRunId: string | null;
  candidates: SourcingCandidate[];
  rfq?: RfqProgress | null;
  revealedQuotes?: RevealedQuote[];
  evaluation?: Evaluation | null;
  notifications?: NotificationRecord[];
  purchaseRequisition?: PurchaseRequisition | null;
};

export type DashboardResponse = {
  stats: DashboardStats;
  requests: SourcingRequestSummary[];
};

export type CreateSourcingRequestInput = {
  itemCode: string;
  specificationCode: string;
  quantity: number;
  qualificationCodes: string[];
  requiredDeliveryDays: number;
  quoteDurationMinutes: number;
  evaluationStrategy: EvaluationStrategy;
  attachment?: {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    contentBase64: string;
  };
};

export type QuoteReceiptDto = {
  quoteNo: string;
  receiptNo?: string;
  rfqNo?: string;
  totalAmount: SerializedMoney;
  deliveryDays: number;
  remark?: string;
  submittedAt: IsoDateTime;
  status?: string;
  version: number;
  competitiveness: QuoteCompetitiveness | null;
};

export type SupplierQuoteDetailDto = {
  rfqNo: string;
  quote: QuoteReceiptDto;
  versions: QuoteReceiptDto[];
  sealed: false;
  editable: boolean;
  canRequote: boolean;
  remainingRequotes: 0 | 1;
};
