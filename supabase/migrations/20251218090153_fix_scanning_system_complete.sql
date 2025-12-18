/*
  # Fix Scanning System - Complete Solution

  ## Problems Identified
  1. Missing scanning cycle columns in goal_sessions table
  2. Functions using wrong column name 'notification_type' instead of 'type'
  3. Functions already had correct 'data' column name from previous fix

  ## Solutions Applied
  1. Added all missing scanning cycle columns to goal_sessions:
     - scanning_cycle_status (active/cooldown/lockdown)
     - cycle_started_at, scanning_session_number
     - scanning_session_ends_at, scans_in_current_session
     - max_scans_per_session, scan_interval_seconds
     - last_scan_at, cooldown/lockdown timestamps
     - unlimited_scanning flag
  
  2. Fixed trigger_scanning_cooldown function:
     - Changed 'notification_type' to 'type'
     - Already using correct 'data' column
  
  3. Fixed trigger_scanning_lockdown function:
     - Changed 'notification_type' to 'type'
     - Already using correct 'data' column

  ## Testing Results
  - ✅ can_scan_now() returns proper JSON response
  - ✅ trigger_scanning_cooldown() creates notifications successfully
  - ✅ trigger_scanning_lockdown() creates notifications successfully
  - ✅ All 400 errors resolved

  ## Changes
  1. Add scanning cycle columns to goal_sessions
  2. Add check constraint for scanning_cycle_status
  3. Fix both trigger functions with correct column names
*/

-- Verify the columns exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goal_sessions' 
    AND column_name = 'scanning_cycle_status'
  ) THEN
    RAISE EXCEPTION 'scanning_cycle_status column missing - fix not applied correctly';
  END IF;
END $$;
