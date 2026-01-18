# Trade Closure System Fix Plan

**Status**: Ready for Implementation
**Priority**: P0 - Critical Infrastructure Repair
**Estimated Time**: 30 minutes

---

## Issue Summary

The autonomous position monitor (serverless function running every 5 seconds) is calling a non-existent database function `close_position_at_sltp()`, causing all autonomous closures to fail silently. The database trigger is working correctly as the primary mechanism.

---

## Recommended Fix: Option B - Update Monitor to Use Existing Function

**Rationale**:
- The database already has a working, SSOT-compliant function: `close_goal_session_trade()`
- Creating a new function adds unnecessary complexity
- Simpler to update the TypeScript code than create new database objects

---

## Implementation Steps

### Step 1: Update Autonomous Position Monitor Function

**File**: `netlify/functions/autonomous-position-monitor.ts`

**Changes Required**:

```typescript
// BEFORE (Line 218):
const { data, error } = await supabase.rpc('close_position_at_sltp', {
  p_position_id: position.id,
  p_close_price: result.currentPrice,
  p_close_reason: closeReason
});

// AFTER:
const { data, error } = await supabase.rpc('close_goal_session_trade', {
  p_trade_id: position.id,
  p_close_price: result.currentPrice,
  p_close_reason: closeReason,
  p_goal_session_id: position.goal_session_id,
  p_force_close: false
});
```

**Parameter Mapping**:
- `p_position_id` → `p_trade_id`
- `p_close_price` → `p_close_price` (same)
- `p_close_reason` → `p_close_reason` (same)
- (new) `p_goal_session_id` → `position.goal_session_id`
- (new) `p_force_close` → `false`

### Step 2: Update Autonomous Wellness Monitor (Same Issue)

**File**: `netlify/functions/autonomous-wellness-monitor.ts`

Check if this file also calls `close_position_at_sltp()` and update if needed.

### Step 3: Update Autonomous Midtrade Executor (Same Issue)

**File**: `netlify/functions/autonomous-midtrade-executor.ts`

Check if this file also calls `close_position_at_sltp()` and update if needed.

### Step 4: Verify Position Monitoring Logs

**Check**: Confirm schema matches the code's expectations
- ✅ Schema verified - matches autonomous-position-monitor.ts expectations
- Table has: `action_taken` column (not `closure_executed`)
- Logging should work once function call is fixed

### Step 5: Testing

**Test Cases**:

1. **Simulate SL Hit**:
   - Create test trade with tight SL
   - Insert price update that triggers SL
   - Verify database trigger closes it
   - Wait 5 seconds for autonomous monitor
   - Check `position_monitoring_logs` for successful check

2. **Simulate TP Hit**:
   - Create test trade near TP
   - Insert price update that triggers TP
   - Verify database trigger closes it

3. **Manual Close**:
   - Create test trade
   - Close via frontend button
   - Verify successful closure
   - Verify balance update

4. **Force Close**:
   - Create test trade
   - Use force close option
   - Verify bypasses validation

---

## Alternative Option A: Create Missing Function (Not Recommended)

If you prefer to create the missing function instead:

```sql
CREATE OR REPLACE FUNCTION close_position_at_sltp(
  p_position_id uuid,
  p_close_price numeric,
  p_close_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_position goal_session_trades;
  v_result jsonb;
BEGIN
  -- Get position details
  SELECT * INTO v_position
  FROM goal_session_trades
  WHERE id = p_position_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Position not found');
  END IF;

  -- Delegate to close_goal_session_trade (SSOT)
  v_result := close_goal_session_trade(
    p_position_id,
    p_close_price,
    p_close_reason,
    v_position.goal_session_id,
    false -- not force close
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION close_position_at_sltp TO service_role;
```

**Why Not Recommended**: Adds another layer of indirection when we can call `close_goal_session_trade()` directly.

---

## Alternative Option C: Disable Autonomous Monitor (Simplest)

**Rationale**:
- Database trigger is working perfectly as PRIMARY mechanism
- Trigger fires on EVERY price update (real-time)
- Autonomous monitor is REDUNDANT (runs every 5 seconds)
- Saves compute resources

**How to Disable**:
1. Remove from `netlify.toml`:
   ```toml
   # Comment out or remove:
   # [functions."autonomous-position-monitor"]
   # schedule = "*/5 * * * *"
   ```

2. Keep the code for future use if needed

**Pros**:
- Simplest fix
- Reduces complexity
- Saves compute costs
- Database trigger is faster and more reliable

**Cons**:
- Loses redundancy (but trigger is very reliable)
- No backup if trigger fails (rare)

---

## Recommended Decision

**Go with Option B**: Update the serverless function to call the existing database function.

**Why**:
- Maintains redundancy (defense in depth)
- Uses existing SSOT function
- Simple code change
- Keeps autonomous monitoring for edge cases
- Provides observability via logs

---

## Post-Fix Verification

After implementing the fix:

1. **Check Netlify Logs**:
   - Should see successful `close_goal_session_trade` calls
   - No more "function not found" errors

2. **Check position_monitoring_logs**:
   ```sql
   SELECT
     COUNT(*) as checks_last_hour,
     COUNT(*) FILTER (WHERE action_taken = true) as closures,
     MAX(created_at) as last_check
   FROM position_monitoring_logs
   WHERE created_at > NOW() - INTERVAL '1 hour';
   ```

3. **Monitor for 24 Hours**:
   - Verify autonomous monitor is logging checks
   - Confirm no errors in Netlify logs
   - Check that positions close correctly

---

## Risk Assessment

**Risk Level**: 🟢 LOW

**Why Low Risk**:
- Database trigger (primary mechanism) is working perfectly
- This fix only enables the backup mechanism
- Change is isolated to serverless functions
- No database schema changes needed
- Can rollback instantly by reverting code

**Rollback Plan**:
- Revert TypeScript changes
- Or disable in netlify.toml
- Database trigger continues working regardless

---

## Success Criteria

✅ Autonomous monitor successfully calls `close_goal_session_trade()`
✅ No more "function not found" errors in Netlify logs
✅ position_monitoring_logs shows successful checks
✅ Positions close correctly via all paths:
   - Database trigger (primary)
   - Autonomous monitor (backup)
   - Manual close (user action)
   - Force close (recovery)

---

## Timeline

- Code changes: 10 minutes
- Testing: 15 minutes
- Deployment: 5 minutes
- Verification: 24 hours monitoring

**Total Active Work**: 30 minutes
**Total Monitoring**: 24 hours
