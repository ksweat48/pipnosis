/*
  # CCIP — Remove EQS system, add IM signal tracking governance columns

  ## Summary
  This migration is part of the CCIP change set that replaces the Entry Quality Score (EQS)
  system with the Intelligence Monitor (IM) as the foundational reference signal for all
  Alpha trade analysis.

  ## Changes

  ### goal_session_trades
  - Add `im_signal_used` (BOOLEAN DEFAULT false): Tracks whether an IM pre-validated signal
    was available and injected for this trade's symbol during the scan cycle.
  - Add `im_signal_confidence` (INTEGER): The confidence level from the IM card (0-100) if
    im_signal_used = true. Null when no IM signal was present.
  - EQS columns (eqs_score, eqs_grade, entry_quality_score) are RETAINED as nullable for
    backward compatibility with historical trade records. No data is removed.

  ## Security
  - No RLS changes required (inherits existing goal_session_trades policies)
  - No new tables created

  ## Architecture Notes
  - SSOT: im_signal_used is the audit trail for whether IM data influenced a given trade scan
  - CCIP Governance: This is a non-destructive additive migration
  - Backward compat: Old EQS columns remain nullable; new code no longer writes to them
*/

DO $$
BEGIN
  -- Add im_signal_used column if not already present
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades'
      AND column_name = 'im_signal_used'
  ) THEN
    ALTER TABLE goal_session_trades
      ADD COLUMN im_signal_used BOOLEAN NOT NULL DEFAULT false;
  END IF;

  -- Add im_signal_confidence column if not already present
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades'
      AND column_name = 'im_signal_confidence'
  ) THEN
    ALTER TABLE goal_session_trades
      ADD COLUMN im_signal_confidence INTEGER;
  END IF;
END $$;

-- Ensure eqs columns are nullable (backward compat — no new writes, no data loss)
ALTER TABLE goal_session_trades
  ALTER COLUMN eqs_score DROP NOT NULL;

ALTER TABLE goal_session_trades
  ALTER COLUMN eqs_grade DROP NOT NULL;

ALTER TABLE goal_session_trades
  ALTER COLUMN entry_quality_score DROP NOT NULL;
