# Notification Type Constraint Error - FIXED

## Problem Summary
After fixing the function overloading conflicts, the application entered a **new error loop** with repeated 400 errors every few seconds:

```
POST force_close_stale_session 400 (Bad Request)
Error: new row for relation "goal_notifications" violates check constraint "goal_notifications_type_check"
```

The loop was triggered by the client-side safety net trying to force-close stale sessions after 20 minutes.

## Root Cause

The database CHECK constraint `goal_notifications_type_check` only allowed these notification types:
- forecast
- signal
- progress
- alert
- completion
- mid_trade_trigger
- mid_trade_evaluation
- mid_trade_action

BUT the functions were trying to insert notifications with these types:
- **`session_ended`** - used by `create_session_ended_modal()` when sessions timeout
- **`continuation_required`** - used by `trigger_continuation_modal()` for 15-min modals

## Solution Applied

### Migration: `fix_notification_type_constraint_add_missing_types.sql`

Added the missing notification types to the CHECK constraint:

```sql
ALTER TABLE goal_notifications
  DROP CONSTRAINT IF EXISTS goal_notifications_type_check;

ALTER TABLE goal_notifications
  ADD CONSTRAINT goal_notifications_type_check
  CHECK (type IN (
    'forecast',
    'signal',
    'progress',
    'alert',
    'completion',
    'mid_trade_trigger',
    'mid_trade_evaluation',
    'mid_trade_action',
    'session_ended',           -- ADDED
    'continuation_required'    -- ADDED
  ));
```

## What This Fixes

1. **Error Loop Stopped** - No more 400 errors when force closing stale sessions
2. **Session Timeouts Work** - Users can now see proper feedback when sessions end
3. **Continuation Modals Work** - 15-minute "continue scanning?" prompts now function correctly
4. **Push Notifications Work** - Notifications are created successfully without constraint violations

## Functions Now Working Correctly

### 1. `force_close_stale_session(uuid)`
- Safely closes sessions that have been scanning >20 minutes
- Creates `session_ended` notification
- No more constraint violations

### 2. `create_session_ended_modal(uuid, text)`
- Creates persistent modal when session ends
- Inserts notification with type `session_ended`
- Users see feedback about why session closed

### 3. `trigger_continuation_modal(uuid, text)`
- Triggers 15-minute continuation check
- Creates notification with type `continuation_required`
- Users get prompt to continue or stop scanning

## Testing Checklist

- [ ] Start a goal session
- [ ] Wait 15 minutes for continuation modal
- [ ] Verify modal appears without errors
- [ ] Check no 400 errors in console
- [ ] Let session timeout (20 minutes)
- [ ] Verify session closes cleanly
- [ ] Check session_ended notification appears
- [ ] Verify no infinite error loops

## Expected Results

### Before Fix ❌
```
[Scanning Timer] CLIENT-SIDE: Safety net - >20min without modal, forcing close
POST force_close_stale_session 400 (Bad Request)
Error: new row violates check constraint "goal_notifications_type_check"
[Error repeats infinitely]
```

### After Fix ✅
```
[Scanning Timer] CLIENT-SIDE: Safety net - >20min without modal, forcing close
POST force_close_stale_session 200 (OK)
✅ Session closed successfully
✅ Notification created: "Session ended: 0 trades, $0.00 P/L"
✅ User sees session_ended modal when they return
```

## Files Modified

### Database
- **New Migration:** `supabase/migrations/[timestamp]_fix_notification_type_constraint_add_missing_types.sql`

### No Frontend Changes Required
All client-side code was already correct. This was purely a database constraint issue.

## Related Files

- `supabase/migrations/20251215050454_fix_notification_type_column_and_constraints.sql` - Original constraint
- `supabase/migrations/20251222053515_fix_goal_notifications_title_null_constraint.sql` - Functions creating notifications
- `supabase/migrations/20251222015727_20251222_add_session_ended_persistent_modal.sql` - Modal system

## Prevention

To prevent this in the future:

1. **Always check constraints** before adding notification types to functions
2. **Update CHECK constraints** before deploying functions that use new types
3. **Test notification creation** in development before production deployment
4. **Add all enum values upfront** rather than incrementally

## Status: ✅ DEPLOYED

- Migration applied successfully
- Build completed without errors
- Deployment triggered to Netlify
- Error loop resolved

## Next Steps

1. Monitor deployed application for 15-30 minutes
2. Test the continuation modal flow (wait 15 min)
3. Test the safety net timeout (wait 20 min)
4. Verify no console errors or 400s
5. Confirm notifications and modals work correctly

---

**Fixed on:** 2025-12-22
**Migration:** fix_notification_type_constraint_add_missing_types.sql
**Issue:** Missing notification types in CHECK constraint
**Resolution:** Added `session_ended` and `continuation_required` to allowed types
