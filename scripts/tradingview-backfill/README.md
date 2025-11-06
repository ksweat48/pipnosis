# TradingView Historical Data Backfill

One-time script to populate your `forex_candles` table with 200 historical candles from TradingView for all Pipnosis trading pairs and timeframes.

## Overview

This script uses the `tvdatafeed` library to scrape historical OHLCV data from TradingView and insert it into your Supabase database. It's designed as a **one-time operation** to seed your charts with historical context.

### What It Does

- Fetches 200 historical candles for each symbol/timeframe combination
- Only inserts candles that don't already exist (using upsert with conflict handling)
- Preserves chronological order and timestamp continuity
- Does NOT interfere with live polling or real-time candle aggregation
- Provides detailed progress logging and verification

### Pairs & Timeframes

**Symbols:**
- XAUUSD (Gold)
- US30 (Dow Jones)
- EURUSD
- GBPUSD
- USDJPY

**Timeframes:**
- M1, M5, M15, M30, H1, H4, D1, W1

**Total:** 40 symbol/timeframe combinations

## Prerequisites

1. **Python 3.8 or higher** installed on your system
2. **Supabase credentials** configured in your `.env` file
3. **Internet connection** for accessing TradingView data

## Installation

### Step 1: Navigate to the script directory

```bash
cd scripts/tradingview-backfill
```

### Step 2: Install Python dependencies

```bash
pip install -r requirements.txt
```

Or if you use Python 3 explicitly:

```bash
pip3 install -r requirements.txt
```

### Step 3: Verify environment variables

Ensure your `.env` file in the project root contains:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## Usage

### Run the backfill script

```bash
python3 backfill_historical_candles.py
```

The script will:

1. Display a summary of what will be fetched
2. Prompt you to press Enter to confirm
3. Process each symbol/timeframe combination sequentially
4. Show real-time progress as candles are fetched and inserted
5. Display a final verification table with candle counts

### Expected Output

```
╔═══════════════════════════════════════════════════════════╗
║  TradingView Historical Data Backfill for Pipnosis       ║
╚═══════════════════════════════════════════════════════════╝

Symbols: XAUUSD, US30, EURUSD, GBPUSD, USDJPY
Timeframes: M1, M5, M15, M30, H1, H4, D1, W1
Target: 200 candles per combination
Total combinations: 40

Press Enter to start backfill...
```

For each symbol/timeframe:

```
============================================================
Processing EURUSD - M15
============================================================
  📊 Existing candles: 0
  📡 Fetching 200 M15 candles for EURUSD from TradingView (OANDA:EURUSD)...
  ✅ Fetched 200 candles for EURUSD M15
  📦 200 candles to insert (no existing data)
  💾 Inserting 200 candles into database...
  ✅ Inserted: 200, Errors: 0
```

### Final Verification

```
============================================================
FINAL VERIFICATION - Candle Counts by Symbol/Timeframe
============================================================

Symbol    M1      M5      M15     M30     H1      H4      D1      W1
----------------------------------------------------------------------
XAUUSD    ✅200   ✅200   ✅200   ✅200   ✅200   ✅200   ✅200   ✅200
US30      ✅200   ✅200   ✅200   ✅200   ✅200   ✅200   ✅200   ✅200
EURUSD    ✅200   ✅200   ✅200   ✅200   ✅200   ✅200   ✅200   ✅200
GBPUSD    ✅200   ✅200   ✅200   ✅200   ✅200   ✅200   ✅200   ✅200
USDJPY    ✅200   ✅200   ✅200   ✅200   ✅200   ✅200   ✅200   ✅200
```

## Safety Features

### No Disruption to Live Systems

The script operates completely independently:

- ✅ Only writes to `forex_candles` table
- ✅ Never touches `realtime_prices` table
- ✅ Does not interfere with `continuous-price-poller` Edge Function
- ✅ Does not affect `background-candle-aggregator` service
- ✅ Uses upsert with duplicate detection to prevent overwrites

### Smart Backfill Logic

- Checks existing candle counts before fetching
- Skips combinations that already have 200+ candles
- Filters new candles to only insert those before the earliest existing candle
- Inserts in batches of 50 for optimal performance
- Includes 1-second delay between requests to respect rate limits

### Data Integrity

- Proper timestamp handling (UTC with timezone awareness)
- Validates OHLC data before insertion
- Maintains UNIQUE constraint on (symbol, timeframe, open_time)
- Preserves chronological order
- No gaps between historical and live data

## Troubleshooting

### "No data returned from TradingView"

Some symbols may not be available on TradingView or may use different naming:

- **US30**: Uses CME_MINI:YM1! (Dow Jones Mini futures)
- **XAUUSD**: Uses OANDA:XAUUSD
- **Forex pairs**: Use OANDA exchange

If a symbol fails, verify the symbol mapping in the script.

### Rate Limiting

TradingView may throttle requests if you run the script too frequently. The script includes:

- 1-second delay between combinations
- Error handling and logging for failed requests

If you encounter rate limits, simply wait a few minutes and re-run the script. It will skip already-completed combinations.

### Database Connection Errors

Ensure:
- Your `.env` file has valid Supabase credentials
- Your Supabase project is active and accessible
- You have network connectivity

### Permission Errors

The script uses the ANON_KEY which should have write access to `forex_candles` through RLS policies. If you encounter permission errors, verify:

```sql
-- This policy should exist:
CREATE POLICY "Authenticated users can insert candles"
  ON forex_candles
  FOR INSERT
  TO authenticated
  USING (true)
  WITH CHECK (true);
```

## After Backfill

### Verify in the UI

1. Navigate to `pipnosis.com/trade`
2. Select any symbol (e.g., EURUSD)
3. Select any timeframe (e.g., M15)
4. Your chart should now display 200+ candles of historical data

### Continuity Check

The chart should seamlessly display:
- Historical candles from TradingView (older data)
- Live candles from MetaAPI polling (current data)
- No gaps or overlaps between the two sources

## Important Notes

### One-Time Operation

This script is designed to run **once** to seed your database. After completion:

- Your live systems will continue updating `forex_candles` with new data
- You do not need to run this script again
- Historical data will remain in the database permanently

### TradingView Limitations

- Free tier may have limited historical data
- Some symbols may have different availability
- Data accuracy depends on TradingView's data providers

### Symbol Mapping

The script maps Pipnosis symbols to TradingView equivalents:

| Pipnosis | TradingView Exchange | TradingView Symbol |
|----------|---------------------|-------------------|
| XAUUSD   | OANDA              | XAUUSD            |
| US30     | CME_MINI           | YM1!              |
| EURUSD   | OANDA              | EURUSD            |
| GBPUSD   | OANDA              | GBPUSD            |
| USDJPY   | OANDA              | USDJPY            |

## Cleanup

After successful backfill, you can:

1. Keep the script for potential future use
2. Archive it to a backup location
3. Remove the `scripts/tradingview-backfill` directory

The script and its dependencies are not needed for normal operation of Pipnosis.

## Support

If you encounter issues:

1. Check the console output for detailed error messages
2. Verify your Supabase credentials
3. Ensure Python dependencies are correctly installed
4. Check network connectivity to TradingView and Supabase

## Summary

This backfill script provides a simple, safe way to populate your charts with historical context using publicly available TradingView data. It's a one-time operation that seamlessly integrates with your existing live data systems, giving users a complete view of market history without disrupting real-time functionality.
