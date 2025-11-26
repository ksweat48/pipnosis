/*
  # Fix Pattern ID UUID Columns

  1. Problem
    - Pattern IDs like "pattern_1764139623555_4nx9g6q3d" are being generated
    - These are custom string IDs, not UUIDs
    - Inserting them into UUID columns causes: "invalid input syntax for type uuid"

  2. Changes
    - Convert pattern_id/id columns from UUID to TEXT in affected tables
    - Drop and recreate foreign key constraints with TEXT type
    - Update all related tables in correct order

  3. Tables Updated
    - ai_pattern_discoveries (parent table, id column)
    - ai_pattern_graduations (child table, pattern_id FK)
    - ai_pattern_interpretations (standalone, pattern_id)
    - gpt4o_usage_tracking (optional related_pattern_id)
    - recommendation_implementation_log (optional related_pattern_id)
*/

-- Step 1: Drop foreign key constraint
ALTER TABLE ai_pattern_graduations
  DROP CONSTRAINT IF EXISTS ai_pattern_graduations_pattern_id_fkey;

-- Step 2: Convert parent table (ai_pattern_discoveries) id to TEXT
ALTER TABLE ai_pattern_discoveries
  ALTER COLUMN id TYPE text USING id::text;

-- Step 3: Convert child table (ai_pattern_graduations) pattern_id to TEXT
ALTER TABLE ai_pattern_graduations
  ALTER COLUMN pattern_id TYPE text USING pattern_id::text;

-- Step 4: Recreate foreign key constraint with TEXT
ALTER TABLE ai_pattern_graduations
  ADD CONSTRAINT ai_pattern_graduations_pattern_id_fkey
  FOREIGN KEY (pattern_id)
  REFERENCES ai_pattern_discoveries(id)
  ON DELETE CASCADE;

-- Step 5: Fix standalone tables
ALTER TABLE ai_pattern_interpretations
  ALTER COLUMN pattern_id TYPE text USING pattern_id::text;

ALTER TABLE gpt4o_usage_tracking
  ALTER COLUMN related_pattern_id TYPE text USING related_pattern_id::text;

ALTER TABLE recommendation_implementation_log
  ALTER COLUMN related_pattern_id TYPE text USING related_pattern_id::text;

-- Step 6: Add helpful comments
COMMENT ON COLUMN ai_pattern_discoveries.id IS 
  'Pattern identifier - uses custom format like pattern_timestamp_randomid instead of UUID';

COMMENT ON COLUMN ai_pattern_graduations.pattern_id IS 
  'Pattern identifier - references ai_pattern_discoveries.id (custom format)';

COMMENT ON COLUMN ai_pattern_interpretations.pattern_id IS 
  'Pattern identifier - uses custom format like pattern_timestamp_randomid instead of UUID';

COMMENT ON COLUMN gpt4o_usage_tracking.related_pattern_id IS 
  'Optional pattern identifier - uses custom format when present';

COMMENT ON COLUMN recommendation_implementation_log.related_pattern_id IS 
  'Optional pattern identifier - uses custom format when present';
