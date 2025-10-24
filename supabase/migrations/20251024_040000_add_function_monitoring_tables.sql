/*
  # Add Function Monitoring Tables

  1. New Tables
    - `function_execution_logs`
      - Stores detailed logs of each serverless function execution
      - Tracks request ID, execution time, parameters, results, and errors
      - Enables debugging and performance analysis
    - `function_health_metrics`
      - Aggregates daily health metrics per function
      - Tracks success/failure rates and average response times
      - Enables monitoring dashboards and alerting

  2. Security
    - Enable RLS on both tables
    - Add policies for admin users to read monitoring data
    - Service role has full access for function logging

  3. Indexes
    - Optimized for common query patterns:
      - Function name lookups
      - Time-range queries
      - Error filtering
*/

-- Create function_execution_logs table
CREATE TABLE IF NOT EXISTS function_execution_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name text NOT NULL,
  request_id text NOT NULL,
  status_code integer NOT NULL,
  execution_time_ms integer NOT NULL,
  params jsonb,
  result jsonb,
  error_message text,
  error_details jsonb,
  logs jsonb,
  timestamp timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Create indexes for function_execution_logs
CREATE INDEX IF NOT EXISTS idx_function_execution_logs_function_name
  ON function_execution_logs(function_name);

CREATE INDEX IF NOT EXISTS idx_function_execution_logs_timestamp
  ON function_execution_logs(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_function_execution_logs_request_id
  ON function_execution_logs(request_id);

CREATE INDEX IF NOT EXISTS idx_function_execution_logs_status_code
  ON function_execution_logs(status_code);

CREATE INDEX IF NOT EXISTS idx_function_execution_logs_errors
  ON function_execution_logs(function_name, timestamp DESC)
  WHERE error_message IS NOT NULL;

-- Create function_health_metrics table
CREATE TABLE IF NOT EXISTS function_health_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name text NOT NULL,
  date date NOT NULL,
  total_calls integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  avg_response_time_ms integer NOT NULL DEFAULT 0,
  last_execution_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(function_name, date)
);

-- Create indexes for function_health_metrics
CREATE INDEX IF NOT EXISTS idx_function_health_metrics_function_name
  ON function_health_metrics(function_name);

CREATE INDEX IF NOT EXISTS idx_function_health_metrics_date
  ON function_health_metrics(date DESC);

CREATE INDEX IF NOT EXISTS idx_function_health_metrics_lookup
  ON function_health_metrics(function_name, date);

-- Enable Row Level Security
ALTER TABLE function_execution_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE function_health_metrics ENABLE ROW LEVEL SECURITY;

-- Create policies for function_execution_logs
CREATE POLICY "Admin users can view all function execution logs"
  ON function_execution_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  );

CREATE POLICY "Service role has full access to function execution logs"
  ON function_execution_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create policies for function_health_metrics
CREATE POLICY "Admin users can view all function health metrics"
  ON function_health_metrics
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  );

CREATE POLICY "Service role has full access to function health metrics"
  ON function_health_metrics
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create helpful views for monitoring

-- View: Recent function errors (last 24 hours)
CREATE OR REPLACE VIEW recent_function_errors AS
SELECT
  function_name,
  request_id,
  status_code,
  error_message,
  execution_time_ms,
  timestamp
FROM function_execution_logs
WHERE error_message IS NOT NULL
  AND timestamp > now() - interval '24 hours'
ORDER BY timestamp DESC;

-- View: Function health summary (last 7 days)
CREATE OR REPLACE VIEW function_health_summary AS
SELECT
  function_name,
  SUM(total_calls) as total_calls,
  SUM(success_count) as success_count,
  SUM(failure_count) as failure_count,
  ROUND(AVG(avg_response_time_ms)) as avg_response_time_ms,
  ROUND(100.0 * SUM(success_count) / NULLIF(SUM(total_calls), 0), 2) as success_rate,
  MAX(last_execution_at) as last_execution_at
FROM function_health_metrics
WHERE date > CURRENT_DATE - interval '7 days'
GROUP BY function_name
ORDER BY total_calls DESC;

-- Grant select on views to authenticated users with admin role
GRANT SELECT ON recent_function_errors TO authenticated;
GRANT SELECT ON function_health_summary TO authenticated;
