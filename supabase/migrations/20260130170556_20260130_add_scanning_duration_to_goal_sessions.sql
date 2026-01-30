/*
  # Add Missing scanning_duration_minutes to goal_sessions

  ## Issue
  The scanning_duration_minutes column was referenced in migrations but never created
  This caused "column not found" errors when trying to insert goal sessions
  
  ## Solution
  Add the column with proper constraints and default values
  Set all existing sessions to 60 minutes (standard duration)
*/

-- Add the missing column if it doesn't exist
ALTER TABLE goal_sessions
ADD COLUMN IF NOT EXISTS scanning_duration_minutes integer DEFAULT 60;

-- Ensure all sessions have a valid scanning duration
UPDATE goal_sessions
SET scanning_duration_minutes = 60
WHERE scanning_duration_minutes IS NULL OR scanning_duration_minutes <= 0;

-- Add comment for documentation
COMMENT ON COLUMN goal_sessions.scanning_duration_minutes IS 'Duration in minutes for how long the scanning system will run before requiring user action or showing continuation modal. Default: 60 minutes.';
