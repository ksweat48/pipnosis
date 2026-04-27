/*
  # CCIP-2026-0427J — Restore EXECUTE grants on mid-trade escalation RPCs

  ## Root Cause
  The three RPCs that mid-trade-escalation-engine.ts calls all returned PostgREST
  404 / PGRST202 in production:
    - get_fired_triggers_for_trade(p_trade_id uuid)
    - record_trigger_fired(p_trade_id uuid, p_user_id uuid, p_trigger_type text)
    - persist_alpha_recheck_verdict(... 19 params ...)

  Direct inspection of pg_proc shows all three exist with the exact signatures
  the client sends. Inspection of role_routine_grants shows ZERO EXECUTE grants
  on any role for any of the three. PostgREST hides functions from a caller that
  lacks EXECUTE and reports them as "not found in schema cache" — the symptom we
  saw, repeatedly mis-diagnosed across ~10 prior "force schema reload" migrations.

  Prior CREATE OR REPLACE migrations rewrote the functions without re-applying
  GRANT EXECUTE, which silently stripped privileges every time.

  ## Fix
  1. GRANT EXECUTE on all three functions to `authenticated` and `service_role`.
  2. REVOKE EXECUTE from `public` and `anon` — least privilege; these RPCs are
     trade-scoped and require an authenticated user.
  3. Tag every function with a COMMENT linking back to this CCIP so any future
     CREATE OR REPLACE author sees the grants contract before stripping it.
  4. Assert the post-state: if any of the three functions ends up without
     EXECUTE for `authenticated`, fail this migration. Silent privilege drift
     is no longer possible to ship.
  5. NOTIFY pgrst to reload its schema cache immediately, instead of waiting
     for the periodic refresh.

  ## Security
  - No new tables, no new functions, no policy changes.
  - Privileges are tightened (anon, public revoked) AND made functional
    (authenticated, service_role granted).
  - SECURITY DEFINER bodies are unchanged — RLS continues to apply via the
    function bodies.
*/

-- Use full identity arguments to disambiguate from any leftover overloads
-- and ensure we hit the canonical signature shipped to the client.

-- 1. get_fired_triggers_for_trade(p_trade_id uuid)
REVOKE EXECUTE ON FUNCTION public.get_fired_triggers_for_trade(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_fired_triggers_for_trade(uuid) FROM anon;
GRANT EXECUTE  ON FUNCTION public.get_fired_triggers_for_trade(uuid) TO authenticated;
GRANT EXECUTE  ON FUNCTION public.get_fired_triggers_for_trade(uuid) TO service_role;

COMMENT ON FUNCTION public.get_fired_triggers_for_trade(uuid) IS
  'CCIP-2026-0427J: EXECUTE granted to authenticated + service_role. Any future CREATE OR REPLACE MUST re-apply the grants block at the bottom of this function file or PostgREST will 404.';

-- 2. record_trigger_fired(p_trade_id uuid, p_user_id uuid, p_trigger_type text)
REVOKE EXECUTE ON FUNCTION public.record_trigger_fired(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_trigger_fired(uuid, uuid, text) FROM anon;
GRANT EXECUTE  ON FUNCTION public.record_trigger_fired(uuid, uuid, text) TO authenticated;
GRANT EXECUTE  ON FUNCTION public.record_trigger_fired(uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public.record_trigger_fired(uuid, uuid, text) IS
  'CCIP-2026-0427J: EXECUTE granted to authenticated + service_role. Any future CREATE OR REPLACE MUST re-apply the grants block.';

-- 3. persist_alpha_recheck_verdict(... 19 params ...)
REVOKE EXECUTE ON FUNCTION public.persist_alpha_recheck_verdict(
  uuid, uuid, uuid, text, text, text, text, integer, text, text, text,
  numeric, numeric, numeric, numeric, text, integer, boolean, text
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.persist_alpha_recheck_verdict(
  uuid, uuid, uuid, text, text, text, text, integer, text, text, text,
  numeric, numeric, numeric, numeric, text, integer, boolean, text
) FROM anon;
GRANT EXECUTE  ON FUNCTION public.persist_alpha_recheck_verdict(
  uuid, uuid, uuid, text, text, text, text, integer, text, text, text,
  numeric, numeric, numeric, numeric, text, integer, boolean, text
) TO authenticated;
GRANT EXECUTE  ON FUNCTION public.persist_alpha_recheck_verdict(
  uuid, uuid, uuid, text, text, text, text, integer, text, text, text,
  numeric, numeric, numeric, numeric, text, integer, boolean, text
) TO service_role;

COMMENT ON FUNCTION public.persist_alpha_recheck_verdict(
  uuid, uuid, uuid, text, text, text, text, integer, text, text, text,
  numeric, numeric, numeric, numeric, text, integer, boolean, text
) IS
  'CCIP-2026-0427J: EXECUTE granted to authenticated + service_role. Any future CREATE OR REPLACE MUST re-apply the grants block.';

-- 4. Post-state assertion: fail the migration if grants did not stick.
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM information_schema.role_routine_grants
  WHERE routine_schema = 'public'
    AND grantee = 'authenticated'
    AND privilege_type = 'EXECUTE'
    AND routine_name IN (
      'get_fired_triggers_for_trade',
      'record_trigger_fired',
      'persist_alpha_recheck_verdict'
    );

  IF v_count < 3 THEN
    RAISE EXCEPTION
      'CCIP-2026-0427J post-state assertion FAILED: expected 3 EXECUTE grants for authenticated, found %. Grants did not stick.',
      v_count;
  END IF;
END $$;

-- 5. Force PostgREST to refresh its schema cache so the new grants are visible
-- without waiting on the periodic reload.
NOTIFY pgrst, 'reload schema';
