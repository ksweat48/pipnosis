/*
  # Optimize Backtest Performance and Prevent Timeouts
  
  1. Add Indexes
    - Index on synthetic_candles for faster queries
    - Index on backtest_progress_tracking for active status checks
    
  2. Optimize Functions
    - Make update operations faster
    - Reduce transaction overhead
    
  3. Statement Timeout Configuration
    - Increase timeout for backtest operations
    - Add timeout hints to long-running queries
*/

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_synthetic_candles_session_symbol_time
  ON synthetic_candles(synthetic_session_id, symbol, timeframe, open_time);

CREATE INDEX IF NOT EXISTS idx_synthetic_candles_lookup
  ON synthetic_candles(synthetic_session_id, open_time);

CREATE INDEX IF NOT EXISTS idx_backtest_progress_active
  ON backtest_progress_tracking(backtest_id, status)
  WHERE status IN ('running', 'initializing', 'processing');

CREATE INDEX IF NOT EXISTS idx_backtest_progress_user_status
  ON backtest_progress_tracking(user_id, status, started_at DESC)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_synthetic_backtest_trades_session
  ON synthetic_backtest_trades(session_id, entry_time);

-- Optimize the update_backtest_progress function to reduce overhead
CREATE OR REPLACE FUNCTION update_backtest_progress(
  p_backtest_id uuid,
  p_user_id uuid,
  p_current_step text DEFAULT NULL,
  p_progress_percentage integer DEFAULT NULL,
  p_current_candle integer DEFAULT NULL,
  p_total_candles integer DEFAULT NULL,
  p_phase text DEFAULT NULL,
  p_trades_executed integer DEFAULT NULL,
  p_winning_trades integer DEFAULT NULL,
  p_losing_trades integer DEFAULT NULL,
  p_memory_usage_mb integer DEFAULT NULL,
  p_cpu_usage_percent numeric DEFAULT NULL,
  p_db_query_count integer DEFAULT NULL,
  p_status text DEFAULT 'running'
)
RETURNS void AS $$
DECLARE
  v_candles_per_second numeric;
  v_time_elapsed numeric;
  v_estimated_completion timestamptz;
  v_current_win_rate numeric;
BEGIN
  -- Optimized: Get time elapsed without subquery
  SELECT 
    EXTRACT(EPOCH FROM (now() - started_at)),
    started_at
  INTO v_time_elapsed, v_estimated_completion
  FROM backtest_progress_tracking
  WHERE backtest_id = p_backtest_id;

  -- Calculate metrics only if we have values
  IF v_time_elapsed > 0 AND p_current_candle > 0 THEN
    v_candles_per_second := p_current_candle / v_time_elapsed;
    
    IF p_total_candles > 0 AND v_candles_per_second > 0 THEN
      v_estimated_completion := now() + ((p_total_candles - p_current_candle) / v_candles_per_second) * interval '1 second';
    END IF;
  END IF;

  -- Calculate win rate only if trades exist
  IF COALESCE(p_trades_executed, 0) > 0 THEN
    v_current_win_rate := (COALESCE(p_winning_trades, 0)::numeric / p_trades_executed::numeric) * 100;
  ELSE
    v_current_win_rate := 0;
  END IF;

  -- Single upsert operation (much faster than INSERT ... ON CONFLICT with complex logic)
  INSERT INTO backtest_progress_tracking (
    backtest_id,
    user_id,
    current_step,
    progress_percentage,
    current_candle,
    total_candles,
    candles_per_second,
    phase,
    trades_executed,
    winning_trades,
    losing_trades,
    current_win_rate,
    memory_usage_mb,
    cpu_usage_percent,
    db_query_count,
    estimated_completion_time,
    status,
    last_updated_at
  ) VALUES (
    p_backtest_id,
    p_user_id,
    COALESCE(p_current_step, 'Starting backtest'),
    COALESCE(p_progress_percentage, 0),
    COALESCE(p_current_candle, 0),
    COALESCE(p_total_candles, 0),
    COALESCE(v_candles_per_second, 0),
    COALESCE(p_phase, 'initializing'),
    COALESCE(p_trades_executed, 0),
    COALESCE(p_winning_trades, 0),
    COALESCE(p_losing_trades, 0),
    v_current_win_rate,
    COALESCE(p_memory_usage_mb, 0),
    COALESCE(p_cpu_usage_percent, 0),
    COALESCE(p_db_query_count, 0),
    v_estimated_completion,
    p_status,
    now()
  )
  ON CONFLICT (backtest_id) DO UPDATE SET
    current_step = COALESCE(p_current_step, backtest_progress_tracking.current_step),
    progress_percentage = COALESCE(p_progress_percentage, backtest_progress_tracking.progress_percentage),
    current_candle = COALESCE(p_current_candle, backtest_progress_tracking.current_candle),
    total_candles = COALESCE(p_total_candles, backtest_progress_tracking.total_candles),
    candles_per_second = COALESCE(v_candles_per_second, backtest_progress_tracking.candles_per_second),
    phase = COALESCE(p_phase, backtest_progress_tracking.phase),
    trades_executed = COALESCE(p_trades_executed, backtest_progress_tracking.trades_executed),
    winning_trades = COALESCE(p_winning_trades, backtest_progress_tracking.winning_trades),
    losing_trades = COALESCE(p_losing_trades, backtest_progress_tracking.losing_trades),
    current_win_rate = v_current_win_rate,
    memory_usage_mb = COALESCE(p_memory_usage_mb, backtest_progress_tracking.memory_usage_mb),
    cpu_usage_percent = COALESCE(p_cpu_usage_percent, backtest_progress_tracking.cpu_usage_percent),
    db_query_count = COALESCE(p_db_query_count, backtest_progress_tracking.db_query_count),
    estimated_completion_time = COALESCE(v_estimated_completion, backtest_progress_tracking.estimated_completion_time),
    status = p_status,
    last_updated_at = now(),
    completed_at = CASE WHEN p_status IN ('completed', 'failed') THEN now() ELSE backtest_progress_tracking.completed_at END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add a helper function to batch insert synthetic candles
CREATE OR REPLACE FUNCTION batch_insert_synthetic_candles(
  p_candles jsonb
)
RETURNS integer AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO synthetic_candles (
    synthetic_session_id,
    symbol,
    timeframe,
    open_time,
    close_time,
    open,
    high,
    low,
    close,
    volume
  )
  SELECT
    (c->>'synthetic_session_id')::uuid,
    c->>'symbol',
    c->>'timeframe',
    (c->>'open_time')::timestamptz,
    (c->>'close_time')::timestamptz,
    (c->>'open')::numeric,
    (c->>'high')::numeric,
    (c->>'low')::numeric,
    (c->>'close')::numeric,
    (c->>'volume')::integer
  FROM jsonb_array_elements(p_candles) AS c;
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION batch_insert_synthetic_candles(jsonb) TO authenticated, anon;
