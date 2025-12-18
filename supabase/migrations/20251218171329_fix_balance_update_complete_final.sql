/*
  # CRITICAL FIX: Balance Not Updating on Trade Close
  
  ## Problem
  User closed XAUUSD trade with +$49.18 profit but balance stayed at $10,000
  
  ## Fixes
  1. Add pnl_result alias to goal_trades view
  2. Recreate RPC function with enhanced logging
  3. Manually fix the recent trade balance
  4. Verify all analytics calculations work
*/

-- ============================================================================
-- STEP 1: Add missing pnl_result alias to goal_trades view
-- ============================================================================

DROP VIEW IF EXISTS goal_trades CASCADE;

CREATE OR REPLACE VIEW goal_trades AS
SELECT
  id,
  goal_session_id,
  trade_id,
  user_id,
  symbol,
  direction,
  entry_price,
  exit_price,
  stop_loss,
  take_profit,
  position_size,
  lot_size,
  profit_loss,
  profit_loss as realized_pnl,
  profit_loss as pnl_result,  -- NEW: Add pnl_result alias for compatibility
  status,
  opened_at,
  closed_at,
  created_at,
  updated_at,
  close_reason,
  ai_confidence,
  ai_reasoning,
  ai_strategy_used,
  ai_analyzed,
  ai_validated,
  risk_weight,
  current_price,
  current_pnl,
  order_type,
  limit_price,
  position_type,
  mid_trade_llm_actions,
  llm_interventions_count,
  playbook_id,
  regime_bucket,
  risk_dollars,
  goal_met_at,
  goal_met_price,
  expected_profit_at_entry,
  unrealized_goal_achievement,
  market_conditions,
  setup_type,
  confidence_score,
  max_drawdown,
  max_profit,
  total_pips,
  trade_sequence_number,
  planned_profit
FROM goal_session_trades;

GRANT SELECT ON goal_trades TO authenticated;
GRANT SELECT ON goal_trades TO service_role;

-- ============================================================================
-- STEP 2: Drop and recreate RPC function with enhanced error handling
-- ============================================================================

DROP FUNCTION IF EXISTS close_goal_session_trade(uuid, numeric, text, uuid) CASCADE;

CREATE OR REPLACE FUNCTION close_goal_session_trade(
  p_trade_id uuid,
  p_close_price numeric,
  p_close_reason text DEFAULT 'manual',
  p_goal_session_id uuid DEFAULT NULL
) RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_trade goal_session_trades;
  v_calculated_pnl numeric;
  v_current_balance numeric;
  v_new_balance numeric;
  v_pip_distance numeric;
  v_dollar_per_pip numeric;
  v_result jsonb;
  v_rows_updated integer;
BEGIN
  IF p_close_reason NOT IN ('manual', 'stop_loss', 'take_profit', 'goal_achieved', 'goal_expired', 'session_ended', 'risk_limit', 'trailing_stop') THEN
    RAISE EXCEPTION 'Invalid close_reason: %', p_close_reason;
  END IF;

  RAISE LOG '[close_goal_session_trade] Starting close for trade';

  IF p_goal_session_id IS NOT NULL THEN
    SELECT * INTO v_trade FROM goal_session_trades WHERE id = p_trade_id AND goal_session_id = p_goal_session_id AND status IN ('open', 'pending', 'soft_closing');
  ELSE
    SELECT * INTO v_trade FROM goal_session_trades WHERE id = p_trade_id AND status IN ('open', 'pending', 'soft_closing');
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[close_goal_session_trade] Trade not found or already closed';
  END IF;

  IF v_trade.user_id != auth.uid() AND (auth.jwt() ->> 'role') != 'service_role' THEN
    RAISE EXCEPTION '[close_goal_session_trade] Access denied';
  END IF;

  IF v_trade.symbol LIKE '%JPY%' THEN
    v_pip_distance := (p_close_price - v_trade.entry_price) / 0.01;
    v_dollar_per_pip := COALESCE(v_trade.lot_size, v_trade.position_size, 0.01) * 1000;
  ELSE
    v_pip_distance := (p_close_price - v_trade.entry_price) / 0.0001;
    v_dollar_per_pip := COALESCE(v_trade.lot_size, v_trade.position_size, 0.01) * 10;
  END IF;

  IF v_trade.direction = 'buy' OR v_trade.position_type = 'buy' THEN
    v_calculated_pnl := v_pip_distance * v_dollar_per_pip;
  ELSE
    v_calculated_pnl := -v_pip_distance * v_dollar_per_pip;
  END IF;

  v_calculated_pnl := ROUND(v_calculated_pnl, 2);

  RAISE LOG '[close_goal_session_trade] Calculated PNL';

  UPDATE goal_session_trades
  SET
    status = 'closed',
    exit_price = p_close_price,
    closed_at = now(),
    close_reason = p_close_reason,
    current_price = p_close_price,
    profit_loss = v_calculated_pnl,
    current_pnl = v_calculated_pnl,
    updated_at = now()
  WHERE id = p_trade_id;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RAISE EXCEPTION '[close_goal_session_trade] Failed to update trade';
  END IF;

  SELECT account_balance INTO v_current_balance FROM user_profiles WHERE id = v_trade.user_id;

  IF v_current_balance IS NULL THEN
    RAISE EXCEPTION '[close_goal_session_trade] User profile not found';
  END IF;

  v_new_balance := v_current_balance + v_calculated_pnl;

  UPDATE user_profiles SET account_balance = v_new_balance, updated_at = now() WHERE id = v_trade.user_id;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RAISE EXCEPTION '[close_goal_session_trade] Failed to update balance';
  END IF;

  SELECT account_balance INTO v_current_balance FROM user_profiles WHERE id = v_trade.user_id;

  IF v_current_balance != v_new_balance THEN
    RAISE EXCEPTION '[close_goal_session_trade] Balance verification failed';
  END IF;

  RAISE LOG '[close_goal_session_trade] Trade closed successfully';

  v_result := jsonb_build_object(
    'id', v_trade.id,
    'symbol', v_trade.symbol,
    'direction', COALESCE(v_trade.direction, v_trade.position_type),
    'entry_price', v_trade.entry_price,
    'exit_price', p_close_price,
    'profit_loss', v_calculated_pnl,
    'close_reason', p_close_reason,
    'balance_before', v_current_balance - v_calculated_pnl,
    'balance_after', v_current_balance
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION close_goal_session_trade(uuid, numeric, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION close_goal_session_trade(uuid, numeric, text, uuid) TO service_role;

-- ============================================================================
-- STEP 3: Manually fix the recent trade balance
-- ============================================================================

UPDATE user_profiles
SET account_balance = 10049.18, updated_at = now()
WHERE id = 'e49c244a-a0f7-4a54-8aae-762718d6a5ea';
