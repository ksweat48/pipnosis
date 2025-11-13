# Live Price Ticks Fix - Complete Solution

## Problem Identified

✅ **Root Cause Found:** The continuous-price-poller Edge Function is failing because the MetaAPI account doesn't have access to the forex symbols being queried (EURUSD, GBPUSD, etc.).

### Diagnostic Results:

1. **Database Status**: ✅ Working correctly
   - realtime_prices table exists and has RLS configured
   - Last successful price data: 3.5 hours ago
   - Supabase Realtime subscription setup is correct

2. **Cron Job Status**: ✅ Running every minute
   - Job ID: 9
   - Function: `invoke_continuous_price_poller()`
   - Status: Active

3. **Edge Function Status**: ⚠️ Running but failing
   - All 5 pairs showing 0 successful updates
   - All 5 pairs showing failures
   - Each poll takes exactly 5 seconds (timeout)

4. **MetaAPI Status**: ❌ **THIS IS THE PROBLEM**
   - API responds but returns: `{"error":"NotFoundError","message":"Specified symbol price not found"}`
   - Account ID: 169ff8dd-bb46-4618-91b4-28f696fba223
   - Region: london
   - Symbols requested: XAUUSD, US30, EURUSD, GBPUSD, USDJPY

## Immediate Solution

You need to configure your MetaAPI account to have access to these forex symbols. There are two options:

### Option 1: Fix MetaAPI Account (Recommended)

1. **Login to MetaAPI Dashboard**:
   - Go to https://app.metaapi.cloud/
   - Navigate to your account: 169ff8dd-bb46-4618-91b4-28f696fba223

2. **Check Trading Account Status**:
   - Ensure the account is connected and deployed
   - Verify the broker connection is active
   - Check that the account has access to the required symbols

3. **Add Required Symbols** (if missing):
   - EURUSD
   - GBPUSD
   - USDJPY
   - XAUUSD (Gold)
   - US30 (Dow Jones)

4. **Test Connection**:
   ```bash
   curl "https://mt-client-api-v1.london.agiliumtrade.ai/users/current/accounts/169ff8dd-bb46-4618-91b4-28f696fba223/symbols/EURUSD/current-price" \
     -H "auth-token: YOUR_TOKEN"
   ```

### Option 2: Use Alternative Price Feed (Quick Fix)

Switch to a different price data provider that doesn't require MetaAPI:

**A. Free Options:**
- Twelve Data API (https://twelvedata.com/) - Free tier: 800 requests/day
- Alpha Vantage (https://www.alphavantage.co/) - Free tier: 500 requests/day
- Polygon.io (https://polygon.io/) - Free tier: limited

**B. Modify Edge Function:**

Update `/supabase/functions/continuous-price-poller/index.ts` to use alternative API.

Example for Twelve Data:

```typescript
async function fetchPriceFromTwelveData(symbol: string): Promise<PriceData | null> {
  const apiKey = Deno.env.get('TWELVE_DATA_API_KEY');

  if (!apiKey) {
    console.error('Twelve Data API key not configured');
    return null;
  }

  try {
    // Map forex symbols to Twelve Data format
    const symbolMap: Record<string, string> = {
      'EURUSD': 'EUR/USD',
      'GBPUSD': 'GBP/USD',
      'USDJPY': 'USD/JPY',
      'XAUUSD': 'XAU/USD',
      'US30': 'US30' // Check if supported
    };

    const twelveDataSymbol = symbolMap[symbol] || symbol;
    const url = `https://api.twelvedata.com/quote?symbol=${twelveDataSymbol}&apikey=${apiKey}`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      console.error(`Twelve Data error for ${symbol}: ${response.status}`);
      return null;
    }

    const data = await response.json();

    // Twelve Data returns { close, timestamp, ... }
    // We'll simulate bid/ask with a small spread
    const close = parseFloat(data.close);
    const spread = close * 0.0001; // 1 pip spread
    const bid = close - (spread / 2);
    const ask = close + (spread / 2);

    return {
      symbol,
      bid,
      ask,
      mid: close,
      spread,
      timestamp: data.timestamp || new Date().toISOString()
    };
  } catch (error) {
    console.error(`Failed to fetch price for ${symbol}:`, error);
    return null;
  }
}
```

## Verification Steps

After fixing MetaAPI or switching providers:

1. **Test Edge Function Manually**:
   ```bash
   curl "https://nzisgxdlydihlwsvonfy.supabase.co/functions/v1/continuous-price-poller?action=poll" \
     -H "Authorization: Bearer [SERVICE_ROLE_KEY]"
   ```

2. **Check Database for New Prices**:
   ```sql
   SELECT symbol, bid, ask, created_at,
          EXTRACT(EPOCH FROM (NOW() - created_at)) as seconds_old
   FROM realtime_prices
   ORDER BY created_at DESC
   LIMIT 10;
   ```

3. **Verify Cron Job Results**:
   ```sql
   SELECT poll_timestamp, successful_pairs, failed_pairs,
          error_message
   FROM price_polling_health
   ORDER BY poll_timestamp DESC
   LIMIT 5;
   ```

4. **Check Browser Console**:
   - Open your app in browser
   - Open DevTools Console
   - Look for: `[BackgroundAggregator] ✅ Successfully subscribed to realtime_prices`
   - Look for tick updates: Live price should start updating every second

## Why The System Stopped Working

The system was working 3.5 hours ago (last successful price: 04:53 UTC). Possible reasons:

1. **MetaAPI Account Issues**:
   - Account expired or suspended
   - Broker connection dropped
   - Symbol subscriptions changed
   - Rate limits exceeded

2. **MetaAPI Service Issues**:
   - API temporarily down
   - Region (london) having issues
   - Endpoint changes

3. **Trading Account Issues**:
   - Account needs redeployment
   - Trading account closed by broker
   - Insufficient funds/margin

## System Architecture

Your live price system works in layers:

```
MetaAPI (or other provider)
    ↓
Supabase Edge Function (continuous-price-poller)
    ↓ (cron: every minute)
Database (realtime_prices table)
    ↓ (Supabase Realtime: INSERT events)
Browser (BackgroundCandleAggregator)
    ↓ (notifyTickListeners)
Chart Component (MarketChart)
    ↓ (updateCurrentCandleFromTick)
Live Chart Display (TradingView Lightweight Charts)
```

**Current Break Point**: Between MetaAPI and Edge Function

## Next Steps

1. **Check MetaAPI Account** (5 minutes)
   - Login and verify account status
   - Check symbol availability
   - Test with provided curl command

2. **If MetaAPI Can't Be Fixed** (30 minutes)
   - Sign up for Twelve Data or Alpha Vantage
   - Update edge function with new provider
   - Set environment variables in Supabase
   - Deploy updated function

3. **Monitor Results** (ongoing)
   - Watch price_polling_health table
   - Verify realtime_prices gets new data
   - Confirm chart starts updating

## Emergency Workaround (Manual Price Feed)

If you need the app working immediately while fixing the data source:

Run this in your local terminal to manually insert test prices every 2 seconds:

```bash
# Save as manual-price-feed.sh
while true; do
  curl -X POST 'https://nzisgxdlydihlwsvonfy.supabase.co/rest/v1/realtime_prices' \
    -H "apikey: [SUPABASE_ANON_KEY]" \
    -H "Authorization: Bearer [SUPABASE_SERVICE_ROLE_KEY]" \
    -H "Content-Type: application/json" \
    -d "{
      \"symbol\": \"EURUSD\",
      \"bid\": $(echo "scale=5; 1.15500 + ($RANDOM % 100) / 100000" | bc),
      \"ask\": $(echo "scale=5; 1.15502 + ($RANDOM % 100) / 100000" | bc),
      \"mid\": 1.15501,
      \"spread\": 0.00002,
      \"broker_time\": \"$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)\",
      \"source\": \"manual_test\"
    }"
  sleep 2
done
```

This will give you live price updates while you fix the real data source.

## Contact MetaAPI Support

If MetaAPI account issues persist:
- Support: support@metaapi.cloud
- Docs: https://metaapi.cloud/docs/client/
- Check status: https://status.metaapi.cloud/

## Summary

✅ Your code is working correctly
✅ Database and Supabase Realtime are configured properly
✅ Edge function and cron job are running
❌ **MetaAPI is not returning price data** ← Fix this!

Once MetaAPI starts returning prices OR you switch to an alternative provider, your live ticks will immediately start working again.
