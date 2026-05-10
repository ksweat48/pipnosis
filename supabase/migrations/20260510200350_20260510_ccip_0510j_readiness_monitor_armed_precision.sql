/*
  # Readiness Monitor Precision Upgrade (CCIP-2026-0510J)

  Transforms alpha_hunt_readiness from a two-tier (live/ready/not_ready) advisory
  into a binary (armed/not_ready) high-precision confirmed-trigger signal.

  ## Changes
  1. New columns (all nullable to preserve existing rows):
     - trigger_archetype: canonical name of confirmed trigger
     - invalidation_price: internal arming-logic structural invalidation level
     - invalidation_distance_atr: distance in ATRs (internal metric for PC6)
     - reward_room_atr: available room toward next structure (internal PC7)
     - adversarial_clear: cross-verified with adversarial detector
     - regime_match: trigger matches current regime
     - sensor_evidence: jsonb of corroborating sensor outputs
     - armed_at: timestamp when armed state was entered
  2. Replace hunt_state constraint to include 'armed' (keep 'not_ready')
  3. Replace trigger_state constraint to include new archetype states
  4. Add index for armed-state lookups

  ## Notes

  1. Invalidation and reward room columns are INTERNAL arming metrics only.
     They are NEVER injected into Alpha's prompt or shown in user UI.
     Alpha owns SL/TP sovereignty per CCIP-0328B.
  2. 'live' and 'ready' remain valid temporarily so existing rows do not break
     the constraint; new scanner writes only 'armed' or 'not_ready'.
  3. 'developing' remains valid for trigger_state for legacy rows.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'alpha_hunt_readiness' AND column_name = 'trigger_archetype') THEN
    ALTER TABLE alpha_hunt_readiness ADD COLUMN trigger_archetype text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'alpha_hunt_readiness' AND column_name = 'invalidation_price') THEN
    ALTER TABLE alpha_hunt_readiness ADD COLUMN invalidation_price numeric;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'alpha_hunt_readiness' AND column_name = 'invalidation_distance_atr') THEN
    ALTER TABLE alpha_hunt_readiness ADD COLUMN invalidation_distance_atr numeric;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'alpha_hunt_readiness' AND column_name = 'reward_room_atr') THEN
    ALTER TABLE alpha_hunt_readiness ADD COLUMN reward_room_atr numeric;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'alpha_hunt_readiness' AND column_name = 'adversarial_clear') THEN
    ALTER TABLE alpha_hunt_readiness ADD COLUMN adversarial_clear boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'alpha_hunt_readiness' AND column_name = 'regime_match') THEN
    ALTER TABLE alpha_hunt_readiness ADD COLUMN regime_match boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'alpha_hunt_readiness' AND column_name = 'sensor_evidence') THEN
    ALTER TABLE alpha_hunt_readiness ADD COLUMN sensor_evidence jsonb DEFAULT '{}'::jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'alpha_hunt_readiness' AND column_name = 'armed_at') THEN
    ALTER TABLE alpha_hunt_readiness ADD COLUMN armed_at timestamptz;
  END IF;
END $$;

ALTER TABLE alpha_hunt_readiness DROP CONSTRAINT IF EXISTS alpha_hunt_readiness_hunt_state_check;
ALTER TABLE alpha_hunt_readiness ADD CONSTRAINT alpha_hunt_readiness_hunt_state_check
  CHECK (hunt_state = ANY (ARRAY['armed'::text, 'live'::text, 'ready'::text, 'not_ready'::text]));

ALTER TABLE alpha_hunt_readiness DROP CONSTRAINT IF EXISTS alpha_hunt_readiness_trigger_state_check;
ALTER TABLE alpha_hunt_readiness ADD CONSTRAINT alpha_hunt_readiness_trigger_state_check
  CHECK (trigger_state = ANY (ARRAY['confirmed'::text, 'fired'::text, 'developing'::text, 'none'::text]));

CREATE INDEX IF NOT EXISTS idx_alpha_hunt_readiness_armed
  ON alpha_hunt_readiness(hunt_state, trigger_archetype, updated_at DESC)
  WHERE hunt_state = 'armed';
