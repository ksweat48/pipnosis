/*
  # Create Daily Session Results Table for Calendar Persistence

  ## Purpose
  Create a dedicated table to store each day's performance results from the 30-day
  progressive learning system. This ensures checkmarks and X marks persist on the
  monthly performance calendar.

  ## Changes
  1. New Tables
    - `daily_session_results`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to auth.users)
      - `month_number` (integer) - Which month (1, 2, 3, etc.)
      - `day_number` (integer) - Which day within month (1-30)
      - `session_date` (timestamptz) - When the session occurred
      - `session_name` (text) - Full session name
      - `monthly_parent_session_id` (text) - Parent session grouping
      - `win_rate` (numeric) - Win rate percentage
      - `total_trades` (integer) - Number of trades taken
      - `pnl` (numeric) - Profit/Loss for the day
      - `is_profitable` (boolean) - Whether day was profitable (determines checkmark vs X)
      - `session_css` (numeric) - Confidence Spread Score
      - `session_ev` (numeric) - Expected Value
      - `profit_factor` (numeric) - Profit Factor for the day
      - `key_learnings` (jsonb) - Array of key learnings from the day
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `daily_session_results` table
    - Add policies for authenticated users to read their own data
    - Add policies for authenticated users to insert/update their own data

  3. Indexes
    - Unique index on (user_id, month_number, day_number) to prevent duplicates
    - Index on user_id for fast user queries
    - Index on month_number for filtering by month
    - Index on session_date for chronological queries
*/

-- Create daily_session_results table
CREATE TABLE IF NOT EXISTS daily_session_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month_number integer NOT NULL CHECK (month_number > 0),
  day_number integer NOT NULL CHECK (day_number >= 1 AND day_number <= 30),
  session_date timestamptz NOT NULL DEFAULT now(),
  session_name text NOT NULL,
  monthly_parent_session_id text,
  win_rate numeric DEFAULT 0,
  total_trades integer DEFAULT 0,
  pnl numeric DEFAULT 0,
  is_profitable boolean DEFAULT false,
  session_css numeric DEFAULT 0,
  session_ev numeric DEFAULT 0,
  profit_factor numeric DEFAULT 0,
  key_learnings jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create unique constraint to prevent duplicate entries
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_session_results_unique_day
  ON daily_session_results(user_id, month_number, day_number);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_daily_session_results_user_id
  ON daily_session_results(user_id);

CREATE INDEX IF NOT EXISTS idx_daily_session_results_month_number
  ON daily_session_results(user_id, month_number);

CREATE INDEX IF NOT EXISTS idx_daily_session_results_session_date
  ON daily_session_results(user_id, session_date DESC);

CREATE INDEX IF NOT EXISTS idx_daily_session_results_parent_session
  ON daily_session_results(user_id, monthly_parent_session_id);

-- Add helpful comments
COMMENT ON TABLE daily_session_results IS
  'Stores daily performance results from 30-day progressive learning system for calendar persistence';

COMMENT ON COLUMN daily_session_results.month_number IS
  'Which month in the progressive learning sequence (1, 2, 3, etc.)';

COMMENT ON COLUMN daily_session_results.day_number IS
  'Day within the 30-day month (1-30)';

COMMENT ON COLUMN daily_session_results.is_profitable IS
  'Determines if day shows checkmark (true) or X mark (false) on calendar';

-- Enable Row Level Security
ALTER TABLE daily_session_results ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own daily results
CREATE POLICY "Users can view own daily results"
  ON daily_session_results
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own daily results
CREATE POLICY "Users can insert own daily results"
  ON daily_session_results
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own daily results
CREATE POLICY "Users can update own daily results"
  ON daily_session_results
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own daily results
CREATE POLICY "Users can delete own daily results"
  ON daily_session_results
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_daily_session_results_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS trigger_update_daily_session_results_updated_at ON daily_session_results;
CREATE TRIGGER trigger_update_daily_session_results_updated_at
  BEFORE UPDATE ON daily_session_results
  FOR EACH ROW
  EXECUTE FUNCTION update_daily_session_results_updated_at();

-- Backfill existing data from auto_backtest_global_state if available
-- This attempts to reconstruct daily results from the last_day_* fields
DO $$
DECLARE
  state_record RECORD;
BEGIN
  -- Only backfill if there's data in auto_backtest_global_state
  FOR state_record IN
    SELECT
      user_id,
      current_month_number,
      last_day_number,
      last_day_session_name,
      last_day_win_rate,
      last_day_total_trades,
      last_day_pnl,
      last_day_completed_at,
      monthly_parent_session_id
    FROM auto_backtest_global_state
    WHERE last_day_number IS NOT NULL
      AND last_day_session_name IS NOT NULL
  LOOP
    -- Insert the last completed day result
    INSERT INTO daily_session_results (
      user_id,
      month_number,
      day_number,
      session_date,
      session_name,
      monthly_parent_session_id,
      win_rate,
      total_trades,
      pnl,
      is_profitable,
      session_css,
      session_ev
    ) VALUES (
      state_record.user_id,
      state_record.current_month_number,
      state_record.last_day_number,
      COALESCE(state_record.last_day_completed_at, now()),
      state_record.last_day_session_name,
      state_record.monthly_parent_session_id,
      COALESCE(state_record.last_day_win_rate, 0),
      COALESCE(state_record.last_day_total_trades, 0),
      COALESCE(state_record.last_day_pnl, 0),
      COALESCE(state_record.last_day_pnl, 0) > 0,
      0,
      0
    )
    ON CONFLICT (user_id, month_number, day_number)
    DO UPDATE SET
      session_date = EXCLUDED.session_date,
      session_name = EXCLUDED.session_name,
      win_rate = EXCLUDED.win_rate,
      total_trades = EXCLUDED.total_trades,
      pnl = EXCLUDED.pnl,
      is_profitable = EXCLUDED.is_profitable,
      updated_at = now();

    RAISE NOTICE 'Backfilled day % for user % in month %',
      state_record.last_day_number,
      state_record.user_id,
      state_record.current_month_number;
  END LOOP;
END $$;
