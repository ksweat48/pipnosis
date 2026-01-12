/*
  # Wellness Check Logs

  1. Purpose
    - Track periodic wellness checks on open positions
    - Log drawdown levels and trigger thresholds
    - Record analysis triggers and actions taken
    - Enable trend analysis of position health

  2. New Tables
    - `wellness_check_logs`
      - `id` (uuid, primary key)
      - `execution_id` (text) - Identifies wellness run
      - `position_id` (uuid) - References goal_session_trades
      - `symbol` (text) - Currency pair/asset
      - `drawdown_percent` (numeric) - Current drawdown (0-100)
      - `current_pnl` (numeric) - P&L at check time
      - `minutes_in_trade` (integer) - Duration of trade
      - `trigger_level` (text) - none/soft/hard/emergency
      - `analysis_triggered` (boolean) - Was Alpha/Omega analysis triggered
      - `action_taken` (boolean) - Was any action taken
      - `created_at` (timestamptz)

  3. Indexes
    - created_at (for time-series queries)
    - position_id (for per-position history)
    - trigger_level (for alert analysis)

  4. Security
    - Enable RLS
    - Users can read their own logs
    - Service role can insert
*/

-- Create wellness logs table
CREATE TABLE IF NOT EXISTS wellness_check_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id text NOT NULL,
  position_id uuid NOT NULL,
  symbol text NOT NULL,
  drawdown_percent numeric NOT NULL DEFAULT 0,
  current_pnl numeric NOT NULL DEFAULT 0,
  minutes_in_trade integer NOT NULL DEFAULT 0,
  trigger_level text NOT NULL DEFAULT 'none',
  analysis_triggered boolean DEFAULT false,
  action_taken boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_wellness_check_logs_created_at
  ON wellness_check_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wellness_check_logs_position_id
  ON wellness_check_logs (position_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wellness_check_logs_trigger_level
  ON wellness_check_logs (trigger_level)
  WHERE trigger_level != 'none';

CREATE INDEX IF NOT EXISTS idx_wellness_check_logs_execution_id
  ON wellness_check_logs (execution_id);

-- Enable RLS
ALTER TABLE wellness_check_logs ENABLE ROW LEVEL SECURITY;

-- Users can read their own wellness logs (join through positions)
CREATE POLICY "Users can read own wellness logs"
  ON wellness_check_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM goal_session_trades
      WHERE goal_session_trades.id = wellness_check_logs.position_id
      AND goal_session_trades.user_id = auth.uid()
    )
  );

-- Admins can read all wellness logs
CREATE POLICY "Admins can read all wellness logs"
  ON wellness_check_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Service role can insert (wellness monitor)
CREATE POLICY "Service role can insert wellness logs"
  ON wellness_check_logs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Create function to get wellness summary
CREATE OR REPLACE FUNCTION get_wellness_check_summary(
  minutes_back integer DEFAULT 60
)
RETURNS TABLE (
  symbol text,
  total_checks bigint,
  avg_drawdown numeric,
  max_drawdown numeric,
  soft_triggers bigint,
  hard_triggers bigint,
  emergency_triggers bigint,
  actions_taken bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    wcl.symbol,
    COUNT(*) as total_checks,
    ROUND(AVG(wcl.drawdown_percent), 2) as avg_drawdown,
    ROUND(MAX(wcl.drawdown_percent), 2) as max_drawdown,
    COUNT(*) FILTER (WHERE wcl.trigger_level = 'soft') as soft_triggers,
    COUNT(*) FILTER (WHERE wcl.trigger_level = 'hard') as hard_triggers,
    COUNT(*) FILTER (WHERE wcl.trigger_level = 'emergency') as emergency_triggers,
    COUNT(*) FILTER (WHERE wcl.action_taken = true) as actions_taken
  FROM wellness_check_logs wcl
  WHERE wcl.created_at > now() - (minutes_back || ' minutes')::interval
  GROUP BY wcl.symbol
  ORDER BY emergency_triggers DESC, hard_triggers DESC, avg_drawdown DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_wellness_check_summary TO authenticated;

-- Create cleanup function (keep last 30 days)
CREATE OR REPLACE FUNCTION cleanup_old_wellness_check_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM wellness_check_logs
  WHERE created_at < now() - interval '30 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION cleanup_old_wellness_check_logs TO service_role;
