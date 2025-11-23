# Targeted Backfill Guide: Nov 7, 2024 Corrupted Candles

## Overview

This script replaces corrupted candles from November 7, 2024 (00:00 to 14:10 UTC) with proper OHLC data including wicks from TradingView.

## Problem Being Solved

During the period from November 7, 2024 00:00 UTC to 14:10 UTC, the system generated candles without proper wicks (high/low values were equal to open/close). This script fetches the correct historical data from TradingView and replaces those corrupted candles.

## Quick Start

### 1. Navigate to the script directory

```bash
cd scripts/tradingview-backfill
```

### 2. Ensure dependencies are installed

```bash
pip3 install -r requirements.txt
```

### 3. Run a dry run first (recommended)

```bash
python3 targeted_backfill_nov7.py --dry-run
```

This will show you exactly what will be replaced without modifying the database.

### 4. Run the actual backfill

```bash
python3 targeted_backfill_nov7.py
```

## What It Does

### Scope
- **Pairs**: XAUUSD, US30, EURUSD, GBPUSD, USDJPY
- **Timeframes**: M1, M5, M15, M30, H1, H4, D1, W1
- **Time Range**: Nov 7, 2024 00:00:00 UTC to Nov 7, 2024 14:10:00 UTC
- **Total Combinations**: 40 (5 pairs × 8 timeframes)

### Process
1. Queries existing candles in the corrupted time range
2. Analyzes current data quality (percentage with wicks)
3. Fetches proper historical candles from TradingView
4. Analyzes new data quality
5. Replaces corrupted candles using upsert (overwrites based on unique constraint)
6. Verifies final data quality

### Data Quality Analysis

The script checks each candle for wicks:
- **Upper Wick**: `high > max(open, close)`
- **Lower Wick**: `low < min(open, close)`

Candles are counted as:
- **With Wicks**: Has upper or lower wick (proper OHLC data)
- **Without Wicks**: No wicks (corrupted data where high=max(open,close) and low=min(open,close))

## Example Output

```
╔═══════════════════════════════════════════════════════════════════╗
║  Targeted Backfill: Nov 7, 2024 Corrupted Candles (00:00-14:10) ║
╚═══════════════════════════════════════════════════════════════════╝

Target Time Range:
  Start: 2024-11-07T00:00:00+00:00
  End:   2024-11-07T14:10:00+00:00
  Duration: 14.17 hours

Symbols: XAUUSD, US30, EURUSD, GBPUSD, USDJPY
Timeframes: M1, M5, M15, M30, H1, H4, D1, W1
Total combinations: 40

======================================================================
Processing EURUSD - M15
======================================================================
  📊 Existing candles in range: 56
  📈 Current data quality:
     - With wicks: 8 (14.3%)
     - Without wicks: 48
  📡 Fetching M15 candles for EURUSD from TradingView (OANDA:EURUSD)...
     Target range: 2024-11-07T00:00:00+00:00 to 2024-11-07T14:10:00+00:00
  ✅ Fetched 56 candles in target range for EURUSD M15
  📈 New data quality:
     - With wicks: 54 (96.4%)
     - Without wicks: 2
  💾 Replacing 56 candles with 56 new candles...
  ✅ Replaced: 56, Errors: 0
```

## Safety Features

### Dry Run Mode
- Test the script without modifying data
- See exactly what will be replaced
- Verify data quality improvements before committing

### Surgical Precision
- Only affects candles in the specific 14-hour window
- Uses database unique constraint to prevent duplicates
- Candles outside the time range are not touched

### No Disruption
- Does not interfere with real-time candle aggregation
- Does not affect the continuous price poller
- Independent operation that can run while system is live

### Data Integrity
- Uses upsert with `ignore_duplicates=False` to overwrite corrupted data
- Maintains unique constraint on (symbol, timeframe, open_time)
- Validates candles have proper wicks before insertion
- Batch processing (50 candles per batch) for optimal performance

## Verification

After completion, the script displays a quality verification table:

```
======================================================================
FINAL VERIFICATION - Candle Quality in Target Range
Target: 2024-11-07 00:00 to 14:10 UTC
======================================================================

Symbol    M1          M5          M15         M30         H1          H4          D1          W1
----------------------------------------------------------------------------------------------------
XAUUSD    ✅850(96%)  ✅170(98%)  ✅56(96%)   ✅28(100%)  ✅14(100%)  ✅3(100%)   ✅1(100%)   ✅1(100%)
US30      ✅850(95%)  ✅170(97%)  ✅56(98%)   ✅28(100%)  ✅14(100%)  ✅3(100%)   ✅1(100%)   ✅1(100%)
EURUSD    ✅850(97%)  ✅170(96%)  ✅56(96%)   ✅28(100%)  ✅14(100%)  ✅3(100%)   ✅1(100%)   ✅1(100%)
GBPUSD    ✅850(96%)  ✅170(98%)  ✅56(97%)   ✅28(100%)  ✅14(100%)  ✅3(100%)   ✅1(100%)   ✅1(100%)
USDJPY    ✅850(98%)  ✅170(97%)  ✅56(96%)   ✅28(100%)  ✅14(100%)  ✅3(100%)   ✅1(100%)   ✅1(100%)

✅ = Excellent (90%+ have wicks)
⚠️ = Moderate (50-89% have wicks)
❌ = Poor (<50% have wicks)
```

## Expected Duration

- **Dry Run**: ~2-3 minutes
- **Live Backfill**: ~3-5 minutes

The script includes 1-second delays between requests to respect TradingView rate limits.

## Troubleshooting

### TradingView Connection Issues

If you see "No data returned from TradingView", it may be due to:
- Rate limiting (wait a few minutes and retry)
- Network connectivity issues
- TradingView service availability

The script will continue processing other pairs/timeframes even if one fails.

### Database Connection Issues

Ensure your `.env` file has valid credentials:
```env
VITE_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### Permission Errors

The script uses `SUPABASE_SERVICE_ROLE_KEY` which bypasses RLS policies and has full access. Ensure this key is set correctly in your `.env` file.

## Post-Backfill Verification

### In the UI
1. Navigate to pipnosis.com/trade
2. Select any symbol (e.g., EURUSD)
3. Select any timeframe (e.g., M15)
4. Navigate to November 7, 2024 on the chart
5. Verify that candles display proper wicks (upper and lower shadows)

### In the Database
You can manually verify with SQL:

```sql
-- Check candle quality for EURUSD M15 in the target range
SELECT
  open_time,
  open,
  high,
  low,
  close,
  CASE
    WHEN high > GREATEST(open, close) OR low < LEAST(open, close)
    THEN 'Has Wicks'
    ELSE 'No Wicks'
  END as quality
FROM forex_candles
WHERE symbol = 'EURUSD'
  AND timeframe = 'M15'
  AND open_time >= '2024-11-07T00:00:00Z'
  AND open_time < '2024-11-07T14:10:00Z'
ORDER BY open_time;
```

## Important Notes

### One-Time Operation
This script is designed to run once to fix the specific corrupted data from November 7, 2024. After completion, you do not need to run it again.

### TradingView Limitations
- Free tier limitations may apply
- Some symbols may have different data availability
- Data quality depends on TradingView's data providers

### Symbol Mapping
| Pipnosis | TradingView Exchange | TradingView Symbol |
|----------|---------------------|-------------------|
| XAUUSD   | OANDA              | XAUUSD            |
| US30     | CME_MINI           | YM1!              |
| EURUSD   | OANDA              | EURUSD            |
| GBPUSD   | OANDA              | GBPUSD            |
| USDJPY   | OANDA              | USDJPY            |

## Rollback

If you need to rollback changes:

1. The script does not create backups automatically
2. If you need to restore, you would need to re-run with the original corrupted data
3. However, since we're replacing corrupted data with correct data, rollback should not be necessary

## Summary

This targeted backfill script provides a surgical solution to fix the specific corrupted candles from November 7, 2024. It safely replaces only the affected data without disrupting any live operations, and includes comprehensive verification to ensure data quality improvements.

The script is designed to be:
- **Safe**: Dry run mode and precise targeting
- **Fast**: ~3-5 minutes for full execution
- **Reliable**: Error handling and verification
- **Non-disruptive**: Runs independently of live systems
- **Verifiable**: Quality analysis before and after

Once complete, your charts will display proper candlestick wicks for the previously corrupted time period.
