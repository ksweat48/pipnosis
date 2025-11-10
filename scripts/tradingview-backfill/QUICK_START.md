# Quick Start: Comprehensive Historical Data Backfill

## TL;DR - Get Complete Historical Data in 3 Steps

### Step 1: Install Dependencies (2 minutes)

```bash
cd scripts/tradingview-backfill
pip3 install -r requirements.txt
```

### Step 2: Run the Interactive Script (5 minutes for test, 90 minutes for full)

```bash
./run-comprehensive-backfill.sh
```

Choose option:
- **Option 1**: Dry run (see what will happen, no changes)
- **Option 2**: Test with EURUSD M15 only (~2 minutes)
- **Option 3**: Full backfill all symbols/timeframes (~90 minutes)

### Step 3: Verify Results

```bash
cd ../..
node scripts/verify-candles.js
```

You should see:
- ✅ All 35 symbol/timeframe combinations with 50+ candles
- Total candles: ~180,000+
- All complete with proper wicks and OHLC data

## What You Get

After completion, your database will have:

| Symbol | M1 | M5 | M15 | M30 | H1 | H4 | D1 | W1 |
|--------|----|----|-----|-----|----|----|----|----|
| XAUUSD | 7,200 | 6,048 | 5,760 | 4,320 | 4,320 | 2,160 | 365 | 260 |
| US30 | 7,200 | 6,048 | 5,760 | 4,320 | 4,320 | 2,160 | 365 | 260 |
| EURUSD | 7,200 | 6,048 | 5,760 | 4,320 | 4,320 | 2,160 | 365 | 260 |
| GBPUSD | 7,200 | 6,048 | 5,760 | 4,320 | 4,320 | 2,160 | 365 | 260 |
| USDJPY | 7,200 | 6,048 | 5,760 | 4,320 | 4,320 | 2,160 | 365 | 260 |

**Total**: ~900,000 complete candles with full historical context

## Time Coverage Per Timeframe

- **M1**: 5 days of minute-by-minute data
- **M5**: 3 weeks of 5-minute candles
- **M15**: 2 months of 15-minute candles
- **M30**: 3 months of 30-minute candles
- **H1**: 6 months of hourly candles
- **H4**: 1 year of 4-hour candles
- **D1**: 1 year of daily candles
- **W1**: 5 years of weekly candles

## What Makes This Different

### From Your Previous Backfill Scripts

✅ **Smart Gap Detection**: Finds and fills missing time periods
✅ **Incomplete Candle Replacement**: Fixes candles with missing wicks
✅ **Optimized Limits**: Tailored fetch counts per timeframe
✅ **Live Integration**: Stops exactly at last completed candle
✅ **Data Source Tracking**: Marks all TradingView data
✅ **Comprehensive Logging**: See exactly what's happening

### From MetaAPI Data

❌ MetaAPI: Incomplete candles, missing wicks, gaps
✅ TradingView: Complete OHLC, proper wicks, continuous data

## Safety Features

🔒 **Dry Run Mode**: Test without making changes
🔒 **Smart Merge**: Preserves complete data, fixes incomplete
🔒 **No Live Data Interference**: Doesn't touch realtime_prices
🔒 **Idempotent**: Safe to run multiple times
🔒 **Transaction Support**: Batch inserts with error handling

## Manual Execution (Alternative)

If you prefer direct command-line:

### Dry Run First
```bash
cd scripts/tradingview-backfill
python3 comprehensive_backfill.py --dry-run
```

### Test Single Pair
```bash
python3 comprehensive_backfill.py --symbols EURUSD --timeframes M15
```

### Full Backfill
```bash
python3 comprehensive_backfill.py
```

### Custom Selection
```bash
python3 comprehensive_backfill.py --symbols XAUUSD EURUSD --timeframes M15 H1 D1
```

## Expected Output

### During Execution

```
==================================================
Processing EURUSD - M15
==================================================
  📊 Existing candles: 2
  📅 Earliest: 2025-11-08T10:00:00+00:00
  📅 Latest: 2025-11-08T10:15:00+00:00
  ⚠️  Incomplete candles: 2
  📡 Fetching 5760 M15 candles for EURUSD...
  ✅ Fetched 5760 candles for EURUSD M15
  🔍 Filtered 5760 -> 5758 candles
  📅 Last completed candle: 2025-11-10T20:45:00
  💾 Inserting 5756 new candles...
  🔄 Updating 2 incomplete candles...
  ✅ Inserted: 5756, Updated: 2, Skipped: 0
```

### Final Summary

```
COMPREHENSIVE BACKFILL SUMMARY
================================
Duration: 4523.45 seconds (~75 minutes)
Total candles fetched: 185,240
Total candles inserted: 180,156
Total candles updated: 234
Gaps filled: 180,156
Incomplete candles replaced: 234
Errors: 0
Success rate: 100.0%
```

## Verify Charts

After backfill:

1. Open `https://pipnosis.com/trade`
2. Select EURUSD
3. Select M15 timeframe
4. You should see:
   - 5,760 candles loaded instantly
   - Complete candles with proper wicks
   - ~60 days of historical data
   - Seamless transition to live data

## Troubleshooting

### Error: "tvDatafeed module not found"

```bash
pip3 install -r requirements.txt
```

### Error: "No data returned from TradingView"

- Wait 5 minutes (rate limit)
- Re-run the script
- It will skip already-completed combinations

### Error: "Database connection failed"

- Check `.env` file has correct credentials
- Verify `SUPABASE_SERVICE_ROLE_KEY` is set
- Test connection: `psql "your_connection_string"`

### Charts Not Showing Data

- Hard refresh browser: Ctrl+Shift+R
- Clear browser cache
- Check browser console for errors

## Next Steps

After successful backfill:

1. ✅ Verify data with `node scripts/verify-candles.js`
2. ✅ Check charts render properly in browser
3. ✅ Confirm live data continues updating
4. ✅ Test AI trading features with complete historical data
5. ✅ Archive backfill logs for reference

## One-Time Operation

This backfill is designed to run **once**. After completion:

- Your live price polling continues automatically
- New candles aggregate on top of historical data
- No need to run backfill again
- Historical data remains permanently in database

## Support

See detailed documentation:
- `COMPREHENSIVE_BACKFILL_GUIDE.md` - Complete guide
- `comprehensive_backfill.py` - Script source code
- `README.md` - Original backfill docs

## Summary

🎯 **Goal**: Fill gaps, fix incomplete candles, add 180,000+ complete historical candles
⏱️ **Time**: 60-90 minutes for full backfill
💾 **Storage**: ~153 MB total
🚀 **Result**: Professional-grade historical data for all symbols and timeframes

**Ready?** Run `./run-comprehensive-backfill.sh` and follow the prompts!
