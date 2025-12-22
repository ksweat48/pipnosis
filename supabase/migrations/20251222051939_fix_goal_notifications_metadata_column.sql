/*
  # Fix goal_notifications metadata column

  1. Problem
    - Table has column: data (jsonb)
    - Functions expect column: metadata
    - This causes error when trying to insert notifications

  2. Changes
    - Rename data → metadata

  3. Security
    - No RLS changes needed
    - Column rename preserves all existing data
*/

-- Check if data column exists and metadata doesn't
DO $$
DECLARE
  v_data_exists boolean;
  v_metadata_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_notifications'
    AND column_name = 'data'
  ) INTO v_data_exists;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_notifications'
    AND column_name = 'metadata'
  ) INTO v_metadata_exists;

  IF v_data_exists AND NOT v_metadata_exists THEN
    -- Rename data to metadata
    ALTER TABLE goal_notifications
      RENAME COLUMN data TO metadata;
    
    RAISE NOTICE '✅ Renamed goal_notifications.data → metadata';
  ELSIF v_metadata_exists AND NOT v_data_exists THEN
    RAISE NOTICE '✅ Column metadata already exists, no migration needed';
  ELSIF v_data_exists AND v_metadata_exists THEN
    RAISE WARNING '⚠️ Both data and metadata columns exist! Manual intervention required.';
  ELSE
    RAISE WARNING '⚠️ Neither data nor metadata column exists! Check schema.';
  END IF;
END $$;
