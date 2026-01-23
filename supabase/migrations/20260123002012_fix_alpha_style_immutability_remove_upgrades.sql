/*
  # Fix Alpha Style Immutability - Remove Auto-Upgrading

  ## Summary
  Implements ALPHA AUTHORITY MODEL where Alpha's style decision is IMMUTABLE.
  Time-to-fill becomes advisory-only, applying confidence penalties instead of style mutations.

  ## Changes
  
  1. **Schema Updates** - Rename and add columns to reflect Alpha Authority:
     - `requested_style` → `alpha_style` (IMMUTABLE: Alpha's chosen style)
     - `resolved_style` → `duration_band` (advisory expected duration)
     - `style_upgrade_applied` → REMOVED (style never changes)
     - `duration_deviation` → NEW (classification of duration vs optimal)
     - `confidence_penalty` → NEW (explicit penalty amount)
  
  2. **Philosophy Change**:
     - OLD: "SCALP exceeds 2h estimate → AUTO-UPGRADE to MICRO_INTRADAY"
     - NEW: "SCALP exceeds optimal band → Apply confidence penalty, retain SCALP style"
  
  3. **Governance Compliance**:
     - Alpha decides style based on execution mechanics (M5 swing, pip targets)
     - Duration is a learning signal only
     - Trades degrade through confidence penalties, not mutation
  
  ## Migration Strategy
  - Add new columns with defaults
  - Copy data from old columns to new columns
  - Keep old columns temporarily for compatibility
  - Mark old columns as deprecated
*/

-- Add new Alpha Authority columns
ALTER TABLE goal_session_trades
  ADD COLUMN IF NOT EXISTS alpha_style TEXT,
  ADD COLUMN IF NOT EXISTS duration_band TEXT,
  ADD COLUMN IF NOT EXISTS duration_deviation TEXT,
  ADD COLUMN IF NOT EXISTS confidence_penalty INTEGER DEFAULT 0;

-- Add comments explaining the new architecture
COMMENT ON COLUMN goal_session_trades.alpha_style IS 
  'IMMUTABLE: Alpha''s chosen style based on execution mechanics (M5 swing, pip targets, etc.). Never changes after Alpha decides.';

COMMENT ON COLUMN goal_session_trades.duration_band IS 
  'ADVISORY ONLY: Expected duration band (SCALP/MICRO_INTRADAY/INTRADAY/EXTENDED). Does not affect style.';

COMMENT ON COLUMN goal_session_trades.duration_deviation IS 
  'ADVISORY ONLY: How far actual duration deviates from optimal band (WITHIN_BAND/SLIGHTLY_OVER/SIGNIFICANTLY_OVER/VERY_EXTENDED)';

COMMENT ON COLUMN goal_session_trades.confidence_penalty IS 
  'Confidence penalty applied for duration deviation. Range: 0-100. Higher = more deviation from optimal.';

-- Migrate existing data: requested_style → alpha_style (Alpha's original choice)
UPDATE goal_session_trades
SET alpha_style = requested_style
WHERE requested_style IS NOT NULL AND alpha_style IS NULL;

-- Migrate existing data: resolved_style → duration_band (what duration was expected)
UPDATE goal_session_trades
SET duration_band = resolved_style
WHERE resolved_style IS NOT NULL AND duration_band IS NULL;

-- Infer duration_deviation from existing data
UPDATE goal_session_trades
SET duration_deviation = CASE
  WHEN duration_penalty_applied = false AND duration_reward_applied = true THEN 'WITHIN_BAND'
  WHEN expected_duration_hours <= 2 THEN 'WITHIN_BAND'
  WHEN expected_duration_hours <= 6 THEN 'SLIGHTLY_OVER'
  WHEN expected_duration_hours <= 10 THEN 'SIGNIFICANTLY_OVER'
  ELSE 'VERY_EXTENDED'
END
WHERE duration_deviation IS NULL;

-- Infer confidence_penalty from duration deviation
UPDATE goal_session_trades
SET confidence_penalty = CASE
  WHEN duration_deviation = 'WITHIN_BAND' THEN 0
  WHEN duration_deviation = 'SLIGHTLY_OVER' THEN 10
  WHEN duration_deviation = 'SIGNIFICANTLY_OVER' THEN 20
  WHEN duration_deviation = 'VERY_EXTENDED' THEN 35
  ELSE 0
END
WHERE confidence_penalty = 0 AND duration_penalty_applied = true;

-- Mark old columns as deprecated with comments
COMMENT ON COLUMN goal_session_trades.requested_style IS 
  '❌ DEPRECATED: Use alpha_style instead. This field represents the old pre-Alpha-Authority model.';

COMMENT ON COLUMN goal_session_trades.resolved_style IS 
  '❌ DEPRECATED: Use duration_band instead. Under Alpha Authority model, style is never "resolved" - it remains immutable.';

COMMENT ON COLUMN goal_session_trades.style_upgrade_applied IS 
  '❌ DEPRECATED: Under Alpha Authority model, style upgrades do not exist. Style is immutable after Alpha decides.';

-- Add constraints for new columns
ALTER TABLE goal_session_trades
  ADD CONSTRAINT check_alpha_style 
    CHECK (alpha_style IN ('SCALP', 'MICRO_INTRADAY', 'INTRADAY') OR alpha_style IS NULL);

ALTER TABLE goal_session_trades
  ADD CONSTRAINT check_duration_band 
    CHECK (duration_band IN ('SCALP', 'MICRO_INTRADAY', 'INTRADAY', 'EXTENDED') OR duration_band IS NULL);

ALTER TABLE goal_session_trades
  ADD CONSTRAINT check_duration_deviation 
    CHECK (duration_deviation IN ('WITHIN_BAND', 'SLIGHTLY_OVER', 'SIGNIFICANTLY_OVER', 'VERY_EXTENDED') OR duration_deviation IS NULL);

ALTER TABLE goal_session_trades
  ADD CONSTRAINT check_confidence_penalty_range 
    CHECK (confidence_penalty >= 0 AND confidence_penalty <= 100);
