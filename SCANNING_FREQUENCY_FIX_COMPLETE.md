# Scanning Frequency Control - FIX COMPLETE ✅

## Problem
The autonomous trading engine was scanning **on every candle update** (polling interval) instead of respecting the configured scanning intervals. This caused:
- Excessive AI calls (wasting credits)
- Unnecessary market evaluations
- Violation of the scanning state machine design

## Root Cause
The `processCandleAutonomous()` method was being called on every polling cycle without checking if a scan was actually due according to the scanning state machine rules.

## Scanning State Machine Rules
The system has a sophisticated state machine with three states:

### 1. Active State
- **Duration**: 60 minutes per session
- **Frequency**: Scan every 5 minutes (12 scans max per session)
- **Behavior**: Full market evaluation with AI analysis

### 2. Cooldown State
- **Duration**: 15 minutes
- **Trigger**: After completing a 60-minute active session
- **Behavior**: Monitor open positions only, no new scans

### 3. Lockdown State
- **Duration**: 12 hours
- **Trigger**: After 2.5 hours (two sessions + cooldown) with no trades
- **Behavior**: Monitor open positions only, market deemed unfavorable

### Cycle Reset
- When a trade is found and executed, the cycle counters reset
- This prevents lockdown and keeps scanning active when opportunities exist

## Implementation

### Changes Made

#### 1. Import Scanning State Machine
**File**: `/tmp/cc-agent/58035261/project/src/services/goal-session-live-engine.ts`

Added import:
```typescript
import { scanningStateMachine } from './scanning-state-machine';
```

#### 2. Add Scan Permission Check
Added at the start of `processCandleAutonomous()` (after user continuation check):

```typescript
// ⏱️ CHECK: Scanning frequency control via state machine
const scanState = await scanningStateMachine.canScanNow(this.activeSession);

console.log('%c[AUTONOMOUS ENGINE] ⏱️ Scanning State Machine Check:', 'color: #3b82f6; font-weight: bold', {
  allowed: scanState.allowed,
  status: scanState.status,
  reason: scanState.reason,
  message: scanState.message,
  sessionNumber: scanState.sessionNumber,
  scansRemaining: scanState.scansRemaining,
  secondsRemaining: scanState.secondsRemaining
});

if (!scanState.allowed) {
  logger.debug(LogCategory.AI_TRADING, `⏸️ Scanning blocked by state machine: ${scanState.reason}`);
  console.log('%c[AUTONOMOUS ENGINE] ⏸️ SCAN BLOCKED: ' + scanState.message, 'color: #f59e0b; font-weight: bold');

  // Still monitor open positions during cooldown/lockdown
  await this.monitorOpenPositionsOnly();
  return;
}

// ✅ Scanning allowed - proceed with market evaluation
console.log('%c[AUTONOMOUS ENGINE] ✅ Scan permission GRANTED', 'color: #10b981; font-weight: bold');
```

#### 3. Record Scan Completion (Multi-Symbol Mode)
Added at the end of `processMultiSymbolCycle()`:

```typescript
finally {
  // Record scan completion for state machine tracking
  try {
    await scanningStateMachine.recordScanCompletion(this.activeSession!, tradeExecuted);
    console.log(`[MULTI-SYMBOL] 📊 Scan completion recorded: Trade found = ${tradeExecuted}`);
  } catch (error) {
    logger.error(LogCategory.AI_TRADING, 'Failed to record scan completion', { error });
  }
}
```

#### 4. Record Scan Completion (Single-Symbol Mode)
Added at the end of `processCandleAutonomous()`:

```typescript
// Record scan completion for state machine tracking
try {
  await scanningStateMachine.recordScanCompletion(this.activeSession, tradeExecuted);
  console.log(`[AUTONOMOUS ENGINE] 📊 Scan completion recorded: Trade found = ${tradeExecuted}`);
} catch (error) {
  logger.error(LogCategory.AI_TRADING, 'Failed to record scan completion', { error });
}
```

## Expected Behavior After Fix

### Normal Scanning Flow
1. **Polling runs continuously** (checks for candle updates)
2. **Scanning happens at 5-minute intervals** (when state machine allows)
3. **Open positions are monitored** even when scanning is blocked
4. **Cooldowns are respected** (15-minute breaks between sessions)
5. **Lockdowns trigger correctly** (12 hours after 2.5 hours with no trades)

### Console Output Examples

#### When Scanning is Allowed
```
[AUTONOMOUS ENGINE] ⏱️ Scanning State Machine Check:
  allowed: true
  status: active
  reason: scan_allowed
  sessionNumber: 1
  scansRemaining: 11
  secondsRemaining: 300

[AUTONOMOUS ENGINE] ✅ Scan permission GRANTED
[AUTONOMOUS ENGINE] Session 1/2 - 11 scans remaining
```

#### When Scanning is Blocked (Cooldown)
```
[AUTONOMOUS ENGINE] ⏱️ Scanning State Machine Check:
  allowed: false
  status: cooldown
  reason: in_cooldown
  message: 15-minute break between sessions

[AUTONOMOUS ENGINE] ⏸️ SCAN BLOCKED: 15-minute break between sessions
[AUTONOMOUS ENGINE] Status: cooldown
[AUTONOMOUS ENGINE] Cooldown ends at: 2024-12-17T15:45:00Z
```

#### When Scanning is Blocked (Lockdown)
```
[AUTONOMOUS ENGINE] ⏱️ Scanning State Machine Check:
  allowed: false
  status: lockdown
  reason: in_lockdown
  message: Markets unfavorable - 12-hour pause

[AUTONOMOUS ENGINE] ⏸️ SCAN BLOCKED: Markets unfavorable - 12-hour pause
[AUTONOMOUS ENGINE] Status: lockdown
[AUTONOMOUS ENGINE] Lockdown ends at: 2024-12-18T03:30:00Z
```

## Admin Override

Admins can enable unlimited scanning by setting `unlimited_scanning = true` on a goal session:

```typescript
await scanningStateMachine.enableUnlimitedScanning(sessionId);
```

This bypasses all frequency controls for testing/development.

## Benefits

✅ **Massive credit savings** - Only scan when needed, not on every candle update
✅ **Respects user limits** - Enforces cool-downs and lockdowns as designed
✅ **Better market timing** - Prevents analysis paralysis from over-scanning
✅ **Clear visibility** - Console logs show exactly why scans are blocked
✅ **Smart cycle management** - Resets on successful trades, locks down on poor conditions

## Database Functions Used

The scanning state machine relies on these database functions:
- `can_scan_now(p_session_id)` - Check if scanning is allowed
- `record_scan_completion(p_session_id, p_trade_found)` - Record scan and update counters
- `initialize_scanning_session(p_session_id, p_is_admin)` - Setup scanning state

These functions are defined in:
`/tmp/cc-agent/58035261/project/supabase/migrations/20251216062723_20251216_120000_create_scanning_cycle_system.sql`

## Testing

Build completed successfully ✅

To test the fix:
1. Start a goal session
2. Observe console logs showing scan permission checks
3. Verify scans happen at ~5 minute intervals (not every polling cycle)
4. Confirm cooldowns trigger after 12 scans
5. Verify open positions are monitored during cooldowns

## Files Modified

- `/tmp/cc-agent/58035261/project/src/services/goal-session-live-engine.ts` (4 changes)
  - Added scanning state machine import
  - Added scan permission check before expensive operations
  - Added trade execution tracking
  - Added scan completion recording for both scan modes

## Deploy

When ready to deploy:
```bash
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

---

**Status**: ✅ COMPLETE
**Date**: 2024-12-17
**Build**: Verified successful
