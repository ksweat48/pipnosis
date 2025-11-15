/*
  # Fix Polling Health Schema and Add Missing Tables
  
  ## Problem
  The polling_health table currently has a `poller_name` column with UNIQUE constraint,
  but the TypeScript code expects a `symbol` column with UNIQUE constraint. This causes
  400 errors when the code tries to upsert with `on_conflict=symbol`.
  
  Additionally, two critical tables are missing:
  - polling_recovery_log (causing 404 errors)
  - polling_fallback_cache (causing 404 errors)
  
  ## Solution
  1. Drop the old polling_health table
  2. Create new polling_health table with correct schema (symbol-based)
  3. Create polling_recovery_log table
  4. Create polling_fallback_cache table
  5. Set up proper indexes, RLS policies, and triggers
  
  ## New Schema
  
  ### polling_health
  Tracks real-time health of each symbol's polling system.
  - `symbol` (text, UNIQUE) - Trading symbol (EURUSD, XAUUSD, etc.)
  - `status` (text) - active, degraded, critical, stopped
  - `consecutive_errors` (integer) - Number of consecutive errors
  - `total_errors` (integer) - Total errors recorded
  - `success_count` (integer) - Total successful polls
  - `last_success_at` (timestamptz) - Last successful poll timestamp
  - `last_error_at` (timestamptz) - Last error timestamp
  - `last_error_message` (text) - Last error message
  - `circuit_breaker_state` (text) - closed, half_open, open
  - `circuit_opened_at` (timestamptz) - When circuit breaker opened
  - `recovery_attempts` (integer) - Number of recovery attempts
  - `last_recovery_at` (timestamptz) - Last recovery attempt timestamp
  - `polling_interval_ms` (integer) - Polling interval in milliseconds
  - `data_quality` (text) - live, cached, stale, unavailable
  
  ### polling_recovery_log
  Historical log of all recovery attempts and circuit breaker state changes.
  - `symbol` (text) - Trading symbol or 'METAAPI_GLOBAL', 'ORCHESTRATOR'
  - `trigger_reason` (text) - What triggered recovery
  - `recovery_action` (text) - Action taken
  - `success` (boolean) - Whether recovery succeeded
  - `error_message` (text) - Error message if failed
  - `metrics` (jsonb) - Additional context data
  
  ### polling_fallback_cache
  Emergency cache of last known good prices for failover scenarios.
  - `symbol` (text, UNIQUE) - Trading symbol
  - `bid` (numeric) - Bid price
  - `ask` (numeric) - Ask price
  - `mid` (numeric) - Mid price
  - `spread` (numeric) - Spread
  - `source` (text) - Source of price data
  - `quality_score` (integer) - Quality score 0-100
  - `broker_time` (timestamptz) - Broker timestamp
  - `cached_at` (timestamptz) - When cached
  - `expires_at` (timestamptz) - Expiration timestamp
  
  ## Security
  - Enable RLS on all tables
  - Authenticated users can read health data
  - Authenticated users can write (for monitoring systems)
*/

-- =====================================================
-- 1. DROP OLD POLLING_HEALTH TABLE
-- =====================================================
DROP TABLE IF EXISTS public.polling_health CASCADE;

-- =====================================================
-- 2. CREATE NEW POLLING_HEALTH TABLE (SYMBOL-BASED)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.polling_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active',
  consecutive_errors integer NOT NULL DEFAULT 0,
  total_errors integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_message text,
  circuit_breaker_state text NOT NULL DEFAULT 'closed',
  circuit_opened_at timestamptz,
  recovery_attempts integer NOT NULL DEFAULT 0,
  last_recovery_at timestamptz,
  polling_interval_ms integer NOT NULL DEFAULT 3000,
  data_quality text NOT NULL DEFAULT 'unknown',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_polling_health_symbol ON public.polling_health(symbol);
CREATE INDEX IF NOT EXISTS idx_polling_health_status ON public.polling_health(status);
CREATE INDEX IF NOT EXISTS idx_polling_health_updated_at ON public.polling_health(updated_at);

-- Enable RLS
ALTER TABLE public.polling_health ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can read polling health"
  ON public.polling_health FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can write polling health"
  ON public.polling_health FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "System can update polling health"
  ON public.polling_health FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Create trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_polling_health_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_polling_health_timestamp ON public.polling_health;
CREATE TRIGGER update_polling_health_timestamp
  BEFORE UPDATE ON public.polling_health
  FOR EACH ROW
  EXECUTE FUNCTION update_polling_health_updated_at();

-- Insert initial health records for all tracked symbols
INSERT INTO public.polling_health (symbol, status, polling_interval_ms)
VALUES
  ('EURUSD', 'active', 3000),
  ('XAUUSD', 'active', 3000),
  ('US30', 'active', 3000),
  ('GBPUSD', 'active', 3000),
  ('USDJPY', 'active', 3000),
  ('METAAPI_GLOBAL', 'active', 3000),
  ('ORCHESTRATOR', 'active', 3000)
ON CONFLICT (symbol) DO NOTHING;

-- =====================================================
-- 3. CREATE POLLING_RECOVERY_LOG TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.polling_recovery_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  trigger_reason text NOT NULL,
  recovery_action text NOT NULL,
  success boolean NOT NULL DEFAULT false,
  error_message text,
  metrics jsonb,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_polling_recovery_log_symbol 
  ON public.polling_recovery_log(symbol);
CREATE INDEX IF NOT EXISTS idx_polling_recovery_log_created_at 
  ON public.polling_recovery_log(created_at DESC);

-- Enable RLS
ALTER TABLE public.polling_recovery_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can read recovery logs"
  ON public.polling_recovery_log FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can write recovery logs"
  ON public.polling_recovery_log FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- =====================================================
-- 4. CREATE POLLING_FALLBACK_CACHE TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.polling_fallback_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL UNIQUE,
  bid numeric NOT NULL,
  ask numeric NOT NULL,
  mid numeric NOT NULL,
  spread numeric NOT NULL,
  source text NOT NULL,
  quality_score integer NOT NULL DEFAULT 0,
  broker_time timestamptz NOT NULL,
  cached_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_polling_fallback_cache_symbol 
  ON public.polling_fallback_cache(symbol);
CREATE INDEX IF NOT EXISTS idx_polling_fallback_cache_expires_at 
  ON public.polling_fallback_cache(expires_at);

-- Enable RLS
ALTER TABLE public.polling_fallback_cache ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can read fallback cache"
  ON public.polling_fallback_cache FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can write fallback cache"
  ON public.polling_fallback_cache FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "System can update fallback cache"
  ON public.polling_fallback_cache FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "System can delete fallback cache"
  ON public.polling_fallback_cache FOR DELETE
  TO authenticated
  USING (true);

-- =====================================================
-- 5. CREATE CLEANUP FUNCTION
-- =====================================================
CREATE OR REPLACE FUNCTION cleanup_old_polling_logs()
RETURNS void AS $$
BEGIN
  -- Delete recovery logs older than 7 days
  DELETE FROM public.polling_recovery_log
  WHERE created_at < now() - interval '7 days';

  -- Delete expired fallback cache entries
  DELETE FROM public.polling_fallback_cache
  WHERE expires_at < now();
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION cleanup_old_polling_logs() TO authenticated;
