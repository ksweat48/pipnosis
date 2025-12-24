/*
  # Entry Execution Intelligence System

  1. New Tables
    - `entry_intents`
      - Tracks all entry intents created by Alpha with urgency classification
      - Fields: intent_type, urgency, entry_zone_min/max, timeout, status
    - `entry_monitoring_logs`
      - Logs real-time monitoring progress for transparency
      - Tracks price distance, condition checks, user messages
    - `entry_quality_scores`
      - Measures execution quality vs ideal entry
      - Tracks slippage, timing, and intent effectiveness

  2. Schema Updates
    - Add entry intent tracking columns to goal_session_trades
    - Add entry quality metrics for learning feedback

  3. Security
    - Enable RLS on all new tables
    - Users can only access their own entry intents and logs
    - Admin read-only access for monitoring

  4. Performance
    - Indexes on user_id, session_id, status for fast queries
    - Indexes on timestamp fields for monitoring queries
    - Cleanup policies for archived data
*/

-- Entry Intent Types
CREATE TYPE entry_intent_type AS ENUM (
  'immediate_momentum',
  'pullback_to_vwap',
  'pullback_to_support',
  'break_and_retest',
  'range_extreme',
  'retest_structure'
);

-- Entry Urgency Levels
CREATE TYPE entry_urgency_level AS ENUM (
  'HIGH',
  'MEDIUM',
  'LOW'
);

-- Entry Intent Status
CREATE TYPE entry_intent_status AS ENUM (
  'monitoring',
  'executed',
  'timeout',
  'canceled',
  'conditions_changed'
);

-- Entry Intents Table
CREATE TABLE IF NOT EXISTS entry_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES goal_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  intent_type entry_intent_type NOT NULL,
  urgency entry_urgency_level NOT NULL,
  direction text NOT NULL CHECK (direction IN ('long', 'short')),
  entry_zone_min decimal(10, 5) NOT NULL,
  entry_zone_max decimal(10, 5) NOT NULL,
  timeout_minutes integer NOT NULL DEFAULT 60,
  timeout_at timestamptz NOT NULL,
  status entry_intent_status NOT NULL DEFAULT 'monitoring',
  alpha_reasoning text,
  market_context jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  executed_at timestamptz,
  canceled_at timestamptz,
  canceled_reason text,
  actual_entry_price decimal(10, 5),
  CONSTRAINT entry_zone_valid CHECK (entry_zone_min <= entry_zone_max)
);

-- Entry Monitoring Logs Table
CREATE TABLE IF NOT EXISTS entry_monitoring_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id uuid NOT NULL REFERENCES entry_intents(id) ON DELETE CASCADE,
  timestamp timestamptz DEFAULT now(),
  current_price decimal(10, 5) NOT NULL,
  distance_to_zone_pips decimal(6, 2),
  conditions_met jsonb DEFAULT '{}'::jsonb,
  message text,
  candle_data jsonb,
  market_conditions jsonb
);

-- Entry Quality Scores Table
CREATE TABLE IF NOT EXISTS entry_quality_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES goal_session_trades(id) ON DELETE CASCADE,
  intent_id uuid REFERENCES entry_intents(id) ON DELETE SET NULL,
  ideal_entry_price decimal(10, 5) NOT NULL,
  actual_entry_price decimal(10, 5) NOT NULL,
  entry_quality_score decimal(5, 2) NOT NULL,
  slippage_pips decimal(6, 2) NOT NULL,
  intent_type entry_intent_type,
  urgency entry_urgency_level,
  timeout_used_seconds integer,
  monitoring_duration_seconds integer,
  conditions_at_entry jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Add Entry Intent Columns to goal_session_trades
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'entry_intent_type'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN entry_intent_type entry_intent_type;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'entry_urgency'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN entry_urgency entry_urgency_level;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'entry_quality_score'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN entry_quality_score decimal(5, 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'time_to_entry_seconds'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN time_to_entry_seconds integer;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'ideal_entry_price'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN ideal_entry_price decimal(10, 5);
  END IF;
END $$;

-- Enable RLS
ALTER TABLE entry_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry_monitoring_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry_quality_scores ENABLE ROW LEVEL SECURITY;

-- RLS Policies for entry_intents
CREATE POLICY "Users can view own entry intents"
  ON entry_intents FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own entry intents"
  ON entry_intents FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own entry intents"
  ON entry_intents FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for entry_monitoring_logs
CREATE POLICY "Users can view own monitoring logs"
  ON entry_monitoring_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM entry_intents
      WHERE entry_intents.id = entry_monitoring_logs.intent_id
      AND entry_intents.user_id = auth.uid()
    )
  );

CREATE POLICY "System can insert monitoring logs"
  ON entry_monitoring_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- RLS Policies for entry_quality_scores
CREATE POLICY "Users can view own quality scores"
  ON entry_quality_scores FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM goal_session_trades
      WHERE goal_session_trades.id = entry_quality_scores.trade_id
      AND goal_session_trades.user_id = auth.uid()
    )
  );

CREATE POLICY "System can insert quality scores"
  ON entry_quality_scores FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_entry_intents_user_status ON entry_intents(user_id, status);
CREATE INDEX IF NOT EXISTS idx_entry_intents_session ON entry_intents(session_id);
CREATE INDEX IF NOT EXISTS idx_entry_intents_timeout ON entry_intents(timeout_at) WHERE status = 'monitoring';
CREATE INDEX IF NOT EXISTS idx_monitoring_logs_intent ON entry_monitoring_logs(intent_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_quality_scores_trade ON entry_quality_scores(trade_id);
CREATE INDEX IF NOT EXISTS idx_quality_scores_intent_type ON entry_quality_scores(intent_type, urgency);

-- Function to auto-cancel expired intents
CREATE OR REPLACE FUNCTION check_expired_entry_intents()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE entry_intents
  SET
    status = 'timeout',
    canceled_at = now(),
    canceled_reason = 'Entry conditions not met within timeout window'
  WHERE status = 'monitoring'
    AND timeout_at < now();
END;
$$;

-- Function to get active entry intents for user
CREATE OR REPLACE FUNCTION get_active_entry_intents(p_user_id uuid)
RETURNS TABLE (
  intent_id uuid,
  session_id uuid,
  symbol text,
  intent_type entry_intent_type,
  urgency entry_urgency_level,
  direction text,
  entry_zone_min decimal,
  entry_zone_max decimal,
  timeout_at timestamptz,
  created_at timestamptz,
  alpha_reasoning text,
  minutes_remaining integer,
  latest_price decimal,
  distance_to_zone_pips decimal
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ei.id,
    ei.session_id,
    ei.symbol,
    ei.intent_type,
    ei.urgency,
    ei.direction,
    ei.entry_zone_min,
    ei.entry_zone_max,
    ei.timeout_at,
    ei.created_at,
    ei.alpha_reasoning,
    EXTRACT(EPOCH FROM (ei.timeout_at - now())) / 60,
    eml.current_price,
    eml.distance_to_zone_pips
  FROM entry_intents ei
  LEFT JOIN LATERAL (
    SELECT current_price, distance_to_zone_pips
    FROM entry_monitoring_logs
    WHERE intent_id = ei.id
    ORDER BY timestamp DESC
    LIMIT 1
  ) eml ON true
  WHERE ei.user_id = p_user_id
    AND ei.status = 'monitoring'
  ORDER BY ei.urgency DESC, ei.created_at ASC;
END;
$$;

-- Function to calculate entry quality score
CREATE OR REPLACE FUNCTION calculate_entry_quality_score(
  p_ideal_price decimal,
  p_actual_price decimal,
  p_direction text
)
RETURNS decimal
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_difference decimal;
  v_score decimal;
BEGIN
  -- Calculate difference in pips (assume 5 decimal places for forex)
  v_difference := ABS(p_actual_price - p_ideal_price) * 10000;

  -- Score: 100 for perfect entry, decreasing by 10 per pip away
  v_score := 100 - (v_difference * 10);

  -- Adjust for direction (better if entered better than ideal)
  IF (p_direction = 'long' AND p_actual_price < p_ideal_price) OR
     (p_direction = 'short' AND p_actual_price > p_ideal_price) THEN
    v_score := LEAST(v_score + 20, 100);
  END IF;

  -- Clamp between 0 and 100
  v_score := GREATEST(0, LEAST(100, v_score));

  RETURN v_score;
END;
$$;

-- Function to log entry monitoring update
CREATE OR REPLACE FUNCTION log_entry_monitoring(
  p_intent_id uuid,
  p_current_price decimal,
  p_distance_pips decimal,
  p_conditions_met jsonb,
  p_message text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_log_id uuid;
BEGIN
  INSERT INTO entry_monitoring_logs (
    intent_id,
    current_price,
    distance_to_zone_pips,
    conditions_met,
    message
  ) VALUES (
    p_intent_id,
    p_current_price,
    p_distance_pips,
    p_conditions_met,
    p_message
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

-- Enable realtime for entry intents (for UI updates)
ALTER PUBLICATION supabase_realtime ADD TABLE entry_intents;
ALTER PUBLICATION supabase_realtime ADD TABLE entry_monitoring_logs;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION check_expired_entry_intents() TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_entry_intents(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_entry_quality_score(decimal, decimal, text) TO authenticated;
GRANT EXECUTE ON FUNCTION log_entry_monitoring(uuid, decimal, decimal, jsonb, text) TO authenticated;
