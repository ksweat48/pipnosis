/*
  # Fix record_trigger_fired PostgREST 404

  ## Problem
  The `record_trigger_fired` RPC returns 404 from the PostgREST REST layer despite the function
  existing in the database with correct EXECUTE grants. This is a PostgREST schema cache staleness
  issue — the function was dropped and recreated in migration 20260331222913, and PostgREST has not
  refreshed its internal function registry.

  ## Changes
  1. Re-grants EXECUTE on `record_trigger_fired` and `get_fired_triggers_for_trade` to both
     `authenticated` and `anon` roles explicitly (idempotent, safe to repeat).
  2. Issues `NOTIFY pgrst, 'reload schema'` to force PostgREST to refresh its schema cache
     immediately, resolving the 404 without requiring a service restart.

  ## Security
  - No schema changes — only privilege re-grants and cache reload.
  - Both functions are SECURITY DEFINER, so they execute with the owner's privileges regardless
    of caller role. The EXECUTE grant only controls whether the caller can invoke the function.
  - `record_trigger_fired` inserts into `mid_trade_trigger_fired` which has its own RLS.

  ## SSOT / CCIP Compliance
  - Ownership: mid-trade escalation engine owns trigger persistence.
  - No duplicate logic introduced — this is a pure infrastructure fix.
  - Post-deploy verification: call `GET /rest/v1/rpc/record_trigger_fired` — should return 400
    (missing params) rather than 404.
*/

GRANT EXECUTE ON FUNCTION public.record_trigger_fired(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_trigger_fired(uuid, uuid, text) TO anon;

GRANT EXECUTE ON FUNCTION public.get_fired_triggers_for_trade(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_fired_triggers_for_trade(uuid) TO anon;

NOTIFY pgrst, 'reload schema';
