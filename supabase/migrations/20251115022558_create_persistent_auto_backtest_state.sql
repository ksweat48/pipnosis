/*
  # Persistent Auto-Backtest Global State System

  1. New Table
    - `auto_backtest_global_state`
      - Tracks auto-backtest running status per user globally across all devices
      - Stores current backtest number, total completed, and session metadata
      - Records which device/browser started the session for visibility
      - Includes timestamps for last activity and state freshness checks

  2. Features
    - Single source of truth for auto-backtest state across all browsers/devices
    - Automatic stale session detection based on last_heartbeat timestamp
    - Session metadata to show where auto-backtest is running
    - Conflict prevention: only one auto-backtest can run per user at a time

  3. Security
    - Enable RLS on table
    - Users can only access their own auto-backtest state
    - Authenticated users can create, read, update their state

  4. Usage Monitoring
    - Track resource usage warnings
    - Log critical level alerts
    - Monitor continuous runtime duration
*/

-- Drop existing table if it exists (clean slate)
DROP TABLE IF EXISTS auto_backtest_global_state CASCADE;

-- Create the persistent global state table
CREATE TABLE auto_backtest_global_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  
  -- Running state
  is_running boolean NOT NULL DEFAULT false,
  
  -- Progress tracking
  total_backtests_completed integer NOT NULL DEFAULT 0,
  current_backtest_number integer NOT NULL DEFAULT 0,
  
  -- Session metadata (which device/browser started it)
  session_id text,
  started_from_device text, -- e.g., "Chrome on MacOS", "Firefox on Windows"
  started_from_ip text,
  
  -- Last backtest result summary
  last_backtest_session_name text,
  last_backtest_win_rate numeric(5,2),
  last_backtest_total_trades integer,
  last_backtest_pnl numeric(10,2),
  last_backtest_completed_at timestamptz,
  
  -- Plateau detection state
  plateau_detected boolean NOT NULL DEFAULT false,
  breakthrough_mode boolean NOT NULL DEFAULT false,
  plateau_duration integer NOT NULL DEFAULT 0,
  
  -- Resource usage warnings
  usage_warning_level text DEFAULT 'normal', -- 'normal', 'elevated', 'critical'
  usage_warning_message text,
  last_usage_check_at timestamptz,
  
  -- Timestamps for state freshness
  started_at timestamptz,
  stopped_at timestamptz,
  last_heartbeat timestamptz DEFAULT now(), -- Updated every few seconds while running
  
  -- Audit timestamps
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX idx_auto_backtest_global_state_user ON auto_backtest_global_state(user_id);
CREATE INDEX idx_auto_backtest_global_state_running ON auto_backtest_global_state(user_id, is_running);
CREATE INDEX idx_auto_backtest_global_state_heartbeat ON auto_backtest_global_state(last_heartbeat DESC) WHERE is_running = true;

-- Enable Row Level Security
ALTER TABLE auto_backtest_global_state ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own auto-backtest state"
  ON auto_backtest_global_state FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own auto-backtest state"
  ON auto_backtest_global_state FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own auto-backtest state"
  ON auto_backtest_global_state FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own auto-backtest state"
  ON auto_backtest_global_state FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_auto_backtest_global_state_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS auto_backtest_global_state_updated_at ON auto_backtest_global_state;
CREATE TRIGGER auto_backtest_global_state_updated_at
  BEFORE UPDATE ON auto_backtest_global_state
  FOR EACH ROW
  EXECUTE FUNCTION update_auto_backtest_global_state_updated_at();

-- Function to detect stale sessions (no heartbeat in 5+ minutes)
CREATE OR REPLACE FUNCTION detect_stale_auto_backtest_sessions()
RETURNS TABLE(user_id uuid, session_id text, started_at timestamptz, last_heartbeat timestamptz, minutes_stale integer) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    abs.user_id,
    abs.session_id,
    abs.started_at,
    abs.last_heartbeat,
    EXTRACT(EPOCH FROM (now() - abs.last_heartbeat))::integer / 60 AS minutes_stale
  FROM auto_backtest_global_state abs
  WHERE abs.is_running = true
    AND abs.last_heartbeat < (now() - INTERVAL '5 minutes');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to force-stop stale sessions (cleanup utility)
CREATE OR REPLACE FUNCTION cleanup_stale_auto_backtest_sessions()
RETURNS integer AS $$
DECLARE
  affected_count integer;
BEGIN
  UPDATE auto_backtest_global_state
  SET 
    is_running = false,
    stopped_at = now(),
    updated_at = now()
  WHERE is_running = true
    AND last_heartbeat < (now() - INTERVAL '10 minutes');
  
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RETURN affected_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Initialize state for existing users
INSERT INTO auto_backtest_global_state (user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- Trigger to auto-create state for new users
CREATE OR REPLACE FUNCTION initialize_auto_backtest_global_state()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO auto_backtest_global_state (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_user_created_init_auto_backtest_state ON auth.users;
CREATE TRIGGER on_user_created_init_auto_backtest_state
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION initialize_auto_backtest_global_state();
