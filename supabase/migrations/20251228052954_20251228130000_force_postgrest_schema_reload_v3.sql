/*
  # Force PostgREST Schema Reload - Comprehensive Fix

  ## Problem
    - Functions `get_latest_council_context` and `store_council_context` return 404
    - Functions exist in database but PostgREST API cache not updated
    - Previous NOTIFY attempts didn't trigger reload

  ## Solution
    Force cache invalidation by making actual changes to functions:
    1. Add input validation (harmless but changes function body)
    2. Update all function metadata
    3. Re-grant all permissions
    4. Send reload notifications
*/

-- Update function comments to new timestamp
COMMENT ON FUNCTION get_latest_council_context(uuid, uuid) IS
  'Retrieves latest council context - CACHE RELOAD 2025-12-28 13:00 UTC';

COMMENT ON FUNCTION store_council_context(uuid, uuid, text, numeric, numeric, numeric, jsonb, jsonb, jsonb, text[], integer) IS
  'Stores council context - CACHE RELOAD 2025-12-28 13:00 UTC';

COMMENT ON FUNCTION increment_scout_cycle(uuid, uuid, numeric) IS
  'Increments scout cycle - CACHE RELOAD 2025-12-28 13:00 UTC';

-- Recreate get_latest_council_context with input validation
CREATE OR REPLACE FUNCTION get_latest_council_context(p_user_id uuid, p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_context jsonb;
BEGIN
  -- Input validation (forces function body change)
  IF p_user_id IS NULL OR p_session_id IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT to_jsonb(cc.*) INTO v_context
  FROM council_context cc
  WHERE cc.user_id = p_user_id
    AND cc.session_id = p_session_id
  ORDER BY cc.created_at DESC
  LIMIT 1;

  RETURN COALESCE(v_context, '{}'::jsonb);
END;
$$;

-- Recreate store_council_context with input validation
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
AS $$
DECLARE
  v_context_id uuid;
BEGIN
  -- Input validation (forces function body change)
  IF p_user_id IS NULL OR p_session_id IS NULL THEN
    RAISE EXCEPTION 'user_id and session_id are required';
  END IF;

  -- Insert or update (upsert) council context
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
    improvement_trend
  ) VALUES (
    p_user_id,
    p_session_id,
    p_alpha_decision,
    p_confidence,
    p_threshold_gap,
    p_target_threshold,
    p_omega_issues,
    p_required_improvements,
    p_last_snapshot,
    p_symbols_scanned,
    p_total_omega_votes,
    0,
    0,
    ARRAY[]::text[]
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
END;
$$;

-- Recreate increment_scout_cycle with input validation
CREATE OR REPLACE FUNCTION increment_scout_cycle(
  p_user_id uuid,
  p_session_id uuid,
  p_improvement_score numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Input validation (forces function body change)
  IF p_user_id IS NULL OR p_session_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE council_context
  SET
    scout_cycles = scout_cycles + 1,
    last_improvement_score = p_improvement_score,
    improvement_trend = array_append(improvement_trend, p_improvement_score::text || '%'),
    updated_at = now()
  WHERE user_id = p_user_id
    AND session_id = p_session_id;
END;
$$;

-- Grant all permissions to all roles
GRANT EXECUTE ON FUNCTION get_latest_council_context(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_latest_council_context(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION get_latest_council_context(uuid, uuid) TO service_role;

GRANT EXECUTE ON FUNCTION store_council_context(uuid, uuid, text, numeric, numeric, numeric, jsonb, jsonb, jsonb, text[], integer) TO authenticated;
GRANT EXECUTE ON FUNCTION store_council_context(uuid, uuid, text, numeric, numeric, numeric, jsonb, jsonb, jsonb, text[], integer) TO service_role;

GRANT EXECUTE ON FUNCTION increment_scout_cycle(uuid, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION increment_scout_cycle(uuid, uuid, numeric) TO service_role;

-- Send multiple reload signals
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
