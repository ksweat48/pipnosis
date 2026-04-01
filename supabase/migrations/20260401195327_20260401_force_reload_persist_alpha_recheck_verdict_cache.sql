/*
  # Force PostgREST Schema Cache Reload — persist_alpha_recheck_verdict

  ## Problem
  PostgREST's in-memory schema cache holds a stale 4-parameter view of
  `persist_alpha_recheck_verdict` (p_urgency, p_user_id, p_user_message, p_verdict).
  The live database function has all 19 parameters. This causes PGRST202 errors.

  ## Fix
  1. DROP and CREATE OR REPLACE the function to guarantee a fresh OID/metadata entry
  2. Re-grant EXECUTE to authenticated and service_role
  3. Issue NOTIFY pgrst to force immediate cache invalidation
*/

DROP FUNCTION IF EXISTS public.persist_alpha_recheck_verdict(
  uuid, uuid, uuid, text, text, text, text, integer, text, text, text,
  numeric, numeric, numeric, numeric, text, integer, boolean, text
);

CREATE OR REPLACE FUNCTION public.persist_alpha_recheck_verdict(
  p_trade_id            uuid,
  p_user_id             uuid,
  p_goal_session_id     uuid,
  p_trigger_type        text,
  p_trigger_reason      text,
  p_verdict             text,
  p_thesis_status       text,
  p_confidence          integer,
  p_alpha_reasoning     text,
  p_user_message        text,
  p_urgency             text,
  p_current_price       numeric,
  p_r_multiple          numeric,
  p_drawdown_percent    numeric,
  p_minutes_in_trade    numeric,
  p_model_used          text,
  p_tokens_used         integer,
  p_should_notify       boolean,
  p_thesis_status_before text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alert_id uuid;
  v_result   jsonb;
BEGIN
  INSERT INTO mid_trade_alerts (
    trade_id,
    user_id,
    goal_session_id,
    trigger_type,
    trigger_reason,
    verdict,
    thesis_status,
    confidence,
    alpha_reasoning,
    user_message,
    urgency,
    current_price,
    r_multiple,
    drawdown_percent,
    minutes_in_trade,
    model_used,
    tokens_used,
    should_notify,
    thesis_status_before,
    created_at
  ) VALUES (
    p_trade_id,
    p_user_id,
    p_goal_session_id,
    p_trigger_type,
    p_trigger_reason,
    p_verdict,
    p_thesis_status,
    p_confidence,
    p_alpha_reasoning,
    p_user_message,
    p_urgency,
    p_current_price,
    p_r_multiple,
    p_drawdown_percent,
    p_minutes_in_trade,
    p_model_used,
    p_tokens_used,
    p_should_notify,
    p_thesis_status_before,
    now()
  )
  RETURNING id INTO v_alert_id;

  v_result := jsonb_build_object(
    'success', true,
    'alert_id', v_alert_id,
    'verdict', p_verdict,
    'should_notify', p_should_notify
  );

  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'verdict', p_verdict
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.persist_alpha_recheck_verdict(
  uuid, uuid, uuid, text, text, text, text, integer, text, text, text,
  numeric, numeric, numeric, numeric, text, integer, boolean, text
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
