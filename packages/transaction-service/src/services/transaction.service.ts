import { v4 as uuid } from 'uuid';
import {
  CreateTransactionInput,
  Subjects,
  DuplicateTransactionError,
  ValidationError,
  NotFoundError,
  OutboxRepository,
} from '@banking/shared';
import { TransactionRepository } from '../repositories/index.js';
import { config } from '../config/index.js';
import { pool as defaultPool } from '../models/database.js';
import type { Pool } from 'pg';

export class TransactionService {
  private outboxRepo: OutboxRepository;
  private pool: Pool;

  constructor(
    private txnRepo: TransactionRepository,
    injectedPool?: Pool,
  ) {
    this.pool = injectedPool ?? defaultPool;
    this.outboxRepo = new OutboxRepository(this.pool);
  }

  async requestTransaction(input: CreateTransactionInput, correlationId?: string) {

    this.validateTransactionInput(input);

    const existing = await this.txnRepo.findByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      throw new DuplicateTransactionError(input.idempotencyKey);
    }

    await this.validateAccounts(input);

    const dbClient = await this.pool.connect();
    try {
      await dbClient.query('BEGIN');

      const txn = await this.txnRepo.create({
        id: uuid(),
        type: input.type,
        amount: input.amount,
        currency: input.currency || 'PEN',
        sourceAccountId: input.sourceAccountId || null,
        targetAccountId: input.targetAccountId || null,
        idempotencyKey: input.idempotencyKey,
        description: input.description,
      });

      await this.outboxRepo.insert(
        Subjects.TransactionRequested,
        {
          transactionId: txn.id,
          type: txn.type,
          amount: txn.amount,
          currency: txn.currency,
          sourceAccountId: txn.sourceAccountId,
          targetAccountId: txn.targetAccountId,
          idempotencyKey: txn.idempotencyKey,
          description: txn.description ?? undefined,
        },
        dbClient,
        correlationId,
      );

      await dbClient.query('COMMIT');
      return txn;
    } catch (error) {
      await dbClient.query('ROLLBACK');
      throw error;
    } finally {
      dbClient.release();
    }
  }

  async getTransaction(id: string) {
    const txn = await this.txnRepo.findById(id);
    if (!txn) throw new NotFoundError('Transaction', id);
    return txn;
  }

  async getAccountTransactions(accountId: string) {
    return this.txnRepo.findByAccountId(accountId);
  }

  private validateTransactionInput(input: CreateTransactionInput) {
    switch (input.type) {
      case 'deposit':
        if (!input.targetAccountId) {
          throw new ValidationError('Deposit requires a target account');
        }
        break;
      case 'withdrawal':
        if (!input.sourceAccountId) {
          throw new ValidationError('Withdrawal requires a source account');
        }
        break;
      case 'transfer':
        if (!input.sourceAccountId || !input.targetAccountId) {
          throw new ValidationError('Transfer requires both source and target accounts');
        }
        if (input.sourceAccountId === input.targetAccountId) {
          throw new ValidationError('Cannot transfer to the same account');
        }
        break;
    }
  }

  private async validateAccounts(input: CreateTransactionInput) {
    const accountIds = [input.sourceAccountId, input.targetAccountId].filter(Boolean) as string[];

    for (const accountId of accountIds) {
      try {
        const response = await fetch(
          `${config.customerServiceUrl}/api/v1/accounts/${accountId}`,
          { signal: AbortSignal.timeout(3000) },
        );
        if (!response.ok) {
          throw new NotFoundError('Account', accountId);
        }
      } catch (err) {
        if (err instanceof NotFoundError) throw err;

        console.warn(`[TransactionService] Could not validate account ${accountId}, proceeding optimistically`);
      }
    }
  }
}
