/*
  # Add Trade Priority Score (TPS) System

  ## Overview
  Adds comprehensive TPS tracking to entry_intents table to support intelligent EXECUTE_NOW vs WAIT arbitration.
  Enables mode-aware scanning (single vs multi-trade) with up to 3 concurrent trade slots.

  ## Changes

  1. New Columns in entry_intents
    - `tps_score` - Overall TPS score (0-100)
    - `tps_confidence_component` - Confidence portion of score
    - `tps_readiness_component` - Readiness portion of score
    - `tps_urgency_component` - Urgency portion of score
    - `eqs_thesis` - Entry Quality Score thesis label
    - `eqs_required` - Minimum EQS threshold for entry
    - `eqs_focus` - Array of 3-5 key entry drivers
    - `runaway_policy` - RESCAN or EXECUTE_ON_FIRST_PULLBACK
    - `trade_slot` - Trade slot number (1-3) for multi-trade mode
    - `tps_comparison_data` - JSONB storing candidate comparison details
    - `momentum_state` - IMPULSE, NORMAL, or STALLED
    Note: entry_mode already exists, will add check constraint

  2. New goal_sessions Columns
    - `max_concurrent_trades` - Maximum simultaneous trades (1-3)
    - `trade_mode` - SINGLE or MULTI for quick reference

  ## Security
  - RLS policies inherited from existing entry_intents policies
  - No new security risks introduced
*/

-- Add TPS tracking columns to entry_intents
ALTER TABLE entry_intents
  ADD COLUMN IF NOT EXISTS tps_score numeric,
  ADD COLUMN IF NOT EXISTS tps_confidence_component numeric,
  ADD COLUMN IF NOT EXISTS tps_readiness_component numeric,
  ADD COLUMN IF NOT EXISTS tps_urgency_component numeric,
  ADD COLUMN IF NOT EXISTS eqs_thesis text,
  ADD COLUMN IF NOT EXISTS eqs_required numeric,
  ADD COLUMN IF NOT EXISTS eqs_focus jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS runaway_policy text,
  ADD COLUMN IF NOT EXISTS trade_slot integer,
  ADD COLUMN IF NOT EXISTS tps_comparison_data jsonb,
  ADD COLUMN IF NOT EXISTS momentum_state text;

-- Add constraints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'entry_intents_runaway_policy_check'
  ) THEN
    ALTER TABLE entry_intents
      ADD CONSTRAINT entry_intents_runaway_policy_check
      CHECK (runaway_policy IN ('RESCAN', 'EXECUTE_ON_FIRST_PULLBACK'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'entry_intents_momentum_state_check'
  ) THEN
    ALTER TABLE entry_intents
      ADD CONSTRAINT entry_intents_momentum_state_check
      CHECK (momentum_state IN ('IMPULSE', 'NORMAL', 'STALLED'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'entry_intents_trade_slot_check'
  ) THEN
    ALTER TABLE entry_intents
      ADD CONSTRAINT entry_intents_trade_slot_check
      CHECK (trade_slot >= 1 AND trade_slot <= 3);
  END IF;
END $$;

-- Add trade mode columns to goal_sessions
ALTER TABLE goal_sessions
  ADD COLUMN IF NOT EXISTS max_concurrent_trades integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS trade_mode text DEFAULT 'SINGLE';

-- Add constraints for goal_sessions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'goal_sessions_max_concurrent_trades_check'
  ) THEN
    ALTER TABLE goal_sessions
      ADD CONSTRAINT goal_sessions_max_concurrent_trades_check
      CHECK (max_concurrent_trades >= 1 AND max_concurrent_trades <= 3);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'goal_sessions_trade_mode_check'
  ) THEN
    ALTER TABLE goal_sessions
      ADD CONSTRAINT goal_sessions_trade_mode_check
      CHECK (trade_mode IN ('SINGLE', 'MULTI'));
  END IF;
END $$;

-- Create index for TPS queries
CREATE INDEX IF NOT EXISTS idx_entry_intents_tps_score ON entry_intents(tps_score DESC) WHERE status = 'monitoring';
CREATE INDEX IF NOT EXISTS idx_entry_intents_trade_slot ON entry_intents(session_id, trade_slot) WHERE status = 'monitoring';

-- Add comments
COMMENT ON COLUMN entry_intents.tps_score IS 'Trade Priority Score: weighted combination of confidence (62%), readiness (30%), and urgency (8%)';
COMMENT ON COLUMN entry_intents.trade_slot IS 'Trade slot number (1-3) for multi-trade mode tracking';
COMMENT ON COLUMN goal_sessions.max_concurrent_trades IS 'Maximum number of simultaneous trades allowed (1=single, 2-3=multi)';
