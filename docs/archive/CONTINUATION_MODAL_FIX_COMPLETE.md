# Continuation Modal Fix - Complete

## Problem Summary
Entry intent timeouts were NOT showing the continuation modal to users. Instead, sessions would immediately close without any user interaction or decision prompt.

## Root Cause Analysis

### The Broken Flow
1. Entry intent times out (price too far, invalidation crossed, or time expired)
2. `handleAbandonment()` called `transitionState('ABANDONED_RESCAN_REQUESTED')`
3. **This immediately changed status to 'scanning'**
4. Then `request_session_continuation()` was called to create modal
5. **Modal was created BUT session was already in 'scanning' status**
6. Goal session live engine saw 'scanning' → restarted scanning
7. Simple scanning timer saw 'scanning' → scheduled new scan
8. **User never saw the modal**

### Critical Issues Fixed

**Issue #1: State Transition Race Condition**
- Coordinator transitioned state BEFORE requesting continuation
- Modal creation didn't pause the session
- Session bypassed the modal entirely

**Issue #2: Missing Status Update in Modal Function**
- `request_session_continuation()` didn't set `status='awaiting_continuation'`
- Session remained in active/scanning state
- No mechanism to pause scanning while awaiting decision

**Issue #3: No Auto-Close Enforcement**
- `auto_close_expired_continuations()` existed but was never called
- No scheduled job or trigger to enforce 60-second deadline
- Sessions could get stuck in awaiting state indefinitely

**Issue #4: Scan Blocker Missing**
- `can_scan_now()` didn't check for `status='awaiting_continuation'`
- Scanning was allowed even when modal should be showing
- Created parallel execution paths

## Implementation

### Database Changes (3 migrations applied)

**Migration 1: Fix `request_session_continuation`**
```sql
-- Now sets status='awaiting_continuation' to PAUSE the session
UPDATE goal_sessions
SET
  status = 'awaiting_continuation',  -- CRITICAL: Stops scanning
  awaiting_continuation_response = true,
  continuation_modal_shown_at = now(),
  continuation_deadline = now() + interval '60 seconds',
  entry_monitor_state = 'ABANDONED_RESCAN_REQUESTED'
WHERE id = p_session_id;
```

**Migration 2: Auto-Close Triggers**
```sql
-- Trigger on UPDATE to auto-close expired continuations
CREATE TRIGGER trigger_auto_close_continuation
  BEFORE UPDATE ON goal_sessions
  FOR EACH ROW
  EXECUTE FUNCTION trigger_auto_close_expired_continuation();

-- Cleanup trigger to remove modals and send notifications
CREATE TRIGGER trigger_cleanup_auto_closed_modal
  AFTER UPDATE ON goal_sessions
  FOR EACH ROW
  WHEN (NEW.continuation_decision = 'auto_closed')
  EXECUTE FUNCTION cleanup_auto_closed_continuation_modal();
```

**Migration 3: Scan Blocker**
```sql
-- Updated can_scan_now() to block when awaiting continuation
IF v_session.status = 'awaiting_continuation' THEN
  RETURN jsonb_build_object(
    'allowed', false,
    'reason', 'awaiting_continuation',
    'message', 'Waiting for your decision: continue scanning or close session',
    'deadline', v_session.continuation_deadline,
    'seconds_remaining', EXTRACT(EPOCH FROM (v_session.continuation_deadline - now()))
  );
END IF;
```

### Code Changes

**entry-monitor-coordinator.ts**
```typescript
// BEFORE (broken):
await this.transitionState(sessionId, 'ABANDONED_RESCAN_REQUESTED'); // Set status='scanning'
await supabase.rpc('request_session_continuation', {...}); // Modal created but too late

// AFTER (fixed):
// request_session_continuation() handles ALL state changes
await supabase.rpc('request_session_continuation', {...});
// No manual state transition - modal function sets status='awaiting_continuation'
```

## Flow After Fix

### Complete User Experience

```
Entry intent times out
  ↓
request_session_continuation() called
  ↓
Sets status='awaiting_continuation'
Sets entry_monitor_state='ABANDONED_RESCAN_REQUESTED'
Creates modal in pending_user_modals
Creates notification
  ↓
User sees modal: "Continue scanning or close?"
Countdown timer shows 60 seconds
  ↓
Three possible outcomes:

1. User clicks "Continue"
   → handle_continuation_decision('continue')
   → Sets status='scanning'
   → Schedules next scan in 30 seconds
   → Deletes modal
   → User returns to scanning

2. User clicks "Close"
   → handle_continuation_decision('close')
   → Sets status='completed'
   → Deletes modal
   → Session ends gracefully

3. No response (60 seconds pass)
   → Auto-close trigger fires on next update
   → Sets status='completed'
   → Sets continuation_decision='auto_closed'
   → Cleanup trigger deletes modal
   → Sends notification to user
   → Session ends automatically
```

## SSOT Architecture

### Single Source of Truth

**Database: goal_sessions table**
```
status='awaiting_continuation' → Session is PAUSED
awaiting_continuation_response=true → Modal should be shown
continuation_deadline → When auto-close happens
continuation_decision → User's final choice or 'auto_closed'
```

**All systems respect this state:**
- `can_scan_now()` → Blocks scanning
- Goal scanner → Won't scan
- Entry monitor → Won't create new intents
- Modal handler → Shows modal
- Auto-close trigger → Enforces deadline

### No Parallel Systems

- Removed old 60-minute timeout continuation (trigger_continuation_modal)
- New system handles both:
  - 60-minute scanning timeout
  - Entry intent timeouts
- Single modal type: 'continuation'
- Single status field: 'awaiting_continuation'

## Testing Checklist

### Manual Testing Steps

1. **Basic Flow**
   - [ ] Start goal session
   - [ ] Let entry intent timeout (wait for price to move away)
   - [ ] Verify modal appears with countdown
   - [ ] Click "Continue" → scanning resumes
   - [ ] Let another intent timeout
   - [ ] Click "Close" → session ends

2. **Auto-Close Testing**
   - [ ] Let entry intent timeout
   - [ ] See modal appear
   - [ ] Don't click anything for 60 seconds
   - [ ] Verify session auto-closes
   - [ ] Check notification appears

3. **Scan Blocking**
   - [ ] While modal is showing
   - [ ] Try to manually trigger scan (shouldn't work)
   - [ ] Check can_scan_now returns 'awaiting_continuation'

4. **Database State**
   - [ ] Check status='awaiting_continuation' while modal showing
   - [ ] Check continuation_deadline is set
   - [ ] After auto-close, check continuation_decision='auto_closed'

## Deployment Notes

- **3 new migrations applied** (already run in development)
- **1 file modified**: entry-monitor-coordinator.ts
- **No breaking changes** to existing functionality
- **Backward compatible** with sessions that don't have continuation fields

## Success Metrics

The fix is working correctly when:
1. ✅ Modal appears every time entry intent times out
2. ✅ Session pauses while modal is showing (no scanning)
3. ✅ User can choose "Continue" or "Close"
4. ✅ Session auto-closes after 60 seconds if no response
5. ✅ Notification sent on auto-close
6. ✅ No stuck sessions in awaiting_continuation state

## Related Files

### Modified
- `src/services/entry-monitor-coordinator.ts`

### New Migrations
- `fix_continuation_modal_flow_v2.sql`
- `add_awaiting_continuation_scan_block.sql`

### Affected Systems
- Entry monitor coordinator
- Scanning state machine
- Goal session live engine
- Modal queue manager
- Pending continuation modal handler
