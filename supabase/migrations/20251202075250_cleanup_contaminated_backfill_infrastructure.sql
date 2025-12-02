/*
  # Cleanup Contaminated Backfill Infrastructure

  ## Problem
  - Multiple legacy backfill tables from various failed attempts
  - Contaminated scripts and functions have been removed
  - Need to clean database to match clean codebase

  ## Tables to Remove
  - backfill_execution_log (legacy)
  - backfill_jobs (legacy)
  - backfill_progress (legacy)
  - backfill_sources (legacy)
  - backfill_tasks (legacy)
  - backfill_validation_stats (legacy)
  - candle_gap_fill_log (legacy)

  ## New Clean Infrastructure
  - backfill_executions (simple, clean logging table)
  - No other tables needed - keep it simple!

  ## Safety
  - All legacy tables dropped completely
  - No data migration needed (old backfills are irrelevant)
  - Preserves all critical tables (realtime_prices, forex_candles)
*/

-- ============================================================================
-- STEP 1: DROP ALL CONTAMINATED BACKFILL TABLES
-- ============================================================================

DROP TABLE IF EXISTS backfill_execution_log CASCADE;
DROP TABLE IF EXISTS backfill_jobs CASCADE;
DROP TABLE IF EXISTS backfill_progress CASCADE;
DROP TABLE IF EXISTS backfill_sources CASCADE;
DROP TABLE IF EXISTS backfill_tasks CASCADE;
DROP TABLE IF EXISTS backfill_validation_stats CASCADE;
DROP TABLE IF EXISTS candle_gap_fill_log CASCADE;

-- Drop any orphaned functions
DROP FUNCTION IF EXISTS detect_candle_gaps(text, text, integer) CASCADE;
DROP FUNCTION IF EXISTS fill_detected_gaps(text, text) CASCADE;
DROP FUNCTION IF EXISTS schedule_backfill_job(text, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS process_backfill_queue() CASCADE;

-- ============================================================================
-- STEP 2: CREATE NEW CLEAN BACKFILL EXECUTION LOG
-- ============================================================================

CREATE TABLE IF NOT EXISTS backfill_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  
  -- Backfill parameters
  symbol text NOT NULL,
  timeframe text NOT NULL CHECK (timeframe IN ('M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1')),
  start_date timestamptz NOT NULL,
  end_date timestamptz NOT NULL,
  
  -- Results
  candles_requested integer DEFAULT 0,
  candles_inserted integer DEFAULT 0,
  candles_skipped integer DEFAULT 0,
  api_calls_made integer DEFAULT 0,
  
  -- Status tracking
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'error', 'cancelled')),
  error_message text,
  error_details jsonb,
  
  -- Performance metrics
  duration_ms integer,
  avg_api_latency_ms integer,
  
  -- Metadata
  triggered_by text,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Indexes for querying
CREATE INDEX IF NOT EXISTS idx_backfill_executions_started 
  ON backfill_executions(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_backfill_executions_symbol_tf 
  ON backfill_executions(symbol, timeframe, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_backfill_executions_status 
  ON backfill_executions(status, started_at DESC);

-- Enable RLS
ALTER TABLE backfill_executions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view backfill executions"
  ON backfill_executions
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage backfill executions"
  ON backfill_executions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- STEP 3: VERIFICATION & CLEANUP SUMMARY
-- ============================================================================

DO $$
DECLARE
  remaining_backfill_tables INTEGER;
BEGIN
  -- Count remaining backfill-related tables
  SELECT COUNT(*) INTO remaining_backfill_tables
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename LIKE '%backfill%'
    AND tablename != 'backfill_executions';
  
  IF remaining_backfill_tables > 0 THEN
    RAISE WARNING 'Warning: % legacy backfill tables still remain', remaining_backfill_tables;
  ELSE
    RAISE NOTICE '✅ All contaminated backfill tables removed successfully';
  END IF;
  
  RAISE NOTICE '✅ New clean backfill_executions table created';
  RAISE NOTICE '✅ Database backfill infrastructure cleanup complete';
END $$;
