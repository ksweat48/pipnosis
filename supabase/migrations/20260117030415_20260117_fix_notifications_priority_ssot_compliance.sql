/*
  ═══════════════════════════════════════════════════════════════════════════
  FIX: goal_notifications Priority Constraint - SSOT Compliance Update
  ═══════════════════════════════════════════════════════════════════════════

  ## Problem - Production Error
  Console error: "new row for relation "goal_notifications" violates check 
  constraint "goal_notifications_priority_check""
  
  Root cause: TypeScript uses 'critical' as priority value but database 
  constraint only allows 'low', 'medium', 'high', 'urgent'

  ## Solution  
  Update database constraint to include 'critical' value
  Migrate any existing 'urgent' values to 'critical' for consistency
  Align TypeScript interface with database schema (SSOT)

  ## Changes
  - Drop existing priority CHECK constraint
  - Migrate 'urgent' → 'critical' 
  - Add new constraint with 'critical' as valid value
  - Add validation logging for all values

  ═══════════════════════════════════════════════════════════════════════════
*/

-- Step 1: Drop existing priority constraint
ALTER TABLE goal_notifications
DROP CONSTRAINT IF EXISTS goal_notifications_priority_check;

-- Step 2: Migrate non-standard 'urgent' priority to 'critical'
UPDATE goal_notifications
SET priority = 'critical'
WHERE priority = 'urgent';

-- Step 3: Add new constraint that includes 'critical'
ALTER TABLE goal_notifications
ADD CONSTRAINT goal_notifications_priority_check
CHECK (priority IN ('low', 'medium', 'high', 'critical'));

-- Step 4: Document the valid values
COMMENT ON COLUMN goal_notifications.priority IS
'Notification priority: low (informational), medium (standard), high (important), critical (urgent system alerts). Schema enforces alignment with TypeScript types.';

-- Verification
DO $$
DECLARE
  v_constraint_exists boolean;
  v_invalid_count integer;
BEGIN
  -- Check for any invalid priority values
  SELECT COUNT(*) INTO v_invalid_count
  FROM goal_notifications
  WHERE priority NOT IN ('low', 'medium', 'high', 'critical');

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Found % rows with invalid priority values', v_invalid_count;
  END IF;

  -- Verify constraint exists
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'goal_notifications'
      AND c.conname = 'goal_notifications_priority_check'
  ) INTO v_constraint_exists;

  IF v_constraint_exists THEN
    RAISE NOTICE '✅ goal_notifications_priority_check constraint updated';
    RAISE NOTICE '✅ SSOT compliance: TypeScript and database schemas aligned';
    RAISE NOTICE '✅ Priority values: low, medium, high, critical';
  ELSE
    RAISE EXCEPTION 'Failed to create goal_notifications_priority_check constraint';
  END IF;
END $$;
