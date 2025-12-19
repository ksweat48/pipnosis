/*
  # Fix Duplicate Status Constraint
  
  1. Changes
    - Remove duplicate `goal_sessions_status_valid_values` constraint
    - Keep `goal_sessions_status_check` which includes all valid statuses
  
  2. Reason
    - Two conflicting constraints cause 400 errors
    - The older constraint is missing 'awaiting_continuation' status
*/

-- Remove the duplicate constraint that's missing 'awaiting_continuation'
ALTER TABLE goal_sessions 
DROP CONSTRAINT IF EXISTS goal_sessions_status_valid_values;
