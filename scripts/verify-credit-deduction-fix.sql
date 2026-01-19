-- ============================================================================
-- POST-DEPLOY VERIFICATION: Credit Deduction Fix
-- ============================================================================
-- Run these queries in Supabase SQL Editor to verify the fix is working
-- Expected to be run periodically: 1hr, 24hr, 7 days after deployment
-- ============================================================================

-- ============================================================================
-- SECTION 1: IMMEDIATE CHECKS (First 1 Hour)
-- ============================================================================

-- Query 1.1: Are credit deductions happening?
-- Expected: > 0 if any trades executed
-- If 0 after trades executed: FIX NOT WORKING ❌
SELECT
  COUNT(*) as deductions_last_hour,
  SUM(credits_deducted) as total_credits_deducted,
  AVG(credits_deducted) as avg_credits_per_deduction,
  MIN(created_at) as first_deduction,
  MAX(created_at) as last_deduction
FROM credit_transactions
WHERE created_at >= NOW() - INTERVAL '1 hour'
  AND transaction_type = 'signal_deduction'
  AND credits_deducted > 0;

-- Query 1.2: Check for deduction failures
-- Expected: Some failures if users have < 10 credits (normal)
-- If MANY failures with same error: Investigate ⚠️
SELECT
  COUNT(*) as failed_attempts,
  metadata->>'error' as error_message,
  COUNT(DISTINCT user_id) as affected_users
FROM credit_transactions
WHERE created_at >= NOW() - INTERVAL '1 hour'
  AND transaction_type = 'signal_deduction'
  AND credits_deducted = 0  -- Failed deductions
GROUP BY metadata->>'error'
ORDER BY failed_attempts DESC;

-- Query 1.3: Credit balance accuracy check
-- Expected: 0 rows (all balances accurate) ✅
-- If rows found: Balance calculation error ❌
WITH user_transactions AS (
  SELECT
    user_id,
    SUM(CASE WHEN credits_added > 0 THEN credits_added ELSE 0 END) as total_added,
    SUM(CASE WHEN credits_deducted > 0 THEN credits_deducted ELSE 0 END) as total_deducted
  FROM credit_transactions
  GROUP BY user_id
)
SELECT
  up.id as user_id,
  up.email,
  up.credit_balance as current_balance,
  COALESCE(ut.total_added, 0) as total_credits_added,
  COALESCE(ut.total_deducted, 0) as total_credits_deducted,
  (50 + COALESCE(ut.total_added, 0) - COALESCE(ut.total_deducted, 0)) as calculated_balance,
  (up.credit_balance - (50 + COALESCE(ut.total_added, 0) - COALESCE(ut.total_deducted, 0))) as discrepancy
FROM user_profiles up
LEFT JOIN user_transactions ut ON ut.user_id = up.id
WHERE up.credit_balance IS NOT NULL
  AND up.credit_balance != (50 + COALESCE(ut.total_added, 0) - COALESCE(ut.total_deducted, 0))
ORDER BY ABS(up.credit_balance - (50 + COALESCE(ut.total_added, 0) - COALESCE(ut.total_deducted, 0))) DESC;

-- Query 1.4: Verify deductions match trade executions
-- Expected: Every immediate trade has a credit deduction ✅
-- If mismatches: Some trades executed without deduction ❌
WITH recent_trades AS (
  SELECT
    t.id as trade_id,
    t.user_id,
    t.goal_session_id,
    t.symbol,
    t.entry_intent_type,
    t.created_at as trade_time
  FROM goal_session_trades t
  WHERE t.created_at >= NOW() - INTERVAL '1 hour'
    AND t.entry_intent_type IN ('immediate_momentum', 'immediate_execution')
),
recent_deductions AS (
  SELECT
    ct.user_id,
    ct.metadata->>'symbol' as symbol,
    ct.metadata->>'sessionId' as session_id,
    ct.created_at as deduction_time
  FROM credit_transactions ct
  WHERE ct.created_at >= NOW() - INTERVAL '1 hour'
    AND ct.transaction_type = 'signal_deduction'
    AND ct.credits_deducted = 10
)
SELECT
  t.trade_id,
  t.user_id,
  t.symbol,
  t.trade_time,
  d.deduction_time,
  CASE
    WHEN d.deduction_time IS NULL THEN '❌ MISSING DEDUCTION'
    WHEN d.deduction_time > t.trade_time THEN '⚠️ DEDUCTION AFTER TRADE'
    ELSE '✅ DEDUCTION BEFORE TRADE'
  END as status
FROM recent_trades t
LEFT JOIN recent_deductions d
  ON d.user_id = t.user_id
  AND d.symbol = t.symbol
  AND d.deduction_time BETWEEN (t.trade_time - INTERVAL '10 seconds') AND (t.trade_time + INTERVAL '2 seconds')
ORDER BY t.trade_time DESC;

-- ============================================================================
-- SECTION 2: SHORT-TERM MONITORING (24 Hours)
-- ============================================================================

-- Query 2.1: Credit deduction success rate
-- Expected: > 95% success rate ✅
-- If < 90%: Investigate error patterns ⚠️
WITH deduction_stats AS (
  SELECT
    COUNT(*) as total_attempts,
    SUM(CASE WHEN credits_deducted > 0 THEN 1 ELSE 0 END) as successful,
    SUM(CASE WHEN credits_deducted = 0 THEN 1 ELSE 0 END) as failed
  FROM credit_transactions
  WHERE created_at >= NOW() - INTERVAL '24 hours'
    AND transaction_type = 'signal_deduction'
)
SELECT
  total_attempts,
  successful,
  failed,
  ROUND((successful::numeric / NULLIF(total_attempts, 0) * 100), 2) as success_rate_percent,
  CASE
    WHEN (successful::numeric / NULLIF(total_attempts, 0) * 100) >= 95 THEN '✅ EXCELLENT'
    WHEN (successful::numeric / NULLIF(total_attempts, 0) * 100) >= 90 THEN '✓ GOOD'
    WHEN (successful::numeric / NULLIF(total_attempts, 0) * 100) >= 80 THEN '⚠️ NEEDS ATTENTION'
    ELSE '❌ CRITICAL ISSUE'
  END as health_status
FROM deduction_stats;

-- Query 2.2: User credit distribution
-- Expected: Users depleting credits normally ✅
-- If most users still at 50: Deductions not happening ❌
SELECT
  CASE
    WHEN credit_balance >= 50 THEN '50+ credits'
    WHEN credit_balance >= 40 THEN '40-49 credits'
    WHEN credit_balance >= 30 THEN '30-39 credits'
    WHEN credit_balance >= 20 THEN '20-29 credits'
    WHEN credit_balance >= 10 THEN '10-19 credits'
    WHEN credit_balance >= 1 THEN '1-9 credits'
    ELSE '0 credits'
  END as credit_range,
  COUNT(*) as user_count,
  ROUND(AVG(credit_balance), 2) as avg_balance
FROM user_profiles
WHERE credit_balance IS NOT NULL
GROUP BY
  CASE
    WHEN credit_balance >= 50 THEN '50+ credits'
    WHEN credit_balance >= 40 THEN '40-49 credits'
    WHEN credit_balance >= 30 THEN '30-39 credits'
    WHEN credit_balance >= 20 THEN '20-29 credits'
    WHEN credit_balance >= 10 THEN '10-19 credits'
    WHEN credit_balance >= 1 THEN '1-9 credits'
    ELSE '0 credits'
  END
ORDER BY MIN(credit_balance) DESC;

-- Query 2.3: Blocked sessions due to insufficient credits
-- Expected: Some blocked sessions (normal behavior) ✅
-- If 0 blocked but many 0-credit users: Blocking not working ⚠️
SELECT
  COUNT(*) as total_blocked_sessions,
  COUNT(DISTINCT user_id) as unique_users_blocked,
  MIN(created_at) as first_blocked_at,
  MAX(created_at) as last_blocked_at
FROM goal_sessions
WHERE is_credit_blocked = true
  AND created_at >= NOW() - INTERVAL '24 hours';

-- Query 2.4: Credit purchases (revenue impact)
-- Expected: Increasing as users run out of free credits ✅
-- If 0 purchases: Users may be churning instead of buying ⚠️
SELECT
  COUNT(*) as total_purchases,
  SUM(credits_added) as total_credits_sold,
  ROUND(AVG(credits_added), 2) as avg_credits_per_purchase,
  SUM(metadata->>'amount_usd'::numeric) as total_revenue_usd
FROM credit_transactions
WHERE created_at >= NOW() - INTERVAL '24 hours'
  AND transaction_type = 'purchase';

-- Query 2.5: Top credit consumers
-- Expected: Active traders consuming credits ✅
-- Useful for identifying power users and pricing optimization
SELECT
  up.email,
  up.credit_balance as current_balance,
  COUNT(ct.id) as total_deductions,
  SUM(ct.credits_deducted) as total_credits_used,
  MIN(ct.created_at) as first_deduction,
  MAX(ct.created_at) as last_deduction,
  ROUND(
    SUM(ct.credits_deducted) / NULLIF(
      EXTRACT(EPOCH FROM (MAX(ct.created_at) - MIN(ct.created_at))) / 3600, 0
    ), 2
  ) as credits_per_hour
FROM user_profiles up
INNER JOIN credit_transactions ct ON ct.user_id = up.id
WHERE ct.created_at >= NOW() - INTERVAL '24 hours'
  AND ct.transaction_type = 'signal_deduction'
  AND ct.credits_deducted > 0
GROUP BY up.id, up.email, up.credit_balance
ORDER BY total_credits_used DESC
LIMIT 20;

-- ============================================================================
-- SECTION 3: LONG-TERM VALIDATION (7 Days)
-- ============================================================================

-- Query 3.1: Credit burn rate trends
-- Expected: Stable burn rate over time ✅
-- If increasing: More active trading (good)
-- If decreasing: User churn or blocked sessions (investigate)
SELECT
  DATE(created_at) as date,
  COUNT(*) as deductions,
  SUM(credits_deducted) as total_credits_burned,
  COUNT(DISTINCT user_id) as active_users,
  ROUND(AVG(credits_deducted), 2) as avg_per_deduction,
  ROUND(SUM(credits_deducted)::numeric / COUNT(DISTINCT user_id), 2) as credits_per_user
FROM credit_transactions
WHERE created_at >= NOW() - INTERVAL '7 days'
  AND transaction_type = 'signal_deduction'
  AND credits_deducted > 0
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Query 3.2: Credit lifecycle analysis
-- Time from signup to first purchase
-- Expected: Most users purchase within 1-3 days after running out ✅
WITH user_lifecycle AS (
  SELECT
    up.id as user_id,
    up.email,
    up.created_at as signup_date,
    MIN(CASE WHEN ct.transaction_type = 'signal_deduction' THEN ct.created_at END) as first_deduction,
    MIN(CASE WHEN ct.transaction_type = 'purchase' THEN ct.created_at END) as first_purchase,
    SUM(CASE WHEN ct.transaction_type = 'signal_deduction' THEN ct.credits_deducted ELSE 0 END) as total_deducted,
    SUM(CASE WHEN ct.transaction_type = 'purchase' THEN ct.credits_added ELSE 0 END) as total_purchased
  FROM user_profiles up
  LEFT JOIN credit_transactions ct ON ct.user_id = up.id
  WHERE up.created_at >= NOW() - INTERVAL '7 days'
  GROUP BY up.id, up.email, up.created_at
)
SELECT
  email,
  signup_date,
  first_deduction,
  first_purchase,
  EXTRACT(EPOCH FROM (first_purchase - signup_date)) / 3600 as hours_to_first_purchase,
  total_deducted as credits_used_before_purchase,
  total_purchased as total_credits_bought,
  CASE
    WHEN first_purchase IS NULL THEN '⏳ No purchase yet'
    WHEN EXTRACT(EPOCH FROM (first_purchase - signup_date)) / 3600 < 24 THEN '✅ Purchased < 24hr'
    WHEN EXTRACT(EPOCH FROM (first_purchase - signup_date)) / 3600 < 72 THEN '✓ Purchased < 3 days'
    ELSE '⚠️ Purchased > 3 days'
  END as conversion_speed
FROM user_lifecycle
WHERE first_deduction IS NOT NULL
ORDER BY signup_date DESC;

-- Query 3.3: Revenue per active user
-- Expected: Increasing over time as users buy more ✅
-- Useful for LTV calculations
SELECT
  DATE(ct.created_at) as date,
  COUNT(DISTINCT ct.user_id) as active_purchasers,
  SUM(ct.credits_added) as total_credits_sold,
  SUM((ct.metadata->>'amount_usd')::numeric) as total_revenue,
  ROUND(AVG((ct.metadata->>'amount_usd')::numeric), 2) as avg_purchase_value,
  ROUND(SUM((ct.metadata->>'amount_usd')::numeric) / COUNT(DISTINCT ct.user_id), 2) as revenue_per_user
FROM credit_transactions ct
WHERE ct.created_at >= NOW() - INTERVAL '7 days'
  AND ct.transaction_type = 'purchase'
GROUP BY DATE(ct.created_at)
ORDER BY date DESC;

-- ============================================================================
-- SECTION 4: ERROR DETECTION
-- ============================================================================

-- Query 4.1: Detect phantom deductions (deduction without trade)
-- Expected: 0 rows ✅
-- If found: Credits deducted but trade not created ❌
WITH deductions_without_trades AS (
  SELECT
    ct.id as transaction_id,
    ct.user_id,
    ct.created_at as deduction_time,
    ct.metadata->>'symbol' as symbol,
    ct.metadata->>'intentId' as intent_id,
    ct.credits_deducted
  FROM credit_transactions ct
  WHERE ct.created_at >= NOW() - INTERVAL '24 hours'
    AND ct.transaction_type = 'signal_deduction'
    AND ct.credits_deducted = 10
    AND NOT EXISTS (
      SELECT 1
      FROM goal_session_trades t
      WHERE t.user_id = ct.user_id
        AND t.symbol = ct.metadata->>'symbol'
        AND t.created_at BETWEEN ct.created_at AND ct.created_at + INTERVAL '30 seconds'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM entry_intents ei
      WHERE ei.user_id = ct.user_id
        AND ei.symbol = ct.metadata->>'symbol'
        AND ei.created_at BETWEEN ct.created_at - INTERVAL '5 seconds' AND ct.created_at + INTERVAL '5 seconds'
    )
)
SELECT
  COUNT(*) as phantom_deductions,
  SUM(credits_deducted) as total_credits_lost,
  COUNT(DISTINCT user_id) as affected_users
FROM deductions_without_trades;

-- Query 4.2: Detect trades without deductions
-- Expected: 0 immediate trades without deduction ✅
-- If found: Free trades slipping through ❌
SELECT
  t.id as trade_id,
  t.user_id,
  t.symbol,
  t.entry_intent_type,
  t.created_at as trade_time,
  'NO DEDUCTION FOUND' as error
FROM goal_session_trades t
WHERE t.created_at >= NOW() - INTERVAL '24 hours'
  AND NOT EXISTS (
    SELECT 1
    FROM credit_transactions ct
    WHERE ct.user_id = t.user_id
      AND ct.transaction_type = 'signal_deduction'
      AND ct.metadata->>'symbol' = t.symbol
      AND ct.created_at BETWEEN t.created_at - INTERVAL '10 seconds' AND t.created_at + INTERVAL '2 seconds'
  )
ORDER BY t.created_at DESC;

-- ============================================================================
-- SECTION 5: HEALTH SUMMARY DASHBOARD
-- ============================================================================

-- Query 5: Overall system health (run this first)
-- Provides a quick health check of the credit system
WITH metrics AS (
  SELECT
    -- Deductions
    (SELECT COUNT(*) FROM credit_transactions WHERE created_at >= NOW() - INTERVAL '24 hours' AND transaction_type = 'signal_deduction' AND credits_deducted > 0) as successful_deductions,
    (SELECT COUNT(*) FROM credit_transactions WHERE created_at >= NOW() - INTERVAL '24 hours' AND transaction_type = 'signal_deduction' AND credits_deducted = 0) as failed_deductions,

    -- Trades
    (SELECT COUNT(*) FROM goal_session_trades WHERE created_at >= NOW() - INTERVAL '24 hours') as total_trades,

    -- Purchases
    (SELECT COUNT(*) FROM credit_transactions WHERE created_at >= NOW() - INTERVAL '24 hours' AND transaction_type = 'purchase') as purchases,
    (SELECT COALESCE(SUM((metadata->>'amount_usd')::numeric), 0) FROM credit_transactions WHERE created_at >= NOW() - INTERVAL '24 hours' AND transaction_type = 'purchase') as revenue,

    -- Users
    (SELECT COUNT(*) FROM user_profiles WHERE credit_balance = 0) as users_at_zero,
    (SELECT COUNT(*) FROM user_profiles WHERE credit_balance BETWEEN 1 AND 10) as users_low_credits,
    (SELECT COUNT(*) FROM goal_sessions WHERE is_credit_blocked = true AND created_at >= NOW() - INTERVAL '24 hours') as blocked_sessions
)
SELECT
  '=== CREDIT SYSTEM HEALTH (Last 24 Hours) ===' as section,
  '' as blank1,
  'DEDUCTIONS:' as deductions_label,
  successful_deductions || ' successful' as deductions_success,
  failed_deductions || ' failed' as deductions_failed,
  ROUND((successful_deductions::numeric / NULLIF(successful_deductions + failed_deductions, 0) * 100), 2) || '% success rate' as success_rate,
  '' as blank2,
  'TRADES:' as trades_label,
  total_trades || ' trades executed' as trades_count,
  '' as blank3,
  'REVENUE:' as revenue_label,
  purchases || ' purchases' as purchases_count,
  '$' || ROUND(revenue, 2) || ' revenue' as revenue_amount,
  '' as blank4,
  'USERS:' as users_label,
  users_at_zero || ' users at 0 credits' as zero_credits,
  users_low_credits || ' users below 10 credits' as low_credits,
  blocked_sessions || ' blocked sessions' as blocked_count
FROM metrics;

-- ============================================================================
-- INSTRUCTIONS
-- ============================================================================
-- 1. Run Section 1 queries 1 hour after deployment
-- 2. Run Section 2 queries 24 hours after deployment
-- 3. Run Section 3 queries 7 days after deployment
-- 4. Run Section 4 queries anytime errors suspected
-- 5. Run Section 5 dashboard query for quick health check
-- ============================================================================
