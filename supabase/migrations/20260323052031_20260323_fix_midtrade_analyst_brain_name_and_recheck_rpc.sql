/*
  # Fix: MidTrade-Analyst brain_name constraint + persist_alpha_recheck_verdict schema cache

  ## Two errors addressed

  ### 1. llm_token_usage_brain_name_check constraint violation
  The brain 'Alpha-MidTrade-Analyst' was being logged by alpha-midtrade-analyst.ts but
  was not in the allowed list. Canonical name is now 'MidTrade-Analyst' — consistent with
  the MidTrade-* naming convention for all mid-trade brain entries.

  - Adds 'MidTrade-Analyst' to the brain_name_check constraint
  - Renames any existing rows with 'Alpha-MidTrade-Analyst' to 'MidTrade-Analyst'
  - alpha-midtrade-analyst.ts updated to log as 'MidTrade-Analyst'
  - llm-token-tracker.ts BrainName type updated to include 'MidTrade-Analyst'

  ### 2. persist_alpha_recheck_verdict 404 (schema cache miss)
  PostgREST error: "no matches were found in the schema cache" — function exists in
  migrations but PostgREST has not picked it up correctly. This migration drops and
  recreates the function to force a fresh schema registration.
  Signature is unchanged from 20260322055539.

  ## SSOT
  - brain_name constraint: this migration (canonical list)
  - RPC owner: mid-trade-escalation-engine.ts (sole caller)
  - No logic changes — pure schema registration fix
*/

-- ─── 1. Fix brain_name constraint ────────────────────────────────────────────

ALTER TABLE llm_token_usage DROP CONSTRAINT IF EXISTS llm_token_usage_brain_name_check;

ALTER TABLE llm_token_usage
  ADD CONSTRAINT llm_token_usage_brain_name_check CHECK (brain_name IN (
    'Alpha',
    'Omega-1', 'Omega-2', 'Omega-3', 'Omega-4', 'Omega-5',
    'Omega-6', 'Omega-7', 'Omega-8', 'Omega-9', 'Omega-10',
    'MidTrade-Monitor',
    'MidTrade-Periodic',
    'MidTrade-Soft',
    'MidTrade-Medium',
    'MidTrade-Hard',
    'MidTrade-Emergency',
    'MidTrade-Analyst'
  ));

-- Backfill any existing rows that used the incorrect name
UPDATE llm_token_usage
SET brain_name = 'MidTrade-Analyst'
WHERE brain_name = 'Alpha-MidTrade-Analyst';

-- ─── 2. Drop and recreate persist_alpha_recheck_verdict ──────────────────────
-- Force PostgREST schema cache to register the correct function signature.
-- Logic is identical to 20260322055539 — this is a schema registration fix only.

DROP FUNCTION IF EXISTS persist_alpha_recheck_verdict(
  uuid, uuid, uuid, text, text, text, text, integer,
  text, text, text, numeric, numeric, numeric, numeric,
  text, integer, boolean, text
);

CREATE OR REPLACE FUNCTION persist_alpha_recheck_verdict(
  p_trade_id uuid,
  p_user_id uuid,
  p_goal_session_id uuid,
  p_trigger_type text,
  p_trigger_reason text,
  p_verdict text,
  p_thesis_status text,
  p_confidence integer,
  p_alpha_reasoning text,
  p_user_message text,
  p_urgency text,
  p_current_price numeric,
  p_r_multiple numeric,
  p_drawdown_percent numeric,
  p_minutes_in_trade numeric,
  p_model_used text,
  p_tokens_used integer,
  p_should_notify boolean,
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
    alpha_recheck_verdict = jsonb_build_object(
      'verdict',        p_verdict,
      'thesis_status',  p_thesis_status,
      'confidence',     p_confidence,
      'alpha_reasoning',p_alpha_reasoning,
      'user_message',   p_user_message,
      'urgency',        p_urgency,
      'trigger_type',   p_trigger_type,
      'checked_at',     now()::text,
      'should_notify',  p_should_notify
    ),
    thesis_status         = p_thesis_status,
    last_alpha_recheck_at = now(),
    alpha_recheck_trigger = p_trigger_type,
    alpha_recheck_count   = COALESCE(alpha_recheck_count, 0) + 1
  WHERE id = p_trade_id
    AND status = 'open';

  INSERT INTO mid_trade_escalation_log (
    trade_id, user_id, goal_session_id,
    trigger_type, trigger_reason,
    verdict, thesis_status, confidence,
    alpha_reasoning, user_message, urgency,
    current_price, r_multiple, drawdown_percent, minutes_in_trade,
    model_used, tokens_used,
    thesis_status_before, thesis_status_after,
    should_notify
  ) VALUES (
    p_trade_id, p_user_id, p_goal_session_id,
    p_trigger_type, p_trigger_reason,
    p_verdict, p_thesis_status, p_confidence,
    p_alpha_reasoning, p_user_message, p_urgency,
    p_current_price, p_r_multiple, p_drawdown_percent, p_minutes_in_trade,
    p_model_used, p_tokens_used,
    p_thesis_status_before, p_thesis_status,
    p_should_notify
  )
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'success',       true,
    'log_id',        v_log_id,
    'trade_updated', true
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error',   SQLERRM
  );
END;
$$;

GRANT EXECUTE ON FUNCTION persist_alpha_recheck_verdict(
  uuid, uuid, uuid, text, text, text, text, integer,
  text, text, text, numeric, numeric, numeric, numeric,
  text, integer, boolean, text
) TO authenticated, service_role;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
