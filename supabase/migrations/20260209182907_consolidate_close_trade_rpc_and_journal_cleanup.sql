/*
  # Consolidate close_goal_session_trade RPC - SSOT Compliance

  ## Root Cause (Forensic Evidence)
  Three conflicting overloads of close_goal_session_trade existed:
    1. (uuid, text, boolean) - Legacy function without event emission
    2. (uuid, numeric, text, uuid) - New function with event emission
    3. (uuid, numeric, text, uuid, boolean) - Old function with force_close, no events

  All callers passed p_force_close (5 params) which matched overload #3 (OID 213461).
  This old function lacked event emission and had an outdated close_reason enum that
  rejected 'take_profit_2', returning {success:false} instead of raising an exception.
  The autonomous monitor only checked for PostgreSQL errors (not data.success),
  so it reported success while the trade remained open for 278 consecutive cycles.

  ## Changes
  1. Drop ALL existing overloads of close_goal_session_trade
  2. Create single unified function with:
     - Event emission (from new function)
     - Force close support (from old function)
     - Extended close_reason enum including take_profit_2
     - Optional p_closed_at for timestamp accuracy (server-side closures)
  3. Clean duplicate journal entries (keep oldest per trade_id)
     - Also cleans referencing rows in trade_accuracy_tracking
  4. Add UNIQUE constraint on ai_trade_journal(trade_id) to prevent future duplicates

  ## Security
  - SECURITY DEFINER with restricted search_path
  - User ownership verification via auth.uid()
  - Service role bypass for server-side operations
  - RLS unaffected (function uses SECURITY DEFINER)
*/

-- Step 1: Drop ALL existing overloads to eliminate routing conflicts
DROP FUNCTION IF EXISTS close_goal_session_trade(uuid, text, boolean) CASCADE;
DROP FUNCTION IF EXISTS close_goal_session_trade(uuid, numeric, text, uuid) CASCADE;
DROP FUNCTION IF EXISTS close_goal_session_trade(uuid, numeric, text, uuid, boolean) CASCADE;
DROP FUNCTION IF EXISTS close_goal_session_trade(uuid, numeric, text, uuid, boolean, timestamptz) CASCADE;

-- Step 2: Create single unified function
CREATE OR REPLACE FUNCTION close_goal_session_trade(
  p_trade_id uuid,
  p_close_price numeric,
  p_close_reason text DEFAULT 'manual',
  p_goal_session_id uuid DEFAULT NULL,
  p_force_close boolean DEFAULT false,
  p_closed_at timestamptz DEFAULT NULL
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
  v_price_diff numeric;
  v_pip_value numeric;
  v_result jsonb;
  v_rows_updated integer;
  v_event_id uuid;
  v_actual_closed_at timestamptz;
BEGIN
  v_actual_closed_at := COALESCE(p_closed_at, now());

  IF p_close_reason NOT IN (
    'manual', 'stop_loss', 'take_profit', 'take_profit_1', 'take_profit_2',
    'goal_achieved', 'timeout', 'weekend_protection', 'force_closed', 'goal_expired',
    'session_ended', 'risk_limit', 'trailing_stop', 'holiday_closure', 'market_closed'
  ) THEN
    RAISE EXCEPTION 'Invalid close_reason: %', p_close_reason;
  END IF;

  RAISE LOG '[close_goal_session_trade] Starting close for trade % (force: %, reason: %)', p_trade_id, p_force_close, p_close_reason;

  IF p_force_close THEN
    IF p_goal_session_id IS NOT NULL THEN
      SELECT * INTO v_trade FROM goal_session_trades
      WHERE id = p_trade_id
        AND goal_session_id = p_goal_session_id
        AND status != 'closed';
    ELSE
      SELECT * INTO v_trade FROM goal_session_trades
      WHERE id = p_trade_id
        AND status != 'closed';
    END IF;
  ELSE
    IF p_goal_session_id IS NOT NULL THEN
      SELECT * INTO v_trade FROM goal_session_trades
      WHERE id = p_trade_id
        AND goal_session_id = p_goal_session_id
        AND status IN ('open', 'pending', 'soft_closing');
    ELSE
      SELECT * INTO v_trade FROM goal_session_trades
      WHERE id = p_trade_id
        AND status IN ('open', 'pending', 'soft_closing');
    END IF;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[close_goal_session_trade] Trade % not found or already closed', p_trade_id;
  END IF;

  IF v_trade.user_id != auth.uid() AND (auth.jwt() ->> 'role') != 'service_role' THEN
    RAISE EXCEPTION '[close_goal_session_trade] Access denied for trade %', p_trade_id;
  END IF;

  v_price_diff := p_close_price - v_trade.entry_price;

  IF v_trade.symbol LIKE '%JPY%' THEN
    v_pip_value := (v_price_diff / 0.01) * (COALESCE(v_trade.lot_size, v_trade.position_size, 0.01) * 1000);
  ELSIF v_trade.symbol IN ('US30', 'NAS100', 'SPX500', 'DJI', 'NDX') OR v_trade.symbol LIKE 'US30%' OR v_trade.symbol LIKE 'NAS100%' OR v_trade.symbol LIKE 'SPX500%' THEN
    v_pip_value := v_price_diff * COALESCE(v_trade.lot_size, v_trade.position_size, 0.01);
  ELSIF v_trade.symbol LIKE '%XAU%' OR v_trade.symbol LIKE '%GOLD%' THEN
    v_pip_value := (v_price_diff / 0.01) * (COALESCE(v_trade.lot_size, v_trade.position_size, 0.01) * 100);
  ELSIF v_trade.symbol LIKE '%BTC%' OR v_trade.symbol LIKE '%ETH%' OR v_trade.symbol LIKE '%CRYPTO%' THEN
    v_pip_value := v_price_diff * COALESCE(v_trade.lot_size, v_trade.position_size, 0.01);
  ELSIF v_trade.symbol LIKE '%XAG%' OR v_trade.symbol LIKE '%SILVER%' THEN
    v_pip_value := (v_price_diff / 0.001) * (COALESCE(v_trade.lot_size, v_trade.position_size, 0.01) * 50);
  ELSE
    v_pip_value := (v_price_diff / 0.0001) * (COALESCE(v_trade.lot_size, v_trade.position_size, 0.01) * 10);
  END IF;

  IF v_trade.direction = 'buy' OR v_trade.position_type = 'buy' THEN
    v_calculated_pnl := v_pip_value;
  ELSE
    v_calculated_pnl := -v_pip_value;
  END IF;

  v_calculated_pnl := ROUND(v_calculated_pnl, 2);

  RAISE LOG '[close_goal_session_trade] Symbol: %, Entry: %, Exit: %, Lot: %, PNL: $%',
    v_trade.symbol, v_trade.entry_price, p_close_price, COALESCE(v_trade.lot_size, v_trade.position_size), v_calculated_pnl;

  UPDATE goal_session_trades
  SET
    status = 'closed',
    exit_price = p_close_price,
    closed_at = v_actual_closed_at,
    close_reason = p_close_reason,
    current_price = p_close_price,
    profit_loss = v_calculated_pnl,
    current_pnl = v_calculated_pnl,
    updated_at = now(),
    last_processed_at = NULL,
    post_processing_status = 'pending'
  WHERE id = p_trade_id;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RAISE EXCEPTION '[close_goal_session_trade] Failed to update trade %', p_trade_id;
  END IF;

  SELECT account_balance INTO v_current_balance FROM user_profiles WHERE id = v_trade.user_id;

  IF v_current_balance IS NULL THEN
    RAISE EXCEPTION '[close_goal_session_trade] User profile not found for user %', v_trade.user_id;
  END IF;

  v_new_balance := v_current_balance + v_calculated_pnl;

  UPDATE user_profiles
  SET account_balance = v_new_balance, updated_at = now()
  WHERE id = v_trade.user_id;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RAISE EXCEPTION '[close_goal_session_trade] Failed to update balance for user %', v_trade.user_id;
  END IF;

  SELECT account_balance INTO v_current_balance FROM user_profiles WHERE id = v_trade.user_id;

  IF v_current_balance != v_new_balance THEN
    RAISE EXCEPTION '[close_goal_session_trade] Balance verification failed for user %', v_trade.user_id;
  END IF;

  RAISE LOG '[close_goal_session_trade] Balance updated: $% -> $%',
    v_current_balance - v_calculated_pnl, v_current_balance;

  INSERT INTO trade_closure_events (
    trade_id, user_id, goal_session_id, symbol, direction,
    close_price, close_reason, pnl,
    last_processed_at, post_processing_status, event_triggered_by
  ) VALUES (
    v_trade.id, v_trade.user_id, v_trade.goal_session_id, v_trade.symbol,
    COALESCE(v_trade.direction, v_trade.position_type),
    p_close_price, p_close_reason, v_calculated_pnl,
    NULL, 'pending', 'rpc'
  ) RETURNING id INTO v_event_id;

  RAISE LOG '[close_goal_session_trade] Event emitted: %', v_event_id;

  v_result := jsonb_build_object(
    'id', v_trade.id,
    'symbol', v_trade.symbol,
    'direction', COALESCE(v_trade.direction, v_trade.position_type),
    'entry_price', v_trade.entry_price,
    'exit_price', p_close_price,
    'profit_loss', v_calculated_pnl,
    'close_reason', p_close_reason,
    'balance_before', v_current_balance - v_calculated_pnl,
    'balance_after', v_current_balance,
    'event_id', v_event_id,
    'closed_at', v_actual_closed_at,
    'stop_loss', v_trade.stop_loss,
    'take_profit', v_trade.take_profit
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION close_goal_session_trade(uuid, numeric, text, uuid, boolean, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION close_goal_session_trade(uuid, numeric, text, uuid, boolean, timestamptz) TO service_role;

-- Step 3: Clean duplicate journal entries (keep oldest per trade_id)
-- Must clean referencing tables first (trade_accuracy_tracking has FK to journal)
DO $$
DECLARE
  v_deleted_tracking integer := 0;
  v_deleted_journals integer := 0;
BEGIN
  DELETE FROM trade_accuracy_tracking
  WHERE journal_entry_id IN (
    SELECT id FROM (
      SELECT id,
             ROW_NUMBER() OVER (PARTITION BY trade_id ORDER BY created_at ASC) AS rn
      FROM ai_trade_journal
      WHERE trade_id IS NOT NULL
    ) dupes
    WHERE rn > 1
  );
  GET DIAGNOSTICS v_deleted_tracking = ROW_COUNT;

  WITH duplicates AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY trade_id ORDER BY created_at ASC) AS rn
    FROM ai_trade_journal
    WHERE trade_id IS NOT NULL
  )
  DELETE FROM ai_trade_journal
  WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);
  GET DIAGNOSTICS v_deleted_journals = ROW_COUNT;

  RAISE LOG '[Migration] Cleaned % duplicate tracking rows and % duplicate journal entries', v_deleted_tracking, v_deleted_journals;
END $$;

-- Step 4: Add UNIQUE constraint on ai_trade_journal(trade_id) to prevent future duplicates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_trade_journal_trade_id_unique'
  ) THEN
    ALTER TABLE ai_trade_journal
    ADD CONSTRAINT ai_trade_journal_trade_id_unique UNIQUE (trade_id);
  END IF;
END $$;