import { Pool } from 'pg';
import { config } from '../config/index.js';

export const pool = new Pool(config.db);

export async function initDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TYPE transaction_type AS ENUM ('deposit', 'withdrawal', 'transfer');
      CREATE TYPE transaction_status AS ENUM ('pending', 'completed', 'rejected');
    `).catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id UUID PRIMARY KEY,
        type transaction_type NOT NULL,
        status transaction_status NOT NULL DEFAULT 'pending',
        amount DECIMAL(15,2) NOT NULL CHECK (amount > 0),
        currency VARCHAR(3) NOT NULL DEFAULT 'PEN',
        source_account_id UUID,
        target_account_id UUID,
        idempotency_key VARCHAR(255) UNIQUE NOT NULL,
        description TEXT,
        reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_txn_source ON transactions(source_account_id);
      CREATE INDEX IF NOT EXISTS idx_txn_target ON transactions(target_account_id);
      CREATE INDEX IF NOT EXISTS idx_txn_idempotency ON transactions(idempotency_key);
      CREATE INDEX IF NOT EXISTS idx_txn_status ON transactions(status);

      CREATE TABLE IF NOT EXISTS processed_events (
        event_id UUID PRIMARY KEY,
        subject VARCHAR(100) NOT NULL,
        processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- CQRS: Local projection of account balances
      -- Populated via BalanceUpdated + AccountCreated events from customer-service
      -- Eliminates HTTP calls to customer-service during saga validation
      CREATE TABLE IF NOT EXISTS account_projections (
        account_id UUID PRIMARY KEY,
        balance DECIMAL(15,2) NOT NULL DEFAULT 0.00,
        currency VARCHAR(3) NOT NULL DEFAULT 'PEN',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    console.log('[DB] Transaction database initialized');
  } finally {
    client.release();
  }
}
