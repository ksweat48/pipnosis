/*
  # Force PostgREST schema cache reload for persist_alpha_recheck_verdict

  ## Problem
  PostgREST returns PGRST202 (404) for persist_alpha_recheck_verdict despite
  the function existing in the database. This is a schema cache staleness issue.

  ## Fix
  Drop and recreate the function to force PostgREST to pick it up on next reload.
  This is a no-op from a logic perspective — identical signature and body.
*/

DROP FUNCTION IF EXISTS public.persist_alpha_recheck_verdict(
  uuid, uuid, uuid, text, text, text, text, integer,
  text, text, text, numeric, numeric, numeric, numeric,
  text, integer, boolean, text
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
  v_log_id uuid;
BEGIN
  UPDATE goal_session_trades
  SET
    thesis_status      = p_thesis_status,
    last_recheck_at    = now(),
    updated_at         = now()
  WHERE id = p_trade_id
    AND user_id = p_user_id;

  INSERT INTO mid_trade_recheck_log (
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
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'success', true,
    'log_id', v_log_id
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.persist_alpha_recheck_verdict(
  uuid, uuid, uuid, text, text, text, text, integer,
  text, text, text, numeric, numeric, numeric, numeric,
  text, integer, boolean, text
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.persist_alpha_recheck_verdict(
  uuid, uuid, uuid, text, text, text, text, integer,
  text, text, text, numeric, numeric, numeric, numeric,
  text, integer, boolean, text
) TO service_role;

NOTIFY pgrst, 'reload schema';
