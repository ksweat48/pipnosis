/*
  # Remove Risk Percentage Caps - Users Control Their Own Risk

  1. Changes
    - Relax CHECK constraint on `user_max_risk_preferences.max_risk_percent` from 1-10% to 1-100%
    - Update `update_user_max_risk_preference` RPC to allow 1-100% range
    - Users now have full control over their risk per trade

  2. Rationale
    - Pipnosis does not impose risk limits on users
    - Users are responsible for their own risk management decisions
    - Advisory warnings remain in the UI but no hard blocks

  3. Security
    - No RLS changes
    - Constraint still prevents invalid values (0% or negative)
*/

-- Step 1: Drop and recreate CHECK constraint with wider range
ALTER TABLE user_max_risk_preferences
  DROP CONSTRAINT IF EXISTS user_max_risk_preferences_max_risk_percent_check;

ALTER TABLE user_max_risk_preferences
  ADD CONSTRAINT user_max_risk_preferences_max_risk_percent_check
  CHECK (max_risk_percent >= 1 AND max_risk_percent <= 100);

-- Step 2: Update RPC to allow 1-100% range
CREATE OR REPLACE FUNCTION update_user_max_risk_preference(p_user_id uuid, p_percent numeric)
RETURNS jsonb AS $$
DECLARE
  v_old_percent numeric;
  v_result jsonb;
BEGIN
  IF p_percent < 1.0 OR p_percent > 100.0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Risk percent must be between 1% and 100%'
    );
  END IF;

  SELECT max_risk_percent INTO v_old_percent
  FROM user_max_risk_preferences
  WHERE user_id = p_user_id;

  IF v_old_percent IS NULL THEN
    INSERT INTO user_max_risk_preferences (user_id, max_risk_percent)
    VALUES (p_user_id, p_percent);
  ELSE
    UPDATE user_max_risk_preferences
    SET max_risk_percent = p_percent
    WHERE user_id = p_user_id;
  END IF;

  v_result := jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'old_max_risk_percent', v_old_percent,
    'new_max_risk_percent', p_percent,
    'updated_at', now()
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;