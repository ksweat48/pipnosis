# New Year's Eve Market Hours Fix - December 31, 2025

## Problem Identified

The app was incorrectly showing all forex pairs (EURUSD, XAUUSD, GBPUSD, USDJPY, US30, NAS100, SPX500) as CLOSED on December 31, 2025, despite forex markets being open.

**Root Cause:** `src/utils/marketHours.ts` was treating December 31 (New Year's Eve) as a full-day market holiday when forex markets actually trade normal hours until 5pm EST.

## Fix Applied

### 1. Removed New Year's Eve Full-Day Holiday Block

**File:** `src/utils/marketHours.ts`

**Before:**
```typescript
// New Year's Eve (December 31) - typically closes early
if (month === 11 && date === 31) return true;  // ❌ WRONG - blocked entire day
```

**After:**
```typescript
// Note: New Year's Eve (Dec 31) is NOT a full holiday - forex markets trade normal hours until 5pm EST
```

### 2. Fixed Christmas Eve Holiday Logic

**Before:**
```typescript
// Christmas Eve (December 24) - typically closes early or fully closed
if (month === 11 && date === 24) return true;  // ❌ WRONG - blocked entire day
```

**After:**
```typescript
// Note: Christmas Eve (Dec 24) is NOT a full holiday - forex markets trade until early afternoon
// Some brokers close early (1-2pm EST), but spot forex remains open until then
```

## Impact

### Immediate Effects (Dec 31, 2025 4:29 AM EST)

**Before Fix:**
- ❌ EURUSD, XAUUSD, GBPUSD, USDJPY: Showing CLOSED (incorrect)
- ❌ US30, NAS100, SPX500: Showing CLOSED (incorrect)
- ✅ BTCUSD, ETHUSD: Showing OPEN (correct - 24/7)

**After Fix:**
- ✅ All forex pairs: Will show OPEN during market hours
- ✅ All crypto pairs: Continue showing OPEN 24/7
- ✅ Weekend protection: Still works (Fri 5pm - Sun 5pm EST)
- ✅ True holidays: Still blocked (Christmas Day, New Year's Day)

### Trading System Impact

1. **Polling Services Resume:**
   - `global-polling-coordinator` will restart forex polling
   - `browser-price-poller` will fetch forex prices
   - `chart-candle-poller` will update forex charts

2. **AI Trading Resumes:**
   - Alpha scout can analyze forex opportunities
   - Goal sessions can execute forex trades
   - Entry intents can be created for forex pairs

3. **Chart Display:**
   - Live price updates for forex pairs
   - Real-time candle formation
   - Current market data visible

## Architectural Notes

### Single Source of Truth (SSOT)
- Holiday logic centralized in `marketHours.ts`
- Fix automatically propagates to all consumers:
  - `global-polling-coordinator`
  - `browser-price-poller`
  - `chart-candle-poller`
  - `weekend-protection-service`
  - `goal-scanner`
  - All market-aware services

### No Changes Required In:
- Polling coordinators
- Chart components
- Trading engine
- Risk managers
- Any service using `isSymbolMarketOpen()`

All services automatically inherit correct market status.

## Future Improvements (Optional)

### Early Close Detection
Currently, forex markets are marked as open until standard 5pm EST close. Some brokers close early on:
- New Year's Eve (1-3pm)
- Christmas Eve (1-2pm)
- Good Friday (varies)

**Enhancement Options:**
1. Add `getEarlyCloseTime(date)` function
2. Return modified close times instead of binary open/closed
3. Update `getForexMarketStatus()` to check early-close times

This is more accurate but adds complexity. Current fix prioritizes availability over precision.

## Deployment

- **Status:** ✅ Deployed to production
- **Build:** ✅ Successful
- **Time:** December 31, 2025 4:29 AM EST
- **Verification:** Markets will show OPEN when app reloads

## Testing Instructions

1. Refresh the app after deployment
2. Check any forex pair (EURUSD, XAUUSD, etc.)
3. Verify status shows "Open" during market hours
4. Confirm crypto pairs still show "Open 24/7"
5. Test weekend protection still works Friday evening

---

**Summary:** Forex markets now correctly show as OPEN on December 31 and Christmas Eve during trading hours. The fix uses the existing SSOT architecture, requiring zero changes to consuming services.
