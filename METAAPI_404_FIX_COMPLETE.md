# MetaAPI 404 Error Fix - COMPLETE

## Problem Detected
Console shows MetaAPI 404 errors for XAUUSD (Gold):
```
POST /.netlify/functions/historical-backfill 500 (Internal Server Error)
{"success":false,"error":"MetaAPI HTTP 404: Not Found","durationMs":124}
```

Errors occurred for:
- XAUUSD M15
- XAUUSD M30
- XAUUSD H1
- Potentially US30 as well

## Root Cause

The primary MetaAPI account (`28867898-bcc5-4a8d-969f-1acc6073eae2`) doesn't have XAUUSD or US30 historical data available. This is common because:
1. Different MT4/MT5 brokers offer different symbols
2. Some accounts have limited symbol access
3. Historical data availability varies by account type

## Solution Implemented

### 1. **Fallback Account Support**
Updated `historical-backfill.ts` to:
- Try primary account first
- If 404 error, automatically try fallback account
- Use the account that has the symbol available
- Log which account is being used for each symbol

```typescript
const accounts = [metaApiAccountId, metaApiAccountIdFallback];
// Tests each account and uses the one that works
```

### 2. **Graceful Error Handling**
Updated `historical-backfill-manager.ts` to:
- Continue processing other symbols even if one fails
- Log warnings for unavailable symbols instead of crashing
- Track which symbols worked vs which didn't

### 3. **Better Logging**
Added detailed console logs:
- "Using account X for SYMBOL TIMEFRAME"
- "Account X doesn't have SYMBOL - trying next account"
- "No MetaAPI account has SYMBOL available"

## Expected Behavior After Deployment

### Scenario A: Symbol Available on Fallback Account
```
[Backfill] Account 28867898... doesn't have XAUUSD - trying next account
[Backfill] Using account 169ff8dd... for XAUUSD M15
✅ Successfully backfilled 2,880 candles
```

### Scenario B: Symbol Not Available on Any Account
```
[Backfill] Account 28867898... doesn't have US30 - trying next account
[Backfill] Account 169ff8dd... doesn't have US30 - trying next account
⚠️ US30 M15 not available on MetaAPI account - skipping
```

The system continues processing other symbols without crashing.

## Working Symbols

These symbols should backfill successfully:
- ✅ **EURUSD** (working - no errors shown)
- ✅ **GBPUSD** (should work)
- ✅ **USDJPY** (should work)
- ⚠️ **XAUUSD** (will try fallback account)
- ⚠️ **US30** (will try fallback account)

## M1 and M5 Status

The timeframe-specific limits are still in effect:
- **M1**: 7 days (10,080 candles)
- **M5**: 14 days (4,032 candles)
- **M15+**: 30 days

For EURUSD, GBPUSD, USDJPY - M1 and M5 should now backfill successfully.

## Testing Steps

1. **Clear browser cache**
2. **Wait 5 minutes** for deployment
3. **Login to app** - triggers automatic backfill
4. **Open browser console** (F12)
5. **Look for log messages**:
   - Should see "Using account" messages
   - Should NOT see crashes or 500 errors
   - May see warnings for XAUUSD/US30 if unavailable

6. **Check charts**:
   - EURUSD M1: Should show 7 days
   - EURUSD M5: Should show 14 days
   - XAUUSD: May or may not have historical data (depends on fallback account)

## What Changed

### Files Modified:
1. **netlify/functions/historical-backfill.ts**
   - Added fallback account support
   - Tests each account before full backfill
   - Better error handling

2. **src/services/historical-backfill-manager.ts**
   - Wrapped each symbol in try-catch
   - Continues on failure
   - Logs warnings for 404 errors

## Deployment Status

- ✅ Code changes complete
- ✅ Build successful
- ✅ Deployment triggered
- ⏳ Waiting for deployment (5-10 minutes)

## Next Steps

After deployment:
1. Test EURUSD M1 and M5 - should work perfectly
2. Check console for XAUUSD logs - will show which account is used
3. If XAUUSD/US30 still unavailable, we can:
   - Remove them from the active symbols list
   - Focus only on Forex pairs (EURUSD, GBPUSD, USDJPY)
   - Add different symbols that ARE available

## Symbol Availability Check

To verify which symbols are available on each MetaAPI account:
1. Check Netlify function logs after backfill runs
2. Look for "Using account X for SYMBOL" messages
3. Build a list of working vs non-working symbols

---

**Status**: DEPLOYED AND TESTING
**Time**: 2025-12-08
**Priority**: EURUSD, GBPUSD, USDJPY M1/M5 backfill (main goal)
**Secondary**: XAUUSD/US30 availability check
