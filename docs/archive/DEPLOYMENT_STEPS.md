# Deployment Steps for Historical Data Continuity Fix

## Quick Start

Follow these steps to deploy the fix and refresh your historical data:

### Step 1: Deploy the Code Changes

```bash
# The code changes are already built
# Deploy to Netlify using the build hook
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

Wait for the deployment to complete (2-3 minutes).

### Step 2: Clear Existing Historical Data

Open your Supabase SQL Editor and run:

```sql
-- Clear all historical candle data
DELETE FROM forex_candles;
DELETE FROM market_data WHERE timeframe IN ('M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1');
DELETE FROM candle_completion_tracking;
DELETE FROM candle_data_completeness;

SELECT 'Historical data cleared - ready for fresh pull' as status;
```

### Step 3: Trigger Fresh Data Pull

Option A - Use the browser:
1. Open your application
2. Navigate to the Trade page
3. The chart will automatically fetch the latest data with proper timing

Option B - Use the script (recommended):
```bash
# Make sure you have Node.js environment variables set
export VITE_SUPABASE_URL="your_supabase_url"
export SUPABASE_SERVICE_ROLE_KEY="your_service_role_key"

# Run the refetch script
node scripts/refetch-historical-data.js
```

### Step 4: Verify the Fix

1. **Open Browser Console** (F12)
2. **Navigate to Trade page**
3. **Look for these success messages**:
   ```
   [ChartData] ✓ PERFECT CONTINUITY: Exactly one M5 interval between historical and live data
   [Chart Init] ✓ PERFECT: Current candle follows historical with exact M5 interval
   ```

4. **Check the chart visually**:
   - Historical candlesticks should end cleanly
   - Live price line should start right after the last candle
   - No gaps or overlaps visible

## What Changed

### Files Modified
1. `src/services/historical-data-service.ts` - Boundary calculation and filtering
2. `src/services/candle-data-service.ts` - Continuity validation
3. `src/services/background-candle-aggregator.ts` - Live data timing
4. `src/components/MarketChart.tsx` - Enhanced validation
5. `netlify/functions/forex-candles.js` - Filter incomplete candles

### Files Created
1. `scripts/refetch-historical-data.js` - Automated refetch tool
2. `clear-historical-data.sql` - Database cleanup script
3. `HISTORICAL_DATA_CONTINUITY_FIX.md` - Technical documentation
4. `DEPLOYMENT_STEPS.md` - This file

## Expected Behavior

### Before the Fix
```
Historical Data    [GAP or OVERLAP]    Live Data
[============]     ≠≠≠≠≠≠≠≠≠≠≠≠≠≠     [======>
```

### After the Fix
```
Historical Data                        Live Data
[============][=============================>
             ↑
        Perfect alignment
```

## Troubleshooting

### Issue: Still seeing gaps

**Check**:
1. Did the deployment complete successfully?
2. Did you clear the old historical data?
3. Check browser console for error messages
4. Verify realtime_prices table has recent data

**Solution**:
```bash
# Re-run the refetch script
node scripts/refetch-historical-data.js
```

### Issue: Console shows "GAP DETECTED"

**This means**:
- Historical data doesn't go far enough forward
- OR live polling hasn't started yet

**Solution**:
- Wait 30 seconds for live polling to initialize
- Refresh the page
- Check that persistent price polling is running

### Issue: Console shows "ERROR: Current candle is older"

**This means**:
- Historical data includes the current incomplete period

**Solution**:
1. Clear historical data again
2. Ensure latest code is deployed
3. Re-fetch historical data

### Issue: No live updates appearing

**Check**:
1. Background candle aggregator status (check console)
2. Realtime price polling is active
3. WebSocket connection is established

**Solution**:
```javascript
// In browser console, check status:
console.log(backgroundCandleAggregator.getStatus());
console.log(persistentPricePollingService.getStatus());
```

## Verification Checklist

- [ ] Code deployed to Netlify
- [ ] Database cleared of old historical data
- [ ] Fresh historical data fetched
- [ ] Console shows "PERFECT CONTINUITY" message
- [ ] Chart displays without gaps or overlaps
- [ ] Live updates are working
- [ ] All timeframes work correctly (M1, M5, M15, etc.)
- [ ] Multiple symbols tested (EURUSD, XAUUSD, etc.)

## Rollback Plan

If issues occur, you can rollback:

1. **Revert code changes**: Deploy previous version via Netlify
2. **Keep database clear**: The old data had the overlap issue
3. **Use historical-data-service**: The old service will still work, just without perfect timing

## Performance Impact

- **Positive**: Reduced data processing (excluding incomplete candles)
- **Neutral**: Same number of API calls to MetaAPI
- **Positive**: Better chart rendering (no duplicate timestamps)

## Next Steps After Deployment

1. **Monitor for 24 hours**: Watch console logs for any issues
2. **Test all symbols**: Verify each trading pair works correctly
3. **Test all timeframes**: M1, M5, M15, M30, H1, H4, D1, W1
4. **User feedback**: Confirm charts look correct to users
5. **Document any issues**: Report to development team

## Support

If you encounter issues:

1. Check `HISTORICAL_DATA_CONTINUITY_FIX.md` for technical details
2. Review browser console logs
3. Check Netlify function logs
4. Verify Supabase data integrity

---

**Deployment Date**: November 6, 2025
**Expected Downtime**: None (seamless deployment)
**Risk Level**: Low (additive changes with validation)
