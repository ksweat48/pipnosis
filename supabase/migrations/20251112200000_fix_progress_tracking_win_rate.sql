/*
  # Fix Auto-Backtest Progress Tracking for Win Rates

  1. Schema Changes
    - Add `winning_trades` column to track successful trades in real-time
    - Add `losing_trades` column to track unsuccessful trades in real-time
    - These columns enable accurate win rate calculation during execution
    - Update `current_win_rate` to be automatically calculated from winning/losing trades

  2. Functions
    - Create `update_backtest_progress_with_trade` - Updates progress when a trade completes
    - Create `initialize_backtest_progress` - Creates initial progress record
    - Update `get_active_backtests` to return winning/losing trade counts

  3. Performance
    - Add indexes for faster win rate queries
    - Optimize progress update operations
*/

-- Add winning_trades and losing_trades columns
DO $$
BEGIN
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

-- Create index for faster win rate calculations
CREATE INDEX IF NOT EXISTS idx_backtest_progress_win_rate
  ON backtest_progress_tracking(current_win_rate DESC)
  WHERE status = 'running';

-- Function: Initialize Backtest Progress
CREATE OR REPLACE FUNCTION initialize_backtest_progress(
  p_backtest_id uuid,
  p_user_id uuid,
  p_session_name text,
  p_total_candles integer DEFAULT 1000
)
RETURNS uuid AS $$
DECLARE
  v_progress_id uuid;
BEGIN
  INSERT INTO backtest_progress_tracking (
    backtest_id,
    user_id,
    session_name,
    current_step,
    phase,
    progress_percentage,
    total_candles,
    current_candle,
    trades_executed,
    winning_trades,
    losing_trades,
    current_win_rate,
    current_profit_loss,
    candles_per_second,
    memory_usage_mb,
    cpu_usage_percent,
    status,
    started_at,
    last_updated_at
  ) VALUES (
    p_backtest_id,
    p_user_id,
    p_session_name,
    'Initializing',
    'setup',
    0,
    p_total_candles,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    'running',
    now(),
    now()
  )
  RETURNING id INTO v_progress_id;

  RETURN v_progress_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Update Backtest Progress with Trade Result
CREATE OR REPLACE FUNCTION update_backtest_progress_with_trade(
  p_backtest_id uuid,
  p_trade_outcome text, -- 'win', 'loss', or 'breakeven'
  p_profit_loss numeric DEFAULT 0
)
RETURNS void AS $$
DECLARE
  v_trades_executed integer;
  v_winning_trades integer;
  v_losing_trades integer;
  v_current_pnl numeric;
  v_win_rate numeric;
BEGIN
  -- Update trade counts and calculate win rate
  UPDATE backtest_progress_tracking
  SET
    trades_executed = trades_executed + 1,
    winning_trades = CASE
      WHEN p_trade_outcome = 'win' THEN winning_trades + 1
      ELSE winning_trades
    END,
    losing_trades = CASE
      WHEN p_trade_outcome = 'loss' THEN losing_trades + 1
      ELSE losing_trades
    END,
    current_profit_loss = current_profit_loss + p_profit_loss,
    current_win_rate = CASE
      WHEN (trades_executed + 1) > 0 THEN
        ROUND(
          (CASE WHEN p_trade_outcome = 'win' THEN winning_trades + 1 ELSE winning_trades END::numeric /
          (trades_executed + 1)::numeric) * 100,
          2
        )
      ELSE 0
    END,
    last_updated_at = now()
  WHERE backtest_id = p_backtest_id
    AND status = 'running';

  IF NOT FOUND THEN
    RAISE WARNING 'Backtest progress not found or not running: %', p_backtest_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Update Backtest Progress (General)
CREATE OR REPLACE FUNCTION update_backtest_progress(
  p_backtest_id uuid,
  p_current_step text DEFAULT NULL,
  p_phase text DEFAULT NULL,
  p_progress_percentage integer DEFAULT NULL,
  p_current_candle integer DEFAULT NULL,
  p_candles_per_second numeric DEFAULT NULL,
  p_memory_usage_mb integer DEFAULT NULL,
  p_cpu_usage_percent numeric DEFAULT NULL,
  p_estimated_completion_time timestamptz DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  UPDATE backtest_progress_tracking
  SET
    current_step = COALESCE(p_current_step, current_step),
    phase = COALESCE(p_phase, phase),
    progress_percentage = COALESCE(p_progress_percentage, progress_percentage),
    current_candle = COALESCE(p_current_candle, current_candle),
    candles_per_second = COALESCE(p_candles_per_second, candles_per_second),
    memory_usage_mb = COALESCE(p_memory_usage_mb, memory_usage_mb),
    cpu_usage_percent = COALESCE(p_cpu_usage_percent, cpu_usage_percent),
    estimated_completion_time = COALESCE(p_estimated_completion_time, estimated_completion_time),
    last_updated_at = now()
  WHERE backtest_id = p_backtest_id
    AND status = 'running';

  IF NOT FOUND THEN
    RAISE WARNING 'Backtest progress not found or not running: %', p_backtest_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Complete Backtest Progress
CREATE OR REPLACE FUNCTION complete_backtest_progress(
  p_backtest_id uuid,
  p_status text DEFAULT 'completed',
  p_error_message text DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  UPDATE backtest_progress_tracking
  SET
    status = p_status,
    progress_percentage = CASE WHEN p_status = 'completed' THEN 100 ELSE progress_percentage END,
    completed_at = now(),
    error_message = p_error_message,
    last_updated_at = now()
  WHERE backtest_id = p_backtest_id
    AND status = 'running';

  IF NOT FOUND THEN
    RAISE WARNING 'Backtest progress not found or not running: %', p_backtest_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update get_active_backtests to include winning/losing trades
CREATE OR REPLACE FUNCTION get_active_backtests(p_user_id uuid)
RETURNS TABLE (
  backtest_id uuid,
  current_step text,
  progress_percentage integer,
  phase text,
  candles_processed integer,
  total_candles integer,
  candles_per_second numeric,
  trades_executed integer,
  winning_trades integer,
  losing_trades integer,
  current_win_rate numeric,
  memory_usage_mb integer,
  cpu_usage_percent numeric,
  estimated_completion_time timestamptz,
  started_at timestamptz,
  last_updated_at timestamptz,
  time_elapsed_seconds integer,
  status text
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    bpt.backtest_id,
    bpt.current_step,
    bpt.progress_percentage,
    bpt.phase,
    bpt.current_candle,
    bpt.total_candles,
    bpt.candles_per_second,
    bpt.trades_executed,
    bpt.winning_trades,
    bpt.losing_trades,
    bpt.current_win_rate,
    bpt.memory_usage_mb,
    bpt.cpu_usage_percent,
    bpt.estimated_completion_time,
    bpt.started_at,
    bpt.last_updated_at,
    EXTRACT(EPOCH FROM (now() - bpt.started_at))::integer,
    bpt.status
  FROM backtest_progress_tracking bpt
  WHERE bpt.user_id = p_user_id
    AND bpt.status = 'running'
    AND bpt.started_at > now() - interval '1 hour'
  ORDER BY bpt.started_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION initialize_backtest_progress TO authenticated;
GRANT EXECUTE ON FUNCTION update_backtest_progress_with_trade TO authenticated;
GRANT EXECUTE ON FUNCTION update_backtest_progress TO authenticated;
GRANT EXECUTE ON FUNCTION complete_backtest_progress TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_backtests TO authenticated;
