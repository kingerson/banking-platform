import { Pool, PoolClient } from 'pg';
import { Transaction, OutboxRepository } from '@banking/shared';
import { pool } from '../models/database.js';

export { OutboxRepository };

const SELECT_FIELDS = `
  id, type, status, amount::float, currency,
  source_account_id AS "sourceAccountId",
  target_account_id AS "targetAccountId",
  idempotency_key AS "idempotencyKey",
  description, reason,
  created_at AS "createdAt",
  completed_at AS "completedAt"
`;

export class TransactionRepository {
  private pool: Pool;

  constructor(dbPool?: Pool) {
    this.pool = dbPool || pool;
  }

  async create(txn: {
    id: string;
    type: string;
    amount: number;
    currency: string;
    sourceAccountId: string | null;
    targetAccountId: string | null;
    idempotencyKey: string;
    description?: string;
  }): Promise<Transaction> {
    const { rows } = await this.pool.query<Transaction>(
      `INSERT INTO transactions (id, type, status, amount, currency, source_account_id, target_account_id, idempotency_key, description)
       VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8)
       RETURNING ${SELECT_FIELDS}`,
      [txn.id, txn.type, txn.amount, txn.currency, txn.sourceAccountId, txn.targetAccountId, txn.idempotencyKey, txn.description],
    );
    return rows[0];
  }

  async findById(id: string): Promise<Transaction | null> {
    const { rows } = await this.pool.query<Transaction>(
      `SELECT ${SELECT_FIELDS} FROM transactions WHERE id = $1`,
      [id],
    );
    return rows[0] || null;
  }

  async findByIdempotencyKey(key: string): Promise<Transaction | null> {
    const { rows } = await this.pool.query<Transaction>(
      `SELECT ${SELECT_FIELDS} FROM transactions WHERE idempotency_key = $1`,
      [key],
    );
    return rows[0] || null;
  }

  async findByAccountId(accountId: string, limit = 50): Promise<Transaction[]> {
    const { rows } = await this.pool.query<Transaction>(
      `SELECT ${SELECT_FIELDS} FROM transactions
       WHERE source_account_id = $1 OR target_account_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [accountId, limit],
    );
    return rows;
  }

  async updateStatus(id: string, status: 'completed' | 'rejected', reason?: string): Promise<Transaction> {
    const { rows } = await this.pool.query<Transaction>(
      `UPDATE transactions
       SET status = $2::transaction_status,
           reason = $3,
           completed_at = CASE WHEN $2 = 'completed' THEN NOW() ELSE completed_at END
       WHERE id = $1
       RETURNING ${SELECT_FIELDS}`,
      [id, status, reason || null],
    );
    return rows[0];
  }
}

export class EventTracker {
  private pool: Pool;

  constructor(dbPool?: Pool) {
    this.pool = dbPool || pool;
  }

  async isProcessed(eventId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM processed_events WHERE event_id = $1`,
      [eventId],
    );
    return rows.length > 0;
  }

  async markProcessed(eventId: string, subject: string, txClient?: PoolClient): Promise<void> {
    const executor = txClient || this.pool;
    await executor.query(
      `INSERT INTO processed_events (event_id, subject) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [eventId, subject],
    );
  }
}

export class AccountProjectionRepository {
  private pool: Pool;

  constructor(dbPool?: Pool) {
    this.pool = dbPool || pool;
  }

  async upsert(accountId: string, balance: number, currency: string = 'PEN'): Promise<void> {
    await this.pool.query(
      `INSERT INTO account_projections (account_id, balance, currency, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (account_id) DO UPDATE SET balance = $2, updated_at = NOW()`,
      [accountId, balance, currency],
    );
  }

  async getBalance(accountId: string): Promise<number | null> {
    const { rows } = await this.pool.query<{ balance: number }>(
      `SELECT balance::float FROM account_projections WHERE account_id = $1`,
      [accountId],
    );
    return rows[0]?.balance ?? null;
  }

  async exists(accountId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM account_projections WHERE account_id = $1`,
      [accountId],
    );
    return rows.length > 0;
  }
}
