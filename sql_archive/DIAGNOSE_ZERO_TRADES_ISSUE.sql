-- ============================================================================
-- ZERO TRADES DIAGNOSTIC SCRIPT
-- Run this in Supabase SQL Editor to diagnose why backtests generate 0 trades
-- ============================================================================

-- Check 1: Are there any synthetic data generations?
SELECT
  'Synthetic Data Generations' as check_name,
  COUNT(*) as count,
  CASE
    WHEN COUNT(*) = 0 THEN '❌ NO SYNTHETIC DATA - This is the problem!'
    ELSE '✅ Synthetic data exists'
  END as status
FROM synthetic_data_generations;

-- Check 2: Do we have synthetic candles?
SELECT
  'Synthetic Candles' as check_name,
  COUNT(*) as total_candles,
  COUNT(DISTINCT symbol) as symbols,
  COUNT(DISTINCT timeframe) as timeframes,
  CASE
    WHEN COUNT(*) = 0 THEN '❌ NO CANDLES - Data generation failed!'
    WHEN COUNT(*) < 100 THEN '⚠️ TOO FEW CANDLES - Need more data'
    ELSE '✅ Sufficient candles'
  END as status
FROM synthetic_candles;

-- Check 3: Candle distribution by symbol and timeframe
SELECT
  symbol,
  timeframe,
  COUNT(*) as candle_count,
  MIN(open_time) as earliest_candle,
  MAX(open_time) as latest_candle,
  CASE
    WHEN COUNT(*) < 50 THEN '⚠️ Insufficient'
    ELSE '✅ Sufficient'
  END as status
FROM synthetic_candles
GROUP BY symbol, timeframe
ORDER BY symbol, timeframe;

-- Check 4: Recent synthetic backtest sessions
SELECT
  session_name,
  execution_mode,
  status,
  total_trades,
  win_rate,
  symbols,
  start_date,
  end_date,
  created_at,
  CASE
    WHEN total_trades = 0 THEN '❌ ZERO TRADES'
    ELSE '✅ Has trades'
  END as trade_status
FROM synthetic_backtest_sessions
ORDER BY created_at DESC
LIMIT 10;

-- Check 5: Check if synthetic generations match session date ranges
SELECT
  sg.id as generation_id,
  sg.symbol,
  sg.start_date as gen_start,
  sg.end_date as gen_end,
  sg.candles_generated,
  COUNT(DISTINCT sbs.id) as sessions_using_this_gen
FROM synthetic_data_generations sg
LEFT JOIN synthetic_backtest_sessions sbs ON sbs.synthetic_generation_id = sg.id
GROUP BY sg.id, sg.symbol, sg.start_date, sg.end_date, sg.candles_generated
ORDER BY sg.created_at DESC;

-- Check 6: Look for error patterns in failed sessions
SELECT
  session_name,
  total_trades,
  CASE
    WHEN total_trades = 0 THEN 'Likely: No candles found OR signal generation failed'
    ELSE 'Has trades'
  END as diagnosis,
  symbols,
  start_date,
  end_date,
  DATE_PART('day', end_date - start_date) as days_span,
  CASE
    WHEN DATE_PART('day', end_date - start_date) < 2 THEN '⚠️ Date range might be too short (< 2 days)'
    WHEN DATE_PART('day', end_date - start_date) < 7 THEN '⚠️ Date range could be longer (< 7 days)'
    ELSE '✅ Date range sufficient'
  END as date_range_status
FROM synthetic_backtest_sessions
WHERE status = 'completed'
ORDER BY created_at DESC
LIMIT 10;

-- Check 7: Auto-backtest global state
SELECT
  current_month_number,
  current_day_in_month,
  is_running,
  last_day_total_trades,
  last_day_win_rate,
  last_error_message,
  last_error_at,
  CASE
    WHEN last_day_total_trades = 0 THEN '❌ Last day had 0 trades'
    ELSE '✅ Last day had trades'
  END as last_day_status
FROM auto_backtest_global_state
ORDER BY updated_at DESC
LIMIT 1;

-- Check 8: Daily session results
SELECT
  month_number,
  day_number,
  session_name,
  selected_pair,
  total_trades,
  win_rate,
  pnl,
  CASE
    WHEN total_trades = 0 THEN '❌ ZERO TRADES'
    ELSE '✅ Has trades'
  END as status
FROM daily_session_results
ORDER BY month_number DESC, day_number DESC
LIMIT 15;

-- ============================================================================
-- DIAGNOSTIC SUMMARY
-- ============================================================================

SELECT '
╔════════════════════════════════════════════════════════════════╗
║              ZERO TRADES DIAGNOSTIC SUMMARY                    ║
╚════════════════════════════════════════════════════════════════╝

Based on the results above:

1. CHECK SYNTHETIC DATA GENERATIONS:
   - If count = 0: Synthetic data is not being generated at all
   - Fix: Check synthetic-data-generator.ts for errors

2. CHECK SYNTHETIC CANDLES:
   - If count = 0: Data generation completed but candles not saved
   - If count < 100: Insufficient data for signal generation
   - Fix: Increase date range or fix candle generation

3. CHECK DATE RANGES:
   - Sessions need at least 7 days of data
   - 7 days = 168 H1, 2016 M5, 10080 M1 candles
   - Short ranges (1-2 days) cause 0 trades

4. CHECK SESSION STATUS:
   - If status = completed but total_trades = 0:
     → No candles found in date range
     → Signal generation failed
     → Database query failed

5. COMMON FIXES:
   ✓ Increase date range from 1 day to 7 days
   ✓ Ensure synthetic_candles table populated
   ✓ Check that generation_id matches in queries
   ✓ Reduce minimum candle requirements in signal logic

6. NEXT STEPS:
   a) If NO synthetic data: Check data generation process
   b) If NO candles: Check candle insertion logic
   c) If candles exist but 0 trades: Check date range matching
   d) If all above OK: Check signal generation logic

' AS diagnostic_summary;

-- ============================================================================
-- EMERGENCY FIX: Generate Test Data
-- ============================================================================

-- Uncomment and run this ONLY if you need to manually create test data:

/*
-- Insert a test synthetic generation record
INSERT INTO synthetic_data_generations (
  id,
  user_id,
  symbol,
  start_date,
  end_date,
  market_scenario,
  candles_generated,
  status
) VALUES (
  gen_random_uuid(),
  'YOUR_USER_ID_HERE', -- Replace with actual user ID
  'EURUSD',
  NOW() - INTERVAL '30 days',
  NOW(),
  'mixed',
  5000,
  'completed'
) RETURNING id;

-- Use the returned ID to insert test candles (not recommended - fix root cause instead)
*/
