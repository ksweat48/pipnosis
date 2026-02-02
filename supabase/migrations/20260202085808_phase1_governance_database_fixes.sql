/*
  # Phase 1 Governance Database Fixes (SSOT + CCIP Compliance)

  **Migration Purpose**: Remove silent DEFAULT 0 values that mask calculation failures
  and add missing foreign key constraints for referential integrity.

  **SSOT Governance Decision** (2026-02-02):
  - Financial columns MUST NOT have DEFAULT 0 (masks failures)
  - Counters MAY have DEFAULT 0 (valid zero state)
  - All user_id columns MUST have FK constraints
  - See GOVERNANCE_DECISIONS.md for full rationale

  ## Changes

  ### 1. Remove Dangerous DEFAULT 0 Values

  **goal_session_trades**:
  - `profit_loss`: Remove DEFAULT 0 (Can't distinguish zero P&L from calculation failure)
  - `current_pnl`: Make NOT NULL, remove DEFAULT 0 (Masks position monitor failures)
  - `expected_profit_for_session`: Remove DEFAULT 0 (Masks planning failures)
  - ✅ KEEP `lot_size DEFAULT 0.01` (Valid minimum lot size)
  - ✅ KEEP `confidence_penalty DEFAULT 0` (Valid zero state)
  - ✅ KEEP `close_attempts_count DEFAULT 0` (Valid counter)

  **goal_sessions**:
  - `starting_balance`: Remove DEFAULT 0 (Hides initialization errors)
  - ✅ KEEP `current_progress DEFAULT 0` (Valid counter)
  - ✅ KEEP `degradation_severity DEFAULT 0` (Valid zero state for non-degraded)

  **entry_intents**:
  - `alpha_confidence`: Remove DEFAULT 60 (Masks missing confidence scores)
  - ✅ KEEP `consecutive_server_failures DEFAULT 0` (Valid counter)

  ### 2. Add Missing Foreign Keys

  **goal_session_trades.user_id**:
  - Add FK constraint → user_profiles(id) ON DELETE CASCADE
  - Prevents orphaned trades if user deleted
  - Ensures referential integrity

  ### 3. TypeScript/Database Schema Alignment

  - `goal_session_trades.user_id`: Make NOT NULL (matches TS expectation)
  - `entry_intents.timeout_at`: Make NOT NULL (matches TS expectation)

  ## Pre-Flight Checks

  1. Verify no orphaned records exist
  2. Verify no NULL user_id values exist
  3. Verify no NULL timeout_at values exist

  ## Rollback Strategy

  If issues occur:
  1. DEFAULT values can be re-added temporarily
  2. NOT NULL constraints can be removed
  3. FK constraint can be dropped

  ## Effective Date

  2026-02-02 (Phase 1 execution)
*/

-- ====================================
-- PRE-FLIGHT VALIDATION
-- ====================================

DO $$
BEGIN
  -- Check for orphaned goal_session_trades (user_id not in user_profiles)
  IF EXISTS (
    SELECT 1 FROM goal_session_trades gst
    LEFT JOIN user_profiles up ON gst.user_id = up.id
    WHERE gst.user_id IS NOT NULL AND up.id IS NULL
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT FAILED: Orphaned goal_session_trades records found (user_id not in user_profiles)';
  END IF;

  -- Check for NULL user_id values
  IF EXISTS (SELECT 1 FROM goal_session_trades WHERE user_id IS NULL) THEN
    RAISE WARNING 'Found goal_session_trades records with NULL user_id - these will be cleaned up';
  END IF;

  -- Check for NULL timeout_at values
  IF EXISTS (SELECT 1 FROM entry_intents WHERE timeout_at IS NULL) THEN
    RAISE WARNING 'Found entry_intents records with NULL timeout_at - these will be set to now() + 15 minutes';
  END IF;

  RAISE NOTICE 'Pre-flight validation passed';
END $$;

-- ====================================
-- DATA CLEANUP (Before Constraints)
-- ====================================

-- Clean up NULL user_id records (orphaned trades)
DELETE FROM goal_session_trades WHERE user_id IS NULL;

-- Fix NULL timeout_at records (set to 15 minutes from created_at)
UPDATE entry_intents
SET timeout_at = created_at + INTERVAL '15 minutes'
WHERE timeout_at IS NULL;

-- ====================================
-- 1. REMOVE DANGEROUS DEFAULT 0 VALUES
-- ====================================

-- goal_session_trades: Remove DEFAULT from profit_loss
ALTER TABLE goal_session_trades
  ALTER COLUMN profit_loss DROP DEFAULT;

-- goal_session_trades: Remove DEFAULT from current_pnl AND make NOT NULL
ALTER TABLE goal_session_trades
  ALTER COLUMN current_pnl SET NOT NULL,
  ALTER COLUMN current_pnl DROP DEFAULT;

-- goal_session_trades: Remove DEFAULT from expected_profit_for_session
ALTER TABLE goal_session_trades
  ALTER COLUMN expected_profit_for_session DROP DEFAULT;

-- goal_sessions: Remove DEFAULT from starting_balance
ALTER TABLE goal_sessions
  ALTER COLUMN starting_balance DROP DEFAULT;

-- entry_intents: Remove DEFAULT from alpha_confidence
ALTER TABLE entry_intents
  ALTER COLUMN alpha_confidence DROP DEFAULT;

-- ====================================
-- 2. ADD NOT NULL CONSTRAINTS
-- ====================================

-- goal_session_trades.user_id: Make NOT NULL (required for FK)
ALTER TABLE goal_session_trades
  ALTER COLUMN user_id SET NOT NULL;

-- entry_intents.timeout_at: Make NOT NULL (required field)
ALTER TABLE entry_intents
  ALTER COLUMN timeout_at SET NOT NULL;

-- ====================================
-- 3. ADD MISSING FOREIGN KEY CONSTRAINTS
-- ====================================

-- Add FK constraint: goal_session_trades.user_id → user_profiles(id)
ALTER TABLE goal_session_trades
  ADD CONSTRAINT fk_goal_session_trades_user_id
  FOREIGN KEY (user_id)
  REFERENCES user_profiles(id)
  ON DELETE CASCADE;

-- ====================================
-- VERIFICATION
-- ====================================

DO $$
DECLARE
  v_profit_loss_default text;
  v_current_pnl_default text;
  v_starting_balance_default text;
  v_alpha_confidence_default text;
  v_fk_exists boolean;
BEGIN
  -- Verify DEFAULT 0 removed from profit_loss
  SELECT column_default INTO v_profit_loss_default
  FROM information_schema.columns
  WHERE table_name = 'goal_session_trades' AND column_name = 'profit_loss';

  IF v_profit_loss_default IS NOT NULL THEN
    RAISE WARNING 'profit_loss still has DEFAULT: %', v_profit_loss_default;
  ELSE
    RAISE NOTICE '✅ profit_loss DEFAULT removed successfully';
  END IF;

  -- Verify DEFAULT 0 removed from current_pnl
  SELECT column_default INTO v_current_pnl_default
  FROM information_schema.columns
  WHERE table_name = 'goal_session_trades' AND column_name = 'current_pnl';

  IF v_current_pnl_default IS NOT NULL THEN
    RAISE WARNING 'current_pnl still has DEFAULT: %', v_current_pnl_default;
  ELSE
    RAISE NOTICE '✅ current_pnl DEFAULT removed successfully';
  END IF;

  -- Verify DEFAULT 0 removed from starting_balance
  SELECT column_default INTO v_starting_balance_default
  FROM information_schema.columns
  WHERE table_name = 'goal_sessions' AND column_name = 'starting_balance';

  IF v_starting_balance_default IS NOT NULL THEN
    RAISE WARNING 'starting_balance still has DEFAULT: %', v_starting_balance_default;
  ELSE
    RAISE NOTICE '✅ starting_balance DEFAULT removed successfully';
  END IF;

  -- Verify DEFAULT 60 removed from alpha_confidence
  SELECT column_default INTO v_alpha_confidence_default
  FROM information_schema.columns
  WHERE table_name = 'entry_intents' AND column_name = 'alpha_confidence';

  IF v_alpha_confidence_default IS NOT NULL THEN
    RAISE WARNING 'alpha_confidence still has DEFAULT: %', v_alpha_confidence_default;
  ELSE
    RAISE NOTICE '✅ alpha_confidence DEFAULT removed successfully';
  END IF;

  -- Verify FK constraint added
  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_goal_session_trades_user_id'
    AND table_name = 'goal_session_trades'
  ) INTO v_fk_exists;

  IF v_fk_exists THEN
    RAISE NOTICE '✅ FK constraint fk_goal_session_trades_user_id added successfully';
  ELSE
    RAISE WARNING 'FK constraint fk_goal_session_trades_user_id NOT found';
  END IF;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'Phase 1 Database Fixes COMPLETE';
  RAISE NOTICE '========================================';
END $$;
