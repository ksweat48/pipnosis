/*
  # CCIP-2026-04-07: Remove Static Volatility Classification from Trading Engine

  ## Summary
  Removes the static ATR-percentage-based volatility classifier that incorrectly
  labelled high-price instruments (NAS100, US30) as 'low volatility' on every scan.

  ## Root Cause
  atrPercent = (atr / price) * 100 with threshold < 0.3 produced 'low' for NAS100/US30.
  This caused 16x wall multiplier, 40% TP floor compression, and 0.9x stop loss tightening
  on every scan for these instruments.

  ## Resolution
  - FIXED_ATR_MULTIPLIER = 14 (single value, no regime branching)
  - TP floor compression REMOVED — envelope floors used as-is
  - Stop loss volatility multiplier REMOVED — defaults to 'normal' (1.0x)
  - All three determineVolatility() implementations removed from the engine layer
  - Market snapshot now provides raw atrPercent; Alpha interprets volatility itself

  ## Files Changed
  llm-snapshot-builder.ts, event-based-llm-engine.ts, market-snapshot-cache.ts,
  wall-calibration-config.ts, wall-calibration-engine.ts, coordinator-alpha.ts,
  omega9-constraint-provider.ts, omega9-constraints.ts

  ## Security
  No RLS changes.
*/

-- Add base_multiplier_used column to wall_calibration_events
-- Replaces the semantics of regime_multiplier_used (now always FIXED_ATR_MULTIPLIER)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'wall_calibration_events' AND column_name = 'base_multiplier_used'
  ) THEN
    ALTER TABLE wall_calibration_events ADD COLUMN base_multiplier_used numeric DEFAULT 14;
  END IF;
END $$;
