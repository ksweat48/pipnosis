/*
  # Comprehensive Backtest Progress Tracking System
  
  1. New Tables
    - `backtest_progress_tracking`
      - Tracks real-time progress of each active backtest
      - Records current phase, candles processed, trades executed
      - Monitors memory usage, CPU usage, and processing speed
      - Calculates estimated completion time
      
    - `backtest_execution_logs`
      - Detailed step-by-step execution logs for each backtest
      - Records timing, performance metrics, and error details
      - Enables debugging and performance analysis
      
  2. Functions
    - `update_backtest_progress` - Updates progress for active backtests
    - `log_backtest_step` - Logs individual execution steps
    - `get_active_backtests` - Retrieves all currently running backtests
    - `detect_stuck_backtests` - Identifies hung/stuck backtest processes
    - `cleanup_old_progress_data` - Archives completed progress after 48 hours
    
  3. Indexes
    - Optimized indexes for fast real-time queries
    - Indexes on user_id, backtest_id, phase, and timestamps
    
  4. Security
    - Enable RLS on all tables
    - Users can only access their own backtest progress
*/

-- Backtest Progress Tracking Table
CREATE TABLE IF NOT EXISTS backtest_progress_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backtest_id uuid NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  session_id uuid,
  
  -- Progress Metrics
  current_step text NOT NULL,
  total_steps integer DEFAULT 5 NOT NULL,
  progress_percentage integer DEFAULT 0 NOT NULL,
  current_candle integer DEFAULT 0,
  total_candles integer DEFAULT 0,
  candles_per_second numeric(10,2) DEFAULT 0,
  
  -- Phase Tracking
  phase text NOT NULL DEFAULT 'initializing', -- 'initializing', 'loading', 'processing', 'analyzing', 'completing', 'completed', 'failed'
  phase_start_time timestamptz DEFAULT now(),
  
  -- Trade Metrics (updated in real-time)
  trades_executed integer DEFAULT 0,
  winning_trades integer DEFAULT 0,
  losing_trades integer DEFAULT 0,
  current_win_rate numeric(5,2) DEFAULT 0,
  current_profit_loss numeric(10,2) DEFAULT 0,
  
  -- Performance Metrics
  memory_usage_mb integer DEFAULT 0,
  cpu_usage_percent numeric(5,2) DEFAULT 0,
  db_query_count integer DEFAULT 0,
  db_avg_response_ms numeric(10,2) DEFAULT 0,
  
  -- Timing
  estimated_completion_time timestamptz,
  started_at timestamptz DEFAULT now() NOT NULL,
  last_updated_at timestamptz DEFAULT now() NOT NULL,
  completed_at timestamptz,
  
  -- Status
  status text DEFAULT 'running' NOT NULL, -- 'running', 'completed', 'failed', 'stuck'
  error_message text,
  
  UNIQUE(backtest_id)
);

CREATE INDEX IF NOT EXISTS idx_progress_user ON backtest_progress_tracking(user_id);
CREATE INDEX IF NOT EXISTS idx_progress_backtest ON backtest_progress_tracking(backtest_id);
CREATE INDEX IF NOT EXISTS idx_progress_phase ON backtest_progress_tracking(phase);
CREATE INDEX IF NOT EXISTS idx_progress_status ON backtest_progress_tracking(status);
CREATE INDEX IF NOT EXISTS idx_progress_updated ON backtest_progress_tracking(last_updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_progress_active ON backtest_progress_tracking(user_id, status) WHERE status = 'running';

ALTER TABLE backtest_progress_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own backtest progress"
  ON backtest_progress_tracking FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own backtest progress"
  ON backtest_progress_tracking FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own backtest progress"
  ON backtest_progress_tracking FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own backtest progress"
  ON backtest_progress_tracking FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- Backtest Execution Logs Table
CREATE TABLE IF NOT EXISTS backtest_execution_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backtest_id uuid NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  -- Step Details
  step_name text NOT NULL,
  step_type text NOT NULL, -- 'phase_start', 'phase_end', 'checkpoint', 'trade', 'error', 'warning', 'info'
  step_number integer,
  
  -- Timing
  timestamp timestamptz DEFAULT now() NOT NULL,
  duration_ms integer,
  
  -- Status
  status text NOT NULL, -- 'started', 'completed', 'failed', 'warning'
  message text,
  error_details text,
  
  -- Performance Snapshot
  memory_snapshot_mb integer,
  cpu_snapshot_percent numeric(5,2),
  
  -- Additional Metadata
  performance_metrics jsonb DEFAULT '{}'::jsonb,
  context_data jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_exec_logs_backtest ON backtest_execution_logs(backtest_id);
CREATE INDEX IF NOT EXISTS idx_exec_logs_user ON backtest_execution_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_exec_logs_timestamp ON backtest_execution_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_exec_logs_status ON backtest_execution_logs(status);
CREATE INDEX IF NOT EXISTS idx_exec_logs_type ON backtest_execution_logs(step_type);

ALTER TABLE backtest_execution_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own execution logs"
  ON backtest_execution_logs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own execution logs"
  ON backtest_execution_logs FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());


-- Function: Update Backtest Progress
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
  v_time_elapsed interval;
  v_estimated_completion timestamptz;
  v_current_win_rate numeric;
BEGIN
  -- Calculate processing speed and estimated completion
  SELECT 
    EXTRACT(EPOCH FROM (now() - started_at)) INTO v_time_elapsed
  FROM backtest_progress_tracking
  WHERE backtest_id = p_backtest_id;
  
  IF v_time_elapsed > 0 AND p_current_candle > 0 THEN
    v_candles_per_second := p_current_candle / EXTRACT(EPOCH FROM v_time_elapsed);
    
    IF p_total_candles > 0 AND v_candles_per_second > 0 THEN
      v_estimated_completion := now() + ((p_total_candles - p_current_candle) / v_candles_per_second) * interval '1 second';
    END IF;
  END IF;
  
  -- Calculate current win rate
  IF p_trades_executed > 0 THEN
    v_current_win_rate := (p_winning_trades::numeric / p_trades_executed::numeric) * 100;
  ELSE
    v_current_win_rate := 0;
  END IF;
  
  -- Insert or update progress
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
    phase_start_time = CASE WHEN p_phase IS NOT NULL AND p_phase != backtest_progress_tracking.phase THEN now() ELSE backtest_progress_tracking.phase_start_time END,
    trades_executed = COALESCE(p_trades_executed, backtest_progress_tracking.trades_executed),
    winning_trades = COALESCE(p_winning_trades, backtest_progress_tracking.winning_trades),
    losing_trades = COALESCE(p_losing_trades, backtest_progress_tracking.losing_trades),
    current_win_rate = v_current_win_rate,
    memory_usage_mb = COALESCE(p_memory_usage_mb, backtest_progress_tracking.memory_usage_mb),
    cpu_usage_percent = COALESCE(p_cpu_usage_percent, backtest_progress_tracking.cpu_usage_percent),
    db_query_count = COALESCE(p_db_query_count, backtest_progress_tracking.db_query_count),
    estimated_completion_time = v_estimated_completion,
    status = p_status,
    last_updated_at = now(),
    completed_at = CASE WHEN p_status IN ('completed', 'failed') THEN now() ELSE backtest_progress_tracking.completed_at END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Function: Log Backtest Step
CREATE OR REPLACE FUNCTION log_backtest_step(
  p_backtest_id uuid,
  p_user_id uuid,
  p_step_name text,
  p_step_type text DEFAULT 'info',
  p_status text DEFAULT 'completed',
  p_message text DEFAULT NULL,
  p_duration_ms integer DEFAULT NULL,
  p_memory_mb integer DEFAULT NULL,
  p_cpu_percent numeric DEFAULT NULL,
  p_context_data jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid AS $$
DECLARE
  v_log_id uuid;
BEGIN
  INSERT INTO backtest_execution_logs (
    backtest_id,
    user_id,
    step_name,
    step_type,
    status,
    message,
    duration_ms,
    memory_snapshot_mb,
    cpu_snapshot_percent,
    context_data
  ) VALUES (
    p_backtest_id,
    p_user_id,
    p_step_name,
    p_step_type,
    p_status,
    p_message,
    p_duration_ms,
    p_memory_mb,
    p_cpu_percent,
    p_context_data
  )
  RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Function: Get Active Backtests
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
  current_win_rate numeric,
  memory_usage_mb integer,
  cpu_usage_percent numeric,
  estimated_completion_time timestamptz,
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
    bpt.current_win_rate,
    bpt.memory_usage_mb,
    bpt.cpu_usage_percent,
    bpt.estimated_completion_time,
    EXTRACT(EPOCH FROM (now() - bpt.started_at))::integer,
    bpt.status
  FROM backtest_progress_tracking bpt
  WHERE bpt.user_id = p_user_id
    AND bpt.status = 'running'
    AND bpt.started_at > now() - interval '1 hour'
  ORDER BY bpt.started_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Function: Detect Stuck Backtests
CREATE OR REPLACE FUNCTION detect_stuck_backtests()
RETURNS void AS $$
BEGIN
  UPDATE backtest_progress_tracking
  SET 
    status = 'stuck',
    error_message = 'No progress update received for over 90 seconds'
  WHERE 
    status = 'running'
    AND last_updated_at < now() - interval '90 seconds';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Function: Cleanup Old Progress Data
CREATE OR REPLACE FUNCTION cleanup_old_progress_data()
RETURNS integer AS $$
DECLARE
  v_deleted_count integer;
BEGIN
  -- Delete progress tracking older than 48 hours
  DELETE FROM backtest_progress_tracking
  WHERE 
    status IN ('completed', 'failed')
    AND completed_at < now() - interval '48 hours';
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  -- Delete execution logs older than 7 days
  DELETE FROM backtest_execution_logs
  WHERE timestamp < now() - interval '7 days';
  
  RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Create cleanup job to run daily
DO $$
BEGIN
  -- Check if pg_cron extension is available
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Schedule daily cleanup at 3 AM
    PERFORM cron.schedule(
      'cleanup-backtest-progress-data',
      '0 3 * * *',
      'SELECT cleanup_old_progress_data();'
    );
  END IF;
END $$;
