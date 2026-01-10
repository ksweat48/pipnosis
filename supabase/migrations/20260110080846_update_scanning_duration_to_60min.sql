/*
  # Update Scanning Duration to 60 Minutes

  1. Changes
    - Update default `scanning_duration_minutes` from 15 to 60 for NEW sessions only
    - Existing active sessions continue with their current 15-minute setting
    - Update comments in functions to reflect 60-minute timer

  2. Security
    - No RLS changes needed (only default value modification)

  Important Notes:
  - This migration does NOT update existing sessions
  - Only new sessions created after this migration will use 60 minutes
  - Modal timeout remains at 1 minute (unchanged)
  - Safety net increases to 80 minutes (60 + 20)
*/

-- Update default scanning duration to 60 minutes
ALTER TABLE goal_sessions
  ALTER COLUMN scanning_duration_minutes SET DEFAULT 60;

-- Update function comments that reference scanning duration
COMMENT ON FUNCTION trigger_continuation_modal IS
  'Triggers continuation modal after 60 minutes of scanning without finding a trade';

COMMENT ON FUNCTION handle_continuation_response IS
  'Handles user response to continuation modal (continue for 60 more minutes or stop session)';

COMMENT ON FUNCTION should_show_continuation_modal IS
  'Checks if 60-minute scanning period has elapsed and modal should be shown';

COMMENT ON FUNCTION get_scanning_elapsed_minutes IS
  'Returns how many minutes have elapsed in the current 60-minute scanning period';

-- Update admin_get_all_users function comment
COMMENT ON FUNCTION admin_get_all_users IS
  'Admin-only function to retrieve all users with their active session status, current balance, and 60-minute scanning duration tracking';
