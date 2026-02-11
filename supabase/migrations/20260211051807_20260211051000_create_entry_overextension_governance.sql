/*
  # Entry Overextension Governance System - CCIP Compliant

  ## Purpose
  Tracks and governs trade entries that occur when price is overextended beyond optimal zones.
  Implements intelligent degradation instead of blocking.

  ## Changes
  1. New Table: `entry_overextension_events`
     - Tracks every overextension detection
     - Records degradation decisions
     - Enables governance audit trail

  2. Function: `log_overextension_event`
     - RPC for logging overextension events from application
     - Security definer for proper access

  ## Governance Model
  - **Validation Layer**: Engines detect overextension
  - **Advisory Layer**: System provides degradation recommendations
  - **Decision Layer**: Alpha makes final call with degradation applied
  - **No Silent Mutations**: All degradations are logged and auditable

  ## CCIP Compliance
  - Change Type: New Validation Engine (Non-Breaking)
  - Rollback Safe: Can be disabled via feature flag
  - Audit Trail: Full event logging
  - Impact: Improves entry quality, reduces drawdowns
*/

-- Create entry overextension tracking table
CREATE TABLE IF NOT EXISTS entry_overextension_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  session_id uuid REFERENCES goal_sessions(id),
  symbol text NOT NULL,
  direction text NOT NULL,

  -- Price Analysis
  current_price numeric NOT NULL,
  optimal_zone_min numeric NOT NULL,
  optimal_zone_max numeric NOT NULL,
  optimal_center numeric NOT NULL,
  overextension_distance numeric NOT NULL,
  overextension_percentage numeric NOT NULL,

  -- Overextension Classification
  overextension_type text NOT NULL,
  severity text NOT NULL,

  -- Degradation Applied
  degradation_action text NOT NULL,
  original_position_size numeric,
  degraded_position_size numeric,
  position_size_reduction_pct numeric,

  -- Decision Context
  alpha_confidence numeric,
  omega_consensus_count integer,
  was_executed boolean NOT NULL DEFAULT false,
  execution_overridden boolean DEFAULT false,
  override_reason text,

  -- Outcome Tracking
  trade_id uuid REFERENCES goal_session_trades(id),
  post_entry_movement numeric,
  was_profitable boolean,
  retrospective_quality text,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_overextension_events_user_id ON entry_overextension_events(user_id);
CREATE INDEX IF NOT EXISTS idx_overextension_events_session_id ON entry_overextension_events(session_id);
CREATE INDEX IF NOT EXISTS idx_overextension_events_created_at ON entry_overextension_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_overextension_events_severity ON entry_overextension_events(severity);
CREATE INDEX IF NOT EXISTS idx_overextension_events_trade_id ON entry_overextension_events(trade_id);

-- Enable RLS
ALTER TABLE entry_overextension_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own overextension events"
  ON entry_overextension_events FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access"
  ON entry_overextension_events FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can insert own events"
  ON entry_overextension_events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- RPC Function for logging overextension events
CREATE OR REPLACE FUNCTION log_overextension_event(
  p_session_id uuid,
  p_symbol text,
  p_direction text,
  p_current_price numeric,
  p_optimal_zone_min numeric,
  p_optimal_zone_max numeric,
  p_overextension_type text,
  p_severity text,
  p_degradation_action text,
  p_original_position_size numeric DEFAULT NULL,
  p_degraded_position_size numeric DEFAULT NULL,
  p_alpha_confidence numeric DEFAULT NULL,
  p_omega_consensus_count integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_id uuid;
  v_user_id uuid;
  v_optimal_center numeric;
  v_overextension_distance numeric;
  v_zone_width numeric;
  v_overextension_pct numeric;
  v_position_reduction_pct numeric;
BEGIN
  -- Get user_id from session
  SELECT user_id INTO v_user_id
  FROM goal_sessions
  WHERE id = p_session_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Session not found: %', p_session_id;
  END IF;

  -- Calculate metrics
  v_optimal_center := (p_optimal_zone_min + p_optimal_zone_max) / 2;
  v_zone_width := p_optimal_zone_max - p_optimal_zone_min;

  -- Calculate overextension distance
  IF p_direction = 'buy' THEN
    v_overextension_distance := GREATEST(0, p_current_price - p_optimal_zone_max);
  ELSE
    v_overextension_distance := GREATEST(0, p_optimal_zone_min - p_current_price);
  END IF;

  -- Calculate overextension percentage
  IF v_zone_width > 0 THEN
    v_overextension_pct := (v_overextension_distance / v_zone_width) * 100;
  ELSE
    v_overextension_pct := 0;
  END IF;

  -- Calculate position size reduction
  IF p_original_position_size IS NOT NULL AND p_degraded_position_size IS NOT NULL THEN
    v_position_reduction_pct := ((p_original_position_size - p_degraded_position_size) / p_original_position_size) * 100;
  END IF;

  -- Insert event
  INSERT INTO entry_overextension_events (
    user_id,
    session_id,
    symbol,
    direction,
    current_price,
    optimal_zone_min,
    optimal_zone_max,
    optimal_center,
    overextension_distance,
    overextension_percentage,
    overextension_type,
    severity,
    degradation_action,
    original_position_size,
    degraded_position_size,
    position_size_reduction_pct,
    alpha_confidence,
    omega_consensus_count,
    was_executed
  ) VALUES (
    v_user_id,
    p_session_id,
    p_symbol,
    p_direction,
    p_current_price,
    p_optimal_zone_min,
    p_optimal_zone_max,
    v_optimal_center,
    v_overextension_distance,
    v_overextension_pct,
    p_overextension_type,
    p_severity,
    p_degradation_action,
    p_original_position_size,
    p_degraded_position_size,
    v_position_reduction_pct,
    p_alpha_confidence,
    p_omega_consensus_count,
    p_degradation_action != 'entry_blocked'
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

-- Create view for overextension analytics
CREATE OR REPLACE VIEW overextension_analytics AS
SELECT
  severity,
  degradation_action,
  overextension_type,
  COUNT(*) as event_count,
  AVG(overextension_percentage) as avg_overextension_pct,
  AVG(position_size_reduction_pct) as avg_position_reduction_pct,
  SUM(CASE WHEN was_executed THEN 1 ELSE 0 END) as executed_count,
  SUM(CASE WHEN was_profitable THEN 1 ELSE 0 END) as profitable_count,
  SUM(CASE WHEN was_profitable THEN 1 ELSE 0 END)::float / NULLIF(SUM(CASE WHEN was_profitable IS NOT NULL THEN 1 ELSE 0 END), 0) * 100 as win_rate
FROM entry_overextension_events
GROUP BY severity, degradation_action, overextension_type;

-- Grant permissions
GRANT SELECT ON overextension_analytics TO authenticated;
