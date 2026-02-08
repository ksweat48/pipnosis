/*
  # Fix update_platform_stats SSOT Compliance

  The `update_platform_stats()` function had three SSOT violations that caused a 404 error
  when called via PostgREST:

  1. Referenced non-existent table `goal_trades` - corrected to `goal_session_trades`
  2. Used wrong column name `realized_pnl` - corrected to `profit_loss`
  3. Checked wrong close_reason values `tp_hit`/`manual_close` - corrected to
     `take_profit`/`take_profit_1`/`take_profit_2`/`goal_achieved`/`manual`

  These are the same root-cause bugs fixed in the TypeScript services
  (alpha-meta-learning.ts, alpha-learning-feedback.ts, rr-success-tracker.ts)
  via the trade-outcome-classifier SSOT utility.

  1. Modified Functions
    - `update_platform_stats()` - all table/column/value references corrected
  2. Security
    - No changes to RLS or permissions (SECURITY DEFINER retained)
  3. Important Notes
    - Forces PostgREST schema cache reload via pg_notify
    - The function is called by platform-intelligence-service.ts (frontend)
      and aggregate-platform-intelligence edge function (backend)
*/

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
