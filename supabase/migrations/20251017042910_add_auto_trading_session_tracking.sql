/*
  # Add Auto Trading Session Tracking

  1. Changes to auto_trading_status table
    - Add `current_session_id` (uuid) - Unique identifier for the current active session
    - Add `session_started_at` (timestamptz) - When the current session started
    - Add `session_ended_at` (timestamptz) - When the last session ended
    
  2. Purpose
    - Track individual auto trading sessions to filter thought process entries
    - Only show thoughts from the current active session
    - Prevent stale data from appearing in the UI
    
  3. Benefits
    - Clear separation between different trading sessions
    - Real-time display shows only current session data
    - Historical data is preserved but not mixed with live data
*/

-- Add session tracking columns to auto_trading_status
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'auto_trading_status' AND column_name = 'current_session_id'
  ) THEN
    ALTER TABLE auto_trading_status 
    ADD COLUMN current_session_id uuid DEFAULT gen_random_uuid();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'auto_trading_status' AND column_name = 'session_started_at'
  ) THEN
    ALTER TABLE auto_trading_status 
    ADD COLUMN session_started_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'auto_trading_status' AND column_name = 'session_ended_at'
  ) THEN
    ALTER TABLE auto_trading_status 
    ADD COLUMN session_ended_at timestamptz;
  END IF;
END $$;

-- Add session_id to ai_thought_process to link thoughts to sessions
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ai_thought_process' AND column_name = 'session_id'
  ) THEN
    ALTER TABLE ai_thought_process 
    ADD COLUMN session_id uuid;
  END IF;
END $$;

-- Create index for efficient session-based queries
CREATE INDEX IF NOT EXISTS idx_ai_thought_process_session_id 
ON ai_thought_process(session_id);

CREATE INDEX IF NOT EXISTS idx_ai_thought_process_user_session 
ON ai_thought_process(user_id, session_id, created_at DESC);