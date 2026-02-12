/*
  # Emergency Fix: ssot_violations Schema Alignment

  1. Problem
    - Multiple trigger functions INSERT into ssot_violations using columns that don't exist
    - This causes `close_goal_session_trade` RPC to fail with:
      `column "table_name" of relation "ssot_violations" does not exist`
    - ALL trade closures (manual and automatic) are blocked

  2. Root Cause
    - The ssot_violations table was rebuilt with different columns than what trigger functions expect
    - At least 4 functions reference non-existent columns

  3. Fix
    - Add ALL missing columns referenced by any trigger function
    - Columns are nullable so existing data is unaffected
    - This is additive-only - no data loss

  4. Affected Functions
    - enforce_trade_closure_ssot() - uses table_name, record_id, field_name, expected_value, actual_value, auto_corrected
    - alert_on_trigger_governance_violation() - uses entity_type, entity_id, expected_authority, actual_authority, details
    - validate_alpha_thought_step_type() - uses system_component, details
    - enforce_tp1_tp2_session_lifecycle() - uses details, detected_at
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ssot_violations' AND column_name = 'table_name') THEN
    ALTER TABLE ssot_violations ADD COLUMN table_name text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ssot_violations' AND column_name = 'record_id') THEN
    ALTER TABLE ssot_violations ADD COLUMN record_id uuid;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ssot_violations' AND column_name = 'field_name') THEN
    ALTER TABLE ssot_violations ADD COLUMN field_name text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ssot_violations' AND column_name = 'expected_value') THEN
    ALTER TABLE ssot_violations ADD COLUMN expected_value text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ssot_violations' AND column_name = 'actual_value') THEN
    ALTER TABLE ssot_violations ADD COLUMN actual_value text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ssot_violations' AND column_name = 'auto_corrected') THEN
    ALTER TABLE ssot_violations ADD COLUMN auto_corrected boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ssot_violations' AND column_name = 'entity_type') THEN
    ALTER TABLE ssot_violations ADD COLUMN entity_type text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ssot_violations' AND column_name = 'entity_id') THEN
    ALTER TABLE ssot_violations ADD COLUMN entity_id uuid;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ssot_violations' AND column_name = 'expected_authority') THEN
    ALTER TABLE ssot_violations ADD COLUMN expected_authority text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ssot_violations' AND column_name = 'actual_authority') THEN
    ALTER TABLE ssot_violations ADD COLUMN actual_authority text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ssot_violations' AND column_name = 'details') THEN
    ALTER TABLE ssot_violations ADD COLUMN details jsonb;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ssot_violations' AND column_name = 'detected_at') THEN
    ALTER TABLE ssot_violations ADD COLUMN detected_at timestamptz;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ssot_violations' AND column_name = 'system_component') THEN
    ALTER TABLE ssot_violations ADD COLUMN system_component text;
  END IF;
END $$;
