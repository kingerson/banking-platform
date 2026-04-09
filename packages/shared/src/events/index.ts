import { z } from 'zod';

export const Subjects = {
  ClientCreated: 'banking.clients.created',
  AccountCreated: 'banking.accounts.created',
  BalanceUpdated: 'banking.accounts.balance-updated',
  TransactionRequested: 'banking.transactions.requested',
  TransactionCompleted: 'banking.transactions.completed',
  TransactionRejected: 'banking.transactions.rejected',
} as const;

export type Subject = (typeof Subjects)[keyof typeof Subjects];

export const BaseEventSchema = z.object({
  id: z.string().uuid(),
  subject: z.string(),
  timestamp: z.string().datetime(),
  version: z.literal(1),
  correlationId: z.string().uuid().optional(),
  causationId: z.string().uuid().optional(),
});

export const ClientCreatedPayload = z.object({
  clientId: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  documentNumber: z.string(),
});

export const AccountCreatedPayload = z.object({
  accountId: z.string().uuid(),
  clientId: z.string().uuid(),
  accountNumber: z.string(),
  currency: z.string(),
  initialBalance: z.number().nonnegative().optional().default(0),
});

export const BalanceUpdatedPayload = z.object({
  accountId: z.string().uuid(),
  previousBalance: z.number(),
  newBalance: z.number(),
  transactionId: z.string().uuid(),
});

export const TransactionRequestedPayload = z.object({
  transactionId: z.string().uuid(),
  type: z.enum(['deposit', 'withdrawal', 'transfer']),
  amount: z.number().positive(),
  currency: z.string(),
  sourceAccountId: z.string().uuid().nullable(),
  targetAccountId: z.string().uuid().nullable(),
  idempotencyKey: z.string(),
  description: z.string().optional(),
});

export const TransactionCompletedPayload = z.object({
  transactionId: z.string().uuid(),
  type: z.enum(['deposit', 'withdrawal', 'transfer']),
  amount: z.number().positive(),
  currency: z.string(),
  sourceAccountId: z.string().uuid().nullable(),
  targetAccountId: z.string().uuid().nullable(),
  description: z.string().optional(),
});

export const TransactionRejectedPayload = z.object({
  transactionId: z.string().uuid(),
  type: z.enum(['deposit', 'withdrawal', 'transfer']),
  amount: z.number().positive(),
  reason: z.string(),
  sourceAccountId: z.string().uuid().nullable(),
  targetAccountId: z.string().uuid().nullable(),
});

export interface EventMap {
  [Subjects.ClientCreated]: z.infer<typeof ClientCreatedPayload>;
  [Subjects.AccountCreated]: z.infer<typeof AccountCreatedPayload>;
  [Subjects.BalanceUpdated]: z.infer<typeof BalanceUpdatedPayload>;
  [Subjects.TransactionRequested]: z.infer<typeof TransactionRequestedPayload>;
  [Subjects.TransactionCompleted]: z.infer<typeof TransactionCompletedPayload>;
  [Subjects.TransactionRejected]: z.infer<typeof TransactionRejectedPayload>;
}

export interface DomainEvent<S extends Subject = Subject> {
  id: string;
  subject: S;
  timestamp: string;
  version: 1;
  correlationId?: string;
  causationId?: string;
  data: EventMap[S];
}
