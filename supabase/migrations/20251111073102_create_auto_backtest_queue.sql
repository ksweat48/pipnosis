/*
  # Auto-Backtest Queue System

  1. New Tables
    - `auto_backtest_queue`
      - Stores queued backtest jobs to be executed
      - Tracks job status (pending, processing, completed, failed)
      - Links to user and controller

  2. Security
    - Enable RLS on queue table
    - Users can view own queued jobs
    - Service role can manage all jobs

  3. Indexes
    - Optimize queries by status and user
    - Support job processing order
*/

-- Create auto_backtest_queue table
CREATE TABLE IF NOT EXISTS auto_backtest_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  controller_id uuid REFERENCES auto_backtest_controller(id) ON DELETE SET NULL,
  session_name text NOT NULL,
  symbols text[] NOT NULL DEFAULT '{}',
  start_date timestamptz NOT NULL,
  end_date timestamptz NOT NULL,
  risk_level text NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  confidence_threshold integer NOT NULL DEFAULT 75,
  market_scenario text NOT NULL DEFAULT 'mixed',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  error_message text,
  session_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  processing_duration_ms integer,
  result_win_rate numeric(5,2),
  result_total_pnl numeric(12,2),
  result_total_trades integer
);

-- Enable RLS
ALTER TABLE auto_backtest_queue ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own queued jobs"
  ON auto_backtest_queue FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own jobs"
  ON auto_backtest_queue FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own jobs"
  ON auto_backtest_queue FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_auto_backtest_queue_user_status
  ON auto_backtest_queue(user_id, status);

CREATE INDEX IF NOT EXISTS idx_auto_backtest_queue_status_created
  ON auto_backtest_queue(status, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_auto_backtest_queue_controller
  ON auto_backtest_queue(controller_id, created_at DESC);

-- Add controller_id reference to auto_backtest_controller if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auto_backtest_queue' AND column_name = 'controller_id'
  ) THEN
    ALTER TABLE auto_backtest_queue
    ADD COLUMN controller_id uuid REFERENCES auto_backtest_controller(id) ON DELETE SET NULL;
  END IF;
END $$;