/*
  # Fix cache_statistics and ssot_violations Schema

  1. Changes to ssot_violations table
    - Add `component` column (text) - Component where violation occurred
    - Add `severity` column (text) - Severity level: critical, warning, info
    - Add `user_id` column (uuid, nullable) - User associated with violation
    - Add `session_id` column (text, nullable) - Session ID if applicable
    - Add index on component for health queries
    - Fix RLS SELECT policy to prevent permission cascade errors

  2. New cache_statistics table
    - `id` (uuid, primary key)
    - `cache_tier` (text) - Cache tier name (e.g., 'alpha_thesis')
    - `total_lookups` (integer) - Total cache lookup attempts
    - `cache_hits` (integer) - Successful cache hits
    - `cache_misses` (integer) - Cache misses
    - `total_llm_calls_saved` (integer) - Number of LLM calls avoided
    - `avg_cache_age_seconds` (numeric) - Average age of cached items
    - `created_at` (timestamptz) - When statistics were recorded

  3. Security
    - Enable RLS on cache_statistics
    - Allow authenticated users to read both tables
    - Allow service_role to insert into both tables
    - Simplified ssot_violations policy to avoid auth.users permission issues
*/

-- =======================
-- Part 1: Fix ssot_violations table
-- =======================

-- Add missing columns to ssot_violations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ssot_violations' AND column_name = 'component'
  ) THEN
    ALTER TABLE ssot_violations ADD COLUMN component text NOT NULL DEFAULT 'unknown';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ssot_violations' AND column_name = 'severity'
  ) THEN
    ALTER TABLE ssot_violations ADD COLUMN severity text NOT NULL DEFAULT 'info';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ssot_violations' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE ssot_violations ADD COLUMN user_id uuid;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ssot_violations' AND column_name = 'session_id'
  ) THEN
    ALTER TABLE ssot_violations ADD COLUMN session_id text;
  END IF;
END $$;

-- Add constraint on severity values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'ssot_violations_severity_check'
  ) THEN
    ALTER TABLE ssot_violations 
    ADD CONSTRAINT ssot_violations_severity_check 
    CHECK (severity IN ('critical', 'warning', 'info'));
  END IF;
END $$;

-- Add index on component for component health queries
CREATE INDEX IF NOT EXISTS idx_ssot_violations_component
  ON ssot_violations(component);

-- Add index on user_id for user-specific queries
CREATE INDEX IF NOT EXISTS idx_ssot_violations_user_id
  ON ssot_violations(user_id);

-- Drop the problematic admin-only SELECT policy that causes permission cascade
DROP POLICY IF EXISTS "Admin users can read violations" ON ssot_violations;

-- Create new simplified SELECT policy for all authenticated users
-- Rationale: SSOT violations are system-level monitoring data, not user-sensitive
CREATE POLICY "Authenticated users can read violations"
  ON ssot_violations
  FOR SELECT
  TO authenticated
  USING (true);

-- =======================
-- Part 2: Create cache_statistics table
-- =======================

CREATE TABLE IF NOT EXISTS cache_statistics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_tier text NOT NULL,
  total_lookups integer NOT NULL DEFAULT 0,
  cache_hits integer NOT NULL DEFAULT 0,
  cache_misses integer NOT NULL DEFAULT 0,
  total_llm_calls_saved integer NOT NULL DEFAULT 0,
  avg_cache_age_seconds numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_cache_statistics_tier
  ON cache_statistics(cache_tier);

CREATE INDEX IF NOT EXISTS idx_cache_statistics_created_at
  ON cache_statistics(created_at DESC);

-- Enable RLS
ALTER TABLE cache_statistics ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read cache statistics
CREATE POLICY "Authenticated users can read cache statistics"
  ON cache_statistics
  FOR SELECT
  TO authenticated
  USING (true);

-- Service role can insert cache statistics
CREATE POLICY "Service role can insert cache statistics"
  ON cache_statistics
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Anon can read cache statistics (for public telemetry dashboards)
CREATE POLICY "Anon can read cache statistics"
  ON cache_statistics
  FOR SELECT
  TO anon
  USING (true);

-- Add helpful comments
COMMENT ON TABLE cache_statistics IS 'Tracks cache performance metrics for telemetry and optimization';
COMMENT ON COLUMN cache_statistics.cache_tier IS 'Cache tier identifier (e.g., alpha_thesis, regime_oracle)';
COMMENT ON COLUMN cache_statistics.total_llm_calls_saved IS 'Number of LLM API calls avoided due to cache hits';
COMMENT ON COLUMN cache_statistics.avg_cache_age_seconds IS 'Average age of cached items in seconds';

COMMENT ON COLUMN ssot_violations.component IS 'System component where violation occurred (e.g., alpha-coordinator, position-monitor)';
COMMENT ON COLUMN ssot_violations.severity IS 'Violation severity: critical (blocks execution), warning (logged but allowed), info (informational)';
COMMENT ON COLUMN ssot_violations.user_id IS 'User ID associated with the operation that triggered the violation';
COMMENT ON COLUMN ssot_violations.session_id IS 'Goal session ID if the violation occurred during a trading session';
