# How to Verify Global Polling is Working

## Quick Verification Steps

After launching the application, follow these steps to verify that all forex pairs are polling consistently:

### 1. Check Console Logs (30 seconds after app load)

Open your browser's Developer Console and look for these messages:

```
✅ EXPECTED OUTPUT:
--------------------
[GlobalPollingCoordinator] 🚀 Initializing global polling for all forex pairs...
[GlobalPollingCoordinator] Pairs: EURUSD, XAUUSD, GBPUSD, US30
[GlobalPollingCoordinator] Timeframes: M1, M5, M15, M30, H1, H4, D1

[GlobalPollingCoordinator] 📊 Initializing EURUSD...
[GlobalPollingCoordinator]    ✓ Multi-timeframe aggregator ready for EURUSD
[GlobalPollingCoordinator]    ✓ Candle states initialized for all timeframes
[GlobalPollingCoordinator]    ✓ Polling started for EURUSD

[GlobalPollingCoordinator] 📊 Initializing XAUUSD...
[GlobalPollingCoordinator]    ✓ Multi-timeframe aggregator ready for XAUUSD
[GlobalPollingCoordinator]    ✓ Candle states initialized for all timeframes
[GlobalPollingCoordinator]    ✓ Polling started for XAUUSD

... (same for GBPUSD and US30)

[GlobalPollingCoordinator] ✅ All forex pairs initialized and polling
```

### 2. Check Status Report (1 minute after initialization)

Every 60 seconds, the coordinator logs a status report:

```
✅ EXPECTED OUTPUT:
--------------------
[GlobalPollingCoordinator] 📊 Status Report:
  Active Pairs: 4/4
  Total Ticks Received: 487
  Uptime: 62s
  ✅ EURUSD: 122 ticks, last: 1s ago
  ✅ XAUUSD: 121 ticks, last: 2s ago
  ✅ GBPUSD: 123 ticks, last: 1s ago
  ✅ US30: 121 ticks, last: 2s ago
```

**What to Look For**:
- All pairs should have ✅ (green checkmark)
- Tick counts should be similar across pairs (~120 ticks per minute)
- "Last tick" should be very recent (0-5 seconds ago)
- No ❌ (red X) or ⏸️ (pause) symbols

### 3. Check UI Status Panel

In the app interface:
1. Find the **"Global Polling Status"** card (below Configuration Status)
2. It should show: `4/4 pairs active`
3. Click to expand the panel
4. Verify all 4 pairs show green "active" status with recent tick times

### 4. Watch Real-Time Updates

1. Keep the Status Panel expanded
2. Watch the tick counts increment every few seconds
3. "Last tick" times should continuously update
4. All pairs should remain green

### 5. Verify Database Persistence

Run this query in your Supabase SQL Editor:

```sql
-- Check recent candles for all pairs and timeframes
SELECT
    symbol,
    timeframe,
    COUNT(*) as candle_count,
    MAX(timestamp) as latest_candle,
    MIN(timestamp) as oldest_candle
FROM market_data
WHERE timestamp > NOW() - INTERVAL '10 minutes'
GROUP BY symbol, timeframe
ORDER BY symbol, timeframe;
```

**Expected Results**:
- Should see data for all 4 pairs (EURUSD, XAUUSD, GBPUSD, US30)
- Each pair should have data for all 7 timeframes (M1, M5, M15, M30, H1, H4, D1)
- Total: 28 rows (4 pairs × 7 timeframes)
- Latest candles should be very recent (within last few minutes)

### 6. Test Chart Switching

1. Switch between different forex pairs in the chart dropdown
2. Each pair should load instantly with recent data
3. No loading delays or "No data" messages
4. Price updates should continue in real-time for all pairs

## Troubleshooting

### Problem: No Console Messages

**Cause**: Polling initialization delayed or failed

**Solution**:
1. Wait 10 seconds after page load
2. Refresh the page
3. Check browser console for errors
4. Verify `VITE_METAAPI_*` environment variables are set

### Problem: Some Pairs Show ❌ (Error)

**Cause**: API connection failure for specific pair

**Solution**:
1. Check Netlify function logs for errors
2. Verify MetaAPI credentials
3. Check if hitting rate limits
4. Wait 5 minutes for automatic retry

### Problem: "Last Tick" Shows Long Time Ago

**Cause**: Polling stopped or connection lost

**Solution**:
1. Check network connectivity
2. Refresh the page
3. Check Netlify function status
4. Verify MetaAPI account is active

### Problem: Database Has No Recent Data

**Cause**: Database write permissions or connection issue

**Solution**:
1. Check Supabase connection status
2. Verify RLS policies on `market_data` table
3. Check console for database errors
4. Run database diagnostics from Configuration Status panel

## Success Criteria

✅ **System is Working Correctly When**:

1. Console shows "All forex pairs initialized and polling"
2. Status reports show "Active Pairs: 4/4"
3. All pairs have tick counts > 0 and incrementing
4. UI panel shows all pairs as green/active
5. Database query returns recent data for all 28 pair-timeframe combinations
6. Charts load instantly when switching pairs
7. Real-time price updates visible on all pairs

## Performance Expectations

- **Startup Time**: 6-10 seconds for full initialization
- **Tick Rate**: ~30 ticks/minute per pair (~120 total ticks/minute)
- **Memory Usage**: ~50-100 MB for polling system
- **Database Writes**: ~100-200 writes/minute (batched)
- **CPU Usage**: <5% during steady-state polling

## Next Steps After Verification

Once verified working:
1. Monitor for 24 hours to ensure stability
2. Check database growth rate (should be ~1-2 MB/hour)
3. Verify no memory leaks (check browser Task Manager)
4. Test under various network conditions
5. Monitor Netlify function usage/costs

## Need Help?

If verification fails:
1. Check `GLOBAL_POLLING_IMPLEMENTATION.md` for detailed architecture
2. Review console errors carefully
3. Check Netlify function logs
4. Verify Supabase connection and credentials
5. Ensure MetaAPI account is active and has sufficient credits
