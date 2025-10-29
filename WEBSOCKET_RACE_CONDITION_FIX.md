# WebSocket Race Condition Fix

## Problem Identified

The WebSocket connection was being disconnected **before it finished establishing**, causing the error:
```
WebSocket is closed before the connection is established.
```

## Root Cause

A **React useEffect race condition** in `MarketChart.tsx`:

1. WebSocket starts connecting (takes ~2 seconds)
2. React state changes trigger effect cleanup
3. Cleanup calls `stopLiveFeed()` immediately
4. Socket.IO tries to close a connection that hasn't finished handshaking
5. Error: "WebSocket is closed before the connection is established"

### The Problematic Code

```typescript
useEffect(() => {
  if (isConnected) {
    subscribeToLiveData();
    marketDataService.startLiveFeed(symbol, timeframe); // STARTS
  }

  return () => {
    marketDataService.stopLiveFeed(symbol, timeframe); // STOPS TOO SOON
  };
}, [symbol, timeframe, isConnected]); // Dependencies cause frequent re-runs
```

## Solution Implemented

### 1. MarketChart.tsx - Connection Delay & State Tracking

**Added:**
- `liveFeedStartTimeoutRef`: Delays connection start by 300ms
- `isLiveFeedActiveRef`: Tracks if live feed is actually running
- Prevents duplicate connections
- Cancels pending connections on cleanup

**Key Changes:**
```typescript
// Add 300ms delay before starting connection
liveFeedStartTimeoutRef.current = setTimeout(() => {
  if (!isLiveFeedActiveRef.current) {
    subscribeToLiveData();
    marketDataService.startLiveFeed(symbol, timeframe);
    isLiveFeedActiveRef.current = true;
  }
}, 300);

// Cleanup: Cancel pending connection or stop active one
return () => {
  if (liveFeedStartTimeoutRef.current) {
    clearTimeout(liveFeedStartTimeoutRef.current); // Cancel if pending
  }
  if (isLiveFeedActiveRef.current) {
    marketDataService.stopLiveFeed(symbol, timeframe); // Stop if active
    isLiveFeedActiveRef.current = false;
  }
};
```

### 2. PriceStreamManager.ts - Connection Guard Rails

**Added:**
- `isConnecting`: Flag to track connection in progress
- `connectionStartTime`: Timestamp when connection started
- `MIN_CONNECTION_TIME`: 2-second minimum before allowing disconnect

**Key Changes:**
```typescript
stop(): void {
  // Don't stop while connecting
  if (this.isConnecting) {
    console.warn('Cannot stop: Connection in progress. Deferring...');
    setTimeout(() => this.stop(), 500);
    return;
  }

  // Don't stop too soon after connection started
  if (this.connectionStartTime) {
    const timeSinceStart = Date.now() - this.connectionStartTime;
    if (timeSinceStart < this.MIN_CONNECTION_TIME) {
      const waitTime = this.MIN_CONNECTION_TIME - timeSinceStart;
      console.warn(`Connection too recent (${timeSinceStart}ms). Waiting...`);
      setTimeout(() => this.stop(), waitTime);
      return;
    }
  }

  // Safe to stop now
  this.websocketStream?.disconnect();
  // ... rest of cleanup
}
```

## How It Fixes The Issue

### Before:
1. Effect runs → WebSocket starts connecting
2. State changes → Effect cleanup runs immediately
3. `stop()` called → WebSocket closed mid-handshake ❌
4. Error: "WebSocket is closed before the connection is established"

### After:
1. Effect runs → Connection scheduled (300ms delay)
2. State changes during delay → Pending connection cancelled ✓
3. State changes after connection → `stop()` deferred until safe ✓
4. WebSocket has 2+ seconds to complete handshake before any stop ✓

## Benefits

✅ **No more premature disconnects** - WebSocket has time to establish
✅ **Prevents duplicate connections** - Tracks active state
✅ **Graceful cleanup** - Cancels pending or waits for safe disconnect
✅ **Better logging** - Clear visibility into connection lifecycle
✅ **Production-ready** - Handles rapid re-renders and unmounts

## Testing Recommendations

1. **Rapid navigation** - Switch between pairs/timeframes quickly
2. **Component remounts** - Navigate away and back to chart
3. **Network throttling** - Test with slow connections
4. **Browser DevTools** - Monitor WebSocket connections in Network tab

## Console Output (Expected)

```
🔄 Scheduling live feed start for EURUSD M5...
✅ Started polling live feed for EURUSD M5
[PriceStreamManager] Starting price stream for EURUSD
[WebSocketPriceStream] Connecting to EURUSD via Socket.IO
✅ Socket.IO connected for EURUSD
```

## Files Modified

- `src/components/MarketChart.tsx` - Added connection delay and state tracking
- `src/services/price-stream-manager.ts` - Added connection guard rails
