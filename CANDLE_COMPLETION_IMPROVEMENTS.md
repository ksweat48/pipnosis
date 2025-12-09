# Candle Completion Improvements - Deployed

## Problem
Candles were frequently incomplete or cut off, resulting in gaps and partial candle formation on charts. This was caused by timing issues between data collection, aggregation, and finalization processes.

## Root Causes Identified

1. **Short Lookback Window**: Server-side aggregator only looked back 3 minutes, causing it to miss candles if function execution was delayed
2. **Conservative Safety Limits**: MAX_CANDLES_PER_TIMEFRAME was set to 3, limiting backfill capacity
3. **Long Grace Periods**: 60-second buffers before finalizing candles meant incomplete candles stayed incomplete
4. **Infrequent Gap Checks**: Candle finalizer only ran every 60 seconds, delaying gap detection
5. **Short Backfill Window**: Only filled gaps within 1 hour, missing recent but older gaps

## Changes Deployed

### 1. Server-Side Aggregator (`continuous-candle-aggregator.ts`)

**Extended Lookback Window**
- BEFORE: 3 minutes lookback
- AFTER: 10 minutes lookback
- IMPACT: Ensures all recent price data is captured even if function is delayed

**Increased Candle Creation Limit**
- BEFORE: MAX_CANDLES_PER_TIMEFRAME = 3
- AFTER: MAX_CANDLES_PER_TIMEFRAME = 10
- IMPACT: More aggressive backfilling to close gaps quickly

**Reduced Finalization Buffer**
- BEFORE: 60-second safety buffer
- AFTER: 30-second safety buffer
- IMPACT: Faster candle completion without excessive waiting

**Intelligent Lookback Logic**
- BEFORE: Always started from 3 candles ago
- AFTER: Starts from last saved candle time, or 10 candles ago (whichever is more recent)
- IMPACT: Automatically fills all gaps since last successful run

### 2. Browser-Side Aggregator (`background-candle-aggregator.ts`)

**Faster Gap Detection**
- BEFORE: Checked every 60 seconds
- AFTER: Checks every 30 seconds
- IMPACT: Gaps detected and filled twice as fast

**Reduced Grace Period**
- BEFORE: 60-second grace period before finalization
- AFTER: 30-second grace period
- IMPACT: Candles finalize faster, reducing incomplete candle display time

**Extended Backfill Window**
- BEFORE: Only filled gaps within last 1 hour
- AFTER: Fills gaps within last 2 hours
- IMPACT: Better coverage for users who were away or had connection issues

## Expected Results

### Immediate Improvements
- Candles should complete within 30-60 seconds instead of 60-120 seconds
- Gaps should be detected and filled within 30 seconds instead of 60+ seconds
- Server-side aggregator catches 10 minutes of data instead of 3 minutes

### Long-Term Improvements
- Fewer incomplete candles on charts
- Better data continuity when returning to the app after being away
- More reliable M1 and M5 timeframes (most critical for trading)
- Automatic gap recovery without manual intervention

## Testing Recommendations

1. **Monitor Chart Quality**: Watch for reduction in incomplete/flat candles
2. **Check Gap Frequency**: Monitor how often gaps appear vs get filled automatically
3. **Verify Completion Time**: Time how long it takes for a new M1 candle to appear complete
4. **Test Recovery**: Close browser for 10 minutes, then return and verify gaps are filled

## Performance Considerations

- Slightly increased database load from more frequent checks (30s vs 60s)
- More aggressive backfilling may consume more function execution time
- Extended lookback means larger queries, but still well within limits

## Monitoring

Watch for these metrics:
- Time to candle completion (should be 30-60s consistently)
- Gap frequency per symbol/timeframe
- Function execution time (should stay under 30s total)
- Number of candles created per run (should see higher counts initially as backlog clears)

## Rollback Plan

If issues occur, revert these values:
```typescript
// Revert to conservative settings
MAX_CANDLES_PER_TIMEFRAME = 3
lookbackMinutes = 3
CANDLE_FINALIZER_CHECK_INTERVAL_MS = 60000
bufferMs = 60 * 1000
```

## Next Steps (Future Enhancements)

1. Add quality scoring to distinguish real-tick candles from synthetic/flat candles
2. Implement visual indicators showing candle data quality
3. Add proactive monitoring that alerts when completion rates drop
4. Optimize M1 aggregation specifically since it's the foundation for all higher timeframes
5. Investigate root cause of price data gaps (if realtime_prices has gaps, everything downstream will too)

---

**Deployed**: 2025-12-09
**Status**: Active and monitoring
**Expected Impact**: 50-70% reduction in incomplete candles
