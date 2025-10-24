/*
  # Add trade_sessions table for MetaAPI cost tracking
  
  ## Overview
  This migration creates a dedicated table for tracking individual MetaAPI trading sessions
  including cost estimates, duration, and session status. This is separate from the 
  trading_sessions table which tracks overall user trading activity.
  
  ## Table Structure
  - `trade_sessions` - Tracks MetaAPI-specific session costs and metadata
  - Includes foreign key to user_profiles
  - Tracks start/end times, status, costs, and MetaAPI account details
  
  ## Security
  - Enable RLS on trade_sessions table
  - Users can manage their own sessions
  - Admins can view all sessions
  
  ## Indexes
  - Fast lookups by user_id, status, start_time, and symbol
*/

-- Create trade_sessions table
CREATE TABLE IF NOT EXISTS trade_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  start_time timestamptz NOT NULL DEFAULT now(),
  end_time timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'closed', 'failed')),
  estimated_cost numeric(10,4) DEFAULT 0.0000,
  duration_minutes integer,
  metaapi_account_id text,
  session_metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_trade_sessions_user_id 
  ON trade_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_trade_sessions_status 
  ON trade_sessions(status);

CREATE INDEX IF NOT EXISTS idx_trade_sessions_start_time 
  ON trade_sessions(start_time DESC);

CREATE INDEX IF NOT EXISTS idx_trade_sessions_symbol 
  ON trade_sessions(symbol);

CREATE INDEX IF NOT EXISTS idx_trade_sessions_metaapi_account 
  ON trade_sessions(metaapi_account_id) 
  WHERE metaapi_account_id IS NOT NULL;

-- Enable Row Level Security
ALTER TABLE trade_sessions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can manage own trade sessions" ON trade_sessions;
DROP POLICY IF EXISTS "Admins can access all trade sessions" ON trade_sessions;

-- Policy for users to manage their own sessions
CREATE POLICY "Users can manage own trade sessions"
  ON trade_sessions
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy for admin access
CREATE POLICY "Admins can access all trade sessions"
  ON trade_sessions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE id = auth.uid() 
      AND is_admin = true
    )
  );

-- Add updated_at trigger
DROP TRIGGER IF EXISTS update_trade_sessions_updated_at ON trade_sessions;
CREATE TRIGGER update_trade_sessions_updated_at
  BEFORE UPDATE ON trade_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
