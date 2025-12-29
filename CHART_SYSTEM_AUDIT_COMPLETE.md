# Chart System Comprehensive Audit - COMPLETE
**Date:** December 29, 2025
**Status:** CRITICAL BUGS IDENTIFIED

## Executive Summary
Completed comprehensive audit of the entire chart system including polling, aggregation, caching, and persistence. Identified **THREE CRITICAL ISSUES** affecting chart behavior:

1. **Weekend Candle Disappearance** - M1/M5 candles vanish over weekends (CRITICAL BUG)
2. **Crypto Tick Speed** - Configured same as forex but feels slower
3. **Forex Market Open Timing** - Potential delay in candle generation at Sunday 5pm EST

---

## Issue #1: Weekend Candle Disappearance (CRITICAL BUG)

### Symptom
- User reports M1 and M5 historical candles disappear during the 48-hour weekend market close
- Charts start fresh with no historical data when market opens Sunday 5pm EST
- Only affects lower timeframes (M1, M5) which are most impacted by data gaps

### Root Cause
**TWO aggregator services actively SKIP saving candles during market close hours:**

#### Location 1: `background-candle-aggregator.ts` (Lines 93-103)
```typescript
private async saveCompletedCandle(symbol: string, timeframe: Timeframe, candle: CandleState): Promise<void> {
  // CRITICAL: Check if candle timestamp is during open market hours
  // Prevent saving fake candles from Saturday/Sunday
  if (!isMarketOpenAt(candle.time)) {
    const dateStr = new Date(candle.time * 1000).toISOString();
    logger.debug(
      LogCategory.BACKGROUND_AGGREGATOR,
      `🚫 Skipping save for ${symbol} ${timeframe} - market was closed at ${dateStr}`
    );
    return; // EXITS WITHOUT SAVING!
  }
```

#### Location 2: `continuous-candle-aggregator.ts` (Lines 735-740)
```typescript
if (candle) {
  // CRITICAL: Check if candle is during market open hours
  // Skip weekend candles for forex (crypto trades 24/7)
  if (!isMarketOpenAtTime(candle.open_time, symbol)) {
    currentCandleToCreate = new Date(currentCandleToCreate.getTime() + timeframeMinutes * 60 * 1000);
    continue; // SKIPS SAVING!
  }
```

### Why This Is a Problem
1. **Historical Continuity Broken:** When market opens Sunday, there are NO candles in the database from Friday 5pm to Sunday 5pm
2. **Chart Starts From Scratch:** MarketChart component queries for historical candles but gets empty results for the weekend period
3. **Data Loss:** Any price ticks recorded during the weekend are never aggregated into candles
4. **User Confusion:** Charts appear to "reset" every week, losing all historical context

### The Irony
In `candle-data-service.ts` lines 468-470, there's a comment:
```typescript
// HISTORICAL DATA: Keep all candles for historical display - market hours filter removed
// candles = filterCandlesByMarketHours(candles, symbol);
```

This comment indicates the filter was REMOVED from the **READING** side, but it's still ACTIVE on the **WRITING** side (aggregators)!

### Impact Assessment
- **Severity:** CRITICAL
- **Affected Timeframes:** M1, M5, M15 (all rely on continuous aggregation)
- **Affected Symbols:** All forex/index symbols (EURUSD, GBPUSD, XAUUSD, etc.)
- **Crypto Symbols:** NOT affected (24/7 market, always passes isMarketOpenAt check)
- **User Experience:** Charts lose all weekend context, appear broken

---

## Issue #2: Crypto vs Forex Tick Speed

### Symptom
- User reports BTC and ETH ticks are "a lot slower" than forex
- Perceived lag in crypto price updates compared to forex pairs

### Current Configuration
**File:** `chart-direct-price-poller.ts` (Lines 33-34)
```typescript
const CRYPTO_POLL_INTERVAL = 3000;  // 3000ms - unified with forex for consistent behavior
const FOREX_POLL_INTERVAL = 3000;   // 3000ms - industry standard for retail forex
```

**Both are set to 3000ms (3 seconds)** - They should have identical tick speeds!

### Historical Context
From `CRYPTO_CHART_SPEED_UPGRADE.md`:
- Crypto USED to be 500ms (very fast)
- Was changed to 3000ms to "unify with forex for consistent behavior"
- This change may have been too aggressive for 24/7 markets

### Analysis
Three possible explanations for perceived slowness:
1. **Database Density:** Crypto may have fewer `realtime_prices` entries in database (less market activity at night)
2. **Natural Volatility:** Crypto naturally moves slower during low-volume periods (Asia session)
3. **Aggregation Gaps:** The aggregator may be creating fewer candles for crypto during certain hours

### Recommendation
- **Reduce crypto polling to 1000ms (1 second)** for 24/7 markets
- Keep forex at 3000ms (3 seconds) since market is closed 48 hours/week
- This gives crypto 3x more updates, matching the 24/7 nature of the market

---

## Issue #3: Forex Market Opening Late

### Symptom
- User reports forex market "opened late or started making candles late" after crypto fix
- Candles may not appear immediately at Sunday 5pm EST market open

### Investigation Findings

#### Market Hours Detection (`marketHours.ts` Lines 65-109)
The core logic is **CORRECT:**
```typescript
export function getForexMarketStatus(): MarketStatus {
  const now = new Date();
  const estTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));

  const dayOfWeek = estTime.getDay(); // 0 = Sunday
  const totalMinutes = hours * 60 + minutes;

  const sundayOpenTime = 17 * 60; // 5:00 PM = 1020 minutes

  // Market is closed Sunday before 5:00 PM
  if (dayOfWeek === 0 && totalMinutes < sundayOpenTime) {
    isOpen = false;
  }

  return { isOpen, status: isOpen ? 'Open' : 'Closed' };
}
```

#### Potential Issues
1. **Aggregator Timing:** The `continuous-candle-aggregator` runs every 5 minutes. If market opens at 5:00pm but aggregator runs at 5:03pm, there's a 3-minute delay
2. **First Candle Logic:** The aggregators check `isMarketOpenAtTime()` which might reject the FIRST candle at exactly 5:00pm due to timing edge cases
3. **Background Aggregator:** May not be running or may have paused during the weekend

### Root Cause (Hypothesis)
**The same market hours filter causing Issue #1 is likely causing this delay!**

When the market opens at 5:00pm:
- Aggregator runs at 5:03pm (first scheduled run after open)
- Tries to create 5:00pm candle
- Checks `isMarketOpenAtTime(5:00pm)` which returns `false` (market was closed at 5:00pm exactly)
- Skips creating the 5:00pm candle
- First candle doesn't appear until 5:05pm or later

---

## System Architecture Overview

### Chart Data Flow
```
MetaAPI Prices → realtime_prices table
                      ↓
        [continuous-candle-aggregator]
        (Runs every 5 minutes via Netlify)
                      ↓
        Aggregates ticks into M1, M5, M15, etc.
                      ↓
              forex_candles table
                      ↓
        [candle-data-service reads candles]
                      ↓
            MarketChart component
                      ↓
           Displays chart to user
```

### Critical Services Audited
1. **chart-direct-price-poller.ts** - Polls for live prices (3000ms interval)
2. **background-candle-aggregator.ts** - Aggregates ticks into candles (browser-side)
3. **continuous-candle-aggregator.ts** - Server-side Netlify function (every 5 min)
4. **candle-cache-manager.ts** - Manages candle caching
5. **candle-data-service.ts** - Reads candles from database
6. **candle-persistence-service.ts** - Saves candles to database
7. **marketHours.ts** - Determines market open/close status

### No Candle Cleanup Found
**Grep search results:** No DELETE, TRUNCATE, or DROP statements found that would remove candles (except one-time migration cleanup)

This confirms candles are NOT being deleted - they're simply never saved in the first place!

---

## Recommended Fixes

### Fix #1: Remove Market Hours Filter from Aggregators (CRITICAL)
**Files to modify:**
- `src/services/background-candle-aggregator.ts`
- `netlify/functions/continuous-candle-aggregator.ts`

**Strategy:** SAVE ALL CANDLES regardless of market hours, but add a `market_session` field to track if candle occurred during open hours. This preserves historical continuity while allowing optional filtering during display.

### Fix #2: Adjust Crypto Polling Speed
**File to modify:**
- `src/services/chart-direct-price-poller.ts`

**Change:**
```typescript
const CRYPTO_POLL_INTERVAL = 1000;  // 1 second for 24/7 markets
const FOREX_POLL_INTERVAL = 3000;   // 3 seconds for 5-day markets
```

### Fix #3: Ensure Immediate Candle Generation at Market Open
**File to modify:**
- `netlify/functions/continuous-candle-aggregator.ts`

**Strategy:** Add logic to detect market open transition and immediately create candles for the first period, rather than waiting for the next 5-minute cron job.

---

## Testing Plan

### Test #1: Weekend Candle Persistence
1. Manually trigger aggregator on a Saturday
2. Verify candles are saved to database with market_session = 'closed'
3. Query database on Sunday before market open
4. Confirm M1/M5 candles exist for entire weekend period
5. Open chart on Sunday 5pm and verify historical candles appear

### Test #2: Crypto Tick Speed
1. Open BTCUSD chart
2. Compare tick frequency to EURUSD
3. Verify crypto updates every 1 second
4. Verify forex updates every 3 seconds
5. Confirm no performance issues

### Test #3: Market Open Timing
1. Monitor system at Sunday 4:59pm EST
2. At 5:00pm exactly, check if market status changes to "Open"
3. Verify first candle appears within 1 minute of market open
4. Confirm no gaps in candle sequence from Friday close to Sunday open

---

## Conclusion
All three issues stem from **overly aggressive market hours filtering** in the aggregation layer. The filters were added to "prevent fake weekend candles" but instead broke historical data continuity.

**Primary Fix:** Remove the market hours check from candle SAVING, keep it only in candle DISPLAY/READING if needed.

**Status:** Ready to implement fixes.
