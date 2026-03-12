/*
  # Create cancel_session_intents RPC (drop-and-recreate)

  ## Summary
  Recreates the cancel_session_intents RPC with correct return type (jsonb).
  The existing function had a different return type; this migration drops and
  recreates it.

  ## Changes
  - DROP existing cancel_session_intents if it exists (any signature)
  - CREATE new function returning jsonb with canceled_count
*/

DO $$
BEGIN
  DROP FUNCTION IF EXISTS cancel_session_intents(uuid);
  DROP FUNCTION IF EXISTS cancel_session_intents(p_session_id uuid);
END $$;

CREATE OR REPLACE FUNCTION cancel_session_intents(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canceled_count int;
BEGIN
  UPDATE entry_intents
  SET
    status = 'canceled',
    conditions_changed_at = now()
  WHERE
    session_id = p_session_id
    AND status IN ('monitoring', 'pending_entry');

  GET DIAGNOSTICS v_canceled_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'canceled_count', v_canceled_count
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_session_intents(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_session_intents(uuid) TO service_role;
