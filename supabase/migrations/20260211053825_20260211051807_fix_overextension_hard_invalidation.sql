/*
  # Fix Entry Overextension System - Hard Invalidation (CCIP)

  ## Purpose
  Corrects overextension system to use HARD INVALIDATION instead of position size degradation.
  
  Principle: Overextension is a precision violation, not a risk parameter.
  Alpha must either enter correctly or not enter. No "enter badly but smaller."

  ## Changes
  1. Alter entry_overextension_events table
     - Remove lot size degradation fields
     - Add entry_blocked boolean
     - Add style field for threshold tracking
     - Keep audit trail fields

  2. Update log_overextension_event function
     - Remove lot size parameters
     - Add entry_blocked parameter
     - Simplify to binary VALID/INVALID decision

  3. Drop degradation-based analytics
     - Replace with invalidation analytics
     - Track block rate by style and severity

  ## Governance
  - Change Type: Logic Correction (Breaking Change in Behavior)
  - Rollback: Revert to previous migration
  - Impact: Stricter entry discipline, fewer bad entries
*/

-- Drop old analytics view
DROP VIEW IF EXISTS overextension_analytics;

-- Alter table to remove degradation fields and add invalidation fields
ALTER TABLE entry_overextension_events
  DROP COLUMN IF EXISTS original_position_size,
  DROP COLUMN IF EXISTS degraded_position_size,
  DROP COLUMN IF EXISTS position_size_reduction_pct,
  DROP COLUMN IF EXISTS degradation_action,
  ADD COLUMN IF NOT EXISTS entry_blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS style text,
  ADD COLUMN IF NOT EXISTS max_allowed_overextension_pct numeric,
  ADD COLUMN IF NOT EXISTS decision_reason text;

-- Update RPC function for hard invalidation
CREATE OR REPLACE FUNCTION log_overextension_event(
  p_session_id uuid,
  p_symbol text,
  p_direction text,
  p_current_price numeric,
  p_optimal_zone_min numeric,
  p_optimal_zone_max numeric,
  p_overextension_type text,
  p_severity text,
  p_entry_blocked boolean,
  p_style text DEFAULT NULL,
  p_max_allowed_pct numeric DEFAULT NULL,
  p_decision_reason text DEFAULT NULL,
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
    entry_blocked,
    style,
    max_allowed_overextension_pct,
    decision_reason,
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
    p_entry_blocked,
    p_style,
    p_max_allowed_pct,
    p_decision_reason,
    p_alpha_confidence,
    p_omega_consensus_count,
    NOT p_entry_blocked  -- was_executed = true only if NOT blocked
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

-- Create new analytics view for invalidation tracking
CREATE OR REPLACE VIEW overextension_invalidation_analytics AS
SELECT
  style,
  severity,
  overextension_type,
  COUNT(*) as total_events,
  SUM(CASE WHEN entry_blocked THEN 1 ELSE 0 END) as blocked_count,
  SUM(CASE WHEN NOT entry_blocked THEN 1 ELSE 0 END) as allowed_count,
  AVG(overextension_percentage) as avg_overextension_pct,
  AVG(max_allowed_overextension_pct) as avg_threshold_pct,
  SUM(CASE WHEN was_profitable THEN 1 ELSE 0 END) as profitable_count,
  SUM(CASE WHEN was_profitable THEN 1 ELSE 0 END)::float / 
    NULLIF(SUM(CASE WHEN was_profitable IS NOT NULL THEN 1 ELSE 0 END), 0) * 100 as win_rate,
  AVG(CASE WHEN was_profitable = true THEN post_entry_movement ELSE NULL END) as avg_winning_movement,
  AVG(CASE WHEN was_profitable = false THEN post_entry_movement ELSE NULL END) as avg_losing_movement
FROM entry_overextension_events
GROUP BY style, severity, overextension_type;

-- Grant permissions
GRANT SELECT ON overextension_invalidation_analytics TO authenticated;

-- Add comment for governance
COMMENT ON TABLE entry_overextension_events IS 
'CCIP 20260211: Hard invalidation system. Overextension is a precision violation. Entry must be valid or blocked - no degradation.';
