/*
  # Fix: admin_get_all_users_paginated — ALL Ambiguous Column Names

  ## Problem (Root Cause Analysis)
  PostgreSQL PL/pgSQL scopes every RETURNS TABLE output column as a local
  variable within the function body. Any output column name that matches a
  column name on a joined table creates an ambiguity error (42702).

  Previous fix only renamed "is_admin" -> "user_is_admin". The same class
  of bug exists for every output column that shadows a real table column:

    created_at       -- exists on user_profiles, goal_sessions, goal_session_trades
    email            -- exists on user_profiles
    account_balance  -- exists on user_profiles
    credit_balance   -- exists on user_token_balance (as "balance")
    trade_style      -- exists on goal_sessions
    dollar_risk      -- exists on goal_sessions

  PostgreSQL does NOT raise all ambiguities at parse time — it evaluates them
  lazily per-column during execution, so each fix exposed the next one.

  ## SSOT / CCIP Compliance
  - Rename ALL RETURNS TABLE output columns to prefixed "out_*" names that
    cannot conflict with any real table column.
  - The function body SELECT continues using fully-qualified "up.created_at",
    "up.email", etc. — unambiguous.
  - The admin-user-service.ts mapping layer reads columns by name from the
    returned rows — it must be updated to match the new "out_*" names.
  - No data is mutated. No tables or RLS policies are changed.

  ## Output Column Renames
    user_id                   (uuid)    -- no conflict, kept
    email           -> out_email
    created_at      -> out_created_at
    user_is_admin              -- already renamed, kept
    account_balance -> out_account_balance
    credit_balance  -> out_credit_balance
    total_trades               -- no conflict with joined tables, kept
    winning_trades             -- kept
    losing_trades              -- kept
    tp1_wins                   -- kept
    tp2_wins                   -- kept
    manual_closed              -- kept
    active_trades              -- kept
    active_trades_detail       -- kept
    scanning_sessions          -- kept
    scanning_duration_minutes  -- kept
    awaiting_response_sessions -- kept
    prompt_risk                -- kept
    trade_style     -> out_trade_style
    dollar_risk     -> out_dollar_risk
    last_activity              -- kept
*/

DROP FUNCTION IF EXISTS public.admin_get_all_users_paginated(text, integer, integer);

CREATE OR REPLACE FUNCTION public.admin_get_all_users_paginated(
  search_email text DEFAULT NULL,
  page_size integer DEFAULT 20,
  page_offset integer DEFAULT 0
)
RETURNS TABLE(
  user_id                    uuid,
  out_email                  text,
  out_created_at             timestamp with time zone,
  user_is_admin              boolean,
  out_account_balance        numeric,
  out_credit_balance         numeric,
  total_trades               bigint,
  winning_trades             bigint,
  losing_trades              bigint,
  tp1_wins                   bigint,
  tp2_wins                   bigint,
  manual_closed              bigint,
  active_trades              bigint,
  active_trades_detail       jsonb,
  scanning_sessions          bigint,
  scanning_duration_minutes  numeric,
  awaiting_response_sessions bigint,
  prompt_risk                text,
  out_trade_style            text,
  out_dollar_risk            numeric,
  last_activity              timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
DECLARE
  calling_user_id uuid;
BEGIN
  calling_user_id := auth.uid();

  IF NOT EXISTS (
    SELECT 1 FROM user_profiles up_auth
    WHERE up_auth.id = calling_user_id AND up_auth.is_admin = true
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    up.id,
    up.email,
    up.created_at,
    up.is_admin,
    up.account_balance,
    COALESCE(utb.balance, 0::numeric),

    COALESCE(ts.total_trades, 0::bigint),
    COALESCE(ts.winning_trades, 0::bigint),
    COALESCE(ts.losing_trades, 0::bigint),

    COALESCE(ts.tp1_wins, 0::bigint),
    COALESCE(ts.tp2_wins, 0::bigint),
    COALESCE(ts.manual_closed, 0::bigint),

    COALESCE(ts.active_trades, 0::bigint),

    COALESCE(at_data.trades_json, '[]'::jsonb),

    COALESCE(ss.scanning_count, 0::bigint),
    ss.scanning_duration_mins,
    COALESCE(ss.awaiting_count, 0::bigint),
    ss.risk_mode,

    COALESCE(ss.trade_style, rs.trade_style),
    COALESCE(ss.dollar_risk, rs.dollar_risk),

    GREATEST(
      up.created_at,
      COALESCE(ts.last_trade_time, up.created_at),
      COALESCE(ss.last_session_time, up.created_at)
    )

  FROM user_profiles up
  LEFT JOIN user_token_balance utb ON utb.user_id = up.id

  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (WHERE gst1.status = 'closed')                                                    AS total_trades,
      COUNT(*) FILTER (WHERE gst1.status = 'closed' AND gst1.profit_loss > 0)                           AS winning_trades,
      COUNT(*) FILTER (WHERE gst1.status = 'closed' AND gst1.profit_loss <= 0)                          AS losing_trades,
      COUNT(*) FILTER (WHERE gst1.status = 'closed' AND LOWER(COALESCE(gst1.close_reason,'')) IN ('take_profit_1','tp1')) AS tp1_wins,
      COUNT(*) FILTER (WHERE gst1.status = 'closed' AND LOWER(COALESCE(gst1.close_reason,'')) IN ('take_profit_2','tp2','take_profit','goal_achieved')) AS tp2_wins,
      COUNT(*) FILTER (WHERE gst1.status = 'closed' AND LOWER(COALESCE(gst1.close_reason,'')) = 'manual') AS manual_closed,
      COUNT(*) FILTER (WHERE gst1.status = 'open')                                                      AS active_trades,
      MAX(gst1.created_at)                                                                               AS last_trade_time
    FROM goal_session_trades gst1
    WHERE gst1.user_id = up.id
  ) ts ON true

  LEFT JOIN LATERAL (
    SELECT
      jsonb_agg(
        jsonb_build_object(
          'symbol',        inner_t.symbol,
          'pnl',           COALESCE(inner_t.live_pnl, 0),
          'direction',     inner_t.direction,
          'entry_price',   inner_t.entry_price,
          'current_price', COALESCE(inner_t.live_price, inner_t.entry_price)
        )
        ORDER BY inner_t.trade_created_at DESC
      ) AS trades_json
    FROM (
      SELECT
        gst2.symbol,
        gst2.direction,
        gst2.entry_price,
        gst2.position_size,
        gst2.created_at AS trade_created_at,
        CASE WHEN gst2.direction = 'buy' THEN lp.bid ELSE lp.ask END AS live_price,
        calculate_pnl_universal(
          gst2.symbol,
          gst2.direction,
          gst2.entry_price,
          CASE WHEN gst2.direction = 'buy' THEN COALESCE(lp.bid, gst2.entry_price) ELSE COALESCE(lp.ask, gst2.entry_price) END,
          COALESCE(gst2.position_size, 0.01)
        ) AS live_pnl
      FROM goal_session_trades gst2
      LEFT JOIN LATERAL (
        SELECT rp.bid, rp.ask
        FROM realtime_prices rp
        WHERE rp.symbol = gst2.symbol
        ORDER BY rp.created_at DESC
        LIMIT 1
      ) lp ON true
      WHERE gst2.user_id = up.id
        AND gst2.status = 'open'
      ORDER BY gst2.created_at DESC
      LIMIT 10
    ) inner_t
  ) at_data ON true

  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (WHERE gs1.status = 'scanning')           AS scanning_count,
      COUNT(*) FILTER (WHERE gs1.status = 'awaiting_response')  AS awaiting_count,
      MAX(gs1.created_at)                                        AS last_session_time,
      EXTRACT(EPOCH FROM (
        NOW() - MIN(COALESCE(gs1.scanning_started_at, gs1.start_time)) FILTER (WHERE gs1.status = 'scanning')
      )) / 60                                                    AS scanning_duration_mins,
      (
        SELECT gs2.risk_mode
        FROM goal_sessions gs2
        WHERE gs2.user_id = up.id AND gs2.status = 'scanning'
        ORDER BY gs2.updated_at DESC
        LIMIT 1
      ) AS risk_mode,
      (
        SELECT gs3.trade_style
        FROM goal_sessions gs3
        WHERE gs3.user_id = up.id
          AND gs3.status IN ('scanning','in_trade')
        ORDER BY gs3.updated_at DESC
        LIMIT 1
      ) AS trade_style,
      (
        SELECT gs4.dollar_risk
        FROM goal_sessions gs4
        WHERE gs4.user_id = up.id
          AND gs4.status IN ('scanning','in_trade')
        ORDER BY gs4.updated_at DESC
        LIMIT 1
      ) AS dollar_risk
    FROM goal_sessions gs1
    WHERE gs1.user_id = up.id
  ) ss ON true

  LEFT JOIN LATERAL (
    SELECT gs5.trade_style, gs5.dollar_risk
    FROM goal_sessions gs5
    WHERE gs5.user_id = up.id
    ORDER BY gs5.updated_at DESC
    LIMIT 1
  ) rs ON true

  WHERE (search_email IS NULL OR up.email ILIKE '%' || search_email || '%')

  ORDER BY
    CASE WHEN COALESCE(ts.active_trades, 0) > 0 THEN 0 ELSE 1 END,
    CASE WHEN COALESCE(ss.scanning_count, 0) > 0 THEN 0 ELSE 1 END,
    GREATEST(
      up.created_at,
      COALESCE(ts.last_trade_time, up.created_at),
      COALESCE(ss.last_session_time, up.created_at)
    ) DESC

  LIMIT page_size
  OFFSET page_offset;
END;
$$;
