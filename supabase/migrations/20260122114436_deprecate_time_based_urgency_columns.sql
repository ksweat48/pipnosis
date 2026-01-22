/*
  # Deprecate Time-Based Urgency Columns (CCIP-2026-01-22-001)

  **CCIP COMPLIANCE:** Change Control Intelligence Protocol

  ## Change Summary
  Deprecates time-based urgency phase columns while preserving historical data.

  ## Changes
  1. Mark urgency-related columns as deprecated (NO DROP)
  2. Add database comments explaining deprecation
  3. Application layer will stop writing to deprecated columns
  4. Preserve all historical data for analysis

  ## Data Safety
  - NO DATA LOSS: Columns preserved
  - NO DESTRUCTIVE OPERATIONS: No DROP statements
  - BACKWARD COMPATIBLE: Old data remains queryable

  ## Migration Safety
  - Safe to run in production
  - No downtime required
  - No data modification
  - Reversible by updating comments
*/

-- Add deprecation comment to urgency_phase
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents'
    AND column_name = 'urgency_phase'
  ) THEN
    COMMENT ON COLUMN entry_intents.urgency_phase IS
      'DEPRECATED (2026-01-22): Time-based urgency phases (Phase 1/2/3) removed.
       Now using confidence-based static thresholds only.
       Column preserved for historical data analysis.';
    RAISE NOTICE 'Deprecated: entry_intents.urgency_phase';
  END IF;
END $$;

-- Add deprecation comment to time_adjusted_threshold
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents'
    AND column_name = 'time_adjusted_threshold'
  ) THEN
    COMMENT ON COLUMN entry_intents.time_adjusted_threshold IS
      'DEPRECATED (2026-01-22): Time-decayed EQS thresholds removed.
       Now using confidence-based static thresholds (30/35/40 based on confidence 85%+/70%+/60%).
       Column preserved for historical data analysis.';
    RAISE NOTICE 'Deprecated: entry_intents.time_adjusted_threshold';
  END IF;
END $$;

-- Add deprecation comment to zone_tolerance_pips
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents'
    AND column_name = 'zone_tolerance_pips'
  ) THEN
    COMMENT ON COLUMN entry_intents.zone_tolerance_pips IS
      'DEPRECATED (2026-01-22): Progressive zone tolerance removed.
       Now using exact zone matching only (no tolerance).
       Column preserved for historical data analysis.';
    RAISE NOTICE 'Deprecated: entry_intents.zone_tolerance_pips';
  END IF;
END $$;

-- Add deprecation comment to zone_tolerance_used_pips
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents'
    AND column_name = 'zone_tolerance_used_pips'
  ) THEN
    COMMENT ON COLUMN entry_intents.zone_tolerance_used_pips IS
      'DEPRECATED (2026-01-22): Progressive zone tolerance removed.
       Now using exact zone matching only (no tolerance).
       Column preserved for historical data analysis.';
    RAISE NOTICE 'Deprecated: entry_intents.zone_tolerance_used_pips';
  END IF;
END $$;

-- Add deprecation comment to tps_urgency_component
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents'
    AND column_name = 'tps_urgency_component'
  ) THEN
    COMMENT ON COLUMN entry_intents.tps_urgency_component IS
      'DEPRECATED (2026-01-22): TPS urgency component removed with phase system.
       Column preserved for historical data analysis.';
    RAISE NOTICE 'Deprecated: entry_intents.tps_urgency_component';
  END IF;
END $$;

-- Log migration success
DO $$
BEGIN
  RAISE NOTICE '================================================';
  RAISE NOTICE 'Time-based urgency columns deprecated successfully';
  RAISE NOTICE 'Columns preserved for historical data - NO DATA LOSS';
  RAISE NOTICE 'Application will use confidence-based static thresholds';
  RAISE NOTICE '================================================';
END $$;
