/*
  # Fix AI Skill Progression Duplicate Rows

  1. Problem
    - ai_skill_progression table has duplicate rows for same user_id
    - Causing "JSON object requested, multiple (or no) rows returned" error
    - No unique constraint exists to prevent duplicates

  2. Solution
    - Delete duplicate rows, keeping only the most recent per user
    - Add unique constraint on user_id
    - Add index for performance

  3. Safety
    - Uses CTE to identify rows to keep
    - Only deletes older duplicates
    - Preserves most recent skill progression data
*/

-- Step 1: Delete duplicate rows, keeping only the most recent per user
WITH ranked_rows AS (
  SELECT 
    id,
    user_id,
    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY updated_at DESC, created_at DESC) as rn
  FROM ai_skill_progression
),
rows_to_delete AS (
  SELECT id 
  FROM ranked_rows 
  WHERE rn > 1
)
DELETE FROM ai_skill_progression
WHERE id IN (SELECT id FROM rows_to_delete);

-- Step 2: Add unique constraint on user_id
ALTER TABLE ai_skill_progression
  ADD CONSTRAINT ai_skill_progression_user_id_unique UNIQUE (user_id);

-- Step 3: Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_ai_skill_progression_user_id 
  ON ai_skill_progression(user_id);

-- Step 4: Verify cleanup
DO $$
DECLARE
  total_rows int;
  unique_users int;
BEGIN
  SELECT COUNT(*) INTO total_rows FROM ai_skill_progression;
  SELECT COUNT(DISTINCT user_id) INTO unique_users FROM ai_skill_progression;
  
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'AI SKILL PROGRESSION CLEANUP COMPLETE';
  RAISE NOTICE '========================================================';
  RAISE NOTICE 'Total rows: %', total_rows;
  RAISE NOTICE 'Unique users: %', unique_users;
  
  IF total_rows = unique_users THEN
    RAISE NOTICE '✓ No duplicates remaining';
  ELSE
    RAISE WARNING '⚠ Duplicates still exist: % rows for % users', total_rows, unique_users;
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '✓ Unique constraint added on user_id';
  RAISE NOTICE '✓ Index created for performance';
  RAISE NOTICE '========================================================';
END $$;
