/*
  # CCIP Stability Fix: Corrupt Candle Cleanup & Regime Signature Cache Governance

  ## Summary
  This migration addresses two production stability issues identified from live scan telemetry.

  ---

  ## 1. Corrupt Candle Row Cleanup (US30 & GBPUSD)

  ### Problem
  Rows exist in forex_candles for US30 and GBPUSD where (high - low) / midprice > 5%.
  These rows are rejected by fetchPreAggregatedCandles on EVERY scan cycle, generating
  repeated "REJECTED candle N for SYMBOL: extreme range X%" console noise. While
  they do not block trade execution, they inflate the governance error rate metric and
  contaminate log telemetry.

  Specific candles observed in production:
    - US30:   candle_index 237, 240 (ranges 10.04%, 8.2%)
    - GBPUSD: candle_index 188, 189, 192 (ranges 7.90%, 6.3%, 5.8%)

  ### Fix
  DELETE corrupt rows where the candle range exceeds 5% of the midpoint price.

  ---

  ## 2. Alpha Thesis Cache Regime Signature Governance

  ### Problem
  Regime signature hash was invalidated every ~60s scan in sideways markets, causing:
    - 66.7% governance error rate (NAS100/EURUSD timing out)
    - 126s scan time (exceeds 120s alert threshold)
    - Full LLM thesis regeneration for all 9 symbols per cycle

  ### TypeScript Fixes Applied (documented here for CCIP audit trail):
  File: src/services/regime-signature-extractor.ts
    - extractMicroRegime: reversalScore threshold >30 → >40, scalperScore >25 → >35, trending floor <15 → <10
    - extractStructureState: strong_trend >30 → >40, choppy <10 → <7, consolidating <20 → <15

  File: src/config/time-constants.ts
    - ALPHA_THESIS TTL: 300,000ms (5 min) → 900,000ms (15 min)
    - Rationale: Two independent guards already prevent stale thesis serving:
      (1) H1+ candle close evicts local cache via invalidateThesisForSymbol()
      (2) detectRegimeChange() invalidates on material signature shifts

  File: src/services/shared-intelligence-coordinator.ts
    - Comment SSOT fix: "15 minutes fixed" comment was misleading when TTL was 5 min

  ## Tables Modified
  - forex_candles: DELETE corrupt rows (US30, GBPUSD) — data-only, no schema change

  ## Security
  - RLS policies unaffected
  - No new tables or columns
*/

-- ============================================================
-- CORRUPT CANDLE CLEANUP
-- Removes rows with physically impossible price ranges (>5% midpoint)
-- that generate rejection noise on every scan cycle.
-- ============================================================

DELETE FROM forex_candles
WHERE symbol IN ('US30', 'GBPUSD')
  AND (high - low) / NULLIF(((open + close) / 2.0), 0) > 0.05;
