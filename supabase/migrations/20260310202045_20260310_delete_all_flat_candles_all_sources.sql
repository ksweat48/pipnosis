/*
  # Delete all flat candles from all sources

  ## Summary
  Previous fix only removed browser_aggregated flat candles. The raw forex_candles
  table still contains tens of thousands of flat candles from metaapi (~335K),
  netlify_aggregator (~31K), gap_fill (~3K), and other sources.

  The is_flat_candle column is a generated column (auto-computed), so the
  forex_candles_best view already correctly excludes rows where is_flat_candle = true.
  However, candle-data-service.ts and chart-candle-poller.ts query the raw
  forex_candles table directly, bypassing the view's quality filters entirely.

  ## Changes
  1. Delete ALL flat candles (open = high = low = close) from forex_candles table
     across ALL data sources (metaapi, netlify_aggregator, gap_fill, dukascopy, etc.)

  ## Why This is Safe
  - Flat candles have zero price movement - they represent periods of no data
  - They appear as horizontal lines on the chart and are visually broken
  - The generated is_flat_candle flag already marks them as bad quality
  - The forex_candles_best view already excludes them - deleting them from
    the source table removes them from ALL query paths permanently
*/

DELETE FROM forex_candles
WHERE open = high
  AND high = low
  AND low = close;
