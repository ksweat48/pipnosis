/*
  # Seed Initial PIP Utility Index Entry

  1. Purpose
    - The PIP Utility Index history table has zero rows, causing the admin
      Club > PIP Utility Index tab to render a blank page
    - Seeds one baseline entry so the UI can display current values
    - Uses the base_utility_value from pip_utility_index_state as the
      initial display value

  2. Changes
    - Inserts a single baseline row into `pip_utility_index_history`
    - Updates `pip_utility_index_state.last_computed_date` to today

  3. SSOT Compliance
    - pip_utility_index_engine remains the single authority for future computations
    - This is a one-time seed for initial state only
    - No business logic duplicated; values derived from existing state table

  4. Important Notes
    - Uses ON CONFLICT to be idempotent (safe to re-run)
    - Sets smoothed_index to previous_smoothed_index from state
    - Sets display_value_usd = base_utility_value * smoothed_index
*/

DO $$
DECLARE
  v_state RECORD;
  v_today DATE := CURRENT_DATE;
  v_display_value NUMERIC;
BEGIN
  SELECT * INTO v_state
  FROM pip_utility_index_state
  WHERE id = 1;

  IF v_state IS NULL THEN
    RAISE NOTICE 'No pip_utility_index_state found, skipping seed';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM pip_utility_index_history LIMIT 1) THEN
    RAISE NOTICE 'pip_utility_index_history already has data, skipping seed';
    RETURN;
  END IF;

  v_display_value := v_state.base_utility_value * v_state.previous_smoothed_index;

  INSERT INTO pip_utility_index_history (
    date,
    credits_spent_30d,
    pip_burned_30d,
    staked_ratio,
    active_users_30d,
    liquid_supply_ratio,
    raw_index,
    smoothed_index,
    display_value_usd,
    computation_metadata
  ) VALUES (
    v_today,
    0,
    0,
    0,
    0,
    1.0,
    v_state.previous_smoothed_index,
    v_state.previous_smoothed_index,
    v_display_value,
    jsonb_build_object(
      'seed', true,
      'reason', 'Initial baseline seed for admin dashboard display',
      'base_utility_value', v_state.base_utility_value,
      'previous_smoothed_index', v_state.previous_smoothed_index
    )
  );

  UPDATE pip_utility_index_state
  SET last_computed_date = v_today,
      updated_at = NOW()
  WHERE id = 1;

  RAISE NOTICE 'Seeded initial PIP Utility Index entry: date=%, display_value=%', v_today, v_display_value;
END $$;
