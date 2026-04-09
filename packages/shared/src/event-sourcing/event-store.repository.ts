import { Pool, PoolClient } from 'pg';

export interface StoredEvent {
  eventId: string;
  aggregateId: string;
  aggregateType: string;
  eventType: string;
  eventData: any;
  version: number;
  correlationId?: string;
  causationId?: string;
  userId?: string;
  timestamp: Date;
}

export interface Snapshot {
  snapshotId: string;
  aggregateId: string;
  aggregateType: string;
  version: number;
  state: any;
  createdAt: Date;
}

export interface AppendEventInput {
  eventId: string;
  aggregateId: string;
  aggregateType: string;
  eventType: string;
  eventData: any;
  expectedVersion?: number;
  correlationId?: string;
  causationId?: string;
  userId?: string;
}

export class EventStoreRepository {
  constructor(private pool: Pool) {}

  async append(input: AppendEventInput, client?: PoolClient): Promise<StoredEvent> {
    const db = client || this.pool;

    const versionQuery = `
      SELECT COALESCE(MAX(version), 0) as current_version
      FROM event_store
      WHERE aggregate_id = $1
    `;

    const versionResult = await db.query(versionQuery, [input.aggregateId]);
    const currentVersion = parseInt(versionResult.rows[0].current_version);
    const newVersion = currentVersion + 1;

    if (input.expectedVersion !== undefined && input.expectedVersion !== currentVersion) {
      throw new Error(
        `Concurrency conflict: Expected version ${input.expectedVersion}, but current is ${currentVersion}`
      );
    }

    const insertQuery = `
      INSERT INTO event_store (
        event_id,
        aggregate_id,
        aggregate_type,
        event_type,
        event_data,
        version,
        correlation_id,
        causation_id,
        user_id,
        timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      RETURNING *
    `;

    const values = [
      input.eventId,
      input.aggregateId,
      input.aggregateType,
      input.eventType,
      JSON.stringify(input.eventData),
      newVersion,
      input.correlationId,
      input.causationId,
      input.userId,
    ];

    const result = await db.query(insertQuery, values);
    return this.mapEventRow(result.rows[0]);
  }

  async appendBatch(events: AppendEventInput[]): Promise<StoredEvent[]> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const storedEvents: StoredEvent[] = [];
      for (const event of events) {
        const stored = await this.append(event, client);
        storedEvents.push(stored);
      }

      await client.query('COMMIT');
      return storedEvents;

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getEvents(
    aggregateId: string,
    fromVersion: number = 0
  ): Promise<StoredEvent[]> {
    const query = `
      SELECT * FROM event_store
      WHERE aggregate_id = $1 AND version > $2
      ORDER BY version ASC
    `;

    const result = await this.pool.query(query, [aggregateId, fromVersion]);
    return result.rows.map(row => this.mapEventRow(row));
  }

  async getEventsByType(
    eventType: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<StoredEvent[]> {
    const query = `
      SELECT * FROM event_store
      WHERE event_type = $1
      ORDER BY timestamp DESC
      LIMIT $2 OFFSET $3
    `;

    const result = await this.pool.query(query, [eventType, limit, offset]);
    return result.rows.map(row => this.mapEventRow(row));
  }

  async getEventsByTimeRange(
    from: Date,
    to: Date,
    aggregateType?: string
  ): Promise<StoredEvent[]> {
    let query = `
      SELECT * FROM event_store
      WHERE timestamp >= $1 AND timestamp <= $2
    `;

    const values: any[] = [from, to];

    if (aggregateType) {
      query += ` AND aggregate_type = $3`;
      values.push(aggregateType);
    }

    query += ` ORDER BY timestamp ASC`;

    const result = await this.pool.query(query, values);
    return result.rows.map(row => this.mapEventRow(row));
  }

  async saveSnapshot(
    aggregateId: string,
    aggregateType: string,
    version: number,
    state: any
  ): Promise<Snapshot> {
    const query = `
      INSERT INTO event_store_snapshots (
        aggregate_id,
        aggregate_type,
        version,
        state
      ) VALUES ($1, $2, $3, $4)
      RETURNING *
    `;

    const values = [
      aggregateId,
      aggregateType,
      version,
      JSON.stringify(state),
    ];

    const result = await this.pool.query(query, values);
    return this.mapSnapshotRow(result.rows[0]);
  }

  async getLatestSnapshot(aggregateId: string): Promise<Snapshot | null> {
    const query = `
      SELECT * FROM event_store_snapshots
      WHERE aggregate_id = $1
      ORDER BY version DESC
      LIMIT 1
    `;

    const result = await this.pool.query(query, [aggregateId]);
    return result.rows.length > 0 ? this.mapSnapshotRow(result.rows[0]) : null;
  }

  async getCurrentVersion(aggregateId: string): Promise<number> {
    const query = `
      SELECT COALESCE(MAX(version), 0) as version
      FROM event_store
      WHERE aggregate_id = $1
    `;

    const result = await this.pool.query(query, [aggregateId]);
    return parseInt(result.rows[0].version);
  }

  async getStats(): Promise<{
    totalEvents: number;
    eventsByType: Record<string, number>;
    eventsByAggregate: Record<string, number>;
    oldestEvent: Date | null;
    newestEvent: Date | null;
  }> {
    const queries = await Promise.all([

      this.pool.query('SELECT COUNT(*) as count FROM event_store'),

      this.pool.query(`
        SELECT event_type, COUNT(*) as count
        FROM event_store
        GROUP BY event_type
        ORDER BY count DESC
      `),

      this.pool.query(`
        SELECT aggregate_type, COUNT(*) as count
        FROM event_store
        GROUP BY aggregate_type
        ORDER BY count DESC
      `),

      this.pool.query(`
        SELECT
          MIN(timestamp) as oldest,
          MAX(timestamp) as newest
        FROM event_store
      `),
    ]);

    const eventsByType: Record<string, number> = {};
    queries[1].rows.forEach(row => {
      eventsByType[row.event_type] = parseInt(row.count);
    });

    const eventsByAggregate: Record<string, number> = {};
    queries[2].rows.forEach(row => {
      eventsByAggregate[row.aggregate_type] = parseInt(row.count);
    });

    return {
      totalEvents: parseInt(queries[0].rows[0].count),
      eventsByType,
      eventsByAggregate,
      oldestEvent: queries[3].rows[0].oldest,
      newestEvent: queries[3].rows[0].newest,
    };
  }

  private mapEventRow(row: any): StoredEvent {
    return {
      eventId: row.event_id,
      aggregateId: row.aggregate_id,
      aggregateType: row.aggregate_type,
      eventType: row.event_type,
      eventData: typeof row.event_data === 'string' ? JSON.parse(row.event_data) : row.event_data,
      version: row.version,
      correlationId: row.correlation_id,
      causationId: row.causation_id,
      userId: row.user_id,
      timestamp: row.timestamp,
    };
  }

  private mapSnapshotRow(row: any): Snapshot {
    return {
      snapshotId: row.snapshot_id,
      aggregateId: row.aggregate_id,
      aggregateType: row.aggregate_type,
      version: row.version,
      state: typeof row.state === 'string' ? JSON.parse(row.state) : row.state,
      createdAt: row.created_at,
    };
  }
}
