import { Pool, PoolClient } from 'pg';
import { v4 as uuid } from 'uuid';
import { Subject } from '../events/index';

export interface OutboxMessage {
  id: string;
  subject: Subject;
  payload: string;
  correlationId: string | null;
  createdAt: string;
  publishedAt: string | null;
  attempts: number;
  lastError: string | null;
}

export class OutboxRepository {
  private pool: Pool;

  constructor(dbPool: Pool) {
    this.pool = dbPool;
  }

  async insert(
    subject: Subject,
    payload: Record<string, any>,
    txClient?: PoolClient,
    correlationId?: string,
  ): Promise<string> {
    const executor = txClient || this.pool;
    const id = uuid();

    await executor.query(
      `INSERT INTO outbox (id, subject, payload, correlation_id, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [id, subject, JSON.stringify(payload), correlationId || null],
    );

    try {
      await (txClient || this.pool).query(`NOTIFY outbox_insert`);
    } catch {

    }

    return id;
  }

  async getPending(limit: number = 100): Promise<OutboxMessage[]> {
    const { rows } = await this.pool.query<OutboxMessage>(
      `SELECT id, subject, payload, correlation_id AS "correlationId",
              created_at AS "createdAt", published_at AS "publishedAt",
              attempts, last_error AS "lastError"
       FROM outbox
       WHERE published_at IS NULL
       ORDER BY created_at ASC
       LIMIT $1`,
      [limit],
    );
    return rows;
  }

  async markPublished(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE outbox SET published_at = NOW() WHERE id = $1`,
      [id],
    );
  }

  async recordFailure(id: string, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE outbox
       SET attempts = attempts + 1, last_error = $2
       WHERE id = $1`,
      [id, error],
    );
  }

  async deletePublished(olderThanHours: number = 24): Promise<number> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM outbox
       WHERE published_at IS NOT NULL
       AND published_at < NOW() - INTERVAL '1 hour' * $1`,
      [olderThanHours],
    );
    return rowCount || 0;
  }

  async getFailed(minAttempts: number = 3): Promise<OutboxMessage[]> {
    const { rows } = await this.pool.query<OutboxMessage>(
      `SELECT id, subject, payload, correlation_id AS "correlationId",
              created_at AS "createdAt", published_at AS "publishedAt",
              attempts, last_error AS "lastError"
       FROM outbox
       WHERE published_at IS NULL AND attempts >= $1
       ORDER BY created_at ASC`,
      [minAttempts],
    );
    return rows;
  }
}
