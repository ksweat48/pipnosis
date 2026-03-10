/*
  # Delete Flat Crypto Ghost Candles (CCIP Governance Cleanup)

  ## Summary
  Removes all flat ghost candles for BTCUSD and ETHUSD from the last 48 hours.

  ## Root Cause
  The browser-side BackgroundCandleAggregator was writing flat candles (open=high=low=close)
  to forex_candles whenever its gap-filler ran and no real tick had arrived for a period.
  It used a stale lastPriceCache value (e.g., 2054.785) as the entire OHLC, producing
  candles indistinguishable from zero-movement periods. These then cascaded into M15/M30
  via the Netlify aggregator's aggregateFromLowerTimeframe(), which was aggregating flat
  M5 source candles into flat M15/M30 candles.

  ## What is deleted
  - All browser_aggregated crypto candles where open=high=low=close (48hr window)
  - All netlify_aggregator crypto candles where open=high=low=close (48hr window)
  - Only BTCUSD and ETHUSD — forex is unaffected
  - Only truly flat candles (open=high AND high=low AND low=close)

  ## Safety
  - Verified zero conflicts: no deleted timestamp has a co-existing non-flat candle
  - Netlify aggregator will regenerate correct candles on next 5-min run from real tick data
  - SSOT: Netlify aggregator is the sole persistence authority post-fix

  ## Governance
  - CCIP: candle write authority transferred exclusively to netlify_aggregator
  - Browser aggregator retains in-memory forming-candle state only (no DB writes)
*/

DELETE FROM forex_candles
WHERE symbol IN ('BTCUSD', 'ETHUSD')
  AND open_time > NOW() - INTERVAL '48 hours'
  AND open = high
  AND high = low
  AND low = close;
