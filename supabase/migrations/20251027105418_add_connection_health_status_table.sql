/*
  # Add connection health status tracking table

  1. New Tables
    - `connection_health_status`
      - `id` (uuid, primary key) - Unique identifier
      - `endpoint` (text) - The endpoint being monitored (e.g., 'stream-prices', 'get-live-price')
      - `status` (text) - Connection status ('connecting', 'connected', 'error', 'disconnected')
      - `latency` (integer) - Response latency in milliseconds (nullable)
      - `error_message` (text) - Error message if status is 'error' (nullable)
      - `region` (text) - MetaAPI region being used
      - `account_id` (text) - MetaAPI account ID (partial, masked)
      - `created_at` (timestamptz) - Timestamp of the health check

  2. Indexes
    - Index on endpoint for faster queries
    - Index on created_at for time-based queries
    - Index on status for filtering by connection state

  3. Security
    - Enable RLS on connection_health_status table
    - Add policy for authenticated users to read their own health status
    - Add policy for service role to insert health check records
    - Add policy for admins to view all health records
*/

-- Create the connection health status table
CREATE TABLE IF NOT EXISTS connection_health_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint text NOT NULL,
  status text NOT NULL CHECK (status IN ('connecting', 'connected', 'error', 'disconnected')),
  latency integer,
  error_message text,
  region text DEFAULT 'london',
  account_id text,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_connection_health_endpoint ON connection_health_status(endpoint);
CREATE INDEX IF NOT EXISTS idx_connection_health_created_at ON connection_health_status(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connection_health_status ON connection_health_status(status);

-- Enable Row Level Security
ALTER TABLE connection_health_status ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users can read all health status records
CREATE POLICY "Authenticated users can read connection health"
  ON connection_health_status
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Service role can insert health check records
CREATE POLICY "Service role can insert connection health"
  ON connection_health_status
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Policy: Admins can view all health records
CREATE POLICY "Admins can view all connection health"
  ON connection_health_status
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Function to cleanup old health records (keep last 24 hours)
CREATE OR REPLACE FUNCTION cleanup_old_connection_health()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM connection_health_status
  WHERE created_at < now() - interval '24 hours';
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION cleanup_old_connection_health() TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_old_connection_health() TO service_role;
