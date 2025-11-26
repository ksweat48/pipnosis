# Comprehensive TradingView Historical Data Backfill Guide

## Overview

This guide walks you through performing a complete one-time historical data backfill from TradingView that will:

✅ Fill all data gaps in your existing candles
✅ Replace incomplete candles (missing wicks, invalid OHLC)
✅ Extend historical data back 3-12 months depending on timeframe
✅ Align perfectly with your live candle system
✅ Provide complete, high-quality historical data for all pairs and timeframes

## Current Data State

Before backfill:
- Total candles: 26,923
- Only 4 out of 35 symbol/timeframe combinations have sufficient data (50+ candles)
- Many combinations have only 1-6 candles
- Incomplete candles with missing wicks due to MetaAPI issues

## What This Script Does Differently

### 1. Smart Gap Detection
- Analyzes existing data to find missing time periods
- Fills gaps intelligently without duplicating data

### 2. Incomplete Candle Replacement
- Identifies candles with invalid OHLC relationships (missing wicks)
- Replaces them with complete TradingView data
- Preserves already-complete candles

### 3. Optimized Fetch Limits
- M1: 7,200 candles (~5 days of complete data)
- M5: 6,048 candles (~3 weeks)
- M15: 5,760 candles (~2 months)
- M30: 4,320 candles (~3 months)
- H1: 4,320 candles (~6 months)
- H4: 2,160 candles (~1 year)
- D1: 365 candles (~1 year)
- W1: 260 candles (~5 years)

### 4. Live Candle Alignment
- Automatically stops at the last completed candle
- Never includes the current in-progress candle
- Seamlessly integrates with your continuous-price-poller system

### 5. Data Source Tracking
- Marks all TradingView data with 'tradingview' source
- Allows you to track data provenance

## Prerequisites

### 1. Python Environment
```bash
cd scripts/tradingview-backfill
pip install -r requirements.txt
```

### 2. Environment Variables
Ensure your `.env` file has:
```env
VITE_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 3. Backup (Optional but Recommended)
```sql
-- Create a backup table
CREATE TABLE forex_candles_backup AS
SELECT * FROM forex_candles;

-- Or export to file
COPY forex_candles TO '/tmp/forex_candles_backup.csv' CSV HEADER;
```

## Execution Steps

### Step 1: Dry Run (Recommended First Step)

Test the script without making any changes:

```bash
cd scripts/tradingview-backfill
python3 comprehensive_backfill.py --dry-run
```

This will:
- Show you what data would be fetched
- Display gaps and incomplete candles
- Give you a preview of the changes without modifying the database

### Step 2: Test on Single Symbol/Timeframe

Start with a small test:

```bash
python3 comprehensive_backfill.py --symbols EURUSD --timeframes M15
```

This will:
- Backfill only EURUSD M15 data
- Allow you to verify the results before proceeding
- Take ~2 minutes

### Step 3: Full Backfill

Run the complete backfill for all symbols and timeframes:

```bash
python3 comprehensive_backfill.py
```

Expected duration:
- Total time: 60-90 minutes for all 40 combinations
- Progress is displayed in real-time
- Each combination takes 1-2 minutes

### Step 4: Monitor Progress

The script will display:
```
==================================================
Processing EURUSD - M15
==================================================
  📊 Existing candles: 2
  📅 Earliest: 2025-11-08T10:00:00+00:00
  📅 Latest: 2025-11-08T10:15:00+00:00
  ⚠️  Incomplete candles: 2
  📡 Fetching 5760 M15 candles for EURUSD from TradingView...
  ✅ Fetched 5760 candles for EURUSD M15
  🔍 Filtered 5760 -> 5758 candles (excluded in-progress)
  📅 Last completed candle time: 2025-11-10T20:45:00+00:00
  💾 Inserting 5756 new candles...
  🔄 Updating 2 incomplete candles...
  ✅ Inserted: 5756, Updated: 2, Skipped: 0
```

## Understanding the Output

### Per Symbol/Timeframe Output

```
📊 Existing candles: X         → How many candles already exist
📅 Earliest/Latest: ...        → Date range of existing data
⚠️  Incomplete candles: X      → Candles with invalid OHLC (will be replaced)
🔍 Detected X gaps            → Missing time periods (will be filled)
📡 Fetching...                 → Getting data from TradingView
✅ Fetched: X candles          → Successfully retrieved from TradingView
🔍 Filtered X -> Y            → Excluded current in-progress candle
💾 Inserting X new candles... → Filling gaps
🔄 Updating X incomplete...    → Replacing invalid candles
✅ Final counts                → Summary of changes
```

### Final Summary

```
COMPREHENSIVE BACKFILL SUMMARY
=====================================
Duration: 4523.45 seconds
Total candles fetched from TradingView: 185,240
Total candles inserted (new): 180,156
Total candles updated (replaced incomplete): 234
Gaps filled: 180,156
Incomplete candles replaced: 234
Errors: 0
Success rate: 100.0%
```

### Final Verification Table

```
Symbol    M1          M5          M15         M30         H1          H4          D1          W1
-------------------------------------------------------------------------------------------------------
XAUUSD    ✅7200      ✅6048      ✅5760      ✅4320      ✅4320      ✅2160      ✅365       ✅260
US30      ✅7200      ✅6048      ✅5760      ✅4320      ✅4320      ✅2160      ✅365       ✅260
EURUSD    ✅7200      ✅6048      ✅5760      ✅4320      ✅4320      ✅2160      ✅365       ✅260
GBPUSD    ✅7200      ✅6048      ✅5760      ✅4320      ✅4320      ✅2160      ✅365       ✅260
USDJPY    ✅7200      ✅6048      ✅5760      ✅4320      ✅4320      ✅2160      ✅365       ✅260

✅ = Excellent (100+ complete candles)
⚠️ = Good (50+ candles)
❌ = Needs more data (<50 candles)
(n) = n incomplete candles found
```

## Post-Backfill Verification

### 1. Check Total Candle Count

```bash
node scripts/verify-candles.js
```

Expected result:
- All 35 combinations should show ✅ (50+ candles)
- Most should have 100-7000 candles depending on timeframe
- Total candles should be ~180,000+

### 2. Verify Chart Rendering

1. Open your app: `https://pipnosis.com/trade`
2. Select any symbol (e.g., EURUSD)
3. Select any timeframe (e.g., M15)
4. You should see:
   - 5,760 candles loaded in the chart
   - Complete candles with proper wicks (shadows)
   - Smooth historical data extending back ~60 days
   - Seamless transition to live data

### 3. Check Data Continuity

```sql
-- Check for gaps in EURUSD M15 data
WITH candle_times AS (
  SELECT
    open_time,
    LAG(open_time) OVER (ORDER BY open_time) as prev_time,
    EXTRACT(EPOCH FROM (open_time - LAG(open_time) OVER (ORDER BY open_time))) / 60 as gap_minutes
  FROM forex_candles
  WHERE symbol = 'EURUSD' AND timeframe = 'M15'
  ORDER BY open_time
)
SELECT * FROM candle_times
WHERE gap_minutes > 15
LIMIT 10;
```

Expected: No results (or only gaps during market closures on weekends)

### 4. Verify Data Quality

```sql
-- Check that candles have proper OHLC relationships
SELECT symbol, timeframe, open_time, open, high, low, close
FROM forex_candles
WHERE high < GREATEST(open, close)  -- High should be >= max(open, close)
   OR low > LEAST(open, close)      -- Low should be <= min(open, close)
LIMIT 10;
```

Expected: No results (all candles valid)

### 5. Check Data Sources

```sql
-- See distribution of data sources
SELECT data_source, COUNT(*) as count
FROM forex_candles
GROUP BY data_source;
```

Expected:
```
data_source      | count
-----------------+--------
tradingview      | ~180000
metaapi          | ~27000
```

## Integration with Live System

### Your Live System Continues Unchanged

The backfill script only touches historical data and does NOT affect:

✅ `continuous-price-poller` Edge Function (continues running every minute)
✅ `realtime_prices` table (continues receiving live ticks)
✅ Background candle aggregation (continues building new candles)
✅ Chart live updates (continues showing real-time price movements)

### How Historical and Live Data Work Together

```
Historical Data (TradingView)
    ↓
[Database: forex_candles]
    ↓
[Chart loads historical candles for context]
    ↓
Live Data (continuous-price-poller)
    ↓
[Database: realtime_prices]
    ↓
[Background aggregator builds new candles]
    ↓
[Chart updates in real-time with new candles]
```

### Seamless Transition Point

The script automatically calculates the last completed candle time:

```python
# Example for M15 timeframe at 2025-11-10 20:47:00 UTC:
# Current candle started at: 20:45:00 (in progress)
# Last completed candle:     20:30:00 (this is where historical data stops)

# Your live system picks up from 20:45:00 forward
# No gaps, no overlaps - perfectly aligned!
```

## Troubleshooting

### Error: "No data returned from TradingView"

**Cause**: Symbol not available or rate limited

**Solution**:
1. Check symbol mapping in the script
2. Wait a few minutes and retry
3. Use `--symbols` flag to skip problematic symbols

### Error: "Database connection error"

**Cause**: Invalid credentials or network issue

**Solution**:
1. Verify `.env` file has correct SUPABASE_SERVICE_ROLE_KEY
2. Check Supabase project is active
3. Test connection manually:
   ```bash
   psql "your_connection_string" -c "SELECT COUNT(*) FROM forex_candles;"
   ```

### Error: "Rate limit exceeded"

**Cause**: Too many requests to TradingView

**Solution**:
- The script includes 1.5-second delays between requests
- If you still hit limits, increase the delay in the script:
  ```python
  time.sleep(3)  # Increase from 1.5 to 3 seconds
  ```

### Incomplete Candles Still Present After Backfill

**Cause**: TradingView data also incomplete for that period

**Solution**:
- Check the specific candles in the database
- Some very recent candles may still be forming
- Historical candles from closed market periods should be complete

## Advanced Options

### Backfill Specific Symbols Only

```bash
python3 comprehensive_backfill.py --symbols XAUUSD EURUSD
```

### Backfill Specific Timeframes Only

```bash
python3 comprehensive_backfill.py --timeframes M15 H1 D1
```

### Combined Filters

```bash
python3 comprehensive_backfill.py --symbols EURUSD --timeframes M15 M30 H1
```

### Increase Fetch Limits (More Historical Data)

Edit the script and increase `FETCH_LIMITS`:

```python
FETCH_LIMITS = {
    'M1': 10000,   # ~7 days
    'M5': 10000,   # ~5 weeks
    'M15': 10000,  # ~100 days
    'M30': 10000,  # ~200 days
    'H1': 10000,   # ~1.5 years
    'H4': 5000,    # ~2 years
    'D1': 1000,    # ~3 years
    'W1': 500,     # ~10 years
}
```

**Note**: TradingView's free tier may limit historical data availability. Paid accounts have more access.

## Expected Results After Completion

### Data Coverage (Approximate)

| Timeframe | Candles | Time Period Covered | Storage |
|-----------|---------|---------------------|---------|
| M1 | 7,200 | 5 days | ~36 MB |
| M5 | 6,048 | 21 days | ~30 MB |
| M15 | 5,760 | 60 days | ~29 MB |
| M30 | 4,320 | 90 days | ~22 MB |
| H1 | 4,320 | 180 days | ~22 MB |
| H4 | 2,160 | 360 days | ~11 MB |
| D1 | 365 | 365 days | ~2 MB |
| W1 | 260 | 5 years | ~1.3 MB |

**Total**: ~180,000 candles × 5 symbols = ~900,000 candles (~153 MB)

### Chart Performance

- Load time: <2 seconds for any timeframe
- Smooth scrolling through historical data
- No lag or stuttering
- Live updates continue seamlessly

### AI Trading Readiness

With complete historical data, your AI trading system can:
- Analyze patterns over months of data
- Calculate accurate technical indicators
- Backtest strategies reliably
- Train on high-quality, complete candles
- Make informed trading decisions

## Maintenance

### One-Time Operation

This backfill is designed to run **once**. After completion:

✅ Your live systems maintain current data going forward
✅ No need to run backfill again
✅ Historical data remains in database permanently

### If You Need to Re-Backfill

Scenarios where you might run it again:
- Added new symbols to your trading pairs
- Want to extend historical data further back
- Discovered data quality issues in specific periods

Simply run the script again - it's idempotent and won't duplicate data.

## Support

If you encounter issues:

1. Check the console output for specific error messages
2. Run with `--dry-run` first to diagnose
3. Test with a single symbol/timeframe first
4. Verify your environment variables are correct
5. Ensure Python dependencies are installed

## Summary

This comprehensive backfill script provides:

✅ **Complete Historical Data**: Up to 1 year of complete candles depending on timeframe
✅ **Gap Filling**: Automatically detects and fills missing time periods
✅ **Quality Improvement**: Replaces incomplete candles with proper OHLC data
✅ **Live Integration**: Perfectly aligns with your continuous price polling system
✅ **Safe Operation**: Smart merge logic preserves good data, fixes bad data
✅ **Production Ready**: Your charts will have professional-grade historical context

**Total Execution Time**: 60-90 minutes
**Expected Final Count**: ~180,000+ complete, validated candles
**Chart Load Time**: <2 seconds for any symbol/timeframe
**AI Training Readiness**: 100% - All 35 combinations fully populated

🚀 **Ready to Run**: `python3 comprehensive_backfill.py`
