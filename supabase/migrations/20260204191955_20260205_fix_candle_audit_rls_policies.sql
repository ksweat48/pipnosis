/*
  # Fix Candle Write Audit RLS Policies

  ## Problem Fixed
  - 403 Forbidden errors when attempting to log candle write attempts
  - Governance audit logging failing due to restrictive RLS policy
  - Only service_role could write to candle_write_audit table
  - Frontend authenticated users blocked from inserting audit records
  - CCIP compliance chain broken (no audit trail being created)

  ## Solution
  - Add RLS policy for authenticated role to INSERT into candle_write_audit
  - Allow authenticated users to read audit records (SELECT)
  - Maintain service_role access for admin operations
  - Preserve governance audit trail for all candle write operations

  ## Changes
  1. New INSERT policy for authenticated users on candle_write_audit
  2. New SELECT policy for authenticated users to query audit history
  3. Retain existing service_role full access policy
*/

BEGIN;

-- Add INSERT policy for authenticated users
DROP POLICY IF EXISTS "Authenticated users can audit candle writes" ON candle_write_audit;
CREATE POLICY "Authenticated users can audit candle writes"
  ON candle_write_audit
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Add SELECT policy for authenticated users to read audit history
DROP POLICY IF EXISTS "Authenticated users can read candle audit" ON candle_write_audit;
CREATE POLICY "Authenticated users can read candle audit"
  ON candle_write_audit
  FOR SELECT
  TO authenticated
  USING (true);

-- Maintain service_role full access
DROP POLICY IF EXISTS "Service role can audit candle writes" ON candle_write_audit;
CREATE POLICY "Service role has full access to candle audit"
  ON candle_write_audit
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;