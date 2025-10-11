# Quick Start: Historical Candles Pipeline

## 1. Run the Database Migration

First, apply the database migration to create the `historical_candles` table:

```bash
# Navigate to Supabase Dashboard > SQL Editor
# Run the migration file:
# supabase/migrations/20251012000000_create_historical_candles.sql
```

Or if using Supabase CLI:

```bash
supabase db push
```

## 2. Fetch Historical Data (Browser Console)

Open your Pipnosis app in the browser, then open the developer console and run:

```javascript
// Import the service
import { fetchHistoricalCandles } from './services/fetchHistoricalCandles';

// Fetch 90 days of EURUSD 5-minute candles
const result = await fetchHistoricalCandles({
  symbol: 'EURUSD',
  timeframe: '5m',
  daysBack: 90,
  onProgress: (progress) => {
    console.log(`${progress.percentComplete}% - ${progress.message}`);
  }
});

console.log('Result:', result);
// Result: { success: true, candlesFetched: 25920, candlesSaved: 25920, ... }
```

## 3. Fetch for Multiple Symbols

```javascript
import { fetchHistoricalCandles } from './services/fetchHistoricalCandles';

const symbols = ['EURUSD', 'GBPUSD', 'XAUUSD'];
const timeframes = ['5m', '15m', '1h'];

for (const symbol of symbols) {
  for (const timeframe of timeframes) {
    console.log(`Fetching ${symbol} ${timeframe}...`);
    
    const result = await fetchHistoricalCandles({
      symbol,
      timeframe,
      daysBack: 90
    });
    
    console.log(`✓ ${symbol} ${timeframe}: ${result.candlesSaved} candles saved`);
    
    // Add delay between requests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}
```

## 4. Check Statistics

```javascript
import { getHistoricalCandleStats } from './services/fetchHistoricalCandles';

const stats = await getHistoricalCandleStats('EURUSD', '5m');
console.log(stats);
// {
//   totalCandles: 25920,
//   oldestCandle: 2024-07-14T00:00:00.000Z,
//   newestCandle: 2024-10-11T23:55:00.000Z,
//   dateRangeDays: 89.9
// }
```

## 5. Refresh Recent Data

```javascript
import { refreshRecentCandles } from './services/fetchHistoricalCandles';

// Refresh the most recent 3 days (overwrites existing data)
const result = await refreshRecentCandles('EURUSD', '5m', 3);
console.log(`Refreshed ${result.candlesSaved} candles`);
```

## 6. Use in Components

```typescript
import { useEffect, useState } from 'react';
import { fetchHistoricalCandles, getHistoricalCandleStats } from '../services/fetchHistoricalCandles';

function MyComponent() {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    loadHistoricalData();
  }, []);

  async function loadHistoricalData() {
    setLoading(true);
    
    try {
      // Ensure data is available
      await fetchHistoricalCandles({
        symbol: 'EURUSD',
        timeframe: '15m',
        daysBack: 90
      });
      
      // Get statistics
      const statistics = await getHistoricalCandleStats('EURUSD', '15m');
      setStats(statistics);
      
    } catch (error) {
      console.error('Failed to load historical data:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div>Loading historical data...</div>;
  
  return (
    <div>
      <h2>Historical Data Stats</h2>
      {stats && (
        <div>
          <p>Total Candles: {stats.totalCandles}</p>
          <p>Coverage: {stats.dateRangeDays.toFixed(1)} days</p>
        </div>
      )}
    </div>
  );
}
```

## 7. Query Candles from Database

```typescript
import { supabase } from '../lib/supabase';

// Get recent 500 candles
const { data: candles } = await supabase
  .from('historical_candles')
  .select('*')
  .eq('symbol', 'EURUSD')
  .eq('timeframe', '5m')
  .order('time', { ascending: false })
  .limit(500);

console.log(`Loaded ${candles.length} candles`);
```

## 8. Use with AI Analysis

```typescript
import { supabase } from '../lib/supabase';
import { fetchHistoricalCandles } from './services/fetchHistoricalCandles';

// Ensure data is available
await fetchHistoricalCandles({
  symbol: 'EURUSD',
  timeframe: '15m',
  daysBack: 90
});

// Query candles for AI analysis
const { data: candles } = await supabase
  .from('historical_candles')
  .select('time, open, high, low, close, volume')
  .eq('symbol', 'EURUSD')
  .eq('timeframe', '15m')
  .order('time', { ascending: true });

// Calculate indicators
const closes = candles.map(c => c.close);
const rsi = calculateRSI(closes, 14);
const vwap = calculateVWAP(candles);

console.log('RSI:', rsi);
console.log('VWAP:', vwap);
```

## Troubleshooting

### "Data already exists" message

If you see this message, it means data is already in the database. Use `overwrite: true` to refresh:

```javascript
await fetchHistoricalCandles({
  symbol: 'EURUSD',
  timeframe: '5m',
  daysBack: 90,
  overwrite: true  // Force refresh
});
```

### MetaApi connection errors

Ensure your `.env` file has valid credentials:

```env
VITE_METAAPI_TOKEN=your-token-here
VITE_METAAPI_ACCOUNT_ID=your-account-id-here
```

### Slow performance

For large datasets (90 days of 5m data), expect 45-60 seconds. This is normal due to:
- ~30 API calls to MetaApi (1000 candle limit per request)
- Database inserts for ~26,000 candles
- Rate limiting delays between requests

## Next Steps

1. Set up weekly refresh cron job using the Netlify Function
2. Integrate historical data with your AI analysis engine
3. Build UI components to display data statistics
4. Implement gap detection and automatic backfill

For full documentation, see `HISTORICAL_CANDLES_GUIDE.md`
