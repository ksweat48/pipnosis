/*
  # Add connection health status tracking table

  1. New Tables
    - `connection_health_status` - Tracks connection health for monitoring
      
  2. Security
    - Enable RLS
    - Authenticated users can read health status
    - Service role can insert health records
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
DROP POLICY IF EXISTS "Authenticated users can read connection health" ON connection_health_status;
CREATE POLICY "Authenticated users can read connection health"
  ON connection_health_status
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Authenticated users can insert health check records
DROP POLICY IF EXISTS "Authenticated users can insert connection health" ON connection_health_status;
CREATE POLICY "Authenticated users can insert connection health"
  ON connection_health_status
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

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

-- Grant execute permission
GRANT EXECUTE ON FUNCTION cleanup_old_connection_health() TO authenticated;