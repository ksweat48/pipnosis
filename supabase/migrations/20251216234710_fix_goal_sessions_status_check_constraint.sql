/*
  # Fix Goal Sessions Status CHECK Constraint

  ## Problem
  The original goal_sessions table has an inline CHECK constraint that only allows:
  'initializing', 'scanning', 'trade_pending', 'in_trade', 'goal_achieved', 'expired', 'user_stopped'

  Later migrations tried to add 'soft_closing' but couldn't update the inline constraint,
  causing 400 errors when querying sessions with the new status values.

  ## Solution
  1. Drop ALL existing check constraints on status column
  2. Create a single named constraint with complete list of valid statuses
  3. Include all statuses currently used in the application

  ## Valid Statuses
  - 'initializing' - Session is being set up
  - 'scanning' - Actively scanning for trade opportunities
  - 'trade_pending' - Trade identified, awaiting execution/approval
  - 'in_trade' - Currently has open position(s)
  - 'soft_closing' - Timeframe expired but trades still open
  - 'goal_achieved' - Target profit reached successfully
  - 'expired' - Timeframe ended with no open trades
  - 'user_stopped' - User manually stopped the session

  ## Security
  - No RLS changes, maintains existing access control
  - Only updates constraint logic
*/

-- ============================================================================
-- STEP 1: Drop all existing check constraints on goal_sessions.status
-- ============================================================================

DO $$
DECLARE
  constraint_rec RECORD;
BEGIN
  -- Find and drop all check constraints on goal_sessions.status column
  FOR constraint_rec IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'goal_sessions'::regclass
      AND contype = 'c'
      AND conname LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE goal_sessions DROP CONSTRAINT IF EXISTS %I', constraint_rec.conname);
    RAISE NOTICE 'Dropped constraint: %', constraint_rec.conname;
  END LOOP;

  -- Also try dropping by checking the constraint definition
  FOR constraint_rec IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'goal_sessions'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE goal_sessions DROP CONSTRAINT IF EXISTS %I', constraint_rec.conname);
    RAISE NOTICE 'Dropped constraint by definition: %', constraint_rec.conname;
  END LOOP;
END $$;

-- ============================================================================
-- STEP 2: Add new comprehensive CHECK constraint
-- ============================================================================

ALTER TABLE goal_sessions
  ADD CONSTRAINT goal_sessions_status_valid_values
  CHECK (status IN (
    'initializing',
    'scanning',
    'trade_pending',
    'in_trade',
    'soft_closing',
    'goal_achieved',
    'expired',
    'user_stopped'
  ));

-- ============================================================================
-- STEP 3: Add helpful comment
-- ============================================================================

COMMENT ON CONSTRAINT goal_sessions_status_valid_values ON goal_sessions IS
  'Enforces valid status values for goal sessions. Use soft_closing when timeframe expires with open trades.';

-- ============================================================================
-- STEP 4: Verify existing data is compatible
-- ============================================================================

-- Check if there are any sessions with invalid status values
DO $$
DECLARE
  invalid_count INTEGER;
  invalid_statuses TEXT;
BEGIN
  SELECT COUNT(*), STRING_AGG(DISTINCT status, ', ')
  INTO invalid_count, invalid_statuses
  FROM goal_sessions
  WHERE status NOT IN (
    'initializing',
    'scanning',
    'trade_pending',
    'in_trade',
    'soft_closing',
    'goal_achieved',
    'expired',
    'user_stopped'
  );

  IF invalid_count > 0 THEN
    RAISE WARNING 'Found % sessions with invalid status values: %', invalid_count, invalid_statuses;
    RAISE NOTICE 'These sessions need to be updated manually before the constraint can be fully enforced';
  ELSE
    RAISE NOTICE 'All existing sessions have valid status values';
  END IF;
END $$;
