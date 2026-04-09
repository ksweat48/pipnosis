/*
  # CCIP-2026-0409B: Fix get_fired_triggers_for_trade PostgREST 404

  ## Problem
  PostgREST returns 404 for `get_fired_triggers_for_trade` despite the function
  existing in the database. The routine_privileges table shows only PUBLIC has
  EXECUTE — PostgREST requires explicit grants to named roles (authenticated,
  anon, service_role) to expose functions via the REST API.

  ## Changes
  1. DROP CASCADE both related functions to clear any stale overloads from catalog
  2. Recreate `get_fired_triggers_for_trade(uuid)` cleanly with SECURITY DEFINER
  3. Recreate `record_trigger_fired(uuid, uuid, text)` cleanly with SECURITY DEFINER
  4. Grant EXECUTE to authenticated, anon, and service_role explicitly (not just PUBLIC)
  5. Double NOTIFY to flush PostgREST schema and config cache

  ## Tables Modified
  - None (mid_trade_trigger_fired table already exists and is unchanged)

  ## Security
  - Both functions use SECURITY DEFINER with locked search_path = public
  - Grants are role-specific, not just PUBLIC

  ## Root Cause
  Prior fixes (migrations 20260402, 20260408 x2) granted only to PUBLIC or the
  NOTIFY did not flush the PostgREST cache before the next request arrived.
  This migration uses DROP CASCADE to eliminate catalog ambiguity and grants
  to all three named roles that PostgREST checks.
*/

-- Step 1: Drop both functions with CASCADE to eliminate any overload conflicts
DROP FUNCTION IF EXISTS public.get_fired_triggers_for_trade(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.record_trigger_fired(uuid, uuid, text) CASCADE;

-- Step 2: Recreate get_fired_triggers_for_trade
CREATE FUNCTION public.get_fired_triggers_for_trade(p_trade_id uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result text[];
BEGIN
  SELECT ARRAY_AGG(trigger_type)
  INTO v_result
  FROM mid_trade_trigger_fired
  WHERE trade_id = p_trade_id;

  RETURN COALESCE(v_result, ARRAY[]::text[]);
END;
$$;

-- Step 3: Recreate record_trigger_fired
CREATE FUNCTION public.record_trigger_fired(
  p_trade_id    uuid,
  p_user_id     uuid,
  p_trigger_type text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO mid_trade_trigger_fired (trade_id, user_id, trigger_type)
  VALUES (p_trade_id, p_user_id, p_trigger_type)
  ON CONFLICT (trade_id, trigger_type) DO NOTHING;
END;
$$;

-- Step 4: Grant EXECUTE to all named roles PostgREST checks
GRANT EXECUTE ON FUNCTION public.get_fired_triggers_for_trade(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_fired_triggers_for_trade(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_fired_triggers_for_trade(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.record_trigger_fired(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_trigger_fired(uuid, uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.record_trigger_fired(uuid, uuid, text) TO service_role;

-- Step 5: Flush PostgREST schema and config cache
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
