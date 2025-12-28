/*
  # Fix entry_monitoring_logs schema

  1. Changes
    - Ensure all required columns exist
    - Ensure proper data types for jsonb columns
    - Add any missing columns that might be referenced in code

  2. Purpose
    - Fix 400 Bad Request errors when inserting monitoring logs
    - Ensure schema matches code expectations
*/

-- Ensure entry_monitoring_logs table has all required columns
DO $$
BEGIN
  -- Check and add candle_data column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_monitoring_logs' AND column_name = 'candle_data'
  ) THEN
    ALTER TABLE entry_monitoring_logs ADD COLUMN candle_data jsonb DEFAULT '{}'::jsonb;
  END IF;

  -- Check and add market_conditions column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_monitoring_logs' AND column_name = 'market_conditions'
  ) THEN
    ALTER TABLE entry_monitoring_logs ADD COLUMN market_conditions jsonb DEFAULT '{}'::jsonb;
  END IF;

  -- Ensure conditions_met has a default value
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_monitoring_logs' 
    AND column_name = 'conditions_met'
    AND column_default IS NULL
  ) THEN
    ALTER TABLE entry_monitoring_logs 
      ALTER COLUMN conditions_met SET DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- Ensure RLS is properly configured
ALTER TABLE entry_monitoring_logs ENABLE ROW LEVEL SECURITY;

-- Recreate policies if needed
DO $$
BEGIN
  -- Drop and recreate INSERT policy to ensure it's correct
  DROP POLICY IF EXISTS "System can insert monitoring logs" ON entry_monitoring_logs;
  
  CREATE POLICY "System can insert monitoring logs"
    ON entry_monitoring_logs FOR INSERT
    TO authenticated
    WITH CHECK (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;