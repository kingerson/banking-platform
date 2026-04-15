import { Pool } from 'pg';
import { config } from '../config/index';

export const pool = new Pool(config.db);

export async function initDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id UUID PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        document_number VARCHAR(20) UNIQUE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS accounts (
        id UUID PRIMARY KEY,
        client_id UUID NOT NULL REFERENCES clients(id),
        account_number VARCHAR(20) UNIQUE NOT NULL,
        balance DECIMAL(15,2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
        currency VARCHAR(3) NOT NULL DEFAULT 'PEN',
        status VARCHAR(10) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_accounts_client_id ON accounts(client_id);
      CREATE INDEX IF NOT EXISTS idx_accounts_number ON accounts(account_number);

      -- Idempotent event tracking
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
    console.log('[DB] Customer database initialized');
  } finally {
    client.release();
  }
}
