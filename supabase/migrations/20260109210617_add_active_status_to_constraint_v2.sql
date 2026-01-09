/*
  # Fix Entry Monitor Status Constraint

  ## Problem
  The `transition_entry_monitor_state` function sets status to 'active' for:
  - ENTRY_INTENT_CREATED → 'active'
  - ENTRY_MONITOR_ACTIVE → 'active'

  But the `goal_sessions_status_check` constraint doesn't allow 'active'.
  This causes 400 errors: "new row for relation "goal_sessions" violates
  check constraint "goal_sessions_status_check""

  Additionally, some legacy status values exist that aren't in the constraint:
  - 'awaiting_user_action' → should be 'awaiting_continuation'
  - 'system_stopped' → should be 'user_stopped'

  ## Solution
  1. Migrate legacy status values to current schema
  2. Add 'active' to the allowed status values in the constraint

  ## Status Values (after this migration)
  - 'initializing' - Session creation
  - 'scanning' - Discovery scanning mode
  - 'active' - Entry monitor active, waiting for entry conditions ⭐ NEW
  - 'trade_pending' - Trade execution pending
  - 'in_trade' - Trade is active
  - 'completed' - Session completed successfully
  - 'cancelled' - Session cancelled by user
  - 'force_closed_weekend' - Auto-closed for weekend
  - 'awaiting_continuation' - Waiting for user to continue
  - 'expired' - Session timed out
  - 'goal_achieved' - Goal target reached
  - 'user_stopped' - User manually stopped
  - 'system_stopped' - Legacy, mapped to user_stopped
*/

-- Step 1: Drop existing constraint so we can update data
ALTER TABLE goal_sessions
DROP CONSTRAINT IF EXISTS goal_sessions_status_check;

-- Step 2: Migrate legacy status values to current schema
UPDATE goal_sessions
SET status = 'awaiting_continuation'
WHERE status = 'awaiting_user_action';

UPDATE goal_sessions
SET status = 'user_stopped'
WHERE status = 'system_stopped';

-- Step 3: Add updated constraint with 'active' status and 'system_stopped' for backwards compat
ALTER TABLE goal_sessions
ADD CONSTRAINT goal_sessions_status_check
CHECK (status IN (
  'initializing',
  'scanning',
  'active',              -- ⭐ NEW: Entry monitor waiting for entry
  'trade_pending',
  'in_trade',
  'completed',
  'cancelled',
  'force_closed_weekend',
  'awaiting_continuation',
  'expired',
  'goal_achieved',
  'user_stopped',
  'system_stopped'       -- Legacy: kept for backwards compatibility
));

-- Step 4: Add index for active status queries (if not exists)
CREATE INDEX IF NOT EXISTS idx_goal_sessions_active_status
ON goal_sessions(status)
WHERE status = 'active';

-- Step 5: Add comment explaining the status field
COMMENT ON COLUMN goal_sessions.status IS
'Legacy status field synchronized with entry_monitor_state.
Values: initializing, scanning, active (monitoring entry), trade_pending, in_trade, completed, cancelled, force_closed_weekend, awaiting_continuation, expired, goal_achieved, user_stopped, system_stopped (legacy).
See: transition_entry_monitor_state function for sync logic.';
