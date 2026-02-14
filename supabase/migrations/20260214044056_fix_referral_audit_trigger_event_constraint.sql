/*
  # Add commission_paid to referral_state_audit trigger events

  ## Problem
  The `referral_state_audit.trigger_event` CHECK constraint only allows:
  signup, purchase, manual, fraud_detection, cancellation.
  The commission payment needs to log 'commission_paid' as a trigger event.

  ## Fix
  - Add 'commission_paid' to the allowed trigger events
  - Also add 'upgrade' for future upgrade tracking
*/

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'referral_state_audit'::regclass
    AND conname = 'valid_trigger_event'
  ) THEN
    ALTER TABLE referral_state_audit DROP CONSTRAINT valid_trigger_event;
  END IF;
END $$;

ALTER TABLE referral_state_audit ADD CONSTRAINT valid_trigger_event
  CHECK (trigger_event = ANY(ARRAY[
    'signup', 'purchase', 'manual', 'fraud_detection',
    'cancellation', 'commission_paid', 'upgrade'
  ]));
