-- EQS Confidence Modifier Monitoring Queries
-- Run these queries at T+6h, T+24h, T+48h, and T+7d intervals

-- ============================================================================
-- QUERY 1: Execution Rate by Confidence Bucket (Last 48 Hours)
-- ============================================================================
SELECT
  CASE
    WHEN alpha_confidence >= 95 THEN '95-100'
    WHEN alpha_confidence >= 85 THEN '85-94'
    WHEN alpha_confidence >= 75 THEN '75-84'
    WHEN alpha_confidence >= 65 THEN '65-74'
    ELSE '<65'
  END as confidence_bucket,
  COUNT(*) as total_intents,
  COUNT(CASE WHEN status = 'executed' THEN 1 END) as executed,
  COUNT(CASE WHEN status = 'monitoring' THEN 1 END) as monitoring,
  COUNT(CASE WHEN status = 'expired' THEN 1 END) as expired,
  ROUND(100.0 * COUNT(CASE WHEN status = 'executed' THEN 1 END) / NULLIF(COUNT(*), 0), 2) as execution_rate_pct
FROM entry_intents
WHERE created_at >= NOW() - INTERVAL '48 hours'
GROUP BY confidence_bucket
ORDER BY confidence_bucket DESC;

-- ============================================================================
-- QUERY 2: Win Rate by Confidence Bucket (Last 48 Hours)
-- ============================================================================
SELECT
  CASE
    WHEN alpha_confidence >= 95 THEN '95-100'
    WHEN alpha_confidence >= 85 THEN '85-94'
    WHEN alpha_confidence >= 75 THEN '75-84'
    WHEN alpha_confidence >= 65 THEN '65-74'
    ELSE '<65'
  END as confidence_bucket,
  COUNT(*) as total_trades,
  COUNT(CASE WHEN realized_pnl > 0 THEN 1 END) as wins,
  COUNT(CASE WHEN realized_pnl < 0 THEN 1 END) as losses,
  COUNT(CASE WHEN realized_pnl = 0 THEN 1 END) as breakeven,
  ROUND(100.0 * COUNT(CASE WHEN realized_pnl > 0 THEN 1 END) / NULLIF(COUNT(*), 0), 2) as win_rate_pct,
  ROUND(AVG(realized_pnl), 2) as avg_pnl,
  ROUND(SUM(realized_pnl), 2) as total_pnl
FROM goal_session_trades
WHERE created_at >= NOW() - INTERVAL '48 hours'
  AND close_reason IN ('stop_loss', 'take_profit', 'take_profit_1', 'take_profit_2')
  AND alpha_confidence IS NOT NULL
GROUP BY confidence_bucket
ORDER BY confidence_bucket DESC;

-- ============================================================================
-- QUERY 3: EQS vs Dynamic Threshold Analysis (Last 50 Trades)
-- ============================================================================
SELECT
  symbol,
  alpha_confidence,
  entry_quality_score as eqs,
  ROUND(70 * CASE
    WHEN alpha_confidence >= 95 THEN 1.1
    WHEN alpha_confidence >= 85 THEN 1.0
    WHEN alpha_confidence >= 75 THEN 0.9
    WHEN alpha_confidence >= 65 THEN 0.85
    ELSE 0.8
  END, 2) as effective_threshold,
  ROUND(entry_quality_score - (70 * CASE
    WHEN alpha_confidence >= 95 THEN 1.1
    WHEN alpha_confidence >= 85 THEN 1.0
    WHEN alpha_confidence >= 75 THEN 0.9
    WHEN alpha_confidence >= 65 THEN 0.85
    ELSE 0.8
  END), 2) as margin_above_threshold,
  CASE WHEN realized_pnl > 0 THEN '✅ WIN' ELSE '❌ LOSS' END as outcome,
  close_reason,
  created_at
FROM goal_session_trades
WHERE created_at >= NOW() - INTERVAL '48 hours'
  AND entry_quality_score IS NOT NULL
  AND alpha_confidence IS NOT NULL
ORDER BY created_at DESC
LIMIT 50;

-- ============================================================================
-- QUERY 4: Quick Health Check (Last 6 Hours)
-- ============================================================================
WITH recent_trades AS (
  SELECT
    alpha_confidence,
    entry_quality_score,
    realized_pnl > 0 as is_win,
    realized_pnl,
    created_at
  FROM goal_session_trades
  WHERE created_at >= NOW() - INTERVAL '6 hours'
    AND close_reason IS NOT NULL
    AND alpha_confidence IS NOT NULL
)
SELECT
  COUNT(*) as trades_last_6h,
  ROUND(AVG(alpha_confidence), 2) as avg_confidence,
  ROUND(AVG(entry_quality_score), 2) as avg_eqs,
  ROUND(100.0 * COUNT(*) FILTER (WHERE is_win) / NULLIF(COUNT(*), 0), 2) as win_rate_pct,
  ROUND(AVG(realized_pnl), 2) as avg_pnl,
  ROUND(SUM(realized_pnl), 2) as total_pnl,
  MIN(created_at) as period_start,
  MAX(created_at) as period_end
FROM recent_trades;

-- ============================================================================
-- QUERY 5: Hourly Pattern Analysis (Last 48 Hours)
-- ============================================================================
SELECT
  DATE_TRUNC('hour', created_at) as hour,
  COUNT(*) as executions,
  ROUND(AVG(alpha_confidence), 2) as avg_confidence,
  ROUND(STDDEV(alpha_confidence), 2) as conf_stddev,
  ROUND(MIN(entry_quality_score), 2) as min_eqs,
  ROUND(AVG(entry_quality_score), 2) as avg_eqs,
  ROUND(MAX(entry_quality_score), 2) as max_eqs,
  COUNT(CASE WHEN realized_pnl > 0 THEN 1 END) as wins,
  ROUND(100.0 * COUNT(CASE WHEN realized_pnl > 0 THEN 1 END) / NULLIF(COUNT(*), 0), 2) as win_rate_pct
FROM goal_session_trades
WHERE created_at >= NOW() - INTERVAL '48 hours'
  AND alpha_confidence IS NOT NULL
GROUP BY hour
ORDER BY hour DESC;

-- ============================================================================
-- QUERY 6: Pre vs Post Deployment Comparison
-- ============================================================================
-- NOTE: Update DEPLOYMENT_TIMESTAMP with actual deployment time
WITH deployment_time AS (
  SELECT TIMESTAMP '2026-01-22 00:00:00' as deploy_ts
),
pre_deploy AS (
  SELECT
    'PRE-DEPLOY' as period,
    COUNT(*) as trades,
    ROUND(AVG(alpha_confidence), 2) as avg_confidence,
    ROUND(AVG(entry_quality_score), 2) as avg_eqs,
    ROUND(100.0 * COUNT(CASE WHEN realized_pnl > 0 THEN 1 END) / NULLIF(COUNT(*), 0), 2) as win_rate,
    ROUND(AVG(realized_pnl), 2) as avg_pnl
  FROM goal_session_trades, deployment_time
  WHERE created_at >= deploy_ts - INTERVAL '48 hours'
    AND created_at < deploy_ts
    AND close_reason IS NOT NULL
),
post_deploy AS (
  SELECT
    'POST-DEPLOY' as period,
    COUNT(*) as trades,
    ROUND(AVG(alpha_confidence), 2) as avg_confidence,
    ROUND(AVG(entry_quality_score), 2) as avg_eqs,
    ROUND(100.0 * COUNT(CASE WHEN realized_pnl > 0 THEN 1 END) / NULLIF(COUNT(*), 0), 2) as win_rate,
    ROUND(AVG(realized_pnl), 2) as avg_pnl
  FROM goal_session_trades, deployment_time
  WHERE created_at >= deploy_ts
    AND created_at < deploy_ts + INTERVAL '48 hours'
    AND close_reason IS NOT NULL
)
SELECT * FROM pre_deploy
UNION ALL
SELECT * FROM post_deploy;

-- ============================================================================
-- QUERY 7: Alert Check - Critical Thresholds
-- ============================================================================
WITH recent_stats AS (
  SELECT
    CASE
      WHEN alpha_confidence >= 95 THEN '95-100'
      WHEN alpha_confidence >= 85 THEN '85-94'
      WHEN alpha_confidence >= 75 THEN '75-84'
      WHEN alpha_confidence >= 65 THEN '65-74'
      ELSE '<65'
    END as confidence_bucket,
    COUNT(*) as trades,
    COUNT(CASE WHEN realized_pnl > 0 THEN 1 END) as wins,
    ROUND(100.0 * COUNT(CASE WHEN realized_pnl > 0 THEN 1 END) / NULLIF(COUNT(*), 0), 2) as win_rate
  FROM goal_session_trades
  WHERE created_at >= NOW() - INTERVAL '24 hours'
    AND close_reason IS NOT NULL
    AND alpha_confidence IS NOT NULL
  GROUP BY confidence_bucket
)
SELECT
  confidence_bucket,
  trades,
  wins,
  win_rate,
  CASE
    WHEN win_rate < 40 THEN '🔴 CRITICAL: Win rate below 40%'
    WHEN win_rate < 45 AND confidence_bucket IN ('85-94', '95-100') THEN '🟡 WARNING: Win rate below 45% for high confidence'
    WHEN trades = 0 AND confidence_bucket IN ('85-94', '95-100') THEN '🔴 CRITICAL: No executions for high confidence'
    ELSE '🟢 OK'
  END as alert_status
FROM recent_stats
ORDER BY confidence_bucket DESC;

-- ============================================================================
-- QUERY 8: Symbol Distribution by Confidence
-- ============================================================================
SELECT
  symbol,
  CASE
    WHEN alpha_confidence >= 95 THEN '95-100'
    WHEN alpha_confidence >= 85 THEN '85-94'
    WHEN alpha_confidence >= 75 THEN '75-84'
    WHEN alpha_confidence >= 65 THEN '65-74'
    ELSE '<65'
  END as confidence_bucket,
  COUNT(*) as trades,
  ROUND(AVG(entry_quality_score), 2) as avg_eqs,
  ROUND(100.0 * COUNT(CASE WHEN realized_pnl > 0 THEN 1 END) / NULLIF(COUNT(*), 0), 2) as win_rate,
  ROUND(SUM(realized_pnl), 2) as total_pnl
FROM goal_session_trades
WHERE created_at >= NOW() - INTERVAL '48 hours'
  AND alpha_confidence IS NOT NULL
GROUP BY symbol, confidence_bucket
ORDER BY symbol, confidence_bucket DESC;
