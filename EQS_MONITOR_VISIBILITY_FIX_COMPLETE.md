# EQS Monitor Visibility Fix - Complete

## Problem Description

The Entry Quality Monitor component was not appearing when monitoring started. Instead:
- Monitor remained invisible during monitoring
- Only appeared after trying to close the session
- Required closing the session twice to see the monitor
- Console showed EQS calculations happening but UI didn't update

## Root Causes Identified

### 1. Component Visibility Logic
**Issue**: Component returned `null` when no EQS data existed
```typescript
if (!latestEQS) {
  return null; // Component disappears completely
}
```

**Impact**:
- Component became invisible immediately on load
- Even when monitoring started, component stayed hidden
- Re-render only happened when user tried to close session

### 2. Race Condition
**Sequence of events**:
1. Component loads, no EQS data in database yet
2. Component returns `null` and becomes invisible/unmounted
3. Monitoring starts, EQS calculations happen (visible in console)
4. But component is hidden, so updates don't display
5. User clicks "Stop Session" → page re-renders
6. Component loads again, finds EQS data, displays properly

### 3. Subscription Filter Issue
**Issue**: Subscription used `intentId` prop which was undefined
```typescript
filter: intentId ? `intent_id=eq.${intentId}` : undefined
```

**Impact**: Even when component was mounted, realtime updates didn't trigger properly

## Fixes Implemented

### 1. Progressive State Display
**Changes**:
- Added `waitingForMonitoring` state
- Component now shows appropriate message for each stage:
  - **Initializing**: "Initializing entry quality monitor..."
  - **Waiting**: "Waiting for monitoring to start" (when no active intent)
  - **Analyzing**: "Calculating Entry Quality Score" (when intent exists but no EQS data)
  - **Active**: Full EQS display with scores and breakdown

**Code**:
```typescript
// Show loading state during initial hook fetch
if (intentLoading) {
  return <div>Initializing entry quality monitor...</div>;
}

// Show waiting state when monitoring is starting
if (waitingForMonitoring || !activeIntent) {
  return <div>Waiting for monitoring to start...</div>;
}

// Show "calculating" state when we have an intent but no EQS data yet
if (!latestEQS) {
  return <div>Calculating Entry Quality Score...</div>;
}

// Finally, show full EQS display
return <FullEQSDisplay />;
```

### 2. Fixed Subscription Filter
**Changes**:
- Use `activeIntent.id` from hook instead of prop
- This ensures we always have a valid intent ID for filtering

**Code**:
```typescript
const channel = supabase
  .channel(`eqs-updates-${sessionId}`)
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'entry_monitoring_logs',
    filter: `intent_id=eq.${activeIntent.id}` // Use intent from hook
  }, (payload) => {
    console.log('📥 Realtime EQS update received', payload.new);
    setLatestEQS(payload.new as EQSUpdate);
  })
  .subscribe();
```

### 3. Enhanced Debug Logging
**Added comprehensive logging**:
- Component lifecycle events
- Intent loading status
- EQS data fetch attempts
- Database insert operations
- Subscription status

**Example logs**:
```
[EntryQualityMonitor] 🔄 Component effect triggered
[EntryQualityMonitor] ✅ Active intent found, starting monitoring
[EntryQualityMonitor] ⏰ Polling for EQS updates...
[EntryQualityMonitor] 🔍 Loading EQS data for intent
[EntryQualityMonitor] ✅ EQS data loaded
[UnifiedMonitor] 💾 Storing EQS update to database...
[UnifiedMonitor] ✅ EQS update stored successfully
```

### 4. Enhanced Database Storage
**Improvements**:
- Added detailed logging to `storeEQSUpdate` function
- Log database errors with full details (message, code, details)
- Confirm successful inserts with returned data
- Better error visibility for debugging

## Files Modified

1. **src/components/EntryQualityMonitor.tsx**
   - Added progressive state display logic
   - Fixed subscription to use `activeIntent.id`
   - Added comprehensive debug logging
   - Improved user feedback for each monitoring stage

2. **src/services/unified-entry-monitor.ts**
   - Enhanced `storeEQSUpdate` with detailed logging
   - Better error reporting for database operations
   - Confirmation logging for successful inserts

## Verification

### Database Check
- Confirmed `entry_monitoring_logs` table already has realtime enabled
- RLS policies correctly configured
- All required columns exist (eqs_score, eqs_grade, breakdown, etc.)

### Build Status
- ✅ Project builds successfully
- ✅ No TypeScript errors
- ✅ All critical system validations pass

## Expected Behavior After Fix

### Monitoring Flow
1. **Session starts** → Monitor shows "Waiting for monitoring to start"
2. **Alpha says "WAIT"** → Monitor shows "Calculating Entry Quality Score"
3. **First EQS calculated** → Monitor immediately displays with score breakdown
4. **EQS updates** → Monitor updates in real-time as quality improves
5. **No more double-close** → Monitor is always visible, session closes normally

### User Experience
- Monitor is **always visible** once session is active
- Shows **clear status messages** at each stage
- Provides **real-time feedback** on entry quality
- **No more mystery** about what system is doing
- **Single click** to close session (no double-close needed)

## Testing Recommendations

1. Start a new goal session
2. Verify monitor appears immediately with "Waiting" state
3. When Alpha decides to WAIT, verify monitor shows "Analyzing" state
4. Verify monitor displays EQS scores within seconds
5. Verify monitor updates in real-time as conditions change
6. Verify session closes normally with single click (no double-close)

## Console Logs to Monitor

Look for these log patterns:
```
[EntryQualityMonitor] 🔄 Component effect triggered
[EntryQualityMonitor] ✅ Active intent found
[UnifiedMonitor] 💾 Storing EQS update to database
[UnifiedMonitor] ✅ EQS update stored successfully
[EntryQualityMonitor] 📥 Realtime EQS update received
```

If you see database errors, check:
- User authentication status
- RLS policies on `entry_monitoring_logs`
- Intent has valid `user_id` field

## Architecture Notes

This fix follows SSOT principles:
- **Single hook**: `useActiveEntryIntent` is authority for intent data
- **Single monitor**: `UnifiedEntryMonitor` is authority for monitoring
- **Single table**: `entry_monitoring_logs` is authority for EQS data
- **Clear ownership**: Each component has one clear responsibility

The fix ensures the UI accurately reflects backend state at all times, with no hidden states or race conditions.
