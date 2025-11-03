/*
  # Add Polling Configuration and Rate Limit Tracking

  1. Schema Changes
    - Add `polling_config` JSONB column to `user_profiles` for storing user polling preferences
    - Create `polling_rate_limits` table for tracking API usage and CPU credits
    - Create `symbol_volatility_tracking` table for volatility-based polling adjustments

  2. New Tables
    - `polling_rate_limits`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to auth.users)
      - `timestamp` (timestamptz)
      - `credits_used` (integer)
      - `endpoint` (text)
      - `symbol` (text)

    - `symbol_volatility_tracking`
      - `id` (uuid, primary key)
      - `symbol` (text)
      - `timeframe` (text)
      - `volatility_score` (decimal)
      - `price_std_dev` (decimal)
      - `last_updated` (timestamptz)
      - `suggested_interval` (integer)

  3. Security
    - Enable RLS on new tables
    - Add policies for authenticated users
*/

-- Add polling_config to user_profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_profiles' AND column_name = 'polling_config'
  ) THEN
    ALTER TABLE user_profiles
    ADD COLUMN polling_config JSONB DEFAULT '{
      "speed": "balanced",
      "enableVolatilityAdjustment": true,
      "pauseOnInactive": true,
      "customIntervals": {}
    }'::jsonb;
  END IF;
END $$;

-- Create polling_rate_limits table
CREATE TABLE IF NOT EXISTS polling_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  timestamp timestamptz DEFAULT now() NOT NULL,
  credits_used integer DEFAULT 0 NOT NULL,
  endpoint text NOT NULL,
  symbol text,
  created_at timestamptz DEFAULT now()
);

-- Create index for efficient querying
CREATE INDEX IF NOT EXISTS idx_polling_rate_limits_user_timestamp
  ON polling_rate_limits(user_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_polling_rate_limits_timestamp
  ON polling_rate_limits(timestamp DESC);

-- Create symbol_volatility_tracking table
CREATE TABLE IF NOT EXISTS symbol_volatility_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timeframe text DEFAULT 'M5' NOT NULL,
  volatility_score decimal DEFAULT 0 NOT NULL,
  price_std_dev decimal DEFAULT 0 NOT NULL,
  last_updated timestamptz DEFAULT now() NOT NULL,
  suggested_interval integer DEFAULT 2000 NOT NULL,
  price_samples jsonb DEFAULT '[]'::jsonb,
  UNIQUE(symbol, timeframe)
);

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_volatility_symbol_timeframe
  ON symbol_volatility_tracking(symbol, timeframe);

CREATE INDEX IF NOT EXISTS idx_volatility_last_updated
  ON symbol_volatility_tracking(last_updated DESC);

-- Enable RLS
ALTER TABLE polling_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE symbol_volatility_tracking ENABLE ROW LEVEL SECURITY;

-- Policies for polling_rate_limits
CREATE POLICY "Users can view own rate limit data"
  ON polling_rate_limits
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own rate limit data"
  ON polling_rate_limits
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policies for symbol_volatility_tracking (read-only for all authenticated users)
CREATE POLICY "All authenticated users can view volatility data"
  ON symbol_volatility_tracking
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Only authenticated users can update volatility data"
  ON symbol_volatility_tracking
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Only authenticated users can modify volatility data"
  ON symbol_volatility_tracking
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Function to cleanup old rate limit records (older than 1 hour)
CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM polling_rate_limits
  WHERE timestamp < now() - interval '1 hour';
END;
$$;

-- Function to calculate symbol volatility
CREATE OR REPLACE FUNCTION update_symbol_volatility(
  p_symbol text,
  p_timeframe text,
  p_current_price decimal
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_samples jsonb;
  v_prices decimal[];
  v_mean decimal;
  v_variance decimal;
  v_std_dev decimal;
  v_volatility_score decimal;
  v_suggested_interval integer;
BEGIN
  -- Get existing samples or initialize empty array
  SELECT COALESCE(price_samples, '[]'::jsonb)
  INTO v_samples
  FROM symbol_volatility_tracking
  WHERE symbol = p_symbol AND timeframe = p_timeframe;

  -- Add new price sample (keep last 20 samples)
  v_samples := (
    SELECT jsonb_agg(value)
    FROM (
      SELECT value
      FROM jsonb_array_elements(v_samples)
      ORDER BY ordinality DESC
      LIMIT 19
      UNION ALL
      SELECT to_jsonb(p_current_price)
    ) subq
  );

  -- Convert to array for calculation
  SELECT array_agg((value::text)::decimal)
  INTO v_prices
  FROM jsonb_array_elements(v_samples);

  -- Calculate mean
  SELECT AVG(price) INTO v_mean FROM unnest(v_prices) AS price;

  -- Calculate variance and standard deviation
  SELECT AVG(power(price - v_mean, 2)) INTO v_variance FROM unnest(v_prices) AS price;
  v_std_dev := sqrt(v_variance);

  -- Calculate volatility score (normalized)
  v_volatility_score := (v_std_dev / NULLIF(v_mean, 0)) * 100;

  -- Suggest interval based on volatility
  -- High volatility (>1.0): 500ms
  -- Medium volatility (0.5-1.0): 1000ms
  -- Low volatility (<0.5): 2000ms
  IF v_volatility_score > 1.0 THEN
    v_suggested_interval := 500;
  ELSIF v_volatility_score > 0.5 THEN
    v_suggested_interval := 1000;
  ELSE
    v_suggested_interval := 2000;
  END IF;

  -- Upsert volatility data
  INSERT INTO symbol_volatility_tracking (
    symbol,
    timeframe,
    volatility_score,
    price_std_dev,
    last_updated,
    suggested_interval,
    price_samples
  )
  VALUES (
    p_symbol,
    p_timeframe,
    v_volatility_score,
    v_std_dev,
    now(),
    v_suggested_interval,
    v_samples
  )
  ON CONFLICT (symbol, timeframe)
  DO UPDATE SET
    volatility_score = v_volatility_score,
    price_std_dev = v_std_dev,
    last_updated = now(),
    suggested_interval = v_suggested_interval,
    price_samples = v_samples;
END;
$$;

-- Add comment
COMMENT ON TABLE polling_rate_limits IS 'Tracks API rate limit usage for MetaAPI CPU credits';
COMMENT ON TABLE symbol_volatility_tracking IS 'Tracks symbol volatility for adaptive polling intervals';
COMMENT ON FUNCTION cleanup_old_rate_limits() IS 'Removes rate limit records older than 1 hour';
COMMENT ON FUNCTION update_symbol_volatility(text, text, decimal) IS 'Updates volatility metrics and suggests optimal polling interval';
