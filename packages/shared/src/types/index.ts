import { z } from 'zod';

export const ClientSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2).max(100),
  email: z.string().email(),
  documentNumber: z.string().min(8).max(20),
  createdAt: z.string().datetime(),
});

export type Client = z.infer<typeof ClientSchema>;

export const AccountSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  accountNumber: z.string(),
  balance: z.number().nonnegative(),
  currency: z.enum(['PEN', 'USD']).default('PEN'),
  status: z.enum(['active', 'inactive', 'frozen']).default('active'),
  createdAt: z.string().datetime(),
});

export type Account = z.infer<typeof AccountSchema>;

export const TransactionTypeEnum = z.enum(['deposit', 'withdrawal', 'transfer']);
export const TransactionStatusEnum = z.enum(['pending', 'completed', 'rejected']);

export const TransactionSchema = z.object({
  id: z.string().uuid(),
  type: TransactionTypeEnum,
  status: TransactionStatusEnum,
  amount: z.number().positive(),
  currency: z.enum(['PEN', 'USD']).default('PEN'),
  sourceAccountId: z.string().uuid().nullable(),
  targetAccountId: z.string().uuid().nullable(),
  idempotencyKey: z.string(),
  description: z.string().optional(),
  reason: z.string().optional(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});

export type Transaction = z.infer<typeof TransactionSchema>;
export type TransactionType = z.infer<typeof TransactionTypeEnum>;
export type TransactionStatus = z.infer<typeof TransactionStatusEnum>;

export const CreateClientDto = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  documentNumber: z.string().min(8).max(20),
});

export const CreateAccountDto = z.object({
  clientId: z.string().uuid(),
  currency: z.enum(['PEN', 'USD']).default('PEN'),
  initialBalance: z.number().nonnegative().optional().default(0),
});

export const CreateTransactionDto = z.object({
  type: TransactionTypeEnum,
  amount: z.number().positive(),
  currency: z.enum(['PEN', 'USD']).default('PEN'),
  sourceAccountId: z.string().uuid().nullable().optional(),
  targetAccountId: z.string().uuid().nullable().optional(),
  idempotencyKey: z.string().min(1),
  description: z.string().optional(),
});

export const ExplainTransactionDto = z.object({
  transactionId: z.string().uuid(),
});

export const AccountSummaryDto = z.object({
  accountId: z.string().uuid(),
});

export type CreateClientInput = z.infer<typeof CreateClientDto>;
export type CreateAccountInput = z.infer<typeof CreateAccountDto>;
export type CreateTransactionInput = z.infer<typeof CreateTransactionDto>;
