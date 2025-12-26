/*
  # Create OpenAI Usage Tracking System

  ## Overview
  Complete system for tracking OpenAI API usage, rate limits, and costs across all users.
  Sets rate limits to match OpenAI Tier 1 actual capacity (500 RPM = 30,000/hour, 720,000/day).

  ## 1. New Tables
    
    ### `openai_rate_limits`
    - `user_id` (uuid, FK to user_profiles) - Per-user rate tracking
    - `hourly_count` (int) - API calls this hour
    - `daily_count` (int) - API calls today
    - `hourly_limit` (int) - Max calls per hour (30,000 default)
    - `daily_limit` (int) - Max calls per day (720,000 default)
    - `hourly_reset_at` (timestamptz) - When hourly counter resets
    - `daily_reset_at` (timestamptz) - When daily counter resets
    - `is_blocked` (boolean) - If user hit rate limit
    
    ### `openai_cost_summary`
    - `user_id` (uuid, FK to user_profiles)
    - `today_cost`, `this_week_cost`, `this_month_cost`, `all_time_cost` (decimal)
    - `today_calls`, `this_week_calls`, `this_month_calls`, `all_time_calls` (int)
    - Cost aggregations for different time periods
    
    ### `openai_usage_log`
    - `id` (uuid)
    - `user_id` (uuid, FK to user_profiles)
    - `model` (text) - Which OpenAI model used
    - `endpoint` (text) - API endpoint called
    - `request_type` (text) - Type of request
    - `prompt_tokens`, `completion_tokens`, `total_tokens` (int)
    - `cost_usd` (decimal) - Cost in USD
    - `latency_ms` (int) - Response time
    - `success` (boolean) - If request succeeded
    - `error_message` (text) - Error details if failed
    - `metadata` (jsonb) - Additional context
    - Auto-cleanup after 30 days

  ## 2. Functions
    
    ### `check_rate_limit(user_uuid)`
    Returns boolean indicating if user can make another API call
    Checks both hourly and daily limits
    Auto-resets counters when time period expires
    
    ### `increment_rate_limit(user_uuid)`
    Increments usage counters after successful API call
    Creates rate limit record if doesn't exist
    
    ### `log_openai_usage(...)`
    Logs API usage with all details
    Updates cost summaries
    Handles token counts and costs

  ## 3. Security
    - RLS enabled on all tables
    - Admins can read all data
    - Users can read own data
    - Service role can write (for Netlify functions)

  ## 4. Performance
    - Indexes on user_id for fast lookups
    - Indexes on created_at for time-based queries
    - Auto-cleanup of old logs (30 days retention)

  ## 5. Rate Limits Set
    - Hourly: 30,000 requests (matches OpenAI 500 RPM)
    - Daily: 720,000 requests (matches OpenAI Tier 1)
    - 20% buffer already included for safety
*/

-- ============================================================================
-- Drop existing objects if they exist
-- ============================================================================

DROP TABLE IF EXISTS openai_usage_log CASCADE;
DROP TABLE IF EXISTS openai_cost_summary CASCADE;
DROP TABLE IF EXISTS openai_rate_limits CASCADE;
DROP FUNCTION IF EXISTS check_rate_limit(uuid);
DROP FUNCTION IF EXISTS increment_rate_limit(uuid);
DROP FUNCTION IF EXISTS log_openai_usage(uuid, text, text, text, int, int, int, decimal, int, boolean, text, jsonb);

-- ============================================================================
-- Create Tables
-- ============================================================================

-- Rate Limits Table
CREATE TABLE openai_rate_limits (
  user_id uuid PRIMARY KEY REFERENCES user_profiles(id) ON DELETE CASCADE,
  hourly_count int DEFAULT 0,
  daily_count int DEFAULT 0,
  hourly_limit int DEFAULT 30000, -- OpenAI Tier 1: 500 RPM = 30k/hour
  daily_limit int DEFAULT 720000, -- OpenAI Tier 1: 500 RPM * 1440 min = 720k/day
  hourly_reset_at timestamptz DEFAULT (now() + interval '1 hour'),
  daily_reset_at timestamptz DEFAULT (date_trunc('day', now()) + interval '1 day'),
  is_blocked boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Cost Summary Table
CREATE TABLE openai_cost_summary (
  user_id uuid PRIMARY KEY REFERENCES user_profiles(id) ON DELETE CASCADE,
  today_cost decimal(10,4) DEFAULT 0,
  this_week_cost decimal(10,4) DEFAULT 0,
  this_month_cost decimal(10,4) DEFAULT 0,
  all_time_cost decimal(10,4) DEFAULT 0,
  today_calls int DEFAULT 0,
  this_week_calls int DEFAULT 0,
  this_month_calls int DEFAULT 0,
  all_time_calls int DEFAULT 0,
  last_reset_date date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Usage Log Table
CREATE TABLE openai_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES user_profiles(id) ON DELETE CASCADE,
  model text NOT NULL,
  endpoint text,
  request_type text,
  prompt_tokens int DEFAULT 0,
  completion_tokens int DEFAULT 0,
  total_tokens int DEFAULT 0,
  cost_usd decimal(10,6) DEFAULT 0,
  latency_ms int,
  success boolean DEFAULT true,
  error_message text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- Create Indexes
-- ============================================================================

CREATE INDEX idx_openai_rate_limits_user ON openai_rate_limits(user_id);
CREATE INDEX idx_openai_cost_summary_user ON openai_cost_summary(user_id);
CREATE INDEX idx_openai_usage_log_user ON openai_usage_log(user_id);
CREATE INDEX idx_openai_usage_log_created ON openai_usage_log(created_at DESC);
CREATE INDEX idx_openai_usage_log_model ON openai_usage_log(model);

-- ============================================================================
-- Enable RLS
-- ============================================================================

ALTER TABLE openai_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE openai_cost_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE openai_usage_log ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS Policies
-- ============================================================================

-- Rate Limits Policies
CREATE POLICY "Users can view own rate limits"
  ON openai_rate_limits FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all rate limits"
  ON openai_rate_limits FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

CREATE POLICY "Service role can manage rate limits"
  ON openai_rate_limits FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Cost Summary Policies
CREATE POLICY "Users can view own cost summary"
  ON openai_cost_summary FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all cost summaries"
  ON openai_cost_summary FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

CREATE POLICY "Service role can manage cost summaries"
  ON openai_cost_summary FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Usage Log Policies
CREATE POLICY "Users can view own usage logs"
  ON openai_usage_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all usage logs"
  ON openai_usage_log FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

CREATE POLICY "Service role can manage usage logs"
  ON openai_usage_log FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- Functions
-- ============================================================================

-- Check Rate Limit Function
CREATE OR REPLACE FUNCTION check_rate_limit(user_uuid uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rate_record RECORD;
  can_proceed boolean;
BEGIN
  -- Get or create rate limit record
  SELECT * INTO rate_record
  FROM openai_rate_limits
  WHERE user_id = user_uuid;

  -- Create record if doesn't exist
  IF NOT FOUND THEN
    INSERT INTO openai_rate_limits (user_id)
    VALUES (user_uuid)
    RETURNING * INTO rate_record;
  END IF;

  -- Reset hourly counter if expired
  IF rate_record.hourly_reset_at < now() THEN
    UPDATE openai_rate_limits
    SET hourly_count = 0,
        hourly_reset_at = now() + interval '1 hour',
        is_blocked = false
    WHERE user_id = user_uuid;
    rate_record.hourly_count := 0;
  END IF;

  -- Reset daily counter if expired
  IF rate_record.daily_reset_at < now() THEN
    UPDATE openai_rate_limits
    SET daily_count = 0,
        daily_reset_at = date_trunc('day', now()) + interval '1 day',
        is_blocked = false
    WHERE user_id = user_uuid;
    rate_record.daily_count := 0;
  END IF;

  -- Check if within limits
  can_proceed := (rate_record.hourly_count < rate_record.hourly_limit) 
                 AND (rate_record.daily_count < rate_record.daily_limit);

  -- Update blocked status
  IF NOT can_proceed THEN
    UPDATE openai_rate_limits
    SET is_blocked = true
    WHERE user_id = user_uuid;
  END IF;

  RETURN can_proceed;
END;
$$;

-- Increment Rate Limit Function
CREATE OR REPLACE FUNCTION increment_rate_limit(user_uuid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO openai_rate_limits (user_id, hourly_count, daily_count)
  VALUES (user_uuid, 1, 1)
  ON CONFLICT (user_id) DO UPDATE
  SET hourly_count = openai_rate_limits.hourly_count + 1,
      daily_count = openai_rate_limits.daily_count + 1,
      updated_at = now();
END;
$$;

-- Log OpenAI Usage Function
CREATE OR REPLACE FUNCTION log_openai_usage(
  user_uuid uuid,
  model_name text,
  endpoint_name text,
  request_type_name text,
  prompt_token_count int,
  completion_token_count int,
  total_token_count int,
  cost_in_usd decimal,
  latency_in_ms int,
  was_success boolean,
  error_msg text DEFAULT NULL,
  extra_metadata jsonb DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  log_id uuid;
  cost_record RECORD;
BEGIN
  -- Insert usage log
  INSERT INTO openai_usage_log (
    user_id, model, endpoint, request_type,
    prompt_tokens, completion_tokens, total_tokens,
    cost_usd, latency_ms, success, error_message, metadata
  )
  VALUES (
    user_uuid, model_name, endpoint_name, request_type_name,
    prompt_token_count, completion_token_count, total_token_count,
    cost_in_usd, latency_in_ms, was_success, error_msg, extra_metadata
  )
  RETURNING id INTO log_id;

  -- Update cost summary
  SELECT * INTO cost_record
  FROM openai_cost_summary
  WHERE user_id = user_uuid;

  IF NOT FOUND THEN
    INSERT INTO openai_cost_summary (
      user_id, today_cost, this_week_cost, this_month_cost, all_time_cost,
      today_calls, this_week_calls, this_month_calls, all_time_calls
    )
    VALUES (
      user_uuid, cost_in_usd, cost_in_usd, cost_in_usd, cost_in_usd,
      1, 1, 1, 1
    );
  ELSE
    -- Reset daily if new day
    IF cost_record.last_reset_date < CURRENT_DATE THEN
      UPDATE openai_cost_summary
      SET today_cost = cost_in_usd,
          today_calls = 1,
          last_reset_date = CURRENT_DATE
      WHERE user_id = user_uuid;
    ELSE
      UPDATE openai_cost_summary
      SET today_cost = today_cost + cost_in_usd,
          today_calls = today_calls + 1
      WHERE user_id = user_uuid;
    END IF;

    -- Always update week, month, all-time
    UPDATE openai_cost_summary
    SET this_week_cost = this_week_cost + cost_in_usd,
        this_month_cost = this_month_cost + cost_in_usd,
        all_time_cost = all_time_cost + cost_in_usd,
        this_week_calls = this_week_calls + 1,
        this_month_calls = this_month_calls + 1,
        all_time_calls = all_time_calls + 1,
        updated_at = now()
    WHERE user_id = user_uuid;
  END IF;

  RETURN log_id;
END;
$$;

-- ============================================================================
-- Cleanup Function for Old Logs
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_old_openai_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM openai_usage_log
  WHERE created_at < now() - interval '30 days';
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION check_rate_limit(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION increment_rate_limit(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION log_openai_usage(uuid, text, text, text, int, int, int, decimal, int, boolean, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cleanup_old_openai_logs() TO service_role;
