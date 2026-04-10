/*
  # Fix get_fired_triggers_for_trade and record_trigger_fired RPC Grants

  ## Problem
  PostgREST returns 404 for both RPCs because only PUBLIC has EXECUTE — PostgREST
  requires explicit grants to named roles (authenticated, anon, service_role).

  ## Changes
  1. DROP CASCADE both functions to clear any stale overload conflicts in the catalog
  2. Recreate both functions with SECURITY DEFINER and search_path = public
  3. Grant EXECUTE explicitly to authenticated, anon, and service_role
  4. Double NOTIFY to flush PostgREST schema and config cache
*/

DROP FUNCTION IF EXISTS public.get_fired_triggers_for_trade(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.record_trigger_fired(uuid, uuid, text) CASCADE;

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

GRANT EXECUTE ON FUNCTION public.get_fired_triggers_for_trade(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_fired_triggers_for_trade(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_fired_triggers_for_trade(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.record_trigger_fired(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_trigger_fired(uuid, uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.record_trigger_fired(uuid, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
