/*
  # Create Alpha Execution Diagnosis RPC (CCIP Compliant)

  1. Purpose
    - Provides non-invasive diagnosis of why trades aren't executing
    - Returns summary of blocks without affecting execution logic
    - Enables intelligent degradation insights
    - SSOT: Uses audit tables as single source of truth

  2. Functions
    - get_execution_block_summary: Returns why trades are blocked
    - get_recent_execution_history: Shows recent execution attempts
    - can_trade_execute: Checks if system is in position to execute

  3. Security
    - SECURITY DEFINER wraps permissions correctly
    - Only returns user's own data
    - No mutations - query only
*/

-- Get execution block summary for a session
CREATE OR REPLACE FUNCTION get_execution_block_summary(p_session_id uuid)
RETURNS TABLE (
  total_decisions integer,
  successful_executions integer,
  blocked_decisions integer,
  top_block_reasons jsonb,
  recoverable_blocks integer,
  last_blocked_at timestamptz,
  execution_rate numeric
) AS $$
DECLARE
  v_user_id uuid;
BEGIN
  -- Get user ID from JWT
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  WITH audit_data AS (
    SELECT id, execution_success, created_at
    FROM alpha_execution_audit
    WHERE user_id = v_user_id
    AND session_id = p_session_id
    ORDER BY created_at DESC
    LIMIT 100
  ),
  block_data AS (
    SELECT 
      ebr.specific_reason,
      ebr.severity,
      COUNT(*) as count,
      SUM(CASE WHEN ebr.recoverable THEN 1 ELSE 0 END) as recoverable_count
    FROM execution_block_reasons ebr
    INNER JOIN audit_data ad ON ebr.audit_id = ad.id
    GROUP BY ebr.specific_reason, ebr.severity
    ORDER BY count DESC
    LIMIT 5
  )
  SELECT
    (SELECT COUNT(*) FROM audit_data)::integer as total_decisions,
    (SELECT COUNT(*) FROM audit_data WHERE execution_success = true)::integer as successful_executions,
    (SELECT COUNT(DISTINCT audit_id) FROM execution_block_reasons WHERE audit_id IN (SELECT id FROM audit_data))::integer as blocked_decisions,
    (SELECT jsonb_agg(
      jsonb_build_object(
        'reason', specific_reason,
        'count', count,
        'severity', severity,
        'recoverable', recoverable_count
      )
    ) FROM block_data)::jsonb as top_block_reasons,
    (SELECT COALESCE(SUM(recoverable_count), 0)::integer FROM block_data) as recoverable_blocks,
    (SELECT created_at FROM audit_data WHERE execution_success = false ORDER BY created_at DESC LIMIT 1) as last_blocked_at,
    CASE 
      WHEN (SELECT COUNT(*) FROM audit_data) = 0 THEN 0
      ELSE ((SELECT COUNT(*) FROM audit_data WHERE execution_success = true)::numeric / (SELECT COUNT(*) FROM audit_data)::numeric * 100)
    END as execution_rate;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Get recent execution history with block details
CREATE OR REPLACE FUNCTION get_recent_execution_history(p_session_id uuid, p_limit integer DEFAULT 20)
RETURNS TABLE (
  audit_id uuid,
  action text,
  symbol text,
  confidence numeric,
  execution_success boolean,
  block_reasons jsonb,
  created_at timestamptz
) AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT
    aea.id as audit_id,
    aea.action,
    aea.symbol,
    aea.confidence,
    aea.execution_success,
    (SELECT jsonb_agg(
      jsonb_build_object(
        'category', ebr.block_category,
        'reason', ebr.specific_reason,
        'severity', ebr.severity,
        'recoverable', ebr.recoverable
      )
    ) FROM execution_block_reasons ebr WHERE ebr.audit_id = aea.id)::jsonb as block_reasons,
    aea.created_at
  FROM alpha_execution_audit aea
  WHERE aea.user_id = v_user_id
  AND aea.session_id = p_session_id
  ORDER BY aea.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Check if system can execute trades (diagnostic)
CREATE OR REPLACE FUNCTION can_trade_execute(p_session_id uuid)
RETURNS TABLE (
  can_execute boolean,
  blocker_count integer,
  fatal_blockers integer,
  warning_blockers integer,
  advisory_blockers integer,
  top_blocker text,
  recovery_available boolean
) AS $$
DECLARE
  v_user_id uuid;
  v_blocker_count integer;
  v_fatal_count integer;
  v_warning_count integer;
  v_advisory_count integer;
  v_top_blocker text;
  v_recovery_available boolean;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Count recent blocks by severity
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE severity = 'FATAL'),
    COUNT(*) FILTER (WHERE severity = 'WARNING'),
    COUNT(*) FILTER (WHERE severity = 'ADVISORY'),
    (SELECT specific_reason FROM execution_block_reasons 
     WHERE audit_id IN (
       SELECT id FROM alpha_execution_audit
       WHERE user_id = v_user_id
       AND session_id = p_session_id
       AND created_at > NOW() - INTERVAL '15 minutes'
     )
     ORDER BY created_at DESC LIMIT 1),
    MAX(recoverable)
  INTO v_blocker_count, v_fatal_count, v_warning_count, v_advisory_count, v_top_blocker, v_recovery_available
  FROM execution_block_reasons
  WHERE audit_id IN (
    SELECT id FROM alpha_execution_audit
    WHERE user_id = v_user_id
    AND session_id = p_session_id
    AND created_at > NOW() - INTERVAL '15 minutes'
  );

  RETURN QUERY
  SELECT
    (v_fatal_count = 0)::boolean as can_execute,
    COALESCE(v_blocker_count, 0)::integer as blocker_count,
    COALESCE(v_fatal_count, 0)::integer as fatal_blockers,
    COALESCE(v_warning_count, 0)::integer as warning_blockers,
    COALESCE(v_advisory_count, 0)::integer as advisory_blockers,
    v_top_blocker::text,
    COALESCE(v_recovery_available, false)::boolean as recovery_available;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION get_execution_block_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_recent_execution_history(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION can_trade_execute(uuid) TO authenticated;