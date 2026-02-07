/*
  # Fix Platform Profits - Live Data from SSOT

  1. Problem
    - `platform_daily_profits` table was stale since Jan 31
    - Dashboard showed $0 for all recent data (8 days of trades missing)
    - `total_users_ever_traded` counted distinct dates instead of distinct users
    - `lifetime_total_pnl` double-counted unrealized PnL across days

  2. Fix
    - Rewrite all 3 RPC functions to query `goal_session_trades` directly (SSOT)
    - `get_platform_daily_profits` uses date series with LEFT JOIN for gap-fill
    - `get_platform_lifetime_profits` fixes user count and lifetime P&L
    - `get_platform_profit_comparison` uses live data for comparisons
    - Add trigger on `goal_session_trades` to auto-refresh materialized table
    - Backfill missing days (Feb 1 - today)

  3. SSOT Compliance
    - `goal_session_trades.profit_loss` is the single source of truth for P&L
    - `goal_session_trades.current_pnl` is the source for unrealized P&L
    - `platform_daily_profits` becomes a secondary cache, not primary dependency

  4. Security
    - All functions remain SECURITY DEFINER
    - No RLS changes
*/

-- ============================================================
-- FIX 1: get_platform_daily_profits - Live from goal_session_trades
-- ============================================================
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
  WITH date_series AS (
    SELECT d::date AS dt
    FROM generate_series(
      CURRENT_DATE - (p_days_back || ' days')::interval,
      CURRENT_DATE,
      '1 day'::interval
    ) d
  ),
  daily_closed AS (
    SELECT
      DATE(gst.closed_at) AS dt,
      COALESCE(SUM(gst.profit_loss), 0)::DECIMAL AS pnl,
      COUNT(*)::INT AS total,
      COUNT(CASE WHEN gst.profit_loss > 0 THEN 1 END)::INT AS wins,
      COUNT(CASE WHEN gst.profit_loss <= 0 THEN 1 END)::INT AS losses,
      COUNT(DISTINCT gst.user_id)::INT AS users
    FROM goal_session_trades gst
    WHERE gst.status = 'closed'
      AND gst.closed_at IS NOT NULL
      AND DATE(gst.closed_at) >= CURRENT_DATE - (p_days_back || ' days')::interval
    GROUP BY DATE(gst.closed_at)
  ),
  today_unrealized AS (
    SELECT COALESCE(SUM(gst.current_pnl), 0)::DECIMAL AS unrealized
    FROM goal_session_trades gst
    WHERE gst.status = 'open'
  ),
  combined AS (
    SELECT
      ds.dt AS date,
      COALESCE(dc.pnl, 0::DECIMAL) AS closed_trades_pnl,
      CASE
        WHEN ds.dt = CURRENT_DATE THEN (SELECT unrealized FROM today_unrealized)
        ELSE 0::DECIMAL
      END AS unrealized_pnl,
      COALESCE(dc.pnl, 0::DECIMAL) +
        CASE WHEN ds.dt = CURRENT_DATE THEN (SELECT unrealized FROM today_unrealized) ELSE 0::DECIMAL END
        AS total_pnl,
      COALESCE(dc.users, 0) AS user_count_with_trades,
      COALESCE(dc.total, 0) AS total_closed_trades,
      COALESCE(dc.wins, 0) AS winning_trades,
      COALESCE(dc.losses, 0) AS losing_trades
    FROM date_series ds
    LEFT JOIN daily_closed dc ON dc.dt = ds.dt
  )
  SELECT
    c.date,
    c.closed_trades_pnl,
    c.unrealized_pnl,
    c.total_pnl,
    c.user_count_with_trades,
    c.total_closed_trades,
    c.winning_trades,
    c.losing_trades,
    CASE
      WHEN c.total_closed_trades > 0
      THEN ROUND((c.winning_trades::NUMERIC / c.total_closed_trades) * 100, 2)
      ELSE 0::NUMERIC
    END AS win_rate,
    LAG(c.closed_trades_pnl) OVER (ORDER BY c.date DESC) AS prev_day_closed_pnl,
    CASE
      WHEN LAG(c.closed_trades_pnl) OVER (ORDER BY c.date DESC) IS NOT NULL
        AND ABS(LAG(c.closed_trades_pnl) OVER (ORDER BY c.date DESC)) > 0
      THEN ROUND(
        ((c.closed_trades_pnl - LAG(c.closed_trades_pnl) OVER (ORDER BY c.date DESC))
         / ABS(LAG(c.closed_trades_pnl) OVER (ORDER BY c.date DESC))) * 100, 2)
      ELSE NULL::NUMERIC
    END AS prev_day_pnl_change
  FROM combined c
  ORDER BY c.date DESC;
END;
$$;

-- ============================================================
-- FIX 2: get_platform_lifetime_profits - Fix user count + P&L
-- ============================================================
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
DECLARE
  v_closed_pnl DECIMAL;
  v_unrealized DECIMAL;
  v_total_closed INT;
  v_users INT;
  v_wins INT;
  v_losses INT;
BEGIN
  SELECT
    COALESCE(SUM(profit_loss), 0),
    COUNT(*),
    COUNT(DISTINCT user_id),
    COUNT(CASE WHEN profit_loss > 0 THEN 1 END),
    COUNT(CASE WHEN profit_loss <= 0 THEN 1 END)
  INTO v_closed_pnl, v_total_closed, v_users, v_wins, v_losses
  FROM goal_session_trades
  WHERE status = 'closed';

  SELECT COALESCE(SUM(current_pnl), 0)
  INTO v_unrealized
  FROM goal_session_trades
  WHERE status = 'open';

  RETURN QUERY
  WITH daily_pnl AS (
    SELECT
      DATE(closed_at) AS dt,
      SUM(profit_loss) AS day_pnl
    FROM goal_session_trades
    WHERE status = 'closed' AND closed_at IS NOT NULL
    GROUP BY DATE(closed_at)
  )
  SELECT
    v_closed_pnl::DECIMAL AS lifetime_closed_pnl,
    v_unrealized::DECIMAL AS lifetime_unrealized_pnl,
    (v_closed_pnl + v_unrealized)::DECIMAL AS lifetime_total_pnl,
    v_total_closed AS total_closed_trades,
    v_users AS total_users_ever_traded,
    v_wins AS total_winning_trades,
    v_losses AS total_losing_trades,
    CASE
      WHEN v_total_closed > 0
      THEN ROUND((v_wins::NUMERIC / v_total_closed::NUMERIC) * 100, 2)
      ELSE 0::NUMERIC
    END AS win_rate,
    CASE
      WHEN v_total_closed > 0
      THEN ROUND(v_closed_pnl / v_total_closed, 2)
      ELSE 0::DECIMAL
    END AS average_pnl_per_trade,
    COALESCE((SELECT MAX(day_pnl) FROM daily_pnl), 0::NUMERIC)::DECIMAL AS best_day_pnl,
    COALESCE((SELECT MIN(day_pnl) FROM daily_pnl), 0::NUMERIC)::DECIMAL AS worst_day_pnl,
    (SELECT dt FROM daily_pnl ORDER BY day_pnl DESC LIMIT 1) AS best_day_date,
    (SELECT dt FROM daily_pnl ORDER BY day_pnl ASC LIMIT 1) AS worst_day_date;
END;
$$;

-- ============================================================
-- FIX 3: get_platform_profit_comparison - Live data
-- ============================================================
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
  SELECT COALESCE(SUM(profit_loss), 0)
  INTO v_todays_closed
  FROM goal_session_trades
  WHERE status = 'closed' AND DATE(closed_at) = CURRENT_DATE;

  SELECT COALESCE(SUM(current_pnl), 0)
  INTO v_todays_unrealized
  FROM goal_session_trades
  WHERE status = 'open';

  SELECT COALESCE(SUM(profit_loss), 0)
  INTO v_yesterday_closed
  FROM goal_session_trades
  WHERE status = 'closed' AND DATE(closed_at) = CURRENT_DATE - 1;

  SELECT COALESCE(SUM(profit_loss), 0)
  INTO v_week_closed
  FROM goal_session_trades
  WHERE status = 'closed'
    AND closed_at >= CURRENT_DATE - INTERVAL '7 days';

  SELECT COALESCE(SUM(profit_loss), 0)
  INTO v_prev_week_closed
  FROM goal_session_trades
  WHERE status = 'closed'
    AND closed_at >= CURRENT_DATE - INTERVAL '14 days'
    AND closed_at < CURRENT_DATE - INTERVAL '7 days';

  RETURN QUERY
  SELECT
    v_todays_closed,
    v_todays_unrealized,
    v_todays_closed + v_todays_unrealized,
    v_yesterday_closed,
    v_yesterday_closed,
    v_todays_closed - v_yesterday_closed,
    CASE
      WHEN v_yesterday_closed != 0
      THEN ROUND(((v_todays_closed - v_yesterday_closed) / ABS(v_yesterday_closed)) * 100, 2)
      ELSE 0::NUMERIC
    END,
    v_week_closed,
    v_week_closed + v_todays_unrealized,
    v_prev_week_closed,
    v_week_closed - v_prev_week_closed,
    CASE
      WHEN v_prev_week_closed != 0
      THEN ROUND(((v_week_closed - v_prev_week_closed) / ABS(v_prev_week_closed)) * 100, 2)
      ELSE 0::NUMERIC
    END;
END;
$$;

-- ============================================================
-- FIX 4: Auto-refresh trigger for platform_daily_profits
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_platform_daily_profits_on_trade_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.closed_at IS NOT NULL THEN
      PERFORM calculate_platform_daily_profits(DATE(OLD.closed_at));
    END IF;
    PERFORM calculate_platform_daily_profits(CURRENT_DATE);
    RETURN OLD;
  END IF;

  IF NEW.closed_at IS NOT NULL THEN
    PERFORM calculate_platform_daily_profits(DATE(NEW.closed_at));
  END IF;
  PERFORM calculate_platform_daily_profits(CURRENT_DATE);

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_refresh_platform_daily_profits'
  ) THEN
    CREATE TRIGGER trg_refresh_platform_daily_profits
      AFTER INSERT OR UPDATE OF status, profit_loss, current_pnl, closed_at
      ON goal_session_trades
      FOR EACH ROW
      EXECUTE FUNCTION refresh_platform_daily_profits_on_trade_change();
  END IF;
END $$;

-- ============================================================
-- FIX 5: Backfill missing days (Feb 1 - today)
-- ============================================================
DO $$
DECLARE
  v_date DATE;
BEGIN
  FOR v_date IN
    SELECT d::date
    FROM generate_series('2026-01-31'::date, CURRENT_DATE, '1 day'::interval) d
  LOOP
    PERFORM calculate_platform_daily_profits(v_date);
  END LOOP;
END $$;
