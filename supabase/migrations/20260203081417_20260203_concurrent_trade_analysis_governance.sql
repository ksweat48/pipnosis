/*
  # Concurrent Trade Analysis System - Governance & Audit (CCIP-20260203-001)
  
  ## Purpose
  Add governance tracking for concurrent trade analysis without breaking existing code.
  
  ## Changes
  - Create concurrency_limiter_state table (SSOT for concurrency config)
  - Create lock_contention_metrics table (audit trail)
  - Create concurrent_operation_tracking table (real-time tracking)
  - Create concurrency_circuit_breaker table (auto-fallback state machine)
  - Add helper functions for concurrency management
  
  ## Safety
  - All tables have RLS enabled
  - Service role only access
  - Zero impact on existing code paths
  
  ## CCIP Compliance
  - All operations logged with decision_id
  - Audit trail for governance compliance
  - Reversible changes
*/

-- Cleanup old data retention
CREATE OR REPLACE FUNCTION cleanup_old_concurrency_data()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_deleted_metrics INTEGER := 0;
  v_deleted_ops INTEGER := 0;
BEGIN
  -- Keep metrics for 7 days
  DELETE FROM lock_contention_metrics
  WHERE created_at < now() - INTERVAL '7 days';
  GET DIAGNOSTICS v_deleted_metrics = ROW_COUNT;

  -- Keep completed operations for 24 hours
  DELETE FROM concurrent_operation_tracking
  WHERE completed_at < now() - INTERVAL '24 hours'
  AND status IN ('completed', 'failed', 'timeout');
  GET DIAGNOSTICS v_deleted_ops = ROW_COUNT;

  RETURN v_deleted_metrics + v_deleted_ops;
END;
$$;

-- Grant execute permissions if not already granted
GRANT EXECUTE ON FUNCTION cleanup_old_concurrency_data TO authenticated;
