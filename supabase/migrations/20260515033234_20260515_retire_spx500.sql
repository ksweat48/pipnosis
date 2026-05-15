/*
  # CCIP-2026-0515B-SPX500-RETIREMENT — SPX500 platform retirement

  ## Summary
  SPX500 is fully retired. Remaining 8 instruments (XAUUSD, US30, NAS100,
  EURUSD, GBPUSD, USDJPY, BTCUSD, ETHUSD) continue.

  ## Safety
  Pre-flight: 0 OPEN SPX500/SP500/US500 trades. Historical closed records
  preserved (~53 rows) for accounting and learning.

  ## Changes
  1. Hard guard against running with any remaining open SPX500 trades
  2. Strip SPX500/SP500/US500 from goal_sessions.watchlist[] arrays (text[])
  3. CHECK constraint blocking new SPX500/SP500/US500 inserts (NOT VALID)
*/

DO $$
DECLARE
  v_open_spx integer;
  v_session_count integer := 0;
BEGIN
  SELECT COUNT(*) INTO v_open_spx
  FROM goal_session_trades
  WHERE symbol IN ('SPX500', 'SP500', 'US500')
    AND status = 'open';

  IF v_open_spx > 0 THEN
    RAISE EXCEPTION 'CCIP-2026-0515B: % open SPX500 trades exist — close first',
      v_open_spx;
  END IF;

  UPDATE goal_sessions
  SET watchlist = ARRAY(
    SELECT s FROM unnest(watchlist) s
    WHERE s NOT IN ('SPX500', 'SP500', 'US500')
  )
  WHERE watchlist IS NOT NULL
    AND (
      'SPX500' = ANY(watchlist)
      OR 'SP500' = ANY(watchlist)
      OR 'US500' = ANY(watchlist)
    );

  GET DIAGNOSTICS v_session_count = ROW_COUNT;

  IF v_session_count > 0 THEN
    RAISE NOTICE 'CCIP-2026-0515B: stripped retired symbols from % session watchlists',
      v_session_count;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'goal_session_trades_no_retired_symbols_chk'
  ) THEN
    ALTER TABLE goal_session_trades
      ADD CONSTRAINT goal_session_trades_no_retired_symbols_chk
      CHECK (symbol NOT IN ('SPX500', 'SP500', 'US500'))
      NOT VALID;
  END IF;
END $$;
