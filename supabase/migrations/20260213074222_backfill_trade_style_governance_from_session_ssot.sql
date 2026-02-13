/*
  # Backfill Trade Style Governance from Session SSOT

  ## Summary
  Historical trades have `requested_style: 'INTRADAY'` and `resolved_style: 'INTRADAY'` because
  the application code never populated these columns during trade creation. The column defaults
  from migration 20260107075800 were the only values ever written.

  This migration corrects all historical records by deriving the canonical style from the
  authoritative source: `goal_sessions.trade_style`.

  ## Root Cause (CCIP Governance Record)
  - `buildTradeRecord()` in `alpha-trade-executor.ts` omitted `requested_style` and `resolved_style`
  - `normalizeStyle()` correctly computed the canonical style in `execute()` but never passed it downstream
  - `createPostExecutionEntryIntent()` referenced undefined `tradeStyle` variable (runtime error)
  - Both issues fixed in the same code change (CCIP-2026-02-13)

  ## Changes
  1. Updates `requested_style` on all trades by mapping `goal_sessions.trade_style` to canonical form
  2. Updates `resolved_style` to match (no style upgrades were ever applied historically)
  3. Sets `style_upgrade_applied` to false (confirms no upgrades occurred)

  ## Mapping Logic (matches normalizeToCanonicalStyle in alpha-trade-executor.ts)
  - 'scalper', 'scalp' -> 'SCALP'
  - 'micro', 'micro_intraday' -> 'MICRO_INTRADAY'
  - 'day', 'intraday' -> 'INTRADAY'
  - NULL or unrecognized -> 'SCALP' (matches code default)

  ## Safety
  - Only updates trades where requested_style = 'INTRADAY' (the incorrect default)
  - Idempotent: re-running produces the same result
  - No destructive operations
*/

UPDATE goal_session_trades t
SET
  requested_style = CASE
    WHEN LOWER(TRIM(gs.trade_style)) IN ('scalper', 'scalp') THEN 'SCALP'
    WHEN LOWER(TRIM(gs.trade_style)) IN ('micro', 'micro_intraday') THEN 'MICRO_INTRADAY'
    WHEN LOWER(TRIM(gs.trade_style)) IN ('day', 'intraday') THEN 'INTRADAY'
    WHEN gs.trade_style IS NULL OR TRIM(gs.trade_style) = '' THEN 'SCALP'
    ELSE 'SCALP'
  END,
  resolved_style = CASE
    WHEN LOWER(TRIM(gs.trade_style)) IN ('scalper', 'scalp') THEN 'SCALP'
    WHEN LOWER(TRIM(gs.trade_style)) IN ('micro', 'micro_intraday') THEN 'MICRO_INTRADAY'
    WHEN LOWER(TRIM(gs.trade_style)) IN ('day', 'intraday') THEN 'INTRADAY'
    WHEN gs.trade_style IS NULL OR TRIM(gs.trade_style) = '' THEN 'SCALP'
    ELSE 'SCALP'
  END,
  style_upgrade_applied = false
FROM goal_sessions gs
WHERE t.goal_session_id = gs.id
  AND t.requested_style = 'INTRADAY';
