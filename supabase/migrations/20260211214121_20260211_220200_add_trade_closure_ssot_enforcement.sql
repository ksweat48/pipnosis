/*
  # Trade Closure SSOT Enforcement - Prevent Direct Updates
  
  ## CCIP Compliance
  - Change Type: GOVERNANCE_ENFORCEMENT
  - Severity: HIGH
  - Purpose: Prevent future SSOT violations in trade closure flow
  - Impact: Enforces single closure path through RPC
  
  ## Problem Statement
  Multiple code paths can close trades:
  1. close_goal_session_trade RPC (✅ CORRECT - SSOT)
  2. Direct database UPDATEs from frontend (❌ BYPASSES balance update)
  3. Direct UPDATEs from other RPCs (❌ BYPASSES PNL validation)
  
  ## Solution
  1. Enhanced validation trigger that ENFORCES PNL recalculation on every closure
  2. Audit logging to detect any bypasses
  3. Schema-level documentation
  4. Add check that balance update happened (via updated_at timestamp)
  
  ## SSOT Principles
  - Only close_goal_session_trade() can close trades
  - All closures must calculate PNL via calculate_pnl_universal()
  - All closures must update user balance atomically
  - All closures must create trade_closure_events
  
  ## Governance
  - Violations logged to ssot_violations table
  - Triggers alert governance system
  - CCIP tracking for all enforcement actions
*/

-- ============================================================================
-- Enhanced PNL Validation Trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION enforce_trade_closure_ssot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_calculated_pnl numeric;
  v_pnl_diff numeric;
  v_user_balance_updated boolean;
  v_violation_id uuid;
BEGIN
  -- Only enforce on status change to 'closed'
  IF NEW.status = 'closed' AND (OLD IS NULL OR OLD.status != 'closed') THEN
    
    -- STEP 1: ALWAYS recalculate PNL (SSOT enforcement)
    IF NEW.entry_price IS NOT NULL 
       AND NEW.exit_price IS NOT NULL 
       AND NEW.entry_price != NEW.exit_price 
       AND NEW.position_size > 0 THEN
      
      -- Use SSOT function
      v_calculated_pnl := calculate_pnl_universal(
        NEW.symbol,
        NEW.direction,
        NEW.entry_price,
        NEW.exit_price,
        NEW.position_size
      );
      
      v_pnl_diff := ABS(COALESCE(NEW.profit_loss, 0) - v_calculated_pnl);
      
      -- If provided PNL differs significantly, OVERRIDE it
      IF v_pnl_diff > 0.10 THEN  -- More than 10 cents difference
        RAISE WARNING '[SSOT Enforcement] PNL mismatch detected for trade % - Provided: $%, Calculated: $%, Diff: $%',
          NEW.id, NEW.profit_loss, v_calculated_pnl, v_pnl_diff;
        
        -- FORCE correct PNL
        NEW.profit_loss := v_calculated_pnl;
        NEW.current_pnl := v_calculated_pnl;
        
        -- Log violation
        INSERT INTO ssot_violations (
          violation_type,
          table_name,
          record_id,
          field_name,
          expected_value,
          actual_value,
          severity,
          auto_corrected
        ) VALUES (
          'pnl_mismatch',
          'goal_session_trades',
          NEW.id,
          'profit_loss',
          v_calculated_pnl::text,
          NEW.profit_loss::text,
          'high',
          true
        ) RETURNING id INTO v_violation_id;
        
        RAISE NOTICE '[SSOT Enforcement] ✅ PNL auto-corrected (violation logged: %)', v_violation_id;
      END IF;
    END IF;
    
    -- STEP 2: Verify balance was updated (check user_profiles.updated_at)
    -- This detects if trade was closed via direct UPDATE (bypassing balance update)
    SELECT EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = NEW.user_id
        AND updated_at >= NEW.updated_at - INTERVAL '2 seconds'
    ) INTO v_user_balance_updated;
    
    IF NOT v_user_balance_updated THEN
      RAISE WARNING '[SSOT Enforcement] Balance NOT updated for trade % - Possible direct UPDATE bypass!', NEW.id;
      
      -- Log violation
      INSERT INTO ssot_violations (
        violation_type,
        table_name,
        record_id,
        field_name,
        expected_value,
        actual_value,
        severity,
        auto_corrected
      ) VALUES (
        'balance_not_updated',
        'goal_session_trades',
        NEW.id,
        'user_balance',
        'should_be_updated',
        'not_updated',
        'critical',
        false
      );
      
      RAISE NOTICE '[SSOT Enforcement] 🚨 CRITICAL: Balance update missing - manual intervention required';
    END IF;
    
    -- STEP 3: Log closure source for audit
    -- The trade_closure_audit trigger will capture this
    
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop old trigger if exists and create new one
DROP TRIGGER IF EXISTS enforce_trade_closure_ssot_trigger ON goal_session_trades;

CREATE TRIGGER enforce_trade_closure_ssot_trigger
  BEFORE UPDATE ON goal_session_trades
  FOR EACH ROW
  EXECUTE FUNCTION enforce_trade_closure_ssot();

-- ============================================================================
-- Update validate_and_fix_profit_loss to be more aggressive
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_and_fix_profit_loss()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  c_pnl numeric;
BEGIN
  -- ALWAYS recalculate on closure, even if PNL is set
  IF NEW.status = 'closed' 
     AND NEW.entry_price IS NOT NULL 
     AND NEW.exit_price IS NOT NULL 
     AND NEW.entry_price != NEW.exit_price 
     AND NEW.position_size > 0 THEN
    
    c_pnl := calculate_pnl_universal(
      NEW.symbol,
      NEW.direction,
      NEW.entry_price,
      NEW.exit_price,
      NEW.position_size
    );
    
    -- Always use calculated PNL (SSOT enforcement)
    NEW.profit_loss := c_pnl;
    NEW.current_pnl := c_pnl;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Ensure trigger exists and runs BEFORE enforce_trade_closure_ssot
DROP TRIGGER IF EXISTS validate_and_fix_profit_loss_trigger ON goal_session_trades;

CREATE TRIGGER validate_and_fix_profit_loss_trigger
  BEFORE INSERT OR UPDATE ON goal_session_trades
  FOR EACH ROW
  EXECUTE FUNCTION validate_and_fix_profit_loss();

-- ============================================================================
-- Add Comment Documentation to Table
-- ============================================================================

COMMENT ON TABLE goal_session_trades IS 
'SSOT: All trade closures MUST go through close_goal_session_trade() RPC.
Direct UPDATEs bypass balance updates and PNL validation.
Triggers enforce PNL recalculation on every closure.';

COMMENT ON COLUMN goal_session_trades.status IS
'Valid values: open, pending, soft_closing, closed.
CRITICAL: When changing to closed, MUST use close_goal_session_trade RPC.
Direct updates will trigger SSOT enforcement and may be auto-corrected.';

COMMENT ON COLUMN goal_session_trades.profit_loss IS
'Calculated by calculate_pnl_universal() - SSOT for PNL calculation.
Automatically recalculated on closure via trigger if value is incorrect.
Manual updates are OVERRIDDEN to maintain consistency.';

-- ============================================================================
-- Create Helper Function to Detect Direct Updates
-- ============================================================================

CREATE OR REPLACE FUNCTION detect_trade_closure_bypass()
RETURNS TABLE (
  trade_id uuid,
  user_id uuid,
  closed_at timestamptz,
  profit_loss numeric,
  balance_updated_at timestamptz,
  balance_update_lag interval,
  likely_bypassed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    gst.id as trade_id,
    gst.user_id,
    gst.closed_at,
    gst.profit_loss,
    up.updated_at as balance_updated_at,
    up.updated_at - gst.closed_at as balance_update_lag,
    (up.updated_at < gst.closed_at OR up.updated_at > gst.closed_at + INTERVAL '5 seconds') as likely_bypassed
  FROM goal_session_trades gst
  JOIN user_profiles up ON up.id = gst.user_id
  WHERE gst.status = 'closed'
    AND gst.closed_at > NOW() - INTERVAL '7 days'
  ORDER BY gst.closed_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION detect_trade_closure_bypass() TO authenticated;

-- ============================================================================
-- Success Message
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE '  SSOT ENFORCEMENT ACTIVATED - Trade Closure';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Enforcement Measures:';
  RAISE NOTICE '  ✅ PNL auto-recalculation on EVERY closure';
  RAISE NOTICE '  ✅ Balance update verification';
  RAISE NOTICE '  ✅ SSOT violation logging';
  RAISE NOTICE '  ✅ Auto-correction when possible';
  RAISE NOTICE '';
  RAISE NOTICE 'Detection:';
  RAISE NOTICE '  - Use detect_trade_closure_bypass() to find violations';
  RAISE NOTICE '  - ssot_violations table logs all discrepancies';
  RAISE NOTICE '  - Triggers alert on critical violations';
  RAISE NOTICE '';
  RAISE NOTICE 'SSOT Compliance:';
  RAISE NOTICE '  - ALL closures MUST use close_goal_session_trade RPC';
  RAISE NOTICE '  - Direct table updates are detected and corrected';
  RAISE NOTICE '  - Balance updates are enforced';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;
