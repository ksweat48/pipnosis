/*
  # Add Weekend Shutdown Status

  1. Updates
    - Add 'force_closed_weekend' to goal_sessions status constraint
    - This status indicates a session was automatically closed due to weekend protection
    - Include all existing status values

  2. Purpose
    - Support simple weekend shutdown system
    - Allow tracking of sessions closed by weekend protection
*/

-- Add 'force_closed_weekend' to status constraint (include all existing values)
ALTER TABLE goal_sessions
DROP CONSTRAINT IF EXISTS goal_sessions_status_check;

ALTER TABLE goal_sessions
ADD CONSTRAINT goal_sessions_status_check
CHECK (status IN (
  'initializing',
  'scanning',
  'trade_pending',
  'in_trade',
  'completed',
  'cancelled',
  'force_closed_weekend',
  'awaiting_continuation',
  'expired',
  'goal_achieved',
  'user_stopped'
));
