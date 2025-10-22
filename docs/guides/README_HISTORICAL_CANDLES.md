# Historical Candles Data Pipeline

Complete implementation for fetching and storing 3 months of historical forex candle data from MetaApi into Supabase.

## Quick Links

- [Quick Start Guide](./QUICK_START_HISTORICAL_CANDLES.md) - Get started in 5 minutes
- [Complete Documentation](./HISTORICAL_CANDLES_GUIDE.md) - Full API reference and examples
- [Implementation Summary](./IMPLEMENTATION_SUMMARY.md) - Technical details and architecture

## What This Does

Fetches historical OHLC (Open, High, Low, Close) candlestick data for forex pairs from MetaApi and stores it in Supabase for use by the Pipnosis AI Trading Simulator.

### Supported Symbols
- EURUSD, GBPUSD, XAUUSD (Gold), and all other MetaApi forex pairs

### Supported Timeframes
- `5m` - 5 minute candles
- `15m` - 15 minute candles
- `1h` - 1 hour candles

### Data Range
- Up to 90 days (3 months) of historical data per fetch
- Automatic pagination to handle MetaApi's 1000 candle limit
- Smart chunking based on timeframe

## Installation

### 1. Apply Database Migration

Run this SQL in your Supabase SQL Editor:

```bash
# File: supabase/migrations/20251012000000_create_historical_candles.sql
```

Or using Supabase CLI:
```bash
supabase db push
```

### 2. Verify Environment Variables

Ensure your `.env` file has:
```env
VITE_METAAPI_TOKEN=your-token
VITE_METAAPI_ACCOUNT_ID=your-account-id
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-anon-key
ADMIN_REFRESH_KEY=your-admin-key
```

## Basic Usage

### Fetch Historical Data

```typescript
import { fetchHistoricalCandles } from './services/fetchHistoricalCandles';

// Fetch 90 days of EURUSD 5-minute candles
const result = await fetchHistoricalCandles({
  symbol: 'EURUSD',
  timeframe: '5m',
  daysBack: 90
});

console.log(`Fetched: ${result.candlesFetched} candles`);
console.log(`Saved: ${result.candlesSaved} candles`);
```

### With Progress Tracking

```typescript
await fetchHistoricalCandles({
  symbol: 'GBPUSD',
  timeframe: '15m',
  daysBack: 30,
  onProgress: (progress) => {
    console.log(`${progress.percentComplete}% - ${progress.message}`);
  }
});
```

### Get Statistics

```typescript
import { getHistoricalCandleStats } from './services/fetchHistoricalCandles';

const stats = await getHistoricalCandleStats('EURUSD', '5m');
console.log(`Total: ${stats.totalCandles} candles`);
console.log(`Range: ${stats.dateRangeDays} days`);
```

### Query from Database

```typescript
import { supabase } from './lib/supabase';

const { data } = await supabase
  .from('historical_candles')
  .select('*')
  .eq('symbol', 'EURUSD')
  .eq('timeframe', '5m')
  .order('time', { ascending: true })
  .limit(500);
```

## Test Script

Run from command line:

```bash
# Install tsx globally if not already installed
npm install -g tsx

# Run test script
tsx scripts/test-fetch-candles.ts EURUSD 5m 90
tsx scripts/test-fetch-candles.ts GBPUSD 15m 30
tsx scripts/test-fetch-candles.ts XAUUSD 1h 60
```

## Admin Refresh Endpoint

Trigger data refresh via HTTP:

```bash
curl -X POST "https://your-app.netlify.app/.netlify/functions/refresh-candles?symbol=EURUSD&timeframe=5m&daysBack=3&adminKey=your-admin-key"
```

## Key Features

### Intelligent Chunking
- Automatically splits large date ranges into optimal chunks
- Stays under MetaApi's 1000 candle limit
- Minimizes API calls

### Duplicate Prevention
- Unique constraint on (symbol, timeframe, time)
- Upsert logic prevents duplicate inserts
- Optional overwrite mode for refreshing data

### Error Handling
- Individual chunk failures don't stop the entire operation
- Automatic retry logic for failed chunks
- Detailed error messages with context

### Progress Tracking
- Real-time progress callbacks
- Shows current chunk, total chunks, percent complete
- Displays candles fetched and saved

## Performance

### API Calls (90 days)
- 5m: ~30 calls
- 15m: ~13 calls
- 1h: ~13 calls

### Duration (90 days)
- 5m: 45-60 seconds
- 15m: 20-30 seconds
- 1h: 15-20 seconds

### Storage (90 days)
- 5m: ~26,000 candles (~2.5 MB)
- 15m: ~8,600 candles (~800 KB)
- 1h: ~2,160 candles (~200 KB)

## Files Structure

```
src/services/fetchHistoricalCandles.ts    # Core service
scripts/test-fetch-candles.ts             # Test CLI
netlify/functions/refresh-candles.ts      # Admin endpoint
supabase/migrations/20251012000000_...    # Database schema
HISTORICAL_CANDLES_GUIDE.md               # Full documentation
QUICK_START_HISTORICAL_CANDLES.md         # Quick start
IMPLEMENTATION_SUMMARY.md                 # Technical summary
```

## Integration Examples

### Use with AI Analysis

```typescript
// Ensure data exists
await fetchHistoricalCandles({
  symbol: 'EURUSD',
  timeframe: '15m',
  daysBack: 90
});

// Query for analysis
const { data: candles } = await supabase
  .from('historical_candles')
  .select('time, close')
  .eq('symbol', 'EURUSD')
  .eq('timeframe', '15m')
  .order('time', { ascending: true });

// Calculate RSI
const closes = candles.map(c => c.close);
const rsi = calculateRSI(closes, 14);
```

### Use with Chart Components

```typescript
// Fetch historical data
await fetchHistoricalCandles({
  symbol: 'GBPUSD',
  timeframe: '1h',
  daysBack: 30
});

// Query for chart
const { data: candles } = await supabase
  .from('historical_candles')
  .select('time, open, high, low, close')
  .eq('symbol', 'GBPUSD')
  .eq('timeframe', '1h')
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

### "MetaApi not available in demo mode"
Ensure `VITE_METAAPI_TOKEN` and `VITE_METAAPI_ACCOUNT_ID` are set in `.env`

### "Data already exists"
Use `overwrite: true` to force refresh:
```typescript
await fetchHistoricalCandles({
  symbol: 'EURUSD',
  timeframe: '5m',
  daysBack: 90,
  overwrite: true
});
```

### Slow performance
This is normal. Large datasets require multiple API calls and database inserts.

### Database error
Ensure migration has been applied to create `historical_candles` table.

## Next Steps

1. Apply database migration
2. Fetch initial data for your symbols
3. Set up weekly refresh schedule
4. Integrate with AI analysis engine
5. Build admin UI for data management

## Support

- See [QUICK_START_HISTORICAL_CANDLES.md](./QUICK_START_HISTORICAL_CANDLES.md) for step-by-step guide
- See [HISTORICAL_CANDLES_GUIDE.md](./HISTORICAL_CANDLES_GUIDE.md) for complete API reference
- See [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) for technical details

## License

Part of the Pipnosis AI Trading Simulator project.
