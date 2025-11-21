# Comprehensive Historical Backfill Guide

## Overview

This system backfills ALL available historical candle data from the earliest available date to the present candle for all configured symbols and timeframes.

## Features

- **Maximum historical depth** for each timeframe
- **Intelligent gap filling** from oldest to newest
- **Forward filling** to present candle
- **Automatic duplicate detection**
- **Progress tracking** with detailed stats
- **Error recovery** with retry logic

## Backfill Depths by Timeframe

| Timeframe | Maximum Days Back | Approximate Data Points |
|-----------|------------------|------------------------|
| M1        | 30 days          | ~43,200 candles        |
| M5        | 60 days          | ~17,280 candles        |
| M15       | 90 days          | ~8,640 candles         |
| M30       | 120 days         | ~5,760 candles         |
| H1        | 180 days         | ~4,320 candles         |
| H4        | 365 days         | ~2,190 candles         |
| D1        | 730 days         | ~730 candles           |
| W1        | 1,825 days       | ~260 candles           |

## Quick Start

### 1. Backfill All Data

```bash
node scripts/run-comprehensive-backfill.js
```

This will:
- Process all 5 symbols (XAUUSD, US30, EURUSD, GBPUSD, USDJPY)
- Process all 8 timeframes (M1, M5, M15, M30, H1, H4, D1, W1)
- Fetch maximum available historical data for each
- Fill forward to the present candle

### 2. Backfill Specific Symbol

```bash
node scripts/run-comprehensive-backfill.js EURUSD
```

### 3. Backfill Specific Symbol and Timeframe

```bash
node scripts/run-comprehensive-backfill.js EURUSD H1
```

## How It Works

### Phase 1: Backward Fill

1. Checks existing data in database
2. Determines the oldest available candle
3. Fetches data in 30-day chunks moving backwards
4. Continues until reaching maximum depth or no more data available
5. Saves all candles with `data_source: 'backfill'`

### Phase 2: Forward Fill

1. Identifies the newest candle in database
2. Fetches all candles from newest to present
3. Ensures no gaps exist up to current time
4. Saves with `data_source: 'metaapi'` for recent data

### Phase 3: Verification

1. Counts total candles per symbol/timeframe
2. Reports date range (oldest to newest)
3. Displays comprehensive table of results

## Expected Results

After a complete backfill, you should see:

```
┌────────────┬─────────┬──────────────┬──────────────┬───────────────┐
│ Symbol     │ TF      │ Total        │ Oldest       │ Newest        │
├────────────┼─────────┼──────────────┼──────────────┼───────────────┤
│ EURUSD     │ M1      │      43,200  │ 2024-10-20   │ 2024-11-20    │
│ EURUSD     │ M5      │      17,280  │ 2024-09-20   │ 2024-11-20    │
│ EURUSD     │ M15     │       8,640  │ 2024-08-20   │ 2024-11-20    │
│ EURUSD     │ M30     │       5,760  │ 2024-07-20   │ 2024-11-20    │
│ EURUSD     │ H1      │       4,320  │ 2024-05-20   │ 2024-11-20    │
│ EURUSD     │ H4      │       2,190  │ 2023-11-20   │ 2024-11-20    │
│ EURUSD     │ D1      │         730  │ 2022-11-20   │ 2024-11-20    │
│ EURUSD     │ W1      │         260  │ 2019-11-20   │ 2024-11-20    │
└────────────┴─────────┴──────────────┴──────────────┴───────────────┘
```

## Performance

- **M1 (30 days)**: ~5-10 minutes
- **M5 (60 days)**: ~5-8 minutes
- **M15 (90 days)**: ~3-5 minutes
- **M30 (120 days)**: ~3-4 minutes
- **H1 (180 days)**: ~2-3 minutes
- **H4 (365 days)**: ~2-3 minutes
- **D1 (730 days)**: ~1-2 minutes
- **W1 (1,825 days)**: ~1 minute

**Total for all symbols and timeframes**: ~20-30 minutes

## Rate Limiting

The system includes automatic rate limiting:
- 500ms delay between batches
- Batches process 30 days at a time
- Maximum 20 batches per symbol/timeframe

## Error Handling

The system handles:
- MetaAPI 404 errors (no more data available)
- Network timeouts
- Database conflicts (uses upsert with ignoreDuplicates)
- Invalid data responses

## Data Quality

All backfilled candles include:
- `data_source: 'backfill'` or `'metaapi'`
- `candle_status: 'backfilled'` or `'complete'`
- `completion_score: 90` or `100`

## Monitoring

Watch the console output for:
- ✅ Successful batches
- ⚠️ Warnings (no data available)
- ❌ Errors (with details)
- 📍 Progress milestones

## Troubleshooting

### No candles returned

This is normal when reaching the limit of available historical data. The system will automatically stop and mark as complete.

### MetaAPI 404 errors

Some symbols may not have historical data available for all timeframes. This is expected and handled gracefully.

### Database conflicts

The system uses upsert with `ignoreDuplicates: true` for backfilled data to avoid overwriting better quality existing data.

## Direct API Usage

You can also call the edge function directly:

```bash
curl -X POST \
  "${SUPABASE_URL}/functions/v1/comprehensive-backfill" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json"
```

With parameters:

```bash
curl -X POST \
  "${SUPABASE_URL}/functions/v1/comprehensive-backfill?symbol=EURUSD&timeframe=H1" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json"
```

## Integration with AI Training

Once backfilled, this data is immediately available for:
- AI training and backtesting
- Strategy optimization
- Pattern recognition
- Historical analysis
- Performance evaluation

## Maintenance

Run this backfill:
- **Once initially** to populate historical data
- **Weekly** to ensure continuous data coverage
- **After data gaps** detected by monitoring systems
- **Before major AI training sessions**

## Next Steps

After backfilling:

1. Verify data coverage with verification script
2. Check data quality metrics in admin dashboard
3. Run gap detection to identify any missing periods
4. Enable automated continuous polling for real-time updates
5. Start AI training with comprehensive historical dataset
