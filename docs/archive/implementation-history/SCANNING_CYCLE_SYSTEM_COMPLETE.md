# Scanning Cycle System - Implementation Complete

## Overview

The Smart Scanning Cycle System has been successfully implemented. This system prevents resource waste by limiting scanning when markets are unfavorable, while giving markets time to develop opportunities.

---

## Scanning Cycle Logic

### Session Structure
- **Session Duration**: 1 hour
- **Scan Frequency**: Every 5 minutes
- **Scans Per Session**: 12 scans (1 scan = analyzing all 5 pairs in watchlist)
- **Cooldown Period**: 15 minutes after each session
- **Maximum Cycle**: 2.5 hours (2 sessions + 2 cooldowns)
- **Lockdown**: 12 hours if no trades found after 2.5 hours

### Complete Cycle Flow

```
Session 1 (60 min, 12 scans)
    ↓
15-min Cooldown
    ↓
Session 2 (60 min, 12 scans)
    ↓
15-min Cooldown
    ↓
12-Hour Lockdown (if no trades found)
    ↓
Cycle Resets
```

### Time Breakdown
- **Session 1**: 60 minutes
- **Cooldown 1**: 15 minutes
- **Session 2**: 60 minutes
- **Cooldown 2**: 15 minutes
- **Total**: 150 minutes (2.5 hours)

---

## Database Schema

### New Fields in `goal_sessions` table:

**Session Tracking:**
- `scanning_session_number` (integer) - Current session (1 or 2)
- `scanning_session_started_at` (timestamptz) - When current session started
- `scanning_session_ends_at` (timestamptz) - When current session ends
- `cycle_started_at` (timestamptz) - When 2.5-hour cycle started

**Cooldown Tracking:**
- `cooldown_started_at` (timestamptz)
- `cooldown_ends_at` (timestamptz)

**Lockdown Tracking:**
- `lockdown_started_at` (timestamptz)
- `lockdown_ends_at` (timestamptz)

**Scan Counters:**
- `total_scans_in_cycle` (integer) - Total scans across all sessions
- `scans_in_current_session` (integer) - Scans in current 1-hour session
- `last_scan_at` (timestamptz) - Last scan timestamp

**Configuration:**
- `max_scans_per_session` (integer, default: 12)
- `scan_interval_seconds` (integer, default: 300)
- `scanning_cycle_status` (text) - 'active', 'cooldown', or 'lockdown'
- `unlimited_scanning` (boolean) - Admin bypass flag

---

## Database Functions

### `initialize_scanning_session(session_id, is_admin)`
Initializes a new scanning session with default values.

### `can_scan_now(session_id)` → jsonb
Checks if scanning is currently allowed and returns detailed status:
- `allowed` (boolean)
- `reason` (string)
- `message` (string)
- `seconds_remaining` (integer)
- `scans_remaining` (integer)
- `session_number` (integer)

### `record_scan_completion(session_id, trade_found)`
Records scan completion and optionally resets cycle if trade found.

### `trigger_scanning_cooldown(session_id)`
Triggers 15-minute cooldown period after session completion.

### `trigger_scanning_lockdown(session_id)`
Triggers 12-hour lockdown after 2.5 hours with no trades.

### `reset_scanning_cycle(session_id)`
Completely resets the scanning cycle to start fresh.

### `reset_scanning_cycle_counters(session_id)`
Resets counters when trade found but keeps session active.

### `start_next_scanning_session(session_id)`
Starts next 1-hour session after cooldown expires.

---

## Services

### `/src/services/scanning-state-machine.ts`

Main service for managing scanning cycle state:

```typescript
// Check if scanning is allowed
const permission = await scanningStateMachine.canScanNow(sessionId);

// Record scan completion
await scanningStateMachine.recordScanCompletion(sessionId, tradeFound);

// Get session status for dashboard
const status = await scanningStateMachine.getSessionStatus(sessionId);

// Subscribe to real-time updates
const unsubscribe = scanningStateMachine.subscribeToSessionStatus(sessionId, callback);
```

---

## Frontend Integration

### `/src/components/ScanningStatusDisplay.tsx`

React component that shows real-time scanning status with countdown timers:

**Active State (Green):**
- Pulse animation
- Session number (1/2 or 2/2)
- Scans completed/remaining
- Next scan countdown
- Session end countdown
- Progress bar

**Cooldown State (Yellow):**
- Clock icon
- 15-minute countdown
- Session complete message
- Next session info
- Progress bar

**Lockdown State (Red):**
- Warning icon
- 12-hour countdown
- Total scans attempted
- Suggestions for improvement
- Progress bar

**Admin Mode (Purple):**
- Special indicator
- "Unlimited Scanning" message
- All limits bypassed

### Usage:

```tsx
import { ScanningStatusDisplay } from './components/ScanningStatusDisplay';

<ScanningStatusDisplay
  sessionId={session.id}
  isAdmin={user.role === 'admin'}
/>
```

---

## Scanner Integration

### `/src/services/goal-scanner.ts`

Updated to use state machine:

```typescript
// STEP 1: Check permission
const scanPermission = await scanningStateMachine.canScanNow(sessionId);

if (!scanPermission.allowed) {
  // Add AI message explaining why blocked
  return [];
}

// STEP 2: Perform scan
const results = await this.scanMarket(sessionId, userId);
const tradeFound = results.some(r => r.hasValidSetup);

// STEP 3: Record completion
await scanningStateMachine.recordScanCompletion(sessionId, tradeFound);
```

---

## Edge Function Integration

### `/supabase/functions/goal-session-scanner/index.ts`

Updated to validate before scanning:

```typescript
// Check if scanning is allowed for this session
const { data: scanPermission } = await supabase
  .rpc('can_scan_now', { p_session_id: session.id });

if (!scanPermission?.allowed) {
  // Add AI message explaining the block
  await supabase.from('goal_ai_conversations').insert({
    goal_session_id: session.id,
    user_id: session.user_id,
    role: 'ai',
    message: scanPermission.message,
    context: {
      scanning_blocked: true,
      reason: scanPermission.reason
    }
  });
  continue;
}

// Proceed with scan...
```

---

## State Transitions

### Active → Cooldown
**Triggers:**
- 12 scans completed in current session
- 60 minutes elapsed
- Manual trigger

**Actions:**
- Set status to 'cooldown'
- Set cooldown timestamps (15 minutes)
- Create notification
- Pause scanning

### Cooldown → Active
**Triggers:**
- 15 minutes elapsed
- Under 2.5 hours total time

**Actions:**
- Increment session number
- Reset session counters
- Set status to 'active'
- Resume scanning

### Cooldown → Lockdown
**Triggers:**
- 15 minutes elapsed
- 2.5 hours total time reached
- No trades found

**Actions:**
- Set status to 'lockdown'
- Set lockdown timestamps (12 hours)
- Create urgent notification
- Stop scanning completely

### Lockdown → Active
**Triggers:**
- 12 hours elapsed

**Actions:**
- Reset all counters
- Reset to session 1
- Set status to 'active'
- Resume scanning

### Trade Found → Reset Counters
**Triggers:**
- Valid trade executed

**Actions:**
- Reset `total_scans_in_cycle` to 0
- Reset `scans_in_current_session` to 0
- Reset `cycle_started_at` to now
- Keep current state
- Continue scanning

---

## Admin Override

Admins can bypass all scanning limits:

```typescript
// Enable unlimited scanning
await scanningStateMachine.enableUnlimitedScanning(sessionId);

// Check if unlimited
const isUnlimited = await scanningStateMachine.isUnlimitedScanning(sessionId);

// Disable unlimited scanning
await scanningStateMachine.disableUnlimitedScanning(sessionId);
```

When `unlimited_scanning = true`:
- `can_scan_now()` always returns `allowed: true`
- No cooldowns
- No lockdowns
- No session limits
- Infinite scans

---

## Notifications

### Cooldown Notification
**Type**: Info
**Priority**: Medium
**Message**: "Session complete. No quality trades found. Taking a 15-minute break before resuming."

### Lockdown Notification
**Type**: Warning
**Priority**: High
**Message**: "No quality trades found after 2.5 hours. Markets may be unfavorable. Scanning paused for 12 hours to preserve resources."

**Includes**:
- Total scans attempted
- Lockdown end time
- Suggestions for improvement

---

## Scanning Analytics

The system tracks:
- **Session Success Rate**: Trades found / Total scans
- **Average Scans Before Trade**: Total scans / Trades found
- **Cooldown Frequency**: Per user, per day
- **Lockdown Frequency**: Per user, per week
- **Most Successful Scan Times**: Which 5-minute intervals find trades
- **Watchlist Effectiveness**: Which pairs produce results

Use this data to optimize scan timing and watchlist recommendations.

---

## Testing

### Test Active Scanning
1. Start a new goal session
2. Verify status shows "Active Scanning"
3. Verify session number shows "Session 1/2"
4. Verify scans remaining shows "12"
5. Trigger scan manually
6. Verify counter increments

### Test Cooldown
1. Complete 12 scans in active session
2. Verify status changes to "Cooldown Break"
3. Verify 15-minute countdown appears
4. Verify notification created
5. Wait for cooldown to expire
6. Verify transitions to "Session 2"

### Test Lockdown
1. Complete Session 1 (12 scans, no trades)
2. Wait 15-minute cooldown
3. Complete Session 2 (12 scans, no trades)
4. Wait 15-minute cooldown
5. Verify status changes to "Lockdown"
6. Verify 12-hour countdown appears
7. Verify urgent notification created

### Test Trade Found
1. Start scanning
2. Execute a trade
3. Verify counters reset to 0
4. Verify cycle timer resets
5. Verify session continues active

### Test Admin Bypass
1. Enable unlimited scanning for admin user
2. Verify "Admin Mode - Unlimited Scanning" appears
3. Verify no cooldowns trigger
4. Verify no lockdowns trigger
5. Verify can scan infinitely

---

## Summary

The Smart Scanning Cycle System is now fully operational:

✅ Database schema with all tracking fields
✅ State machine service with validation functions
✅ Scanner integration with permission checks
✅ Edge function validation before scanning
✅ UI components with countdown timers
✅ Admin override capability
✅ Notification system for state changes
✅ Automatic cycle reset when trades found
✅ Build tested and verified

**Result**: Efficient resource usage, disciplined market scanning, and clear user feedback through all states.
