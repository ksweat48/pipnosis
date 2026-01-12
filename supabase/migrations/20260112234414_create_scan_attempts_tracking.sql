/*
  # Create Scan Attempts Tracking System
  
  1. New Tables
    - `scan_attempts`
      - `id` (uuid, primary key)
      - `session_id` (uuid, foreign key to goal_sessions)
      - `symbol` (text)
      - `strategy` (text) - pullback, continuation, breakout, immediate
      - `outcome` (text) - SUCCESS, REJECTED, BLOCKED
      - `distance_atr` (numeric) - distance from entry zone in ATR
      - `viability` (text) - IMMEDIATE, PULLBACK, CONTINUATION, UNLIKELY, BLOCKED
      - `warnings_count` (integer)
      - `created_at` (timestamptz)
  
  2. Security
    - Enable RLS on `scan_attempts` table
    - Add policy for users to read their own attempts
    - Add policy for admin to read all attempts
  
  3. Purpose
    - Track all fallback orchestrator attempts for analysis
    - Help debug why trades were rejected
    - Provide visibility into decision flow
    - Enable learning from rejected setups
*/

CREATE TABLE IF NOT EXISTS scan_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES goal_sessions(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  strategy text NOT NULL CHECK (strategy IN ('pullback', 'continuation', 'breakout', 'immediate')),
  outcome text NOT NULL CHECK (outcome IN ('SUCCESS', 'REJECTED', 'BLOCKED')),
  distance_atr numeric,
  viability text CHECK (viability IN ('IMMEDIATE', 'PULLBACK', 'CONTINUATION', 'UNLIKELY', 'BLOCKED')),
  warnings_count integer DEFAULT 0,
  rejection_reason text,
  created_at timestamptz DEFAULT now()
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_scan_attempts_session ON scan_attempts(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_attempts_outcome ON scan_attempts(outcome, created_at DESC);

-- Enable RLS
ALTER TABLE scan_attempts ENABLE ROW LEVEL SECURITY;

-- Users can read their own scan attempts
CREATE POLICY "Users can read own scan attempts"
  ON scan_attempts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM goal_sessions
      WHERE goal_sessions.id = scan_attempts.session_id
      AND goal_sessions.user_id = auth.uid()
    )
  );

-- Admin can read all scan attempts
CREATE POLICY "Admin can read all scan attempts"
  ON scan_attempts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Service role can insert scan attempts
CREATE POLICY "Service role can insert scan attempts"
  ON scan_attempts
  FOR INSERT
  TO service_role
  WITH CHECK (true);
