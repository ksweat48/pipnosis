/*
  # Add updated_at column to ai_performance_evolution table

  ## Changes
  - Adds missing `updated_at` timestamp column to `ai_performance_evolution` table
  - Sets default value to `now()` for automatic timestamp management
  - Updates existing records to have `updated_at` equal to `created_at`

  ## Why This Is Needed
  - The AI learning engine code attempts to update the `updated_at` column when modifying records
  - Without this column, PATCH requests fail with "Could not find the 'updated_at' column" error
  - This prevents performance evolution tracking from being saved properly

  ## Security
  - No RLS changes needed - inherits existing policies from table
*/

-- Add updated_at column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_performance_evolution' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE ai_performance_evolution ADD COLUMN updated_at timestamptz DEFAULT now();

    -- Set updated_at to created_at for existing records
    UPDATE ai_performance_evolution SET updated_at = created_at WHERE updated_at IS NULL;

    RAISE NOTICE 'Added updated_at column to ai_performance_evolution table';
  ELSE
    RAISE NOTICE 'updated_at column already exists in ai_performance_evolution table';
  END IF;
END $$;