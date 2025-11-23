-- ============================================================
-- LLM Trading Diagnostic Query
-- ============================================================
-- Purpose: Identify exactly why no trades are being generated
-- Run this AFTER completing a backtest session
-- ============================================================

-- 1. Check recent pipeline executions and where they failed
SELECT
  symbol,
  trigger_type,
  hard_gate_result,
  layer_1_passed,
  layer_2_passed,
  layer_3_passed,
  layer_4_completed,
  layer_5_executed,
  final_decision,
  abort_layer,
  abort_reason,
  total_tokens_used,
  created_at
FROM llm_pipeline_execution_log
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC
LIMIT 20;

-- 2. Layer-by-layer rejection analysis
SELECT
  layer_number,
  layer_name,
  decision_outcome,
  passed_to_next_layer,
  COUNT(*) as occurrences,
  AVG(processing_time_ms) as avg_time_ms,
  SUM(tokens_used) as total_tokens
FROM llm_layer_decision_log
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY layer_number, layer_name, decision_outcome, passed_to_next_layer
ORDER BY layer_number, occurrences DESC;

-- 3. Check if triggers are being detected at all
SELECT
  COUNT(DISTINCT id) as total_pipeline_executions,
  COUNT(DISTINCT CASE WHEN trigger_type IS NOT NULL THEN id END) as executions_with_triggers,
  COUNT(DISTINCT CASE WHEN layer_1_passed = true THEN id END) as passed_layer_1,
  COUNT(DISTINCT CASE WHEN layer_2_passed = true THEN id END) as passed_layer_2,
  COUNT(DISTINCT CASE WHEN layer_3_passed = true THEN id END) as passed_layer_3,
  COUNT(DISTINCT CASE WHEN layer_4_completed = true THEN id END) as completed_layer_4,
  COUNT(DISTINCT CASE WHEN layer_5_executed = true THEN id END) as executed_layer_5,
  COUNT(DISTINCT CASE WHEN final_decision = 'BUY' OR final_decision = 'SELL' THEN id END) as trades_approved
FROM llm_pipeline_execution_log
WHERE created_at > NOW() - INTERVAL '1 hour';

-- 4. Most common abort reasons
SELECT
  abort_layer,
  abort_reason,
  COUNT(*) as occurrences
FROM llm_pipeline_execution_log
WHERE created_at > NOW() - INTERVAL '1 hour'
  AND abort_layer IS NOT NULL
GROUP BY abort_layer, abort_reason
ORDER BY occurrences DESC;

-- 5. Check recent backtest sessions
SELECT
  session_name,
  symbol,
  used_llm,
  candles_processed,
  triggers_detected,
  llm_calls_made,
  trades_executed,
  win_rate,
  profit_factor,
  trigger_to_trade_ratio,
  created_at
FROM event_based_backtest_sessions
WHERE created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 5;

-- 6. Check developer mode settings
SELECT
  user_id,
  enabled,
  log_all_layers,
  log_to_console,
  log_to_database,
  updated_at
FROM developer_mode_settings;

-- 7. Token usage analysis
SELECT
  SUM(total_tokens_used) as total_tokens_consumed,
  AVG(total_tokens_used) as avg_tokens_per_execution,
  MAX(total_tokens_used) as max_tokens_single_execution,
  COUNT(*) as total_executions
FROM llm_pipeline_execution_log
WHERE created_at > NOW() - INTERVAL '1 hour';

-- ============================================================
-- EXPECTED RESULTS INTERPRETATION
-- ============================================================
--
-- If Query #1 returns 0 rows:
--   → Pipeline is not being called at all
--   → Check if triggers are being detected
--   → Verify LLM is enabled in config
--
-- If Query #2 shows Layer 1 rejections:
--   → Regime validator is too strict
--   → Check if fallback mode is working
--   → Review regime validation logic
--
-- If Query #2 shows Layer 2 rejections:
--   → Setup quality scorer is rejecting setups
--   → Review quality threshold (default 65)
--   → Check if quality scoring is too harsh
--
-- If Query #2 shows Layer 3 rejections:
--   → Mistake prevention is blocking trades
--   → Check risk level assessments
--   → Review historical pattern matches
--
-- If Query #5 shows triggers_detected > 0 but trades_executed = 0:
--   → Triggers are being found
--   → Pipeline is rejecting all of them
--   → Focus on layer rejection reasons in Query #4
--
-- If Query #5 shows triggers_detected = 0:
--   → No triggers being found
--   → Market data issue OR
--   → Trigger detection rules too strict
--
-- ============================================================
