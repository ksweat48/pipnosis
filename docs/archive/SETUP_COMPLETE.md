# TradingView Backfill Setup Complete

## Installation Summary

All Python dependencies have been successfully installed in a virtual environment for the TradingView historical data backfill script.

### What Was Installed

1. **Python Package Manager (pip)** - Version 25.1.1
2. **Python Virtual Environment** - Located at `scripts/tradingview-backfill/venv/`
3. **Dependencies Installed:**
   - `tvdatafeed` (v2.1.0) - TradingView data scraping library (from GitHub fork)
   - `python-dotenv` (v1.2.1) - Environment variable management
   - `supabase` (v2.24.0) - Supabase client for database operations
   - `pandas` (v2.3.3) - Data manipulation library
   - All required sub-dependencies

### Environment Validation

- ✅ Supabase credentials verified in `.env` file
- ✅ VITE_SUPABASE_URL: Configured
- ✅ SUPABASE_SERVICE_ROLE_KEY: Configured
- ✅ Database connection: Tested and working
- ✅ `forex_candles` table: Exists with proper schema
- ✅ Python imports: All successful

### Current Database State

Your `forex_candles` table currently contains:
- **EURUSD**: 1,863+ candles across multiple timeframes
- **GBPUSD**: 1,858+ candles across multiple timeframes
- **USDJPY**: 1,865+ candles across multiple timeframes
- **XAUUSD**: 1,779+ candles across multiple timeframes
- **US30**: 1,787+ candles across multiple timeframes

Note: Some timeframes (M1, M5, M15, M30, H1, H4) have 250+ candles, while D1 and W1 have fewer candles (as expected for longer timeframes).

## How to Run the Backfill

### Option 1: Using the Helper Script

```bash
cd /tmp/cc-agent/58035261/project/scripts/tradingview-backfill
./run-backfill.sh
```

### Option 2: Manual Execution

```bash
cd /tmp/cc-agent/58035261/project/scripts/tradingview-backfill
source venv/bin/activate
python3 backfill_historical_candles.py
```

### Option 3: Direct Execution (from project root)

```bash
/tmp/cc-agent/58035261/project/scripts/tradingview-backfill/venv/bin/python3 \
  /tmp/cc-agent/58035261/project/scripts/tradingview-backfill/backfill_historical_candles.py
```

## What the Backfill Will Do

The script will:

1. Connect to TradingView using the `tvdatafeed` library
2. Fetch up to 5,000 historical candles for each symbol/timeframe combination
3. Only insert candles that don't already exist (uses upsert logic)
4. Target all 5 symbols (XAUUSD, US30, EURUSD, GBPUSD, USDJPY)
5. Process all 8 timeframes (M1, M5, M15, M30, H1, H4, D1, W1)
6. Provide progress updates and verification tables
7. Add approximately 3 months of historical data for most timeframes

## Expected Runtime

- Total combinations: 40 (5 symbols × 8 timeframes)
- Time per combination: ~5-10 seconds
- **Estimated total time: 5-10 minutes**

## Important Notes

### Rate Limiting
The script includes a 1-second delay between requests to respect TradingView's rate limits. If you encounter errors, wait a few minutes before retrying.

### Symbol Mapping
The script automatically maps Pipnosis symbols to TradingView equivalents:
- XAUUSD → OANDA:XAUUSD
- US30 → CME_MINI:YM1!
- EURUSD → OANDA:EURUSD
- GBPUSD → OANDA:GBPUSD
- USDJPY → OANDA:USDJPY

### Data Safety
- The script uses `SUPABASE_SERVICE_ROLE_KEY` for database writes
- Duplicate detection prevents overwriting existing candles
- No disruption to live MetaAPI polling or candle aggregation
- Maintains proper timestamp chronology

## Troubleshooting

### "No data returned from TradingView"
Some symbols may have limited availability. The script will log the error and continue with other combinations.

### "Permission denied" errors
Ensure the `SUPABASE_SERVICE_ROLE_KEY` is correctly set in your `.env` file.

### Import errors
All dependencies are installed in the virtual environment. Always use the virtual environment Python:
```bash
/tmp/cc-agent/58035261/project/scripts/tradingview-backfill/venv/bin/python3
```

## Post-Backfill Verification

After running the backfill, verify the data:

```bash
# Check candle counts
cd /tmp/cc-agent/58035261/project/scripts
node verify-candles.js
```

Or query the database directly:
```sql
SELECT symbol, timeframe, COUNT(*) as candle_count
FROM forex_candles
GROUP BY symbol, timeframe
ORDER BY symbol, timeframe;
```

## Next Steps

1. Run the backfill script using one of the methods above
2. Monitor the progress output
3. Verify the final candle counts match your expectations
4. Check the charts in your UI to see the historical data

The backfill is a **one-time operation**. After completion, your live systems will continue to add new candles automatically, and you won't need to run this script again unless you want to refresh historical data for specific symbols/timeframes.

---

**Setup completed on:** November 8, 2025
**Virtual Environment:** `/tmp/cc-agent/58035261/project/scripts/tradingview-backfill/venv/`
**Python Version:** 3.13.5
