# Live Chart Update Fix - October 29, 2025

## Problem Identified

The console logs revealed that:
1. ✅ Backend was working perfectly (forex-price endpoint returning live data)
2. ✅ WebSocket was connecting successfully
3. ✅ Polling fallback was active
4. ❌ Chart was rejecting live tick updates with error: "Cannot update oldest data"
5. ❌ Price stream was starting and immediately stopping due to React component lifecycle issue

## Root Causes

### 1. **Component Lifecycle Issue** (CRITICAL)
**Location:** `src/components/MarketChart.tsx:421`

**Problem:**
```typescript
useEffect(() => {
  if (isConnected) {
    subscribeToLiveData();
    marketDataService.startLiveFeed(symbol, timeframe);
  }
  return () => {
    marketDataService.stopLiveFeed(symbol, timeframe);
  };
}, [symbol, timeframe, isConnected, subscribeToLiveData]); // ← subscribeToLiveData causes re-render loop
```

The `subscribeToLiveData` function was in the dependency array, causing the effect to:
- Run on every render
- Start the price stream
- Immediately stop it (cleanup)
- Start it again (new effect)
- This created the "start → stop → start" pattern seen in console

**Fix:**
```typescript
}, [symbol, timeframe, isConnected]); // ← Removed subscribeToLiveData
```

### 2. **Chart Timestamp Validation** (IMPORTANT)
**Location:** `src/components/CandlestickChart.tsx:358-389`

**Problem:**
The chart was calling `.update()` with candle data that had timestamps older than the last candle on the chart. TradingView Lightweight Charts throws an error when you try to update with older timestamps.

**Why this happened:**
- Cached candles loaded from database: up to `2025-10-29T04:25:00` (35 minutes ago)
- Live ticks arriving at: `2025-10-29T05:01:22` (current time)
- But React state updates were applying cached data AFTER live ticks
- This caused the chart to try updating current time with old time

**Fix:**
Added timestamp validation before calling `.update()`:

```typescript
const seriesData = candlestickSeriesRef.current.data();
if (seriesData && seriesData.length > 0) {
  const lastSeriesTime = seriesData[seriesData.length - 1].time as number;
  const newTime = currentLastCandle.time as number;

  if (newTime >= lastSeriesTime) {
    candlestickSeriesRef.current.update(currentLastCandle);
  } else {
    console.warn(`Chart: Skipping update - new time is older than last series time`);
  }
}
```

### 3. **Enhanced Logging** (DEBUGGING)
**Location:** `src/services/market-data.ts:723-789`

**Added:**
- Log every tick received with price and timestamp
- Log every candle update with OHLC values
- Log when updateLiveCandle returns null
- This will help diagnose any remaining issues

## What Was Working

1. ✅ **Backend API** - forex-price endpoint returning live bid/ask data
2. ✅ **WebSocket Connection** - Socket.IO connecting to MetaAPI successfully
3. ✅ **Polling Fallback** - HTTP polling working at 2-second intervals
4. ✅ **Token Service** - MetaAPI JWT tokens being retrieved and validated
5. ✅ **Database** - 500 candles loaded per timeframe
6. ✅ **Price Stream Manager** - Receiving and processing ticks

## Testing After Deployment

After the deployment completes (~2-3 minutes), you should see:

### In Browser Console:
```
[handleStreamTick] EURUSD M5: price=1.16320, time=2025-10-29T05:03:00.000Z
[handleStreamTick] Candle updated: open=1.16318, close=1.16320, time=2025-10-29T05:00:00.000Z
Chart: Added 1 new candle(s)
```

### What You'll Experience:
1. Chart loads with 500 historical candles
2. Price stream starts (WebSocket or polling)
3. Every 2 seconds, new tick arrives
4. Chart updates smoothly - no more start/stop cycling
5. Current candle shows live price changes
6. No "Cannot update oldest data" errors

## Verification Checklist

- [ ] Open DevTools → Console
- [ ] Navigate to chart page
- [ ] Verify you see: `[handleStreamTick] EURUSD M5: price=...` logs every 2 seconds
- [ ] Verify you see: `[handleStreamTick] Candle updated: open=...` logs
- [ ] Verify NO "Cannot update oldest data" errors
- [ ] Verify price stream does NOT stop and restart repeatedly
- [ ] Watch the chart - candlestick should update in real-time
- [ ] Check the current price display - should change every 2 seconds

## Expected Behavior Now

1. **Initial Load**: Chart loads 100 candles quickly, then 500 in background
2. **Connection**: WebSocket attempts first, falls back to polling if needed
3. **Updates**: Every 2 seconds, new tick arrives and updates current candle
4. **Smooth**: No more restart cycles, no timestamp errors
5. **Live**: Chart visually updates showing price movements

## Files Modified

1. `src/components/MarketChart.tsx` - Fixed useEffect dependency array
2. `src/components/CandlestickChart.tsx` - Added timestamp validation
3. `src/services/market-data.ts` - Enhanced logging and tick handling

## Next Steps If Issues Persist

If you still don't see live updates after deployment:

1. **Check Network Tab**:
   - Filter by "forex-price"
   - Should see requests every 2 seconds
   - Each should return status 200 with live data

2. **Check Console**:
   - Look for `[handleStreamTick]` logs
   - Look for any errors or warnings
   - Share the exact error message

3. **Force Hard Refresh**:
   - Press `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
   - This clears all cached JavaScript

4. **Check Connection Quality**:
   - Green indicator = WebSocket connected
   - Yellow indicator = Polling mode
   - Red indicator = Disconnected (check network)

---

**Deployment Status:** Building now at Netlify
**Estimated Time:** 2-3 minutes
**Test URL:** https://pipnosis.com/
