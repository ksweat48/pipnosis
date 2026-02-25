/*
  # Schedule Server-Side P&L Updater

  ## Purpose
  Schedules the `update-open-trade-pnl` Edge Function to run every minute via pg_cron.
  This ensures `current_pnl` stays fresh for ALL open trades on the LiveTradesTicker,
  even when the trade owner is not actively browsing.

  ## Root Cause Fixed
  The client-side position-monitor only runs for the authenticated user's own session.
  When the trade owner is offline, `current_pnl` freezes at its last value and the
  LiveTradesTicker shows stale P&L to all viewers.

  ## What This Does
  - Adds a pg_cron job that fires every minute
  - Calls the `update-open-trade-pnl` Edge Function via net.http_post
  - The function reads live bid/ask from `realtime_prices` and writes updated
    `current_pnl` and `current_price` to ALL open `goal_session_trades` rows
  - The Realtime subscription in LiveTradesTicker then receives the UPDATE event
    and patches the P&L in local state with zero network round-trip

  ## SSOT Compliance
  - Only writes `current_pnl` and `current_price` — no business logic mutations
  - Does NOT close trades (sole authority: position-monitoring-authority)
  - Does NOT modify stop_loss, take_profit, or governance fields
  - Uses identical pip/dollar-per-pip formula as currencyHelpers.ts

  ## Security
  - pg_cron jobs run with service_role privileges
  - Edge function uses SUPABASE_SERVICE_ROLE_KEY (server-side only)

  ## Important Notes
  1. pg_cron minimum resolution is 1 minute. For sub-minute updates the client-side
     position-monitor (when the user IS online) continues to write every 2 seconds.
  2. The cron job is idempotent — safe to run even when no trades are open.
  3. Unschedules any existing job with the same name before re-scheduling.
*/

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('update-open-trade-pnl');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    PERFORM cron.schedule(
      'update-open-trade-pnl',
      '* * * * *',
      'SELECT net.http_post(url:=current_setting(''app.supabase_url'') || ''/functions/v1/update-open-trade-pnl'', body:=''{}''::jsonb, headers:=jsonb_build_object(''Content-Type'', ''application/json'')) AS request_id;'
    );
  END IF;
END $$;
