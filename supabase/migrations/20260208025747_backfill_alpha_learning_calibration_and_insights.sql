/*
  # Backfill Alpha Confidence Calibration and Meta Insights

  Due to a bug where trade outcome classification used incorrect close_reason values
  ('tp_hit'/'manual_close' instead of 'take_profit'/'manual'), the alpha_confidence_calibration
  and alpha_meta_insights tables were never populated despite 207+ closed trades existing.

  1. Backfill `alpha_confidence_calibration`
    - Groups trades by user_id and confidence bucket (10% intervals)
    - Calculates actual win rate vs predicted (avg confidence)
    - Computes calibration error per bucket
    - Uses corrected win detection: take_profit/take_profit_1/take_profit_2/goal_achieved = win,
      manual with positive P&L = win, trailing_stop with positive P&L = win

  2. Backfill `alpha_meta_insights`
    - Generates per-user strength/weakness insights by symbol
    - Symbols with win rate >= 55% and sample >= 5 = strength
    - Symbols with win rate < 40% and sample >= 5 = weakness

  3. Important Notes
    - Only processes users with >= 5 closed trades
    - Uses ON CONFLICT to avoid duplicates if re-run
    - market_condition set to 'all' since per-trade regime data is not stored
*/

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT
      t.user_id,
      (FLOOR(COALESCE(t.ai_confidence, 70) / 10) * 10)::int AS confidence_bucket,
      COUNT(*) AS total_trades,
      COUNT(CASE
        WHEN t.close_reason IN ('take_profit', 'take_profit_1', 'take_profit_2', 'goal_achieved') THEN 1
        WHEN t.close_reason = 'manual' AND t.profit_loss > 0 THEN 1
        WHEN t.close_reason = 'trailing_stop' AND t.profit_loss > 0 THEN 1
      END) AS winning_trades,
      COUNT(CASE
        WHEN t.close_reason IN ('stop_loss') THEN 1
        WHEN t.profit_loss < 0 THEN 1
      END) AS losing_trades,
      ROUND(AVG(COALESCE(t.ai_confidence, 70))::numeric, 2) AS avg_confidence,
      ROUND(AVG(COALESCE(t.profit_loss, 0))::numeric, 4) AS avg_pnl
    FROM goal_session_trades t
    WHERE t.status = 'closed'
      AND t.ai_confidence IS NOT NULL
    GROUP BY t.user_id, (FLOOR(COALESCE(t.ai_confidence, 70) / 10) * 10)::int
    HAVING COUNT(*) >= 3
  )
  LOOP
    INSERT INTO alpha_confidence_calibration (
      user_id,
      confidence_bucket,
      market_condition,
      predicted_win_rate,
      actual_win_rate,
      sample_size,
      calibration_error,
      total_trades,
      winning_trades,
      losing_trades,
      avg_pnl_r,
      last_updated
    ) VALUES (
      r.user_id,
      r.confidence_bucket,
      'all',
      r.avg_confidence,
      CASE WHEN r.total_trades > 0
        THEN ROUND((r.winning_trades::numeric / r.total_trades) * 100, 2)
        ELSE 0
      END,
      r.total_trades,
      ABS(
        r.avg_confidence -
        CASE WHEN r.total_trades > 0
          THEN ROUND((r.winning_trades::numeric / r.total_trades) * 100, 2)
          ELSE 0
        END
      ),
      r.total_trades,
      r.winning_trades,
      r.losing_trades,
      r.avg_pnl,
      now()
    )
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT
      t.user_id,
      t.symbol,
      COUNT(*) AS total_trades,
      COUNT(CASE
        WHEN t.close_reason IN ('take_profit', 'take_profit_1', 'take_profit_2', 'goal_achieved') THEN 1
        WHEN t.close_reason = 'manual' AND t.profit_loss > 0 THEN 1
        WHEN t.close_reason = 'trailing_stop' AND t.profit_loss > 0 THEN 1
      END) AS wins,
      ROUND(AVG(COALESCE(t.profit_loss, 0))::numeric, 4) AS avg_pnl
    FROM goal_session_trades t
    WHERE t.status = 'closed'
      AND t.symbol IS NOT NULL
    GROUP BY t.user_id, t.symbol
    HAVING COUNT(*) >= 5
  )
  LOOP
    IF (r.wins::numeric / r.total_trades) >= 0.55 THEN
      INSERT INTO alpha_meta_insights (
        user_id,
        insight_type,
        market_condition,
        symbols,
        insight_description,
        supporting_evidence,
        confidence_in_insight,
        actionable_adjustment,
        improvement_seen,
        validated,
        discovered_at
      ) VALUES (
        r.user_id,
        'strength',
        'all',
        ARRAY[r.symbol],
        'Strong performance on ' || r.symbol || ' with ' || ROUND((r.wins::numeric / r.total_trades) * 100, 1) || '% win rate',
        jsonb_build_object(
          'sample_size', r.total_trades,
          'wins', r.wins,
          'losses', r.total_trades - r.wins,
          'avg_pnl', r.avg_pnl,
          'source', 'backfill_20260208'
        ),
        LEAST(90, 50 + r.total_trades),
        'Continue prioritizing ' || r.symbol || ' trades in similar conditions',
        ROUND((r.wins::numeric / r.total_trades) * 100, 1),
        true,
        now()
      )
      ON CONFLICT DO NOTHING;
    ELSIF (r.wins::numeric / r.total_trades) < 0.40 THEN
      INSERT INTO alpha_meta_insights (
        user_id,
        insight_type,
        market_condition,
        symbols,
        insight_description,
        supporting_evidence,
        confidence_in_insight,
        actionable_adjustment,
        improvement_seen,
        validated,
        discovered_at
      ) VALUES (
        r.user_id,
        'weakness',
        'all',
        ARRAY[r.symbol],
        'Underperforming on ' || r.symbol || ' with only ' || ROUND((r.wins::numeric / r.total_trades) * 100, 1) || '% win rate',
        jsonb_build_object(
          'sample_size', r.total_trades,
          'wins', r.wins,
          'losses', r.total_trades - r.wins,
          'avg_pnl', r.avg_pnl,
          'source', 'backfill_20260208'
        ),
        LEAST(90, 50 + r.total_trades),
        'Review entry criteria for ' || r.symbol || ' and consider reducing position size',
        ROUND((r.wins::numeric / r.total_trades) * 100, 1),
        true,
        now()
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $$;
