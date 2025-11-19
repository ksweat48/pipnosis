/*
  # Add Metadata Column to AI Session Learnings

  ## Purpose
  Support 10-session rolling learning cycles by adding metadata tracking to ai_session_learnings table.

  ## Changes
  1. Add `metadata` jsonb column to store:
     - learning_cycle: Which 10-session cycle (1, 2, 3, etc.)
     - session_range: String like "1-10", "11-20", "21-30"
     - cycle_type: '10_session_rolling_window' or 'single_day'
     - Any other contextual data needed for learning analysis

  ## Security
  - No RLS changes needed - existing policies cover new column
*/

-- Add metadata column to ai_session_learnings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_session_learnings' AND column_name = 'metadata'
  ) THEN
    ALTER TABLE ai_session_learnings ADD COLUMN metadata jsonb DEFAULT '{}'::jsonb;

    -- Add index for querying by metadata fields
    CREATE INDEX IF NOT EXISTS idx_session_learnings_metadata
      ON ai_session_learnings USING gin(metadata);

    RAISE NOTICE '✅ Added metadata column to ai_session_learnings';
  ELSE
    RAISE NOTICE 'ℹ️  metadata column already exists in ai_session_learnings';
  END IF;
END $$;

-- Add helpful comment
COMMENT ON COLUMN ai_session_learnings.metadata IS
  'Stores contextual data for learning cycles: learning_cycle (integer), session_range (text), cycle_type (text)';
