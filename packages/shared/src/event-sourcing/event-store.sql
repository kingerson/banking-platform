-- Event Store Table
-- Stores ALL events in an append-only, immutable log
-- This is the source of truth for the system state

CREATE TABLE IF NOT EXISTS event_store (
  -- Event identification
  event_id UUID PRIMARY KEY,
  
  -- Aggregate information
  aggregate_id UUID NOT NULL,
  aggregate_type VARCHAR(50) NOT NULL, -- 'Account', 'Transaction', 'Client'
  
  -- Event details
  event_type VARCHAR(100) NOT NULL,    -- 'AccountCreated', 'MoneyDeposited', etc.
  event_data JSONB NOT NULL,           -- Event payload
  
  -- Versioning (for optimistic locking)
  version INTEGER NOT NULL,
  
  -- Metadata
  correlation_id UUID,
  causation_id UUID,                   -- ID of the event that caused this event
  user_id VARCHAR(100),                -- Who triggered this event
  
  -- Timestamps
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT unique_aggregate_version UNIQUE (aggregate_id, version)
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_event_store_aggregate ON event_store(aggregate_id, version);
CREATE INDEX IF NOT EXISTS idx_event_store_type ON event_store(aggregate_type, event_type);
CREATE INDEX IF NOT EXISTS idx_event_store_correlation ON event_store(correlation_id);
CREATE INDEX IF NOT EXISTS idx_event_store_timestamp ON event_store(timestamp DESC);

-- Snapshots Table (optimization)
-- Stores periodic snapshots of aggregate state to avoid replaying millions of events
CREATE TABLE IF NOT EXISTS event_store_snapshots (
  snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  aggregate_id UUID NOT NULL,
  aggregate_type VARCHAR(50) NOT NULL,
  
  -- Snapshot state
  version INTEGER NOT NULL,           -- Last event version included in snapshot
  state JSONB NOT NULL,               -- Complete aggregate state
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT unique_snapshot UNIQUE (aggregate_id, version)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_aggregate ON event_store_snapshots(aggregate_id, version DESC);

-- Comments
COMMENT ON TABLE event_store IS 'Append-only event log - source of truth for system state';
COMMENT ON TABLE event_store_snapshots IS 'Periodic snapshots to optimize event replay';
COMMENT ON COLUMN event_store.version IS 'Monotonically increasing version number for optimistic locking';
COMMENT ON COLUMN event_store_snapshots.version IS 'Last event version included in this snapshot';
