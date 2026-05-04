/*
  # CCIP-2026-0504D — Force PostgREST Schema Reload for Mid-Trade RPCs

  Problem
  -------
  Client was seeing PGRST202 404s for three RPCs even though they exist in the DB:
    - get_fired_triggers_for_trade(p_trade_id uuid)
    - record_trigger_fired(p_trade_id uuid, p_user_id uuid, p_trigger_type text)
    - persist_alpha_recheck_verdict(... 19 params ...)

  Root cause
  ----------
  PostgREST schema cache drift — the deployed functions are correct but the
  cached schema used by PostgREST does not advertise them, causing 404
  PGRST202 errors with signature-mismatch hints.

  Fix
  ---
  Re-grant EXECUTE to authenticated/service_role (idempotent), verify
  comments exist, and issue NOTIFY pgrst, 'reload schema' to force
  PostgREST to flush and re-introspect. No behavior changes.
*/

-- Re-grant execute permissions (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_fired_triggers_for_trade') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_fired_triggers_for_trade(uuid) TO authenticated, service_role';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'record_trigger_fired') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.record_trigger_fired(uuid, uuid, text) TO authenticated, service_role';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'persist_alpha_recheck_verdict') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.persist_alpha_recheck_verdict(uuid, uuid, uuid, text, text, text, text, integer, text, text, text, numeric, numeric, numeric, numeric, text, integer, boolean, text) TO authenticated, service_role';
  END IF;
END $$;

-- Force PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
