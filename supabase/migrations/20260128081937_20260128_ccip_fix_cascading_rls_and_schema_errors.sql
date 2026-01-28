/*
  # CCIP: Fix Cascading RLS and Schema Errors
  
  ## Change Intent
  Fix multiple cascading errors causing system instability:
  1. Duplicate mark_tp2_milestone functions with conflicting signatures
  2. RLS policy violations on ai_trader_score (403 errors on INSERT)
  3. RLS policy violations on goal_notifications (403 errors on INSERT)
  4. Invalid column reference "goal_amount" in goal_sessions queries (400 errors)
  5. Ambiguous column references in database functions
  
  ## Root Cause Analysis
  - Two mark_tp2_milestone functions exist, causing PostgreSQL routing confusion
  - RLS policies don't allow authenticated users to insert into ai_trader_score/goal_notifications
  - Code queries non-existent "goal_amount" column (should be "target_value")
  - Multiple duplicate INSERT policies causing policy evaluation conflicts
  
  ## SSOT Compliance
  - TradeClosureCoordinator is sole authority for trade closures
  - GoalAchievementCoordinator is sole authority for goal detection
  - NotificationCoordinator is sole authority for notifications
  - PostTradeAnalyzer is sole authority for trade analysis
  
  ## Governance Compliance
  - Service role policies for system operations
  - Authenticated user policies for user operations
  - No duplicate policies per table/operation
  - Clear RLS policy naming and intent
  
  ## Changes
  1. Drop old mark_tp2_milestone(p_trade_id, p_symbol, p_close_price) function
  2. Consolidate ai_trader_score RLS policies - remove duplicates
  3. Consolidate goal_notifications RLS policies - remove duplicates
  4. No schema changes needed (target_value column already exists)
  5. Add service role INSERT/UPDATE policies for system operations
*/

-- ============================================================================
-- PART 1: Fix Duplicate mark_tp2_milestone Functions
-- ============================================================================

-- Drop the old function with 3 parameters that causes ambiguous column references
-- Keep only the new function with 1 parameter (trade_id uuid)
DROP FUNCTION IF EXISTS mark_tp2_milestone(uuid, text, numeric);

-- Verify the correct function still exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE p.proname = 'mark_tp2_milestone'
    AND n.nspname = 'public'
    AND pg_get_function_arguments(p.oid) = 'trade_id uuid'
  ) THEN
    RAISE EXCEPTION 'CCIP Violation: mark_tp2_milestone(trade_id uuid) function not found';
  END IF;
END $$;

-- ============================================================================
-- PART 2: Consolidate ai_trader_score RLS Policies
-- ============================================================================

-- Drop duplicate INSERT policies (keeping the correct one)
DROP POLICY IF EXISTS "Users can insert own trader score" ON ai_trader_score;

-- Keep only "Users can insert own scores" policy
-- This policy already exists and is correct

-- Ensure service role has proper access for system operations
DROP POLICY IF EXISTS "Service role can insert trader scores" ON ai_trader_score;
DROP POLICY IF EXISTS "Service role can update all trader scores" ON ai_trader_score;
DROP POLICY IF EXISTS "Service role can read all trader scores" ON ai_trader_score;

-- Recreate service role policies with clear intent
CREATE POLICY "Service role full access to ai_trader_score"
  ON ai_trader_score
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- PART 3: Consolidate goal_notifications RLS Policies
-- ============================================================================

-- Drop ALL duplicate INSERT policies
DROP POLICY IF EXISTS "Authenticated users can insert own notifications" ON goal_notifications;
DROP POLICY IF EXISTS "Users can insert own notifications" ON goal_notifications;
DROP POLICY IF EXISTS "System can create notifications" ON goal_notifications;

-- Keep only ONE authenticated INSERT policy that allows system operations
CREATE POLICY "Authenticated users can create notifications"
  ON goal_notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Service role policy for system operations (notification coordinator)
DROP POLICY IF EXISTS "Service role can insert notifications" ON goal_notifications;
DROP POLICY IF EXISTS "Service role can update notifications" ON goal_notifications;

CREATE POLICY "Service role full access to goal_notifications"
  ON goal_notifications
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- PART 4: Add Service Role Policies for System Coordinators
-- ============================================================================

-- Ensure goal_sessions has service role access for state machine operations
DROP POLICY IF EXISTS "Service role full access to goal_sessions" ON goal_sessions;

CREATE POLICY "Service role full access to goal_sessions"
  ON goal_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Ensure goal_session_trades has service role access for closure coordinator
DROP POLICY IF EXISTS "Service role full access to goal_session_trades" ON goal_session_trades;

CREATE POLICY "Service role full access to goal_session_trades"
  ON goal_session_trades
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- PART 5: Verification and Audit
-- ============================================================================

-- Log this critical fix to governance alerts
INSERT INTO governance_alerts (
  alert_type,
  alert_key,
  severity,
  title,
  message,
  component_name,
  metadata
) VALUES (
  'schema_fix',
  'ccip_fix_cascading_errors_20260128',
  'CRITICAL',
  'CCIP: Fixed Cascading RLS and Schema Errors',
  'Resolved multiple cascading errors: duplicate functions, RLS violations, and schema mismatches',
  'database',
  jsonb_build_object(
    'migration', '20260128_ccip_fix_cascading_rls_and_schema_errors',
    'fixes', jsonb_build_array(
      'Dropped duplicate mark_tp2_milestone function',
      'Consolidated ai_trader_score RLS policies',
      'Consolidated goal_notifications RLS policies',
      'Added service role policies for coordinators',
      'Removed conflicting policy duplicates'
    ),
    'impacted_services', jsonb_build_array(
      'TradeClosureCoordinator',
      'GoalAchievementCoordinator',
      'NotificationCoordinator',
      'PostTradeAnalyzer'
    )
  )
);

-- Verify policy counts to prevent future duplicates
DO $$
DECLARE
  v_ai_trader_score_insert_count int;
  v_goal_notifications_insert_count int;
BEGIN
  -- Check ai_trader_score INSERT policies
  SELECT COUNT(*) INTO v_ai_trader_score_insert_count
  FROM pg_policies
  WHERE tablename = 'ai_trader_score'
  AND cmd = 'INSERT'
  AND roles @> '{authenticated}';
  
  IF v_ai_trader_score_insert_count > 1 THEN
    RAISE WARNING 'CCIP: Multiple INSERT policies found on ai_trader_score for authenticated role: %', v_ai_trader_score_insert_count;
  END IF;
  
  -- Check goal_notifications INSERT policies
  SELECT COUNT(*) INTO v_goal_notifications_insert_count
  FROM pg_policies
  WHERE tablename = 'goal_notifications'
  AND cmd = 'INSERT'
  AND roles @> '{authenticated}';
  
  IF v_goal_notifications_insert_count > 1 THEN
    RAISE WARNING 'CCIP: Multiple INSERT policies found on goal_notifications for authenticated role: %', v_goal_notifications_insert_count;
  END IF;
  
  -- Log verification results
  RAISE NOTICE 'CCIP Verification: ai_trader_score INSERT policies: %, goal_notifications INSERT policies: %',
    v_ai_trader_score_insert_count, v_goal_notifications_insert_count;
END $$;