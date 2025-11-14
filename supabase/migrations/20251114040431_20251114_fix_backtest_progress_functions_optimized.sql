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

DO $$
BEGIN
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
      ON backtest_progress_tracking(status, last_updated_at DESC);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'backtest_progress_tracking' AND indexname = 'idx_backtest_progress_user_status'
  ) THEN
    CREATE INDEX idx_backtest_progress_user_status
      ON backtest_progress_tracking(user_id, status, started_at DESC);
  END IF;
END $$;

-- =====================================================
-- 2. CREATE OPTIMIZED FUNCTIONS WITH TIMEOUTS
-- =====================================================

CREATE OR REPLACE FUNCTION initialize_backtest_progress(
  p_backtest_id uuid,
  p_user_id uuid,
  p_session_name text DEFAULT 'Backtest Session',
  p_total_candles integer DEFAULT 1000
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '5s'
AS $$
DECLARE
  v_progress_id uuid;
BEGIN
  INSERT INTO backtest_progress_tracking (
    backtest_id,
    user_id,
    session_name,
    current_step,
    total_steps,
    progress_percentage,
    current_candle,
    total_candles,
    phase,
    trades_executed,
    winning_trades,
    losing_trades,
    status,
    started_at,
    last_updated_at
  ) VALUES (
    p_backtest_id,
    p_user_id,
    p_session_name,
    'Initializing',
    100,
    0,
    0,
    p_total_candles,
    'initializing',
    0,
    0,
    0,
    'running',
    now(),
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

CREATE OR REPLACE FUNCTION update_backtest_progress_with_trade(
  p_backtest_id uuid,
  p_trade_outcome text,
  p_profit_loss numeric DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '3s'
AS $$
BEGIN
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

CREATE OR REPLACE FUNCTION complete_backtest_progress(
  p_backtest_id uuid,
  p_status text DEFAULT 'completed',
  p_error_message text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '3s'
AS $$
BEGIN
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

GRANT EXECUTE ON FUNCTION initialize_backtest_progress(uuid, uuid, text, integer) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION update_backtest_progress_with_trade(uuid, text, numeric) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION complete_backtest_progress(uuid, text, text) TO authenticated, anon, service_role;

-- =====================================================
-- 3. CREATE HELPER FUNCTION FOR BATCH UPDATES
-- =====================================================

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
-- 4. CREATE VIEW FOR MONITORING
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
  EXTRACT(EPOCH FROM (COALESCE(completed_at, now()) - started_at)) as duration_seconds,
  started_at as created_at,
  last_updated_at,
  completed_at
FROM backtest_progress_tracking
WHERE started_at > now() - interval '7 days'
ORDER BY started_at DESC;

GRANT SELECT ON backtest_progress_summary TO authenticated;

COMMENT ON VIEW backtest_progress_summary IS 'Summary view of backtest progress for monitoring dashboard';
