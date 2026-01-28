/*
  # Emergency Fix: Ambiguous trade_id in mark_tp2_milestone RPC
  
  ## Root Cause
  Function parameter `trade_id` conflicts with table column `goal_session_trades.trade_id`
  causing "column reference trade_id is ambiguous" errors on TP2 closures.
  
  ## Fix
  1. DROP existing functions
  2. Recreate with table aliases to eliminate any ambiguity
  
  ## Impact
  Frontend code calls these RPCs - function calls remain compatible.
*/

-- Drop existing functions
DROP FUNCTION IF EXISTS mark_tp1_milestone(uuid);
DROP FUNCTION IF EXISTS mark_tp2_milestone(uuid);

-- Recreate mark_tp1_milestone with explicit table aliases
CREATE OR REPLACE FUNCTION mark_tp1_milestone(trade_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trade record;
BEGIN
  -- Get trade - use explicit alias
  SELECT t.* INTO v_trade
  FROM goal_session_trades AS t
  WHERE t.id = mark_tp1_milestone.trade_id;

  -- Validate trade exists
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Trade not found'
    );
  END IF;

  -- Validate trade is open
  IF v_trade.status != 'open' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Trade must be open to mark TP1',
      'current_status', v_trade.status
    );
  END IF;

  -- Mark TP1 milestone - use explicit function qualification
  UPDATE goal_session_trades AS t
  SET
    tp1_hit = true,
    tp1_hit_at = NOW(),
    updated_at = NOW()
  WHERE t.id = mark_tp1_milestone.trade_id;

  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'trade_id', mark_tp1_milestone.trade_id,
    'tp1_hit_at', NOW()
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;

-- Recreate mark_tp2_milestone with explicit table aliases
CREATE OR REPLACE FUNCTION mark_tp2_milestone(trade_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trade record;
BEGIN
  -- Get trade - use explicit alias
  SELECT t.* INTO v_trade
  FROM goal_session_trades AS t
  WHERE t.id = mark_tp2_milestone.trade_id;

  -- Validate trade exists
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Trade not found'
    );
  END IF;

  -- Validate trade is open
  IF v_trade.status != 'open' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Trade must be open to mark TP2',
      'current_status', v_trade.status
    );
  END IF;

  -- Mark TP2 milestone - use explicit function qualification
  UPDATE goal_session_trades AS t
  SET
    tp2_hit = true,
    tp2_hit_at = NOW(),
    updated_at = NOW()
  WHERE t.id = mark_tp2_milestone.trade_id;

  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'trade_id', mark_tp2_milestone.trade_id,
    'tp2_hit_at', NOW()
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION mark_tp1_milestone TO authenticated;
GRANT EXECUTE ON FUNCTION mark_tp1_milestone TO service_role;
GRANT EXECUTE ON FUNCTION mark_tp2_milestone TO authenticated;
GRANT EXECUTE ON FUNCTION mark_tp2_milestone TO service_role;

-- Verify functions exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'mark_tp1_milestone') AND
     EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'mark_tp2_milestone') THEN
    RAISE NOTICE '✅ TP milestone functions recreated successfully';
  ELSE
    RAISE WARNING '⚠️ TP milestone functions may not have been created correctly';
  END IF;
END $$;
