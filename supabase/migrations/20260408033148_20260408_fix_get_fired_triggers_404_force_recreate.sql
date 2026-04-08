/*
  # Force recreate get_fired_triggers_for_trade to resolve persistent PostgREST 404

  ## Problem
  PostgREST returns 404 for `get_fired_triggers_for_trade` despite the function existing in
  the database and EXECUTE grants being present. The NOTIFY approach does not always flush
  the PostgREST function registry — a DROP + CREATE forces a clean re-registration.

  ## Changes
  1. Drop and recreate `get_fired_triggers_for_trade` with identical logic.
  2. Drop and recreate `record_trigger_fired` with identical logic (defensive, same issue class).
  3. Re-grant EXECUTE to authenticated and anon roles.
  4. Issue NOTIFY to flush PostgREST cache.

  ## Security
  - Both functions remain SECURITY DEFINER with search_path locked to public.
  - No logic changes — pure infrastructure fix.
*/

DROP FUNCTION IF EXISTS public.get_fired_triggers_for_trade(uuid);
DROP FUNCTION IF EXISTS public.record_trigger_fired(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.get_fired_triggers_for_trade(p_trade_id uuid)
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

CREATE OR REPLACE FUNCTION public.record_trigger_fired(
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
