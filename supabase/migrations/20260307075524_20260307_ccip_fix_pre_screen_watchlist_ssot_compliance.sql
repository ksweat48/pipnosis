/*
  # CCIP Fix: Pre-Screen Results — Purge Non-Watchlist Symbols

  ## Summary
  Removes stale rows for AUDUSD and USDCAD from the pre_screen_results table.
  These symbols are NOT part of the 9 official Pipnosis trading pairs defined in
  DEFAULT_WATCHLIST (src/config/watchlist.ts) and were incorrectly written by a
  misconfigured pre-screen-structure-monitor.ts function.

  ## Root Cause
  The SYMBOLS array in netlify/functions/pre-screen-structure-monitor.ts contained
  AUDUSD and USDCAD instead of ETHUSD and SPX500. This caused the Intelligence
  Monitor (IM) to display pairs the system does not trade.

  ## Official 9 Trading Pairs (SSOT: DEFAULT_WATCHLIST)
  XAUUSD, US30, NAS100, SPX500, EURUSD, GBPUSD, USDJPY, BTCUSD, ETHUSD

  ## Changes
  1. DELETE all pre_screen_results rows where symbol = 'AUDUSD'
  2. DELETE all pre_screen_results rows where symbol = 'USDCAD'

  ## CCIP Governance
  - This is a data correction, not a schema change
  - Idempotent: safe to run multiple times
  - No RLS changes required
  - The pre-screen-structure-monitor.ts SYMBOLS array has been corrected in the
    same CCIP change batch to prevent these rows from being re-created

  ## Post-Deploy Verification
  Run: SELECT DISTINCT symbol FROM pre_screen_results ORDER BY symbol;
  Expected: Only the 9 official pairs appear. AUDUSD and USDCAD must not appear.
*/

DELETE FROM pre_screen_results
WHERE symbol IN ('AUDUSD', 'USDCAD');
