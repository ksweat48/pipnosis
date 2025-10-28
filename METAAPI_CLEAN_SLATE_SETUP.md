# MetaAPI Clean Slate Setup

## Simple, Working MetaAPI Integration for Forex Trading

This is a clean, minimal implementation that actually works. No complexity, no over-engineering.

## What Was Done

### 1. Removed Old Complex Code
- Deleted all old MetaAPI Netlify functions with token caching, health monitoring, etc.
- Dropped complex database tables (metaapi_token_cache, metaapi_connection_health, metatap_token_cache)
- Removed metaapi-stub.ts and related service files

### 2. Created Simple New Implementation

**Database (2 simple tables):**
- `forex_live_prices` - Current bid/ask prices
- `forex_candles` - OHLC candle data

**Backend (2 simple Netlify functions):**
- `forex-price.js` - Get current price for a symbol
- `forex-candles.js` - Get historical candles

**Frontend (1 simple service):**
- `forex-api.ts` - Clean TypeScript service to call the backend

**Demo Component:**
- `SimpleForexChart.tsx` - Example of how to use the API

## Setup Instructions

### 1. Environment Variables

Make sure these are set in your `.env` file:

```env
METAAPI_TOKEN=your_metaapi_token_here
METAAPI_ACCOUNT_ID=your_account_id_here
METAAPI_REGION=london
VITE_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 2. Netlify Environment Variables

Set the same variables in your Netlify dashboard:
- Site Settings → Environment Variables
- Add all the variables above

### 3. Database Migrations

The clean schema migrations have been applied:
- `clean_slate_metaapi_drop_old_tables.sql` - Removed old tables
- `clean_slate_metaapi_minimal_schema.sql` - Created new simple schema

## How to Use

### Basic Usage in Your Code

```typescript
import { forexApi } from '../services/forex-api';

// Get current price
const price = await forexApi.getCurrentPrice('EURUSD');
console.log(`Bid: ${price.bid}, Ask: ${price.ask}`);

// Get candles
const candles = await forexApi.getCandles('EURUSD', 'M15', 100);
console.log(`Got ${candles.length} candles`);

// Start live price polling
const stopPolling = forexApi.startPricePolling('EURUSD', (price) => {
  console.log('New price:', price);
}, 2000);

// Stop polling when done
stopPolling();
```

### Use the Demo Component

```typescript
import { SimpleForexChart } from './components/SimpleForexChart';

function App() {
  return (
    <div>
      <SimpleForexChart symbol="EURUSD" timeframe="M15" />
    </div>
  );
}
```

## Testing

### 1. Test Locally

```bash
npm install
npm run build
npm run preview
```

### 2. Test Functions Directly

```bash
# Test price endpoint
curl "http://localhost:8888/.netlify/functions/forex-price?symbol=EURUSD"

# Test candles endpoint
curl "http://localhost:8888/.netlify/functions/forex-candles?symbol=EURUSD&timeframe=M15&limit=10"
```

### 3. Deploy to Netlify

```bash
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

## Available Forex Pairs

Common pairs available through MetaAPI MT5:
- EURUSD
- GBPUSD
- USDJPY
- AUDUSD
- USDCAD
- NZDUSD
- EURGBP
- EURJPY
- And many more...

## Available Timeframes

- `M1` - 1 minute
- `M5` - 5 minutes
- `M15` - 15 minutes
- `M30` - 30 minutes
- `H1` - 1 hour
- `H4` - 4 hours
- `D1` - Daily

## API Response Format

### Price Response

```json
{
  "success": true,
  "data": {
    "symbol": "EURUSD",
    "bid": 1.08945,
    "ask": 1.08955,
    "timestamp": "2025-10-28T12:34:56.789Z"
  }
}
```

### Candles Response

```json
{
  "success": true,
  "data": {
    "symbol": "EURUSD",
    "timeframe": "M15",
    "count": 50,
    "candles": [
      {
        "symbol": "EURUSD",
        "timeframe": "M15",
        "open_time": "2025-10-28T12:00:00.000Z",
        "close_time": "2025-10-28T12:15:00.000Z",
        "open": 1.08950,
        "high": 1.08980,
        "low": 1.08920,
        "close": 1.08945,
        "volume": 1234
      }
    ]
  }
}
```

## Troubleshooting

### "MetaAPI credentials not configured"
- Check that METAAPI_TOKEN and METAAPI_ACCOUNT_ID are set in .env
- Verify they're also set in Netlify environment variables
- Redeploy after adding variables

### "MetaAPI error: 401"
- Your METAAPI_TOKEN is invalid or expired
- Get a new token from https://app.metaapi.cloud

### "MetaAPI error: 404"
- Your METAAPI_ACCOUNT_ID is incorrect
- Or the account is not deployed
- Check your MetaAPI dashboard

### No data in database
- The functions save data to Supabase automatically
- Check VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set
- Verify RLS policies allow service_role to insert

## What's Different from Before

**Before (Complex):**
- 10+ MetaAPI-related functions
- Token caching with expiry management
- Multi-region fallback system
- Connection health monitoring
- Websocket streaming with fallbacks
- Bootstrap token generation scripts
- 5+ database tables for caching and monitoring

**Now (Simple):**
- 2 Netlify functions (price, candles)
- 2 database tables (prices, candles)
- 1 frontend service file
- Direct REST API calls
- Simple polling for live updates
- No caching complexity

## Next Steps

1. Use `SimpleForexChart` component as a reference
2. Build your trading UI on top of the simple `forex-api.ts` service
3. Add more functions as needed (place trade, close trade, etc.)
4. Keep it simple - don't rebuild the complexity!

## Support

If something doesn't work:
1. Check the browser console for errors
2. Check Netlify function logs
3. Verify all environment variables are set
4. Make sure your MetaAPI account is deployed and active

---

**Status:** Clean slate implementation complete ✅

**Next:** Start building your trading features using the simple API!
