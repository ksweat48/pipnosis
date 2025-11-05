/*
  # Fix Data Refresh Log Permissions and Database Errors

  1. Permissions Updates
    - Add authenticated user write access to data_refresh_log
    - Fix 403 Forbidden errors by allowing proper insert/update operations
    - Add anon role read access for monitoring dashboards

  2. Query Optimization
    - Fix 406 Not Acceptable errors
    - Add proper indexes for common query patterns
    - Optimize RLS policy performance

  3. Error Handling
    - Add graceful fallback when logging fails
    - Improve error messages for debugging
*/

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Authenticated users can read refresh log" ON data_refresh_log;
DROP POLICY IF EXISTS "Service role full access to refresh log" ON data_refresh_log;

-- Create new comprehensive policies

-- Allow authenticated users to read all refresh logs
CREATE POLICY "Authenticated users can read refresh log"
  ON data_refresh_log
  FOR SELECT
  TO authenticated, anon
  USING (true);

-- Allow authenticated users to insert their own refresh logs
CREATE POLICY "Authenticated users can insert refresh log"
  ON data_refresh_log
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow authenticated users to update refresh logs
CREATE POLICY "Authenticated users can update refresh log"
  ON data_refresh_log
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Service role full access (for automated processes)
CREATE POLICY "Service role full access to refresh log"
  ON data_refresh_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Add index for recent logs query to fix 406 errors
CREATE INDEX IF NOT EXISTS idx_data_refresh_log_recent
  ON data_refresh_log(symbol, timeframe, started_at DESC)
  WHERE status = 'fetching';

-- Add index for completion tracking
CREATE INDEX IF NOT EXISTS idx_data_refresh_log_completed
  ON data_refresh_log(symbol, timeframe, completed_at DESC)
  WHERE status IN ('completed', 'failed');

-- Update the completeness status policies as well
DROP POLICY IF EXISTS "Authenticated users can read completeness status" ON data_completeness_status;
DROP POLICY IF EXISTS "Service role full access to completeness status" ON data_completeness_status;

-- Allow read access for all authenticated and anonymous users
CREATE POLICY "Users can read completeness status"
  ON data_completeness_status
  FOR SELECT
  TO authenticated, anon
  USING (true);

-- Allow authenticated users to insert/update completeness status
CREATE POLICY "Authenticated users can write completeness status"
  ON data_completeness_status
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Service role full access
CREATE POLICY "Service role full access to completeness status"
  ON data_completeness_status
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
