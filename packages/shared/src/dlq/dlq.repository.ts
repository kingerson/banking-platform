import { Pool, PoolClient } from 'pg';

export interface DLQEvent {
  id: string;
  eventId: string;
  eventSubject: string;
  eventData: any;
  originalError: string;
  failureCount: number;
  firstFailedAt: Date;
  lastFailedAt: Date;
  correlationId?: string;
  serviceName: string;
  consumerGroup?: string;
  status: 'failed' | 'investigating' | 'resolved' | 'ignored';
  resolutionNotes?: string;
  resolvedAt?: Date;
  resolvedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDLQEventInput {
  eventId: string;
  eventSubject: string;
  eventData: any;
  originalError: string;
  failureCount?: number;
  correlationId?: string;
  serviceName: string;
  consumerGroup?: string;
}

export interface UpdateDLQEventInput {
  status?: 'failed' | 'investigating' | 'resolved' | 'ignored';
  resolutionNotes?: string;
  resolvedBy?: string;
}

export class DLQRepository {
  constructor(private pool: Pool) {}

  async add(input: CreateDLQEventInput, client?: PoolClient): Promise<DLQEvent> {
    const db = client || this.pool;

    const query = `
      INSERT INTO dead_letter_queue (
        event_id,
        event_subject,
        event_data,
        original_error,
        failure_count,
        correlation_id,
        service_name,
        consumer_group,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'failed')
      RETURNING *
    `;

    const values = [
      input.eventId,
      input.eventSubject,
      JSON.stringify(input.eventData),
      input.originalError,
      input.failureCount || 1,
      input.correlationId,
      input.serviceName,
      input.consumerGroup,
    ];

    const result = await db.query(query, values);
    return this.mapRow(result.rows[0]);
  }

  async update(id: string, input: UpdateDLQEventInput): Promise<DLQEvent | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (input.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(input.status);
    }

    if (input.resolutionNotes !== undefined) {
      updates.push(`resolution_notes = $${paramIndex++}`);
      values.push(input.resolutionNotes);
    }

    if (input.resolvedBy !== undefined) {
      updates.push(`resolved_by = $${paramIndex++}`);
      values.push(input.resolvedBy);
    }

    if (input.status === 'resolved') {
      updates.push(`resolved_at = NOW()`);
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const query = `
      UPDATE dead_letter_queue
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await this.pool.query(query, values);
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }

  async incrementFailureCount(eventId: string, error: string): Promise<void> {
    const query = `
      UPDATE dead_letter_queue
      SET
        failure_count = failure_count + 1,
        last_failed_at = NOW(),
        original_error = $2,
        updated_at = NOW()
      WHERE event_id = $1
    `;

    await this.pool.query(query, [eventId, error]);
  }

  async exists(eventId: string): Promise<boolean> {
    const query = `
      SELECT EXISTS(
        SELECT 1 FROM dead_letter_queue WHERE event_id = $1
      ) as exists
    `;

    const result = await this.pool.query(query, [eventId]);
    return result.rows[0].exists;
  }

  async findById(id: string): Promise<DLQEvent | null> {
    const query = `
      SELECT * FROM dead_letter_queue WHERE id = $1
    `;

    const result = await this.pool.query(query, [id]);
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }

  async findByEventId(eventId: string): Promise<DLQEvent | null> {
    const query = `
      SELECT * FROM dead_letter_queue WHERE event_id = $1
    `;

    const result = await this.pool.query(query, [eventId]);
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }

  async findAll(
    status?: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<DLQEvent[]> {
    let query = `
      SELECT * FROM dead_letter_queue
    `;

    const values: any[] = [];
    if (status) {
      query += ` WHERE status = $1`;
      values.push(status);
    }

    query += ` ORDER BY first_failed_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(limit, offset);

    const result = await this.pool.query(query, values);
    return result.rows.map(row => this.mapRow(row));
  }

  async findByService(serviceName: string, limit: number = 100): Promise<DLQEvent[]> {
    const query = `
      SELECT * FROM dead_letter_queue
      WHERE service_name = $1 AND status = 'failed'
      ORDER BY first_failed_at DESC
      LIMIT $2
    `;

    const result = await this.pool.query(query, [serviceName, limit]);
    return result.rows.map(row => this.mapRow(row));
  }

  async getStats(): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byService: Record<string, number>;
    recentFailures: number;
  }> {
    const queries = await Promise.all([

      this.pool.query('SELECT COUNT(*) as count FROM dead_letter_queue'),

      this.pool.query(`
        SELECT status, COUNT(*) as count
        FROM dead_letter_queue
        GROUP BY status
      `),

      this.pool.query(`
        SELECT service_name, COUNT(*) as count
        FROM dead_letter_queue
        WHERE status = 'failed'
        GROUP BY service_name
      `),

      this.pool.query(`
        SELECT COUNT(*) as count
        FROM dead_letter_queue
        WHERE first_failed_at > NOW() - INTERVAL '24 hours'
      `),
    ]);

    const byStatus: Record<string, number> = {};
    queries[1].rows.forEach(row => {
      byStatus[row.status] = parseInt(row.count);
    });

    const byService: Record<string, number> = {};
    queries[2].rows.forEach(row => {
      byService[row.service_name] = parseInt(row.count);
    });

    return {
      total: parseInt(queries[0].rows[0].count),
      byStatus,
      byService,
      recentFailures: parseInt(queries[3].rows[0].count),
    };
  }

  async cleanup(olderThanDays: number = 30): Promise<number> {
    const query = `
      DELETE FROM dead_letter_queue
      WHERE status IN ('resolved', 'ignored')
        AND resolved_at < NOW() - INTERVAL '${olderThanDays} days'
    `;

    const result = await this.pool.query(query);
    return result.rowCount || 0;
  }

  private mapRow(row: any): DLQEvent {
    return {
      id: row.id,
      eventId: row.event_id,
      eventSubject: row.event_subject,
      eventData: typeof row.event_data === 'string' ? JSON.parse(row.event_data) : row.event_data,
      originalError: row.original_error,
      failureCount: row.failure_count,
      firstFailedAt: row.first_failed_at,
      lastFailedAt: row.last_failed_at,
      correlationId: row.correlation_id,
      serviceName: row.service_name,
      consumerGroup: row.consumer_group,
      status: row.status,
      resolutionNotes: row.resolution_notes,
      resolvedAt: row.resolved_at,
      resolvedBy: row.resolved_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
