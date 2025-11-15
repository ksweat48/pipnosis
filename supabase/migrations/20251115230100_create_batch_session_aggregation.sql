/*
  # Batch Session Aggregation Functions

  ## Overview
  Functions to aggregate performance data from 100 backtest sessions for GPT-4o analysis.
  These functions collect comprehensive statistics across the batch of sessions.

  ## Functions
  1. aggregate_100_sessions_data - Collects all data from last 100 sessions
  2. get_sessions_for_milestone - Fetches session IDs for a milestone
  3. calculate_batch_performance - Calculates aggregate metrics
*/

-- ============================================================================
-- Get 100 Most Recent Completed Sessions for User
-- ============================================================================

CREATE OR REPLACE FUNCTION get_last_100_sessions(p_user_id uuid)
RETURNS TABLE (
  session_id uuid,
  session_name text,
  total_trades integer,
  win_rate decimal,
  profit_factor decimal,
  total_pnl decimal,
  created_at timestamptz,
  completed_at timestamptz
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    id,
    session_name,
    total_trades,
    win_rate,
    profit_factor,
    total_pnl,
    synthetic_backtest_sessions.created_at,
    completed_at
  FROM synthetic_backtest_sessions
  WHERE user_id = p_user_id
    AND status = 'completed'
    AND total_trades > 0
  ORDER BY completed_at DESC
  LIMIT 100;
END;
$$;

-- ============================================================================
-- Aggregate Performance Data from 100 Sessions
-- ============================================================================

CREATE OR REPLACE FUNCTION aggregate_100_sessions_data(p_user_id uuid, p_session_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_result jsonb;
  v_total_sessions integer;
  v_total_trades integer;
  v_avg_win_rate decimal;
  v_avg_profit_factor decimal;
  v_total_pnl decimal;
  v_best_session RECORD;
  v_worst_session RECORD;
  v_symbol_performance jsonb;
  v_trend_analysis jsonb;
BEGIN
  RAISE NOTICE '[Batch Aggregator] Aggregating data for % sessions', array_length(p_session_ids, 1);

  -- Basic statistics
  SELECT
    COUNT(*) as session_count,
    COALESCE(SUM(total_trades), 0) as total_trades,
    COALESCE(AVG(win_rate), 0) as avg_win_rate,
    COALESCE(AVG(profit_factor), 0) as avg_profit_factor,
    COALESCE(SUM(total_pnl), 0) as total_pnl
  INTO
    v_total_sessions,
    v_total_trades,
    v_avg_win_rate,
    v_avg_profit_factor,
    v_total_pnl
  FROM synthetic_backtest_sessions
  WHERE id = ANY(p_session_ids);

  -- Best performing session
  SELECT
    id,
    session_name,
    win_rate,
    profit_factor,
    total_pnl
  INTO v_best_session
  FROM synthetic_backtest_sessions
  WHERE id = ANY(p_session_ids)
  ORDER BY profit_factor DESC NULLS LAST
  LIMIT 1;

  -- Worst performing session
  SELECT
    id,
    session_name,
    win_rate,
    profit_factor,
    total_pnl
  INTO v_worst_session
  FROM synthetic_backtest_sessions
  WHERE id = ANY(p_session_ids)
  ORDER BY profit_factor ASC NULLS LAST
  LIMIT 1;

  -- Symbol performance across all sessions
  SELECT jsonb_agg(
    jsonb_build_object(
      'symbol', symbol,
      'sessions_traded', sessions_count,
      'avg_win_rate', avg_wr,
      'total_trades', total_t
    )
  )
  INTO v_symbol_performance
  FROM (
    SELECT
      unnest(symbols) as symbol,
      COUNT(*) as sessions_count,
      AVG(win_rate) as avg_wr,
      SUM(total_trades) as total_t
    FROM synthetic_backtest_sessions
    WHERE id = ANY(p_session_ids)
    GROUP BY unnest(symbols)
  ) symbol_stats;

  -- Trend analysis (first 50 vs last 50 sessions)
  WITH first_half AS (
    SELECT AVG(win_rate) as wr, AVG(profit_factor) as pf
    FROM (
      SELECT win_rate, profit_factor
      FROM synthetic_backtest_sessions
      WHERE id = ANY(p_session_ids)
      ORDER BY completed_at ASC
      LIMIT 50
    ) first_50
  ),
  second_half AS (
    SELECT AVG(win_rate) as wr, AVG(profit_factor) as pf
    FROM (
      SELECT win_rate, profit_factor
      FROM synthetic_backtest_sessions
      WHERE id = ANY(p_session_ids)
      ORDER BY completed_at DESC
      LIMIT 50
    ) last_50
  )
  SELECT jsonb_build_object(
    'first_half_win_rate', first_half.wr,
    'second_half_win_rate', second_half.wr,
    'win_rate_trend', CASE
      WHEN second_half.wr > first_half.wr THEN 'improving'
      WHEN second_half.wr < first_half.wr THEN 'declining'
      ELSE 'stable'
    END,
    'first_half_profit_factor', first_half.pf,
    'second_half_profit_factor', second_half.pf,
    'profit_factor_trend', CASE
      WHEN second_half.pf > first_half.pf THEN 'improving'
      WHEN second_half.pf < first_half.pf THEN 'declining'
      ELSE 'stable'
    END
  )
  INTO v_trend_analysis
  FROM first_half, second_half;

  -- Build comprehensive result
  v_result := jsonb_build_object(
    'batch_summary', jsonb_build_object(
      'total_sessions', v_total_sessions,
      'total_trades', v_total_trades,
      'avg_win_rate', ROUND(v_avg_win_rate, 2),
      'avg_profit_factor', ROUND(v_avg_profit_factor, 2),
      'total_pnl', ROUND(v_total_pnl, 2)
    ),
    'best_session', jsonb_build_object(
      'id', v_best_session.id,
      'name', v_best_session.session_name,
      'win_rate', ROUND(v_best_session.win_rate, 2),
      'profit_factor', ROUND(v_best_session.profit_factor, 2),
      'pnl', ROUND(v_best_session.total_pnl, 2)
    ),
    'worst_session', jsonb_build_object(
      'id', v_worst_session.id,
      'name', v_worst_session.session_name,
      'win_rate', ROUND(v_worst_session.win_rate, 2),
      'profit_factor', ROUND(v_worst_session.profit_factor, 2),
      'pnl', ROUND(v_worst_session.total_pnl, 2)
    ),
    'symbol_performance', v_symbol_performance,
    'trend_analysis', v_trend_analysis,
    'aggregated_at', now()
  );

  RAISE NOTICE '[Batch Aggregator] ✅ Aggregation complete: % sessions, % trades, %.2f%% WR',
    v_total_sessions, v_total_trades, v_avg_win_rate;

  RETURN v_result;
END;
$$;

-- ============================================================================
-- Get Learning Insights from 100 Sessions
-- ============================================================================

CREATE OR REPLACE FUNCTION get_batch_learning_insights(p_user_id uuid, p_session_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_insights jsonb;
  v_winning_patterns jsonb;
  v_losing_patterns jsonb;
  v_total_insights integer;
BEGIN
  -- Collect all learning insights from these sessions
  SELECT jsonb_agg(
    jsonb_build_object(
      'insight_type', insight_type,
      'symbol', symbol,
      'title', insight_title,
      'confidence', confidence_score,
      'win_rate', win_rate
    )
  )
  INTO v_insights
  FROM ai_learning_insights
  WHERE user_id = p_user_id
    AND synthetic_session_id = ANY(p_session_ids);

  -- Group winning patterns
  SELECT jsonb_agg(DISTINCT pattern)
  INTO v_winning_patterns
  FROM (
    SELECT jsonb_array_elements_text(pattern_features::jsonb) as pattern
    FROM ai_learning_insights
    WHERE user_id = p_user_id
      AND synthetic_session_id = ANY(p_session_ids)
      AND insight_type = 'winning_pattern'
      AND win_rate >= 60
  ) patterns;

  -- Group losing patterns
  SELECT jsonb_agg(DISTINCT pattern)
  INTO v_losing_patterns
  FROM (
    SELECT jsonb_array_elements_text(pattern_features::jsonb) as pattern
    FROM ai_learning_insights
    WHERE user_id = p_user_id
      AND synthetic_session_id = ANY(p_session_ids)
      AND insight_type = 'losing_pattern'
  ) patterns;

  SELECT COUNT(*) INTO v_total_insights
  FROM ai_learning_insights
  WHERE user_id = p_user_id
    AND synthetic_session_id = ANY(p_session_ids);

  RETURN jsonb_build_object(
    'total_insights', v_total_insights,
    'winning_patterns', COALESCE(v_winning_patterns, '[]'::jsonb),
    'losing_patterns', COALESCE(v_losing_patterns, '[]'::jsonb),
    'all_insights', COALESCE(v_insights, '[]'::jsonb)
  );
END;
$$;

-- ============================================================================
-- Prepare Complete Batch Summary for GPT-4o
-- ============================================================================

CREATE OR REPLACE FUNCTION prepare_batch_summary_for_gpt4o(
  p_user_id uuid,
  p_milestone_log_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_milestone_log RECORD;
  v_session_ids uuid[];
  v_performance_data jsonb;
  v_learning_insights jsonb;
  v_trade_analyses jsonb;
  v_final_summary jsonb;
BEGIN
  -- Get milestone log
  SELECT * INTO v_milestone_log
  FROM session_milestone_log
  WHERE id = p_milestone_log_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Milestone log % not found', p_milestone_log_id;
  END IF;

  -- Get session IDs (last 100 completed sessions)
  SELECT ARRAY_AGG(session_id)
  INTO v_session_ids
  FROM get_last_100_sessions(p_user_id);

  IF array_length(v_session_ids, 1) IS NULL OR array_length(v_session_ids, 1) < 10 THEN
    RAISE EXCEPTION 'Insufficient sessions for batch analysis (found: %)',
      COALESCE(array_length(v_session_ids, 1), 0);
  END IF;

  RAISE NOTICE '[Batch Summary] Preparing summary for % sessions', array_length(v_session_ids, 1);

  -- Update milestone log with session IDs
  UPDATE session_milestone_log
  SET session_ids = v_session_ids
  WHERE id = p_milestone_log_id;

  -- Aggregate performance data
  v_performance_data := aggregate_100_sessions_data(p_user_id, v_session_ids);

  -- Get learning insights
  v_learning_insights := get_batch_learning_insights(p_user_id, v_session_ids);

  -- Get trade analysis summary
  SELECT jsonb_build_object(
    'total_analyses', COUNT(*),
    'avg_confidence', AVG(entry_confidence),
    'patterns_identified', COUNT(DISTINCT unnest(matching_historical_patterns))
  )
  INTO v_trade_analyses
  FROM ai_trade_analysis
  WHERE user_id = p_user_id
    AND synthetic_trade_id IN (
      SELECT id FROM synthetic_backtest_trades
      WHERE session_id = ANY(v_session_ids)
    );

  -- Build final summary
  v_final_summary := jsonb_build_object(
    'milestone_info', jsonb_build_object(
      'milestone_number', v_milestone_log.milestone_number,
      'sessions_range', v_milestone_log.sessions_included_start || '-' || v_milestone_log.sessions_included_end,
      'total_sessions', array_length(v_session_ids, 1)
    ),
    'performance', v_performance_data,
    'learning_insights', v_learning_insights,
    'trade_analyses', v_trade_analyses,
    'prepared_at', now()
  );

  -- Update milestone log with summary
  UPDATE session_milestone_log
  SET
    batch_win_rate = (v_performance_data->'batch_summary'->>'avg_win_rate')::decimal,
    batch_profit_factor = (v_performance_data->'batch_summary'->>'avg_profit_factor')::decimal,
    batch_total_pnl = (v_performance_data->'batch_summary'->>'total_pnl')::decimal,
    total_trades_in_batch = (v_performance_data->'batch_summary'->>'total_trades')::integer
  WHERE id = p_milestone_log_id;

  RAISE NOTICE '[Batch Summary] ✅ Summary prepared successfully';

  RETURN v_final_summary;
END;
$$;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON FUNCTION get_last_100_sessions(uuid) IS
  'Fetches the 100 most recent completed backtest sessions for a user';

COMMENT ON FUNCTION aggregate_100_sessions_data(uuid, uuid[]) IS
  'Aggregates performance metrics across 100 sessions including trends and symbol analysis';

COMMENT ON FUNCTION get_batch_learning_insights(uuid, uuid[]) IS
  'Collects and summarizes all learning insights from 100 sessions';

COMMENT ON FUNCTION prepare_batch_summary_for_gpt4o(uuid, uuid) IS
  'Prepares comprehensive batch summary for GPT-4o strategic analysis';
