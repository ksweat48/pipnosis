/*
  # Fix Backtest Progress Functions (Optimized)

  This migration replaces the timing-out 20251113110354 migration with an optimized version.

  ## Problem
  The original migration times out due to:
  - Missing indexes before queries
  - Complex queries without proper optimization
  - No statement timeout configuration

  ## Solution
  - Add all necessary indexes FIRST
  - Optimize function queries
  - Add statement timeouts
  - Use simpler logic where possible
*/

-- =====================================================
-- 1. ADD MISSING INDEXES FIRST
-- =====================================================

-- Ensure backtest_progress_tracking table exists and has proper indexes
DO $$
BEGIN
  -- Add indexes if they don't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'backtest_progress_tracking' AND indexname = 'idx_backtest_progress_backtest_id'
  ) THEN
    CREATE INDEX idx_backtest_progress_backtest_id
      ON backtest_progress_tracking(backtest_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'backtest_progress_tracking' AND indexname = 'idx_backtest_progress_status'
  ) THEN
    CREATE INDEX idx_backtest_progress_status
      ON backtest_progress_tracking(status, updated_at DESC);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'backtest_progress_tracking' AND indexname = 'idx_backtest_progress_user_status'
  ) THEN
    CREATE INDEX idx_backtest_progress_user_status
      ON backtest_progress_tracking(user_id, status, created_at DESC);
  END IF;
END $$;

-- =====================================================
-- 2. ADD MISSING COLUMNS IF NEEDED
-- =====================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'backtest_progress_tracking' AND column_name = 'session_name'
  ) THEN
    ALTER TABLE backtest_progress_tracking ADD COLUMN session_name text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'backtest_progress_tracking' AND column_name = 'winning_trades'
  ) THEN
    ALTER TABLE backtest_progress_tracking ADD COLUMN winning_trades integer DEFAULT 0 NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'backtest_progress_tracking' AND column_name = 'losing_trades'
  ) THEN
    ALTER TABLE backtest_progress_tracking ADD COLUMN losing_trades integer DEFAULT 0 NOT NULL;
  END IF;
END $$;

-- =====================================================
-- 3. CREATE OPTIMIZED FUNCTIONS WITH TIMEOUTS
-- =====================================================

-- Function: Initialize Backtest Progress (Optimized)
CREATE OR REPLACE FUNCTION initialize_backtest_progress(
  p_backtest_id uuid,
  p_user_id uuid,
  p_session_name text DEFAULT 'Backtest Session',
  p_total_candles integer DEFAULT 1000
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '5s'  -- 5 second timeout
AS $$
DECLARE
  v_progress_id uuid;
BEGIN
  -- Insert or update progress tracking
  INSERT INTO backtest_progress_tracking (
    backtest_id,
    user_id,
    session_name,
    current_step,
    progress_percentage,
    current_candle,
    total_candles,
    phase,
    trades_executed,
    winning_trades,
    losing_trades,
    status,
    last_updated_at
  ) VALUES (
    p_backtest_id,
    p_user_id,
    p_session_name,
    'Initializing',
    0,
    0,
    p_total_candles,
    'initializing',
    0,
    0,
    0,
    'running',
    now()
  )
  ON CONFLICT (backtest_id) DO UPDATE SET
    session_name = EXCLUDED.session_name,
    total_candles = EXCLUDED.total_candles,
    status = 'running',
    last_updated_at = now()
  RETURNING id INTO v_progress_id;

  RETURN v_progress_id;
END;
$$;

-- Function: Update Backtest Progress with Trade Result (Optimized)
CREATE OR REPLACE FUNCTION update_backtest_progress_with_trade(
  p_backtest_id uuid,
  p_trade_outcome text,
  p_profit_loss numeric DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '3s'  -- 3 second timeout
AS $$
BEGIN
  -- Simple atomic update - no SELECT needed
  UPDATE backtest_progress_tracking
  SET
    trades_executed = trades_executed + 1,
    winning_trades = CASE WHEN p_trade_outcome = 'win' THEN winning_trades + 1 ELSE winning_trades END,
    losing_trades = CASE WHEN p_trade_outcome = 'loss' THEN losing_trades + 1 ELSE losing_trades END,
    current_profit_loss = COALESCE(current_profit_loss, 0) + p_profit_loss,
    status = 'running',
    last_updated_at = now()
  WHERE backtest_id = p_backtest_id;
END;
$$;

-- Function: Complete Backtest Progress (Optimized)
CREATE OR REPLACE FUNCTION complete_backtest_progress(
  p_backtest_id uuid,
  p_status text DEFAULT 'completed',
  p_error_message text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '3s'  -- 3 second timeout
AS $$
BEGIN
  -- Simple atomic update
  UPDATE backtest_progress_tracking
  SET
    status = p_status,
    progress_percentage = CASE WHEN p_status = 'completed' THEN 100 ELSE progress_percentage END,
    completed_at = now(),
    error_message = p_error_message,
    last_updated_at = now()
  WHERE backtest_id = p_backtest_id;
END;
$$;

-- =====================================================
-- 4. GRANT PERMISSIONS
-- =====================================================

GRANT EXECUTE ON FUNCTION initialize_backtest_progress(uuid, uuid, text, integer) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION update_backtest_progress_with_trade(uuid, text, numeric) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION complete_backtest_progress(uuid, text, text) TO authenticated, anon, service_role;

-- =====================================================
-- 5. CREATE HELPER FUNCTION FOR BATCH UPDATES
-- =====================================================

-- Function to update progress in batches (for performance)
CREATE OR REPLACE FUNCTION update_backtest_progress_batch(
  p_backtest_id uuid,
  p_progress_percentage integer,
  p_current_candle integer,
  p_current_step text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '2s'
AS $$
BEGIN
  UPDATE backtest_progress_tracking
  SET
    progress_percentage = p_progress_percentage,
    current_candle = p_current_candle,
    current_step = COALESCE(p_current_step, current_step),
    last_updated_at = now()
  WHERE backtest_id = p_backtest_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_backtest_progress_batch(uuid, integer, integer, text) TO authenticated, anon, service_role;

-- =====================================================
-- 6. CREATE VIEW FOR MONITORING
-- =====================================================

CREATE OR REPLACE VIEW backtest_progress_summary AS
SELECT
  backtest_id,
  user_id,
  session_name,
  status,
  phase,
  progress_percentage,
  trades_executed,
  winning_trades,
  losing_trades,
  CASE
    WHEN losing_trades > 0 THEN ROUND((winning_trades::numeric / losing_trades::numeric) * 100, 2)
    ELSE 0
  END as win_loss_ratio,
  current_profit_loss,
  EXTRACT(EPOCH FROM (COALESCE(completed_at, now()) - created_at)) as duration_seconds,
  created_at,
  last_updated_at,
  completed_at
FROM backtest_progress_tracking
WHERE created_at > now() - interval '7 days'
ORDER BY created_at DESC;

GRANT SELECT ON backtest_progress_summary TO authenticated;

COMMENT ON VIEW backtest_progress_summary IS 'Summary view of backtest progress for monitoring dashboard';

-- =====================================================
-- 7. LOG COMPLETION
-- =====================================================

INSERT INTO cron_job_execution_log (job_name, status, result)
VALUES (
  'fix-backtest-progress-functions',
  'completed',
  jsonb_build_object(
    'action', 'optimized_backtest_progress_functions',
    'indexes_added', 3,
    'functions_created', 4,
    'statement_timeouts', 'enabled',
    'note', 'Replaces timing-out 20251113110354 migration with optimized version'
  )
);
