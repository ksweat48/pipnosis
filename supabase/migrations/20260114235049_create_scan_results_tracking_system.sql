/*
  # Create Scan Results Tracking System

  ## Overview
  Track Alpha's multi-symbol scan results to provide visibility into decision-making process.

  ## New Tables
  - `goal_session_scan_results`
    - `id` (uuid, primary key)
    - `session_id` (uuid, foreign key to goal_sessions)
    - `scan_timestamp` (timestamptz)
    - `scan_duration_ms` (int)
    - `symbols_evaluated` (int)
    - `top_candidate_symbol` (text)
    - `top_candidate_action` (text)
    - `top_candidate_confidence` (int)
    - `top_candidate_score` (numeric)
    - `rejection_reason` (text)
    - `all_candidates` (jsonb) - Full ranking with details
    - `user_id` (uuid, foreign key to auth.users)
    - `created_at` (timestamptz)

  ## Security
  - Enable RLS
  - Users can only see their own scan results
  - Service role has full access for autonomous operations
*/

-- Create scan results table
CREATE TABLE IF NOT EXISTS goal_session_scan_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE NOT NULL,
  scan_timestamp timestamptz DEFAULT now() NOT NULL,
  scan_duration_ms int NOT NULL,
  symbols_evaluated int NOT NULL,
  top_candidate_symbol text,
  top_candidate_action text,
  top_candidate_confidence int,
  top_candidate_score numeric,
  rejection_reason text,
  all_candidates jsonb DEFAULT '[]'::jsonb,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Add index for fast session lookups
CREATE INDEX IF NOT EXISTS idx_scan_results_session_id ON goal_session_scan_results(session_id);
CREATE INDEX IF NOT EXISTS idx_scan_results_user_timestamp ON goal_session_scan_results(user_id, scan_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_scan_results_timestamp ON goal_session_scan_results(scan_timestamp DESC);

-- Enable RLS
ALTER TABLE goal_session_scan_results ENABLE ROW LEVEL SECURITY;

-- Users can view their own scan results
CREATE POLICY "Users can view own scan results"
  ON goal_session_scan_results
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own scan results (for client-side logging)
CREATE POLICY "Users can insert own scan results"
  ON goal_session_scan_results
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Service role can do everything (for autonomous operations)
CREATE POLICY "Service role has full access to scan results"
  ON goal_session_scan_results
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Function to get latest scan results for a session
CREATE OR REPLACE FUNCTION get_latest_scan_result(p_session_id uuid)
RETURNS TABLE (
  scan_id uuid,
  scan_timestamp timestamptz,
  scan_duration_ms int,
  symbols_evaluated int,
  top_candidate_symbol text,
  top_candidate_action text,
  top_candidate_confidence int,
  top_candidate_score numeric,
  rejection_reason text,
  all_candidates jsonb
) 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    gssr.id,
    gssr.scan_timestamp,
    gssr.scan_duration_ms,
    gssr.symbols_evaluated,
    gssr.top_candidate_symbol,
    gssr.top_candidate_action,
    gssr.top_candidate_confidence,
    gssr.top_candidate_score,
    gssr.rejection_reason,
    gssr.all_candidates
  FROM goal_session_scan_results gssr
  WHERE gssr.session_id = p_session_id
  ORDER BY gssr.scan_timestamp DESC
  LIMIT 1;
END;
$$;

-- Function to get recent scan history for a session
CREATE OR REPLACE FUNCTION get_scan_history(p_session_id uuid, p_limit int DEFAULT 5)
RETURNS TABLE (
  scan_id uuid,
  scan_timestamp timestamptz,
  scan_duration_ms int,
  top_candidate_symbol text,
  top_candidate_action text,
  top_candidate_confidence int,
  rejection_reason text
) 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    gssr.id,
    gssr.scan_timestamp,
    gssr.scan_duration_ms,
    gssr.top_candidate_symbol,
    gssr.top_candidate_action,
    gssr.top_candidate_confidence,
    gssr.rejection_reason
  FROM goal_session_scan_results gssr
  WHERE gssr.session_id = p_session_id
  ORDER BY gssr.scan_timestamp DESC
  LIMIT p_limit;
END;
$$;

-- Enable realtime for scan results
ALTER PUBLICATION supabase_realtime ADD TABLE goal_session_scan_results;