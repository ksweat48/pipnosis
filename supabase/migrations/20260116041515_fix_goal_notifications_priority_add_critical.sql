/*
  ═══════════════════════════════════════════════════════════════════════════
  FIX GOAL_NOTIFICATIONS PRIORITY CONSTRAINT - ADD 'CRITICAL' PRIORITY
  ═══════════════════════════════════════════════════════════════════════════

  ## Problem - SSOT Violation
  TypeScript defines priority as: 'low' | 'medium' | 'high' | 'critical'
  Database constraint only allows: 'low', 'medium', 'high'
  Database has existing rows with 'urgent' (non-standard value)

  Result: 400 Bad Request when SLTP diagnostic service tries to create
  system alerts with priority='critical'

  ## Error Message
  ```
  new row for relation "goal_notifications" violates check constraint
  "goal_notifications_priority_check"
  ```

  ## Root Cause
  - notification-coordinator.ts (SSOT) line 33: type NotificationPriority = 'low' | 'medium' | 'high' | 'critical'
  - sltp-diagnostic-service.ts sends alerts with priority='critical'
  - Database constraint doesn't include 'critical' value
  - Existing data has 'urgent' which needs migration to 'critical'

  ## Solution
  1. Drop existing CHECK constraint (to allow updates)
  2. Migrate 'urgent' priority to 'critical' (data cleanup)
  3. Add new constraint that includes 'critical'

  ## SSOT Compliance
  - Database schema must match TypeScript types
  - notification-coordinator.ts remains authoritative for notification priority values
  - All priority values in TypeScript must be valid in database

  ## Security
  - Maintains existing RLS policies
  - Only updates CHECK constraint and data consistency
  - Backward compatible: 'urgent' mapped to 'critical'

  ═══════════════════════════════════════════════════════════════════════════
*/

-- Step 1: Drop existing priority constraint FIRST (to allow updates)
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

-- Step 4: Add comment documenting the valid values
COMMENT ON COLUMN goal_notifications.priority IS
'Notification priority level: low (informational), medium (standard), high (important), critical (urgent system alerts)';

-- Verification
DO $$
DECLARE
  v_constraint_exists boolean;
  v_urgent_count integer;
  v_invalid_priority_count integer;
BEGIN
  -- Check for any remaining 'urgent' values
  SELECT COUNT(*) INTO v_urgent_count
  FROM goal_notifications
  WHERE priority = 'urgent';

  IF v_urgent_count > 0 THEN
    RAISE EXCEPTION 'Failed to migrate % rows with priority=urgent', v_urgent_count;
  END IF;

  -- Check for any invalid priority values
  SELECT COUNT(*) INTO v_invalid_priority_count
  FROM goal_notifications
  WHERE priority NOT IN ('low', 'medium', 'high', 'critical');

  IF v_invalid_priority_count > 0 THEN
    RAISE WARNING 'Found % rows with invalid priority values', v_invalid_priority_count;
  END IF;

  -- Check if constraint exists with correct definition
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'goal_notifications'
      AND c.conname = 'goal_notifications_priority_check'
      AND c.contype = 'c'
  ) INTO v_constraint_exists;

  IF v_constraint_exists THEN
    RAISE NOTICE '✅ goal_notifications_priority_check constraint updated successfully';
    RAISE NOTICE '✅ Migrated urgent → critical';
    RAISE NOTICE '✅ Now allows: low, medium, high, critical';
    RAISE NOTICE '✅ SSOT violation fixed: TypeScript and database schemas now match';
    RAISE NOTICE '✅ System alerts with priority=critical will no longer be rejected';
  ELSE
    RAISE EXCEPTION 'Failed to create goal_notifications_priority_check constraint';
  END IF;
END $$;
