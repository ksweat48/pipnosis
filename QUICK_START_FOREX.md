# Quick Start - Forex Trading with MetaAPI

## 🎯 Your Clean Slate Setup is Complete!

Everything is ready to go. Here's how to start using it.

## ⚡ Quick Test (30 seconds)

### 1. Add Component to Your App

Edit `src/App.tsx` or any component:

```typescript
import { SimpleForexChart } from './components/SimpleForexChart';

function App() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold text-white mb-4">Forex Trading</h1>
      <SimpleForexChart symbol="EURUSD" timeframe="M15" />
    </div>
  );
}
```

### 2. Set Netlify Environment Variables

Go to: https://app.netlify.com → Your Site → Site Settings → Environment Variables

Add these:
```
METAAPI_TOKEN = (from your .env file)
METAAPI_ACCOUNT_ID = 169ff8dd-bb46-4618-91b4-28f696fba223
METAAPI_REGION = london
VITE_SUPABASE_URL = https://nzisgxdlydihlwsvonfy.supabase.co
SUPABASE_SERVICE_ROLE_KEY = (from your .env file)
```

### 3. Deploy

```bash
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

### 4. Done!

Visit your site and you'll see live forex prices updating every 2 seconds.

## 📚 Use the API Directly

```typescript
import { forexApi } from './services/forex-api';

// Get current price
const price = await forexApi.getCurrentPrice('EURUSD');
console.log(price);
// Output: { symbol: 'EURUSD', bid: 1.08945, ask: 1.08955, ... }

// Get 100 candles
const candles = await forexApi.getCandles('EURUSD', 'M15', 100);
console.log(candles.length); // 100

// Start live polling (updates every 2 seconds)
const stop = forexApi.startPricePolling('EURUSD', (price) => {
  console.log('Live update:', price.bid);
}, 2000);

// Stop when done
stop();
```

## 🔧 Available Methods

### `forexApi.getCurrentPrice(symbol)`
Returns current bid/ask for a symbol.

**Example:**
```typescript
const price = await forexApi.getCurrentPrice('GBPUSD');
// { symbol: 'GBPUSD', bid: 1.2945, ask: 1.2950, timestamp: '...' }
```

### `forexApi.getCandles(symbol, timeframe, limit)`
Returns historical candles.

**Example:**
```typescript
const candles = await forexApi.getCandles('USDJPY', 'H1', 50);
// Array of 50 hourly candles with OHLC data
```

### `forexApi.startPricePolling(symbol, callback, intervalMs)`
Starts live price updates.

**Example:**
```typescript
const stopPolling = forexApi.startPricePolling('EURUSD', (price) => {
  console.log(`EUR/USD: ${price.bid}`);
}, 2000);

// Call stopPolling() when you're done
```

## 💱 Available Pairs

Try these common forex pairs:
- `EURUSD` - Euro / US Dollar
- `GBPUSD` - British Pound / US Dollar
- `USDJPY` - US Dollar / Japanese Yen
- `AUDUSD` - Australian Dollar / US Dollar
- `USDCAD` - US Dollar / Canadian Dollar
- `NZDUSD` - New Zealand Dollar / US Dollar
- `EURGBP` - Euro / British Pound
- `EURJPY` - Euro / Japanese Yen

## ⏱️ Available Timeframes

- `M1` - 1 minute
- `M5` - 5 minutes
- `M15` - 15 minutes
- `M30` - 30 minutes
- `H1` - 1 hour
- `H4` - 4 hours
- `D1` - Daily

## 🛠️ Test Functions Directly

### Test Price Function
```bash
# After deploying to Netlify
curl "https://your-site.netlify.app/.netlify/functions/forex-price?symbol=EURUSD"
```

### Test Candles Function
```bash
curl "https://your-site.netlify.app/.netlify/functions/forex-candles?symbol=EURUSD&timeframe=M15&limit=10"
```

## ❌ Troubleshooting

### "MetaAPI credentials not configured"
→ Set `METAAPI_TOKEN` and `METAAPI_ACCOUNT_ID` in Netlify environment variables

### "MetaAPI error: 401"
→ Your token is invalid. Check it in MetaAPI dashboard: https://app.metaapi.cloud

### "MetaAPI error: 404"
→ Your account ID is wrong or account not deployed

### Build fails
→ Run `npm run build` locally to see the error
→ Make sure all imports are correct

### No live updates
→ Check browser console for errors
→ Verify Netlify functions are deployed
→ Check function logs in Netlify dashboard

## 📖 Full Documentation

See `METAAPI_CLEAN_SLATE_SETUP.md` for complete details.

## 🎉 You're Ready!

Start building your forex trading features on top of this simple foundation.

Remember: **Keep it simple!** Don't rebuild the complexity.

---

Need help? Check the docs or the demo component for examples.
