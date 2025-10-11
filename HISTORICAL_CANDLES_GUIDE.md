# Historical Candles Pipeline - Implementation Guide

## Overview

This module provides a complete pipeline for fetching, storing, and managing historical candlestick data from MetaApi for the Pipnosis AI Trading Simulator. All data is stored in Supabase with no local file caching.

## Features

- Fetch up to 3 months (90 days) of historical candle data
- Automatic pagination handling for MetaApi's 1000 candle limit
- Smart chunking based on timeframe to optimize API calls
- Duplicate prevention via unique constraints
- Progress tracking with callback support
- Overwrite mode for refreshing existing data
- Statistics and data validation
- Admin-triggered refresh via Netlify Function

## Supported Timeframes

- `5m` - 5 minute candles
- `15m` - 15 minute candles
- `1h` - 1 hour candles

## Database Schema

### Table: `historical_candles`

```sql
CREATE TABLE historical_candles (
  id uuid PRIMARY KEY,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  time timestamptz NOT NULL,
  open numeric(20, 8) NOT NULL,
  high numeric(20, 8) NOT NULL,
  low numeric(20, 8) NOT NULL,
  close numeric(20, 8) NOT NULL,
  volume numeric(20, 8) DEFAULT 0,
  tick_volume integer DEFAULT 0,
  spread integer DEFAULT 0,
  broker_time text,
  data_source text DEFAULT 'metaapi_historical',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(symbol, timeframe, time)
);
```

## Usage

### 1. Basic Fetch

```typescript
import { fetchHistoricalCandles } from './services/fetchHistoricalCandles';

// Fetch 90 days of EURUSD 5-minute candles
const result = await fetchHistoricalCandles({
  symbol: 'EURUSD',
  timeframe: '5m',
  daysBack: 90
});

console.log(`Fetched ${result.candlesFetched} candles`);
console.log(`Saved ${result.candlesSaved} candles`);
```

### 2. Fetch with Progress Tracking

```typescript
const result = await fetchHistoricalCandles({
  symbol: 'GBPUSD',
  timeframe: '15m',
  daysBack: 30,
  onProgress: (progress) => {
    console.log(`${progress.percentComplete}% - ${progress.message}`);
    console.log(`Fetched: ${progress.candlesFetched}, Saved: ${progress.candlesSaved}`);
  }
});
```

### 3. Refresh Existing Data

```typescript
// Overwrite existing data (useful for refreshing recent candles)
const result = await fetchHistoricalCandles({
  symbol: 'XAUUSD',
  timeframe: '1h',
  daysBack: 7,
  overwrite: true // Will update existing candles
});
```

### 4. Quick Refresh Helper

```typescript
import { refreshRecentCandles } from './services/fetchHistoricalCandles';

// Refresh the most recent 3 days
const result = await refreshRecentCandles('EURUSD', '5m', 3);
```

### 5. Get Statistics

```typescript
import { getHistoricalCandleStats } from './services/fetchHistoricalCandles';

const stats = await getHistoricalCandleStats('EURUSD', '5m');

if (stats) {
  console.log(`Total candles: ${stats.totalCandles}`);
  console.log(`Date range: ${stats.oldestCandle} to ${stats.newestCandle}`);
  console.log(`Coverage: ${stats.dateRangeDays} days`);
}
```

## Test Script

Run the test script to fetch historical data from the command line:

```bash
# Install tsx if not already installed
npm install -g tsx

# Run test script
tsx scripts/test-fetch-candles.ts EURUSD 5m 90
tsx scripts/test-fetch-candles.ts GBPUSD 15m 30
tsx scripts/test-fetch-candles.ts XAUUSD 1h 60
```

### Test Script Output

```
Historical Candles Fetch Test Script

Configuration:
  Symbol:      EURUSD
  Timeframe:   5m
  Days Back:   90

Checking for existing data...
No existing data found. Will fetch fresh data.

Starting fetch operation...

[==========================                        ] 52% - Fetching chunk 12/23

Fetch Results

Status:          SUCCESS
  Candles Fetched: 23456
  Candles Saved:   23456
  Date Range:      2024-07-14T00:00:00.000Z to 2024-10-11T23:59:59.999Z
  Duration:        45.23s

Current database stats:
  Total Candles: 23456
  Oldest Candle: 2024-07-14T00:00:00.000Z
  Newest Candle: 2024-10-11T23:55:00.000Z
  Coverage:      89.9 days

Test completed successfully!
```

## Admin Refresh Endpoint

### Setup

1. Add the admin key to your `.env` file:

```env
ADMIN_REFRESH_KEY=your-secret-admin-key-here
```

2. Deploy to Netlify (the function is automatically deployed)

### Usage

Trigger a refresh via HTTP POST request:

```bash
# Refresh recent 3 days of EURUSD 5m data
curl -X POST "https://your-app.netlify.app/.netlify/functions/refresh-candles?symbol=EURUSD&timeframe=5m&daysBack=3&adminKey=your-secret-admin-key-here"

# Response:
{
  "status": "accepted",
  "message": "Refresh request received and queued",
  "params": {
    "symbol": "EURUSD",
    "timeframe": "5m",
    "daysBack": 3,
    "overwrite": true
  }
}
```

### Parameters

- `symbol` (required) - Trading symbol (e.g., EURUSD, GBPUSD, XAUUSD)
- `timeframe` (required) - Timeframe (5m, 15m, 1h)
- `daysBack` (optional, default: 3) - Number of days to fetch
- `overwrite` (optional, default: true) - Whether to overwrite existing data
- `adminKey` (required) - Admin authorization key

## How It Works

### 1. Chunking Strategy

The service automatically calculates optimal chunk sizes based on timeframe:

- **5m timeframe**: ~3 days per chunk (864 candles)
- **15m timeframe**: ~7 days per chunk (672 candles)
- **1h timeframe**: ~7 days per chunk (168 candles)

This ensures we stay under MetaApi's ~1000 candle limit per request.

### 2. Duplicate Prevention

The `historical_candles` table has a unique constraint on `(symbol, timeframe, time)`. When `overwrite=false`, the upsert operation uses `ignoreDuplicates: true`, skipping existing candles.

### 3. Date Range Handling

All dates are normalized to UTC:
- Start date: Set to midnight (00:00:00) UTC
- End date: Set to end of day (23:59:59) UTC

### 4. Error Handling

- Individual chunk failures don't stop the entire operation
- Failed chunks are logged and skipped
- Final result includes total fetched vs saved candles
- Progress callbacks receive error status

## Performance Characteristics

### API Calls

For 90 days of data:
- **5m**: ~30 API calls (3 days per chunk)
- **15m**: ~13 API calls (7 days per chunk)
- **1h**: ~13 API calls (7 days per chunk)

### Duration Estimates

- **5m, 90 days**: ~45-60 seconds
- **15m, 90 days**: ~20-30 seconds
- **1h, 90 days**: ~15-20 seconds

### Database Storage

Approximate storage per 90 days:
- **5m**: ~26,000 candles (~2.5 MB)
- **15m**: ~8,600 candles (~800 KB)
- **1h**: ~2,160 candles (~200 KB)

## Integration with Existing Systems

### Use with AI Analysis

```typescript
import { supabase } from './lib/supabase';
import { fetchHistoricalCandles } from './services/fetchHistoricalCandles';

// Ensure data is available
await fetchHistoricalCandles({
  symbol: 'EURUSD',
  timeframe: '15m',
  daysBack: 90
});

// Query candles for AI analysis
const { data } = await supabase
  .from('historical_candles')
  .select('*')
  .eq('symbol', 'EURUSD')
  .eq('timeframe', '15m')
  .order('time', { ascending: true })
  .limit(500);

// Calculate VWAP, RSI, patterns, etc.
```

### Use with Chart Display

```typescript
// Fetch historical data first
await fetchHistoricalCandles({
  symbol: 'GBPUSD',
  timeframe: '1h',
  daysBack: 30
});

// Query for chart rendering
const { data: candles } = await supabase
  .from('historical_candles')
  .select('time, open, high, low, close, volume')
  .eq('symbol', 'GBPUSD')
  .eq('timeframe', '1h')
  .gte('time', thirtyDaysAgo.toISOString())
  .order('time', { ascending: true });

// Transform to chart format
const chartData = candles.map(c => ({
  time: new Date(c.time).getTime() / 1000,
  open: c.open,
  high: c.high,
  low: c.low,
  close: c.close
}));
```

## Troubleshooting

### Error: "MetaApi not available in demo mode"

**Solution**: Ensure `VITE_METAAPI_TOKEN` and `VITE_METAAPI_ACCOUNT_ID` are set in your `.env` file.

### Error: "Database error: duplicate key value"

**Solution**: This is expected when `overwrite=false` and data already exists. Use `overwrite=true` to update existing data.

### Error: "Timeout" or "Connection failed"

**Solution**: MetaApi may be temporarily unavailable. The service will retry failed chunks automatically.

### Low candle count

**Solution**: Check if the date range falls on weekends or market holidays. Forex markets are closed on weekends.

## Best Practices

1. **Initial Setup**: Fetch 90 days of data for all required symbols and timeframes
2. **Weekly Refresh**: Use `refreshRecentCandles()` to update the most recent 2-3 days
3. **Progress Tracking**: Always provide a progress callback for long-running operations
4. **Error Handling**: Check the `result.success` flag and handle failures gracefully
5. **Rate Limiting**: Add delays between multiple fetch operations to avoid API throttling

## Future Enhancements

- Background job scheduling for automatic weekly refreshes
- Gap detection and automatic backfill
- Data quality monitoring and alerts
- Support for additional timeframes (M1, M30, H4, D1)
- Incremental updates (fetch only new candles since last update)
- Compression for older data

## Related Files

- `src/services/fetchHistoricalCandles.ts` - Main service implementation
- `scripts/test-fetch-candles.ts` - Test script
- `netlify/functions/refresh-candles.ts` - Admin refresh endpoint
- `supabase/migrations/20251012000000_create_historical_candles.sql` - Database schema
