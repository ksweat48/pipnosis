/*
  # Enable Realtime Publication for realtime_prices Table

  ## Purpose
  The LiveTradesTicker needs to subscribe to price changes in realtime_prices
  so it can calculate P&L client-side in real time (sub-second updates) without
  waiting for the server-side pg_cron job (1-minute cycle).

  ## What This Migration Does
  Adds the realtime_prices table to the supabase_realtime publication so that
  INSERT and UPDATE events are broadcast to all authenticated subscribers.

  ## SSOT Compliance
  - Read-only subscription pattern — LiveTradesTicker never mutates realtime_prices
  - Price authority remains with the hybrid-price-collector / browser-price-poller

  ## CCIP Governance
  - Change category: Infrastructure / Realtime Subscription
  - Owner: LiveTradesTicker (display-only, read-only consumer)
  - Risk: Low — additive only, does not change write path

  ## Security
  - realtime_prices RLS policies remain in force
  - Authenticated users can read (SELECT) prices — existing policy
  - No new write permissions granted
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'realtime_prices'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE realtime_prices;
  END IF;
END $$;
