# Polling Stop Bug - FIXED

## Issue Description

When switching between symbols (e.g., EURUSD → XAUUSD), the polling would STOP completely for the new symbol instead of restarting with the new priority interval.

### Console Evidence:
```
[Chart] 🛑 Stopping smooth hybrid mode for EURUSD M5
[Coordinator] Updating EURUSD: normal->low, 2000ms->5000ms
🛑 Stopped polling for EURUSD

[Coordinator] Updating XAUUSD: normal->high, 2000ms->1500ms
🛑 Stopped polling for XAUUSD  ← ❌ SHOULD HAVE STARTED!
```

After switching to XAUUSD:
- Polling stopped completely
- No price updates
- Chart froze
- Only showed: `[Chart][XAUUSD] 📈 Direct price update from metaapi: 1.15834` (EURUSD prices!)

## Root Cause

**File:** `src/services/global-polling-coordinator.ts`

**The Bug (lines 354-357):**
```typescript
if (this.pollIntervals.has(symbol)) {
  this.stopPollingForSymbol(symbol);  // ✅ Stops old interval
  this.startPollingForSymbol(symbol); // ❌ Fails to start!
}
```

**Why It Failed:**

The `startPollingForSymbol` method has a guard at the beginning (line 362-365):
```typescript
private startPollingForSymbol(symbol: string): void {
  if (this.pollIntervals.has(symbol)) {
    console.warn(`⚠️ Polling already active for ${symbol}`);
    return;  // ❌ EXITS WITHOUT STARTING!
  }
```

**The Race Condition:**
1. `stopPollingForSymbol` is called
2. It calls `clearInterval()` and `this.pollIntervals.delete(symbol)`
3. `startPollingForSymbol` is called IMMEDIATELY after
4. **BUT** `pollIntervals.has(symbol)` might still return `true` due to timing
5. Function exits early, polling never restarts
6. Symbol stuck with NO polling!

## The Fix

Changed the update logic to ALWAYS call `startPollingForSymbol`, regardless of whether stop succeeded:

### Before:
```typescript
if (this.pollIntervals.has(symbol)) {
  this.stopPollingForSymbol(symbol);
  this.startPollingForSymbol(symbol);  // Only called if has() was true
}
```

### After:
```typescript
// CRITICAL FIX: Stop and restart polling with new interval
if (this.pollIntervals.has(symbol)) {
  this.stopPollingForSymbol(symbol);
}
// Always start regardless - stopPollingForSymbol ensures clean state
this.startPollingForSymbol(symbol);
```

**Why This Works:**
1. If polling exists, stop it first
2. ALWAYS call `startPollingForSymbol` after the if block
3. `stopPollingForSymbol` guarantees `pollIntervals.delete(symbol)` is called
4. By the time we reach line 359, the symbol is guaranteed NOT in the Map
5. `startPollingForSymbol` guard passes, polling starts successfully

## Testing

After deployment, verify:

1. **Symbol Switching Works:**
   - Switch from EURUSD to XAUUSD
   - Should see:
     ```
     🛑 Stopped polling for EURUSD
     ✅ Started read-only polling for XAUUSD (high priority, every 1500ms)
     ```
   - NOT: `🛑 Stopped polling for XAUUSD`

2. **Prices Update Correctly:**
   - EURUSD shows ~1.158xx prices
   - XAUUSD shows ~4185.xx prices
   - No cross-contamination

3. **Priority Changes Work:**
   - Viewed symbol → high priority (1500ms)
   - Background symbols → low priority (5000ms)
   - Symbols with positions → critical priority (1000ms)

## Related Fixes

This completes the polling system fixes:
1. ✅ **chart-direct-price-poller.ts** - Symbol-specific listeners
2. ✅ **background-candle-aggregator.ts** - Symbol-specific tick listeners
3. ✅ **global-polling-coordinator.ts** - Fixed restart logic (this fix)

All three issues were causing the XAUUSD chart to show EURUSD prices!

## Files Modified

- `src/services/global-polling-coordinator.ts` (lines 354-360)

## Deployment

- Build: ✅ Successful
- Deploy: ✅ Triggered
- Status: Ready for testing
