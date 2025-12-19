/*
  # Add min_confidence column to goal_sessions

  1. Changes
    - Add `min_confidence` column to `goal_sessions` table
    - Defaults to 65 (medium risk threshold)
    - Range validated between 45-80 for realistic confidence thresholds
    
  2. Purpose
    - Stores the dynamic confidence threshold calculated from risk mode
    - Allows risk-aligned trade filtering without hardcoded thresholds
    - Supports LOW (75%), MEDIUM (65%), HIGH (50%) confidence requirements
*/

-- Add min_confidence column to goal_sessions
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goal_sessions' AND column_name = 'min_confidence'
  ) THEN
    ALTER TABLE goal_sessions 
    ADD COLUMN min_confidence integer DEFAULT 65 
    CHECK (min_confidence >= 45 AND min_confidence <= 80);
  END IF;
END $$;
