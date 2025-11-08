# Quick Start: 3-Month Historical Data Backfill

## TL;DR - Get 3 Months of Data in 10 Minutes

```bash
# 1. Go to backfill directory
cd scripts/tradingview-backfill

# 2. Install dependencies (first time only)
pip3 install -r requirements.txt

# 3. Run the script
python3 backfill_historical_candles.py

# 4. Press Enter when prompted
# 5. Wait 5-10 minutes
# 6. Done! You now have 3 months of historical data
```

## What You'll Get

| Timeframe | Candles | Days Coverage |
|-----------|---------|---------------|
| M1 (1min) | 5,000   | ~3.5 days     |
| M5 (5min) | 5,000   | ~17 days      |
| M15       | 5,000   | ~52 days      |
| M30       | 4,320   | **90 days**   |
| H1 (1hr)  | 2,160   | **90 days**   |
| H4        | 540     | **90 days**   |
| D1        | 90      | **90 days**   |
| W1        | 12      | **90 days**   |

**5 symbols** × 8 timeframes = **40 combinations** = ~200,000 total candles

## Prerequisites

✅ Python 3.8+ installed
✅ pip3 available
✅ `.env` file has `SUPABASE_SERVICE_ROLE_KEY`

## After Backfill

### Test Your Data

1. Go to **AI Training & Backtesting** page
2. Select **EURUSD**
3. Date range: **60 days ago to yesterday** (auto-filled)
4. Click **"Run Backtest"**
5. Should complete successfully with trades!

### What Changed in This Update

✅ Backfill script now fetches **5,000 candles** (was 200)
✅ Backtest diagnostics expect realistic amounts of data
✅ AI Training page auto-fills **last 60 days** (prevents future date errors)
✅ All timeframes including 1-minute are fetched

## Troubleshooting

**"No module named pip"**
```bash
# Install pip first
sudo apt-get install python3-pip  # Ubuntu/Debian
brew install python3              # macOS
```

**"Permission denied"**
- Check `.env` has `SUPABASE_SERVICE_ROLE_KEY` (not anon key)

**Script fails mid-run**
- Just re-run it! Uses upsert, skips completed combinations

**Rate limiting from TradingView**
- Wait 5 minutes, then re-run script

## Need Help?

See full guide: `BACKFILL_3_MONTHS_GUIDE.md`

---

**The system is ready to backtest with 3 months of free TradingView data!**
