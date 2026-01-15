/*
  # Fix Missing awaiting_continuation_since Column
  
  ## Problem
  The function `check_continuation_modal_timeout()` references a column 
  `awaiting_continuation_since` that was never created in the goal_sessions table.
  This causes 400 errors when the scanning timer checks for continuation modal timeouts.
  
  ## Changes
  1. Add `awaiting_continuation_since` column to `goal_sessions` table
     - Type: timestamptz (timestamp with timezone)
     - Nullable: true (only set when awaiting continuation)
     - Purpose: Tracks when the continuation modal was first shown to the user
  
  ## Security
  - No RLS changes needed - column added to existing secured table
*/

-- Add the missing column
ALTER TABLE goal_sessions 
ADD COLUMN IF NOT EXISTS awaiting_continuation_since timestamptz;

-- Add comment for documentation
COMMENT ON COLUMN goal_sessions.awaiting_continuation_since IS 
'Timestamp when continuation modal was shown. Used to enforce 60-minute timeout for user response.';
