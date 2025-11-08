# 3-Month Historical Data Backfill Guide

## Overview

This guide explains how to populate your database with up to **5,000 historical candles** per symbol/timeframe combination from TradingView, providing approximately **3 months** of backtest data.

## What You'll Get

### Data Coverage by Timeframe

- **1-minute (M1)**: 5,000 candles ≈ 3.5 days
- **5-minute (M5)**: 5,000 candles ≈ 17 days
- **15-minute (M15)**: 5,000 candles ≈ 52 days
- **30-minute (M30)**: 4,320 candles = 90 days (full 3 months)
- **1-hour (H1)**: 2,160 candles = 90 days (full 3 months)
- **4-hour (H4)**: 540 candles = 90 days (full 3 months)
- **Daily (D1)**: 90 candles = 90 days (full 3 months)
- **Weekly (W1)**: 12 candles = 90 days (full 3 months)

### Trading Pairs

- EURUSD
- XAUUSD (Gold)
- GBPUSD
- USDJPY
- US30 (Dow Jones)

**Total**: 5 symbols × 8 timeframes = 40 combinations

## Prerequisites

### 1. Python 3.8 or Higher

Check your Python version:
```bash
python3 --version
```

If not installed, download from [python.org](https://www.python.org/downloads/)

### 2. pip (Python Package Manager)

Check if pip is installed:
```bash
pip3 --version
```

If not available, install it:
```bash
# On Ubuntu/Debian
sudo apt-get install python3-pip

# On macOS
brew install python3

# On Windows
python -m ensurepip --upgrade
```

### 3. Supabase Credentials

Verify your `.env` file contains:
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

**Important**: Use the `SUPABASE_SERVICE_ROLE_KEY`, not the anon key, as it has write permissions.

## Installation Steps

### Step 1: Navigate to Script Directory

```bash
cd scripts/tradingview-backfill
```

### Step 2: Install Python Dependencies

```bash
pip3 install -r requirements.txt
```

This installs:
- `tvdatafeed` - TradingView data fetcher
- `python-dotenv` - Environment variable loader
- `supabase` - Supabase Python client
- `pandas` - Data manipulation library

### Step 3: Verify Installation

```bash
python3 -c "import tvDatafeed; import supabase; import pandas; print('All dependencies installed!')"
```

## Running the Backfill

### Execute the Script

```bash
python3 backfill_historical_candles.py
```

### What Happens

1. **Configuration Display**
   - Shows symbols and timeframes
   - Displays target of 5,000 candles per combination
   - Total: 40 combinations

2. **Confirmation Prompt**
   - Press Enter to start the backfill
   - Script will begin processing

3. **Progress Updates**
   - Each symbol/timeframe shows:
     - Existing candle count
     - Fetching progress
     - Candles to insert
     - Insert success/errors

4. **Final Verification**
   - Table showing candle counts by symbol/timeframe
   - Status indicators (✅ Good, ⚠️ Moderate, ❌ Low)
   - Total statistics

### Example Output

```
╔═══════════════════════════════════════════════════════════╗
║  TradingView Historical Data Backfill for Pipnosis       ║
╚═══════════════════════════════════════════════════════════╝

Symbols: XAUUSD, US30, EURUSD, GBPUSD, USDJPY
Timeframes: M1, M5, M15, M30, H1, H4, D1, W1
Target: 5000 candles per combination
Total combinations: 40

Press Enter to start backfill...

============================================================
Processing EURUSD - H1
============================================================
  📊 Existing candles: 555
  📡 Fetching 4495 H1 candles for EURUSD from TradingView (OANDA:EURUSD)...
  ✅ Fetched 4495 candles for EURUSD H1
  🔍 Filtering candles before 2025-10-08T15:00:00Z...
  📦 4495 candles to insert (filtered from 4495)
  💾 Inserting 4495 candles into database...
  ✅ Inserted: 4495, Errors: 0
```

## Expected Duration

- **Total time**: 5-10 minutes
- **Per combination**: ~10-15 seconds
- **Rate limiting**: 1-second delay between requests

## Verification

### 1. Database Query (Optional)

Check candle counts directly:
```sql
SELECT
  symbol,
  timeframe,
  COUNT(*) as candles,
  MIN(open_time) as earliest,
  MAX(open_time) as latest
FROM forex_candles
GROUP BY symbol, timeframe
ORDER BY symbol, timeframe;
```

### 2. UI Verification

1. Navigate to `AI Training & Backtesting` page
2. Select EURUSD
3. Set date range to last 60 days
4. Click "Run Pre-Flight Diagnostics"
5. Should show green checkmarks for data availability

### 3. Run Test Backtest

Configuration:
- **Session Name**: "3-month test"
- **Symbol**: EURUSD
- **Start Date**: 60 days ago
- **End Date**: Yesterday
- **Risk Mode**: Medium

Expected result: Backtest should complete without data errors.

## Troubleshooting

### Issue: "No module named pip"

**Solution**: Install pip for Python 3
```bash
# Ubuntu/Debian
sudo apt-get install python3-pip

# macOS
brew install python3

# Windows
python -m ensurepip --upgrade
```

### Issue: "No data returned from TradingView"

**Possible causes**:
- Symbol not available on TradingView
- Rate limiting (wait a few minutes and retry)
- Network connectivity issues

**Solution**:
- Script will skip failed symbols automatically
- Check console output for specific error messages
- Re-run script - it will skip completed combinations

### Issue: "Database connection error"

**Possible causes**:
- Invalid Supabase credentials
- Network connectivity issues
- Service role key not set

**Solution**:
1. Verify `.env` file has `SUPABASE_SERVICE_ROLE_KEY`
2. Check Supabase project is active
3. Test connection: `python3 -c "from supabase import create_client; import os; from dotenv import load_dotenv; load_dotenv('../../.env'); print('Connection OK')"`

### Issue: "Permission denied writing to forex_candles"

**Possible causes**:
- Using anon key instead of service role key
- RLS policies blocking insert

**Solution**:
1. Verify using `SUPABASE_SERVICE_ROLE_KEY` in `.env`
2. Service role key bypasses RLS policies
3. Check key is correctly copied (no extra spaces)

### Issue: Script crashes mid-execution

**Solution**:
- Script is idempotent - safe to re-run
- Uses upsert with conflict handling
- Skips combinations already completed
- Simply restart: `python3 backfill_historical_candles.py`

## What's Changed

### Updated Files

1. **backfill_historical_candles.py**
   - Changed `CANDLES_TO_FETCH = 200` to `CANDLES_TO_FETCH = 5000`
   - Updated documentation

2. **backtest-diagnostics.ts**
   - Changed timeframes to: `['H1', 'M30', 'M15', 'M5', 'M1']`
   - Updated minimum requirements:
     - H1: 100 candles
     - M30: 200 candles
     - M15: 300 candles
     - M5: 500 candles
     - M1: 500 candles

3. **AITrainingPage.tsx**
   - Added automatic date range setting
   - Default: 60 days ago to yesterday
   - Prevents future date errors

## After Backfill

### Data Storage

All candles are stored in the `forex_candles` table:
```sql
CREATE TABLE forex_candles (
  id uuid PRIMARY KEY,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  open_time timestamptz NOT NULL,
  close_time timestamptz NOT NULL,
  open numeric NOT NULL,
  high numeric NOT NULL,
  low numeric NOT NULL,
  close numeric NOT NULL,
  volume numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(symbol, timeframe, open_time)
);
```

### Live Data Integration

- Historical data (from TradingView) and live data (from MetaAPI) coexist
- No conflicts due to unique constraint on (symbol, timeframe, open_time)
- Chronological continuity is maintained
- Charts seamlessly display both sources

### Best Practices

1. **Run once**: This is a one-time operation to seed historical data
2. **Monitor results**: Check final verification table
3. **Test before production**: Run small backtest first
4. **Keep script**: Save for future use if you add new symbols
5. **No maintenance**: Historical data persists permanently

## Advanced Usage

### Backfill Specific Symbols Only

Edit `backfill_historical_candles.py`:
```python
# Change this line:
PAIRS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY']

# To only backfill EURUSD:
PAIRS = ['EURUSD']
```

### Backfill Specific Timeframes Only

Edit `backfill_historical_candles.py`:
```python
# Change this line:
TIMEFRAMES = {
    'M1': Interval.in_1_minute,
    'M5': Interval.in_5_minute,
    # ... etc
}

# To only backfill higher timeframes:
TIMEFRAMES = {
    'H1': Interval.in_1_hour,
    'H4': Interval.in_4_hour,
    'D1': Interval.in_daily,
}
```

### Custom Candle Count

Edit `backfill_historical_candles.py`:
```python
# Change this line:
CANDLES_TO_FETCH = 5000

# To fetch fewer (faster):
CANDLES_TO_FETCH = 1000

# Or maximum (slower):
CANDLES_TO_FETCH = 5000  # TradingView free tier limit
```

## Summary

You now have a complete system for loading 3 months of historical data:

✅ **Script Updated**: Fetches 5,000 candles per combination
✅ **Diagnostics Updated**: Accepts realistic minimum requirements
✅ **UI Updated**: Sets sensible default date ranges
✅ **Environment Verified**: Has required credentials
✅ **Guide Created**: Complete instructions for execution

### Next Steps

1. Navigate to `scripts/tradingview-backfill` directory
2. Run `pip3 install -r requirements.txt`
3. Execute `python3 backfill_historical_candles.py`
4. Wait 5-10 minutes for completion
5. Verify results in AI Training page
6. Run your first 60-day backtest!

**The system is now ready to backtest with 3 months of historical data from TradingView (free tier).**
