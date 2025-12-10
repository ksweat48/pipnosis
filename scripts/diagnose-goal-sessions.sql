-- Diagnostic Query: Check Current Goal Session State
-- Run this to see what sessions exist and why they might not be processing

-- 1. Count all goal sessions by status
SELECT
  status,
  COUNT(*) as count,
  COUNT(*) FILTER (WHERE server_enabled = true) as server_enabled_count,
  COUNT(*) FILTER (WHERE autonomous_enabled = true) as autonomous_enabled_count,
  COUNT(*) FILTER (WHERE server_enabled = true AND autonomous_enabled = true) as fully_enabled_count
FROM goal_sessions
GROUP BY status
ORDER BY count DESC;

-- 2. Show all active sessions with their configuration
SELECT
  id,
  user_id,
  status,
  goal_type,
  target_value,
  starting_balance,
  current_progress,
  server_enabled,
  autonomous_enabled,
  execution_mode,
  server_last_check,
  server_heartbeat,
  created_at,
  watchlist,
  timeframe
FROM goal_sessions
WHERE status IN ('initializing', 'scanning', 'trade_pending', 'in_trade', 'soft_closing')
ORDER BY created_at DESC;

-- 3. Test the RPC function directly
SELECT * FROM get_sessions_for_server_processing();

-- 4. Check if there are any sessions that SHOULD be picked up but aren't
SELECT
  id,
  user_id,
  status,
  server_enabled,
  autonomous_enabled,
  server_last_check,
  CASE
    WHEN server_last_check IS NULL THEN 'Never checked - SHOULD be picked up'
    WHEN server_last_check < now() - INTERVAL '30 seconds' THEN 'Ready for processing - SHOULD be picked up'
    ELSE 'Too recent - Will be picked up in ' || EXTRACT(EPOCH FROM (server_last_check + INTERVAL '30 seconds' - now()))::text || ' seconds'
  END as processing_status
FROM goal_sessions
WHERE status IN ('initializing', 'scanning', 'trade_pending', 'in_trade', 'soft_closing')
ORDER BY server_last_check NULLS FIRST;

-- 5. Check for any blocking conditions
SELECT
  'Total Sessions' as check_name,
  COUNT(*)::text as value
FROM goal_sessions
UNION ALL
SELECT
  'Active Status Sessions',
  COUNT(*)::text
FROM goal_sessions
WHERE status IN ('initializing', 'scanning', 'trade_pending', 'in_trade', 'soft_closing')
UNION ALL
SELECT
  'Server Enabled',
  COUNT(*)::text
FROM goal_sessions
WHERE server_enabled = true
UNION ALL
SELECT
  'Autonomous Enabled',
  COUNT(*)::text
FROM goal_sessions
WHERE autonomous_enabled = true
UNION ALL
SELECT
  'Should Be Processed',
  COUNT(*)::text
FROM goal_sessions
WHERE status IN ('initializing', 'scanning', 'trade_pending', 'in_trade', 'soft_closing')
  AND server_enabled = true
  AND autonomous_enabled = true
  AND (server_last_check IS NULL OR server_last_check < now() - INTERVAL '30 seconds');
