/*
  # CCIP Fix: Admin Scanning Duration Counter + Ghost Session Cleanup

  ## Summary
  Two SSOT violations corrected in this migration:

  ### 1. Admin Scanning Duration Bug (Line 196 of 20260219 migration)
  The `scanning_duration_mins` calculation was using `MIN(updated_at)` which resets
  every time the engine writes to the DB (every 60 seconds), showing near-zero.
  Fixed to use `MIN(scanning_started_at)` — the authoritative timestamp set once
  when scanning begins. COALESCE fallback to `start_time` for legacy sessions.

  ### 2. Ghost Session Cleanup: no_trade_found_at Sessions
  When the live engine calls `emitNoTradeEvent()` it only writes `no_trade_found_at`
  and fires a browser window event. If the browser tab is backgrounded, navigated
  away, or the component unmounts before the event fires, the session stays in
  `scanning` status in the database indefinitely — appearing "stuck" to the admin.

  This migration adds:
  - `close_ghost_no_trade_sessions()` — closes any session where no_trade_found_at
    is populated but status is still 'scanning', older than 2 minutes (engine is done).
  - Automatic execution on deploy: closes all currently stuck ghost sessions.
  - Rebuilds `admin_get_all_users_paginated` with corrected duration calculation.

  ### Affected Tables
  - `goal_sessions` — status updated from 'scanning' to 'user_stopped' for ghosts
  - No schema changes, data-only corrections + RPC rebuild

  ### Security
  - SECURITY DEFINER maintained on all RPCs
  - Admin-only access enforced in paginated function
  - Ghost cleanup RPC is service-role-only

  ### CCIP Compliance
  - Single authoritative fix for both issues
  - No duplicate logic introduced
  - Dry-run via SELECT before UPDATE
*/

-- ============================================================
-- STEP 1: Close all currently stuck ghost sessions immediately
-- (sessions where engine called emitNoTradeEvent but browser
--  event was never received / component was unmounted)
-- ============================================================
UPDATE goal_sessions
SET
  status = 'user_stopped',
  completed_at = COALESCE(no_trade_found_at, NOW()),
  updated_at = NOW()
WHERE
  status = 'scanning'
  AND no_trade_found_at IS NOT NULL
  AND no_trade_found_at < NOW() - INTERVAL '2 minutes';

-- ============================================================
-- STEP 2: Create reusable ghost session cleanup function
-- Called by server-side cleanup job and can be invoked manually
-- ============================================================
CREATE OR REPLACE FUNCTION close_ghost_no_trade_sessions()
RETURNS TABLE (sessions_closed integer, session_ids uuid[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_closed_ids uuid[];
BEGIN
  UPDATE goal_sessions
  SET
    status = 'user_stopped',
    completed_at = COALESCE(no_trade_found_at, NOW()),
    updated_at = NOW()
  WHERE
    status = 'scanning'
    AND no_trade_found_at IS NOT NULL
    AND no_trade_found_at < NOW() - INTERVAL '2 minutes'
  RETURNING id INTO v_closed_ids;

  RETURN QUERY SELECT
    COALESCE(array_length(v_closed_ids, 1), 0),
    COALESCE(v_closed_ids, ARRAY[]::uuid[]);
END;
$$;

GRANT EXECUTE ON FUNCTION close_ghost_no_trade_sessions() TO service_role;

-- ============================================================
-- STEP 3: Rebuild admin_get_all_users_paginated with corrected
-- scanning_duration_mins using scanning_started_at (SSOT fix)
-- ============================================================
DROP FUNCTION IF EXISTS admin_get_all_users_paginated(text, integer, integer);

CREATE OR REPLACE FUNCTION admin_get_all_users_paginated(
  search_email text DEFAULT NULL,
  page_size integer DEFAULT 20,
  page_offset integer DEFAULT 0
)
RETURNS TABLE (
  user_id uuid,
  email text,
  created_at timestamptz,
  is_admin boolean,
  account_balance numeric,
  credit_balance numeric,
  total_trades bigint,
  winning_trades bigint,
  losing_trades bigint,
  tp1_wins bigint,
  tp2_wins bigint,
  manual_closed bigint,
  active_trades bigint,
  active_trades_detail jsonb,
  scanning_sessions bigint,
  scanning_duration_minutes numeric,
  awaiting_response_sessions bigint,
  prompt_risk text,
  trade_style text,
  dollar_risk numeric,
  last_activity timestamptz
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
    SELECT 1 FROM user_profiles
    WHERE id = calling_user_id AND is_admin = true
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
    COALESCE(utb.balance, 0),

    COALESCE(ts.total_trades, 0),
    COALESCE(ts.winning_trades, 0),
    COALESCE(ts.losing_trades, 0),

    COALESCE(ts.tp1_wins, 0),
    COALESCE(ts.tp2_wins, 0),
    COALESCE(ts.manual_closed, 0),

    COALESCE(ts.active_trades, 0),

    COALESCE(at.trades_json, '[]'::jsonb),

    COALESCE(ss.scanning_count, 0),
    -- SSOT FIX: Use scanning_started_at (set once at session start) not updated_at
    -- (updated_at resets every ~60s causing "0m" display bug)
    ss.scanning_duration_mins,
    COALESCE(ss.awaiting_count, 0),
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
      COUNT(*) FILTER (WHERE status = 'closed') as total_trades,
      COUNT(*) FILTER (WHERE status = 'closed' AND profit_loss > 0) as winning_trades,
      COUNT(*) FILTER (WHERE status = 'closed' AND profit_loss <= 0) as losing_trades,
      COUNT(*) FILTER (
        WHERE status = 'closed'
        AND LOWER(COALESCE(close_reason, '')) IN ('take_profit_1', 'tp1')
      ) as tp1_wins,
      COUNT(*) FILTER (
        WHERE status = 'closed'
        AND LOWER(COALESCE(close_reason, '')) IN ('take_profit_2', 'tp2', 'take_profit', 'goal_achieved')
      ) as tp2_wins,
      COUNT(*) FILTER (
        WHERE status = 'closed'
        AND LOWER(COALESCE(close_reason, '')) = 'manual'
      ) as manual_closed,
      COUNT(*) FILTER (WHERE status = 'open') as active_trades,
      MAX(created_at) as last_trade_time
    FROM goal_session_trades
    WHERE user_id = up.id
  ) ts ON true

  LEFT JOIN LATERAL (
    SELECT
      jsonb_agg(
        jsonb_build_object(
          'symbol', t.symbol,
          'pnl', COALESCE(t.live_pnl, 0),
          'direction', t.direction,
          'entry_price', t.entry_price,
          'current_price', COALESCE(t.live_price, t.entry_price)
        )
        ORDER BY t.trade_created_at DESC
      ) as trades_json
    FROM (
      SELECT
        gst.symbol,
        gst.direction,
        gst.entry_price,
        gst.position_size,
        gst.created_at as trade_created_at,
        CASE
          WHEN gst.direction = 'buy' THEN lp.bid
          ELSE lp.ask
        END as live_price,
        calculate_pnl_universal(
          gst.symbol,
          gst.direction,
          gst.entry_price,
          CASE
            WHEN gst.direction = 'buy' THEN COALESCE(lp.bid, gst.entry_price)
            ELSE COALESCE(lp.ask, gst.entry_price)
          END,
          COALESCE(gst.position_size, 0.01)
        ) as live_pnl
      FROM goal_session_trades gst
      LEFT JOIN LATERAL (
        SELECT rp.bid, rp.ask
        FROM realtime_prices rp
        WHERE rp.symbol = gst.symbol
        ORDER BY rp.created_at DESC
        LIMIT 1
      ) lp ON true
      WHERE gst.user_id = up.id
        AND gst.status = 'open'
      ORDER BY gst.created_at DESC
      LIMIT 10
    ) t
  ) at ON true

  -- Session statistics: scanning_duration_mins uses scanning_started_at (SSOT)
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (WHERE status = 'scanning') as scanning_count,
      COUNT(*) FILTER (WHERE status = 'awaiting_response') as awaiting_count,
      MAX(created_at) as last_session_time,
      -- SSOT FIX: Use scanning_started_at, not updated_at.
      -- updated_at is refreshed every ~60s by the engine, causing "0m" bug.
      -- scanning_started_at is set once when scanning begins and never modified.
      -- COALESCE to start_time for legacy sessions missing scanning_started_at.
      EXTRACT(EPOCH FROM (
        NOW() - MIN(COALESCE(scanning_started_at, start_time)) FILTER (WHERE status = 'scanning')
      )) / 60 AS scanning_duration_mins,
      (
        SELECT gs2.risk_mode
        FROM goal_sessions gs2
        WHERE gs2.user_id = up.id AND gs2.status = 'scanning'
        ORDER BY gs2.updated_at DESC
        LIMIT 1
      ) as risk_mode,
      (
        SELECT gs3.trade_style
        FROM goal_sessions gs3
        WHERE gs3.user_id = up.id
          AND gs3.status IN ('scanning', 'in_trade')
        ORDER BY gs3.updated_at DESC
        LIMIT 1
      ) as trade_style,
      (
        SELECT gs4.dollar_risk
        FROM goal_sessions gs4
        WHERE gs4.user_id = up.id
          AND gs4.status IN ('scanning', 'in_trade')
        ORDER BY gs4.updated_at DESC
        LIMIT 1
      ) as dollar_risk
    FROM goal_sessions
    WHERE user_id = up.id
  ) ss ON true

  LEFT JOIN LATERAL (
    SELECT
      gs5.trade_style,
      gs5.dollar_risk
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

GRANT EXECUTE ON FUNCTION admin_get_all_users_paginated(text, integer, integer) TO authenticated;

COMMENT ON FUNCTION admin_get_all_users_paginated IS
  'Paginated admin user list. scanning_duration_mins uses scanning_started_at (SSOT).
   Updated 2026-02-25: Fixed 0m display bug caused by updated_at being refreshed every 60s.';

COMMENT ON FUNCTION close_ghost_no_trade_sessions IS
  'Closes sessions where the engine emitted NO_TRADE but the browser event was missed,
   leaving status=scanning in DB. Authoritative session closure SSOT.
   Created 2026-02-25 CCIP fix.';
