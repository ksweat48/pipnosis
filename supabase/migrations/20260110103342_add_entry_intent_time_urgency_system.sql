/*
  # Add Time-Based Entry Urgency System
  
  1. New Columns
    - `alpha_confidence` (numeric) - Alpha's confidence score for this entry (0-100)
    - `urgency_phase` (integer) - Current urgency phase (1, 2, or 3)
    - `phase_entered_at` (timestamptz) - When current phase was entered
    - `base_eqs_threshold` (numeric) - Original EQS threshold at intent creation
    - `time_adjusted_threshold` (numeric) - Current threshold after time decay
    
  2. Purpose
    - Track time elapsed since entry intent created
    - Decay EQS threshold over time to increase urgency
    - Factor in Alpha's confidence for faster decay on high-confidence setups
    - Enable Phase 1 (strict) → Phase 2 (relaxed) → Phase 3 (urgent) progression
    
  3. Behavior
    - Phase 1: Original strict threshold (first 5-15 min depending on style)
    - Phase 2: Relaxed threshold -10 points (middle period)
    - Phase 3: Urgent threshold -20 points (final period)
    - Time thresholds auto-adjust based on trading style (SCALP/MICRO/INTRADAY)
*/

-- Add new columns to entry_intents
ALTER TABLE entry_intents 
  ADD COLUMN IF NOT EXISTS alpha_confidence NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS urgency_phase INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS phase_entered_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS base_eqs_threshold NUMERIC DEFAULT 60,
  ADD COLUMN IF NOT EXISTS time_adjusted_threshold NUMERIC DEFAULT 60;

-- Add constraints
ALTER TABLE entry_intents 
  ADD CONSTRAINT entry_intents_alpha_confidence_range 
    CHECK (alpha_confidence >= 0 AND alpha_confidence <= 100);

ALTER TABLE entry_intents 
  ADD CONSTRAINT entry_intents_urgency_phase_valid 
    CHECK (urgency_phase IN (1, 2, 3));

-- Add index for urgency queries
CREATE INDEX IF NOT EXISTS idx_entry_intents_urgency_phase 
  ON entry_intents(urgency_phase, phase_entered_at);

-- Add comment
COMMENT ON COLUMN entry_intents.alpha_confidence IS 'Alpha confidence score (0-100) for faster decay on high-confidence setups';
COMMENT ON COLUMN entry_intents.urgency_phase IS 'Current urgency phase: 1=strict, 2=relaxed, 3=urgent';
COMMENT ON COLUMN entry_intents.phase_entered_at IS 'When the current urgency phase was entered';
COMMENT ON COLUMN entry_intents.base_eqs_threshold IS 'Original EQS threshold at creation (typically 60)';
COMMENT ON COLUMN entry_intents.time_adjusted_threshold IS 'Current EQS threshold after time decay applied';
