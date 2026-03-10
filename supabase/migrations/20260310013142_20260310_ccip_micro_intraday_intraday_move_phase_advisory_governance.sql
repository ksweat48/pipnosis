/*
  # CCIP: MICRO_INTRADAY and INTRADAY Move Phase Advisory Governance

  ## Summary
  Applies the same EXHAUSTED-phase advisory reframe (previously applied to SCALP)
  to MICRO_INTRADAY and INTRADAY styles in coordinator-alpha.ts.

  ## Changes

  ### 1. New: MICRO_INTRADAY M15 Move Phase Advisory Block
  - Added microIntradayMovePhaseContext block, parallel to intradayMovePhaseContext
  - Fires when styleName === 'MICRO_INTRADAY' && atrForStopLoss > 0
  - Uses M15 candles and M15 14-period ATR (marketContext.atr via styleAtrMap - SSOT)
  - Classifies M15 move as FRESH / DEVELOPING / EXHAUSTED with explicit pip thresholds
  - Detects M15 fakeouts (bullish/bearish, reversal-confirmed flag)
  - EXHAUSTED phase: ADVISORY - reduce confidence 15-25 points, reason about
    reversal/retest/sweep, NOT a hard NO_TRADE block
  - Requires JSON fields: m15_move_phase and m15_atr_traveled

  ### 2. Updated: INTRADAY EXHAUSTED Language Reframed to Advisory
  - Matches SCALP advisory pattern: confidence reduction, not categorical block
  - Preserved R:R math gate: only NO_TRADE if recalculated TP1 R:R < 1.0:1

  ### 3. Updated: MICRO_INTRADAY ATR Legend Exhausted Suffix
  - Advisory framing matching SCALP pattern

  ## Files Modified
  - src/brains/coordinator-alpha.ts (prompt governance changes only)
  - No database schema changes.
*/

INSERT INTO ccip_change_tracking (
  id,
  user_id,
  operation_type,
  table_name,
  record_id,
  change_details,
  created_at,
  updated_at
) VALUES (
  gen_random_uuid(),
  '30177afc-5b98-41ab-832a-a3e5a875e6c0',
  'PROMPT_GOVERNANCE',
  'coordinator-alpha.ts',
  gen_random_uuid(),
  jsonb_build_object(
    'change_id', '20260310-ccip-micro-intraday-move-phase-advisory',
    'description', 'Added MICRO_INTRADAY M15 move phase advisory block. Reframed INTRADAY and MICRO_INTRADAY EXHAUSTED phase from hard block to advisory (confidence -15 to -25 pts). Preserves R:R math gate for INTRADAY.',
    'affected_styles', ARRAY['MICRO_INTRADAY', 'INTRADAY'],
    'breaking_change', false,
    'files_modified', ARRAY['src/brains/coordinator-alpha.ts']
  ),
  now(),
  now()
);
