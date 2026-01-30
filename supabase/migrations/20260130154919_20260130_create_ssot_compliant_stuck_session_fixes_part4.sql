/*
  # SSOT-Compliant Stuck Session Fixes - Part 4
  # (close_goal_session_trade - MOST CRITICAL)

  1. TradeClosureCoordinator - SSOT for trade closure + balance atomicity
  2. Three-stage process: Validate → Calculate P&L → Mutate (atomically)
  3. SAVEPOINT support for transaction-like behavior
  4. Retry mechanism for balance updates
  5. Comprehensive error logging with recovery path
  6. Governance audit of all closures and failures

  CRITICAL: This is THE authority for closing trades and updating balance.
  All other systems must call this function (TradeClosureCoordinator in services)
*/

-- Create table to track failed balance updates for retry
CREATE TABLE IF NOT EXISTS pending_balance_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL,
  session_id uuid NOT NULL,
  user_id uuid NOT NULL,
  pnl_value numeric(20, 8) NOT NULL,
  status text DEFAULT 'pending',
  attempted_at timestamptz,
  last_error text,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW(),

  CONSTRAINT valid_balance_update_status CHECK (status IN ('pending', 'failed', 'success'))
);

-- Enable RLS
ALTER TABLE pending_balance_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages pending balance updates"
  ON pending_balance_updates
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Admin can view pending balance updates"
  ON pending_balance_updates
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Fix 7: close_goal_session_trade - TradeClosureCoordinator (MOST CRITICAL)
CREATE OR REPLACE FUNCTION close_goal_session_trade(
  p_trade_id uuid,
  p_close_reason text DEFAULT 'manual_close',
  p_force_close boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_trade goal_session_trades;
  v_session goal_sessions;
  v_user_profile user_profiles;
  v_pnl_result jsonb;
  v_pnl_value numeric;
  v_close_price numeric;
  v_current_balance numeric;
  v_new_balance numeric;
  v_transaction_id uuid;
  v_error_context jsonb;
BEGIN
  -- SSOT AUTHORITY: TradeClosureCoordinator
  -- RESPONSIBILITY: Close trade AND update balance atomically
  -- CRITICAL: If either step fails, ENTIRE operation fails (no partial state)
  -- THREE STAGES: Validate → Calculate P&L → Mutate (atomically)

  -- STAGE 1: VALIDATE
  -- Lock trade row
  SELECT * INTO v_trade FROM goal_session_trades
  WHERE id = p_trade_id
  FOR UPDATE;

  IF v_trade IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Trade not found',
      'trade_id', p_trade_id
    );
  END IF;

  -- Validate trade is in closeable state
  IF v_trade.status NOT IN ('open', 'pending') AND NOT p_force_close THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Trade already closed with reason: %s', v_trade.close_reason),
      'status', v_trade.status,
      'trade_id', p_trade_id
    );
  END IF;

  -- Get session for context
  SELECT * INTO v_session FROM goal_sessions
  WHERE id = v_trade.session_id
  FOR UPDATE; -- Lock session too

  IF v_session IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Associated session not found',
      'session_id', v_trade.session_id
    );
  END IF;

  -- STAGE 2: CALCULATE P&L (before mutating anything)
  -- Get current price for calculation
  SELECT mid INTO v_close_price
  FROM realtime_prices
  WHERE symbol = v_trade.symbol
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_close_price IS NULL THEN
    v_close_price := v_trade.entry_price; -- Fallback to entry price if no market data
  END IF;

  -- Calculate P&L using universal calculator (single authority for P&L)
  v_pnl_result := calculate_pnl_universal(
    p_symbol => v_trade.symbol,
    p_entry_price => v_trade.entry_price,
    p_close_price => v_close_price,
    p_position_size => v_trade.position_size,
    p_direction => v_trade.direction
  );

  IF NOT (v_pnl_result->>'success')::boolean THEN
    -- P&L calculation failed - do NOT proceed with closure
    INSERT INTO governance_change_log (
      entity_type, entity_id, operation, error_message
    )
    VALUES (
      'goal_session_trades',
      p_trade_id,
      'close_goal_session_trade_FAILED_pnl_calc',
      'P&L calculation failed: ' || v_pnl_result->>'error'
    );

    RETURN jsonb_build_object(
      'success', false,
      'error', 'P&L calculation failed: ' || v_pnl_result->>'error',
      'trade_id', p_trade_id
    );
  END IF;

  v_pnl_value := (v_pnl_result->>'pnl_value')::numeric;

  -- STAGE 3: MUTATE (both trade AND balance, atomically)
  -- If either fails, both must be rolled back

  -- Update trade to closed state
  UPDATE goal_session_trades SET
    status = 'closed',
    close_price = v_close_price,
    pnl = v_pnl_value,
    close_reason = p_close_reason,
    closed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_trade_id
  RETURNING id INTO v_transaction_id;

  -- Update user balance
  BEGIN
    SELECT credit_balance INTO v_current_balance
    FROM user_profiles
    WHERE id = v_session.user_id
    FOR UPDATE; -- Lock user profile

    IF v_current_balance IS NULL THEN
      -- User profile missing - force close with zero balance change
      IF NOT p_force_close THEN
        RAISE EXCEPTION 'User profile missing and force_close not set';
      END IF;
      v_new_balance := 0;
    ELSE
      v_new_balance := v_current_balance + v_pnl_value;
    END IF;

    UPDATE user_profiles SET
      credit_balance = v_new_balance,
      updated_at = NOW()
    WHERE id = v_session.user_id;

  EXCEPTION WHEN OTHERS THEN
    -- Balance update failed - create pending update record for retry
    INSERT INTO pending_balance_updates (
      trade_id, session_id, user_id, pnl_value, status, last_error
    )
    VALUES (
      p_trade_id,
      v_trade.session_id,
      v_session.user_id,
      v_pnl_value,
      'pending',
      SQLERRM
    );

    -- Rollback trade closure to maintain consistency
    UPDATE goal_session_trades SET
      status = 'open',
      close_price = NULL,
      pnl = NULL,
      close_reason = NULL,
      closed_at = NULL,
      updated_at = NOW()
    WHERE id = p_trade_id;

    -- Log failure for admin review
    INSERT INTO governance_change_log (
      entity_type, entity_id, operation, error_message
    )
    VALUES (
      'goal_session_trades',
      p_trade_id,
      'close_goal_session_trade_FAILED_balance_update',
      'Balance update failed: ' || SQLERRM || ' - Created pending update for retry'
    );

    RETURN jsonb_build_object(
      'success', false,
      'error', 'Balance update failed - trade marked for retry',
      'trade_id', p_trade_id,
      'pnl_calculated', v_pnl_value,
      'retry_pending', true
    );
  END;

  -- SUCCESS: Both trade and balance updated
  -- Create governance audit trail
  INSERT INTO governance_change_log (
    entity_type, entity_id, operation, old_value, new_value,
    reason, metadata
  )
  VALUES (
    'goal_session_trades',
    p_trade_id,
    'status_transition',
    jsonb_build_object('status', v_trade.status, 'pnl', 0),
    jsonb_build_object(
      'status', 'closed',
      'close_reason', p_close_reason,
      'pnl', v_pnl_value,
      'close_price', v_close_price
    ),
    'trade_closure_complete',
    jsonb_build_object(
      'entry_price', v_trade.entry_price,
      'close_price', v_close_price,
      'position_size', v_trade.position_size,
      'direction', v_trade.direction,
      'balance_before', v_current_balance,
      'balance_after', v_new_balance
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'trade_id', p_trade_id,
    'close_reason', p_close_reason,
    'pnl', v_pnl_value,
    'close_price', v_close_price,
    'new_balance', v_new_balance
  );

EXCEPTION WHEN OTHERS THEN
  -- Catch-all for any unexpected errors
  INSERT INTO governance_change_log (
    entity_type, entity_id, operation, error_message
  )
  VALUES (
    'goal_session_trades',
    p_trade_id,
    'close_goal_session_trade_FAILED_unexpected',
    'Unexpected error during trade closure: ' || SQLERRM
  );

  RETURN jsonb_build_object(
    'success', false,
    'error', 'Unexpected error during trade closure: ' || SQLERRM,
    'error_code', SQLSTATE,
    'trade_id', p_trade_id
  );
END;
$$;

-- Function to retry failed balance updates
CREATE OR REPLACE FUNCTION retry_pending_balance_updates()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pending_update pending_balance_updates;
  v_current_balance numeric;
  v_new_balance numeric;
  v_retry_count integer := 0;
  v_failed_cursor CURSOR FOR
    SELECT *
    FROM pending_balance_updates
    WHERE status = 'pending'
    AND EXTRACT(EPOCH FROM (NOW() - created_at)) > 60 -- Retry after 60 seconds
    FOR UPDATE;
BEGIN
  -- SSOT AUTHORITY: TradeClosureCoordinator
  -- RESPONSIBILITY: Retry failed balance updates
  -- CALLED BY: Scheduled job or manual intervention

  FOR v_pending_update IN v_failed_cursor LOOP
    BEGIN
      -- Get current balance
      SELECT credit_balance INTO v_current_balance
      FROM user_profiles
      WHERE id = v_pending_update.user_id
      FOR UPDATE;

      IF v_current_balance IS NULL THEN
        v_current_balance := 0;
      END IF;

      v_new_balance := v_current_balance + v_pending_update.pnl_value;

      -- Try to update balance
      UPDATE user_profiles SET
        credit_balance = v_new_balance,
        updated_at = NOW()
      WHERE id = v_pending_update.user_id;

      -- Mark as successful
      UPDATE pending_balance_updates SET
        status = 'success',
        attempted_at = NOW(),
        updated_at = NOW()
      WHERE id = v_pending_update.id;

      v_retry_count := v_retry_count + 1;

      -- Audit success
      INSERT INTO governance_change_log (
        entity_type, entity_id, operation, reason, metadata
      )
      VALUES (
        'user_profiles',
        v_pending_update.user_id,
        'balance_update_retry_success',
        'Retried pending balance update',
        jsonb_build_object(
          'pnl_applied', v_pending_update.pnl_value,
          'new_balance', v_new_balance
        )
      );

    EXCEPTION WHEN OTHERS THEN
      -- Mark as failed and log
      UPDATE pending_balance_updates SET
        status = 'failed',
        last_error = SQLERRM,
        attempted_at = NOW(),
        updated_at = NOW()
      WHERE id = v_pending_update.id;

      INSERT INTO governance_change_log (
        entity_type, entity_id, operation, error_message
      )
      VALUES (
        'user_profiles',
        v_pending_update.user_id,
        'balance_update_retry_FAILED',
        'Retry failed: ' || SQLERRM
      );
    END;
  END LOOP;

  RAISE NOTICE 'Retried % pending balance updates', v_retry_count;
  RETURN v_retry_count;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Exception in retry_pending_balance_updates: %', SQLERRM;
  RETURN 0;
END;
$$;
