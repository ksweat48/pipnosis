/*
  # Trade Closure Modal Creation - SSOT Architecture Fix

  ## Critical Production Issue
  **Problem**: Trades close via autonomous-position-monitor but NO modal appears
  - User hits SL/TP → autonomous monitor closes trade → NO user decision modal
  - Session stuck in 'system_stopped' instead of 'awaiting_continuation'
  - User has no control over session continuation

  ## Root Cause
  Modal creation logic was in frontend trade-closure-coordinator.ts which NEVER executes:
  - autonomous-position-monitor.ts (Netlify function) closes trades every 5 seconds
  - Calls close_goal_session_trade RPC directly (bypasses frontend)
  - RPC only closes trade + updates balance (no modal, no session transition)

  ## SSOT Solution
  Move modal creation INTO the close_goal_session_trade RPC function:
  - RPC becomes single authority for: trade closure + balance + modal + session state
  - Works regardless of who calls it (autonomous monitor, frontend, admin)
  - Database enforces governance (no system_stopped without modal)

  ## CCIP Compliance
  ✅ Correctness: RPC is SSOT for all trade closure side effects
  ✅ Completeness: Handles all closure paths (SL/TP/manual/force)
  ✅ Immutability: Modal creation is atomic with trade closure
  ✅ Provenance: Clear audit trail of closures and modal creation
  ✅ Intelligent Degradation: Modal failure logged but doesn't block closure

  ## Governance Principles
  - Engines validate (RPC validates close_reason)
  - Alpha decides (via close_reason parameter)
  - Trades degrade intelligently (modal failure logged, not blocked)
  - No silent mutations (all state changes explicit)
*/

-- ============================================================================
-- STEP 1: Add valid close reasons for TP1/TP2
-- ============================================================================

DO $$
BEGIN
  -- Drop and recreate with new values (includes force_closed for existing data)
  ALTER TABLE goal_session_trades DROP CONSTRAINT IF EXISTS valid_close_reason;

  ALTER TABLE goal_session_trades ADD CONSTRAINT valid_close_reason
  CHECK (close_reason IN (
    'manual',
    'stop_loss',
    'take_profit',
    'take_profit_1',
    'take_profit_2',
    'goal_achieved',
    'goal_expired',
    'session_ended',
    'risk_limit',
    'trailing_stop',
    'timeout',
    'safety_net',
    'user_stopped',
    'breakeven',
    'alpha_override',
    'ai_decision',
    'goal_met',
    'weekend_shutdown',
    'force_close',
    'force_closed'
  ));

  RAISE NOTICE '[Trade Closure SSOT] ✅ Updated close_reason constraint with TP1/TP2';
END $$;

-- ============================================================================
-- STEP 2: Update close_goal_session_trade RPC with Modal Creation
-- ============================================================================

CREATE OR REPLACE FUNCTION close_goal_session_trade(
  p_trade_id uuid,
  p_close_price numeric,
  p_close_reason text DEFAULT 'manual',
  p_goal_session_id uuid DEFAULT NULL,
  p_force_close boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trade goal_session_trades;
  v_calculated_pnl numeric;
  v_current_balance numeric;
  v_new_balance numeric;
  v_result jsonb;
  v_rows_updated integer;
  v_lot_size numeric;
  v_is_admin boolean := false;
  v_is_owner boolean := false;
  v_is_service_role boolean := false;
  v_modal_created boolean := false;
  v_session_transitioned boolean := false;
BEGIN
  -- Validate close reason (expanded list with force_closed for legacy)
  IF p_close_reason NOT IN (
    'manual', 'stop_loss', 'take_profit', 'take_profit_1', 'take_profit_2',
    'goal_achieved', 'goal_expired', 'session_ended', 'risk_limit',
    'trailing_stop', 'timeout', 'safety_net', 'user_stopped', 'breakeven',
    'alpha_override', 'ai_decision', 'goal_met', 'weekend_shutdown', 'force_close', 'force_closed'
  ) THEN
    RAISE EXCEPTION 'Invalid close_reason: %', p_close_reason;
  END IF;

  RAISE LOG '[close_goal_session_trade] Starting close for trade %', p_trade_id;

  -- Fetch the trade
  IF p_goal_session_id IS NOT NULL THEN
    IF p_force_close THEN
      SELECT * INTO v_trade FROM goal_session_trades
      WHERE id = p_trade_id AND goal_session_id = p_goal_session_id;
    ELSE
      SELECT * INTO v_trade FROM goal_session_trades
      WHERE id = p_trade_id AND goal_session_id = p_goal_session_id
      AND status IN ('open', 'pending', 'soft_closing');
    END IF;
  ELSE
    IF p_force_close THEN
      SELECT * INTO v_trade FROM goal_session_trades WHERE id = p_trade_id;
    ELSE
      SELECT * INTO v_trade FROM goal_session_trades
      WHERE id = p_trade_id AND status IN ('open', 'pending', 'soft_closing');
    END IF;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[close_goal_session_trade] Trade not found or already closed';
  END IF;

  -- Check authorization with admin support
  v_is_owner := (v_trade.user_id = auth.uid());
  v_is_service_role := ((auth.jwt() ->> 'role') = 'service_role');

  -- Check if user is admin
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  -- Allow if: owner, admin, or service_role
  IF NOT (v_is_owner OR v_is_admin OR v_is_service_role) THEN
    RAISE EXCEPTION '[close_goal_session_trade] Access denied: user=%, trade_owner=%, is_admin=%, is_service=%',
      auth.uid(), v_trade.user_id, v_is_admin, v_is_service_role;
  END IF;

  RAISE LOG '[close_goal_session_trade] Auth check passed: owner=%, admin=%, service=%',
    v_is_owner, v_is_admin, v_is_service_role;

  -- Check if already closed
  IF v_trade.status = 'closed' AND NOT p_force_close THEN
    RAISE EXCEPTION 'Trade % is already closed', p_trade_id;
  END IF;

  -- Calculate P&L using SSOT
  v_lot_size := COALESCE(v_trade.lot_size, v_trade.position_size, 0.01);

  v_calculated_pnl := calculate_pnl_universal(
    v_trade.symbol,
    v_trade.direction,
    v_trade.entry_price,
    p_close_price,
    v_lot_size
  );

  RAISE LOG '[close_goal_session_trade] SSOT P&L: Symbol=%, Entry=%, Exit=%, Lot=%, PnL=%',
    v_trade.symbol, v_trade.entry_price, p_close_price, v_lot_size, v_calculated_pnl;

  -- Update trade status
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

  -- Update user balance (only if not already closed)
  SELECT account_balance INTO v_current_balance FROM user_profiles WHERE id = v_trade.user_id;

  IF v_current_balance IS NULL THEN
    RAISE EXCEPTION '[close_goal_session_trade] User profile not found';
  END IF;

  IF v_trade.status != 'closed' THEN
    v_new_balance := v_current_balance + v_calculated_pnl;

    UPDATE user_profiles
    SET account_balance = v_new_balance, updated_at = now()
    WHERE id = v_trade.user_id;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

    IF v_rows_updated = 0 THEN
      RAISE EXCEPTION '[close_goal_session_trade] Failed to update balance';
    END IF;

    RAISE LOG '[close_goal_session_trade] Balance: % + % = %',
      v_current_balance, v_calculated_pnl, v_new_balance;
  ELSE
    v_new_balance := v_current_balance;
    RAISE LOG '[close_goal_session_trade] Skipped balance update - position was already closed';
  END IF;

  -- ========================================================================
  -- SSOT MODAL CREATION: For system closes (SL/TP/TP1/TP2), create modal
  -- ========================================================================
  IF p_close_reason IN ('stop_loss', 'take_profit', 'take_profit_1', 'take_profit_2') THEN
    BEGIN
      -- Create trade_closed modal for user decision
      INSERT INTO pending_user_modals (
        user_id,
        goal_session_id,
        modal_type,
        modal_data,
        created_at
      ) VALUES (
        v_trade.user_id,
        v_trade.goal_session_id,
        'trade_closed',
        jsonb_build_object(
          'trade_id', v_trade.id,
          'symbol', v_trade.symbol,
          'direction', v_trade.direction,
          'entry_price', v_trade.entry_price,
          'exit_price', p_close_price,
          'profit_loss', v_calculated_pnl,
          'close_reason', p_close_reason,
          'lot_size', v_lot_size,
          'balance_before', v_current_balance,
          'balance_after', v_new_balance,
          'closed_at', now()
        ),
        NOW()
      );

      v_modal_created := true;
      RAISE LOG '[close_goal_session_trade] ✅ Modal created: trade_closed for user decision';

      -- Transition session to awaiting_continuation
      UPDATE goal_sessions
      SET
        status = 'awaiting_continuation',
        awaiting_continuation_since = NOW(),
        updated_at = NOW()
      WHERE id = v_trade.goal_session_id
        AND status IN ('active', 'in_trade', 'scanning')
        AND user_id = v_trade.user_id;

      GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

      IF v_rows_updated > 0 THEN
        v_session_transitioned := true;
        RAISE LOG '[close_goal_session_trade] ✅ Session transitioned to awaiting_continuation';
      ELSE
        RAISE LOG '[close_goal_session_trade] ⚠️ Session not transitioned (status not active/in_trade/scanning)';
      END IF;

    EXCEPTION WHEN OTHERS THEN
      -- INTELLIGENT DEGRADATION: Log modal creation failure but don't block trade closure
      RAISE WARNING '[close_goal_session_trade] ⚠️ Modal creation failed (non-blocking): %', SQLERRM;

      -- Insert governance violation
      INSERT INTO ssot_violations (
        violation_type,
        severity,
        component,
        details,
        detected_at
      ) VALUES (
        'modal_creation_failed',
        'high',
        'close_goal_session_trade',
        jsonb_build_object(
          'trade_id', v_trade.id,
          'user_id', v_trade.user_id,
          'session_id', v_trade.goal_session_id,
          'close_reason', p_close_reason,
          'error', SQLERRM
        ),
        NOW()
      );
    END;
  END IF;

  -- Return result with modal status
  v_result := jsonb_build_object(
    'id', v_trade.id,
    'symbol', v_trade.symbol,
    'direction', COALESCE(v_trade.direction, v_trade.position_type),
    'entry_price', v_trade.entry_price,
    'exit_price', p_close_price,
    'lot_size', v_lot_size,
    'profit_loss', v_calculated_pnl,
    'close_reason', p_close_reason,
    'balance_before', v_current_balance,
    'balance_after', v_new_balance,
    'ssot_calculation', true,
    'closed_by_admin', v_is_admin,
    'modal_created', v_modal_created,
    'session_transitioned', v_session_transitioned
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION close_goal_session_trade IS
  'SSOT Authority for trade closure. Creates modal and transitions session for system closes (SL/TP).';

-- ============================================================================
-- STEP 3: Governance Trigger - Prevent system_stopped Without Modal
-- ============================================================================

CREATE OR REPLACE FUNCTION prevent_system_stopped_without_modal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_modal_exists boolean;
  v_open_trades integer;
BEGIN
  -- Only enforce when transitioning TO system_stopped FROM active states
  IF OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status = 'system_stopped'
     AND OLD.status IN ('active', 'in_trade', 'scanning')
  THEN
    -- Check if trade_closed modal exists
    SELECT EXISTS(
      SELECT 1 FROM pending_user_modals
      WHERE goal_session_id = NEW.id
        AND modal_type = 'trade_closed'
        AND dismissed_at IS NULL
        AND created_at > NOW() - INTERVAL '5 minutes'
    ) INTO v_modal_exists;

    -- Check for open trades
    SELECT COUNT(*) INTO v_open_trades
    FROM goal_session_trades
    WHERE goal_session_id = NEW.id
      AND status = 'open';

    -- GOVERNANCE: Block system_stopped if no modal exists and trades just closed
    IF NOT v_modal_exists AND v_open_trades = 0 THEN
      RAISE WARNING '[Governance] Blocked system_stopped without modal - using awaiting_continuation instead';

      -- Intelligently degrade to awaiting_continuation
      NEW.status := 'awaiting_continuation';
      NEW.awaiting_continuation_since := NOW();

      -- Log governance violation
      INSERT INTO ssot_violations (
        violation_type,
        severity,
        component,
        details,
        detected_at
      ) VALUES (
        'system_stopped_without_modal',
        'critical',
        'goal_sessions_trigger',
        jsonb_build_object(
          'session_id', NEW.id,
          'user_id', NEW.user_id,
          'old_status', OLD.status,
          'attempted_status', 'system_stopped',
          'corrected_status', 'awaiting_continuation',
          'open_trades', v_open_trades,
          'modal_exists', v_modal_exists
        ),
        NOW()
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS enforce_modal_before_system_stopped ON goal_sessions;

-- Create governance trigger
CREATE TRIGGER enforce_modal_before_system_stopped
  BEFORE UPDATE ON goal_sessions
  FOR EACH ROW
  EXECUTE FUNCTION prevent_system_stopped_without_modal();

COMMENT ON TRIGGER enforce_modal_before_system_stopped ON goal_sessions IS
  'Governance: Prevents system_stopped without trade_closed modal. Degrades to awaiting_continuation.';

COMMENT ON FUNCTION prevent_system_stopped_without_modal IS
  'Governance: Enforces modal-first approach for session state transitions.';

-- ============================================================================
-- STEP 4: Grant Permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION close_goal_session_trade TO authenticated;
GRANT EXECUTE ON FUNCTION close_goal_session_trade TO service_role;
GRANT EXECUTE ON FUNCTION prevent_system_stopped_without_modal TO authenticated;
GRANT EXECUTE ON FUNCTION prevent_system_stopped_without_modal TO service_role;

-- ============================================================================
-- STEP 5: Verification & Deployment Notes
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  TRADE CLOSURE MODAL SYSTEM - SSOT ARCHITECTURE DEPLOYED';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '  ✅ close_goal_session_trade RPC enhanced with modal creation';
  RAISE NOTICE '  ✅ Session transitions to awaiting_continuation for system closes';
  RAISE NOTICE '  ✅ Governance trigger prevents system_stopped without modal';
  RAISE NOTICE '  ✅ Intelligent degradation: Modal failures logged, not blocked';
  RAISE NOTICE '';
  RAISE NOTICE '  WHAT CHANGED:';
  RAISE NOTICE '  - RPC now creates trade_closed modal for SL/TP/TP1/TP2';
  RAISE NOTICE '  - Session status → awaiting_continuation (not system_stopped)';
  RAISE NOTICE '  - Trigger blocks invalid system_stopped transitions';
  RAISE NOTICE '';
  RAISE NOTICE '  NEXT TRADE CLOSURE WILL:';
  RAISE NOTICE '  1. Close trade + update balance (existing)';
  RAISE NOTICE '  2. Create modal for user decision (NEW)';
  RAISE NOTICE '  3. Transition session to awaiting_continuation (NEW)';
  RAISE NOTICE '  4. User sees modal → decides Continue/Stop (NEW)';
  RAISE NOTICE '';
  RAISE NOTICE '  GOVERNANCE ENFORCEMENT:';
  RAISE NOTICE '  - No system_stopped without user decision modal';
  RAISE NOTICE '  - Violations logged to ssot_violations table';
  RAISE NOTICE '  - Intelligent degradation to awaiting_continuation';
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;
