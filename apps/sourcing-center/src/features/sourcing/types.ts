export type {
  AgentAction,
  AgentMessage,
  ApiEnvelope,
  ApiMeta,
  CatalogItem,
  CatalogQuantity,
  CatalogResponse,
  CreateSourcingRequestInput,
  DashboardResponse,
  DashboardStats,
  Evaluation,
  EvaluationItem,
  EvaluationStrategy,
  NotificationRecord,
  PurchaseRequisition,
  QuoteProgressCounts,
  RevealedQuote,
  RfqProgress,
  SourcingCandidate,
  SourcingAgentRun,
  SourcingRequestDetail,
  SourcingRequestSummary,
  SourcingStatus,
  SupplierProgress,
  SupplierType,
} from '@haitian/sourcing-contracts';

export type DeepSeekHealth = {
  configured: boolean;
  state: 'UNCONFIGURED' | 'NOT_VERIFIED' | 'VERIFIED' | 'DEGRADED';
  model: string;
  lastVerifiedAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
};

export type HealthResponse = {
  status: 'ok';
  database: 'connected';
  databaseTime: string;
  deepSeek: DeepSeekHealth;
  quoteEncryptionConfigured: boolean;
};
