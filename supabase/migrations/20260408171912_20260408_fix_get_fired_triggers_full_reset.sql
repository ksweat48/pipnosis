/*
  # Full reset of get_fired_triggers_for_trade and record_trigger_fired

  ## Problem
  PostgREST returns 404 for get_fired_triggers_for_trade despite prior DROP+CREATE
  migrations. The function registry is still stale.

  ## Fix
  1. Drop both functions with CASCADE to remove any lingering stale registrations.
  2. Recreate with SECURITY DEFINER and locked search_path.
  3. Re-grant EXECUTE to all roles.
  4. Issue NOTIFY twice to ensure PostgREST flushes both the function registry
     and the schema cache.
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
  p_trade_id uuid,
  p_user_id uuid,
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
