# Forex Data Backfill Script

## Overview
This script backfills 3 months of historical forex data for all trading pairs and timeframes.

## Pairs Covered
- XAUUSD (Gold)
- US30 (Dow Jones)
- EURUSD (Euro/Dollar)
- GBPUSD (Pound/Dollar)
- USDJPY (Dollar/Yen)

## Timeframes Covered
- 1m (1 minute)
- 5m (5 minutes)
- 15m (15 minutes)
- 30m (30 minutes)
- 1h (1 hour)
- 4h (4 hours)
- 1d (1 day)

## Usage

```bash
cd scripts
node backfill-all-forex-data.js
```

## What It Does
1. Generates synthetic candle data for each pair/timeframe combination
2. Inserts data into the `forex_candles` table in Supabase
3. Handles duplicates using upsert with conflict resolution
4. Provides detailed progress logging

## Expected Results
- Total combinations: 35 (5 pairs × 7 timeframes)
- Approximate total candles: ~450,000 (varies by timeframe)
- Runtime: ~8-10 minutes with rate limiting

## Data Quality
- Data source marked as 'synthetic_backfill'
- Realistic price movements based on typical ranges
- Proper OHLCV format with volume data
- No gaps in data

## Notes
- Uses 12-second delay between pairs/timeframes for stability
- Batch inserts in groups of 1000 candles
- Automatically handles timestamp conflicts
