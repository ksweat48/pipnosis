/*
  # Fix OpenAI Rate Limit Function Signatures v3

  ## Overview
  Updates the rate limit and logging functions to match the signatures expected by the Netlify openai-chat function.
  Properly drops all existing overloaded function signatures.

  ## Changes
    1. Update `check_rate_limit()` to:
       - Accept parameter `p_user_id` instead of `user_uuid`
       - Return JSON object with detailed rate limit info
    
    2. Update `increment_rate_limit()` to:
       - Accept parameter `p_user_id` instead of `user_uuid`
    
    3. Update `log_openai_usage()` to:
       - Use parameter names with `p_` prefix
       - Match Netlify function call signature exactly
       - Remove old overloaded versions

  ## Security
    - No changes to RLS policies
    - Functions remain SECURITY DEFINER for service role access
*/

-- ============================================================================
-- Drop ALL versions of functions
-- ============================================================================

-- Drop check_rate_limit (old signature)
DROP FUNCTION IF EXISTS check_rate_limit(user_uuid uuid) CASCADE;

-- Drop increment_rate_limit (old signature)
DROP FUNCTION IF EXISTS increment_rate_limit(user_uuid uuid) CASCADE;

-- Drop log_openai_usage (old signature with jsonb)
DROP FUNCTION IF EXISTS log_openai_usage(
  user_uuid uuid, 
  model_name text, 
  endpoint_name text, 
  request_type_name text, 
  prompt_token_count integer, 
  completion_token_count integer, 
  total_token_count integer, 
  cost_in_usd numeric, 
  latency_in_ms integer, 
  was_success boolean, 
  error_msg text, 
  extra_metadata jsonb
) CASCADE;

-- Drop log_openai_usage (new signature without jsonb)
DROP FUNCTION IF EXISTS log_openai_usage(
  p_user_id uuid, 
  p_model text, 
  p_prompt_tokens integer, 
  p_completion_tokens integer, 
  p_total_tokens integer, 
  p_cost_usd numeric, 
  p_endpoint text, 
  p_request_type text, 
  p_success boolean, 
  p_error_message text, 
  p_latency_ms integer
) CASCADE;

-- ============================================================================
-- Check Rate Limit Function (Returns JSON with details)
-- ============================================================================

CREATE OR REPLACE FUNCTION check_rate_limit(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rate_record RECORD;
  hourly_remaining int;
  daily_remaining int;
BEGIN
  -- Get or create rate limit record
  SELECT * INTO rate_record
  FROM openai_rate_limits
  WHERE user_id = p_user_id;

  -- Create record if doesn't exist
  IF NOT FOUND THEN
    INSERT INTO openai_rate_limits (user_id)
    VALUES (p_user_id)
    RETURNING * INTO rate_record;
  END IF;

  -- Reset hourly counter if expired
  IF rate_record.hourly_reset_at < now() THEN
    UPDATE openai_rate_limits
    SET hourly_count = 0,
        hourly_reset_at = now() + interval '1 hour',
        is_blocked = false
    WHERE user_id = p_user_id;
    rate_record.hourly_count := 0;
    rate_record.is_blocked := false;
  END IF;

  -- Reset daily counter if expired
  IF rate_record.daily_reset_at < now() THEN
    UPDATE openai_rate_limits
    SET daily_count = 0,
        daily_reset_at = date_trunc('day', now()) + interval '1 day',
        is_blocked = false
    WHERE user_id = p_user_id;
    rate_record.daily_count := 0;
    rate_record.is_blocked := false;
  END IF;

  -- Calculate remaining capacity
  hourly_remaining := rate_record.hourly_limit - rate_record.hourly_count;
  daily_remaining := rate_record.daily_limit - rate_record.daily_count;

  -- Check if within limits
  IF rate_record.hourly_count >= rate_record.hourly_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'hourly_limit_exceeded',
      'message', format('Hourly rate limit exceeded. Resets at %s', rate_record.hourly_reset_at),
      'hourly_remaining', 0,
      'daily_remaining', daily_remaining
    );
  END IF;

  IF rate_record.daily_count >= rate_record.daily_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'daily_limit_exceeded',
      'message', format('Daily rate limit exceeded. Resets at %s', rate_record.daily_reset_at),
      'hourly_remaining', hourly_remaining,
      'daily_remaining', 0
    );
  END IF;

  -- All good!
  RETURN jsonb_build_object(
    'allowed', true,
    'reason', 'ok',
    'message', 'Rate limit check passed',
    'hourly_remaining', hourly_remaining,
    'daily_remaining', daily_remaining
  );
END;
$$;

-- ============================================================================
-- Increment Rate Limit Function
-- ============================================================================

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

-- ============================================================================
-- Log OpenAI Usage Function
-- ============================================================================

CREATE OR REPLACE FUNCTION log_openai_usage(
  p_user_id uuid,
  p_model text,
  p_prompt_tokens int,
  p_completion_tokens int,
  p_total_tokens int,
  p_cost_usd decimal,
  p_endpoint text,
  p_request_type text,
  p_success boolean,
  p_error_message text,
  p_latency_ms int
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
    cost_usd, latency_ms, success, error_message
  )
  VALUES (
    p_user_id, p_model, p_endpoint, p_request_type,
    p_prompt_tokens, p_completion_tokens, p_total_tokens,
    p_cost_usd, p_latency_ms, p_success, p_error_message
  )
  RETURNING id INTO log_id;

  -- Update cost summary
  SELECT * INTO cost_record
  FROM openai_cost_summary
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    INSERT INTO openai_cost_summary (
      user_id, today_cost, this_week_cost, this_month_cost, all_time_cost,
      today_calls, this_week_calls, this_month_calls, all_time_calls
    )
    VALUES (
      p_user_id, p_cost_usd, p_cost_usd, p_cost_usd, p_cost_usd,
      1, 1, 1, 1
    );
  ELSE
    -- Reset daily if new day
    IF cost_record.last_reset_date < CURRENT_DATE THEN
      UPDATE openai_cost_summary
      SET today_cost = p_cost_usd,
          today_calls = 1,
          last_reset_date = CURRENT_DATE
      WHERE user_id = p_user_id;
    ELSE
      UPDATE openai_cost_summary
      SET today_cost = today_cost + p_cost_usd,
          today_calls = today_calls + 1
      WHERE user_id = p_user_id;
    END IF;

    -- Always update week, month, all-time
    UPDATE openai_cost_summary
    SET this_week_cost = this_week_cost + p_cost_usd,
        this_month_cost = this_month_cost + p_cost_usd,
        all_time_cost = all_time_cost + p_cost_usd,
        this_week_calls = this_week_calls + 1,
        this_month_calls = this_month_calls + 1,
        all_time_calls = all_time_calls + 1,
        updated_at = now()
    WHERE user_id = p_user_id;
  END IF;

  RETURN log_id;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION check_rate_limit(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION increment_rate_limit(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION log_openai_usage(uuid, text, int, int, int, decimal, text, text, boolean, text, int) TO authenticated, service_role;
