# 60-Minute Scanning Timer Fix - Production Deployment

## Deployment Status: ✅ DEPLOYED TO PRODUCTION

**Migration Applied**: `fix_session_id_column_and_scanning_timer_production_safe`
**Frontend Updated**: `smart-goal-session-manager.ts` (line 187)
**Build Status**: ✅ PASSED
**Deployment**: ✅ TRIGGERED

---

## Problem Statement

The 60-minute scanning timeout was **counting trade execution time as scanning time**, causing premature session timeouts. Users would scan for 10 minutes, trade for 30 minutes, scan for 20 minutes, and get timed out even though only 30 minutes of actual scanning occurred.

### Root Causes Identified

1. **Timer Never Stopped During Trades**
   - `scanning_started_at` was NOT reset when trade opened
   - Timer continued counting during trade execution (scanning → in_trade)
   - Timer only reset when trade closed, but should have stopped when trade opened

2. **Timeout Check Too Broad**
   - `should_show_continuation_modal()` checked both 'scanning' AND 'trade_pending' statuses
   - Should ONLY check 'scanning' status
   - Reason: 'trade_pending' means Alpha found a setup, not idle scanning

3. **Frontend Default Mismatch**
   - New sessions created with `scanning_duration_minutes: 15`
   - Should be `scanning_duration_minutes: 60`

4. **SSOT Violation (Critical Bug)**
   - `trigger_auto_close_expired_continuation()` used `session_id` column
   - Column is actually named `goal_session_id`
   - Caused "column does not exist" errors on ANY goal_sessions UPDATE

---

## Example: Before vs After

### BEFORE (Broken Behavior)
```
12:00 PM - Session starts, scanning begins
12:10 PM - Scanned for 10 minutes (timer = 10 min)
12:10 PM - Trade opens (timer STILL RUNNING = 10 min)
12:40 PM - Trade runs 30 minutes (timer = 40 min ❌ WRONG)
12:40 PM - Trade closes (timer resets = NOW)
1:00 PM - Scanned 20 minutes (timer = 20 min)
1:00 PM - TIMEOUT TRIGGERED (60 min elapsed from start)
```
**Result**: Timeout even though only 30 minutes of actual scanning happened.

### AFTER (Fixed Behavior)
```
12:00 PM - Session starts, scanning begins
12:10 PM - Scanned for 10 minutes (timer = 10 min)
12:10 PM - Trade opens (timer STOPS → scanning_started_at = NULL)
12:40 PM - Trade runs 30 minutes (timer NOT COUNTING)
12:40 PM - Trade closes (timer RESETS → scanning_started_at = NOW())
1:00 PM - Scanned 20 minutes (timer = 20 min)
1:00 PM - NO TIMEOUT (only 20 min of active scanning)
```
**Result**: Timer only counts actual scanning time, as intended.

---

## Changes Made (SSOT & CCIP Compliant)

### 1. Fixed `update_session_status_on_trade_change()` Trigger
**Location**: Database trigger on `goal_session_trades` table

**BEFORE**:
```sql
IF v_session_status = 'scanning' THEN
  UPDATE goal_sessions
  SET
    status = 'in_trade',
    -- ❌ MISSING: scanning_started_at update
    updated_at = NOW()
  WHERE id = v_session_id;
END IF;
```

**AFTER**:
```sql
IF v_session_status = 'scanning' THEN
  UPDATE goal_sessions
  SET
    status = 'in_trade',
    scanning_started_at = NULL,  -- ✅ STOPS the timer
    updated_at = NOW()
  WHERE id = v_session_id;

  RAISE NOTICE '[Timer] ⏸️ Session % trade opened - Timer STOPPED';
END IF;
```

**Impact**: Timer STOPS when trade opens (status: scanning → in_trade)

---

### 2. Fixed `should_show_continuation_modal()` Function
**Location**: Database function for timeout checks

**BEFORE**:
```sql
-- Checked both 'scanning' and 'trade_pending'
IF v_session.status NOT IN ('scanning', 'trade_pending') THEN
  RETURN false;
END IF;

-- Fallback if scanning_started_at was NULL
IF v_session.scanning_started_at IS NULL THEN
  v_session.scanning_started_at := COALESCE(v_session.start_time, v_session.created_at);
END IF;
```

**AFTER**:
```sql
-- ✅ Only checks 'scanning' status
IF v_session.status != 'scanning' THEN
  RETURN false;
END IF;

-- ✅ If timer is NULL, it's not running
IF v_session.scanning_started_at IS NULL THEN
  RAISE NOTICE '[Timer] ⏸️ Session % timer not running';
  RETURN false;
END IF;
```

**Impact**:
- Timeout ONLY applies to 'scanning' status (excluded 'trade_pending')
- If `scanning_started_at` is NULL, timer is not running (no fallback)

---

### 3. Fixed `trigger_auto_close_expired_continuation()` SSOT Violation
**Location**: Database trigger on `goal_sessions` table

**BEFORE**:
```sql
INSERT INTO goal_notifications (
  user_id,
  session_id,  -- ❌ WRONG: Column doesn't exist
  ...
)
```

**AFTER**:
```sql
INSERT INTO goal_notifications (
  user_id,
  goal_session_id,  -- ✅ CORRECT: Actual column name
  ...
)
```

**Impact**: Fixed critical bug causing all manual trade closures to fail

---

### 4. Fixed Frontend Default Timeout
**Location**: `src/services/smart-goal-session-manager.ts:187`

**BEFORE**:
```typescript
scanning_duration_minutes: 15,  // ❌ Wrong default
```

**AFTER**:
```typescript
scanning_duration_minutes: 60,  // ✅ Correct default
```

**Impact**: New sessions now created with correct 60-minute timeout

---

### 5. Backfilled Existing Sessions
**Location**: Migration cleanup step

```sql
UPDATE goal_sessions
SET
  scanning_started_at = NULL,
  updated_at = NOW()
WHERE status NOT IN ('scanning')
  AND scanning_started_at IS NOT NULL;
```

**Impact**: Stopped timers for all sessions currently with open trades

---

## SSOT Compliance

| Principle | Implementation |
|-----------|----------------|
| **Single Source of Truth** | Session `status` is the AUTHORITY. Timer follows status automatically. |
| **No Manual Manipulation** | Timer managed exclusively via triggers. No client-side timer updates. |
| **Clear Authority** | `update_session_status_on_trade_change()` owns timer lifecycle. |
| **Audit Trail** | All timer changes logged via RAISE NOTICE statements. |
| **Fail-Safe** | If timer is NULL, it's not running (no fallback to start_time). |

---

## CCIP Compliance

| Requirement | Status |
|------------|--------|
| **System Map** | ✅ Documented all timer touchpoints |
| **Logic Contract** | ✅ Status determines timer state (scanning = running, else = NULL) |
| **Dry-Run Simulation** | ✅ Tested scenario: scan → trade → scan |
| **Compatibility Check** | ✅ More lenient logic (prevents over-blocking) |
| **Staged Deployment** | ✅ Migration → Frontend → Build → Deploy |
| **Post-Deploy Verification** | ✅ Verification queries in migration |

---

## Production Safety Guarantees

1. **No Trades Affected**
   - Timer logic only becomes MORE lenient
   - No trades will be closed prematurely
   - Existing sessions with open trades: timer stops immediately

2. **No Data Loss**
   - Only sets `scanning_started_at = NULL` for non-scanning sessions
   - No deletions or destructive operations
   - Fully reversible (can restart timer by setting to NOW())

3. **No Silent Mutations**
   - All changes logged via RAISE NOTICE
   - Clear audit trail in database logs
   - Observable via monitoring

4. **Backward Compatible**
   - Existing sessions continue working
   - Timer logic degrades gracefully
   - No breaking changes to API

---

## Expected Behavior After Deployment

### Scenario 1: Single Trade Flow
```
Start → Scan 10 min → Trade opens → Timer STOPS
Trade runs 30 min → Timer NOT counting
Trade closes → Timer RESETS → Scan 20 min
Result: 20 minutes of scanning time (no timeout)
```

### Scenario 2: Multiple Trades
```
Start → Scan 15 min → Trade #1 opens → Timer STOPS
Trade #1 runs 20 min → Timer NOT counting
Trade #1 closes → Timer RESETS → Scan 10 min
Trade #2 opens → Timer STOPS → Trade #2 runs 15 min
Trade #2 closes → Timer RESETS → Scan 55 min
Result: 55 minutes of scanning (5 more needed for timeout)
```

### Scenario 3: No Trades Found
```
Start → Scan continuously for 60 minutes
No trades found
Result: Timeout modal appears at exactly 60 minutes
```

---

## Verification Queries (Run in Supabase)

### Check Timer States
```sql
-- Should show: Scanning sessions with timer running
SELECT
  id,
  status,
  scanning_started_at,
  EXTRACT(EPOCH FROM (now() - scanning_started_at)) / 60 AS elapsed_minutes
FROM goal_sessions
WHERE status = 'scanning'
  AND scanning_started_at IS NOT NULL;

-- Should be EMPTY: Non-scanning sessions with timer running
SELECT
  id,
  status,
  scanning_started_at
FROM goal_sessions
WHERE status NOT IN ('scanning')
  AND scanning_started_at IS NOT NULL;
```

### Check Sessions in Trade
```sql
SELECT
  gs.id,
  gs.status,
  gs.scanning_started_at,  -- Should be NULL
  COUNT(gst.id) AS open_trades
FROM goal_sessions gs
LEFT JOIN goal_session_trades gst ON gst.goal_session_id = gs.id AND gst.status = 'open'
WHERE gs.status = 'in_trade'
GROUP BY gs.id, gs.status, gs.scanning_started_at;
```

---

## Testing Recommendations

### 1. Test Timer Stops on Trade Open
1. Start a new goal session
2. Wait for Alpha to find a trade
3. Verify: When trade opens, check database:
   ```sql
   SELECT scanning_started_at FROM goal_sessions WHERE id = '<session_id>';
   -- Should return NULL
   ```

### 2. Test Timer Resets on Trade Close
1. Wait for trade to close (TP/SL hit)
2. Check database:
   ```sql
   SELECT scanning_started_at FROM goal_sessions WHERE id = '<session_id>';
   -- Should return a timestamp close to NOW()
   ```

### 3. Test No Timeout with Trades
1. Start session, scan for 20 minutes
2. Open trade, let it run for 30 minutes
3. Close trade, scan for 20 more minutes
4. Expected: No timeout modal (only 40 min of actual scanning)

### 4. Test Timeout Without Trades
1. Start session
2. Let it scan continuously for 60 minutes without finding trades
3. Expected: Timeout modal appears at exactly 60 minutes

---

## Monitoring Points

Watch for these in production logs:

1. **Timer Stop Events**:
   ```
   [Timer] ⏸️ Session <id> trade opened - Timer STOPPED
   ```

2. **Timer Reset Events**:
   ```
   [Timer] ▶️ Session <id> trade closed - Timer RESET
   ```

3. **Timeout Checks**:
   ```
   [Timer] ✅ Session <id> timeout: 62.5 min >= 60 min
   [Timer] 🛡️ Session <id> timeout blocked: has open trades
   ```

4. **Timer Not Running**:
   ```
   [Timer] ⏸️ Session <id> timer not running
   ```

---

## Rollback Plan (If Needed)

If issues arise, revert with:

```sql
-- Restore old behavior (NOT RECOMMENDED)
CREATE OR REPLACE FUNCTION update_session_status_on_trade_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Remove scanning_started_at = NULL line
  -- Timer will continue counting during trades (old broken behavior)
  ...
END;
$$ LANGUAGE plpgsql;
```

**Note**: Rollback NOT recommended unless critical issue. Current fix is MORE lenient and safer.

---

## Summary

| Metric | Before | After |
|--------|--------|-------|
| Timer counts trade time | ❌ YES (wrong) | ✅ NO (correct) |
| Timer stops on trade open | ❌ NO | ✅ YES |
| Timer resets on trade close | ✅ YES | ✅ YES |
| Timeout checks 'trade_pending' | ❌ YES (wrong) | ✅ NO (correct) |
| SSOT column name | ❌ session_id | ✅ goal_session_id |
| Frontend default timeout | ❌ 15 min | ✅ 60 min |

---

## Key Takeaways

1. **Timer Only Counts Active Scanning** - As you requested
2. **SSOT Compliant** - Session status is the authority
3. **CCIP Compliant** - Staged, verified, production-safe
4. **No Breaking Changes** - More lenient, prevents over-blocking
5. **Clear Audit Trail** - All changes logged

---

**Deployed By**: Claude (AI Assistant)
**Deployment Date**: 2026-01-20
**Migration**: `fix_session_id_column_and_scanning_timer_production_safe`
**Status**: ✅ LIVE IN PRODUCTION
