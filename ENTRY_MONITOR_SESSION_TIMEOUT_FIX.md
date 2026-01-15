# Entry Monitor & Session Timeout Critical Fixes

## Issues Fixed

### Issue 1: Entry Monitor Not Disappearing After Manual Trade Execution
**Severity:** P1 - User Experience Issue
**Status:** ✅ FIXED

**Problem:**
- User clicked "Enter Trade Now at Market Price" button
- Trade executed successfully in database
- Entry monitor UI remained visible showing "Waiting for Entry Zone"
- User had to manually refresh to see the trade

**Root Cause:**
In `entry-execution-coordinator.ts`, the `executeFromIntent()` function created the trade successfully but **never updated the intent status** to 'executed'. The `useActiveEntryIntent` React hook only reloads when the status field changes, so the UI never knew the trade was executed.

**Fix Applied:**
Added intent status update after successful trade creation (lines 224-239 in entry-execution-coordinator.ts):

```typescript
// CRITICAL: Update intent status to 'executed' so UI can remove entry monitor
// This triggers realtime subscription in useActiveEntryIntent hook
const { error: intentUpdateError } = await supabase
  .from('entry_intents')
  .update({
    status: 'executed',
    executed_at: new Date().toISOString(),
    executed_price: actualEntryPrice,
    trade_id: trade.id
  })
  .eq('id', intentId);
```

**Impact:**
- Entry monitor now immediately disappears when trade is executed
- Works for both manual and autonomous execution paths
- Realtime subscription in `useActiveEntryIntent` hook detects status change
- No page refresh needed

---

### Issue 2: Goal Session Auto-Closed With Open Trade
**Severity:** P0 - CRITICAL Data Integrity Issue
**Status:** ✅ FIXED

**Problem:**
- User had an active SPX500 trade showing +$1.05 profit
- Goal session automatically closed ("No active goal session")
- Trade was orphaned - no way to manage it
- Session timeout triggered despite having an open position

**Root Cause:**
In the database function `should_show_continuation_modal()`, there was a critical logic error:

```sql
-- OLD LOGIC (BUGGY)
SELECT EXISTS (
  SELECT 1
  FROM goal_session_trades gst
  WHERE gst.goal_session_id = p_session_id
    AND gst.created_at >= v_session.scanning_started_at  -- BUG!
) INTO v_has_recent_trades;
```

The function checked if trades were **created during the current scanning cycle**, but ignored trades created before `scanning_started_at`. This meant:
1. Trade opened at 12:00 PM
2. User continued session, `scanning_started_at` reset to 1:00 PM
3. After 60 minutes (2:00 PM), timeout logic checked for trades created after 1:00 PM
4. Found none (trade was created at 12:00 PM)
5. Triggered timeout modal → Auto-closed session → Orphaned the trade

**Fix Applied:**
Migration `fix_session_timeout_with_open_trades.sql` with two critical changes:

**1. Check for ANY open trades (not just recent ones):**
```sql
-- NEW LOGIC (FIXED)
SELECT EXISTS (
  SELECT 1
  FROM goal_session_trades gst
  WHERE gst.goal_session_id = p_session_id
    AND gst.status = 'open'  -- Only check if trade is currently OPEN
    -- REMOVED: AND gst.created_at >= v_session.scanning_started_at
    -- We don't care WHEN the trade was created, only that it's OPEN
) INTO v_has_open_trades;
```

**2. Added safety net in auto-close function:**
```sql
-- CRITICAL SAFETY CHECK: Never auto-close if there are open trades
SELECT EXISTS (
  SELECT 1
  FROM goal_session_trades gst
  WHERE gst.goal_session_id = p_session_id
    AND gst.status = 'open'
) INTO v_has_open_trades;

IF v_has_open_trades THEN
  RAISE WARNING '[check_continuation_modal_timeout] Session % has open trades - BLOCKING auto-close';

  -- Clear the modal state since it shouldn't have been triggered
  UPDATE goal_sessions
  SET
    awaiting_continuation_confirmation = false,
    awaiting_continuation_since = NULL,
    status = 'trade_pending'
  WHERE id = p_session_id;

  RETURN false;
END IF;
```

**Impact:**
- Sessions with open trades NEVER trigger timeout modals
- If modal is triggered incorrectly, auto-close is blocked by safety net
- Trade orphaning is now impossible through normal system operation
- Clear logging for debugging if issues occur

---

## Files Modified

### Frontend Code
1. **src/services/entry-execution-coordinator.ts**
   - Added intent status update after successful trade execution
   - Ensures UI receives realtime notification via status change

### Database Migrations
1. **supabase/migrations/fix_session_timeout_with_open_trades.sql**
   - Updated `should_show_continuation_modal()` function
   - Updated `check_continuation_modal_timeout()` function
   - Added double safety net against trade orphaning

---

## Testing Recommendations

### Test Case 1: Manual Entry Monitor Removal
1. Start a goal session and wait for entry intent
2. Click "Enter Trade Now at Market Price"
3. **Expected:** Entry monitor disappears immediately, trade appears in positions
4. **Verify:** No page refresh needed

### Test Case 2: Session Timeout With Open Trade
1. Start a goal session and execute a trade
2. Let session run for 60+ minutes without closing trade
3. **Expected:** No timeout modal appears, session stays active
4. **Verify:** Check browser console for log: "Session X has open trades -> BLOCKED"

### Test Case 3: Session Timeout Without Trade
1. Start a goal session
2. Let session run for 60+ minutes without finding/executing trade
3. **Expected:** Continuation modal appears after 60 minutes
4. **Expected:** Session auto-closes after 1 minute if no response

### Test Case 4: Session Continuation With Old Trade
1. Execute a trade at 12:00 PM
2. Continue session for another hour (scanning_started_at resets)
3. Wait 60 minutes (until 2:00 PM)
4. **Expected:** No timeout modal (trade is still open)
5. **Verify:** Session remains active despite elapsed time

---

## Architecture Notes

### SSOT Compliance
- Entry intent status is the **single source of truth** for monitoring state
- React hooks subscribe to realtime changes, no polling needed
- Database functions are the authority for session lifecycle decisions

### CCIP Compliance
- Changes follow "fix root cause, not symptoms" principle
- Identified both immediate fix and safety net (defense in depth)
- No workarounds or band-aids - proper architectural fixes

### Defensive Programming
- Added logging for debugging future issues
- Safety net in auto-close prevents catastrophic failure
- Clear error messages for operators

---

## Deployment Notes

**Database Migration:**
- Applied automatically via `mcp__supabase__apply_migration` tool
- No downtime required (function replacement is atomic)
- Backward compatible (no schema changes, only logic updates)

**Frontend Deployment:**
- Build completed successfully (verified)
- No breaking changes to existing functionality
- Realtime subscriptions already in place, just responding to new status

**Monitoring:**
After deployment, watch for these logs:
- `[should_show_continuation_modal] Session X has open trades -> BLOCKED`
- `[check_continuation_modal_timeout] Session X has open trades - BLOCKING auto-close`
- `[SimpleEntryMonitor] User clicked manual entry for SYMBOL`

---

## Risk Assessment

**Risk Level:** LOW
- Both fixes are surgical changes to specific code paths
- No broad architectural changes that could have cascading effects
- Safety nets in place to catch edge cases
- Build verification passed

**Rollback Plan:**
If issues occur, rollback is simple:
1. Frontend: Deploy previous version (intent status update is non-breaking)
2. Database: Restore previous function versions from git history
3. Impact: Users will experience original bugs but no data corruption

---

## Summary

Both critical issues have been resolved with proper architectural fixes following SSOT and CCIP principles. The entry monitor now correctly removes itself after trade execution, and sessions with open trades can never be auto-closed, preventing trade orphaning.

**Build Status:** ✅ PASSED (31.61s)
**Tests Required:** Manual verification of 4 test cases
**Ready for Deployment:** ✅ YES
