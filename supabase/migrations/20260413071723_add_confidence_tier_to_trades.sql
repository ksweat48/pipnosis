/*
  # Add confidence_tier column to goal_session_trades

  ## Summary
  CCIP-2026-0413-CONFIDENCE-TEXT: Alpha now outputs confidence as a text tier
  ("no_read", "low", "cautious", "moderate", "confident", "high", "very_high", "extreme")
  rather than a raw integer. This column stores the original text Alpha chose, while
  the existing `trade_confidence` column continues to store the numeric equivalent
  (derived via CONFIDENCE_TIER_TO_NUMBER map in confidence-tier.ts).

  ## Changes
  - `goal_session_trades`: Add `confidence_tier` column (text, nullable)
    - Nullable: existing trades predate this field; legacy records will have NULL here
      and can derive a tier from `trade_confidence` for display purposes
    - Constrained to valid tier values to prevent arbitrary strings entering the DB

  ## No breaking changes
  All existing consumers of `trade_confidence` (learning engine, TPS, PCPE, UI) are
  unchanged — they still receive the numeric value. The new column is additive.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'confidence_tier'
  ) THEN
    ALTER TABLE goal_session_trades
      ADD COLUMN confidence_tier text
      CHECK (confidence_tier IN ('no_read','low','cautious','moderate','confident','high','very_high','extreme'));
  END IF;
END $$;
