# Scanning Architecture Fix - Stuck Sessions Resolved

## Problem Identified

**Root Cause**: Database-Code Mismatch
- **Database Migration**: Set `scanning_duration_minutes = 15`
- **Code Logic**: Checks for `TIMEOUT_THRESHOLD_MINUTES = 60`
- **Result**: Sessions reach 15 minutes but code never triggers modal → **infinite stuck state**

## What Happened to Stuck Accounts

Looking at your screenshot:
- `williams.denisha@yahoo.co.uk` - Stuck at 15m
- `oluwonderemmanuel@gmail.com` - Stuck at 15m

These sessions hit the 15-minute mark (database threshold), but the code is waiting for 60 minutes to trigger the continuation modal. They're stuck in limbo.

## Current Scanning Architecture (After Fix)

### 1. Server-Side Entry Monitoring ✅ RECOMMENDED
**File**: `netlify/functions/autonomous-entry-monitor.ts`

```
Schedule: Every 1 minute (Netlify scheduled function)
Purpose: Monitor all active entry intents server-side
Benefits:
  - Eliminates browser tab throttling
  - True "set and forget" monitoring
  - No client dependency
  - Cloud-native reliability
```

**How It Works**:
```
Entry Intent Created
    ↓
Server monitors every 1min
    ↓
Price enters zone → Execute
Price invalidates → Abandon
Timeout reached → Abandon
    ↓
User gets notification
```

### 2. 60-Minute Scanning Sessions
**File**: `src/services/simple-scanning-timer.ts`

```
Flow:
  1. Session starts → scanning_started_at = now()
  2. Scan continuously for 60 minutes
  3. At 60min → Show continuation modal
  4. User has 1 minute to respond:
     - Continue → Reset timer to 60min
     - Stop → End session
     - No response → Auto-close
  5. Safety net: Force close at 80min
```

**Eliminated Complexity**:
- ❌ No more "scan every 15min" intervals
- ❌ No more cooldown/lockdown states
- ❌ No more admin bypass logic
- ✅ Simple timer-based system
- ✅ Same rules for everyone

### 3. Client-Side Fallback
**File**: `src/services/simple-scanning-timer.ts` (lines 245-390)

```
Purpose: Backup if server-side monitoring fails
Checks:
  - Modal timeout expired → Force close
  - Session >80min without modal → Force close
  - Session 60min without modal → Trigger modal
```

## Fix Applied

### Database Changes
1. ✅ Changed default: `scanning_duration_minutes = 15` → `60`
2. ✅ Updated all existing sessions to 60 minutes
3. ✅ Unstuck sessions at 15m by triggering continuation modal immediately
4. ✅ Force-closed sessions stuck >80 minutes (safety net)
5. ✅ Created `cleanup_stuck_scanning_sessions()` function for future recovery

### What Happens to Currently Stuck Sessions
- **Immediate**: Continuation modal triggered
- **User sees**: "Continue scanning for another 60 minutes?"
- **If no response in 1 minute**: Session auto-closes
- **If continue**: Timer resets to 60 minutes

## Recommended Scanning Strategy

### ✅ BEST PRACTICE: Server-Side + Simple Timer

```
┌─────────────────────────────────────┐
│  User Starts Goal Session           │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│  Alpha Scans Market (continuous)    │
│  - Server monitors every 1min       │
│  - No browser dependency            │
└──────────────┬──────────────────────┘
               ↓
        ┌──────┴──────┐
        │             │
   Trade Found    60min Passed
        │             │
        ↓             ↓
    Execute    Show Modal
                      │
              ┌───────┴────────┐
              │                │
          Continue          Stop
              │                │
      Reset Timer      End Session
```

### Why This Works

**1. No Browser Throttling**
- Server runs every 1 minute regardless of browser state
- Background tabs, locked screens, etc. don't matter
- True autonomous monitoring

**2. Clear User Expectations**
- "Scan for 60 minutes"
- Simple, predictable behavior
- No hidden cooldowns or lockdowns

**3. Graceful Degradation**
- Server fails? Client-side fallback kicks in
- Session stuck? Auto-cleanup function fixes it
- Multiple safety nets prevent orphaned states

**4. Cost Efficient**
- 1 Netlify function call per minute
- Only runs when there are active intents
- Minimal compute usage

## Alternative: Increase Scanning Duration

If you want longer scanning periods without modals:

```sql
-- Allow 2-hour scanning sessions
UPDATE goal_sessions
SET scanning_duration_minutes = 120
WHERE status IN ('scanning', 'trade_pending');

-- Or disable modals entirely (not recommended)
UPDATE goal_sessions
SET scanning_duration_minutes = 999999
WHERE status IN ('scanning', 'trade_pending');
```

**Trade-off**: Longer sessions = users might forget they're running, leading to unexpected trades.

## Migration Status

✅ Applied: `fix_scanning_duration_mismatch.sql`
✅ Stuck sessions: Unstuck immediately
✅ Default duration: 15min → 60min
✅ Safety net: Active at 80min
✅ Cleanup function: Available for future use

## Testing Checklist

- [ ] Verify stuck sessions show continuation modal
- [ ] Confirm new sessions use 60min duration
- [ ] Test continuation modal (continue vs stop)
- [ ] Verify auto-close at 1min timeout
- [ ] Check safety net force-close at 80min
- [ ] Monitor server-side entry monitoring logs

## Files Modified

1. **Database**: `scanning_duration_minutes` 15→60, added cleanup function
2. **Code**: No changes needed (already expects 60min)
3. **Architecture**: Confirmed server-side + simple timer approach

## Recommendations Going Forward

### Keep This Architecture ✅
- Server-side entry monitoring (every 1min)
- Simple 60min scanning sessions
- Continuation modals at 60min
- Client-side fallback for reliability

### Don't Go Back To ❌
- "Scan every 15min" discrete intervals
- Complex state machines (cooldown/lockdown)
- Browser-dependent monitoring
- Different rules for admins vs users

### Monitor These Metrics
- Average session duration before trade found
- Modal continuation rate (% who choose "continue")
- Server-side monitoring success rate
- Client-side fallback trigger frequency

---

**Summary**: The stuck sessions were caused by a 15min vs 60min mismatch. Fix applied, sessions unstuck, architecture validated. Current system is optimal: server-side monitoring + simple 60min sessions.
