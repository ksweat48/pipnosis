/*
  # Create Thesis Management Functions
  
  ## Functions
  
  1. create_trade_thesis_plan
     - SSOT creation point for all thesis plans
     - Called exactly once per trade by TradeThesisPlanGenerator
     - Validates all thesis data before storage
     - Returns thesis_plan_id for linking
  
  2. log_thesis_monitoring_event
     - Immutable event logging
     - Called by ThesisMonitoringAuthority on each condition check
     - Records condition evaluation with reasoning
  
  3. update_thesis_status
     - Updates thesis_status and confidence on trade
     - Called by mid-trade monitor when thesis state changes
     - Maintains audit trail via monitoring logs
  
  ## SSOT Compliance
  
  - Functions are sole authorities for their responsibilities
  - Validation ensures data integrity
  - All business logic for thesis stored here
  - Services call these functions, don't manipulate data directly
*/

-- Create thesis plan function (SSOT creation authority)
CREATE OR REPLACE FUNCTION create_trade_thesis_plan(
  p_user_id uuid,
  p_goal_session_id uuid,
  p_trade_id uuid,
  p_symbol text,
  p_direction text,
  p_thesis_narrative text,
  p_regime_snapshot jsonb,
  p_setup_type text,
  p_invalidation_conditions jsonb,
  p_confirmation_conditions jsonb,
  p_key_levels jsonb,
  p_expected_duration_minutes integer,
  p_expected_direction text,
  p_expected_volatility text,
  p_alpha_confidence_at_entry numeric,
  p_confidence_band_upper numeric,
  p_confidence_band_lower numeric,
  p_thesis_risk_reward numeric,
  p_thesis_expected_holding_time_minutes integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_thesis_id uuid;
  v_result jsonb;
BEGIN
  -- Validate inputs
  IF p_thesis_narrative IS NULL OR LENGTH(TRIM(p_thesis_narrative)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Thesis narrative cannot be empty');
  END IF;
  
  IF p_direction NOT IN ('buy', 'sell') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid direction');
  END IF;
  
  IF p_alpha_confidence_at_entry < 0 OR p_alpha_confidence_at_entry > 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Confidence must be between 0 and 1');
  END IF;
  
  -- Check if thesis already exists for this trade (SSOT: only one per trade)
  IF EXISTS (SELECT 1 FROM trade_thesis_plans WHERE trade_id = p_trade_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Thesis plan already exists for this trade');
  END IF;
  
  -- Create thesis plan
  INSERT INTO trade_thesis_plans (
    user_id,
    goal_session_id,
    trade_id,
    symbol,
    direction,
    thesis_narrative,
    regime_snapshot,
    setup_type,
    invalidation_conditions,
    confirmation_conditions,
    key_levels,
    expected_duration_minutes,
    expected_direction,
    expected_volatility,
    alpha_confidence_at_entry,
    confidence_band_upper,
    confidence_band_lower,
    thesis_risk_reward,
    thesis_expected_holding_time_minutes
  ) VALUES (
    p_user_id,
    p_goal_session_id,
    p_trade_id,
    p_symbol,
    p_direction,
    p_thesis_narrative,
    p_regime_snapshot,
    p_setup_type,
    COALESCE(p_invalidation_conditions, '[]'::jsonb),
    COALESCE(p_confirmation_conditions, '[]'::jsonb),
    COALESCE(p_key_levels, '[]'::jsonb),
    p_expected_duration_minutes,
    p_expected_direction,
    p_expected_volatility,
    p_alpha_confidence_at_entry,
    p_confidence_band_upper,
    p_confidence_band_lower,
    p_thesis_risk_reward,
    p_thesis_expected_holding_time_minutes
  )
  RETURNING id INTO v_thesis_id;
  
  -- Link thesis to trade
  UPDATE goal_session_trades
  SET thesis_plan_id = v_thesis_id,
      thesis_status = 'new',
      thesis_confidence_current = p_alpha_confidence_at_entry
  WHERE id = p_trade_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'thesis_plan_id', v_thesis_id,
    'message', 'Thesis plan created successfully'
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION create_trade_thesis_plan(uuid, uuid, uuid, text, text, text, jsonb, text, jsonb, jsonb, jsonb, integer, text, text, numeric, numeric, numeric, numeric, integer) TO authenticated, service_role;

-- Log thesis monitoring event
CREATE OR REPLACE FUNCTION log_thesis_monitoring_event(
  p_user_id uuid,
  p_trade_id uuid,
  p_thesis_plan_id uuid,
  p_condition_type text,
  p_condition_description text,
  p_condition_status text,
  p_current_price numeric,
  p_market_spread numeric,
  p_thesis_status_before text,
  p_thesis_status_after text,
  p_confidence_change numeric,
  p_reasoning text,
  p_metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_log_id uuid;
BEGIN
  -- Validate inputs
  IF p_condition_type NOT IN ('invalidation', 'confirmation', 'key_level', 'momentum', 'time_decay') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid condition type');
  END IF;
  
  IF p_condition_status NOT IN ('met', 'violated', 'triggered', 'cleared', 'monitored') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid condition status');
  END IF;
  
  -- Insert log entry (immutable)
  INSERT INTO thesis_monitoring_logs (
    user_id,
    trade_id,
    thesis_plan_id,
    condition_type,
    condition_description,
    condition_status,
    current_price,
    market_spread,
    thesis_status_before,
    thesis_status_after,
    confidence_change,
    reasoning,
    metadata
  ) VALUES (
    p_user_id,
    p_trade_id,
    p_thesis_plan_id,
    p_condition_type,
    p_condition_description,
    p_condition_status,
    p_current_price,
    p_market_spread,
    p_thesis_status_before,
    p_thesis_status_after,
    COALESCE(p_confidence_change, 0),
    p_reasoning,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_log_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'log_id', v_log_id,
    'message', 'Thesis event logged'
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION log_thesis_monitoring_event(uuid, uuid, uuid, text, text, text, numeric, numeric, text, text, numeric, text, jsonb) TO authenticated, service_role;

-- Update thesis status on trade
CREATE OR REPLACE FUNCTION update_thesis_status(
  p_trade_id uuid,
  p_thesis_status text,
  p_thesis_confidence_current numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Validate inputs
  IF p_thesis_status NOT IN ('new', 'intact', 'strengthening', 'deteriorating', 'partially_valid', 'broken', 'momentum_loss') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid thesis status');
  END IF;
  
  IF p_thesis_confidence_current < 0 OR p_thesis_confidence_current > 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Confidence must be between 0 and 1');
  END IF;
  
  -- Update trade with new thesis status
  UPDATE goal_session_trades
  SET thesis_status = p_thesis_status,
      thesis_confidence_current = p_thesis_confidence_current,
      last_thesis_evaluation_at = now()
  WHERE id = p_trade_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Thesis status updated'
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION update_thesis_status(uuid, text, numeric) TO authenticated, service_role;

COMMENT ON FUNCTION create_trade_thesis_plan IS 'SSOT: Only function that creates thesis plans. Called exactly once per trade by TradeThesisPlanGenerator.';
COMMENT ON FUNCTION log_thesis_monitoring_event IS 'Immutable event logging. Records thesis condition evaluations for audit trail.';
COMMENT ON FUNCTION update_thesis_status IS 'Updates thesis status and confidence on trade during monitoring.';
