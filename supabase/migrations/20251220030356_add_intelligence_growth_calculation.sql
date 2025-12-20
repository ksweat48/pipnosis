/*
  # Add Intelligence Growth Rate Calculation System

  1. Functions
    - calculate_intelligence_growth_rate() - Calculates day-over-day growth
    - update_platform_stats() - Updates daily platform statistics

  2. Changes
    - Ensures intelligence_growth_rate is properly calculated
    - Adds helper functions for aggregation

  3. Security
    - Functions use SECURITY DEFINER to bypass RLS for aggregation
*/

-- ============================================================================
-- Function to calculate intelligence growth rate
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_intelligence_growth_rate()
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  today_total int;
  yesterday_total int;
  growth_rate numeric;
BEGIN
  -- Get today's total patterns discovered
  SELECT COALESCE(total_patterns_discovered, 0)
  INTO today_total
  FROM ai_platform_learning_stats
  WHERE stat_date = CURRENT_DATE
  LIMIT 1;

  -- Get yesterday's total
  SELECT COALESCE(total_patterns_discovered, 0)
  INTO yesterday_total
  FROM ai_platform_learning_stats
  WHERE stat_date = CURRENT_DATE - INTERVAL '1 day'
  LIMIT 1;

  -- Calculate growth rate
  IF yesterday_total > 0 THEN
    growth_rate := ((today_total - yesterday_total)::numeric / yesterday_total::numeric) * 100;
  ELSE
    growth_rate := 0;
  END IF;

  RETURN ROUND(growth_rate, 2);
END;
$$;

-- ============================================================================
-- Function to update platform statistics with aggregated data
-- ============================================================================

CREATE OR REPLACE FUNCTION update_platform_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
  -- Get total patterns discovered
  SELECT COUNT(DISTINCT pattern_id)
  INTO total_patterns
  FROM ai_global_patterns
  WHERE sample_size_adequate = true;

  -- Get total trades analyzed (from goal_trades that have been analyzed)
  SELECT COUNT(*)
  INTO total_trades
  FROM goal_trades
  WHERE status = 'closed';

  -- Get unique users contributing
  SELECT COUNT(DISTINCT user_id)
  INTO unique_users
  FROM goal_trades
  WHERE status = 'closed'
    AND created_at >= CURRENT_DATE - INTERVAL '30 days';

  -- Get total symbols tracked
  SELECT COUNT(DISTINCT symbol)
  INTO total_symbols
  FROM ai_global_symbol_intelligence
  WHERE total_trades_platform_wide >= 5;

  -- Calculate platform win rate from closed trades
  SELECT
    COALESCE(
      (COUNT(*) FILTER (WHERE close_reason = 'tp_hit' OR (close_reason = 'manual_close' AND realized_pnl > 0))::numeric
      / NULLIF(COUNT(*), 0) * 100),
      0
    )
  INTO platform_wr
  FROM goal_trades
  WHERE status = 'closed';

  -- Calculate platform profit factor
  WITH pnl_calc AS (
    SELECT
      SUM(CASE WHEN realized_pnl > 0 THEN realized_pnl ELSE 0 END) as total_profit,
      ABS(SUM(CASE WHEN realized_pnl < 0 THEN realized_pnl ELSE 0 END)) as total_loss
    FROM goal_trades
    WHERE status = 'closed'
      AND realized_pnl IS NOT NULL
  )
  SELECT
    CASE
      WHEN total_loss > 0 THEN ROUND((total_profit / total_loss)::numeric, 2)
      WHEN total_profit > 0 THEN 999
      ELSE 0
    END
  INTO platform_pf
  FROM pnl_calc;

  -- Get trades analyzed today
  SELECT COUNT(*)
  INTO trades_today
  FROM goal_trades
  WHERE status = 'closed'
    AND DATE(created_at) = CURRENT_DATE;

  -- Get patterns discovered today
  SELECT COUNT(*)
  INTO patterns_today
  FROM ai_global_patterns
  WHERE DATE(discovery_date) = CURRENT_DATE;

  -- Get best performing symbol today
  SELECT symbol
  INTO best_sym
  FROM ai_global_symbol_intelligence
  WHERE last_pattern_discovered_at >= CURRENT_DATE
  ORDER BY platform_win_rate DESC, platform_profit_factor DESC
  LIMIT 1;

  -- Get best performing pattern today
  SELECT pattern_name
  INTO best_pat
  FROM ai_global_patterns
  WHERE DATE(last_occurrence_at) = CURRENT_DATE
  ORDER BY win_rate DESC, profit_factor DESC
  LIMIT 1;

  -- Calculate growth rate
  growth := calculate_intelligence_growth_rate();

  -- Insert or update today's stats
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
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION calculate_intelligence_growth_rate() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_platform_stats() TO authenticated, service_role;
