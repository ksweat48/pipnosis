/*
  # Weekend Protection System

  ## Overview
  Implements automatic position closure before Friday market close to prevent weekend gap risk exposure.

  ## Changes

  ### 1. New Tables

  #### `weekend_closure_log`
  Tracks all position closures triggered by weekend protection system
  - `id` (uuid, primary key)
  - `user_id` (uuid, foreign key to auth.users)
  - `goal_session_id` (uuid, foreign key to goal_sessions)
  - `position_id` (uuid, references goal_trades.id)
  - `symbol` (text) - Trading pair that was closed
  - `close_price` (numeric) - Price at which position was closed
  - `pnl` (numeric) - Profit/loss from the closure
  - `reason` (text) - Always 'weekend_protection'
  - `closed_at` (timestamptz) - When the position was closed
  - `created_at` (timestamptz) - Log entry timestamp

  ## Security
  - RLS enabled on all tables
  - Users can only view their own weekend closure logs
  - Service role has full access for automated closures

  ## Notes
  - Weekend protection triggers Friday at 3:00 PM EST (2 hours before market close)
  - Warnings start Friday at 12:00 PM EST
  - New trades blocked after Friday at 2:00 PM EST
  - All timestamps stored in UTC, converted to EST by application layer
*/

-- Create weekend_closure_log table
CREATE TABLE IF NOT EXISTS weekend_closure_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE SET NULL,
  position_id uuid NOT NULL,
  symbol text NOT NULL,
  close_price numeric NOT NULL,
  pnl numeric NOT NULL,
  reason text NOT NULL DEFAULT 'weekend_protection',
  closed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE weekend_closure_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own weekend closures"
  ON weekend_closure_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert weekend closures"
  ON weekend_closure_log FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_weekend_closure_log_user_id 
  ON weekend_closure_log(user_id);

CREATE INDEX IF NOT EXISTS idx_weekend_closure_log_session_id 
  ON weekend_closure_log(goal_session_id);

CREATE INDEX IF NOT EXISTS idx_weekend_closure_log_closed_at 
  ON weekend_closure_log(closed_at DESC);

-- Add helpful comments
COMMENT ON TABLE weekend_closure_log IS 'Tracks all position closures triggered by weekend protection to prevent gap risk';
COMMENT ON COLUMN weekend_closure_log.reason IS 'Always weekend_protection for positions closed before Friday market close';
COMMENT ON COLUMN weekend_closure_log.closed_at IS 'Timestamp when position was automatically closed (typically Friday 3 PM EST)';
