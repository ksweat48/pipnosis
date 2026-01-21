/*
  # Revert Scanning Timeout to 15 Minutes

  1. Overview
    - Reverts scanning timeout from 60 minutes back to 15 minutes
    - Updates database default for goal_sessions.scanning_duration_minutes
    - Updates existing active sessions to 15 minutes

  2. Changes
    - ALTER DEFAULT: Set scanning_duration_minutes default to 15
    - UPDATE: Change all active scanning sessions from 60 to 15 minutes
    - NO IMPACT: Completed or stopped sessions retain their original values

  3. SSOT Compliance
    - Database is single source of truth for timeout duration
    - Client components (simple-scanning-timer.ts, smart-goal-session-manager.ts) already updated
    - Admin panel threshold updated to 20 minutes (15min + 5min buffer)

  4. Safety
    - Only affects future sessions and currently active scanning sessions
    - Completed/stopped sessions unchanged
    - No data loss
*/

-- Update default scanning duration to 15 minutes (revert from 60)
ALTER TABLE goal_sessions
  ALTER COLUMN scanning_duration_minutes SET DEFAULT 15;

-- Update all currently active scanning sessions to 15 minutes
UPDATE goal_sessions
SET scanning_duration_minutes = 15
WHERE status = 'scanning'
AND scanning_duration_minutes = 60;

-- COMMENT: Explain the default value
COMMENT ON COLUMN goal_sessions.scanning_duration_minutes IS
  'Duration in minutes before showing continuation modal. Default: 15 minutes. User can continue or stop session when time expires.';
