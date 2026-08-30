import { createSourcingContractSchemas } from '@haitian/sourcing-contracts/schemas';
import { z } from 'zod';

export const { quoteSubmissionSchema: quoteInputSchema } = createSourcingContractSchemas(z);
export type { QuoteSubmissionInput as QuoteInput } from '@haitian/sourcing-contracts';
