/*
  # Create Manual Scan Requests Table

  CCIP-2026-0515C: Single-Pair Scan SSOT Governance

  1. New Tables
    - `manual_scan_requests`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `session_id` (uuid, references goal_sessions)
      - `symbol` (text, nullable — null means "scan all")
      - `requested_at` (timestamptz, default now())
      - `status` (text: pending, processing, completed, failed)
      - `scan_result_id` (uuid, nullable)
      - `error_message` (text, nullable)
      - `completed_at` (timestamptz, nullable)

  2. Security
    - RLS enabled
    - Users can only see/insert their own requests
    - Service role has full access for processing

  3. Indexes
    - (user_id, status) for draining pending requests
    - (session_id, status) for session-scoped queries
*/

CREATE TABLE IF NOT EXISTS manual_scan_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  symbol text DEFAULT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  scan_result_id uuid DEFAULT NULL,
  error_message text DEFAULT NULL,
  completed_at timestamptz DEFAULT NULL,
  CONSTRAINT valid_scan_request_status CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

ALTER TABLE manual_scan_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own scan requests"
  ON manual_scan_requests FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own scan requests"
  ON manual_scan_requests FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own scan requests"
  ON manual_scan_requests FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access to scan requests"
  ON manual_scan_requests FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_manual_scan_requests_user_status
  ON manual_scan_requests (user_id, status)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_manual_scan_requests_session_status
  ON manual_scan_requests (session_id, status);
