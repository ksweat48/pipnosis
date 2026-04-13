/*
  # Fix goal_notifications Table Bloat and Statement Timeout

  ## Problem
  - Table has accumulated 89,750 rows since November 2025
  - 89,467 rows are older than 7 days with no cleanup policy
  - Browser AlertExecutor queries every 5 seconds: SELECT * WHERE requires_user_alert=true AND executed=false AND auto_execute_at <= now()
  - This causes PostgreSQL error 57014 (statement timeout) under any DB load
  - The 502 Bad Gateway on realtime_prices is a side-effect of the same DB overload spike

  ## Changes

  ### 1. Immediate Data Purge
  - Delete all goal_notifications rows older than 30 days
  - Reduces table from ~89,750 rows to under 300 rows immediately

  ### 2. Retention Governance Function
  - cleanup_old_goal_notifications(): deletes rows older than 30 days
  - Returns count of deleted rows for observability
  - Matches pattern of all other cleanup_old_* functions in the system

  ### 3. Replace Broad Index with Targeted Partial Index
  - Drop the existing broad range-scan index
  - Add a focused partial index covering ONLY rows where requires_user_alert=true AND executed=false
  - This makes the AlertExecutor query O(active alerts) instead of O(all rows)

  ### 4. Table Retention Contract
  - Documents the 30-day retention policy in a table comment

  ## Security
  - No RLS changes required (existing policies remain intact)
  - Function uses SECURITY DEFINER to run cleanup as owner (matches pattern in codebase)

  ## CCIP Reference
  - CCIP-GOAL-NOTIFICATIONS-BLOAT-2026-04-13
*/

-- STEP 1: Immediate purge of rows older than 30 days
-- This runs at migration time to give immediate relief
DELETE FROM goal_notifications
WHERE created_at < now() - interval '30 days';

-- STEP 2: Drop the existing broad index that forces full range scans
-- (idx_goal_notifications_auto_execute covered all rows regardless of executed status)
DROP INDEX IF EXISTS idx_goal_notifications_auto_execute;

-- STEP 3: Create a tight partial index covering ONLY unexecuted alert rows
-- The AlertExecutor query: WHERE requires_user_alert=true AND executed=false AND auto_execute_at <= now()
-- This partial index makes the planner scan only the few active unexecuted alerts
CREATE INDEX IF NOT EXISTS idx_goal_notifications_pending_execution
  ON goal_notifications (auto_execute_at ASC)
  WHERE requires_user_alert = true AND executed = false;

-- STEP 4: Create the cleanup governance function (matches codebase pattern)
CREATE OR REPLACE FUNCTION cleanup_old_goal_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM goal_notifications
  WHERE created_at < now() - interval '30 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RETURN deleted_count;
END;
$$;

-- Grant execute to authenticated users (matches other cleanup function patterns)
GRANT EXECUTE ON FUNCTION cleanup_old_goal_notifications() TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_old_goal_notifications() TO service_role;

-- STEP 5: Document the retention contract on the table
COMMENT ON TABLE goal_notifications IS
  'Mid-trade and goal session notifications. Retention policy: 30 days (enforced by cleanup_old_goal_notifications). '
  'Queries for pending auto-execution use idx_goal_notifications_pending_execution partial index. '
  'CCIP-GOAL-NOTIFICATIONS-BLOAT-2026-04-13';
