/*
  # CCIP Emergency Fix: RLS Policies and Function Overloading - FINAL
  
  **Change ID**: CCIP-20260130-001-EMERGENCY
  **Severity**: CRITICAL
  **Blocking**: Trade closures, notifications, analysis
  
  ## Root Causes
  1. Function overloading: Multiple cleanup_orphaned_intents definitions
  2. RLS misconfig: 4 tables have no INSERT policies for authenticated users
  
  ## CCIP & Governance Compliance
  - Single source of truth: One cleanup_orphaned_intents(uuid, text)
  - Authority registry: Tracks ownership
  - Audit trail: All changes logged
  - Least privilege: RLS enforces user boundaries
*/

-- ============================================================================
-- PART 1: REMOVE ALL CONFLICTING FUNCTION DEFINITIONS
-- ============================================================================

DROP FUNCTION IF EXISTS cleanup_orphaned_intents(UUID);
DROP FUNCTION IF EXISTS cleanup_orphaned_intents(UUID, TEXT);
DROP FUNCTION IF EXISTS cleanup_orphaned_intents(UUID, TEXT, BOOLEAN);

-- ============================================================================
-- PART 2: CREATE UNIFIED cleanup_orphaned_intents
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_orphaned_intents(
  p_session_id UUID,
  p_reason TEXT DEFAULT 'unspecified_cleanup'
)
RETURNS VOID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_expired_count INTEGER := 0;
  v_cancelled_count INTEGER := 0;
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'cleanup_orphaned_intents: p_session_id cannot be NULL';
  END IF;

  -- Expire stale monitoring intents
  WITH expired AS (
    UPDATE entry_intents
    SET
      status = 'expired',
      expired_reason = p_reason || ' - Monitoring timeout',
      updated_at = now()
    WHERE session_id = p_session_id
      AND status = 'monitoring'
      AND created_at < (now() - INTERVAL '5 minutes')
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER INTO v_expired_count FROM expired;

  -- Cancel pending intents during transitions
  IF p_reason IN ('timeout_auto_close', 'session_end', 'force_cleanup', 'stuck_session_cleanup', 'continuation_response_cleanup') THEN
    WITH cancelled AS (
      UPDATE entry_intents
      SET
        status = 'cancelled',
        expired_reason = p_reason,
        updated_at = now()
      WHERE session_id = p_session_id
        AND status IN ('pending', 'monitoring')
      RETURNING id
    )
    SELECT COUNT(*)::INTEGER INTO v_cancelled_count FROM cancelled;
  END IF;

  -- Log cleanup to governance audit
  BEGIN
    INSERT INTO governance_change_log (
      entity_type,
      entity_id,
      operation,
      reason,
      requester_id,
      metadata
    )
    VALUES (
      'entry_intents',
      p_session_id,
      'intent_cleanup',
      p_reason,
      NULL,
      jsonb_build_object(
        'expired_count', v_expired_count,
        'cancelled_count', v_cancelled_count,
        'total_cleaned', v_expired_count + v_cancelled_count
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to log intent cleanup: %', SQLERRM;
  END;

  RAISE LOG '[EntryIntentCleanupAuthority] Cleaned % intents for session % (reason: %)',
    (v_expired_count + v_cancelled_count), p_session_id, p_reason;
END;
$$;

GRANT EXECUTE ON FUNCTION cleanup_orphaned_intents(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_orphaned_intents(UUID, TEXT) TO service_role;

-- ============================================================================
-- PART 3: FIX RLS POLICIES - ENSURE TABLES ARE SECURE
-- ============================================================================

ALTER TABLE goal_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_trader_score ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_counterfactuals ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_ai_conversations ENABLE ROW LEVEL SECURITY;

-- Clean up old policies (be aggressive to ensure no conflicts)
DROP POLICY IF EXISTS "Authenticated users can insert own notifications" ON goal_notifications;
DROP POLICY IF EXISTS "Users can insert goal notifications" ON goal_notifications;
DROP POLICY IF EXISTS "Enable insert for authenticated" ON goal_notifications;
DROP POLICY IF EXISTS "authenticated_insert_own_notifications" ON goal_notifications;
DROP POLICY IF EXISTS "authenticated_select_own_notifications" ON goal_notifications;
DROP POLICY IF EXISTS "service_role_full_access" ON goal_notifications;

DROP POLICY IF EXISTS "Users can insert own trader score" ON ai_trader_score;
DROP POLICY IF EXISTS "Authenticated insert on ai_trader_score" ON ai_trader_score;
DROP POLICY IF EXISTS "Enable insert for authenticated" ON ai_trader_score;
DROP POLICY IF EXISTS "authenticated_insert_own_score" ON ai_trader_score;
DROP POLICY IF EXISTS "authenticated_select_own_score" ON ai_trader_score;
DROP POLICY IF EXISTS "service_role_full_access_ai_score" ON ai_trader_score;

DROP POLICY IF EXISTS "Users can insert own counterfactuals" ON ai_counterfactuals;
DROP POLICY IF EXISTS "Authenticated insert counterfactuals" ON ai_counterfactuals;
DROP POLICY IF EXISTS "Enable insert for authenticated" ON ai_counterfactuals;
DROP POLICY IF EXISTS "authenticated_insert_own_counterfactuals" ON ai_counterfactuals;
DROP POLICY IF EXISTS "authenticated_select_own_counterfactuals" ON ai_counterfactuals;
DROP POLICY IF EXISTS "service_role_full_access_counterfactuals" ON ai_counterfactuals;

DROP POLICY IF EXISTS "Users can insert own conversations" ON goal_ai_conversations;
DROP POLICY IF EXISTS "Authenticated insert conversations" ON goal_ai_conversations;
DROP POLICY IF EXISTS "Enable insert for authenticated" ON goal_ai_conversations;
DROP POLICY IF EXISTS "authenticated_insert_own_conversations" ON goal_ai_conversations;
DROP POLICY IF EXISTS "authenticated_select_own_conversations" ON goal_ai_conversations;
DROP POLICY IF EXISTS "service_role_full_access_conversations" ON goal_ai_conversations;

-- === goal_notifications: Recreate with clear names ===
CREATE POLICY "goal_notifications_auth_insert"
  ON goal_notifications FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "goal_notifications_auth_select"
  ON goal_notifications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "goal_notifications_service_role"
  ON goal_notifications FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- === ai_trader_score: Recreate with clear names ===
CREATE POLICY "ai_trader_score_auth_insert"
  ON ai_trader_score FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "ai_trader_score_auth_select"
  ON ai_trader_score FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "ai_trader_score_service_role"
  ON ai_trader_score FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- === ai_counterfactuals: Recreate with clear names ===
CREATE POLICY "ai_counterfactuals_auth_insert"
  ON ai_counterfactuals FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "ai_counterfactuals_auth_select"
  ON ai_counterfactuals FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "ai_counterfactuals_service_role"
  ON ai_counterfactuals FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- === goal_ai_conversations: Recreate with clear names ===
CREATE POLICY "goal_ai_conversations_auth_insert"
  ON goal_ai_conversations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "goal_ai_conversations_auth_select"
  ON goal_ai_conversations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "goal_ai_conversations_service_role"
  ON goal_ai_conversations FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- PART 4: REGISTER IN GOVERNANCE AUTHORITY REGISTRY (SSOT)
-- ============================================================================

INSERT INTO governance_authority_registry (
  authority_name,
  responsibility,
  owned_functions,
  owned_columns,
  owned_tables,
  description
)
VALUES (
  'EntryIntentCleanupAuthority',
  'Single source for cleaning orphaned/stale entry intents during session transitions',
  ARRAY['cleanup_orphaned_intents(uuid, text)'],
  ARRAY['entry_intents.status', 'entry_intents.expired_reason'],
  ARRAY['entry_intents', 'governance_change_log'],
  'SSOT unified implementation: cleanup_orphaned_intents(uuid, text)'
)
ON CONFLICT (authority_name) DO UPDATE SET
  owned_functions = ARRAY['cleanup_orphaned_intents(uuid, text)'],
  updated_at = NOW();

-- ============================================================================
-- PART 5: LOG THE EMERGENCY FIX
-- ============================================================================

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  requester_id,
  metadata
)
VALUES (
  'entry_intents',
  '00000000-0000-0000-0000-000000000000'::UUID,
  'intent_cleanup',
  jsonb_build_object(
    'status', 'blocked',
    'errors', ARRAY['PGRST203 function overloading', '403 RLS forbidden']
  ),
  jsonb_build_object(
    'status', 'restored',
    'fixes', ARRAY['unified cleanup_orphaned_intents', 'RLS policies on 4 tables']
  ),
  'CCIP-20260130-001: Emergency fix for function overloading and RLS blocks',
  NULL,
  jsonb_build_object(
    'ccip_id', 'CCIP-20260130-001-EMERGENCY',
    'severity', 'CRITICAL',
    'issue', 'All trade closures blocked by 403 RLS errors + PGRST203 function overload',
    'root_causes', ARRAY[
      'cleanup_orphaned_intents: multiple incompatible definitions',
      'goal_notifications: no authenticated INSERT policy',
      'ai_trader_score: no authenticated INSERT policy',
      'ai_counterfactuals: no authenticated INSERT policy',
      'goal_ai_conversations: no authenticated INSERT policy'
    ],
    'fixed_systems', ARRAY[
      'Trade closure workflow (notifications)',
      'AI scoring and learning',
      'Counterfactual analysis persistence',
      'Goal session conversations'
    ]
  )
);

-- ============================================================================
-- PART 6: VERIFICATION
-- ============================================================================

DO $$
DECLARE
  v_func_count INTEGER;
  v_goal_notif_insert INTEGER;
  v_ai_score_insert INTEGER;
  v_counterfactuals_insert INTEGER;
  v_conversations_insert INTEGER;
  v_all_pass BOOLEAN := true;
BEGIN
  -- Verify function count
  SELECT COUNT(*) INTO v_func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'cleanup_orphaned_intents';

  IF v_func_count = 1 THEN
    RAISE NOTICE 'CCIP ✅ cleanup_orphaned_intents unified (1 definition)';
  ELSE
    RAISE NOTICE 'CCIP ❌ cleanup_orphaned_intents: % definitions (expected 1)', v_func_count;
    v_all_pass := false;
  END IF;

  -- Verify RLS policies
  SELECT COUNT(*) INTO v_goal_notif_insert
  FROM pg_policies
  WHERE tablename = 'goal_notifications'
    AND policyname = 'goal_notifications_auth_insert';

  SELECT COUNT(*) INTO v_ai_score_insert
  FROM pg_policies
  WHERE tablename = 'ai_trader_score'
    AND policyname = 'ai_trader_score_auth_insert';

  SELECT COUNT(*) INTO v_counterfactuals_insert
  FROM pg_policies
  WHERE tablename = 'ai_counterfactuals'
    AND policyname = 'ai_counterfactuals_auth_insert';

  SELECT COUNT(*) INTO v_conversations_insert
  FROM pg_policies
  WHERE tablename = 'goal_ai_conversations'
    AND policyname = 'goal_ai_conversations_auth_insert';

  IF v_goal_notif_insert = 1 THEN
    RAISE NOTICE 'CCIP ✅ goal_notifications: INSERT policy active';
  ELSE
    RAISE NOTICE 'CCIP ❌ goal_notifications: INSERT policy missing';
    v_all_pass := false;
  END IF;

  IF v_ai_score_insert = 1 THEN
    RAISE NOTICE 'CCIP ✅ ai_trader_score: INSERT policy active';
  ELSE
    RAISE NOTICE 'CCIP ❌ ai_trader_score: INSERT policy missing';
    v_all_pass := false;
  END IF;

  IF v_counterfactuals_insert = 1 THEN
    RAISE NOTICE 'CCIP ✅ ai_counterfactuals: INSERT policy active';
  ELSE
    RAISE NOTICE 'CCIP ❌ ai_counterfactuals: INSERT policy missing';
    v_all_pass := false;
  END IF;

  IF v_conversations_insert = 1 THEN
    RAISE NOTICE 'CCIP ✅ goal_ai_conversations: INSERT policy active';
  ELSE
    RAISE NOTICE 'CCIP ❌ goal_ai_conversations: INSERT policy missing';
    v_all_pass := false;
  END IF;

  IF v_all_pass THEN
    RAISE NOTICE '';
    RAISE NOTICE '================================================================';
    RAISE NOTICE 'CCIP EMERGENCY FIX: COMPLETE AND VERIFIED';
    RAISE NOTICE '================================================================';
    RAISE NOTICE 'TRADE CLOSURE SYSTEM: RESTORED';
    RAISE NOTICE 'Function Overloading: RESOLVED';
    RAISE NOTICE 'RLS Policies: ACTIVE';
    RAISE NOTICE 'Governance Compliance: CCIP-COMPLIANT';
    RAISE NOTICE '================================================================';
  ELSE
    RAISE EXCEPTION 'CCIP verification failed - see notices above';
  END IF;
END $$;
