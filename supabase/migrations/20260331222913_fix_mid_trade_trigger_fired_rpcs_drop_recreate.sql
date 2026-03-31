/*
  # Fix mid-trade trigger fired RPCs — drop and recreate with correct signatures

  Previous version had a signature conflict. Drop existing functions first,
  then recreate table (if not exists) and both RPCs cleanly.
*/

DROP FUNCTION IF EXISTS record_trigger_fired(uuid, uuid, text);
DROP FUNCTION IF EXISTS get_fired_triggers_for_trade(uuid);

CREATE TABLE IF NOT EXISTS mid_trade_trigger_fired (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id     uuid NOT NULL,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trigger_type text NOT NULL,
  fired_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trade_id, trigger_type)
);

ALTER TABLE mid_trade_trigger_fired ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mid_trade_trigger_fired'
    AND policyname = 'Users can select own trigger fired rows'
  ) THEN
    CREATE POLICY "Users can select own trigger fired rows"
      ON mid_trade_trigger_fired FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mid_trade_trigger_fired'
    AND policyname = 'Users can insert own trigger fired rows'
  ) THEN
    CREATE POLICY "Users can insert own trigger fired rows"
      ON mid_trade_trigger_fired FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE FUNCTION record_trigger_fired(
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

CREATE FUNCTION get_fired_triggers_for_trade(
  p_trade_id uuid
)
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
