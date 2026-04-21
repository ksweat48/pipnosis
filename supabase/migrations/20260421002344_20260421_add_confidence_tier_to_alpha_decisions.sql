/*
  # Add confidence_tier to alpha_decisions

  ## Problem
  The alpha_decisions table is missing the confidence_tier column that coordinator-alpha.ts
  attempts to write on every scan. This causes a 400 error on every scan cycle:
  "Could not find the 'confidence_tier' column of 'alpha_decisions' in the schema cache"

  The column was added to goal_session_trades in migration 20260413071723 but alpha_decisions
  was missed. This migration corrects that omission.

  ## Changes
  - alpha_decisions: ADD COLUMN confidence_tier (nullable text with enum CHECK constraint)

  ## Enum values (matches goal_session_trades.confidence_tier)
  no_read | low | cautious | moderate | confident | high | very_high | extreme

  ## Security
  No RLS changes — alpha_decisions inherits existing policies.
*/

ALTER TABLE alpha_decisions
  ADD COLUMN IF NOT EXISTS confidence_tier text
  CHECK (confidence_tier IN ('no_read', 'low', 'cautious', 'moderate', 'confident', 'high', 'very_high', 'extreme'));
