/*
  # Cleanup Corrupted Trillion-Dollar P&L Data - Core Tables Only

  ## Problem
  - 11 corrupted sessions with quintillion-dollar P&L
  - Profit Factor: 0 to 22,564
  - Position sizing bug: dollars treated as lots

  ## Solution
  Delete corrupted data from core tables.
*/

BEGIN;

DO $$
DECLARE
  v_deleted_sessions INTEGER := 0;
  v_deleted_trades INTEGER := 0;
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Cleaning Corrupted P&L Data';
  RAISE NOTICE '========================================';

  -- 1. DELETE CORRUPTED DAILY SESSIONS
  RAISE NOTICE '1. Deleting corrupted sessions...';
  WITH deleted AS (
    DELETE FROM daily_session_results
    WHERE month_number = 1
      AND (ABS(pnl) > 10000 OR profit_factor > 100 OR profit_factor < 0 OR total_trades > 50)
    RETURNING *
  )
  SELECT COUNT(*) INTO v_deleted_sessions FROM deleted;
  RAISE NOTICE '   ✓ Deleted % sessions', v_deleted_sessions;

  -- 2. DELETE CORRUPTED TRADES
  RAISE NOTICE '2. Deleting corrupted trades...';
  WITH deleted AS (
    DELETE FROM trade_history
    WHERE strategy_name LIKE '%Month-1%'
      AND (ABS(profit_loss) > 1000 OR lot_size > 10 OR lot_size < 0.001)
    RETURNING *
  )
  SELECT COUNT(*) INTO v_deleted_trades FROM deleted;
  RAISE NOTICE '   ✓ Deleted % trades', v_deleted_trades;

  -- 3. CLEAR KPIS
  RAISE NOTICE '3. Clearing KPIs...';
  DELETE FROM ai_mastery_kpis WHERE date >= '2025-11-01';
  DELETE FROM llm_layer_kpis WHERE date >= '2025-11-01';
  DELETE FROM avoid_pattern_kpis WHERE date >= '2025-11-01';
  DELETE FROM strategy_evolution_kpis WHERE date >= '2025-11-01';
  DELETE FROM continuous_learning_kpis WHERE date >= '2025-11-01';
  DELETE FROM daily_meta_analysis WHERE date >= '2025-11-01';
  DELETE FROM daily_learning_insights WHERE month_number = 1;
  DELETE FROM kpi_anomalies WHERE detected_at >= '2025-11-01';
  RAISE NOTICE '   ✓ Cleared KPIs';

  -- 4. RESET AUTO-BACKTEST STATE
  RAISE NOTICE '4. Resetting backtest state...';
  UPDATE auto_backtest_global_state
  SET current_month_number = 1, current_day_in_month = 0, is_running = false, updated_at = NOW();
  RAISE NOTICE '   ✓ Reset state';

  -- 5. CLEAR LEARNING DATA
  RAISE NOTICE '5. Clearing learning data...';
  DELETE FROM ai_session_learnings WHERE session_date >= '2025-11-01';
  RAISE NOTICE '   ✓ Cleared learning';

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Cleanup Complete!';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Deleted: % sessions, % trades', v_deleted_sessions, v_deleted_trades;
  RAISE NOTICE 'Status: CLEAN - READY FOR FRESH DATA';
  RAISE NOTICE 'Expected: Realistic P&L ($50-$300/trade)';
  RAISE NOTICE '========================================';

END $$;

COMMIT;
