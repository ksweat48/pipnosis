# Candle Gap Filling System - Complete Guide

## Overview

This system ensures your forex charts display continuous candles without gaps by automatically detecting and filling missing time periods with "flat candles" (where open = high = low = close = last known price).

## Problem Solved

**Before:** Charts showed gaps when no price ticks were received during a time period, creating visual discontinuities that looked unprofessional and made analysis difficult.

**After:** Charts display smooth, continuous candle sequences. Periods with no trading activity are represented by flat candles using the last known price, matching professional trading platform behavior.

---

## System Architecture

### 1. Database Layer (Supabase)

#### Tables

**`last_known_prices`**
- Caches the most recent price for each symbol
- Updated automatically via trigger when new candles are inserted
- Enables instant flat candle creation without querying historical data

**`candle_gap_fill_log`**
- Audit log of all gap fill operations
- Tracks: symbol, timeframe, gap duration, candles created, fill price
- Useful for monitoring and debugging

#### Functions

**`get_last_known_price(symbol, before_time)`**
- Returns the last known close price for a symbol
- First checks cache, then queries candles, then falls back to realtime_prices
- Smart and performant

**`fill_candle_gap(symbol, timeframe, open_time, close_time, price)`**
- Creates a single flat candle for a specific time slot
- Checks if candle already exists to avoid duplicates
- Sets `data_source = 'gap_fill'` for tracking

**`fill_gaps_for_symbol_timeframe(symbol, timeframe, lookback_hours)`**
- Scans a specific symbol/timeframe for gaps in the last N hours
- Fills all detected gaps with flat candles
- Respects forex market hours (no fills during weekend closures)
- Returns summary: gaps filled, candles created

**`auto_fill_all_gaps(lookback_hours)`**
- Master function that fills gaps for ALL symbols and timeframes
- Called by scheduled functions and manual triggers
- Returns detailed results for each symbol/timeframe combination

**`is_forex_market_open(timestamp)`**
- Checks if a given time is during forex market hours
- Sunday 5pm EST to Friday 5pm EST = market open
- Prevents gap filling during legitimate market closures

**`get_timeframe_minutes(timeframe)`**
- Converts timeframe names (m1, m5, h1, etc.) to minute intervals
- Used throughout the system for time calculations

---

### 2. Frontend Layer (React/TypeScript)

#### Background Candle Aggregator

**File:** `src/services/background-candle-aggregator.ts`

**Key Features:**
- **Last Price Cache:** Maintains in-memory cache of last price for each symbol
- **Candle Finalizer:** Runs every 60 seconds to check for missing candles
- **Automatic Flat Candle Creation:** Creates flat candles when gaps are detected
- **Auto-Finalization:** Finalizes candles that are 1+ minute past their period

**How It Works:**
```typescript
// Every 60 seconds, for each symbol/timeframe:
1. Check if we're in a new candle period
2. If previous period has no candle, create flat candle
3. Use last known price from cache
4. Save to database with data_source = 'gap_fill'
```

**Candle Finalizer Logic:**
```typescript
private async checkAndFinalizeMissingCandles() {
  for each symbol:
    for each timeframe:
      - Check if current period has a forming candle
      - If not, check if previous period is missing
      - Create flat candle for missing period
      - Auto-finalize candles past their grace period
}
```

---

### 3. Server-Side Layer (Netlify Functions)

#### Fill Candle Gaps Function

**File:** `netlify/functions/fill-candle-gaps.ts`

**Schedule:** Runs every 5 minutes (configured in `netlify.toml`)

**Purpose:**
- Server-side safety net for gap detection
- Catches gaps the frontend might miss (e.g., when browser is closed)
- Provides redundancy and reliability

**What It Does:**
1. Calls `auto_fill_all_gaps(24)` database function
2. Scans last 24 hours for gaps across all symbols/timeframes
3. Fills detected gaps with flat candles
4. Returns summary of operations

**Configuration:**
```toml
[functions."fill-candle-gaps"]
  timeout = 300
  schedule = "*/5 * * * *"  # Every 5 minutes
```

---

### 4. Historical Backfill Script

**File:** `scripts/backfill-candle-gaps.js`

**Purpose:** One-time or manual backfill of historical gaps

**Usage:**
```bash
# Backfill last 72 hours (default)
node scripts/backfill-candle-gaps.js

# Backfill last 7 days
node scripts/backfill-candle-gaps.js 168

# Backfill last 30 days
node scripts/backfill-candle-gaps.js 720
```

**Features:**
- Beautiful console output with progress indicators
- Detailed summary by symbol and timeframe
- Shows recent gap fill log entries
- Safe to run multiple times (won't create duplicates)

**When to Use:**
- After system downtime or data migration
- When you notice historical gaps in charts
- Before important trading sessions
- As part of database maintenance

---

### 5. Monitoring Dashboard

**File:** `src/components/CandleContinuityMonitor.tsx`

**Features:**
- Real-time candle data completeness percentage per symbol/timeframe
- Visual health indicators (green/yellow/red)
- Recent gap fill operation log
- Manual "Fill Gaps Now" button
- Auto-refreshes every 60 seconds

**Health Calculation:**
```typescript
completeness = (actual_candles / expected_candles) * 100

// For M5 timeframe in last 24 hours:
expected_candles = (24 * 60) / 5 = 288 candles
actual_candles = count from database
completeness = (actual / 288) * 100
```

**Health Thresholds:**
- ✅ Green (≥95%): Excellent - minor or no gaps
- ⚠️ Yellow (85-95%): Good - some gaps but acceptable
- ❌ Red (<85%): Needs attention - significant gaps

---

## How Flat Candles Work

### What is a Flat Candle?

A flat candle represents a time period with no price movement. It uses the last known close price for all OHLC values:

```
open  = last_known_price
high  = last_known_price
low   = last_known_price
close = last_known_price
volume = 0
```

### Why Flat Candles?

This is the industry-standard approach used by professional trading platforms like:
- TradingView
- MetaTrader 4/5
- Bloomberg Terminal
- Interactive Brokers

### When Are Flat Candles Created?

1. **No price ticks received during a period**
   - Market is open but no trading activity
   - Data feed temporarily interrupted
   - Symbol has low liquidity

2. **System startup or recovery**
   - Browser was closed during a candle period
   - Application restarted mid-period

3. **Historical gap detected**
   - Missing data from past periods discovered
   - Database migration or restoration

### Market Hours Intelligence

The system respects forex market hours:
- **Market Open:** Sunday 5pm EST to Friday 5pm EST
- **Market Closed:** Friday 5pm EST to Sunday 5pm EST (weekends)

**During market closures:**
- No flat candles are created
- Gaps are expected and normal
- System automatically resumes on Sunday open

---

## Implementation Checklist

### Database Setup

1. ✅ Apply migration: `20251110120000_add_automatic_candle_gap_filling.sql`
   ```sql
   -- Creates tables, functions, triggers
   -- Initializes last_known_prices cache
   ```

2. ✅ Verify tables exist:
   - `last_known_prices`
   - `candle_gap_fill_log`

3. ✅ Test database function:
   ```sql
   SELECT * FROM auto_fill_all_gaps(24);
   ```

### Frontend Setup

1. ✅ Background aggregator updated with:
   - `lastPriceCache` map
   - `checkAndFinalizeMissingCandles()` method
   - Candle finalizer interval (runs every 60s)

2. ✅ Start background aggregator on app load

3. ✅ Monitor console for gap fill logs:
   ```
   [BackgroundAggregator] 🔧 Detected missing candle for EURUSD M5
   [BackgroundAggregator] ✓ Created flat candle using price 1.05432
   ```

### Server-Side Setup

1. ✅ Deploy `fill-candle-gaps.ts` Netlify function

2. ✅ Verify schedule in `netlify.toml`:
   ```toml
   [functions."fill-candle-gaps"]
     timeout = 300
     schedule = "*/5 * * * *"
   ```

3. ✅ Test manual invocation:
   ```bash
   curl https://your-site.netlify.app/.netlify/functions/fill-candle-gaps
   ```

### Historical Backfill

1. ✅ Run backfill script:
   ```bash
   node scripts/backfill-candle-gaps.js 168
   ```

2. ✅ Review output for gaps filled

3. ✅ Verify charts now show continuous candles

### Monitoring

1. ✅ Add `CandleContinuityMonitor` component to admin dashboard

2. ✅ Check data completeness percentages

3. ✅ Use "Fill Gaps Now" button if needed

---

## Troubleshooting

### Problem: Charts still showing gaps

**Diagnosis:**
```sql
-- Check for gaps in last 24 hours for EURUSD M5
SELECT
  symbol,
  timeframe,
  open_time,
  LAG(open_time) OVER (ORDER BY open_time) as prev_time,
  EXTRACT(EPOCH FROM (open_time - LAG(open_time) OVER (ORDER BY open_time))) / 60 as gap_minutes
FROM forex_candles
WHERE symbol = 'EURUSD'
  AND timeframe = 'm5'
  AND open_time > now() - interval '24 hours'
ORDER BY open_time;
```

**Solutions:**
1. Run manual backfill: `node scripts/backfill-candle-gaps.js 24`
2. Check if `last_known_prices` has data: `SELECT * FROM last_known_prices;`
3. Verify background aggregator is running: Check browser console
4. Manually trigger function: Use CandleContinuityMonitor "Fill Gaps Now" button

### Problem: Too many synthetic candles being created

**Diagnosis:**
```sql
-- Check synthetic candle ratio
SELECT
  symbol,
  timeframe,
  COUNT(*) FILTER (WHERE data_source = 'gap_fill') as synthetic,
  COUNT(*) as total,
  ROUND(COUNT(*) FILTER (WHERE data_source = 'gap_fill')::numeric / COUNT(*) * 100, 2) as synthetic_pct
FROM forex_candles
WHERE open_time > now() - interval '24 hours'
GROUP BY symbol, timeframe
ORDER BY synthetic_pct DESC;
```

**Possible Causes:**
- Price feed issues (check realtime_prices table)
- MetaAPI connection problems
- Market hours detection incorrect

**Solutions:**
1. Check price feed health
2. Verify MetaAPI connection
3. Review market hours logic in `is_forex_market_open()`

### Problem: Candle finalizer creating duplicate candles

**Diagnosis:**
```sql
-- Check for duplicate candles
SELECT
  symbol,
  timeframe,
  open_time,
  COUNT(*) as duplicate_count
FROM forex_candles
GROUP BY symbol, timeframe, open_time
HAVING COUNT(*) > 1
ORDER BY open_time DESC;
```

**Solution:**
The system has duplicate prevention built-in, but if duplicates occur:
```sql
-- Remove duplicates (keeps first, deletes rest)
DELETE FROM forex_candles a
USING forex_candles b
WHERE a.id > b.id
  AND a.symbol = b.symbol
  AND a.timeframe = b.timeframe
  AND a.open_time = b.open_time;
```

### Problem: last_known_prices cache is stale

**Diagnosis:**
```sql
-- Check cache age
SELECT
  symbol,
  last_price,
  last_update,
  EXTRACT(EPOCH FROM (now() - last_update)) / 60 as age_minutes
FROM last_known_prices
ORDER BY age_minutes DESC;
```

**Solution:**
```sql
-- Refresh cache from recent candles
INSERT INTO last_known_prices (symbol, last_price, last_update)
SELECT DISTINCT ON (symbol)
  symbol,
  close as last_price,
  close_time as last_update
FROM forex_candles
WHERE close_time > now() - interval '1 hour'
ORDER BY symbol, close_time DESC
ON CONFLICT (symbol)
DO UPDATE SET
  last_price = EXCLUDED.last_price,
  last_update = EXCLUDED.last_update,
  updated_at = now();
```

---

## Maintenance

### Daily Tasks

1. Check CandleContinuityMonitor dashboard
2. Verify completeness percentages > 95%
3. Review recent gap fill log

### Weekly Tasks

1. Run historical backfill to catch any missed gaps:
   ```bash
   node scripts/backfill-candle-gaps.js 168
   ```

2. Check synthetic candle ratio:
   ```sql
   SELECT
     COUNT(*) FILTER (WHERE data_source = 'gap_fill') as synthetic,
     COUNT(*) as total,
     ROUND(COUNT(*) FILTER (WHERE data_source = 'gap_fill')::numeric / COUNT(*) * 100, 2) as synthetic_pct
   FROM forex_candles
   WHERE open_time > now() - interval '7 days';
   ```

   **Healthy range:** 5-15% synthetic candles

3. Review gap fill log for patterns:
   ```sql
   SELECT
     symbol,
     timeframe,
     COUNT(*) as gap_fill_count,
     SUM(candles_filled) as total_candles_created
   FROM candle_gap_fill_log
   WHERE created_at > now() - interval '7 days'
   GROUP BY symbol, timeframe
   ORDER BY gap_fill_count DESC;
   ```

### Monthly Tasks

1. Archive old gap fill logs (optional):
   ```sql
   DELETE FROM candle_gap_fill_log
   WHERE created_at < now() - interval '30 days';
   ```

2. Validate data integrity:
   ```bash
   node scripts/backfill-candle-gaps.js 720  # 30 days
   ```

---

## Performance Considerations

### Database Indexes

The system creates these indexes automatically:
- `idx_forex_candles_gap_detection` on (symbol, timeframe, open_time)
- `idx_candle_gap_fill_log_symbol_timeframe` on (symbol, timeframe, created_at)
- `idx_last_known_prices_updated` on (updated_at)

### Query Performance

Gap detection queries are optimized to:
- Use index-only scans where possible
- Limit lookback windows (default 24 hours)
- Batch process symbols/timeframes
- Respect market hours to reduce unnecessary checks

### Resource Usage

**Browser:**
- Candle finalizer: ~0.1% CPU (runs once per minute)
- Memory: ~5MB for price cache and candle states

**Server:**
- Scheduled function: runs 288 times/day (every 5 minutes)
- Each execution: ~2-10 seconds depending on gaps found
- Database load: Minimal, uses efficient queries

---

## Future Enhancements

### Planned Features

1. **Predictive Gap Prevention**
   - Monitor price feed latency
   - Preemptively create candles when feed is slow

2. **Enhanced Market Hours**
   - Support for specific forex pair trading hours
   - Holiday calendar integration

3. **Machine Learning Gap Detection**
   - Identify patterns in gap occurrences
   - Predict likely gap times
   - Optimize checking schedule

4. **Advanced Monitoring**
   - Email/SMS alerts for critical data gaps
   - Slack/Discord integration
   - Real-time dashboard with websockets

### Potential Optimizations

1. **Batch Processing**
   - Group gap fills into transactions
   - Reduce database round trips

2. **Intelligent Scheduling**
   - Increase check frequency during volatile periods
   - Reduce checks during low-activity hours

3. **Distributed Caching**
   - Redis for last_known_prices
   - Faster access across multiple instances

---

## Summary

This comprehensive candle gap filling system ensures your forex charts maintain professional-grade continuity by:

✅ **Automatically detecting gaps** in real-time
✅ **Creating flat candles** using the last known price
✅ **Respecting market hours** to avoid false gap detection
✅ **Providing multiple layers** of gap prevention (frontend, backend, scheduled)
✅ **Offering monitoring tools** for visibility and control
✅ **Maintaining audit logs** for compliance and debugging

The result is smooth, continuous charts that accurately represent market conditions, including periods of no activity, matching the behavior of professional trading platforms.

---

## Support

If you encounter issues:

1. Check the troubleshooting section above
2. Review browser console logs for `[BackgroundAggregator]` messages
3. Inspect the `candle_gap_fill_log` table for recent operations
4. Run the monitoring dashboard to see current health status
5. Use the manual backfill script as a last resort

For persistent issues, the system is designed to be self-healing - gaps will be automatically filled within 5 minutes by the scheduled function.
