/*
  # Remove min_confidence column from goal_sessions

  ## Summary
  The `goal_sessions_min_confidence_check` constraint enforces `min_confidence`
  to be between 45 and 80. Under CCIP-2026-0410A, confidence gates have been
  removed from Alpha's execution authority. The column is now unused in code
  and must be removed to unblock session creation.

  ## Changes
  - Drop the `goal_sessions_min_confidence_check` constraint
  - Drop the `min_confidence` column from `goal_sessions`

  ## Impact
  - Existing rows: column removed, no data loss for active sessions
  - Code: `getMinConfidenceThreshold()` call sites will be removed in the same PR
*/

ALTER TABLE goal_sessions DROP CONSTRAINT IF EXISTS goal_sessions_min_confidence_check;

ALTER TABLE goal_sessions DROP COLUMN IF EXISTS min_confidence;
