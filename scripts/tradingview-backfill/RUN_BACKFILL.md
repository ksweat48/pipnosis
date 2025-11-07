# Quick Instructions: Run the Targeted Backfill

## TL;DR - Run These Commands

```bash
# From project root
cd scripts/tradingview-backfill

# Install dependencies (if not already installed)
pip3 install -r requirements.txt

# Run dry run first to preview changes
python3 targeted_backfill_nov7.py --dry-run

# Run actual backfill
python3 targeted_backfill_nov7.py
```

## What This Does

Replaces corrupted candles from **Nov 7, 2024 00:00-14:10 UTC** with proper TradingView data including wicks.

- **Time to complete**: 3-5 minutes
- **Pairs affected**: XAUUSD, US30, EURUSD, GBPUSD, USDJPY
- **Timeframes affected**: M1, M5, M15, M30, H1, H4, D1, W1
- **Safe**: Only affects the specific time window
- **Non-disruptive**: Won't affect current operations

## Step-by-Step

### 1. Test First (Dry Run)

```bash
cd scripts/tradingview-backfill
python3 targeted_backfill_nov7.py --dry-run
```

This shows you what will be replaced without modifying data.

### 2. Run the Backfill

```bash
python3 targeted_backfill_nov7.py
```

Press Enter when prompted to start.

### 3. Verify

After completion:
1. Open pipnosis.com/trade
2. Select any pair/timeframe
3. Navigate to Nov 7, 2024
4. Verify candles have proper wicks

## Expected Output

```
Target Time Range:
  Start: 2024-11-07T00:00:00+00:00
  End:   2024-11-07T14:10:00+00:00
  Duration: 14.17 hours

Processing EURUSD - M15
  📊 Existing candles in range: 56
  📈 Current data quality: 14.3% with wicks
  📈 New data quality: 96.4% with wicks
  ✅ Replaced: 56, Errors: 0
```

## Troubleshooting

**"Module not found"**: Run `pip3 install -r requirements.txt`

**"No data from TradingView"**: TradingView may be rate limiting. Wait a few minutes and retry.

**"Permission denied"**: Ensure your `.env` has `SUPABASE_SERVICE_ROLE_KEY` set.

## Done!

Once complete, all candles in the Nov 7 corrupted window will have proper OHLC data with wicks. Your charts will look perfect!
