# Chart Visibility Fix - Complete

**Date**: December 2, 2025
**Issue**: Charts showing incomplete/stale candles when returning to tab
**Status**: ✅ FIXED

---

## Problem Description

When users closed the browser tab or switched away from the chart page:
- ✅ Server-side candle aggregation continued working (Netlify functions)
- ✅ Candles were being created in database every 5 minutes
- ❌ **Chart appeared frozen with incomplete candles when returning**
- ❌ Live tick updates didn't resume properly
- ❌ Stale "forming candle" persisted instead of showing new completed candles

---

## Root Cause

The chart has intentional visibility optimization that pauses updates when tab is hidden to save:
- Battery life
- API rate limits
- CPU resources

However, when the tab became visible again, the resume logic was incomplete:
1. ❌ Didn't clear stale `currentCandleRef`
2. ❌ Didn't fetch new completed candles from database
3. ❌ Didn't update chart with candles created while away
4. ❌ Price poller didn't immediately fetch fresh data

---

## Solution Implemented

### 1. Enhanced MarketChart Visibility Handler

**File**: `src/components/MarketChart.tsx`

**Changes**:
```typescript
// When tab becomes visible:
1. Clear stale current candle reference
   currentCandleRef.current = null;

2. Resume polling first
   chartCandlePoller.resume();

3. Force refresh to fetch latest data
   await chartCandlePoller.forceRefresh(symbol, timeframe);

4. Fetch and apply new candles created while hidden
   - Query database for latest candles
   - Find candles newer than last historical candle
   - Add new candles to chart
   - Update price and indicators
   - Update timestamps

5. Resume live tick rendering
```

**Key Features**:
- ✅ Clears stale forming candle
- ✅ Fetches all completed candles created while away
- ✅ Updates chart display seamlessly
- ✅ Refreshes price and indicators
- ✅ Console logs for debugging

### 2. Enhanced Price Poller Resume

**File**: `src/services/chart-direct-price-poller.ts`

**Changes**:
```typescript
// When tab becomes visible:
1. Resume polling
2. Immediately fetch fresh prices (don't wait for interval)
3. Clear any stale cached data
```

**Key Features**:
- ✅ Instant price refresh on visibility
- ✅ No waiting for next polling cycle
- ✅ Error handling for failed fetches

---

## Testing Checklist

To verify the fix works:

### Test 1: Basic Tab Switch
1. ✅ Open chart on EURUSD M5
2. ✅ Note the current candle time
3. ✅ Switch to another browser tab for 6+ minutes (let 1-2 candles complete)
4. ✅ Return to chart tab
5. ✅ **Expected**: See new completed candles, current candle updates with live prices

### Test 2: Browser Minimize
1. ✅ Open chart on any pair
2. ✅ Minimize browser for 10+ minutes
3. ✅ Restore browser window
4. ✅ **Expected**: Chart catches up with all missed candles within seconds

### Test 3: Check Console Logs
When returning to visible tab, console should show:
```
[Chart] 👁️ Tab visible - resuming full hybrid mode
[Chart] 🔄 Clearing stale current candle and fetching latest data...
[Chart] ✅ Refreshed with latest data from DB
[Chart] Latest candle: [timestamp]
[Chart] 🆕 Adding X new candles created while tab was hidden
[Chart] 📡 Live tick rendering resumed
[Chart] 💾 DB polling resumed at full frequency
```

### Test 4: Verify No Incomplete Candles
1. ✅ After returning to tab, check chart
2. ✅ **Expected**: All candles show complete OHLC
3. ✅ **Expected**: No gaps in candle sequence
4. ✅ **Expected**: Current forming candle updates with fresh prices

---

## Architecture

### Data Flow When Tab Becomes Visible

```
User Returns to Tab
        ↓
visibilitychange Event
        ↓
handleVisibilityChange()
        ↓
┌───────────────────────────┐
│ 1. Clear stale candle ref│
└───────────────────────────┘
        ↓
┌───────────────────────────┐
│ 2. Resume chart polling   │
└───────────────────────────┘
        ↓
┌───────────────────────────┐
│ 3. Force refresh DB query │
└───────────────────────────┘
        ↓
┌───────────────────────────┐
│ 4. Fetch latest candles   │
└───────────────────────────┘
        ↓
┌───────────────────────────┐
│ 5. Find new candles       │
│    (time > last historical)│
└───────────────────────────┘
        ↓
┌───────────────────────────┐
│ 6. Update chart display   │
│    - Add to historical    │
│    - Update candlesticks  │
│    - Refresh price        │
│    - Recalculate indicators│
└───────────────────────────┘
        ↓
┌───────────────────────────┐
│ 7. Resume live tick stream│
└───────────────────────────┘
        ↓
┌───────────────────────────┐
│ 8. Fetch immediate price  │
│    (don't wait for cycle) │
└───────────────────────────┘
        ↓
Chart Fully Updated ✅
```

---

## What Still Works

### Server-Side Collection (24/7)
- ✅ Netlify: `continuous-price-collector` (every 1 min)
- ✅ Netlify: `continuous-candle-aggregator` (every 5 min)
- ✅ Supabase: Stores all candles permanently
- ✅ Works even when browser is completely closed

### Browser Optimization
- ✅ Still pauses when tab hidden (saves resources)
- ✅ Still reduces polling frequency when not visible
- ✅ Still cancels animation frames when hidden
- ✅ **NEW**: Properly resumes and refreshes when visible

---

## Files Modified

1. `src/components/MarketChart.tsx`
   - Enhanced `handleVisibilityChange()` function
   - Added async refresh logic
   - Added new candle detection and insertion
   - Added comprehensive logging

2. `src/services/chart-direct-price-poller.ts`
   - Enhanced `setupVisibilityDetection()`
   - Added immediate price fetch on visibility
   - Added error handling

---

## Deployment

**Build**: ✅ Successful
**Deploy**: ✅ Triggered via Netlify webhook
**URL**: https://pipnosis.com

---

## Expected User Experience

### Before Fix
1. User switches away from chart tab
2. User returns 10 minutes later
3. ❌ Chart shows old incomplete candle
4. ❌ Must manually refresh page to see new data
5. ❌ Appears like system stopped working

### After Fix
1. User switches away from chart tab
2. User returns 10 minutes later
3. ✅ Chart automatically refreshes within 1-2 seconds
4. ✅ All new completed candles appear
5. ✅ Live prices resume updating
6. ✅ Seamless experience - no manual refresh needed

---

## Monitoring

### Console Logs to Watch
```
# When tab hidden:
[Chart] 🙈 Tab hidden - pausing live tick rendering
[Chart] 💾 DB polling continues (reduced frequency)

# When tab visible:
[Chart] 👁️ Tab visible - resuming full hybrid mode
[Chart] 🔄 Clearing stale current candle and fetching latest data...
[Chart] ✅ Refreshed with latest data from DB
[Chart] 🆕 Adding X new candles created while tab was hidden
```

### Success Metrics
- ✅ Zero incomplete candles after returning to tab
- ✅ Chart updates within 2 seconds of visibility
- ✅ No manual refresh required
- ✅ Smooth transition from paused to live state

---

## Future Enhancements

Consider these improvements if needed:

1. **Visual Loading Indicator**
   - Show brief "catching up..." spinner while refreshing
   - Display count of candles being loaded

2. **Configurable Behavior**
   - Let users choose to keep polling active when hidden
   - Add "aggressive refresh" mode for active traders

3. **Smart Resume**
   - Detect if market was closed while away
   - Skip refresh if no new data possible

4. **Notification**
   - Show toast: "Chart updated with X new candles"
   - Confirm refresh completed successfully

---

## Conclusion

✅ **Problem**: Charts appeared frozen with incomplete candles when returning to tab
✅ **Solution**: Enhanced visibility handler to clear stale data and fetch latest candles
✅ **Result**: Seamless chart updates when tab becomes visible
✅ **Status**: Deployed to production

Users can now confidently switch away from the chart and return without seeing stale or incomplete data. The server continues collecting candles 24/7, and the client automatically syncs when visible.
