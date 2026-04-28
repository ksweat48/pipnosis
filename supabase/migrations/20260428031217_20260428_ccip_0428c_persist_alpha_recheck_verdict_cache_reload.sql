/*
  # CCIP-2026-0428C — Reload PostgREST schema cache for persist_alpha_recheck_verdict

  ## Diagnosis (live database, 2026-04-28)
  - `persist_alpha_recheck_verdict` exists with the exact 19-param signature the
    client sends (verified via `pg_proc`).
  - `authenticated` and `service_role` both hold `EXECUTE` (verified via
    `information_schema.role_routine_grants`).
  - Client still receives `PGRST202 / 404`. The only remaining cause is a stale
    PostgREST schema cache.

  ## Fix
  1. `NOTIFY pgrst, 'reload schema'` to force an immediate cache refresh.
  2. Re-assert the EXECUTE grants idempotently so any silent privilege drift
     since CCIP-2026-0427J is corrected.
  3. Re-issue the COMMENT contract so any future `CREATE OR REPLACE` author
     sees the grants requirement before stripping it.

  ## Why this is not yet another "force reload" migration
  Prior migrations were chasing the wrong cause (recreating the function body
  every time). This one ships ONLY the cache reload — no DDL on the function
  body — because the diagnostic confirmed the body and grants are already
  correct. Recreating the function would only risk re-introducing the grant
  drift those prior migrations caused.

  ## Architectural Follow-Up
  The recurring 404s on this RPC are a structural problem: every `CREATE OR
  REPLACE` of the function silently strips grants. CCIP-2026-0427J added the
  COMMENT contract; this migration re-affirms it. A future migration should
  add a CI assertion that fails any commit which redefines this function
  without re-applying the grants block.

  ## Security
  - No new tables, no new functions, no policy changes.
  - Privileges are tightened (anon, public revoked) AND functional
    (authenticated, service_role granted).
*/

-- 1. Re-assert grants idempotently (no-op if already correct).
REVOKE EXECUTE ON FUNCTION public.persist_alpha_recheck_verdict(
  uuid, uuid, uuid, text, text, text, text, integer, text, text, text,
  numeric, numeric, numeric, numeric, text, integer, boolean, text
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.persist_alpha_recheck_verdict(
  uuid, uuid, uuid, text, text, text, text, integer, text, text, text,
  numeric, numeric, numeric, numeric, text, integer, boolean, text
) FROM anon;

GRANT EXECUTE ON FUNCTION public.persist_alpha_recheck_verdict(
  uuid, uuid, uuid, text, text, text, text, integer, text, text, text,
  numeric, numeric, numeric, numeric, text, integer, boolean, text
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.persist_alpha_recheck_verdict(
  uuid, uuid, uuid, text, text, text, text, integer, text, text, text,
  numeric, numeric, numeric, numeric, text, integer, boolean, text
) TO service_role;

-- 2. Re-issue the contract COMMENT.
COMMENT ON FUNCTION public.persist_alpha_recheck_verdict(
  uuid, uuid, uuid, text, text, text, text, integer, text, text, text,
  numeric, numeric, numeric, numeric, text, integer, boolean, text
) IS
  'CCIP-2026-0427J / CCIP-2026-0428C: EXECUTE granted to authenticated + service_role. Any future CREATE OR REPLACE MUST re-apply the grants block at the bottom of this function file or PostgREST will 404.';

-- 3. Post-state assertion — fail fast if grants are not in place.
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM information_schema.role_routine_grants
  WHERE routine_schema = 'public'
    AND routine_name = 'persist_alpha_recheck_verdict'
    AND grantee = 'authenticated'
    AND privilege_type = 'EXECUTE';

  IF v_count < 1 THEN
    RAISE EXCEPTION
      'CCIP-2026-0428C post-state assertion FAILED: persist_alpha_recheck_verdict missing EXECUTE for authenticated.';
  END IF;
END $$;

-- 4. Force PostgREST to refresh its schema cache immediately.
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst;
