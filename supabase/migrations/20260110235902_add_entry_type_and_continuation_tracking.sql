/*
  # Add Entry Type and Continuation Tracking

  1. Schema Changes
    - Add `entry_type` column to `entry_intents` table
      - "pullback" - Original Alpha pullback entry
      - "continuation" - Escalated entry after price runaway
      - "breakout" - Breakout entry type

    - Add `zone_revision_count` to track how many times zone was adjusted
    - Add `original_entry_zone` JSONB to preserve Alpha's original intent
    - Add `continuation_entry_from_intent_id` UUID to link continuation to expired pullback
    - Add `pre_flight_advisory_level` to track distance advisory at creation

  2. Purpose
    - Track entry type classification for learning
    - Enable continuation entry pathway
    - Preserve original intent when zone is revised
    - Support Alpha authority restoration for continuation decisions

  3. Notes
    - Backward compatible - all new columns are nullable
    - Default entry_type is "pullback" for existing intents
    - Continuation entries reduce size and tighten stops automatically
*/

-- Add entry type tracking to entry_intents
DO $$
BEGIN
  -- Add entry_type column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'entry_type'
  ) THEN
    ALTER TABLE entry_intents
    ADD COLUMN entry_type TEXT DEFAULT 'pullback'
    CHECK (entry_type IN ('pullback', 'continuation', 'breakout'));

    COMMENT ON COLUMN entry_intents.entry_type IS 'Entry classification: pullback (original), continuation (escalated), breakout';
  END IF;

  -- Add zone revision tracking
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'zone_revision_count'
  ) THEN
    ALTER TABLE entry_intents
    ADD COLUMN zone_revision_count INTEGER DEFAULT 0;

    COMMENT ON COLUMN entry_intents.zone_revision_count IS 'Number of times entry zone was adjusted (0 = original zone)';
  END IF;

  -- Add original entry zone preservation
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'original_entry_zone'
  ) THEN
    ALTER TABLE entry_intents
    ADD COLUMN original_entry_zone JSONB;

    COMMENT ON COLUMN entry_intents.original_entry_zone IS 'Alphas original entry zone: {min: number, max: number, center: number}';
  END IF;

  -- Add continuation entry linkage
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'continuation_entry_from_intent_id'
  ) THEN
    ALTER TABLE entry_intents
    ADD COLUMN continuation_entry_from_intent_id UUID REFERENCES entry_intents(id);

    COMMENT ON COLUMN entry_intents.continuation_entry_from_intent_id IS 'Links continuation entry to original pullback intent that expired';
  END IF;

  -- Add pre-flight advisory level tracking
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'pre_flight_advisory_level'
  ) THEN
    ALTER TABLE entry_intents
    ADD COLUMN pre_flight_advisory_level TEXT
    CHECK (pre_flight_advisory_level IN ('GREEN', 'AMBER', 'RED'));

    COMMENT ON COLUMN entry_intents.pre_flight_advisory_level IS 'Distance advisory at intent creation (GREEN/AMBER/RED)';
  END IF;
END $$;

-- Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_entry_intents_entry_type
  ON entry_intents(entry_type);

CREATE INDEX IF NOT EXISTS idx_entry_intents_continuation_from
  ON entry_intents(continuation_entry_from_intent_id)
  WHERE continuation_entry_from_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_entry_intents_advisory_level
  ON entry_intents(pre_flight_advisory_level)
  WHERE pre_flight_advisory_level IS NOT NULL;

-- Backfill existing intents with default values
UPDATE entry_intents
SET
  entry_type = 'pullback',
  zone_revision_count = 0,
  pre_flight_advisory_level = 'GREEN'
WHERE entry_type IS NULL;

-- Success message
DO $$
BEGIN
  RAISE NOTICE '✅ Entry type and continuation tracking added successfully';
  RAISE NOTICE 'New columns: entry_type, zone_revision_count, original_entry_zone, continuation_entry_from_intent_id, pre_flight_advisory_level';
  RAISE NOTICE 'Ready for Alpha authority restoration and continuation entry pathway';
END $$;
