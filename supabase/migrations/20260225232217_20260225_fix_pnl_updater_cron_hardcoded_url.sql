/*
  # Fix Server-Side P&L Updater — Hardcoded URL in cron command

  ## Problem
  The pg_cron job keeping current_pnl fresh for ALL open trades was silently
  failing because current_setting('app.supabase_url') returns NULL. The database
  config parameter was never set, so the HTTP POST never fired, and the
  LiveTradesTicker showed frozen P&L values to every viewer.

  ## Root Cause
  The cron command used current_setting('app.supabase_url') but this GUC was
  never initialised via ALTER DATABASE (requires superuser). The safe fix is to
  embed the project URL directly in the cron command string — the same pattern
  used by all other working cron jobs in this project.

  ## What This Migration Does
  1. Unschedules the broken job (URL was NULL, HTTP POST never sent)
  2. Reschedules with the literal Supabase project URL + Authorization header
     so the edge function call is correctly authenticated

  ## SSOT Compliance
  - Only writes current_pnl and current_price — no business logic mutations
  - Does NOT close trades (sole authority: position-monitoring-authority)
  - Uses identical pip formula as currencyHelpers.ts / position-monitor.ts

  ## CCIP Governance
  - Change category: Infrastructure / Scheduler Fix
  - Owner: update-open-trade-pnl edge function
  - Risk: Low — fixes silent failure, no schema changes, idempotent
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
      'SELECT net.http_post(url:=''https://nzisgxdlydihlwsvonfy.supabase.co/functions/v1/update-open-trade-pnl'', body:=''{}''::jsonb, headers:=jsonb_build_object(''Content-Type'', ''application/json'', ''Authorization'', ''Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56aXNneGRseWRpaGx3c3ZvbmZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk1OTU1NDAsImV4cCI6MjA3NTE3MTU0MH0.ZK6iWNbmb0BR5ZhzWQrTaZR_09Z0ls5Og9dFpmcuh7M'')) AS request_id;'
    );

  END IF;
END $$;
