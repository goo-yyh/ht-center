import {
  BUSINESS_ERROR_CODES,
  EVALUATION_STRATEGIES,
  RFQ_STATUSES,
  SOURCING_STATUSES,
  SUPPLIER_TYPES,
} from './index';
import type {
  BusinessErrorCode,
  EvaluationStrategy,
  ExternalRegistrationInput,
  IsoDateTime,
  QuoteSubmissionInput,
  RfqStatus,
  SerializedMoney,
  SourcingStatus,
  SupplierType,
} from './index';

export interface ContractSchema<T> {
  parse(input: unknown): T;
  safeParse(input: unknown):
    | { success: true; data: T }
    | { success: false; error: unknown };
}

export interface SourcingContractSchemas {
  sourcingStatusSchema: ContractSchema<SourcingStatus>;
  rfqStatusSchema: ContractSchema<RfqStatus>;
  supplierTypeSchema: ContractSchema<SupplierType>;
  evaluationStrategySchema: ContractSchema<EvaluationStrategy>;
  businessErrorCodeSchema: ContractSchema<BusinessErrorCode>;
  serializedMoneySchema: ContractSchema<SerializedMoney>;
  isoDateTimeSchema: ContractSchema<IsoDateTime>;
  quoteSubmissionSchema: ContractSchema<QuoteSubmissionInput>;
  externalRegistrationSchema: ContractSchema<ExternalRegistrationInput>;
}

/**
 * 使用消费应用自己的 Zod 实例构建契约，确保三个独立 Next.js 应用共享规则，
 * 同时不会在本地 file: 包下打入第二份 Zod 运行时。
 */
export function createSourcingContractSchemas(zodRuntime: unknown): SourcingContractSchemas {
  // Zod 的链式泛型只在消费端参与输入推导；共享 DTO 负责约束规范化后的输出。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const z = zodRuntime as any;
  const serializedMoneySchema = z
    .string()
    .trim()
    .regex(/^(0|[1-9]\d{0,11})(?:\.\d{1,2})?$/, '金额必须为最多两位小数的十进制字符串');

  return {
    sourcingStatusSchema: z.enum(SOURCING_STATUSES),
    rfqStatusSchema: z.enum(RFQ_STATUSES),
    supplierTypeSchema: z.enum(SUPPLIER_TYPES),
    evaluationStrategySchema: z.enum(EVALUATION_STRATEGIES),
    businessErrorCodeSchema: z.enum(BUSINESS_ERROR_CODES),
    serializedMoneySchema,
    isoDateTimeSchema: z.string().datetime({ offset: true }),
    quoteSubmissionSchema: z.object({
      totalAmount: z
        .union([z.string(), z.number()])
        .transform((value: string | number) => String(value).trim())
        .pipe(serializedMoneySchema)
        .refine((value: string) => Number(value) > 0, '报价金额必须大于 0'),
      deliveryDays: z.coerce
        .number()
        .int('交期必须是整数')
        .min(1, '交期至少为 1 天')
        .max(365, '交期不能超过 365 天'),
      remark: z.string().trim().max(500, '备注不能超过 500 个字符').optional().default(''),
    }),
    externalRegistrationSchema: z.object({
      contactName: z.string().trim().min(2, '请输入至少 2 个字的联系人姓名').max(50, '联系人姓名不能超过 50 个字'),
      email: z.string().trim().email('请输入正确的邮箱地址').max(120, '邮箱地址过长'),
      password: z.string().min(8, '密码至少需要 8 位').max(72, '密码不能超过 72 位'),
    }),
  } as SourcingContractSchemas;
}
