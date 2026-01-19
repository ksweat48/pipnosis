/*
  ═══════════════════════════════════════════════════════════════════════════
  Add 'expired_no_entry' Status to Entry Intent Status Enum
  ═══════════════════════════════════════════════════════════════════════════

  ## Problem
  Autonomous entry monitor needs to mark intents as 'expired_no_entry' when:
  - Max wait time exceeded (Phase 3 timeout)
  - Price never reached entry zone
  - Intent abandoned automatically by server

  This is different from 'timeout' (user-defined timeout) or 'canceled' (manual).

  ## Solution
  Add new status value to entry_intent_status enum.

  CCIP Compliance:
  - Trades degrade intelligently - they do not silently hang
  - System auto-abandons expired intents and resets state
  - Clear distinction between different abandonment reasons

  ═══════════════════════════════════════════════════════════════════════════
*/

-- Add new status value to entry_intent_status enum
-- Note: PostgreSQL doesn't allow adding to enum in a transaction, so we use ALTER TYPE
DO $$
BEGIN
  -- Check if value already exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'entry_intent_status'::regtype
    AND enumlabel = 'expired_no_entry'
  ) THEN
    ALTER TYPE entry_intent_status ADD VALUE 'expired_no_entry';
    RAISE NOTICE '✅ Added expired_no_entry to entry_intent_status enum';
  ELSE
    RAISE NOTICE 'ℹ️ expired_no_entry already exists in entry_intent_status enum';
  END IF;
END $$;

-- Update documentation comment
COMMENT ON TYPE entry_intent_status IS
'Entry intent lifecycle status:
- monitoring: Active monitoring for entry conditions
- executed: Successfully entered trade
- timeout: User-defined timeout reached
- canceled: Manually canceled by user or system
- conditions_changed: Market conditions invalidated intent
- expired_no_entry: Max wait exceeded, price never reached zone (auto-abandoned)';

-- Validation
DO $$
DECLARE
  enum_values text[];
BEGIN
  SELECT array_agg(enumlabel::text ORDER BY enumsortorder)
  INTO enum_values
  FROM pg_enum
  WHERE enumtypid = 'entry_intent_status'::regtype;

  IF 'expired_no_entry' = ANY(enum_values) THEN
    RAISE NOTICE '✅ Validation passed: expired_no_entry status available';
    RAISE NOTICE 'ℹ️ Current enum values: %', array_to_string(enum_values, ', ');
  ELSE
    RAISE EXCEPTION 'Validation failed: expired_no_entry not found in enum';
  END IF;
END $$;