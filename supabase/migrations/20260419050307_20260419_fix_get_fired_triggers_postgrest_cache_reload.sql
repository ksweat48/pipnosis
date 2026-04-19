/*
  # Fix get_fired_triggers_for_trade PostgREST 404

  ## Problem
  PostgREST schema cache does not expose the function `get_fired_triggers_for_trade`
  despite it existing in the database with the correct signature. This causes a 404
  from the REST API layer and the error:
  "Could not find the function public.get_fired_triggers_for_trade without parameters
  in the schema cache"

  ## Fix
  DROP + CREATE forces a new function OID, which guarantees PostgREST picks it up
  on the next schema reload. Re-apply grants and issue NOTIFY to flush the cache.

  ## Changes
  - Drops and recreates `get_fired_triggers_for_trade(p_trade_id uuid)` with identical logic
  - Grants EXECUTE to authenticated, anon, and service_role
  - Issues NOTIFY pgrst reload for both schema and config caches
*/

DROP FUNCTION IF EXISTS public.get_fired_triggers_for_trade(uuid);

CREATE OR REPLACE FUNCTION public.get_fired_triggers_for_trade(p_trade_id uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_triggers text[];
BEGIN
  SELECT ARRAY_AGG(trigger_type)
  INTO v_triggers
  FROM mid_trade_trigger_fired
  WHERE trade_id = p_trade_id;

  RETURN COALESCE(v_triggers, ARRAY[]::text[]);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_fired_triggers_for_trade(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_fired_triggers_for_trade(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_fired_triggers_for_trade(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
