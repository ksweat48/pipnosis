/*
  # Progressive Zone Tolerance Tracking

  ## Overview
  Adds tracking for progressive entry zone relaxation across urgency phases.
  This enables the system to learn which zone tolerance levels work best
  for different market conditions and trading styles.

  ## Changes

  ### 1. New Columns - entry_intents table
  - `zone_tolerance_pips` (integer) - Current zone tolerance in pips based on urgency phase
  - `urgency_phase` (integer) - Current urgency phase (1=Strict, 2=Relaxed, 3=Urgent)

  ### 2. New Columns - session_trades table
  - `executed_with_zone_tolerance` (boolean) - Whether trade used relaxed zone
  - `zone_tolerance_used_pips` (integer) - Tolerance amount if relaxed zone was used
  - `distance_from_original_zone_pips` (real) - Distance from exact zone at execution

  ## Purpose
  Enable meta-learning about zone tolerance effectiveness:
  - Track which phases produce better outcomes
  - Measure if relaxed zones impact win rate
  - Optimize zone tolerance amounts per style
*/

-- Add zone tolerance tracking to entry_intents
ALTER TABLE entry_intents
ADD COLUMN IF NOT EXISTS zone_tolerance_pips integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS urgency_phase integer DEFAULT 1 CHECK (urgency_phase IN (1, 2, 3));

COMMENT ON COLUMN entry_intents.zone_tolerance_pips IS 'Current zone tolerance in pips (0 = exact zone only)';
COMMENT ON COLUMN entry_intents.urgency_phase IS 'Current urgency phase: 1=Strict, 2=Relaxed, 3=Urgent';

-- Add zone tolerance tracking to session_trades
ALTER TABLE session_trades
ADD COLUMN IF NOT EXISTS executed_with_zone_tolerance boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS zone_tolerance_used_pips integer,
ADD COLUMN IF NOT EXISTS distance_from_original_zone_pips real;

COMMENT ON COLUMN session_trades.executed_with_zone_tolerance IS 'True if trade was executed using relaxed zone tolerance';
COMMENT ON COLUMN session_trades.zone_tolerance_used_pips IS 'Zone tolerance amount in pips at execution time';
COMMENT ON COLUMN session_trades.distance_from_original_zone_pips IS 'Distance from exact zone edge at execution (0 if exactly in zone)';

-- Create index for analytics queries
CREATE INDEX IF NOT EXISTS idx_session_trades_zone_tolerance
ON session_trades(executed_with_zone_tolerance, zone_tolerance_used_pips)
WHERE executed_with_zone_tolerance = true;

CREATE INDEX IF NOT EXISTS idx_entry_intents_urgency_phase
ON entry_intents(urgency_phase, zone_tolerance_pips);
