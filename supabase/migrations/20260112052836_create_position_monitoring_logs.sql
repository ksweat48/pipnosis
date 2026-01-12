/*
  # Position Monitoring Logs

  1. Purpose
    - Track all autonomous position monitoring checks
    - Log SL/TP/TP1/TP2 trigger detections
    - Record actions taken (closures executed)
    - Enable audit trail for autonomous monitoring

  2. New Tables
    - `position_monitoring_logs`
      - `id` (uuid, primary key)
      - `execution_id` (text) - Identifies monitoring run
      - `position_id` (uuid) - References goal_session_trades
      - `user_id` (uuid) - Position owner
      - `symbol` (text) - Currency pair/asset
      - `current_price` (numeric) - Price at check time
      - `price_age_seconds` (integer) - Age of price data
      - `sl_checked` (boolean) - Was SL checked
      - `sl_triggered` (boolean) - Did SL trigger
      - `tp_triggered` (boolean) - Did TP trigger
      - `tp1_triggered` (boolean) - Did TP1 trigger
      - `tp2_triggered` (boolean) - Did TP2 trigger
      - `action_taken` (boolean) - Was closure executed
      - `created_at` (timestamptz)

  3. Indexes
    - created_at (for time-series queries)
    - position_id (for per-position history)
    - execution_id (for run analysis)
    - triggers (for detecting hits)

  4. Security
    - Enable RLS
    - Users can read their own logs
    - Service role can insert
*/

-- Create monitoring logs table
CREATE TABLE IF NOT EXISTS position_monitoring_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id text NOT NULL,
  position_id uuid NOT NULL,
  user_id uuid NOT NULL,
  symbol text NOT NULL,
  current_price numeric,
  price_age_seconds integer,
  sl_checked boolean DEFAULT true,
  sl_triggered boolean DEFAULT false,
  tp_triggered boolean DEFAULT false,
  tp1_triggered boolean DEFAULT false,
  tp2_triggered boolean DEFAULT false,
  action_taken boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_position_monitoring_logs_created_at
  ON position_monitoring_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_position_monitoring_logs_position_id
  ON position_monitoring_logs (position_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_position_monitoring_logs_execution_id
  ON position_monitoring_logs (execution_id);

CREATE INDEX IF NOT EXISTS idx_position_monitoring_logs_triggers
  ON position_monitoring_logs (sl_triggered, tp_triggered, tp1_triggered, tp2_triggered)
  WHERE sl_triggered = true OR tp_triggered = true OR tp1_triggered = true OR tp2_triggered = true;

-- Enable RLS
ALTER TABLE position_monitoring_logs ENABLE ROW LEVEL SECURITY;

-- Users can read their own monitoring logs
CREATE POLICY "Users can read own monitoring logs"
  ON position_monitoring_logs
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Admins can read all monitoring logs
CREATE POLICY "Admins can read all monitoring logs"
  ON position_monitoring_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Service role can insert (autonomous monitor)
CREATE POLICY "Service role can insert monitoring logs"
  ON position_monitoring_logs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Create function to get monitoring summary
CREATE OR REPLACE FUNCTION get_position_monitoring_summary(
  minutes_back integer DEFAULT 60
)
RETURNS TABLE (
  symbol text,
  total_checks bigint,
  sl_triggers bigint,
  tp_triggers bigint,
  tp1_triggers bigint,
  tp2_triggers bigint,
  actions_taken bigint,
  avg_price_age_seconds numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    pml.symbol,
    COUNT(*) as total_checks,
    COUNT(*) FILTER (WHERE pml.sl_triggered = true) as sl_triggers,
    COUNT(*) FILTER (WHERE pml.tp_triggered = true) as tp_triggers,
    COUNT(*) FILTER (WHERE pml.tp1_triggered = true) as tp1_triggers,
    COUNT(*) FILTER (WHERE pml.tp2_triggered = true) as tp2_triggers,
    COUNT(*) FILTER (WHERE pml.action_taken = true) as actions_taken,
    ROUND(AVG(pml.price_age_seconds)) as avg_price_age_seconds
  FROM position_monitoring_logs pml
  WHERE pml.created_at > now() - (minutes_back || ' minutes')::interval
  GROUP BY pml.symbol
  ORDER BY total_checks DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_position_monitoring_summary TO authenticated;

-- Create cleanup function (keep last 30 days)
CREATE OR REPLACE FUNCTION cleanup_old_position_monitoring_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM position_monitoring_logs
  WHERE created_at < now() - interval '30 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION cleanup_old_position_monitoring_logs TO service_role;
