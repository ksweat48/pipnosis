/*
  # Remove Unused Tables from Supabase Realtime Publication

  ## Problem
  40 tables are broadcasting Realtime changes via WAL, but only 19 have active
  frontend subscriptions. The remaining 21 tables generate WAL processing overhead
  on every INSERT/UPDATE/DELETE for zero benefit.

  ## Tables Being REMOVED (no active Realtime subscriptions in frontend):
  1.  ai_discovered_strategies
  2.  ai_indicator_experiments
  3.  ai_learning_milestones
  4.  ai_pattern_ev_tracking
  5.  ai_skill_progression
  6.  backtest_sessions
  7.  backtest_trades
  8.  entry_execution_attempts
  9.  entry_execution_audit
  10. entry_intent_server_state
  11. entry_monitor_logs
  12. entry_monitoring_logs
  13. entry_price_recommendations
  14. entry_quality_advisories
  15. entry_thesis_memory
  16. goal_session_scan_results
  17. goal_session_summaries
  18. llm_exit_decisions_log
  19. synthetic_backtest_sessions
  20. synthetic_backtest_trades
  21. vwap_kiss_signals

  ## Tables KEPT (confirmed active Realtime subscriptions):
  ai_trade_journal, alpha_scan_thoughts, candle_cache_invalidation_events,
  club_chat_messages, entry_intents, goal_achievements, goal_notifications,
  goal_session_trades, goal_sessions, governance_alerts,
  governance_compliance_scores, governance_component_health,
  server_monitoring_alerts, session_intelligence_data, trade_closure_events,
  user_feedback, user_feedback_replies, user_profiles, user_token_balance

  ## Impact
  - Eliminates WAL overhead for 21 tables
  - Reduces Supabase Realtime message volume
  - Zero functional impact (no subscribers exist for these tables)
*/

DO $$
DECLARE
  tables_to_remove TEXT[] := ARRAY[
    'ai_discovered_strategies',
    'ai_indicator_experiments',
    'ai_learning_milestones',
    'ai_pattern_ev_tracking',
    'ai_skill_progression',
    'backtest_sessions',
    'backtest_trades',
    'entry_execution_attempts',
    'entry_execution_audit',
    'entry_intent_server_state',
    'entry_monitor_logs',
    'entry_monitoring_logs',
    'entry_price_recommendations',
    'entry_quality_advisories',
    'entry_thesis_memory',
    'goal_session_scan_results',
    'goal_session_summaries',
    'llm_exit_decisions_log',
    'synthetic_backtest_sessions',
    'synthetic_backtest_trades',
    'vwap_kiss_signals'
  ];
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY tables_to_remove
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', tbl);
      RAISE NOTICE 'Removed % from supabase_realtime publication', tbl;
    END IF;
  END LOOP;
END $$;