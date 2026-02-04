/*
  # Timeout Governance Infrastructure - CCIP Stage 2

  1. New Tables
    - `timeout_governance_config`
      - `id` (uuid, primary key)
      - `service` (text) - which service owns this timeout (e.g., 'price-coordinator', 'position-monitor')
      - `timeout_ms` (integer) - timeout in milliseconds
      - `retry_count` (integer) - maximum retry attempts
      - `backoff_multiplier` (float) - exponential backoff multiplier
      - `circuit_breaker_threshold` (float) - percentage at which to activate circuit breaker
      - `enabled` (boolean) - whether this timeout config is active
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Schema Changes
    - Add `timeout_context` (jsonb) column to `governance_change_log` table
      - Tracks timeout decisions with metadata (service, duration, retry_count, reason)

  3. New Table
    - `governance_timeout_alerts`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key)
      - `service` (text)
      - `timeout_percentage` (float)
      - `threshold` (float)
      - `triggered_at` (timestamp)
      - `acknowledged` (boolean)

  4. Security
    - Enable RLS on `timeout_governance_config`
    - Create policy for authenticated users to read their own service configs
    - Create service_role policy for system access
    - Enable RLS on `governance_timeout_alerts`

  5. Important Notes
    - SSOT for timeout configuration centralized here
    - Governance change log links all timeout decisions to audit trail
    - Circuit breaker thresholds configurable per service
    - All changes logged for compliance/forensics
*/

-- Create timeout governance config table
CREATE TABLE IF NOT EXISTS timeout_governance_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service text NOT NULL UNIQUE,
  timeout_ms integer NOT NULL DEFAULT 10000,
  retry_count integer NOT NULL DEFAULT 3,
  backoff_multiplier float NOT NULL DEFAULT 1.5,
  circuit_breaker_threshold float NOT NULL DEFAULT 0.05,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_timeout_governance_config_service 
  ON timeout_governance_config(service);

-- Add timeout_context to governance_change_log if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'governance_change_log' 
    AND column_name = 'timeout_context'
  ) THEN
    ALTER TABLE governance_change_log 
    ADD COLUMN timeout_context jsonb NULL;
  END IF;
END $$;

-- Create governance timeout alerts table
CREATE TABLE IF NOT EXISTS governance_timeout_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service text NOT NULL,
  timeout_percentage float NOT NULL,
  threshold float NOT NULL,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  acknowledged boolean NOT NULL DEFAULT false
);

-- Create indexes for governance timeout alerts
CREATE INDEX IF NOT EXISTS idx_governance_timeout_alerts_user_id 
  ON governance_timeout_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_governance_timeout_alerts_service 
  ON governance_timeout_alerts(service);
CREATE INDEX IF NOT EXISTS idx_governance_timeout_alerts_triggered_at 
  ON governance_timeout_alerts(triggered_at DESC);

-- Enable RLS
ALTER TABLE timeout_governance_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_timeout_alerts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for timeout_governance_config
CREATE POLICY "Service role can read timeout config"
  ON timeout_governance_config FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Authenticated users can read timeout config"
  ON timeout_governance_config FOR SELECT
  TO authenticated
  USING (true);

-- RLS Policies for governance_timeout_alerts
CREATE POLICY "Users can view their own timeout alerts"
  ON governance_timeout_alerts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage timeout alerts"
  ON governance_timeout_alerts FOR ALL
  TO service_role
  USING (true);

-- Initialize default timeout configurations for all services
INSERT INTO timeout_governance_config (service, timeout_ms, retry_count, backoff_multiplier, circuit_breaker_threshold)
VALUES
  ('price-coordinator', 10000, 3, 1.5, 0.05),
  ('position-monitor', 15000, 2, 2.0, 0.1),
  ('realtime-sltp-monitor', 12000, 2, 1.5, 0.08),
  ('mid-trade-monitor', 20000, 1, 1.0, 0.15),
  ('entry-monitoring', 10000, 3, 1.5, 0.05),
  ('goal-session-scanner', 30000, 1, 1.0, 0.2)
ON CONFLICT (service) DO NOTHING;
