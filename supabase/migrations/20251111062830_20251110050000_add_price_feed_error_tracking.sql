/*
  # Add Price Feed Error Tracking

  ## New Tables
  ### price_feed_errors
  - Tracks all price feed failures with detailed error information
  - Records symbol, error type, error message, and timestamp
  - Enables trend analysis and debugging of MetaAPI issues

  ## Security
  - RLS enabled
  - Authenticated users can read errors
  - Authenticated users can write errors
*/

-- Create price feed error tracking table
CREATE TABLE IF NOT EXISTS price_feed_errors (
  id bigserial PRIMARY KEY,
  symbol text NOT NULL,
  error_type text NOT NULL,
  error_message text NOT NULL,
  error_details jsonb,
  function_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_price_feed_errors_symbol_time
  ON price_feed_errors(symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_price_feed_errors_type
  ON price_feed_errors(error_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_price_feed_errors_function
  ON price_feed_errors(function_name, created_at DESC);

-- Enable RLS
ALTER TABLE price_feed_errors ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Authenticated users can read price feed errors" ON price_feed_errors;
CREATE POLICY "Authenticated users can read price feed errors"
  ON price_feed_errors
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated users can write price feed errors" ON price_feed_errors;
CREATE POLICY "Authenticated users can write price feed errors"
  ON price_feed_errors
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Function to cleanup old errors (older than 7 days)
CREATE OR REPLACE FUNCTION cleanup_old_price_feed_errors()
RETURNS void AS $$
BEGIN
  DELETE FROM price_feed_errors
  WHERE created_at < now() - interval '7 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create view for error summary
CREATE OR REPLACE VIEW price_feed_error_summary AS
SELECT
  symbol,
  error_type,
  function_name,
  COUNT(*) as error_count,
  MAX(created_at) as last_error,
  MIN(created_at) as first_error
FROM price_feed_errors
WHERE created_at > now() - interval '24 hours'
GROUP BY symbol, error_type, function_name
ORDER BY error_count DESC;

-- Grant access to view
GRANT SELECT ON price_feed_error_summary TO authenticated;