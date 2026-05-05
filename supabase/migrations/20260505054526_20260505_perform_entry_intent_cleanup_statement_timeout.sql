/*
  # CCIP-2026-0505B — Add statement_timeout to perform_entry_intent_cleanup

  1. Problem
    - Client calls to `perform_entry_intent_cleanup` were timing out at 15000ms
      (observed 18789ms) during boot-time cold starts.
    - The RPC sequentially invokes three cleanup functions
      (cleanup_expired_entry_intents, cleanup_orphaned_entry_intents,
      cleanup_intents_without_session). Without a server-side bound, a slow
      scan can hold the connection well past the client's abort deadline,
      leaving partial work uncommitted and emitting noisy abort errors.

  2. Change
    - Add `SET LOCAL statement_timeout = '10s'` inside the function body so the
      aggregate cleanup is bounded at the database layer and fails fast with a
      clean Postgres timeout rather than a transport abort.
    - Function body and return shape are otherwise unchanged — SSOT behaviour
      preserved.

  3. Security
    - No RLS changes. Function remains SECURITY DEFINER with pinned
      search_path = 'public'.
*/

CREATE OR REPLACE FUNCTION public.perform_entry_intent_cleanup(
  p_user_id uuid,
  p_ccip_change_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_expired jsonb;
  v_orphaned jsonb;
  v_no_session jsonb;
  v_start_time timestamptz;
  v_total_cleaned int;
  v_duration int;
BEGIN
  -- CCIP-2026-0505B: Bound aggregate cleanup at the database layer so we fail
  -- fast with a clean Postgres timeout instead of a client-side transport abort.
  SET LOCAL statement_timeout = '10s';

  v_start_time := now();
  v_total_cleaned := 0;

  -- Execute all three cleanup operations in sequence
  v_expired := cleanup_expired_entry_intents(p_user_id, p_ccip_change_id);
  v_orphaned := cleanup_orphaned_entry_intents(p_user_id, p_ccip_change_id);
  v_no_session := cleanup_intents_without_session(p_user_id, p_ccip_change_id);

  -- Aggregate results
  IF (v_expired->>'success')::boolean THEN
    v_total_cleaned := v_total_cleaned + (v_expired->>'intents_cleaned')::int;
  END IF;
  IF (v_orphaned->>'success')::boolean THEN
    v_total_cleaned := v_total_cleaned + (v_orphaned->>'intents_cleaned')::int;
  END IF;
  IF (v_no_session->>'success')::boolean THEN
    v_total_cleaned := v_total_cleaned + (v_no_session->>'intents_cleaned')::int;
  END IF;

  v_duration := EXTRACT(EPOCH FROM (now() - v_start_time))::int * 1000;

  -- Log aggregated cleanup operation
  INSERT INTO entry_intent_cleanup_audit (
    user_id, operation_type, intents_affected, reason, duration_ms, status, ccip_change_id
  ) VALUES (
    p_user_id, 'full_cleanup', v_total_cleaned, 'Complete cleanup cycle', v_duration, 'success', p_ccip_change_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'total_intents_cleaned', v_total_cleaned,
    'total_duration_ms', v_duration,
    'operations', jsonb_build_object(
      'expired', v_expired,
      'orphaned', v_orphaned,
      'no_session', v_no_session
    )
  );
END;
$function$;
