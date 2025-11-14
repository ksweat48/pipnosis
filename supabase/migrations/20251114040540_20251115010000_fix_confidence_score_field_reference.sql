/*
  # Fix confidence_score Field Reference

  ## Problem
  The analyze_auto_backtest_for_learning function references v_trade.confidence_score
  but the synthetic_backtest_trades table has flow_v2_confidence instead.

  ## Solution
  Update the function to use flow_v2_confidence instead of confidence_score
*/

-- ============================================================================
-- Fix the analyze_auto_backtest_for_learning function
-- ============================================================================

CREATE OR REPLACE FUNCTION analyze_auto_backtest_for_learning(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_session RECORD;
  v_trade RECORD;
  v_total_trades int := 0;
  v_winning_trades int := 0;
  v_insights_created int := 0;
  v_analyses_created int := 0;
  v_user_id uuid;
BEGIN
  RAISE NOTICE '[AI Learning] Analyzing session % for learning...', p_session_id;

  SELECT * INTO v_session
  FROM synthetic_backtest_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session % not found', p_session_id;
  END IF;

  v_user_id := v_session.user_id;

  SELECT
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE outcome = 'win') as wins
  INTO v_total_trades, v_winning_trades
  FROM synthetic_backtest_trades
  WHERE session_id = p_session_id;

  RAISE NOTICE '[AI Learning] Session has % trades (% wins)', v_total_trades, v_winning_trades;

  FOR v_trade IN
    SELECT * FROM synthetic_backtest_trades
    WHERE session_id = p_session_id
  LOOP
    INSERT INTO ai_trade_analysis (
      user_id,
      synthetic_trade_id,
      symbol,
      direction,
      outcome,
      pnl,
      entry_time,
      entry_confidence,
      entry_market_conditions,
      entry_indicators_alignment,
      entry_quality_score,
      decision_reasoning,
      matching_historical_patterns,
      ai_conviction_level,
      risk_reward_at_entry,
      exit_time,
      exit_reason,
      exit_market_conditions,
      was_exit_optimal,
      key_learnings,
      mistakes_identified,
      what_worked,
      what_failed,
      similar_trades_count,
      similar_trades_win_rate,
      is_pattern_repeating
    ) VALUES (
      v_user_id,
      v_trade.id,
      v_trade.symbol,
      v_trade.direction,
      v_trade.outcome,
      v_trade.pnl,
      v_trade.entry_time,
      COALESCE(v_trade.flow_v2_confidence, 75),
      '{}'::jsonb,
      jsonb_build_object('h1_trend', v_trade.direction),
      CASE WHEN v_trade.outcome = 'win' THEN 85 ELSE 50 END,
      format('%s %s trade with %s pips', v_trade.symbol, v_trade.direction, v_trade.pips_gained),
      ARRAY[format('%s_%s', v_trade.symbol, v_trade.direction)],
      COALESCE(v_trade.flow_v2_confidence, 75),
      v_trade.risk_reward_ratio,
      v_trade.exit_time,
      v_trade.exit_reason,
      '{}'::jsonb,
      v_trade.outcome = 'win',
      ARRAY[format('%s trade %s', v_trade.outcome, CASE WHEN v_trade.outcome = 'win' THEN 'validated pattern' ELSE 'needs refinement' END)],
      CASE WHEN v_trade.outcome = 'loss' THEN ARRAY['Entry timing could improve'] ELSE ARRAY[]::text[] END,
      CASE WHEN v_trade.outcome = 'win' THEN ARRAY['Setup confirmation was good', 'Exit timing optimal'] ELSE ARRAY[]::text[] END,
      CASE WHEN v_trade.outcome = 'loss' THEN ARRAY['Setup was weak', 'Market conditions unfavorable'] ELSE ARRAY[]::text[] END,
      0,
      0,
      false
    );

    v_analyses_created := v_analyses_created + 1;
  END LOOP;

  IF v_winning_trades >= 2 THEN
    INSERT INTO ai_learning_insights (
      user_id,
      synthetic_session_id,
      is_from_live_trading,
      insight_type,
      symbol,
      timeframe,
      market_scenario,
      volatility_level,
      trend_direction,
      insight_title,
      insight_description,
      pattern_features,
      sample_size,
      win_rate,
      avg_profit_factor,
      confidence_score,
      recommended_action,
      apply_when_conditions,
      avoid_when_conditions,
      importance_weight
    ) VALUES (
      v_user_id,
      p_session_id,
      false,
      'pattern_discovery',
      v_session.symbols[1],
      'H1',
      v_session.market_scenario,
      'medium',
      'mixed',
      format('Winning pattern discovered: %s wins out of %s trades', v_winning_trades, v_total_trades),
      format('Pattern shows consistency with %s%% win rate', ROUND((v_winning_trades::numeric / v_total_trades::numeric) * 100)),
      jsonb_build_object('session_id', p_session_id, 'win_rate', ROUND((v_winning_trades::numeric / v_total_trades::numeric) * 100)),
      v_total_trades,
      ROUND((v_winning_trades::numeric / v_total_trades::numeric) * 100),
      v_session.profit_factor,
      CASE
        WHEN v_winning_trades::numeric / v_total_trades::numeric >= 0.65 THEN 90
        WHEN v_winning_trades::numeric / v_total_trades::numeric >= 0.55 THEN 75
        ELSE 60
      END,
      'Continue monitoring and refining',
      jsonb_build_object('conditions', 'Similar market scenarios'),
      jsonb_build_object('conditions', 'Avoid low volatility'),
      CASE
        WHEN v_winning_trades::numeric / v_total_trades::numeric >= 0.65 THEN 0.9
        WHEN v_winning_trades::numeric / v_total_trades::numeric >= 0.55 THEN 0.7
        ELSE 0.5
      END
    );

    v_insights_created := v_insights_created + 1;
  END IF;

  INSERT INTO ai_performance_evolution (
    user_id,
    session_id,
    session_type,
    trades_analyzed,
    winning_trades,
    losing_trades,
    win_rate_achieved,
    profit_factor,
    patterns_discovered,
    insights_generated,
    skill_level_progress,
    mistakes_corrected,
    new_capabilities_unlocked
  ) VALUES (
    v_user_id,
    p_session_id,
    'synthetic_backtest',
    v_total_trades,
    v_winning_trades,
    v_total_trades - v_winning_trades,
    CASE WHEN v_total_trades > 0 THEN ROUND((v_winning_trades::numeric / v_total_trades::numeric) * 100) ELSE 0 END,
    v_session.profit_factor,
    1,
    v_insights_created,
    LEAST(100, v_winning_trades * 5),
    GREATEST(0, (v_total_trades - v_winning_trades)),
    ARRAY['pattern_recognition', 'synthetic_analysis']
  );

  RETURN jsonb_build_object(
    'success', true,
    'session_id', p_session_id,
    'trades_analyzed', v_total_trades,
    'winning_trades', v_winning_trades,
    'analyses_created', v_analyses_created,
    'insights_created', v_insights_created
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING '[AI Learning] Error analyzing session %: % %', p_session_id, SQLERRM, SQLSTATE;
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM,
      'session_id', p_session_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION analyze_auto_backtest_for_learning(uuid) TO authenticated, anon;
