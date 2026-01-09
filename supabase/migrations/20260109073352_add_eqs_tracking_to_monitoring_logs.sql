/*
  # Add EQS Tracking to Entry Monitoring Logs

  1. Changes
    - Add EQS score, grade, and breakdown columns
    - Add status column for tracking execution status
    - Add user_id and symbol for direct querying
    - Add indexes for performance

  2. Purpose
    - Enable real-time EQS score display to users
    - Track entry quality progression over time
    - Provide transparency into what system is waiting for
*/

-- Add new columns to entry_monitoring_logs
DO $$
BEGIN
  -- Add user_id column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_monitoring_logs' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE entry_monitoring_logs ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  -- Add symbol column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_monitoring_logs' AND column_name = 'symbol'
  ) THEN
    ALTER TABLE entry_monitoring_logs ADD COLUMN symbol text;
  END IF;

  -- Add eqs_score column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_monitoring_logs' AND column_name = 'eqs_score'
  ) THEN
    ALTER TABLE entry_monitoring_logs ADD COLUMN eqs_score integer DEFAULT 0;
  END IF;

  -- Add eqs_grade column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_monitoring_logs' AND column_name = 'eqs_grade'
  ) THEN
    ALTER TABLE entry_monitoring_logs ADD COLUMN eqs_grade text DEFAULT 'F';
  END IF;

  -- Add eqs_threshold column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_monitoring_logs' AND column_name = 'eqs_threshold'
  ) THEN
    ALTER TABLE entry_monitoring_logs ADD COLUMN eqs_threshold integer DEFAULT 60;
  END IF;

  -- Add breakdown column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_monitoring_logs' AND column_name = 'breakdown'
  ) THEN
    ALTER TABLE entry_monitoring_logs ADD COLUMN breakdown jsonb DEFAULT '{}'::jsonb;
  END IF;

  -- Add status column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_monitoring_logs' AND column_name = 'status'
  ) THEN
    ALTER TABLE entry_monitoring_logs ADD COLUMN status text DEFAULT 'WAIT_PASSIVE';
  END IF;

  -- Add created_at column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_monitoring_logs' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE entry_monitoring_logs ADD COLUMN created_at timestamptz DEFAULT now();
  END IF;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_entry_monitoring_logs_user_id ON entry_monitoring_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_entry_monitoring_logs_intent_id ON entry_monitoring_logs(intent_id);
CREATE INDEX IF NOT EXISTS idx_entry_monitoring_logs_created_at ON entry_monitoring_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entry_monitoring_logs_symbol ON entry_monitoring_logs(symbol);

-- Update RLS policies
ALTER TABLE entry_monitoring_logs ENABLE ROW LEVEL SECURITY;

-- Drop old policies
DROP POLICY IF EXISTS "Users can view own monitoring logs" ON entry_monitoring_logs;
DROP POLICY IF EXISTS "System can insert monitoring logs" ON entry_monitoring_logs;

-- Users can view their own monitoring logs
CREATE POLICY "Users can view own monitoring logs"
  ON entry_monitoring_logs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- System can insert monitoring logs (authenticated)
CREATE POLICY "System can insert monitoring logs"
  ON entry_monitoring_logs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Comment on table
COMMENT ON COLUMN entry_monitoring_logs.eqs_score IS 'Entry Quality Score (0-100)';
COMMENT ON COLUMN entry_monitoring_logs.eqs_grade IS 'Entry Quality Grade (A+, A, B, C, D, F)';
COMMENT ON COLUMN entry_monitoring_logs.eqs_threshold IS 'Minimum EQS required for execution';
COMMENT ON COLUMN entry_monitoring_logs.breakdown IS 'Detailed breakdown of all 8 EQS metrics';
COMMENT ON COLUMN entry_monitoring_logs.status IS 'Execution status (EXECUTE_NOW, WAIT_PASSIVE, etc)';