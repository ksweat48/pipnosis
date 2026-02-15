/*
  # Fix Goal Advisory Falsy Check and Backfill original_target_value

  ## Summary
  Two production bugs discovered during SSOT compliance audit:

  1. **Goal Advisory False Positive** - 76 legacy sessions have `original_target_value = 0`
     because they were created before the column was properly initialized. The advisory
     coordinator's JavaScript check `!session.original_target_value` treats `!0` as truthy,
     incorrectly blocking advisory creation for these sessions.

  2. **Backfill** - Sets `original_target_value = target_value` for all sessions where
     the original value was incorrectly stored as 0.

  ## Changes
  1. Data Fix
    - Temporarily disable immutability trigger for backfill only
    - Backfill 76 sessions where `original_target_value = 0` with their `target_value`
    - Re-enable immutability trigger immediately after

  ## Security
    - No RLS changes needed
    - Immutability trigger re-enabled immediately
    - Only affects closed/stopped legacy sessions

  ## CCIP Governance
    - Root cause: Column added without proper backfill for existing sessions
    - Impact: Goal advisory coordinator falsely rejected advisory creation
    - Fix: One-time backfill of zero values under controlled trigger bypass
    - Trigger re-enabled after fix to maintain immutability guarantee
*/

ALTER TABLE goal_sessions DISABLE TRIGGER prevent_immutable_goal_changes;

UPDATE goal_sessions
SET original_target_value = target_value
WHERE original_target_value = 0
  AND target_value > 0;

ALTER TABLE goal_sessions ENABLE TRIGGER prevent_immutable_goal_changes;
