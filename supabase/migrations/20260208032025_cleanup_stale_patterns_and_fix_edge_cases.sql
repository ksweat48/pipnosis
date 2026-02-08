/*
  # Clean Up Stale Patterns and Fix Edge Cases

  Removes stale "Unknown" patterns created by the broken edge function aggregator,
  and fixes edge cases in the refresh functions:

  1. Data Cleanup
    - Remove all patterns with setup_type = 'Unknown' (created by broken aggregator)
    - These are replaced by properly classified patterns (Intraday, Micro Intraday, Scalp, etc.)
  2. Function Fixes
    - `refresh_global_patterns()`: Cap avg_rr at 10.0 to prevent unreasonable values
    - `refresh_global_patterns()`: Clean stale patterns before recalculating
    - `refresh_symbol_intelligence()`: Update best_timeframes in ON CONFLICT clause
  3. Important Notes
    - No data loss: only removing incorrectly classified patterns
    - New patterns are recalculated from SSOT (goal_session_trades)
*/

DELETE FROM ai_global_patterns WHERE setup_type = 'Unknown';

CREATE OR REPLACE FUNCTION refresh_symbol_intelligence()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  sym_rec RECORD;
  win_count int;
  total_count int;
  gross_profit numeric;
  gross_loss numeric;
  pf numeric;
  wr numeric;
  qs numeric;
BEGIN
  FOR sym_rec IN
    SELECT DISTINCT symbol FROM goal_session_trades WHERE status = 'closed'
  LOOP
    SELECT
      COUNT(*),
      COUNT(*) FILTER (
        WHERE close_reason IN ('take_profit', 'take_profit_1', 'take_profit_2', 'goal_achieved')
        OR (close_reason = 'manual' AND profit_loss > 0)
        OR (close_reason = 'trailing_stop' AND profit_loss > 0)
      ),
      COALESCE(SUM(CASE WHEN profit_loss > 0 THEN profit_loss ELSE 0 END), 0),
      COALESCE(ABS(SUM(CASE WHEN profit_loss < 0 THEN profit_loss ELSE 0 END)), 0)
    INTO total_count, win_count, gross_profit, gross_loss
    FROM goal_session_trades
    WHERE status = 'closed' AND symbol = sym_rec.symbol;

    IF total_count = 0 THEN CONTINUE; END IF;

    wr := (win_count::numeric / total_count) * 100;
    pf := CASE WHEN gross_loss > 0 THEN ROUND((gross_profit / gross_loss)::numeric, 2) ELSE CASE WHEN gross_profit > 0 THEN 999 ELSE 0 END END;
    qs := LEAST(100, ROUND((SQRT(total_count) * 15)::numeric, 1));

    INSERT INTO ai_global_symbol_intelligence (
      symbol, total_trades_platform_wide, platform_win_rate, platform_profit_factor,
      intelligence_quality_score, best_timeframes, last_pattern_discovered_at, updated_at
    ) VALUES (
      sym_rec.symbol, total_count, wr, pf,
      qs, ARRAY['M5', 'H1'], now(), now()
    )
    ON CONFLICT (symbol) DO UPDATE SET
      total_trades_platform_wide = EXCLUDED.total_trades_platform_wide,
      platform_win_rate = EXCLUDED.platform_win_rate,
      platform_profit_factor = EXCLUDED.platform_profit_factor,
      intelligence_quality_score = EXCLUDED.intelligence_quality_score,
      best_timeframes = EXCLUDED.best_timeframes,
      last_pattern_discovered_at = EXCLUDED.last_pattern_discovered_at,
      updated_at = now();
  END LOOP;
END;
$function$;


CREATE OR REPLACE FUNCTION refresh_global_patterns()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  pat_rec RECORD;
  total_count int;
  wins int;
  losses int;
  bes int;
  wr numeric;
  pf numeric;
  gp numeric;
  gl numeric;
  avg_rr_val numeric;
  pat_id text;
  pat_name text;
  style_label text;
BEGIN
  DELETE FROM ai_global_patterns
  WHERE pattern_id NOT IN (
    SELECT
      symbol || '_' || COALESCE(NULLIF(alpha_style, ''), 'Momentum') || '_' || direction
    FROM goal_session_trades
    WHERE status = 'closed'
    GROUP BY symbol, direction, COALESCE(NULLIF(alpha_style, ''), 'Momentum')
    HAVING COUNT(*) >= 2
  );

  FOR pat_rec IN
    SELECT
      symbol,
      direction,
      COALESCE(NULLIF(alpha_style, ''), 'Momentum') as style
    FROM goal_session_trades
    WHERE status = 'closed'
    GROUP BY symbol, direction, COALESCE(NULLIF(alpha_style, ''), 'Momentum')
    HAVING COUNT(*) >= 2
  LOOP
    pat_id := pat_rec.symbol || '_' || pat_rec.style || '_' || pat_rec.direction;

    style_label := CASE pat_rec.style
      WHEN 'INTRADAY' THEN 'Intraday'
      WHEN 'MICRO_INTRADAY' THEN 'Micro Intraday'
      WHEN 'SCALP' THEN 'Scalp'
      WHEN 'Momentum' THEN 'Momentum'
      ELSE INITCAP(REPLACE(pat_rec.style, '_', ' '))
    END;

    pat_name := style_label || ' ' || UPPER(pat_rec.direction);

    SELECT
      COUNT(*),
      COUNT(*) FILTER (
        WHERE close_reason IN ('take_profit', 'take_profit_1', 'take_profit_2', 'goal_achieved')
        OR (close_reason = 'manual' AND profit_loss > 0)
        OR (close_reason = 'trailing_stop' AND profit_loss > 0)
      ),
      COUNT(*) FILTER (
        WHERE close_reason = 'stop_loss'
        OR (close_reason = 'manual' AND profit_loss < 0)
      ),
      COUNT(*) FILTER (WHERE profit_loss = 0 OR profit_loss IS NULL),
      COALESCE(SUM(CASE WHEN profit_loss > 0 THEN profit_loss ELSE 0 END), 0),
      COALESCE(ABS(SUM(CASE WHEN profit_loss < 0 THEN profit_loss ELSE 0 END)), 0),
      LEAST(10, COALESCE(AVG(
        CASE WHEN stop_loss IS NOT NULL AND stop_loss != entry_price
             AND ABS(entry_price - stop_loss) > 0
             AND profit_loss IS NOT NULL
             AND position_size > 0
        THEN ABS(profit_loss) / (ABS(entry_price - stop_loss) * position_size)
        ELSE NULL END
      ), 0))
    INTO total_count, wins, losses, bes, gp, gl, avg_rr_val
    FROM goal_session_trades
    WHERE status = 'closed'
    AND symbol = pat_rec.symbol
    AND direction = pat_rec.direction
    AND COALESCE(NULLIF(alpha_style, ''), 'Momentum') = pat_rec.style;

    wr := CASE WHEN total_count > 0 THEN (wins::numeric / total_count) * 100 ELSE 0 END;
    pf := CASE WHEN gl > 0 THEN ROUND((gp / gl)::numeric, 2) ELSE CASE WHEN gp > 0 THEN 999 ELSE 0 END END;

    INSERT INTO ai_global_patterns (
      pattern_id, pattern_name, symbol, setup_type, direction,
      total_occurrences, win_count, loss_count, breakeven_count,
      win_rate, profit_factor, avg_rr,
      last_occurrence_at, discovery_date,
      sample_size_adequate, statistical_significance, updated_at
    ) VALUES (
      pat_id, pat_name, pat_rec.symbol, style_label, pat_rec.direction,
      total_count, wins, losses, bes,
      wr, pf, ROUND(avg_rr_val::numeric, 2),
      (SELECT MAX(closed_at) FROM goal_session_trades WHERE status = 'closed' AND symbol = pat_rec.symbol AND direction = pat_rec.direction AND COALESCE(NULLIF(alpha_style, ''), 'Momentum') = pat_rec.style),
      (SELECT MIN(created_at) FROM goal_session_trades WHERE status = 'closed' AND symbol = pat_rec.symbol AND direction = pat_rec.direction AND COALESCE(NULLIF(alpha_style, ''), 'Momentum') = pat_rec.style),
      total_count >= 10,
      CASE WHEN total_count >= 30 THEN 0.95 WHEN total_count >= 10 THEN 0.80 ELSE 0.50 END,
      now()
    )
    ON CONFLICT (pattern_id) DO UPDATE SET
      pattern_name = EXCLUDED.pattern_name,
      setup_type = EXCLUDED.setup_type,
      total_occurrences = EXCLUDED.total_occurrences,
      win_count = EXCLUDED.win_count,
      loss_count = EXCLUDED.loss_count,
      breakeven_count = EXCLUDED.breakeven_count,
      win_rate = EXCLUDED.win_rate,
      profit_factor = EXCLUDED.profit_factor,
      avg_rr = EXCLUDED.avg_rr,
      last_occurrence_at = EXCLUDED.last_occurrence_at,
      sample_size_adequate = EXCLUDED.sample_size_adequate,
      statistical_significance = EXCLUDED.statistical_significance,
      updated_at = now();
  END LOOP;
END;
$function$;

NOTIFY pgrst, 'reload schema';
