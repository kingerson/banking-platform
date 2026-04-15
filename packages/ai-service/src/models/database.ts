import { Pool } from 'pg';
import { config } from '../config/index';

export const pool = new Pool(config.db);

export async function initDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_explanations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id UUID,
        event_subject VARCHAR(100),
        event_data JSONB NOT NULL,
        explanation TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_ai_txn_id ON ai_explanations(transaction_id);

      CREATE TABLE IF NOT EXISTS processed_events (
        event_id UUID PRIMARY KEY,
        subject VARCHAR(100) NOT NULL,
        processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Transactional Outbox
      CREATE TABLE IF NOT EXISTS outbox (
        id UUID PRIMARY KEY,
        subject VARCHAR(100) NOT NULL,
        payload JSONB NOT NULL,
        correlation_id UUID,
        created_at TIMESTAMPTZ NOT NULL,
        published_at TIMESTAMPTZ,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox(created_at) WHERE published_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_outbox_published ON outbox(published_at) WHERE published_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_outbox_correlation ON outbox(correlation_id) WHERE correlation_id IS NOT NULL;
    `);
    console.log('[DB] AI database initialized');
  } finally {
    client.release();
  }
}
