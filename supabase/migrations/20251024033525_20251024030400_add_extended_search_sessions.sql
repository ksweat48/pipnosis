/*
  # Add extended_search_sessions table
  
  ## Overview
  This migration creates the extended_search_sessions table for tracking
  continuous opportunity scanning sessions during auto-trading and manual scanning.
  
  ## Table Structure
  - extended_search_sessions: Tracks scanning sessions with metrics and results
  
  ## Security
  - RLS enabled
  - Users can manage their own sessions
  - Admins can view all sessions
  
  ## Indexes
  - Optimized for queries by user_id, status, session_type, and timestamp
*/

-- Create extended_search_sessions table
CREATE TABLE IF NOT EXISTS extended_search_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Session identification
  session_type text NOT NULL CHECK (session_type IN ('AUTO_TRADING', 'MANUAL_SCAN', 'OPPORTUNITY_HUNT')),
  status text DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED')),
  
  -- Session parameters
  symbols_scanned text[] DEFAULT ARRAY[]::text[],
  timeframes_used text[] DEFAULT ARRAY[]::text[],
  scan_interval_seconds integer,
  min_confidence_threshold integer,
  
  -- Session metrics
  total_scans integer DEFAULT 0,
  opportunities_found integer DEFAULT 0,
  signals_generated integer DEFAULT 0,
  trades_executed integer DEFAULT 0,
  
  -- Time tracking
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  duration_minutes integer,
  last_scan_at timestamptz,
  
  -- Results
  best_opportunity jsonb,
  session_summary text,
  total_pnl numeric(15, 2),
  
  -- Configuration
  search_criteria jsonb DEFAULT '{}',
  filters_applied jsonb DEFAULT '{}',
  
  -- Metadata
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes for extended_search_sessions
CREATE INDEX IF NOT EXISTS idx_extended_search_sessions_user_id 
  ON extended_search_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_extended_search_sessions_status 
  ON extended_search_sessions(status);

CREATE INDEX IF NOT EXISTS idx_extended_search_sessions_started_at 
  ON extended_search_sessions(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_extended_search_sessions_session_type 
  ON extended_search_sessions(session_type);

-- Enable RLS
ALTER TABLE extended_search_sessions ENABLE ROW LEVEL SECURITY;

-- Policies for extended_search_sessions
DROP POLICY IF EXISTS "Users can view own search sessions" ON extended_search_sessions;
DROP POLICY IF EXISTS "Users can create own search sessions" ON extended_search_sessions;
DROP POLICY IF EXISTS "Users can update own search sessions" ON extended_search_sessions;
DROP POLICY IF EXISTS "Admins can view all search sessions" ON extended_search_sessions;

CREATE POLICY "Users can view own search sessions"
  ON extended_search_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own search sessions"
  ON extended_search_sessions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own search sessions"
  ON extended_search_sessions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all search sessions"
  ON extended_search_sessions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_extended_search_sessions_updated_at ON extended_search_sessions;
CREATE TRIGGER update_extended_search_sessions_updated_at
  BEFORE UPDATE ON extended_search_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
