/*
  TRADE CLOSURE FIX - VERIFICATION QUERIES
  Run these to verify all fixes are working correctly
*/

-- ============================================================================
-- 1. VERIFY EMERGENCY FIX FOR greenmorris.83@gmail.com
-- ============================================================================

-- Check trade PNL was corrected
SELECT
  id,
  symbol,
  entry_price,
  exit_price,
  lot_size,
  profit_loss,
  status,
  closed_at
FROM goal_session_trades
WHERE id = 'b23656ea-e79b-4da1-8efe-f2d2b9dfa06c';
-- Expected profit_loss: 76.59 ✅

-- Check balance was updated
SELECT
  email,
  account_balance,
  updated_at
FROM user_profiles
WHERE email = 'greenmorris.83@gmail.com';
-- Expected balance: 100,076.58 (±0.01) ✅

-- Check audit record created
SELECT * FROM emergency_data_corrections
WHERE affected_record_id = 'b23656ea-e79b-4da1-8efe-f2d2b9dfa06c';
-- Expected: 1 record ✅

-- Check CCIP tracking
SELECT
  operation_type,
  change_details->>'old_pnl' as old_pnl,
  change_details->>'correct_pnl' as correct_pnl,
  change_details->>'balance_adjustment' as adjustment,
  created_at
FROM ccip_change_tracking
WHERE operation_type = 'EMERGENCY_PNL_CORRECTION'
  AND record_id = 'b23656ea-e79b-4da1-8efe-f2d2b9dfa06c';
-- Expected: 1 record with adjustment = 76.58 ✅

-- ============================================================================
-- 2. CHECK FOR OTHER AFFECTED TRADES (Potential 10,000x Bug Victims)
-- ============================================================================

SELECT
  id,
  user_id,
  symbol,
  direction,
  entry_price,
  exit_price,
  lot_size,
  profit_loss as stored_pnl,
  ROUND((ABS(exit_price - entry_price) / 0.0001) * (lot_size * 10), 2) as calculated_pnl_if_forex,
  ROUND(profit_loss * 10000, 2) as if_10000x_error,
  closed_at
FROM goal_session_trades
WHERE status = 'closed'
  AND closed_at > '2026-02-01'
  AND ABS(profit_loss) < 1.0  -- Suspiciously small
  AND ABS(profit_loss) > 0    -- Not zero
  AND lot_size > 1.0          -- Large position
  AND symbol NOT LIKE '%XAU%' -- Exclude gold (different calculation)
  AND symbol NOT LIKE '%BTC%' -- Exclude crypto
  AND symbol NOT LIKE '%ETH%'
ORDER BY closed_at DESC
LIMIT 20;
-- Expected: Only the fixed trade (or empty) ✅

-- ============================================================================
-- 3. VERIFY BALANCE UPDATES ARE HAPPENING
-- ============================================================================

-- Check recent trades have corresponding balance updates
SELECT
  gst.id,
  gst.symbol,
  gst.profit_loss,
  gst.closed_at as trade_closed,
  up.updated_at as balance_updated,
  up.updated_at - gst.closed_at as lag,
  CASE
    WHEN up.updated_at >= gst.closed_at AND up.updated_at <= gst.closed_at + INTERVAL '5 seconds'
    THEN '✅ OK'
    ELSE '❌ MISSING'
  END as status
FROM goal_session_trades gst
JOIN user_profiles up ON up.id = gst.user_id
WHERE gst.status = 'closed'
  AND gst.closed_at > NOW() - INTERVAL '24 hours'
ORDER BY gst.closed_at DESC;
-- All recent trades should show ✅ OK

-- ============================================================================
-- 4. CHECK RPC FIX IS DEPLOYED
-- ============================================================================

-- Verify atomic_close_goal_session function exists and is updated
SELECT
  proname as function_name,
  pg_get_functiondef(oid) LIKE '%close_goal_session_trade%' as uses_ssot_rpc,
  pg_get_functiondef(oid) NOT LIKE '%trade_records%' as fixed_table_name
FROM pg_proc
WHERE proname = 'atomic_close_goal_session';
-- Expected: uses_ssot_rpc = true, fixed_table_name = true ✅

-- ============================================================================
-- 5. VERIFY SSOT ENFORCEMENT TRIGGERS ARE ACTIVE
-- ============================================================================

-- Check triggers exist
SELECT
  tgname as trigger_name,
  tgrelid::regclass as table_name,
  tgenabled as enabled
FROM pg_trigger
WHERE tgname IN (
  'enforce_trade_closure_ssot_trigger',
  'validate_and_fix_profit_loss_trigger',
  'trg_audit_trade_closure'
)
ORDER BY tgname;
-- Expected: 3 triggers, all enabled ✅

-- ============================================================================
-- 6. CHECK FOR SSOT VIOLATIONS (Should be Empty After Fix)
-- ============================================================================

SELECT
  violation_type,
  table_name,
  field_name,
  severity,
  auto_corrected,
  created_at
FROM ssot_violations
WHERE created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;
-- Expected: Empty (or only corrected violations from the fix) ✅

-- ============================================================================
-- 7. USE DETECTION FUNCTION FOR ONGOING MONITORING
-- ============================================================================

-- Find any trades where balance wasn't updated properly
SELECT
  trade_id,
  user_id,
  profit_loss,
  closed_at,
  balance_updated_at,
  balance_update_lag,
  CASE
    WHEN likely_bypassed THEN '❌ BYPASS DETECTED'
    ELSE '✅ OK'
  END as status
FROM detect_trade_closure_bypass()
WHERE closed_at > NOW() - INTERVAL '7 days'
ORDER BY closed_at DESC
LIMIT 20;
-- Expected: All show ✅ OK

-- ============================================================================
-- 8. AUDIT TRAIL VERIFICATION
-- ============================================================================

-- Check trade closure audit is capturing all closures
SELECT
  closure_source,
  COUNT(*) as count,
  ROUND(AVG(calculated_pnl), 2) as avg_pnl
FROM trade_closure_audit
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY closure_source
ORDER BY count DESC;
-- Expected: All from 'rpc' source (SSOT compliance) ✅

-- Check closure events are created
SELECT
  event_triggered_by,
  COUNT(*) as count
FROM trade_closure_events
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY event_triggered_by;
-- Expected: All from 'rpc' or 'trigger' (no direct bypasses) ✅

-- ============================================================================
-- 9. PLATFORM HEALTH CHECK
-- ============================================================================

-- Check all open positions have valid PNL tracking
SELECT
  id,
  symbol,
  direction,
  entry_price,
  current_price,
  current_pnl,
  lot_size,
  opened_at
FROM goal_session_trades
WHERE status = 'open'
  AND (current_pnl IS NULL OR ABS(current_pnl) > 10000)
ORDER BY opened_at DESC;
-- Expected: Empty (no trades with null or extreme PNL) ✅

-- Check for any stuck sessions
SELECT
  id,
  user_id,
  status,
  closing_state,
  created_at,
  completed_at
FROM goal_sessions
WHERE status IN ('running', 'scanning')
  AND created_at < NOW() - INTERVAL '2 hours'
ORDER BY created_at DESC;
-- Expected: Empty (or only legitimate long-running sessions) ✅

-- ============================================================================
-- 10. FINAL SUMMARY
-- ============================================================================

-- Get overall system health
SELECT
  'Closed trades (24h)' as metric,
  COUNT(*) as value
FROM goal_session_trades
WHERE status = 'closed' AND closed_at > NOW() - INTERVAL '24 hours'

UNION ALL

SELECT
  'Trades with correct balance updates (24h)',
  COUNT(*)
FROM (
  SELECT 1
  FROM goal_session_trades gst
  JOIN user_profiles up ON up.id = gst.user_id
  WHERE gst.status = 'closed'
    AND gst.closed_at > NOW() - INTERVAL '24 hours'
    AND up.updated_at >= gst.closed_at
    AND up.updated_at <= gst.closed_at + INTERVAL '5 seconds'
) x

UNION ALL

SELECT
  'SSOT violations (24h)',
  COUNT(*)
FROM ssot_violations
WHERE created_at > NOW() - INTERVAL '24 hours'

UNION ALL

SELECT
  'Emergency corrections (all time)',
  COUNT(*)
FROM emergency_data_corrections

ORDER BY metric;

-- ============================================================================
-- EXPECTED RESULTS SUMMARY
-- ============================================================================

/*
✅ greenmorris.83@gmail.com balance corrected: $100,076.58
✅ Trade PNL corrected: $76.59
✅ No other trades affected by 10,000x bug
✅ All recent trades have balance updates
✅ RPC uses correct table name
✅ SSOT enforcement triggers active
✅ No SSOT violations detected
✅ All closures via RPC (SSOT compliance)
✅ Audit trails complete
✅ System health: EXCELLENT

If any query shows unexpected results, investigate immediately.
*/
