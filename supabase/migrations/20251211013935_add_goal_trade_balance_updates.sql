/*
  # Add Automatic Balance Updates for Goal Session Trades

  ## Problem
  Currently, only manual trades (simulated_positions) update user balance when closed.
  AI goal trades (goal_session_trades) calculate P&L but DO NOT update the balance.

  This creates inconsistency:
  - Manual trades: Balance updates automatically ✓
  - AI goal trades: Balance does NOT update ✗

  ## Solution
  1. Enhance balance_transactions to support both trade types
  2. Update close_goal_session_trade to match close_simulated_position_secure behavior
  3. Create trigger for automatic balance updates on trade close
  4. Add balance reconciliation function for admin

  ## Impact
  Users will now see their balance accurately reflect ALL closed trades,
  not just manual ones. This fixes a critical accounting bug.
*/

-- ============================================================================
-- STEP 1: Enhance balance_transactions table
-- ============================================================================

-- Add goal_trade_id column to track goal session trades
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'balance_transactions'
    AND column_name = 'goal_trade_id'
  ) THEN
    ALTER TABLE balance_transactions
    ADD COLUMN goal_trade_id uuid REFERENCES goal_session_trades(id) ON DELETE SET NULL;

    COMMENT ON COLUMN balance_transactions.goal_trade_id IS
      'Reference to goal_session_trades for AI-driven trades';
  END IF;

  -- Add source_type to distinguish transaction origins
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'balance_transactions'
    AND column_name = 'source_type'
  ) THEN
    ALTER TABLE balance_transactions
    ADD COLUMN source_type text DEFAULT 'manual_trade'
    CHECK (source_type IN ('manual_trade', 'goal_trade', 'manual_adjustment', 'admin_adjustment'));

    COMMENT ON COLUMN balance_transactions.source_type IS
      'Origin of the balance change: manual_trade, goal_trade, manual_adjustment, admin_adjustment';
  END IF;

  -- Add metadata for additional context
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'balance_transactions'
    AND column_name = 'metadata'
  ) THEN
    ALTER TABLE balance_transactions
    ADD COLUMN metadata jsonb DEFAULT '{}'::jsonb;

    COMMENT ON COLUMN balance_transactions.metadata IS
      'Additional context: symbol, direction, close_reason, goal_session_id, etc.';
  END IF;
END $$;

-- Create index for goal_trade_id lookups
CREATE INDEX IF NOT EXISTS idx_balance_transactions_goal_trade
  ON balance_transactions(goal_trade_id)
  WHERE goal_trade_id IS NOT NULL;

-- Create index for source_type filtering
CREATE INDEX IF NOT EXISTS idx_balance_transactions_source_type
  ON balance_transactions(user_id, source_type, created_at DESC);

-- ============================================================================
-- STEP 2: Update close_goal_session_trade function with balance updates
-- ============================================================================

-- Drop existing function first (changing return type)
DROP FUNCTION IF EXISTS close_goal_session_trade(uuid, numeric, text);

CREATE OR REPLACE FUNCTION close_goal_session_trade(
  p_trade_id uuid,
  p_close_price numeric,
  p_close_reason text DEFAULT 'manual'
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
BEGIN
  -- Validate close reason
  IF p_close_reason NOT IN ('manual', 'stop_loss', 'take_profit', 'goal_achieved', 'goal_expired', 'session_ended', 'risk_limit', 'trailing_stop') THEN
    RAISE EXCEPTION 'Invalid close_reason: %. Must be one of: manual, stop_loss, take_profit, goal_achieved, goal_expired, session_ended, risk_limit, trailing_stop', p_close_reason;
  END IF;

  -- Get trade details and verify ownership
  SELECT * INTO v_trade
  FROM goal_session_trades
  WHERE id = p_trade_id
    AND status IN ('open', 'pending', 'soft_closing');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trade % not found, already closed, or not in valid state', p_trade_id;
  END IF;

  -- Verify access (user owns it or service role)
  IF v_trade.user_id != auth.uid() AND auth.jwt() ->> 'role' != 'service_role' THEN
    RAISE EXCEPTION 'Access denied: trade belongs to different user';
  END IF;

  -- Calculate P&L using proper forex pip calculation (matching manual trades)
  -- For standard pairs (e.g., EURUSD): pip = 0.0001
  -- For JPY pairs: pip = 0.01
  IF v_trade.symbol LIKE '%JPY%' THEN
    v_pip_distance := (p_close_price - v_trade.entry_price) / 0.01;
    v_dollar_per_pip := COALESCE(v_trade.lot_size, v_trade.position_size, 0.01) * 1000;
  ELSE
    v_pip_distance := (p_close_price - v_trade.entry_price) / 0.0001;
    v_dollar_per_pip := COALESCE(v_trade.lot_size, v_trade.position_size, 0.01) * 10;
  END IF;

  -- Calculate P&L based on direction
  IF v_trade.direction = 'buy' OR v_trade.position_type = 'buy' THEN
    v_calculated_pnl := v_pip_distance * v_dollar_per_pip;
  ELSE
    v_calculated_pnl := -v_pip_distance * v_dollar_per_pip;
  END IF;

  -- Round P&L to 2 decimal places
  v_calculated_pnl := ROUND(v_calculated_pnl, 2);

  -- Update the trade record
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

  -- Get current balance
  SELECT account_balance INTO v_current_balance
  FROM user_profiles
  WHERE id = v_trade.user_id;

  IF v_current_balance IS NULL THEN
    RAISE EXCEPTION 'User profile not found for user_id: %', v_trade.user_id;
  END IF;

  -- Calculate new balance
  v_new_balance := v_current_balance + v_calculated_pnl;

  -- Update user balance (CRITICAL FIX - this was missing!)
  UPDATE user_profiles
  SET account_balance = v_new_balance,
      updated_at = now()
  WHERE id = v_trade.user_id;

  -- Create balance transaction record (CRITICAL FIX - this was missing!)
  INSERT INTO balance_transactions (
    user_id,
    transaction_type,
    amount,
    balance_before,
    balance_after,
    goal_trade_id,
    source_type,
    description,
    metadata
  ) VALUES (
    v_trade.user_id,
    'trade_pnl',
    v_calculated_pnl,
    v_current_balance,
    v_new_balance,
    p_trade_id,
    'goal_trade',
    format('Goal trade closed (%s): %s %s %s lots',
      p_close_reason,
      v_trade.symbol,
      COALESCE(v_trade.direction, v_trade.position_type),
      COALESCE(v_trade.lot_size, v_trade.position_size)
    ),
    jsonb_build_object(
      'symbol', v_trade.symbol,
      'direction', COALESCE(v_trade.direction, v_trade.position_type),
      'entry_price', v_trade.entry_price,
      'exit_price', p_close_price,
      'lot_size', COALESCE(v_trade.lot_size, v_trade.position_size),
      'close_reason', p_close_reason,
      'goal_session_id', v_trade.goal_session_id
    )
  );

  -- Record in trade_history if not already done
  INSERT INTO trade_history (
    user_id,
    goal_trade_id,
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
    v_trade.user_id,
    p_trade_id,
    v_trade.symbol,
    COALESCE(v_trade.position_type, v_trade.direction),
    COALESCE(v_trade.lot_size, v_trade.position_size),
    v_trade.entry_price,
    p_close_price,
    v_trade.stop_loss,
    v_trade.take_profit,
    v_calculated_pnl,
    v_trade.opened_at,
    now(),
    p_close_reason,
    COALESCE(v_trade.confidence_score, 75),
    true,
    'goal_session'
  )
  ON CONFLICT (goal_trade_id) DO UPDATE
  SET
    exit_price = EXCLUDED.exit_price,
    profit_loss = EXCLUDED.profit_loss,
    closed_at = EXCLUDED.closed_at,
    close_reason = EXCLUDED.close_reason;

  -- Build result object
  v_result := jsonb_build_object(
    'success', true,
    'trade_id', p_trade_id,
    'pnl', v_calculated_pnl,
    'close_price', p_close_price,
    'balance_before', v_current_balance,
    'balance_after', v_new_balance,
    'close_reason', p_close_reason
  );

  RETURN v_result;
END;
$$;

-- Grant execute to authenticated users and service role
GRANT EXECUTE ON FUNCTION close_goal_session_trade TO authenticated, service_role;

-- Add comment documenting the fix
COMMENT ON FUNCTION close_goal_session_trade IS
  'Securely closes a goal session trade with full P&L calculation and balance updates.

   CRITICAL FIX 2025-12-11: Now updates user balance and creates transaction records,
   matching the behavior of manual trade closures (close_simulated_position_secure).

   This ensures consistent balance tracking across ALL trade types.

   Security: Uses SECURITY DEFINER to bypass RLS, but verifies user_id = auth.uid()';

-- ============================================================================
-- STEP 3: Create trigger for automatic balance updates (belt-and-suspenders)
-- ============================================================================

-- This trigger ensures balance updates even if closed via direct UPDATE
CREATE OR REPLACE FUNCTION auto_update_balance_on_goal_trade_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_balance numeric;
  v_new_balance numeric;
  v_transaction_exists boolean;
BEGIN
  -- Only process if status changed to 'closed' and profit_loss is set
  IF NEW.status = 'closed' AND OLD.status != 'closed' AND NEW.profit_loss IS NOT NULL THEN

    -- Check if transaction already exists (avoid duplicates)
    SELECT EXISTS(
      SELECT 1 FROM balance_transactions
      WHERE goal_trade_id = NEW.id
    ) INTO v_transaction_exists;

    IF NOT v_transaction_exists THEN
      -- Get current balance
      SELECT account_balance INTO v_current_balance
      FROM user_profiles
      WHERE id = NEW.user_id;

      -- Calculate new balance
      v_new_balance := v_current_balance + NEW.profit_loss;

      -- Update balance
      UPDATE user_profiles
      SET account_balance = v_new_balance,
          updated_at = now()
      WHERE id = NEW.user_id;

      -- Create transaction record
      INSERT INTO balance_transactions (
        user_id,
        transaction_type,
        amount,
        balance_before,
        balance_after,
        goal_trade_id,
        source_type,
        description,
        metadata
      ) VALUES (
        NEW.user_id,
        'trade_pnl',
        NEW.profit_loss,
        v_current_balance,
        v_new_balance,
        NEW.id,
        'goal_trade',
        format('Goal trade auto-closed: %s %s %s lots',
          NEW.symbol,
          COALESCE(NEW.direction, NEW.position_type),
          COALESCE(NEW.lot_size, NEW.position_size)
        ),
        jsonb_build_object(
          'symbol', NEW.symbol,
          'direction', COALESCE(NEW.direction, NEW.position_type),
          'entry_price', NEW.entry_price,
          'exit_price', NEW.exit_price,
          'close_reason', NEW.close_reason,
          'auto_trigger', true
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trigger_auto_balance_update_goal_trades ON goal_session_trades;

-- Create trigger
CREATE TRIGGER trigger_auto_balance_update_goal_trades
  AFTER UPDATE ON goal_session_trades
  FOR EACH ROW
  EXECUTE FUNCTION auto_update_balance_on_goal_trade_close();

COMMENT ON FUNCTION auto_update_balance_on_goal_trade_close IS
  'Automatically updates user balance when goal trade is closed.
   This is a safety net that catches any closes not done through close_goal_session_trade().
   Prevents duplicate transactions by checking if one already exists.';

-- ============================================================================
-- STEP 4: Add balance reconciliation admin function
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_reconcile_user_balance(p_user_id uuid)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_expected_balance numeric;
  v_current_balance numeric;
  v_discrepancy numeric;
  v_starting_balance numeric := 10000; -- Default starting balance
  v_total_manual_pnl numeric;
  v_total_goal_pnl numeric;
  v_total_adjustments numeric;
  v_result jsonb;
BEGIN
  -- Verify admin access
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Access denied: admin privileges required';
  END IF;

  -- Get current balance
  SELECT account_balance INTO v_current_balance
  FROM user_profiles
  WHERE id = p_user_id;

  IF v_current_balance IS NULL THEN
    RAISE EXCEPTION 'User % not found', p_user_id;
  END IF;

  -- Calculate total P&L from manual trades (simulated_positions)
  SELECT COALESCE(SUM(current_pnl), 0) INTO v_total_manual_pnl
  FROM simulated_positions
  WHERE user_id = p_user_id AND status = 'closed';

  -- Calculate total P&L from goal trades
  SELECT COALESCE(SUM(profit_loss), 0) INTO v_total_goal_pnl
  FROM goal_session_trades
  WHERE user_id = p_user_id AND status = 'closed' AND profit_loss IS NOT NULL;

  -- Calculate manual adjustments
  SELECT COALESCE(SUM(amount), 0) INTO v_total_adjustments
  FROM balance_transactions
  WHERE user_id = p_user_id
    AND transaction_type NOT IN ('trade_pnl');

  -- Calculate expected balance
  v_expected_balance := v_starting_balance + v_total_manual_pnl + v_total_goal_pnl + v_total_adjustments;
  v_discrepancy := v_current_balance - v_expected_balance;

  -- Build result
  v_result := jsonb_build_object(
    'user_id', p_user_id,
    'current_balance', v_current_balance,
    'expected_balance', v_expected_balance,
    'discrepancy', v_discrepancy,
    'breakdown', jsonb_build_object(
      'starting_balance', v_starting_balance,
      'manual_trades_pnl', v_total_manual_pnl,
      'goal_trades_pnl', v_total_goal_pnl,
      'manual_adjustments', v_total_adjustments
    ),
    'needs_correction', abs(v_discrepancy) > 0.01
  );

  RETURN v_result;
END;
$$;

-- Create function to fix balance discrepancies
CREATE OR REPLACE FUNCTION admin_fix_balance_discrepancy(p_user_id uuid)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_reconciliation jsonb;
  v_expected_balance numeric;
  v_current_balance numeric;
  v_discrepancy numeric;
BEGIN
  -- Verify admin access
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Access denied: admin privileges required';
  END IF;

  -- Get reconciliation data
  v_reconciliation := admin_reconcile_user_balance(p_user_id);

  v_current_balance := (v_reconciliation->>'current_balance')::numeric;
  v_expected_balance := (v_reconciliation->>'expected_balance')::numeric;
  v_discrepancy := (v_reconciliation->>'discrepancy')::numeric;

  -- Only fix if there's a discrepancy
  IF abs(v_discrepancy) > 0.01 THEN
    -- Update balance to correct value
    UPDATE user_profiles
    SET account_balance = v_expected_balance,
        updated_at = now()
    WHERE id = p_user_id;

    -- Log the correction
    INSERT INTO balance_transactions (
      user_id,
      transaction_type,
      amount,
      balance_before,
      balance_after,
      source_type,
      description,
      metadata
    ) VALUES (
      p_user_id,
      'trade_pnl',
      v_discrepancy * -1, -- Correction amount
      v_current_balance,
      v_expected_balance,
      'admin_adjustment',
      format('Admin balance reconciliation: corrected discrepancy of $%.2f', v_discrepancy),
      jsonb_build_object(
        'reconciliation_data', v_reconciliation,
        'corrected_by', auth.uid(),
        'correction_timestamp', now()
      )
    );

    RETURN jsonb_build_object(
      'success', true,
      'user_id', p_user_id,
      'old_balance', v_current_balance,
      'new_balance', v_expected_balance,
      'correction_amount', v_discrepancy * -1
    );
  ELSE
    RETURN jsonb_build_object(
      'success', true,
      'message', 'No correction needed - balance is accurate',
      'user_id', p_user_id,
      'balance', v_current_balance
    );
  END IF;
END;
$$;

-- Grant to authenticated users (admin check is in function)
GRANT EXECUTE ON FUNCTION admin_reconcile_user_balance TO authenticated;
GRANT EXECUTE ON FUNCTION admin_fix_balance_discrepancy TO authenticated;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'CRITICAL FIX APPLIED: Goal Trade Balance Updates';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';
  RAISE NOTICE '✅ balance_transactions enhanced with goal_trade_id and source_type';
  RAISE NOTICE '✅ close_goal_session_trade() now updates balance + creates transactions';
  RAISE NOTICE '✅ Auto-trigger created for safety net on direct updates';
  RAISE NOTICE '✅ Admin reconciliation functions added';
  RAISE NOTICE '';
  RAISE NOTICE 'IMPACT: All closed goal trades will now automatically update user balance!';
  RAISE NOTICE '';
  RAISE NOTICE 'Next Steps:';
  RAISE NOTICE '  1. Test by closing an AI goal trade';
  RAISE NOTICE '  2. Verify balance updates in Settings';
  RAISE NOTICE '  3. Check balance_transactions table for audit trail';
  RAISE NOTICE '  4. Run admin_reconcile_user_balance() to check historical data';
  RAISE NOTICE '=================================================================';
END $$;