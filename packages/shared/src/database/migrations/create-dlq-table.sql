-- Dead Letter Queue Table
-- Stores events that failed to process after multiple retry attempts

CREATE TABLE IF NOT EXISTS dead_letter_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Original event information
  event_id VARCHAR(255) NOT NULL,
  event_subject VARCHAR(100) NOT NULL,
  event_data JSONB NOT NULL,
  
  -- Failure tracking
  original_error TEXT NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 1,
  first_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Context for debugging
  correlation_id UUID,
  service_name VARCHAR(50) NOT NULL,
  consumer_group VARCHAR(100),
  
  -- Status tracking
  status VARCHAR(20) NOT NULL DEFAULT 'failed',
  -- Possible values: 'failed', 'investigating', 'resolved', 'ignored'
  
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by VARCHAR(100),
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_dlq_event_id ON dead_letter_queue(event_id);
CREATE INDEX IF NOT EXISTS idx_dlq_status ON dead_letter_queue(status);
CREATE INDEX IF NOT EXISTS idx_dlq_service ON dead_letter_queue(service_name);
CREATE INDEX IF NOT EXISTS idx_dlq_correlation_id ON dead_letter_queue(correlation_id);
CREATE INDEX IF NOT EXISTS idx_dlq_first_failed_at ON dead_letter_queue(first_failed_at DESC);

-- Comments
COMMENT ON TABLE dead_letter_queue IS 'Stores events that failed to process after multiple retry attempts';
COMMENT ON COLUMN dead_letter_queue.event_id IS 'Original event ID from the event bus';
COMMENT ON COLUMN dead_letter_queue.failure_count IS 'Number of times this event failed to process';
COMMENT ON COLUMN dead_letter_queue.status IS 'Current status: failed, investigating, resolved, ignored';
