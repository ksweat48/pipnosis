/*
  # Cleanup Phase 2 - Performance Metrics Reset

  ## Problem
  56 remaining corrupted sessions showing:
  - Profit Factor: 0 to 22,564
  - P&L: -$465 QUINTILLION to +$17 QUINTILLION

  ## Solution
  Delete corrupted sessions and reset skill progression.
*/

BEGIN;

DO $$
DECLARE
  v_deleted_sessions INTEGER := 0;
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Phase 2 Cleanup - Performance Metrics';
  RAISE NOTICE '========================================';

  -- 1. DELETE CORRUPTED SESSIONS
  RAISE NOTICE '1. Deleting corrupted sessions...';
  WITH deleted AS (
    DELETE FROM synthetic_backtest_sessions
    WHERE status = 'completed'
      AND (
        profit_factor > 10 OR
        profit_factor < 0.1 OR
        ABS(total_pnl) > 5000 OR
        total_trades > 50
      )
    RETURNING *
  )
  SELECT COUNT(*) INTO v_deleted_sessions FROM deleted;
  RAISE NOTICE '   ✓ Deleted % sessions', v_deleted_sessions;

  -- 2. RESET SKILL PROGRESSION
  RAISE NOTICE '2. Resetting skill progression...';
  UPDATE ai_skill_progression
  SET
    total_trades_analyzed = 0,
    current_win_rate = 0,
    current_profit_factor = 0,
    progress_to_next_level_percent = 0,
    total_backtests_completed = 0,
    total_synthetic_backtests = 0,
    last_10_session_wr_avg = NULL,
    last_10_session_pf_avg = NULL,
    last_10_session_consistency_pct = NULL,
    last_10_session_wr_spread = NULL,
    last_10_session_pf_average = NULL,
    total_trades_for_pf_calc = 0,
    total_losing_trades = 0,
    updated_at = NOW();
  RAISE NOTICE '   ✓ Reset skill progression';

  -- 3. CLEAR KPIS
  RAISE NOTICE '3. Clearing KPIs...';
  DELETE FROM ai_mastery_kpis WHERE date >= '2025-11-01';
  DELETE FROM smart_goal_kpis WHERE date >= '2025-11-01';
  DELETE FROM kpi_anomalies WHERE detected_at >= '2025-11-01';
  RAISE NOTICE '   ✓ Cleared KPIs';

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Phase 2 Complete!';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Deleted: % sessions', v_deleted_sessions;
  RAISE NOTICE '========================================';

END $$;

COMMIT;
