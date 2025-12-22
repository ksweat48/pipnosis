# Testing Guide: No-Trade Flow Fixes

## Quick Verification Tests

### Test 1: Verify Functions Exist
```sql
-- Run in Supabase SQL Editor
SELECT
  proname as function_name,
  pg_get_function_result(oid) as return_type
FROM pg_proc
WHERE proname IN (
  'should_show_continuation_modal',
  'check_continuation_modal_timeout',
  'trigger_continuation_modal',
  'create_session_ended_modal',
  'close_goal_session_safely'
)
ORDER BY proname;

-- Expected: 5 functions returned
```

### Test 2: Verify Constraint Added
```sql
-- Check close_reason constraint
SELECT
  conname as constraint_name,
  pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE conname = 'valid_close_reason';

-- Expected: Shows CHECK constraint with all valid close reasons
```

### Test 3: Test Invalid Close Reason (Should Fail)
```sql
-- This should FAIL with constraint violation
UPDATE goal_session_trades
SET close_reason = 'invalid_reason'
WHERE id = (SELECT id FROM goal_session_trades LIMIT 1);

-- Expected Error: violates check constraint "valid_close_reason"
```

### Test 4: Test Duplicate Modal Prevention
```sql
-- Create a test session
DO $$
DECLARE
  v_session_id uuid;
  v_user_id uuid;
BEGIN
  -- Get or create test user
  SELECT id INTO v_user_id FROM auth.users LIMIT 1;

  -- Create test session
  INSERT INTO goal_sessions (
    user_id,
    goal_type,
    target_value,
    status,
    scanning_started_at
  ) VALUES (
    v_user_id,
    'profit',
    100,
    'scanning',
    now() - interval '16 minutes'  -- More than 15 minutes ago
  )
  RETURNING id INTO v_session_id;

  RAISE NOTICE 'Test session created: %', v_session_id;

  -- Try to create modal twice
  PERFORM trigger_continuation_modal(v_session_id);
  RAISE NOTICE 'First modal created';

  PERFORM trigger_continuation_modal(v_session_id);
  RAISE NOTICE 'Second call blocked (should not create duplicate)';

  -- Check only ONE modal exists
  IF (SELECT COUNT(*) FROM pending_user_modals WHERE goal_session_id = v_session_id) = 1 THEN
    RAISE NOTICE 'SUCCESS: Only 1 modal created (duplicate prevented)';
  ELSE
    RAISE EXCEPTION 'FAILED: Multiple modals created!';
  END IF;

  -- Cleanup
  DELETE FROM pending_user_modals WHERE goal_session_id = v_session_id;
  DELETE FROM goal_sessions WHERE id = v_session_id;
END $$;
```

### Test 5: Verify Trade Counting with Timestamps
```sql
-- Create test scenario
DO $$
DECLARE
  v_session_id uuid;
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users LIMIT 1;

  -- Create session
  INSERT INTO goal_sessions (
    user_id,
    goal_type,
    target_value,
    status,
    scanning_started_at,
    start_time
  ) VALUES (
    v_user_id,
    'profit',
    100,
    'scanning',
    now() - interval '10 minutes',  -- Scanning started 10 min ago
    now() - interval '2 hours'      -- Session created 2 hours ago
  )
  RETURNING id INTO v_session_id;

  -- Create OLD trade (before scanning started)
  INSERT INTO goal_session_trades (
    user_id,
    goal_session_id,
    symbol,
    direction,
    entry_price,
    status,
    opened_at,
    position_size
  ) VALUES (
    v_user_id,
    v_session_id,
    'EURUSD',
    'long',
    1.08000,
    'closed',
    now() - interval '1 hour',  -- Before scanning_started_at
    1000
  );

  -- Create NEW trade (after scanning started)
  INSERT INTO goal_session_trades (
    user_id,
    goal_session_id,
    symbol,
    direction,
    entry_price,
    status,
    opened_at,
    position_size
  ) VALUES (
    v_user_id,
    v_session_id,
    'GBPUSD',
    'short',
    1.27000,
    'closed',
    now() - interval '5 minutes',  -- After scanning_started_at
    1000
  );

  -- Test: should_show_continuation_modal should return FALSE
  -- because there IS a recent trade
  DECLARE
    v_should_show boolean;
  BEGIN
    -- Change scanning_started_at to 16 minutes ago (past 15-min threshold)
    UPDATE goal_sessions
    SET scanning_started_at = now() - interval '16 minutes'
    WHERE id = v_session_id;

    SELECT should_show_continuation_modal(v_session_id) INTO v_should_show;

    IF v_should_show = false THEN
      RAISE NOTICE 'SUCCESS: Correctly detected recent trade';
    ELSE
      RAISE EXCEPTION 'FAILED: Should not show modal when recent trades exist';
    END IF;
  END;

  -- Cleanup
  DELETE FROM goal_session_trades WHERE goal_session_id = v_session_id;
  DELETE FROM goal_sessions WHERE id = v_session_id;
END $$;
```

---

## Manual UI Testing

### Scenario 1: 15-Minute Continuation Prompt

**Setup:**
1. Start a goal session
2. Enable scanning
3. Wait 15 minutes with no trades

**Expected:**
- ✅ Modal appears after 15 minutes
- ✅ Modal shows correct target value (not "undefined")
- ✅ Modal shows correct current P/L
- ✅ Push notification received
- ✅ Notification badge shows "1"
- ✅ Only ONE modal created (no duplicates)

**Test:**
```
1. Click "Start Scanning"
2. Wait 15 minutes (or modify scanning_started_at in DB)
3. Check for modal popup
4. Check push notification
5. Verify modal data is accurate
```

---

### Scenario 2: 20-Minute Timeout

**Setup:**
1. Start goal session
2. Let 15-minute modal appear
3. Don't respond for 5 more minutes

**Expected:**
- ✅ Session closes automatically at 20 minutes
- ✅ "Session Ended" modal appears
- ✅ Modal shows reason: "No user response after 20 minutes"
- ✅ Trade count accurate
- ✅ P/L calculated correctly
- ✅ Session status = 'completed'

---

### Scenario 3: Continue Scanning

**Setup:**
1. Let 15-minute modal appear
2. Click "Continue Scanning"

**Expected:**
- ✅ Modal dismissed
- ✅ Session status back to 'scanning'
- ✅ `scanning_started_at` reset to now()
- ✅ Timer starts fresh
- ✅ If no trades for 15 more minutes, NEW modal appears
- ✅ Trade counts reset for new cycle

---

### Scenario 4: Open Trades Block Closure

**Setup:**
1. Start session
2. Open a trade
3. Wait for 20-minute timeout

**Expected:**
- ✅ Session does NOT close (trade still open)
- ✅ No "Session Ended" modal created
- ✅ Autonomous monitor logs: "Cannot close: X open trades"
- ✅ Session waits for trade to close

---

## Database Verification Queries

### Check Active Sessions
```sql
SELECT
  id,
  status,
  scanning_started_at,
  EXTRACT(EPOCH FROM (now() - scanning_started_at))/60 as minutes_since_scan,
  awaiting_continuation_confirmation
FROM goal_sessions
WHERE status IN ('scanning', 'awaiting_continuation', 'trade_pending')
ORDER BY scanning_started_at DESC;
```

### Check Pending Modals
```sql
SELECT
  modal_type,
  goal_session_id,
  created_at,
  dismissed_at,
  modal_data->>'target_value' as target,
  modal_data->>'current_progress' as current_pnl
FROM pending_user_modals
WHERE dismissed_at IS NULL
ORDER BY created_at DESC;
```

### Check Recent Notifications
```sql
SELECT
  type,
  message,
  priority,
  viewed,
  created_at,
  metadata
FROM goal_notifications
ORDER BY created_at DESC
LIMIT 20;
```

### Verify Trade Counts
```sql
SELECT
  gs.id as session_id,
  gs.scanning_started_at,
  COUNT(*) FILTER (WHERE gst.opened_at < gs.scanning_started_at) as old_trades,
  COUNT(*) FILTER (WHERE gst.opened_at >= gs.scanning_started_at) as new_trades,
  COUNT(*) as total_trades
FROM goal_sessions gs
LEFT JOIN goal_session_trades gst ON gst.goal_session_id = gs.id
WHERE gs.status IN ('scanning', 'awaiting_continuation')
GROUP BY gs.id, gs.scanning_started_at;
```

---

## Autonomous Monitor Testing

### Check Monitor Logs
```javascript
// In browser console on PositionsPage or TradePage
// Look for these logs:

// Every 60 seconds:
"[Autonomous Monitor] Checking 1 active sessions..."
"[Autonomous Monitor] Session xyz: status=scanning, minutes_since=12"

// At 15 minutes:
"[Autonomous Monitor] Session xyz: SHOULD show continuation modal"
"[Autonomous Monitor] Triggering continuation modal..."

// At 20 minutes:
"[Autonomous Monitor] Session xyz: TIMEOUT - no response"
"[Autonomous Monitor] Closing session with reason: timeout"
```

### Force Trigger (For Testing)
```sql
-- Manually set session to 16 minutes old
UPDATE goal_sessions
SET scanning_started_at = now() - interval '16 minutes'
WHERE id = 'your-session-id';

-- Next monitor check (within 60 seconds) should trigger modal
```

---

## Success Criteria

### All Tests Pass When:

1. ✅ No database errors in console
2. ✅ Modal shows correct target value (not undefined)
3. ✅ Modal shows correct P/L (calculated from trades)
4. ✅ Only ONE modal created (no duplicates)
5. ✅ Trade counts accurate (excludes old trades)
6. ✅ Push notifications sent successfully
7. ✅ Sessions close at 20 minutes
8. ✅ Sessions protected when trades open
9. ✅ "Continue" button resets timer properly
10. ✅ Close reasons validated (invalid values rejected)

---

## Troubleshooting

### Issue: Modal shows "undefined" for target
**Cause:** Using old `goal_amount` column
**Fix:** Applied in migration (uses `target_value` now)
**Verify:** Check modal_data in pending_user_modals table

### Issue: Trade count wrong after continuing
**Cause:** Not filtering by `scanning_started_at`
**Fix:** Applied in migration (filters trades now)
**Verify:** Run trade count verification query above

### Issue: Multiple modals created
**Cause:** No duplicate check
**Fix:** Applied in migration (checks duplicates now)
**Verify:** Run duplicate modal test above

### Issue: Session closes with open trades
**Cause:** Not checking trade status before close
**Fix:** Applied in `close_goal_session_safely()` function
**Verify:** Open a trade and wait for timeout

---

## Rollback Plan (If Needed)

If fixes cause issues:

```sql
-- Revert functions to previous versions
-- (Would need to restore from migration history)

-- Remove constraint temporarily
ALTER TABLE goal_session_trades
DROP CONSTRAINT IF EXISTS valid_close_reason;

-- Check previous migration files:
-- 20251221232351_add_continuation_modal_with_push_notifications.sql
-- 20251222015727_20251222_add_session_ended_persistent_modal.sql
```

**Note:** Rollback not recommended as fixes address critical bugs. Monitor logs and test thoroughly instead.
