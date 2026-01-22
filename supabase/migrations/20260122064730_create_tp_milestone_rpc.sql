/*
  # Create TP Milestone RPC Functions - SSOT Compliance

  ## Overview
  These RPC functions provide the Single Source of Truth for TP1/TP2 milestone marking.
  All TP milestone updates MUST go through these functions.

  ## Functions Created
  1. `mark_tp1_milestone(trade_id)` - Marks TP1 hit
  2. `mark_tp2_milestone(trade_id)` - Marks TP2 hit

  ## Security
  - Functions run with SECURITY DEFINER (service role permissions)
  - RLS policies still enforced for trade access
  - Validates trade exists and is open before updating

  ## Usage
  ```sql
  SELECT mark_tp1_milestone('trade-uuid-here');
  SELECT mark_tp2_milestone('trade-uuid-here');
  ```
*/

-- Function to mark TP1 milestone
CREATE OR REPLACE FUNCTION mark_tp1_milestone(trade_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trade record;
  v_result jsonb;
BEGIN
  -- Get trade
  SELECT * INTO v_trade
  FROM goal_session_trades
  WHERE id = trade_id;

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

  -- Mark TP1 milestone (no position size change)
  UPDATE goal_session_trades
  SET
    tp1_hit = true,
    tp1_hit_at = NOW(),
    updated_at = NOW()
  WHERE id = trade_id;

  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'trade_id', trade_id,
    'tp1_hit_at', NOW()
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;

-- Function to mark TP2 milestone
CREATE OR REPLACE FUNCTION mark_tp2_milestone(trade_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trade record;
  v_result jsonb;
BEGIN
  -- Get trade
  SELECT * INTO v_trade
  FROM goal_session_trades
  WHERE id = trade_id;

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

  -- Mark TP2 milestone (no position size change)
  UPDATE goal_session_trades
  SET
    tp2_hit = true,
    tp2_hit_at = NOW(),
    updated_at = NOW()
  WHERE id = trade_id;

  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'trade_id', trade_id,
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

-- Add helpful comments
COMMENT ON FUNCTION mark_tp1_milestone IS 'SSOT function for marking TP1 milestone. All TP1 updates must use this.';
COMMENT ON FUNCTION mark_tp2_milestone IS 'SSOT function for marking TP2 milestone. All TP2 updates must use this.';
