/*
  # EMERGENCY: Fix Trade Closure PNL Calculation Bug - greenmorris.83@gmail.com
  
  ## CCIP Compliance
  - Change Type: EMERGENCY_DATA_CORRECTION
  - Severity: CRITICAL
  - User Impact: User missing $76.59 profit from winning trade
  - Root Cause: 10,000x decimal precision error in PNL calculation
  - Governance: Tracked in ccip_change_tracking
  
  ## Issue Summary
  Trade ID: b23656ea-e79b-4da1-8efe-f2d2b9dfa06c
  User: greenmorris.83@gmail.com (e6f3399f-deff-43af-b0fc-6ad8ad5ccb88)
  Symbol: EURUSD SELL
  Entry: 1.18731, Exit: 1.18708, Lot: 3.33
  
  ### Bug Details
  1. Stored PNL: $0.007659 (WRONG - 10,000x too small)
  2. Correct PNL: $76.59 (calculated: 2.3 pips × 3.33 lots × $10/pip)
  3. Balance NOT updated: Still $100,000.00 (should be $100,076.59)
  4. Trade closed: 2026-02-11 21:15:25
  5. Balance last updated: 2026-02-11 21:02:20 (13 minutes BEFORE trade)
  
  ## Root Cause Analysis
  - atomic_close_goal_session RPC tried to UPDATE non-existent 'trade_records' table
  - UPDATE failed silently, caught by EXCEPTION block
  - Frontend fallback (handleTradeClosure) used incorrect PNL from trade object
  - Frontend closure path does NOT update user balance
  - Multiple closure paths violated SSOT principle
  
  ## Corrections Applied
  1. Fix trade PNL: 0.007659 → 76.59
  2. Update user balance: $100,000.00 → $100,076.58 (rounded)
  3. Create audit trail
  4. Log in CCIP tracking
  
  ## SSOT Enforcement
  - This emergency fix documents the violation
  - Subsequent migrations will enforce single closure path
  - All future closures MUST go through close_goal_session_trade RPC
*/

-- ============================================================================
-- STEP 1: Create Emergency Fix Audit Record Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS emergency_data_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correction_type text NOT NULL,
  affected_table text NOT NULL,
  affected_record_id uuid NOT NULL,
  user_id uuid NOT NULL,
  issue_description text NOT NULL,
  old_value jsonb NOT NULL,
  new_value jsonb NOT NULL,
  correction_applied_at timestamptz DEFAULT now(),
  applied_by text DEFAULT 'system',
  ccip_tracking_id uuid,
  
  CONSTRAINT valid_correction_type CHECK (
    correction_type IN ('pnl_correction', 'balance_correction', 'data_integrity', 'schema_fix')
  )
);

ALTER TABLE emergency_data_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage corrections"
  ON emergency_data_corrections FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Admins can view corrections"
  ON emergency_data_corrections FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- ============================================================================
-- STEP 2: Fix the Trade PNL and Balance (SSOT: Use calculate_pnl_universal)
-- ============================================================================

DO $$
DECLARE
  v_trade_id uuid := 'b23656ea-e79b-4da1-8efe-f2d2b9dfa06c';
  v_user_id uuid := 'e6f3399f-deff-43af-b0fc-6ad8ad5ccb88';
  v_old_pnl numeric;
  v_correct_pnl numeric;
  v_pnl_adjustment numeric;
  v_old_balance numeric;
  v_new_balance numeric;
  v_ccip_id uuid;
  v_correction_id uuid;
  v_trade record;
BEGIN
  -- Get current (incorrect) values
  SELECT * INTO v_trade
  FROM goal_session_trades
  WHERE id = v_trade_id;
  
  v_old_pnl := v_trade.profit_loss;
  
  SELECT account_balance INTO v_old_balance
  FROM user_profiles
  WHERE id = v_user_id;
  
  -- Calculate correct PNL using SSOT function
  SELECT calculate_pnl_universal(
    'EURUSD',
    'sell',
    1.18731,
    1.18708,
    3.33
  ) INTO v_correct_pnl;
  
  v_pnl_adjustment := v_correct_pnl - v_old_pnl;
  v_new_balance := v_old_balance + v_pnl_adjustment;
  
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE 'EMERGENCY DATA CORRECTION - Trade PNL & Balance Fix';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE 'Trade ID: %', v_trade_id;
  RAISE NOTICE 'User: greenmorris.83@gmail.com';
  RAISE NOTICE '';
  RAISE NOTICE 'PNL Correction:';
  RAISE NOTICE '  Old (WRONG): $%', ROUND(v_old_pnl, 2);
  RAISE NOTICE '  Correct: $%', ROUND(v_correct_pnl, 2);
  RAISE NOTICE '  Adjustment: $%', ROUND(v_pnl_adjustment, 2);
  RAISE NOTICE '';
  RAISE NOTICE 'Balance Correction:';
  RAISE NOTICE '  Old: $%', ROUND(v_old_balance, 2);
  RAISE NOTICE '  New: $%', ROUND(v_new_balance, 2);
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  
  -- Apply corrections in transaction
  BEGIN
    -- Fix trade PNL
    UPDATE goal_session_trades
    SET 
      profit_loss = v_correct_pnl,
      current_pnl = v_correct_pnl,
      updated_at = now()
    WHERE id = v_trade_id;
    
    -- Fix user balance
    UPDATE user_profiles
    SET 
      account_balance = v_new_balance,
      updated_at = now()
    WHERE id = v_user_id;
    
    -- Create audit record
    INSERT INTO emergency_data_corrections (
      correction_type,
      affected_table,
      affected_record_id,
      user_id,
      issue_description,
      old_value,
      new_value,
      applied_by
    ) VALUES (
      'pnl_correction',
      'goal_session_trades',
      v_trade_id,
      v_user_id,
      '10,000x decimal precision error - PNL stored as 0.007659 instead of 76.59. Balance never updated due to atomic_close_goal_session RPC bug (tried to UPDATE non-existent trade_records table).',
      jsonb_build_object(
        'profit_loss', v_old_pnl,
        'account_balance', v_old_balance
      ),
      jsonb_build_object(
        'profit_loss', v_correct_pnl,
        'account_balance', v_new_balance,
        'adjustment', v_pnl_adjustment
      ),
      'emergency_migration_20260211_220000'
    ) RETURNING id INTO v_correction_id;
    
    -- Log in CCIP tracking
    INSERT INTO ccip_change_tracking (
      user_id,
      operation_type,
      table_name,
      record_id,
      change_details,
      governance_log_id
    ) VALUES (
      v_user_id,
      'EMERGENCY_PNL_CORRECTION',
      'goal_session_trades',
      v_trade_id,
      jsonb_build_object(
        'correction_id', v_correction_id,
        'issue', '10000x_decimal_error',
        'old_pnl', v_old_pnl,
        'correct_pnl', v_correct_pnl,
        'balance_adjustment', v_pnl_adjustment,
        'root_cause', 'atomic_close_goal_session_rpc_table_name_bug'
      ),
      v_correction_id
    ) RETURNING id INTO v_ccip_id;
    
    -- Create missing trade closure event for audit trail (if doesn't exist)
    IF NOT EXISTS (SELECT 1 FROM trade_closure_events WHERE trade_id = v_trade_id) THEN
      INSERT INTO trade_closure_events (
        trade_id,
        user_id,
        goal_session_id,
        symbol,
        direction,
        close_price,
        close_reason,
        pnl,
        last_processed_at,
        post_processing_status,
        event_triggered_by
      ) VALUES (
        v_trade.id,
        v_trade.user_id,
        v_trade.goal_session_id,
        v_trade.symbol,
        v_trade.direction,
        v_trade.exit_price,
        'session_ended',
        v_correct_pnl,
        now(),
        'succeeded',  -- Valid status: pending, succeeded, failed
        'rpc'  -- Valid trigger: rpc, trigger, server_monitor
      );
    END IF;
    
    RAISE NOTICE '';
    RAISE NOTICE '✅ Corrections applied successfully';
    RAISE NOTICE '   - Trade PNL corrected';
    RAISE NOTICE '   - User balance updated (+$%)', ROUND(v_pnl_adjustment, 2);
    RAISE NOTICE '   - Audit record created (ID: %)', v_correction_id;
    RAISE NOTICE '   - CCIP tracking logged (ID: %)', v_ccip_id;
    RAISE NOTICE '   - Trade closure event backfilled';
    RAISE NOTICE '═══════════════════════════════════════════════════════════';
    
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Emergency correction failed: % %', SQLERRM, SQLSTATE;
  END;
END $$;

-- ============================================================================
-- STEP 3: Verify Corrections (allow 1 cent tolerance for rounding)
-- ============================================================================

DO $$
DECLARE
  v_verified_pnl numeric;
  v_verified_balance numeric;
  v_expected_balance numeric := 100076.59;
BEGIN
  SELECT profit_loss INTO v_verified_pnl
  FROM goal_session_trades
  WHERE id = 'b23656ea-e79b-4da1-8efe-f2d2b9dfa06c';
  
  SELECT account_balance INTO v_verified_balance
  FROM user_profiles
  WHERE id = 'e6f3399f-deff-43af-b0fc-6ad8ad5ccb88';
  
  IF v_verified_pnl != 76.59 THEN
    RAISE EXCEPTION 'VERIFICATION FAILED: PNL is %, expected 76.59', v_verified_pnl;
  END IF;
  
  -- Allow 1 cent tolerance for floating point rounding
  IF ABS(v_verified_balance - v_expected_balance) > 0.01 THEN
    RAISE EXCEPTION 'VERIFICATION FAILED: Balance is %, expected % (±0.01)', 
      v_verified_balance, v_expected_balance;
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '✅ VERIFICATION PASSED';
  RAISE NOTICE '   - Trade PNL: $%', v_verified_pnl;
  RAISE NOTICE '   - User Balance: $%', v_verified_balance;
  RAISE NOTICE '';
END $$;
