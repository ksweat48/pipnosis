# Chart Cross-Symbol Contamination Fix - COMPLETE

## Issue Description

Charts were displaying incorrect prices when switching symbols. For example:
- Switching from EURUSD to XAUUSD
- XAUUSD chart would show EURUSD prices (1.158xx instead of 4188.xx)
- Console showed: `[Chart][XAUUSD] 📈 Direct price update from metaapi: 1.15817`

## Root Cause Analysis

### Deep Dive Audit Findings

Conducted comprehensive audit of ALL polling and tick systems:

✅ **Systems Already Correct:**
1. `chart-direct-price-poller.ts` - Symbol-specific listeners (previously fixed)
2. `chart-candle-poller.ts` - Symbol-specific listeners
3. `get-live-price.ts` (Netlify function) - Correct symbol handling
4. `continuous-price-collector.ts` - Correct symbol assignment
5. MarketChart refs - Proper symbol tracking

❌ **Bug Found: background-candle-aggregator.ts**

**Problem #1: Global Tick Broadcast**
```typescript
// Line 37: Global listener set (NO symbol filtering!)
private tickListeners: Set<callback> = new Set();

// Lines 170-191: Broadcasts ALL ticks to ALL listeners
this.tickListeners.forEach(listener => {
  listener(tick); // ❌ Sends EVERY symbol to EVERY listener!
});
```

**Problem #2: Missing Symbol Parameter**
```typescript
// Lines 761-768: No symbol parameter
onTickUpdate(callback): () => void {
  this.tickListeners.add(callback); // ❌ Global set!
}
```

**Problem #3: MarketChart Missing Symbol Filter**
```typescript
// Line 1092-1097: No symbol passed to subscription
const unsubscribeTicks = backgroundCandleAggregator.onTickUpdate((tick) => {
  updateCurrentCandleFromTick(tick); // ❌ Receives ALL symbols!
});
```

### Why This Caused Cross-Contamination

1. Background aggregator polls ALL 5 symbols (EURUSD, XAUUSD, US30, GBPUSD, USDJPY)
2. Broadcasts ALL ticks to ALL listeners (no filtering)
3. Each chart receives ticks for ALL symbols
4. When switching from EURUSD to XAUUSD:
   - Old EURUSD listener might not cleanup fast enough
   - XAUUSD chart processes EURUSD ticks
   - Stale closure captures old symbol value
   - Wrong price displayed!

## The Fix

Applied the **exact same pattern** we used for `chart-direct-price-poller.ts`:

### 1. background-candle-aggregator.ts Changes

**Changed listener storage to symbol-specific Map:**
```typescript
// BEFORE (line 37):
private tickListeners: Set<callback> = new Set();

// AFTER:
private tickListeners: Map<string, Set<callback>> = new Map();
```

**Updated onTickUpdate to accept symbol parameter:**
```typescript
// BEFORE:
onTickUpdate(callback): () => void {
  this.tickListeners.add(callback);
}

// AFTER:
onTickUpdate(symbol: string, callback): () => void {
  if (!this.tickListeners.has(symbol)) {
    this.tickListeners.set(symbol, new Set());
  }
  const listeners = this.tickListeners.get(symbol)!;
  listeners.add(callback);

  return () => {
    listeners.delete(callback);
    if (listeners.size === 0) {
      this.tickListeners.delete(symbol);
    }
  };
}
```

**Updated notifyTickListeners to filter by symbol:**
```typescript
// BEFORE:
private notifyTickListeners(symbol: string, bid, ask, timestamp): void {
  this.tickListeners.forEach(listener => {
    listener(tick); // ❌ ALL listeners get ALL ticks!
  });
}

// AFTER:
private notifyTickListeners(symbol: string, bid, ask, timestamp): void {
  const symbolListeners = this.tickListeners.get(symbol);
  if (!symbolListeners || symbolListeners.size === 0) {
    return;
  }

  symbolListeners.forEach(listener => {
    listener(tick); // ✅ Only listeners for THIS symbol!
  });
}
```

### 2. MarketChart.tsx Changes

**Updated subscription to pass symbol:**
```typescript
// BEFORE (line 1092):
const unsubscribeTicks = backgroundCandleAggregator.onTickUpdate((tick) => {

// AFTER:
const unsubscribeTicks = backgroundCandleAggregator.onTickUpdate(symbol, (tick) => {
```

## Testing & Verification

After deployment, verify:

1. **No Cross-Contamination:**
   - Switch from EURUSD to XAUUSD
   - Verify XAUUSD shows correct price (4188.xx, not 1.158xx)
   - Check console for symbol-specific subscription messages

2. **Console Output Should Show:**
   ```
   [Chart] 📡 Subscribing to background aggregator as fallback for XAUUSD...
   [BackgroundAggregator][XAUUSD] Registered tick listener (1 total for this symbol)
   [BackgroundAggregator][XAUUSD] Notifying 1 tick listeners
   ```

3. **Proper Cleanup:**
   - Switch symbols multiple times
   - Verify old listeners are properly removed
   - Check memory doesn't leak

## Summary

**Files Modified:**
1. `src/services/background-candle-aggregator.ts` - Symbol-specific tick listeners
2. `src/components/MarketChart.tsx` - Pass symbol to subscription

**Pattern Applied:**
- Identical to `chart-direct-price-poller.ts` fix
- Symbol-specific listener storage (Map instead of Set)
- Only notify listeners registered for that specific symbol
- Proper cleanup when listeners unsubscribe

**Result:**
- Each chart ONLY receives ticks for its displayed symbol
- No more cross-contamination between EURUSD, XAUUSD, etc.
- Clean listener management with automatic cleanup

## Related Files
- Previous fix: `POLLER_BROADCAST_FIX_COMPLETE.md`
- Critical systems: `docs/CRITICAL_SYSTEMS.md`
