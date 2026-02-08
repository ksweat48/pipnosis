/*
  # Refresh Symbol Intelligence & Global Patterns from SSOT

  The `ai_global_symbol_intelligence` and `ai_global_patterns` tables had stale/incorrect
  data because they were populated by a broken edge function that:
  1. Aggregated from incomplete `ai_trade_analysis` table (40 rows) instead of the SSOT `goal_session_trades` (207+ trades)
  2. Tried to read a non-existent JSONB key for setup_type, producing "Unknown" for all patterns
  3. Had broken profit factor calculations (produced negative values, which is mathematically impossible)
  4. Had broken quality score calculations (scores 0-3 instead of meaningful values)

  This migration creates two new database functions:
  - `refresh_symbol_intelligence()` - recalculates from `goal_session_trades` (SSOT)
  - `refresh_global_patterns()` - recalculates from `goal_session_trades` using `alpha_style` + `direction`

  It also updates `update_platform_stats()` to call both refresh functions.

  1. New Functions
    - `refresh_symbol_intelligence()` - recalculates all symbol data from SSOT
    - `refresh_global_patterns()` - recalculates all pattern data from SSOT
  2. Modified Functions
    - `update_platform_stats()` - now calls both refresh functions
  3. Security
    - Both functions are SECURITY DEFINER (same as existing update_platform_stats)
  4. Important Notes
    - Pattern classification uses `alpha_style` column (INTRADAY, MICRO_INTRADAY, SCALP, etc.)
    - Profit factor is always >= 0 (gross_profit / gross_loss)
    - Quality score = min(100, sqrt(trades) * 15) for meaningful scaling
    - Forces PostgREST schema cache reload
*/

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
      COALESCE(AVG(
        CASE WHEN stop_loss IS NOT NULL AND stop_loss != entry_price AND profit_loss IS NOT NULL
        THEN ABS(profit_loss / NULLIF(ABS(entry_price - stop_loss) * position_size, 0))
        ELSE NULL END
      ), 0)
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


CREATE OR REPLACE FUNCTION update_platform_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  total_patterns int;
  total_trades int;
  unique_users int;
  total_symbols int;
  platform_wr numeric;
  platform_pf numeric;
  growth numeric;
  best_sym text;
  best_pat text;
  trades_today int;
  patterns_today int;
BEGIN
  PERFORM refresh_symbol_intelligence();
  PERFORM refresh_global_patterns();

  SELECT COUNT(DISTINCT pattern_id)
  INTO total_patterns
  FROM ai_global_patterns
  WHERE sample_size_adequate = true;

  SELECT COUNT(*)
  INTO total_trades
  FROM goal_session_trades
  WHERE status = 'closed';

  SELECT COUNT(DISTINCT user_id)
  INTO unique_users
  FROM goal_session_trades
  WHERE status = 'closed'
  AND created_at >= CURRENT_DATE - INTERVAL '30 days';

  SELECT COUNT(DISTINCT symbol)
  INTO total_symbols
  FROM ai_global_symbol_intelligence
  WHERE total_trades_platform_wide >= 5;

  SELECT
    COALESCE(
      (COUNT(*) FILTER (
        WHERE close_reason IN ('take_profit', 'take_profit_1', 'take_profit_2', 'goal_achieved')
        OR (close_reason = 'manual' AND profit_loss > 0)
        OR (close_reason = 'trailing_stop' AND profit_loss > 0)
      )::numeric
      / NULLIF(COUNT(*), 0) * 100),
      0
    )
  INTO platform_wr
  FROM goal_session_trades
  WHERE status = 'closed';

  WITH pnl_calc AS (
    SELECT
      SUM(CASE WHEN profit_loss > 0 THEN profit_loss ELSE 0 END) as total_profit,
      ABS(SUM(CASE WHEN profit_loss < 0 THEN profit_loss ELSE 0 END)) as total_loss
    FROM goal_session_trades
    WHERE status = 'closed'
    AND profit_loss IS NOT NULL
  )
  SELECT
    CASE
      WHEN total_loss > 0 THEN ROUND((total_profit / total_loss)::numeric, 2)
      WHEN total_profit > 0 THEN 999
      ELSE 0
    END
  INTO platform_pf
  FROM pnl_calc;

  SELECT COUNT(*)
  INTO trades_today
  FROM goal_session_trades
  WHERE status = 'closed'
  AND DATE(created_at) = CURRENT_DATE;

  SELECT COUNT(*)
  INTO patterns_today
  FROM ai_global_patterns
  WHERE DATE(discovery_date) = CURRENT_DATE;

  SELECT symbol
  INTO best_sym
  FROM ai_global_symbol_intelligence
  WHERE last_pattern_discovered_at >= CURRENT_DATE
  ORDER BY platform_win_rate DESC, platform_profit_factor DESC
  LIMIT 1;

  SELECT pattern_name
  INTO best_pat
  FROM ai_global_patterns
  WHERE DATE(last_occurrence_at) = CURRENT_DATE
  ORDER BY win_rate DESC, profit_factor DESC
  LIMIT 1;

  growth := calculate_intelligence_growth_rate();

  INSERT INTO ai_platform_learning_stats (
    stat_date,
    trades_analyzed_today,
    patterns_discovered_today,
    total_trades_analyzed,
    total_patterns_discovered,
    total_symbols_tracked,
    unique_users_contributing,
    platform_win_rate,
    platform_profit_factor,
    intelligence_growth_rate,
    best_symbol_today,
    best_pattern_today,
    updated_at
  ) VALUES (
    CURRENT_DATE,
    trades_today,
    patterns_today,
    total_trades,
    total_patterns,
    total_symbols,
    unique_users,
    platform_wr,
    platform_pf,
    growth,
    best_sym,
    best_pat,
    now()
  )
  ON CONFLICT (stat_date) DO UPDATE SET
    trades_analyzed_today = EXCLUDED.trades_analyzed_today,
    patterns_discovered_today = EXCLUDED.patterns_discovered_today,
    total_trades_analyzed = EXCLUDED.total_trades_analyzed,
    total_patterns_discovered = EXCLUDED.total_patterns_discovered,
    total_symbols_tracked = EXCLUDED.total_symbols_tracked,
    unique_users_contributing = EXCLUDED.unique_users_contributing,
    platform_win_rate = EXCLUDED.platform_win_rate,
    platform_profit_factor = EXCLUDED.platform_profit_factor,
    intelligence_growth_rate = EXCLUDED.intelligence_growth_rate,
    best_symbol_today = EXCLUDED.best_symbol_today,
    best_pattern_today = EXCLUDED.best_pattern_today,
    updated_at = now();
END;
$function$;

NOTIFY pgrst, 'reload schema';
