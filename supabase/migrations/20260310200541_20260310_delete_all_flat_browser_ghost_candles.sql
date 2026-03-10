/*
  # Delete ALL Flat Browser-Aggregated Ghost Candles

  ## Problem
  The browser-based candle aggregator has been writing flat candles (open=high=low=close)
  going back to February 6, 2026. These ghost candles pollute the chart display for
  BTCUSD, ETHUSD, EURUSD, GBPUSD, USDJPY, XAUUSD, US30, NAS100, SPX500, and others.

  A previous migration only cleaned 48 hours — this cleans ALL historical flat ghost candles.

  ## What This Deletes
  Only rows where ALL of these are true:
  1. data_source = 'browser_aggregated'
  2. open = high = low = close (flat/ghost candle with no real price movement)

  The netlify_aggregator candles are confirmed clean (0 flat candles) and are NOT touched.

  ## Scale
  - BTCUSD M1: ~18,684 flat candles
  - ETHUSD M1: ~12,448 flat candles
  - Plus thousands more across other symbols/timeframes

  ## Safety
  - Only deletes browser_aggregated source
  - Only deletes geometrically flat candles
  - netlify_aggregator data is untouched
  - Real candles (with genuine OHLC spread) are untouched
*/

DELETE FROM forex_candles
WHERE data_source = 'browser_aggregated'
  AND open = high
  AND high = low
  AND low = close;
