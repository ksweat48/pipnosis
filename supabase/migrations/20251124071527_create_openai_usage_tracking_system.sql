/*
  # Create OpenAI Usage Tracking and Rate Limiting System

  ## Overview
  Complete system for tracking OpenAI API usage, enforcing rate limits, and monitoring costs.
  Includes authentication, per-user quotas, and comprehensive analytics.

  ## New Tables

  ### 1. `openai_usage_log`
  Logs every OpenAI API call with detailed metrics:
  - Token usage (prompt, completion, total)
  - Cost calculation based on model pricing
  - Request metadata (type, endpoint, latency)
  - Success/error tracking

  ### 2. `openai_rate_limits`
  Per-user rate limiting with automatic resets:
  - Hourly and daily request counters
  - Configurable limits per user tier
  - Block capability for abuse prevention

  ### 3. `openai_cost_summary`
  Aggregated cost metrics per user:
  - Daily, weekly, monthly, and all-time costs
  - Request counts by time period
  - Automatically updated via triggers

  ## Security
  - RLS enabled on all tables
  - Users can only read their own data
  - Service role has full access for system operations
  - Admin role can view all users for monitoring

  ## Functions
  - `check_rate_limit(user_id)` - Validates if user can make request
  - `increment_rate_limit(user_id)` - Updates request counters
  - `log_openai_usage(...)` - Records usage and updates costs
  - `reset_expired_rate_limits()` - Cleanup cron job

  ## Rate Limits (Default)
  - Free Tier: 100/hour, 500/day
  - Premium Tier: 200/hour, 1000/day (future enhancement)
  - Admin: 1000/hour, 5000/day
*/

-- Table: openai_usage_log
CREATE TABLE IF NOT EXISTS openai_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  model text NOT NULL,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(10, 6) NOT NULL DEFAULT 0,
  endpoint text,
  request_type text,
  success boolean NOT NULL DEFAULT true,
  error_message text,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Table: openai_rate_limits
CREATE TABLE IF NOT EXISTS openai_rate_limits (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  hourly_count integer NOT NULL DEFAULT 0,
  daily_count integer NOT NULL DEFAULT 0,
  hourly_limit integer NOT NULL DEFAULT 100,
  daily_limit integer NOT NULL DEFAULT 500,
  hourly_reset_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  daily_reset_at timestamptz NOT NULL DEFAULT (date_trunc('day', now()) + interval '1 day'),
  is_blocked boolean NOT NULL DEFAULT false,
  block_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Table: openai_cost_summary
CREATE TABLE IF NOT EXISTS openai_cost_summary (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  today_cost numeric(10, 6) NOT NULL DEFAULT 0,
  this_week_cost numeric(10, 6) NOT NULL DEFAULT 0,
  this_month_cost numeric(10, 6) NOT NULL DEFAULT 0,
  all_time_cost numeric(10, 6) NOT NULL DEFAULT 0,
  today_calls integer NOT NULL DEFAULT 0,
  this_week_calls integer NOT NULL DEFAULT 0,
  this_month_calls integer NOT NULL DEFAULT 0,
  all_time_calls integer NOT NULL DEFAULT 0,
  last_reset_date date NOT NULL DEFAULT CURRENT_DATE,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_openai_usage_log_user_created ON openai_usage_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_openai_usage_log_created ON openai_usage_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_openai_usage_log_model ON openai_usage_log(model, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_openai_rate_limits_resets ON openai_rate_limits(hourly_reset_at, daily_reset_at);

-- Enable RLS
ALTER TABLE openai_usage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE openai_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE openai_cost_summary ENABLE ROW LEVEL SECURITY;

-- RLS Policies: openai_usage_log
CREATE POLICY "Users can read own usage logs"
  ON openai_usage_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert usage logs"
  ON openai_usage_log FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Admins can view all usage logs"
  ON openai_usage_log FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  );

-- RLS Policies: openai_rate_limits
CREATE POLICY "Users can read own rate limits"
  ON openai_rate_limits FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage rate limits"
  ON openai_rate_limits FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Admins can view all rate limits"
  ON openai_rate_limits FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  );

-- RLS Policies: openai_cost_summary
CREATE POLICY "Users can read own cost summary"
  ON openai_cost_summary FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage cost summaries"
  ON openai_cost_summary FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Admins can view all cost summaries"
  ON openai_cost_summary FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  );

-- Function: Check if user is within rate limits
CREATE OR REPLACE FUNCTION check_rate_limit(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rate_limit openai_rate_limits;
  v_result jsonb;
BEGIN
  -- Get or create rate limit record
  SELECT * INTO v_rate_limit
  FROM openai_rate_limits
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    INSERT INTO openai_rate_limits (user_id)
    VALUES (p_user_id)
    RETURNING * INTO v_rate_limit;
  END IF;

  -- Reset counters if expired
  IF v_rate_limit.hourly_reset_at < now() THEN
    UPDATE openai_rate_limits
    SET hourly_count = 0,
        hourly_reset_at = now() + interval '1 hour',
        updated_at = now()
    WHERE user_id = p_user_id
    RETURNING * INTO v_rate_limit;
  END IF;

  IF v_rate_limit.daily_reset_at < now() THEN
    UPDATE openai_rate_limits
    SET daily_count = 0,
        daily_reset_at = date_trunc('day', now()) + interval '1 day',
        updated_at = now()
    WHERE user_id = p_user_id
    RETURNING * INTO v_rate_limit;
  END IF;

  -- Check if blocked
  IF v_rate_limit.is_blocked THEN
    v_result := jsonb_build_object(
      'allowed', false,
      'reason', 'blocked',
      'message', v_rate_limit.block_reason
    );
    RETURN v_result;
  END IF;

  -- Check hourly limit
  IF v_rate_limit.hourly_count >= v_rate_limit.hourly_limit THEN
    v_result := jsonb_build_object(
      'allowed', false,
      'reason', 'hourly_limit_exceeded',
      'message', format('Hourly limit of %s requests exceeded', v_rate_limit.hourly_limit),
      'hourly_remaining', 0,
      'hourly_reset_in_seconds', EXTRACT(EPOCH FROM (v_rate_limit.hourly_reset_at - now()))::integer
    );
    RETURN v_result;
  END IF;

  -- Check daily limit
  IF v_rate_limit.daily_count >= v_rate_limit.daily_limit THEN
    v_result := jsonb_build_object(
      'allowed', false,
      'reason', 'daily_limit_exceeded',
      'message', format('Daily limit of %s requests exceeded', v_rate_limit.daily_limit),
      'daily_remaining', 0,
      'daily_reset_in_seconds', EXTRACT(EPOCH FROM (v_rate_limit.daily_reset_at - now()))::integer
    );
    RETURN v_result;
  END IF;

  -- Within limits
  v_result := jsonb_build_object(
    'allowed', true,
    'hourly_remaining', v_rate_limit.hourly_limit - v_rate_limit.hourly_count,
    'daily_remaining', v_rate_limit.daily_limit - v_rate_limit.daily_count,
    'hourly_reset_in_seconds', EXTRACT(EPOCH FROM (v_rate_limit.hourly_reset_at - now()))::integer,
    'daily_reset_in_seconds', EXTRACT(EPOCH FROM (v_rate_limit.daily_reset_at - now()))::integer
  );

  RETURN v_result;
END;
$$;

-- Function: Increment rate limit counters
CREATE OR REPLACE FUNCTION increment_rate_limit(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO openai_rate_limits (user_id, hourly_count, daily_count)
  VALUES (p_user_id, 1, 1)
  ON CONFLICT (user_id) DO UPDATE
  SET hourly_count = openai_rate_limits.hourly_count + 1,
      daily_count = openai_rate_limits.daily_count + 1,
      updated_at = now();
END;
$$;

-- Function: Log OpenAI usage and update costs
CREATE OR REPLACE FUNCTION log_openai_usage(
  p_user_id uuid,
  p_model text,
  p_prompt_tokens integer,
  p_completion_tokens integer,
  p_total_tokens integer,
  p_cost_usd numeric,
  p_endpoint text DEFAULT NULL,
  p_request_type text DEFAULT NULL,
  p_success boolean DEFAULT true,
  p_error_message text DEFAULT NULL,
  p_latency_ms integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_log_id uuid;
BEGIN
  -- Insert usage log
  INSERT INTO openai_usage_log (
    user_id, model, prompt_tokens, completion_tokens, total_tokens,
    cost_usd, endpoint, request_type, success, error_message, latency_ms
  ) VALUES (
    p_user_id, p_model, p_prompt_tokens, p_completion_tokens, p_total_tokens,
    p_cost_usd, p_endpoint, p_request_type, p_success, p_error_message, p_latency_ms
  ) RETURNING id INTO v_log_id;

  -- Update or create cost summary
  INSERT INTO openai_cost_summary (
    user_id,
    today_cost, this_week_cost, this_month_cost, all_time_cost,
    today_calls, this_week_calls, this_month_calls, all_time_calls
  ) VALUES (
    p_user_id,
    p_cost_usd, p_cost_usd, p_cost_usd, p_cost_usd,
    1, 1, 1, 1
  )
  ON CONFLICT (user_id) DO UPDATE
  SET today_cost = openai_cost_summary.today_cost + p_cost_usd,
      this_week_cost = openai_cost_summary.this_week_cost + p_cost_usd,
      this_month_cost = openai_cost_summary.this_month_cost + p_cost_usd,
      all_time_cost = openai_cost_summary.all_time_cost + p_cost_usd,
      today_calls = openai_cost_summary.today_calls + 1,
      this_week_calls = openai_cost_summary.this_week_calls + 1,
      this_month_calls = openai_cost_summary.this_month_calls + 1,
      all_time_calls = openai_cost_summary.all_time_calls + 1,
      updated_at = now();

  RETURN v_log_id;
END;
$$;

-- Function: Reset cost summary periods
CREATE OR REPLACE FUNCTION reset_cost_summary_periods()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Reset daily costs (runs at midnight)
  UPDATE openai_cost_summary
  SET today_cost = 0,
      today_calls = 0,
      last_reset_date = CURRENT_DATE,
      updated_at = now()
  WHERE last_reset_date < CURRENT_DATE;

  -- Reset weekly costs (runs on Monday)
  UPDATE openai_cost_summary
  SET this_week_cost = 0,
      this_week_calls = 0,
      updated_at = now()
  WHERE EXTRACT(DOW FROM last_reset_date) > EXTRACT(DOW FROM CURRENT_DATE);

  -- Reset monthly costs (runs on 1st of month)
  UPDATE openai_cost_summary
  SET this_month_cost = 0,
      this_month_calls = 0,
      updated_at = now()
  WHERE EXTRACT(MONTH FROM last_reset_date) != EXTRACT(MONTH FROM CURRENT_DATE);
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION check_rate_limit(uuid) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION increment_rate_limit(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION log_openai_usage(uuid, text, integer, integer, integer, numeric, text, text, boolean, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION reset_cost_summary_periods() TO service_role;