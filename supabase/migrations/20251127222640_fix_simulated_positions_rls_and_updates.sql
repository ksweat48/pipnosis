/*
  # Fix Simulated Positions RLS and Update Issues - PERMANENT FIX

  ## Problem
  Users cannot update or close their own positions due to RLS policy conflicts.
  The existing policy is failing to properly verify auth.uid() = user_id.

  ## Solution
  1. Delete any orphaned positions (positions with invalid user_ids)
  2. Create secure database functions that bypass RLS with proper auth checking
  3. Grant appropriate permissions
  4. Keep RLS policies but add secure functions as alternative update path

  ## New Functions
  - `update_simulated_position_secure` - Update position price and P&L
  - `close_simulated_position_secure` - Close position with full P&L calculation

  ## Security
  - All functions use SECURITY DEFINER to bypass RLS
  - All functions verify auth.uid() matches position.user_id
  - All functions prevent unauthorized access
*/

-- ============================================================================
-- STEP 1: Clean up any orphaned or broken positions
-- ============================================================================

-- Delete positions where user no longer exists
DELETE FROM simulated_positions
WHERE user_id NOT IN (SELECT id FROM auth.users);

-- ============================================================================
-- STEP 2: Create secure function for updating position price/PnL
-- ============================================================================

CREATE OR REPLACE FUNCTION update_simulated_position_secure(
  p_position_id uuid,
  p_current_price numeric,
  p_current_pnl numeric
)
RETURNS void
SECURITY DEFINER -- Run with elevated privileges to bypass RLS
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  -- Get the position's owner
  SELECT user_id INTO v_user_id
  FROM simulated_positions
  WHERE id = p_position_id;

  -- Verify position exists
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Position % not found', p_position_id;
  END IF;

  -- Verify caller owns this position
  IF v_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Access denied: position belongs to different user';
  END IF;

  -- Update the position
  UPDATE simulated_positions
  SET
    current_price = p_current_price,
    current_pnl = p_current_pnl,
    updated_at = now()
  WHERE id = p_position_id;

  -- Log success for debugging
  RAISE DEBUG 'Position % updated: price=%, pnl=%', p_position_id, p_current_price, p_current_pnl;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION update_simulated_position_secure TO authenticated;

-- ============================================================================
-- STEP 3: Create secure function for closing positions
-- ============================================================================

CREATE OR REPLACE FUNCTION close_simulated_position_secure(
  p_position_id uuid,
  p_close_price numeric,
  p_close_reason text DEFAULT 'manual'
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_position record;
  v_pnl numeric;
  v_pip_distance numeric;
  v_dollar_per_pip numeric;
  v_current_balance numeric;
  v_new_balance numeric;
  v_result jsonb;
BEGIN
  -- Get position details and verify ownership
  SELECT * INTO v_position
  FROM simulated_positions
  WHERE id = p_position_id
  AND status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Position % not found or not open', p_position_id;
  END IF;

  IF v_position.user_id != auth.uid() THEN
    RAISE EXCEPTION 'Access denied: position belongs to different user';
  END IF;

  -- Calculate final P&L using proper forex pip calculation
  -- For standard pairs (e.g., EURUSD): pip = 0.0001
  -- For JPY pairs: pip = 0.01
  IF v_position.symbol LIKE '%JPY%' THEN
    v_pip_distance := (p_close_price - v_position.entry_price) / 0.01;
  ELSE
    v_pip_distance := (p_close_price - v_position.entry_price) / 0.0001;
  END IF;

  -- Dollar per pip = lot_size * 100000 * 0.0001 (for standard pairs)
  -- Simplified: lot_size * 10
  IF v_position.symbol LIKE '%JPY%' THEN
    v_dollar_per_pip := v_position.lot_size * 1000;
  ELSE
    v_dollar_per_pip := v_position.lot_size * 10;
  END IF;

  -- Calculate P&L based on direction
  IF v_position.position_type = 'buy' THEN
    v_pnl := v_pip_distance * v_dollar_per_pip;
  ELSE
    v_pnl := -v_pip_distance * v_dollar_per_pip;
  END IF;

  -- Close the position
  UPDATE simulated_positions
  SET
    status = 'closed',
    current_price = p_close_price,
    current_pnl = v_pnl,
    closed_at = now(),
    close_reason = p_close_reason,
    updated_at = now()
  WHERE id = p_position_id;

  -- Get current balance
  SELECT demo_balance INTO v_current_balance
  FROM user_profiles
  WHERE id = v_position.user_id;

  v_new_balance := v_current_balance + v_pnl;

  -- Update user balance
  UPDATE user_profiles
  SET demo_balance = v_new_balance
  WHERE id = v_position.user_id;

  -- Create balance transaction
  INSERT INTO balance_transactions (
    user_id,
    transaction_type,
    amount,
    balance_before,
    balance_after,
    position_id,
    description
  ) VALUES (
    v_position.user_id,
    'trade_pnl',
    v_pnl,
    v_current_balance,
    v_new_balance,
    p_position_id,
    format('Position closed (%s): %s %s %s lots',
      p_close_reason,
      v_position.symbol,
      v_position.position_type,
      v_position.lot_size
    )
  );

  -- Record in trade history
  INSERT INTO trade_history (
    user_id,
    position_id,
    symbol,
    position_type,
    lot_size,
    entry_price,
    exit_price,
    stop_loss,
    take_profit,
    profit_loss,
    opened_at,
    closed_at,
    close_reason,
    confidence_score,
    ai_analyzed,
    trade_source
  ) VALUES (
    v_position.user_id,
    p_position_id,
    v_position.symbol,
    v_position.position_type,
    v_position.lot_size,
    v_position.entry_price,
    p_close_price,
    v_position.stop_loss,
    v_position.take_profit,
    v_pnl,
    v_position.opened_at,
    now(),
    p_close_reason,
    75,
    false,
    'manual'
  );

  -- Return result
  v_result := jsonb_build_object(
    'success', true,
    'position_id', p_position_id,
    'pnl', v_pnl,
    'close_price', p_close_price,
    'new_balance', v_new_balance
  );

  RETURN v_result;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION close_simulated_position_secure TO authenticated;

-- ============================================================================
-- STEP 4: Update RLS policies to be more permissive
-- ============================================================================

-- Drop existing restrictive update policy
DROP POLICY IF EXISTS "Users can update own positions" ON simulated_positions;

-- Create new policy that allows user updates OR admin access
CREATE POLICY "Users can update own positions v2"
  ON simulated_positions FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    OR
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    OR
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- ============================================================================
-- STEP 5: Add helper function to check position ownership
-- ============================================================================

CREATE OR REPLACE FUNCTION user_owns_position(p_position_id uuid)
RETURNS boolean
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT user_id INTO v_user_id
  FROM simulated_positions
  WHERE id = p_position_id;

  RETURN v_user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION user_owns_position TO authenticated;

-- ============================================================================
-- STEP 6: Add indexes for performance
-- ============================================================================

-- Index for faster ownership checks
CREATE INDEX IF NOT EXISTS idx_simulated_positions_user_id_status_open
  ON simulated_positions(user_id, status)
  WHERE status = 'open';

-- ============================================================================
-- STEP 7: Add comments for documentation
-- ============================================================================

COMMENT ON FUNCTION update_simulated_position_secure IS
  'Securely updates position price and P&L, bypassing RLS with proper auth verification';

COMMENT ON FUNCTION close_simulated_position_secure IS
  'Securely closes a position with full P&L calculation and balance updates, bypassing RLS';

COMMENT ON FUNCTION user_owns_position IS
  'Helper function to check if authenticated user owns a specific position';