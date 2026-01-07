/*
  # Entry Quality Score (EQS) System

  1. New Columns
    - `alpha_decisions` table
      - `entry_spec` (jsonb) - Alpha's explicit entry specification
    
    - `entry_intents` table
      - `eqs_score` (integer) - Calculated Entry Quality Score (0-100)
      - `eqs_breakdown` (jsonb) - Detailed EQS component breakdown
      - `entry_mode` (varchar) - Entry mode: immediate, wait_pullback, wait_confirmation
      - `trigger_conditions` (jsonb) - Structured entry triggers for wait scenarios
    
    - `goal_session_trades` table
      - `eqs_score` (integer) - EQS at time of entry
      - `eqs_grade` (varchar) - Entry grade: A+, A, B, C, D

  2. Performance Indexes
    - Index on entry_mode for filtering by execution strategy
    - Index on eqs_score for quality analysis
    - Index on eqs_grade for performance tracking

  3. Architecture Notes
    - NO REJECTIONS: All entries are scored, never blocked
    - Entry Qualification Engine decides WHEN to enter, not IF
    - Alpha has final authority on trade direction
    - All systems (liquidity, regime, adversarial) are scoring inputs only
*/

-- Add entry_spec to alpha_decisions table
ALTER TABLE alpha_decisions 
ADD COLUMN IF NOT EXISTS entry_spec JSONB;

-- Add EQS columns to entry_intents table
ALTER TABLE entry_intents
ADD COLUMN IF NOT EXISTS eqs_score INTEGER,
ADD COLUMN IF NOT EXISTS eqs_breakdown JSONB,
ADD COLUMN IF NOT EXISTS entry_mode VARCHAR(20),
ADD COLUMN IF NOT EXISTS trigger_conditions JSONB;

-- Add check constraint for entry_mode
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'entry_intents_entry_mode_check'
  ) THEN
    ALTER TABLE entry_intents 
    ADD CONSTRAINT entry_intents_entry_mode_check 
    CHECK (entry_mode IN ('immediate', 'wait_pullback', 'wait_confirmation'));
  END IF;
END $$;

-- Add EQS columns to goal_session_trades table
ALTER TABLE goal_session_trades
ADD COLUMN IF NOT EXISTS eqs_score INTEGER,
ADD COLUMN IF NOT EXISTS eqs_grade VARCHAR(2);

-- Add check constraint for eqs_grade
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'goal_session_trades_eqs_grade_check'
  ) THEN
    ALTER TABLE goal_session_trades 
    ADD CONSTRAINT goal_session_trades_eqs_grade_check 
    CHECK (eqs_grade IN ('A+', 'A', 'B', 'C', 'D'));
  END IF;
END $$;

-- Create performance indexes
CREATE INDEX IF NOT EXISTS idx_entry_intents_entry_mode 
  ON entry_intents(entry_mode) 
  WHERE entry_mode IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_entry_intents_eqs_score 
  ON entry_intents(eqs_score) 
  WHERE eqs_score IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_goal_session_trades_eqs_grade 
  ON goal_session_trades(eqs_grade) 
  WHERE eqs_grade IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN entry_intents.eqs_score IS 'Entry Quality Score (0-100): Location (0-30) + Confirmation (0-30) + Timing (0-25) + Friction (0 to -15) + A+ Bonus (0-15)';
COMMENT ON COLUMN entry_intents.eqs_breakdown IS 'Detailed breakdown of EQS components: locationScore, confirmationScore, timingScore, frictionPenalty, with sub-details';
COMMENT ON COLUMN entry_intents.entry_mode IS 'Alpha entry mode: immediate (high conf), wait_pullback (medium conf), wait_confirmation (lower conf)';
COMMENT ON COLUMN entry_intents.trigger_conditions IS 'Structured entry triggers when waiting for better entry: vwap_kiss, acceptance_candle, pullback_complete, etc.';
COMMENT ON COLUMN alpha_decisions.entry_spec IS 'Alpha explicit entry specification: entry_mode, entry_zone, min_entry_quality_score, max_wait_minutes, alpha_reasoning';
COMMENT ON COLUMN goal_session_trades.eqs_score IS 'Entry Quality Score at time of entry (0-100)';
COMMENT ON COLUMN goal_session_trades.eqs_grade IS 'Entry grade: A+ (80+), A (72-79), B (65-71), C (50-64), D (<50)';
