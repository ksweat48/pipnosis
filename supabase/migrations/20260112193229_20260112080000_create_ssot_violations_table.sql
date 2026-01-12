/*
  # Create SSOT Violations Tracking System

  1. New Tables
    - `ssot_violations`
      - `id` (uuid, primary key)
      - `violation_type` (text) - Type of violation (MISSING_CONTEXT, HASH_MISMATCH, STALE_CONTEXT, etc.)
      - `symbol` (text) - Trading symbol where violation occurred
      - `attempted_operation` (text) - What operation was being attempted
      - `call_location` (text) - Where in code the violation was detected
      - `blocked` (boolean) - Whether the operation was blocked
      - `error_details` (jsonb) - Full error details for debugging
      - `created_at` (timestamptz) - When violation occurred

  2. Indexes
    - Index on violation_type for statistics queries
    - Index on created_at for time-based queries
    - Index on blocked for filtering blocked vs warning violations
    - Index on symbol for per-symbol analysis

  3. Security
    - Enable RLS
    - Service role can insert (from backend functions)
    - Admin users can read for monitoring
*/

-- Create ssot_violations table
CREATE TABLE IF NOT EXISTS ssot_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  violation_type text NOT NULL,
  symbol text NOT NULL,
  attempted_operation text NOT NULL,
  call_location text NOT NULL,
  blocked boolean NOT NULL DEFAULT true,
  error_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_ssot_violations_type
  ON ssot_violations(violation_type);

CREATE INDEX IF NOT EXISTS idx_ssot_violations_created_at
  ON ssot_violations(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ssot_violations_blocked
  ON ssot_violations(blocked);

CREATE INDEX IF NOT EXISTS idx_ssot_violations_symbol
  ON ssot_violations(symbol);

CREATE INDEX IF NOT EXISTS idx_ssot_violations_location
  ON ssot_violations(call_location);

-- Enable RLS
ALTER TABLE ssot_violations ENABLE ROW LEVEL SECURITY;

-- Service role can insert violations (backend functions)
CREATE POLICY "Service role can insert violations"
  ON ssot_violations
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Admin users can read violations for monitoring
CREATE POLICY "Admin users can read violations"
  ON ssot_violations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_app_meta_data->>'is_admin' = 'true'
    )
  );

-- Anon can insert violations (for client-side logging in dev mode)
CREATE POLICY "Anon can insert violations in development"
  ON ssot_violations
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Add helpful comment
COMMENT ON TABLE ssot_violations IS 'Tracks all SSOT compliance violations for monitoring and alerting';
COMMENT ON COLUMN ssot_violations.violation_type IS 'Type: MISSING_CONTEXT, HASH_MISMATCH, STALE_CONTEXT, INVALID_UNITS, EXECUTION_VALIDATION_FAILED';
COMMENT ON COLUMN ssot_violations.blocked IS 'True if operation was blocked, false if just a warning';
COMMENT ON COLUMN ssot_violations.error_details IS 'Full error context in JSON format for debugging';