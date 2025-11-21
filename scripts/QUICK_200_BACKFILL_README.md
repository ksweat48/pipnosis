# Quick 200-Candle Backfill

This script generates the last 200 candles per pair/timeframe for quick chart display.

## Why 200 Candles?

- **Fast Execution**: Completes in ~1-2 minutes vs hours for full backfill
- **Sufficient for Charts**: 200 candles provide enough history for technical indicators
- **Low Database Load**: Only 7,000 candles vs 1.2+ million for 3-month backfill
- **Quick Testing**: Perfect for development and quick chart population

## Total Candles Generated

```
200 candles × 5 pairs × 7 timeframes = 7,000 candles
```

## Symbols

- EURUSD
- GBPUSD
- USDJPY
- XAUUSD
- US30

## Timeframes

- M1 (1 minute)
- M5 (5 minutes)
- M15 (15 minutes)
- M30 (30 minutes)
- H1 (1 hour)
- H4 (4 hours)
- D1 (1 day)

## Usage

```bash
cd scripts
node quick-200-backfill.cjs
```

## How It Works

1. Calculates the current candle boundary based on each timeframe
2. Generates 200 candles going back from now
3. Uses realistic price movements based on each symbol's characteristics
4. Normalizes timestamps to candle boundaries (no overlap)
5. Inserts candles with conflict handling (upsert)

## Features

- **Realistic Prices**: Base prices match actual market ranges
- **Proper Volatility**: Each symbol has appropriate price movement
- **Correct Precision**: EURUSD = 5 decimals, US30 = 2 decimals, etc.
- **Timestamp Normalization**: All candles align to proper boundaries
- **Data Source Tag**: Candles marked with `data_source: 'quick_backfill'`

## Expected Output

```
⚡ QUICK 200-CANDLE BACKFILL
==================================================================
Generating last 200 candles per pair/timeframe for quick chart display
Symbols: EURUSD, GBPUSD, USDJPY, XAUUSD, US30
Timeframes: M1, M5, M15, M30, H1, H4, D1
Candles per combo: 200
Total candles: 7,000

[1/35] EURUSD M1: Generating... Inserting... ✅ 200 candles
[2/35] EURUSD M5: Generating... Inserting... ✅ 200 candles
...

📊 SUMMARY
Duration: 87.3s
✅ Completed: 35/35
❌ Failed: 0
📦 Total candles: 7,000

✅ Quick backfill complete! Charts should now display data.
```

## After Running

1. Refresh your browser
2. Charts should immediately display 200 candles of historical data
3. Real-time updates will continue to add new candles

## Comparison: Quick vs Full Backfill

| Feature | Quick 200 | Full 3-Month |
|---------|-----------|--------------|
| Candles | 7,000 | 1.2+ million |
| Time | 1-2 min | 2-4 hours |
| Use Case | Development/Quick Setup | Production Historical Data |
| Database Load | Low | High |
| Chart Display | Excellent | Excellent |

## Notes

- The script uses **upsert** so it's safe to run multiple times
- Existing candles will not be duplicated
- Real-time candles will seamlessly continue from the backfilled data
- All timestamps are normalized to candle boundaries to prevent overlap
