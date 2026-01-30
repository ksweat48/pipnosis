/**
 * CCIP Critical Financial Correction - Fix XAUUSD P&L Underpayment
 *
 * CCIP VERSION: 2026-01-31-001
 * PRIORITY: CRITICAL - Financial Correction Required
 * AFFECTED USER: oratio89@gmail.com
 * FINANCIAL IMPACT: User underpaid $319.84
 *
 * ROOT CAUSE: Emergency migration used 10x multiplier instead of 100x
 * FIX: Update constraint + direct P&L correction
 */

-- =============================================================================
-- STEP 1: Update Constraint
-- =============================================================================

DO $$
BEGIN
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE 'CCIP-2026-01-31-001: XAUUSD P&L Underpayment Fix';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '';
  RAISE NOTICE 'STEP 1: Updating constraint to allow realistic gold moves...';
END $$;

ALTER TABLE goal_session_trades
DROP CONSTRAINT IF EXISTS check_xauusd_pnl_reasonable;

ALTER TABLE goal_session_trades
ADD CONSTRAINT check_xauusd_pnl_reasonable
CHECK (
  symbol != 'XAUUSD' OR
  ABS(profit_loss) <= (lot_size * 100000)
);

DO $$
BEGIN
  RAISE NOTICE '✅ Constraint updated:';
  RAISE NOTICE '   Old limit: lot_size * 5000 (max 50 pips)';
  RAISE NOTICE '   New limit: lot_size * 100000 (max 1000 pips)';
  RAISE NOTICE '   Allows realistic gold volatility while catching bugs';
  RAISE NOTICE '';
END $$;

-- =============================================================================
-- STEP 2: Direct P&L and Balance Correction
-- =============================================================================

DO $$
DECLARE
  v_trade_id UUID := 'f2f0bc4f-9d58-4cef-b217-338ed5a64813'::UUID;
  v_user_id UUID;
  v_session_id UUID;
  v_old_pnl NUMERIC;
  v_correct_pnl NUMERIC := 355.38;
  v_correction NUMERIC;
  v_old_balance NUMERIC;
  v_new_balance NUMERIC;
BEGIN
  RAISE NOTICE 'STEP 2: Correcting P&L and balance...';
  RAISE NOTICE '';

  -- Get trade details
  SELECT
    user_id,
    goal_session_id,
    profit_loss
  INTO
    v_user_id,
    v_session_id,
    v_old_pnl
  FROM goal_session_trades
  WHERE id = v_trade_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trade not found';
  END IF;

  v_correction := v_correct_pnl - v_old_pnl;

  SELECT account_balance INTO v_old_balance
  FROM user_profiles
  WHERE id = v_user_id;

  v_new_balance := v_old_balance + v_correction;

  RAISE NOTICE '📋 Before Correction:';
  RAISE NOTICE '   Wrong P&L: $%', v_old_pnl;
  RAISE NOTICE '   Balance: $%', v_old_balance;
  RAISE NOTICE '';
  RAISE NOTICE '💰 Correction:';
  RAISE NOTICE '   Correct P&L: $%', v_correct_pnl;
  RAISE NOTICE '   Adjustment: +$%', v_correction;
  RAISE NOTICE '   New Balance: $%', v_new_balance;
  RAISE NOTICE '';

  -- Update trade P&L
  UPDATE goal_session_trades
  SET
    profit_loss = v_correct_pnl,
    updated_at = NOW()
  WHERE id = v_trade_id;

  -- Update user balance
  UPDATE user_profiles
  SET
    account_balance = v_new_balance,
    updated_at = NOW()
  WHERE id = v_user_id;

  -- Update session progress
  UPDATE goal_sessions
  SET
    current_progress = COALESCE(current_progress, 0) + v_correction,
    updated_at = NOW()
  WHERE id = v_session_id;

  RAISE NOTICE '✅ Correction applied';
  RAISE NOTICE '';

END $$;

-- =============================================================================
-- STEP 3: Governance Audit
-- =============================================================================

DO $$
DECLARE
  v_trade_id UUID := 'f2f0bc4f-9d58-4cef-b217-338ed5a64813'::UUID;
  v_user_id UUID;
BEGIN
  RAISE NOTICE 'STEP 3: Creating governance audit trail...';

  SELECT user_id INTO v_user_id
  FROM goal_session_trades
  WHERE id = v_trade_id;

  INSERT INTO governance_change_log (
    entity_type,
    entity_id,
    operation,
    old_value,
    new_value,
    reason,
    requester_id,
    metadata
  ) VALUES (
    'goal_session_trades',
    v_trade_id,
    'ccip_migration_applied',
    jsonb_build_object(
      'pnl', 35.54,
      'multiplier', 10
    ),
    jsonb_build_object(
      'pnl', 355.38,
      'multiplier', 100
    ),
    'CCIP-2026-01-31-001: Corrected XAUUSD P&L underpayment (+$319.84)',
    v_user_id,
    jsonb_build_object(
      'ccip_version', '2026-01-31-001',
      'user_underpaid', 319.84,
      'root_cause', 'Emergency migration used 10x instead of 100x',
      'fix', 'Updated constraint + direct P&L correction',
      'lesson', 'Constraints validate, SSOT dictates'
    )
  );

  RAISE NOTICE '✅ Audit trail created';
  RAISE NOTICE '';

END $$;

-- =============================================================================
-- STEP 4: Verification
-- =============================================================================

DO $$
DECLARE
  v_trade_id UUID := 'f2f0bc4f-9d58-4cef-b217-338ed5a64813'::UUID;
  v_pnl NUMERIC;
  v_balance NUMERIC;
  v_entry NUMERIC;
  v_exit NUMERIC;
  v_lot_size NUMERIC;
  v_multiplier NUMERIC;
BEGIN
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE 'VERIFICATION';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '';

  SELECT
    t.profit_loss,
    t.entry_price,
    t.exit_price,
    t.lot_size,
    up.account_balance
  INTO
    v_pnl,
    v_entry,
    v_exit,
    v_lot_size,
    v_balance
  FROM goal_session_trades t
  JOIN user_profiles up ON t.user_id = up.id
  WHERE t.id = v_trade_id;

  v_multiplier := ROUND(v_pnl / NULLIF(ABS(v_entry - v_exit) * v_lot_size, 0), 0);

  RAISE NOTICE 'Trade ID: %', v_trade_id;
  RAISE NOTICE 'P&L: $% (multiplier: %x)', v_pnl, v_multiplier;
  RAISE NOTICE 'User Balance: $%', v_balance;
  RAISE NOTICE '';

  IF ABS(v_pnl - 355.38) < 1.0 AND v_multiplier = 100 THEN
    RAISE NOTICE '✅ SUCCESS!';
    RAISE NOTICE '   ✓ P&L corrected to $355.38 (100x SSOT multiplier)';
    RAISE NOTICE '   ✓ Balance corrected to $%', v_balance;
    RAISE NOTICE '   ✓ User received $319.84 underpayment correction';
  ELSE
    RAISE WARNING '❌ Failed: P&L=$%, Multiplier=%x', v_pnl, v_multiplier;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE 'CCIP-2026-01-31-001: COMPLETE';
  RAISE NOTICE 'Underpayment of $319.84 corrected';
  RAISE NOTICE 'Constraint updated to allow realistic gold moves';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

END $$;
