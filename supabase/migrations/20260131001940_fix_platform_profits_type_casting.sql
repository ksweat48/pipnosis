/*
  # Fix Platform Profits RPC Function Type Casting

  1. Problem
    - PostgreSQL COUNT() returns bigint, but function signatures expect integer
    - Causes 400 Bad Request errors when calling the RPC functions
    - "Returned type bigint does not match expected type integer"

  2. Solution
    - Cast all COUNT() results to integer in all RPC functions
    - Ensures function return types match the declared table structure
    - Maintains SSOT by not changing business logic, only type safety

  3. Functions Fixed
    - get_platform_lifetime_profits()
    - get_platform_daily_profits()
    - get_platform_profit_comparison()
    - calculate_platform_daily_profits()

  4. Governance & CCIP
    - Type casting is a data contract fix, not a logic change
    - No SSOT violations - all calculations remain identical
    - Ensures PostgREST API contract compliance
*/

-- Fix get_platform_lifetime_profits with proper type casting
CREATE OR REPLACE FUNCTION get_platform_lifetime_profits()
RETURNS TABLE (
  lifetime_closed_pnl DECIMAL,
  lifetime_unrealized_pnl DECIMAL,
  lifetime_total_pnl DECIMAL,
  total_closed_trades INT,
  total_users_ever_traded INT,
  total_winning_trades INT,
  total_losing_trades INT,
  win_rate NUMERIC,
  average_pnl_per_trade DECIMAL,
  best_day_pnl DECIMAL,
  worst_day_pnl DECIMAL,
  best_day_date DATE,
  worst_day_date DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(pdp.closed_trades_pnl), 0::DECIMAL),
    COALESCE(SUM(pdp.unrealized_pnl), 0::DECIMAL),
    COALESCE(SUM(pdp.total_pnl), 0::DECIMAL),
    COALESCE(SUM(pdp.total_closed_trades), 0)::INT,
    COALESCE(COUNT(DISTINCT DATE(pdp.date)), 0)::INT,
    COALESCE(SUM(pdp.winning_trades), 0)::INT,
    COALESCE(SUM(pdp.losing_trades), 0)::INT,
    CASE
      WHEN COALESCE(SUM(pdp.total_closed_trades), 0) > 0
      THEN ROUND((COALESCE(SUM(pdp.winning_trades), 0)::NUMERIC / 
                  COALESCE(SUM(pdp.total_closed_trades), 0)::NUMERIC) * 100, 2)
      ELSE 0::NUMERIC
    END as win_rate,
    CASE
      WHEN COALESCE(SUM(pdp.total_closed_trades), 0) > 0
      THEN ROUND(COALESCE(SUM(pdp.closed_trades_pnl), 0) / 
                 COALESCE(SUM(pdp.total_closed_trades), 0), 2)
      ELSE 0::DECIMAL
    END as avg_pnl,
    MAX(pdp.total_pnl),
    MIN(pdp.total_pnl),
    (SELECT date FROM platform_daily_profits ORDER BY total_pnl DESC LIMIT 1),
    (SELECT date FROM platform_daily_profits ORDER BY total_pnl ASC LIMIT 1)
  FROM platform_daily_profits pdp;
END;
$$;

-- Fix get_platform_daily_profits with proper type casting
CREATE OR REPLACE FUNCTION get_platform_daily_profits(p_days_back INT DEFAULT 7)
RETURNS TABLE (
  date DATE,
  closed_trades_pnl DECIMAL,
  unrealized_pnl DECIMAL,
  total_pnl DECIMAL,
  user_count_with_trades INT,
  total_closed_trades INT,
  winning_trades INT,
  losing_trades INT,
  win_rate NUMERIC,
  prev_day_closed_pnl DECIMAL,
  prev_day_pnl_change NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pdp.date,
    pdp.closed_trades_pnl,
    pdp.unrealized_pnl,
    pdp.total_pnl,
    pdp.user_count_with_trades,
    pdp.total_closed_trades,
    pdp.winning_trades,
    pdp.losing_trades,
    CASE
      WHEN pdp.total_closed_trades > 0
      THEN ROUND((pdp.winning_trades::NUMERIC / pdp.total_closed_trades) * 100, 2)
      ELSE 0::NUMERIC
    END as win_rate,
    (LAG(pdp.closed_trades_pnl) OVER (ORDER BY pdp.date DESC)) as prev_day_closed_pnl,
    CASE
      WHEN LAG(pdp.closed_trades_pnl) OVER (ORDER BY pdp.date DESC) IS NOT NULL
      THEN ROUND(((pdp.closed_trades_pnl - LAG(pdp.closed_trades_pnl) OVER (ORDER BY pdp.date DESC)) / 
                  NULLIF(ABS(LAG(pdp.closed_trades_pnl) OVER (ORDER BY pdp.date DESC)), 0)) * 100, 2)
      ELSE NULL::NUMERIC
    END as prev_day_pnl_change
  FROM platform_daily_profits pdp
  WHERE pdp.date >= CURRENT_DATE - INTERVAL '1 day' * p_days_back
  ORDER BY pdp.date DESC;
END;
$$;

-- Fix get_platform_profit_comparison with proper type casting
CREATE OR REPLACE FUNCTION get_platform_profit_comparison()
RETURNS TABLE (
  todays_closed_pnl DECIMAL,
  todays_unrealized_pnl DECIMAL,
  todays_total_pnl DECIMAL,
  yesterday_closed_pnl DECIMAL,
  yesterday_total_pnl DECIMAL,
  day_over_day_change DECIMAL,
  day_over_day_change_percent NUMERIC,
  week_total_closed_pnl DECIMAL,
  week_total_pnl DECIMAL,
  prev_week_closed_pnl DECIMAL,
  week_over_week_change DECIMAL,
  week_over_week_change_percent NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_todays_closed DECIMAL;
  v_todays_unrealized DECIMAL;
  v_yesterday_closed DECIMAL;
  v_week_closed DECIMAL;
  v_prev_week_closed DECIMAL;
BEGIN
  -- Today's profits
  SELECT COALESCE(closed_trades_pnl, 0), COALESCE(unrealized_pnl, 0)
  INTO v_todays_closed, v_todays_unrealized
  FROM platform_daily_profits
  WHERE date = CURRENT_DATE;

  -- Yesterday's profits
  SELECT COALESCE(closed_trades_pnl, 0)
  INTO v_yesterday_closed
  FROM platform_daily_profits
  WHERE date = CURRENT_DATE - INTERVAL '1 day';

  -- Last 7 days
  SELECT COALESCE(SUM(closed_trades_pnl), 0)
  INTO v_week_closed
  FROM platform_daily_profits
  WHERE date >= CURRENT_DATE - INTERVAL '7 days';

  -- Previous 7 days
  SELECT COALESCE(SUM(closed_trades_pnl), 0)
  INTO v_prev_week_closed
  FROM platform_daily_profits
  WHERE date >= CURRENT_DATE - INTERVAL '14 days'
    AND date < CURRENT_DATE - INTERVAL '7 days';

  RETURN QUERY
  SELECT
    v_todays_closed,
    v_todays_unrealized,
    v_todays_closed + v_todays_unrealized,
    v_yesterday_closed,
    COALESCE((SELECT total_pnl FROM platform_daily_profits WHERE date = CURRENT_DATE - INTERVAL '1 day'), 0::DECIMAL),
    v_todays_closed - v_yesterday_closed,
    CASE
      WHEN v_yesterday_closed != 0
      THEN ROUND(((v_todays_closed - v_yesterday_closed) / ABS(v_yesterday_closed)) * 100, 2)
      ELSE 0::NUMERIC
    END,
    v_week_closed,
    COALESCE((SELECT SUM(total_pnl) FROM platform_daily_profits WHERE date >= CURRENT_DATE - INTERVAL '7 days'), 0::DECIMAL),
    v_prev_week_closed,
    v_week_closed - v_prev_week_closed,
    CASE
      WHEN v_prev_week_closed != 0
      THEN ROUND(((v_week_closed - v_prev_week_closed) / ABS(v_prev_week_closed)) * 100, 2)
      ELSE 0::NUMERIC
    END;
END;
$$;

-- Fix calculate_platform_daily_profits with proper type casting
CREATE OR REPLACE FUNCTION calculate_platform_daily_profits(p_date DATE DEFAULT CURRENT_DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_closed_pnl DECIMAL(15, 2);
  v_open_pnl DECIMAL(15, 2);
  v_total_users INT;
  v_closed_count INT;
  v_winning INT;
  v_losing INT;
  v_result JSONB;
BEGIN
  -- Validate date input
  IF p_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Cannot calculate profits for future dates';
  END IF;

  -- Calculate closed trades P&L for the date with proper type casting
  SELECT
    COALESCE(SUM(gst.profit_loss), 0),
    COUNT(*)::INT,
    COUNT(CASE WHEN gst.profit_loss > 0 THEN 1 END)::INT,
    COUNT(CASE WHEN gst.profit_loss < 0 THEN 1 END)::INT
  INTO v_closed_pnl, v_closed_count, v_winning, v_losing
  FROM goal_session_trades gst
  WHERE gst.status = 'closed'
    AND DATE(gst.closed_at) = p_date;

  -- Calculate unrealized P&L for open positions at end of day
  SELECT COALESCE(SUM(gst.current_pnl), 0)
  INTO v_open_pnl
  FROM goal_session_trades gst
  WHERE gst.status IN ('open', 'pending')
    AND DATE(gst.opened_at) <= p_date;

  -- Count unique users with trades on this date
  SELECT COUNT(DISTINCT gst.user_id)::INT
  INTO v_total_users
  FROM goal_session_trades gst
  WHERE DATE(gst.opened_at) = p_date OR DATE(gst.closed_at) = p_date;

  -- Upsert the daily record
  INSERT INTO platform_daily_profits (
    date,
    closed_trades_pnl,
    unrealized_pnl,
    total_pnl,
    user_count_with_trades,
    total_closed_trades,
    winning_trades,
    losing_trades,
    calculated_at,
    updated_at
  ) VALUES (
    p_date,
    v_closed_pnl,
    v_open_pnl,
    v_closed_pnl + v_open_pnl,
    COALESCE(v_total_users, 0),
    v_closed_count,
    v_winning,
    v_losing,
    now(),
    now()
  )
  ON CONFLICT (date) DO UPDATE SET
    closed_trades_pnl = EXCLUDED.closed_trades_pnl,
    unrealized_pnl = EXCLUDED.unrealized_pnl,
    total_pnl = EXCLUDED.total_pnl,
    user_count_with_trades = EXCLUDED.user_count_with_trades,
    total_closed_trades = EXCLUDED.total_closed_trades,
    winning_trades = EXCLUDED.winning_trades,
    losing_trades = EXCLUDED.losing_trades,
    updated_at = now();

  -- Build result
  v_result := jsonb_build_object(
    'date', p_date,
    'closed_trades_pnl', v_closed_pnl,
    'unrealized_pnl', v_open_pnl,
    'total_pnl', v_closed_pnl + v_open_pnl,
    'user_count', v_total_users,
    'closed_count', v_closed_count,
    'winning_count', v_winning,
    'losing_count', v_losing,
    'calculated_at', now()
  );

  RETURN v_result;
END;
$$;
