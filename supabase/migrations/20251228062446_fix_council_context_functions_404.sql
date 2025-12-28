/*
  # Fix Council Context Functions 404 Error

  ## Problem
    - Functions `get_latest_council_context` and `store_council_context` return 404
    - Functions exist in database but PostgREST API schema cache not refreshed
    - Edge Function calls fail with PGRST202 error

  ## Solution
    1. Drop and recreate all council context functions with timestamps
    2. Explicitly grant all permissions to all roles
    3. Force schema cache reload with multiple techniques
    4. Verify function existence

  ## Expected Result
    - Functions accessible via PostgREST API at /rest/v1/rpc/
    - No more 404 errors when calling council context functions
*/

-- Drop existing functions to force full recreation
DROP FUNCTION IF EXISTS get_latest_council_context(uuid, uuid);
DROP FUNCTION IF EXISTS store_council_context(uuid, uuid, text, numeric, numeric, numeric, jsonb, jsonb, jsonb, text[], integer);
DROP FUNCTION IF EXISTS increment_scout_cycle(uuid, uuid, numeric);

-- Recreate get_latest_council_context with explicit security and validation
CREATE OR REPLACE FUNCTION get_latest_council_context(p_user_id uuid, p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_context jsonb;
BEGIN
  -- Input validation
  IF p_user_id IS NULL OR p_session_id IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  -- Retrieve latest context
  SELECT to_jsonb(cc.*) INTO v_context
  FROM council_context cc
  WHERE cc.user_id = p_user_id
    AND cc.session_id = p_session_id
  ORDER BY cc.created_at DESC
  LIMIT 1;

  RETURN COALESCE(v_context, '{}'::jsonb);
EXCEPTION
  WHEN OTHERS THEN
    -- Log error and return empty context
    RAISE WARNING 'Error in get_latest_council_context: %', SQLERRM;
    RETURN '{}'::jsonb;
END;
$$;

-- Recreate store_council_context with explicit security and validation
CREATE OR REPLACE FUNCTION store_council_context(
  p_user_id uuid,
  p_session_id uuid,
  p_alpha_decision text,
  p_confidence numeric,
  p_threshold_gap numeric,
  p_target_threshold numeric,
  p_omega_issues jsonb,
  p_required_improvements jsonb,
  p_last_snapshot jsonb,
  p_symbols_scanned text[],
  p_total_omega_votes integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
VOLATILE
AS $$
DECLARE
  v_context_id uuid;
BEGIN
  -- Input validation
  IF p_user_id IS NULL OR p_session_id IS NULL THEN
    RAISE EXCEPTION 'user_id and session_id are required';
  END IF;

  IF p_alpha_decision NOT IN ('no_trade', 'trade_taken', 'scouting') THEN
    RAISE EXCEPTION 'Invalid alpha_decision: %', p_alpha_decision;
  END IF;

  -- Upsert council context
  INSERT INTO council_context (
    user_id,
    session_id,
    alpha_decision,
    confidence,
    threshold_gap,
    target_threshold,
    omega_issues,
    required_improvements,
    last_snapshot,
    symbols_scanned,
    total_omega_votes,
    scout_cycles,
    last_improvement_score,
    improvement_trend,
    created_at,
    updated_at
  ) VALUES (
    p_user_id,
    p_session_id,
    p_alpha_decision,
    p_confidence,
    p_threshold_gap,
    p_target_threshold,
    COALESCE(p_omega_issues, '{}'::jsonb),
    COALESCE(p_required_improvements, '{}'::jsonb),
    COALESCE(p_last_snapshot, '{}'::jsonb),
    COALESCE(p_symbols_scanned, ARRAY[]::text[]),
    COALESCE(p_total_omega_votes, 0),
    0,
    0,
    ARRAY[]::text[],
    now(),
    now()
  )
  ON CONFLICT (user_id, session_id)
  DO UPDATE SET
    alpha_decision = EXCLUDED.alpha_decision,
    confidence = EXCLUDED.confidence,
    threshold_gap = EXCLUDED.threshold_gap,
    target_threshold = EXCLUDED.target_threshold,
    omega_issues = EXCLUDED.omega_issues,
    required_improvements = EXCLUDED.required_improvements,
    last_snapshot = EXCLUDED.last_snapshot,
    symbols_scanned = EXCLUDED.symbols_scanned,
    total_omega_votes = EXCLUDED.total_omega_votes,
    scout_cycles = 0,
    last_improvement_score = 0,
    improvement_trend = ARRAY[]::text[],
    updated_at = now()
  RETURNING id INTO v_context_id;

  RETURN v_context_id;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error storing council context: %', SQLERRM;
END;
$$;

-- Recreate increment_scout_cycle with explicit security and validation
CREATE OR REPLACE FUNCTION increment_scout_cycle(
  p_user_id uuid,
  p_session_id uuid,
  p_improvement_score numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
VOLATILE
AS $$
BEGIN
  -- Input validation
  IF p_user_id IS NULL OR p_session_id IS NULL THEN
    RETURN;
  END IF;

  -- Update scout cycle tracking
  UPDATE council_context
  SET
    scout_cycles = scout_cycles + 1,
    last_improvement_score = COALESCE(p_improvement_score, 0),
    improvement_trend = array_append(improvement_trend, COALESCE(p_improvement_score, 0)::text || '%'),
    updated_at = now()
  WHERE user_id = p_user_id
    AND session_id = p_session_id;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error incrementing scout cycle: %', SQLERRM;
END;
$$;

-- Grant permissions to ALL roles (authenticated, anon, service_role)
GRANT EXECUTE ON FUNCTION get_latest_council_context(uuid, uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION store_council_context(uuid, uuid, text, numeric, numeric, numeric, jsonb, jsonb, jsonb, text[], integer) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION increment_scout_cycle(uuid, uuid, numeric) TO authenticated, anon, service_role;

-- Add descriptive comments with timestamp
COMMENT ON FUNCTION get_latest_council_context(uuid, uuid) IS
  'Retrieves latest council context for Alpha Scout - Fixed 2025-12-28 06:09:00';

COMMENT ON FUNCTION store_council_context(uuid, uuid, text, numeric, numeric, numeric, jsonb, jsonb, jsonb, text[], integer) IS
  'Stores or updates council context after full council meeting - Fixed 2025-12-28 06:09:00';

COMMENT ON FUNCTION increment_scout_cycle(uuid, uuid, numeric) IS
  'Increments Alpha Scout cycle counter with improvement score - Fixed 2025-12-28 06:09:00';

-- Verify functions exist (will raise error if not)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    AND p.proname = 'get_latest_council_context'
  ) THEN
    RAISE EXCEPTION 'Function get_latest_council_context was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    AND p.proname = 'store_council_context'
  ) THEN
    RAISE EXCEPTION 'Function store_council_context was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    AND p.proname = 'increment_scout_cycle'
  ) THEN
    RAISE EXCEPTION 'Function increment_scout_cycle was not created';
  END IF;

  RAISE NOTICE '✅ All council context functions created successfully';
END $$;

-- Force PostgREST schema reload with multiple techniques
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';

-- Alternative: Reset connection pool (if supported)
SELECT pg_notify('pgrst', 'reload schema');
