/*
  CCIP Governance: Remove Duplicate Supabase Candle Aggregator

  Root Cause:
  During a console-warning fix attempt, a Supabase edge function (aggregate-candles) was
  created and scheduled via pg_cron every 2 minutes. This created a second candle aggregator
  running in parallel with the authoritative Netlify continuous-candle-aggregator.

  SSOT Authority:
  The Netlify continuous-candle-aggregator function (netlify.toml: every 2 minutes) is the
  SOLE AUTHORITY for candle aggregation. It reads broker ticks, applies cascading quality
  hierarchy, and uses MetaAPI as the dead-man switch for gap-fill.

  Changes:
  - Removes pg_cron job: aggregate-candles-every-2-min
  - Eliminates dual-write conflicts to forex_candles table
  - Removes unnecessary DB load from simultaneous aggregation runs
  - Restores correct per-symbol candle differentiation
*/

SELECT cron.unschedule('aggregate-candles-every-2-min');
