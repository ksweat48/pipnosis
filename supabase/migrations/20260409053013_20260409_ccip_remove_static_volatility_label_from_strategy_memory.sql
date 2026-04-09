/*
  # Remove Static Volatility Label from Alpha Strategy Memory

  ## Problem
  The `volatility` column in `alpha_strategy_memory` was defined as NOT NULL, requiring
  callers to supply a static string label ('low', 'medium', 'high'). This violated
  CCIP-2026-04-07 which removed all static ATR-based volatility classifiers from the
  system. The column had a hardcoded fallback of 'medium' introduced as a patch,
  which stored meaningless static noise into the strategy learning system.

  ## Changes
  1. `alpha_strategy_memory.volatility` - DROP NOT NULL constraint (make nullable)
     - Alpha receives raw ATR data via `atr_at_plan` and `market_indicators` jsonb
     - Alpha interprets volatility from raw data itself — no string label needed
     - The NOT NULL constraint was forcing a static fallback that polluted learning data

  ## Impact
  - All symbols affected (not just XAUUSD): EURUSD, GBPUSD, USDJPY, US30, NAS100,
    SPX500, BTCUSD, ETHUSD all use the same engine path
  - Regime matching in loadMemory now uses market_regime only (not volatility string)
  - Existing rows with 'medium' label are left as-is (historical audit data)

  ## Security
  - No RLS changes required
  - No new tables or policies
*/

ALTER TABLE alpha_strategy_memory
  ALTER COLUMN volatility DROP NOT NULL;
