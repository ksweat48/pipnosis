/*
  # Rate Limit Transparency Fix — CCIP Governance

  ## Summary
  Fixes the misleading "Resets in 60 minutes" hardcoded fallback message shown
  when a user hits the OpenAI request rate limit. The check_rate_limit RPC now
  returns a reset_at timestamp field so the Netlify proxy can compute an accurate
  resetIn (seconds) value for the browser client.

  ## Changes

  ### Modified Functions
  - `check_rate_limit(p_user_id uuid)` — Adds `reset_at` (timestamptz) to all
    return branches so callers can compute the exact seconds until the limit resets.

  ## Affected Files (frontend/Netlify)
  - `netlify/functions/openai-chat.ts` — Computes `resetIn` from `reset_at` and
    includes it in the 429 response body alongside the existing `reason` field.
  - `src/services/openai-client.ts` — Reads `resetIn` (numeric) and `reason` from
    the 429 error payload to produce an accurate "Resets in X minutes" message.
  - `src/services/goal-session-live-engine.ts` — Distinguishes rate-limit failures
    from connectivity failures with a clearer user-facing message.

  ## CCIP Contract: 2026-02-24
  Operation: ccip_migration_applied
  Entity: alpha_coordinator
*/

CREATE OR REPLACE FUNCTION public.check_rate_limit(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rate_record RECORD;
  hourly_remaining int;
  daily_remaining int;
  hourly_reset timestamptz;
  daily_reset timestamptz;
BEGIN
  SELECT * INTO rate_record
  FROM openai_rate_limits
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    INSERT INTO openai_rate_limits (user_id)
    VALUES (p_user_id)
    RETURNING * INTO rate_record;
  END IF;

  IF rate_record.hourly_reset_at < now() THEN
    UPDATE openai_rate_limits
    SET hourly_count = 0,
        hourly_reset_at = now() + interval '1 hour',
        is_blocked = false
    WHERE user_id = p_user_id
    RETURNING hourly_reset_at INTO hourly_reset;
    rate_record.hourly_count := 0;
    rate_record.is_blocked := false;
    rate_record.hourly_reset_at := hourly_reset;
  END IF;

  IF rate_record.daily_reset_at < now() THEN
    UPDATE openai_rate_limits
    SET daily_count = 0,
        daily_reset_at = date_trunc('day', now()) + interval '1 day',
        is_blocked = false
    WHERE user_id = p_user_id
    RETURNING daily_reset_at INTO daily_reset;
    rate_record.daily_count := 0;
    rate_record.is_blocked := false;
    rate_record.daily_reset_at := daily_reset;
  END IF;

  hourly_remaining := rate_record.hourly_limit - rate_record.hourly_count;
  daily_remaining := rate_record.daily_limit - rate_record.daily_count;

  IF rate_record.hourly_count >= rate_record.hourly_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'hourly_limit_exceeded',
      'message', format('Hourly rate limit exceeded. Resets at %s', rate_record.hourly_reset_at),
      'hourly_remaining', 0,
      'daily_remaining', daily_remaining,
      'reset_at', rate_record.hourly_reset_at
    );
  END IF;

  IF rate_record.daily_count >= rate_record.daily_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'daily_limit_exceeded',
      'message', format('Daily rate limit exceeded. Resets at %s', rate_record.daily_reset_at),
      'hourly_remaining', hourly_remaining,
      'daily_remaining', 0,
      'reset_at', rate_record.daily_reset_at
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'reason', 'ok',
    'message', 'Rate limit check passed',
    'hourly_remaining', hourly_remaining,
    'daily_remaining', daily_remaining,
    'reset_at', rate_record.hourly_reset_at
  );
END;
$$;

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason
) VALUES (
  'alpha_coordinator',
  '00000000-0000-0000-0000-000000000000',
  'ccip_migration_applied',
  jsonb_build_object(
    'check_rate_limit_returns', 'allowed, reason, message, hourly_remaining, daily_remaining',
    'openai_client_resetIn_fallback', '3600 hardcoded',
    'session_error_message', 'generic rate limit message indistinguishable from connectivity failure'
  ),
  jsonb_build_object(
    'check_rate_limit_returns', 'allowed, reason, message, hourly_remaining, daily_remaining, reset_at',
    'openai_client_resetIn_source', 'numeric from proxy response body, 3600 only if absent',
    'openai_client_reason_field', 'hourly_limit_exceeded or daily_limit_exceeded exposed in error',
    'session_error_message', 'rate limit failures show specific message with reset time',
    'files_changed', ARRAY[
      'netlify/functions/openai-chat.ts',
      'src/services/openai-client.ts',
      'src/services/goal-session-live-engine.ts'
    ]
  ),
  'CCIP 2026-02-24: Fix misleading hardcoded Resets in 60 minutes message — check_rate_limit now returns reset_at, proxy computes exact resetIn seconds, client reads it accurately, session startup distinguishes rate limit from connectivity failure'
);
