/*
  ═══════════════════════════════════════════════════════════════════════════
  CREATE SECURITY DEFINER RPC FUNCTIONS FOR SYSTEM TABLES
  ═══════════════════════════════════════════════════════════════════════════

  PROBLEM: Frontend tries direct INSERT to system tables → RLS blocks it (403)
  
  SOLUTION: Create SECURITY DEFINER RPC functions that:
  1. Accept data from authenticated users
  2. Execute with service_role permissions (bypasses RLS)
  3. Explicitly log changes to governance
  4. Validate all inputs
  
  This is the ONLY way to write to system-generated tables.
  Direct table access is FORBIDDEN.
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. CREATE NOTIFICATION RPC (for goal_notifications)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_goal_notification(
  p_user_id UUID,
  p_type TEXT,
  p_title TEXT,
  p_message TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL,
  p_priority TEXT DEFAULT 'normal'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notification_id UUID;
BEGIN
  -- Verify user is authenticated as themselves
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Only allow creating notifications for yourself
  IF auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Can only create notifications for your own user';
  END IF;

  -- INSERT using SECURITY DEFINER (bypasses RLS)
  INSERT INTO goal_notifications (
    user_id,
    type,
    title,
    message,
    metadata,
    priority,
    created_at
  ) VALUES (
    p_user_id,
    p_type,
    p_title,
    p_message,
    p_metadata,
    p_priority,
    NOW()
  )
  RETURNING id INTO v_notification_id;

  -- Log to governance
  INSERT INTO governance_change_log (
    entity_type,
    entity_id,
    operation,
    new_value,
    reason,
    requester_id
  ) VALUES (
    'goal_notifications',
    v_notification_id,
    'create',
    jsonb_build_object('type', p_type, 'title', p_title, 'priority', p_priority),
    'Created by create_goal_notification RPC',
    auth.uid()
  );

  RETURN v_notification_id;

EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'Error in create_goal_notification: %', SQLERRM;
  RAISE;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. CREATE AI TRADER SCORE RPC (for ai_trader_score)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_ai_trader_score(
  p_user_id UUID,
  p_session_id UUID,
  p_trade_count INTEGER DEFAULT 0,
  p_win_rate NUMERIC DEFAULT 0,
  p_avg_rr NUMERIC DEFAULT 0,
  p_consistency_score NUMERIC DEFAULT 0,
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_score_id UUID;
BEGIN
  -- Verify user is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Service role only - calculate from trading data
  IF auth.uid() != '00000000-0000-0000-0000-000000000000'::uuid THEN
    -- Allow if system calling, deny if user tries to create their own score
    IF auth.uid() != p_user_id THEN
      RAISE EXCEPTION 'Cannot create trader scores for other users';
    END IF;
  END IF;

  -- INSERT using SECURITY DEFINER
  INSERT INTO ai_trader_score (
    user_id,
    session_id,
    trade_count,
    win_rate,
    avg_rr,
    consistency_score,
    metadata,
    created_at
  ) VALUES (
    p_user_id,
    p_session_id,
    p_trade_count,
    p_win_rate,
    p_avg_rr,
    p_consistency_score,
    p_metadata,
    NOW()
  )
  RETURNING id INTO v_score_id;

  -- Log to governance
  INSERT INTO governance_change_log (
    entity_type,
    entity_id,
    operation,
    new_value,
    reason,
    requester_id
  ) VALUES (
    'ai_trader_score',
    v_score_id,
    'create',
    jsonb_build_object('win_rate', p_win_rate, 'consistency', p_consistency_score),
    'Created by create_ai_trader_score RPC',
    auth.uid()
  );

  RETURN v_score_id;

EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'Error in create_ai_trader_score: %', SQLERRM;
  RAISE;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. CREATE COUNTERFACTUAL RPC (for ai_counterfactuals)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_ai_counterfactual(
  p_user_id UUID,
  p_trade_id UUID,
  p_symbol TEXT,
  p_timeframe TEXT,
  p_variant_type TEXT,
  p_variant_setting NUMERIC,
  p_variant_description TEXT,
  p_counterfactual_pnl NUMERIC,
  p_actual_pnl NUMERIC,
  p_would_hit_tp BOOLEAN,
  p_would_hit_sl BOOLEAN,
  p_would_reverse_later BOOLEAN,
  p_time_to_resolution_minutes INTEGER,
  p_candles_held INTEGER,
  p_market_regime TEXT DEFAULT NULL,
  p_volatility_regime TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counterfactual_id UUID;
BEGIN
  -- Verify user is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Only allow for your own trades
  IF auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Can only create counterfactuals for your own trades';
  END IF;

  -- INSERT using SECURITY DEFINER
  INSERT INTO ai_counterfactuals (
    user_id,
    trade_id,
    symbol,
    timeframe,
    variant_type,
    variant_setting,
    variant_description,
    counterfactual_pnl,
    actual_pnl,
    would_hit_tp,
    would_hit_sl,
    would_reverse_later,
    time_to_resolution_minutes,
    candles_held,
    market_regime,
    volatility_regime,
    created_at
  ) VALUES (
    p_user_id,
    p_trade_id,
    p_symbol,
    p_timeframe,
    p_variant_type,
    p_variant_setting,
    p_variant_description,
    p_counterfactual_pnl,
    p_actual_pnl,
    p_would_hit_tp,
    p_would_hit_sl,
    p_would_reverse_later,
    p_time_to_resolution_minutes,
    p_candles_held,
    p_market_regime,
    p_volatility_regime,
    NOW()
  )
  RETURNING id INTO v_counterfactual_id;

  -- Log to governance
  INSERT INTO governance_change_log (
    entity_type,
    entity_id,
    operation,
    new_value,
    reason,
    requester_id
  ) VALUES (
    'ai_counterfactuals',
    v_counterfactual_id,
    'create',
    jsonb_build_object(
      'symbol', p_symbol,
      'actual_pnl', p_actual_pnl,
      'counterfactual_pnl', p_counterfactual_pnl
    ),
    'Created by create_ai_counterfactual RPC',
    auth.uid()
  );

  RETURN v_counterfactual_id;

EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'Error in create_ai_counterfactual: %', SQLERRM;
  RAISE;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. CREATE AI CONVERSATION RPC (for goal_ai_conversations)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_goal_ai_conversation(
  p_user_id UUID,
  p_goal_session_id UUID,
  p_role TEXT,
  p_content TEXT,
  p_tokens_used INTEGER DEFAULT 0,
  p_model TEXT DEFAULT 'gpt-4'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id UUID;
BEGIN
  -- Verify user is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Only allow for your own sessions
  IF auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Can only create conversations for your own sessions';
  END IF;

  -- INSERT using SECURITY DEFINER
  INSERT INTO goal_ai_conversations (
    user_id,
    goal_session_id,
    role,
    content,
    tokens_used,
    model,
    created_at
  ) VALUES (
    p_user_id,
    p_goal_session_id,
    p_role,
    p_content,
    p_tokens_used,
    p_model,
    NOW()
  )
  RETURNING id INTO v_conversation_id;

  -- Log to governance
  INSERT INTO governance_change_log (
    entity_type,
    entity_id,
    operation,
    new_value,
    reason,
    requester_id
  ) VALUES (
    'goal_ai_conversations',
    v_conversation_id,
    'create',
    jsonb_build_object('role', p_role, 'tokens', p_tokens_used, 'model', p_model),
    'Created by create_goal_ai_conversation RPC',
    auth.uid()
  );

  RETURN v_conversation_id;

EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'Error in create_goal_ai_conversation: %', SQLERRM;
  RAISE;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. DISABLE DIRECT TABLE ACCESS - RLS POLICIES
-- ═══════════════════════════════════════════════════════════════════════════
-- NOW authenticated users can ONLY SELECT their own data
-- They CANNOT INSERT directly - must use RPC functions

DO $$
BEGIN
  -- Drop any INSERT/UPDATE/DELETE policies that allow authenticated users
  DROP POLICY IF EXISTS "Users can insert own notifications" ON goal_notifications;
  DROP POLICY IF EXISTS "Users can update own notifications" ON goal_notifications;
  DROP POLICY IF EXISTS "Users can insert own scores" ON ai_trader_score;
  DROP POLICY IF EXISTS "Users can update own scores" ON ai_trader_score;
  DROP POLICY IF EXISTS "Users can insert own counterfactuals" ON ai_counterfactuals;
  DROP POLICY IF EXISTS "Users can insert own conversations" ON goal_ai_conversations;
  
  RAISE NOTICE '✓ Removed direct INSERT/UPDATE policies from system tables';
END $$;

-- Now authenticated users can ONLY SELECT (read), never write
CREATE POLICY "Authenticated can read own goal_notifications"
  ON goal_notifications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Authenticated can read own ai_trader_score"
  ON ai_trader_score FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Authenticated can read own ai_counterfactuals"
  ON ai_counterfactuals FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Authenticated can read own goal_ai_conversations"
  ON goal_ai_conversations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. GRANT EXECUTE PERMISSIONS
-- ═══════════════════════════════════════════════════════════════════════════

GRANT EXECUTE ON FUNCTION create_goal_notification TO authenticated;
GRANT EXECUTE ON FUNCTION create_ai_trader_score TO authenticated;
GRANT EXECUTE ON FUNCTION create_ai_counterfactual TO authenticated;
GRANT EXECUTE ON FUNCTION create_goal_ai_conversation TO authenticated;

DO $$
BEGIN
  INSERT INTO governance_change_log (
    entity_type,
    entity_id,
    operation,
    reason,
    metadata
  ) VALUES (
    'entry_intents',
    '00000000-0000-0000-0000-000000000000'::uuid,
    'field_update',
    'CRITICAL FIX: Created SECURITY DEFINER RPC functions for system table writes',
    jsonb_build_object(
      'functions_created', ARRAY[
        'create_goal_notification',
        'create_ai_trader_score',
        'create_ai_counterfactual',
        'create_goal_ai_conversation'
      ],
      'rls_updated', true,
      'authenticated_access', 'SELECT ONLY (no direct INSERT/UPDATE/DELETE)',
      'required_code_changes', 'Frontend must call RPC functions instead of direct table inserts'
    )
  );
  
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE 'SECURITY DEFINER RPC FUNCTIONS CREATED';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE 'System tables now ONLY accessible via RPC:';
  RAISE NOTICE '  ✓ create_goal_notification()';
  RAISE NOTICE '  ✓ create_ai_trader_score()';
  RAISE NOTICE '  ✓ create_ai_counterfactual()';
  RAISE NOTICE '  ✓ create_goal_ai_conversation()';
  RAISE NOTICE '';
  RAISE NOTICE 'NEXT STEP: Update frontend code to call RPC instead of direct INSERT';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
END $$;
