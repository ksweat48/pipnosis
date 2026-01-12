# Stale Price Data Fix - Complete Implementation

## Problem Summary

The system was showing price data that was **52+ hours old** (188496 seconds), causing critical trading blocks:

```
[Freshness Gate] 🚫 PRE-CHECK FAILED: Price data is 188496s old (age: 188496s)
[Alpha+Omega] 🚫 HARD BLOCK: Price data stale: Price data is 188496s old (DATA INTEGRITY)
```

## Root Cause Analysis

1. **Missing Scheduled Cleanup**: The database function `cleanup_old_realtime_prices_batch()` existed but was NEVER called automatically
2. **No Retention Enforcement**: Old price data accumulated indefinitely in the `realtime_prices` table
3. **Fallback Behavior**: When no fresh prices existed, the system served the oldest available price (52+ hours old)
4. **No Absolute Limits**: The system had warning thresholds but no hard rejection of extremely old data

## Solution Implemented

### 1. Emergency Data Cleanup ✅

**Migration**: `emergency_cleanup_stale_prices.sql`

- Immediately purged ALL prices older than 2 hours from the database
- Cleaned up based on both `created_at` AND `broker_time` timestamps
- Added logging to show before/after state
- Updated table comments to document retention policy

**Expected Impact**:
- All prices in database are now fresh (< 2 hours old)
- Trading system will stop blocking on stale prices
- Database size reduced significantly

### 2. Automatic Cleanup Scheduler ✅

**New File**: `netlify/functions/realtime-prices-cleanup.ts`

- Calls the existing `cleanup_old_realtime_prices_batch()` database function
- Deletes data older than 24 hours in batches (10,000 records at a time)
- Logs cleanup results and provides table statistics
- Scheduled to run **every hour** via Netlify cron

**Configuration**: `netlify.toml`
```toml
[functions."realtime-prices-cleanup"]
  timeout = 60
  schedule = "0 * * * *"  # Every hour at :00 minutes
```

### 3. Absolute Price Age Limits ✅

**Updated**: `src/config/time-constants.ts`

Added new constant:
```typescript
PRICE_STALENESS_ABSOLUTE_MAX: 600, // 10 minutes - reject anything older than this
```

**Updated**: `src/services/coordinators/price-coordinator.ts`

Added hard rejections in three locations:
1. `fetchRealtimePrice()` - Rejects database prices older than 10 minutes
2. `getCachedPrice()` - Rejects cached prices older than 10 minutes
3. `getPrices()` - Rejects bulk-fetched prices older than 10 minutes

**Behavior**:
- System will now NEVER serve prices older than 10 minutes
- Falls back to candle data instead of serving stale prices
- Returns explicit error: `"Price data too old: XXXs (max: 600s)"`

## Protection Layers

The system now has **FOUR protection layers** against stale price data:

1. **Database Triggers** (existing):
   - `prevent_old_realtime_prices()` - Rejects inserts older than 48 hours
   - `prevent_duplicate_prices()` - Prevents duplicate price flooding

2. **Hourly Cleanup** (new):
   - Scheduled function runs every hour
   - Deletes data older than 24 hours
   - Prevents accumulation of old data

3. **Absolute Age Limits** (new):
   - Price Coordinator rejects prices older than 10 minutes
   - Applies to database queries, cache, and bulk fetches
   - Hard cutoff prevents serving extremely stale data

4. **Freshness Gate** (existing):
   - Pre-execution validation before Omega/Alpha calls
   - Blocks trading on prices older than 120 seconds
   - Advisory system for moderately stale data

## Expected Data Flow

```
Price Collection (every minute)
↓
realtime_prices table
↓
Duplicate Prevention Trigger (< 10s window)
↓
Old Data Prevention Trigger (< 48h)
↓
Hourly Cleanup (keeps last 24h)
↓
Price Coordinator (rejects > 10min)
↓
Freshness Gate (blocks trading > 2min)
↓
Trade Execution (only fresh prices)
```

## Monitoring & Verification

### Immediate Checks (Next 5 Minutes)

1. **Verify Migration Applied**:
   ```sql
   SELECT
     COUNT(*) as total_prices,
     MIN(created_at) as oldest,
     MAX(created_at) as newest,
     EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) as oldest_age_seconds
   FROM realtime_prices;
   ```

   Expected: `oldest_age_seconds` should be < 7200 (2 hours)

2. **Verify Price Collection Running**:
   - Check Netlify function logs for `hybrid-price-collector`
   - Should run every minute with 8 ticks per execution
   - Look for: `[HybridCollector:*] Total: X ticks collected`

3. **Verify No More Stale Price Errors**:
   - Browser console should NOT show "Price data is XXXXs old" errors
   - Freshness Gate should show: `✅ Pre-check PASSED - price age: <60s`

### Hourly Checks (After First Cleanup)

1. **Verify Cleanup Function Runs**:
   - Check Netlify function logs for `realtime-prices-cleanup`
   - Should run at :00 minutes of each hour
   - Look for: `[PriceCleanup:*] ✅ Cleanup complete: X records deleted`

2. **Verify Table Size Stays Bounded**:
   ```sql
   SELECT
     COUNT(*) as total_prices,
     pg_size_pretty(pg_total_relation_size('realtime_prices')) as table_size
   FROM realtime_prices;
   ```

   Expected: Table size should not grow unbounded

### Daily Checks

1. **Price Age Distribution**:
   ```sql
   SELECT
     symbol,
     COUNT(*) as price_count,
     MAX(created_at) as newest_price,
     EXTRACT(EPOCH FROM (NOW() - MAX(created_at))) as newest_age_seconds
   FROM realtime_prices
   GROUP BY symbol
   ORDER BY newest_age_seconds DESC;
   ```

   Expected: All symbols should have `newest_age_seconds` < 120 (2 minutes)

2. **Cleanup Function Success Rate**:
   - Check Netlify dashboard for function success rate
   - Should be 100% successful executions
   - Alert if any failures

## Rollback Plan (If Needed)

If issues occur:

1. **Disable Cleanup Function**:
   - Comment out the schedule in `netlify.toml`
   - Redeploy

2. **Adjust Thresholds**:
   - If 10 minutes is too aggressive, increase `PRICE_STALENESS_ABSOLUTE_MAX`
   - If cleanup is too frequent, change schedule to `0 */2 * * *` (every 2 hours)

3. **Manual Cleanup**:
   ```sql
   SELECT cleanup_old_realtime_prices_batch(10000);
   ```

## Success Criteria

✅ **PASS** if:
- No more "Price data is 188496s old" errors
- All price data is < 2 minutes old during trading hours
- Table size stays bounded (< 500k records)
- Cleanup function runs successfully every hour

❌ **FAIL** if:
- Stale price errors continue after 1 hour
- Price collection stops working
- Table grows unbounded (> 1M records)
- Cleanup function errors out

## Files Modified

1. **Database**:
   - `supabase/migrations/[timestamp]_emergency_cleanup_stale_prices.sql` (new)

2. **Netlify Functions**:
   - `netlify/functions/realtime-prices-cleanup.ts` (new)
   - `netlify.toml` (updated)

3. **Frontend**:
   - `src/config/time-constants.ts` (updated)
   - `src/services/coordinators/price-coordinator.ts` (updated)

## Next Steps

1. **Monitor for 24 hours** to ensure cleanup runs successfully
2. **Verify price data stays fresh** during all trading hours
3. **Check Netlify function logs** for any errors or warnings
4. **Adjust cleanup schedule** if needed based on data accumulation rate

---

**Status**: ✅ **DEPLOYED**
**Deployment Time**: 2026-01-12 03:00 UTC
**Expected Resolution Time**: < 1 hour
**Priority**: P0 - Critical Infrastructure Fix
