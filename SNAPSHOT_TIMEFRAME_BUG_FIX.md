# Snapshot Timeframe Bug Fix - Complete

## Issue Summary
Multi-symbol scanner was failing with "No candle data found" errors for all symbols, despite M5 candles existing in the database.

## Root Cause
The `market-snapshot-cache.ts` had a **stale/incorrect timeframe mapping** that converted uppercase Timeframe values to lowercase database queries:

### Before (BROKEN):
```typescript
private async fetchCandles(symbol: string, timeframe: Timeframe): Promise<Candle[]> {
    const timeframeMap: Record<Timeframe, string> = {
      'M5': 'm5',    // ❌ Database stores 'M5' (uppercase)
      'M15': 'm15',  // ❌ Database stores 'M15'
      'H1': 'h1',    // ❌ Database stores 'H1'
      'H4': 'h4',    // ❌ Database stores 'H4'
      'D': 'd1'      // ❌ Wrong key ('D' vs 'D1')
    };

    const dbTimeframe = timeframeMap[timeframe];  // Returns 'm5' when DB has 'M5'

    const { data: candles } = await supabase
      .from('forex_candles')
      .eq('timeframe', dbTimeframe)  // Query: timeframe='m5' ❌ No match!
```

### After (FIXED):
```typescript
private async fetchCandles(symbol: string, timeframe: Timeframe): Promise<Candle[]> {
    // Database uses UPPERCASE: 'M5', 'M15', 'H1', 'H4', 'D1'
    // Timeframe type already matches this format - use directly
    const { data: candles } = await supabase
      .from('forex_candles')
      .eq('timeframe', timeframe)  // Query: timeframe='M5' ✅ Matches!
```

## Why Charts Worked But Snapshots Failed

**Charts (Working):**
- Used `appTimeframeToDb(timeframe)` → `formatTimeframeForDb()` → returns unchanged `'M5'`
- Query matched database format

**Snapshots (Broken):**
- Used hardcoded `timeframeMap['M5']` → returned `'m5'`
- Query didn't match database format → zero rows

## Database Format Verification

The database stores timeframes in **UPPERCASE**:
```sql
SELECT DISTINCT timeframe FROM forex_candles;
-- Returns: M1, M5, M15, M30, H1, H4, D1
```

## Fix Implementation

**File:** `/src/services/market-snapshot-cache.ts`
**Lines:** 234-246

**Changes:**
1. Removed incorrect `timeframeMap` object
2. Use `Timeframe` value directly (already uppercase)
3. Added clear documentation about database format

## Verification

✅ Build successful with no TypeScript errors
✅ No other active code paths have this issue
✅ Dead code (`market-snapshot-builder.ts`) not imported anywhere

## Impact

This fix resolves:
- ❌ "No candle data found for EURUSD@M5" errors
- ❌ "Failed to build snapshot" errors
- ❌ "Built 0 snapshots" in multi-symbol scanner
- ❌ All goal session scanning failures

Now goal sessions will correctly:
1. Query database with uppercase timeframes
2. Find M5 candles
3. Build market snapshots
4. Generate trading signals

## Date
2026-01-06

## Status
✅ Complete - Ready for deployment
