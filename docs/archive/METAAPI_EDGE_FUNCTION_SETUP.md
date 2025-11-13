# MetaAPI Edge Function Configuration Guide

## Current Status

✅ **Edge Function Deployed**: `continuous-price-poller` is active and running
⚠️ **Using Mock Data**: MetaAPI credentials need to be configured as Edge Function secrets
✅ **Polling Active**: Cron job runs every minute and collects tick data
✅ **Aggregation Working**: Candles are being created from ticks every 5 minutes

## Problem

The candles appear as flat lines because the system is using **mock/simulated price data** instead of real MetaAPI prices. Mock data has very limited price variation (0.1% random variation), which creates candles where high ≈ low ≈ open ≈ close.

## Solution

Configure MetaAPI credentials as Supabase Edge Function secrets so the `continuous-price-poller` function can fetch real market data.

### Step 1: Access Supabase Dashboard

1. Go to https://supabase.com/dashboard
2. Select your project: `nzisgxdlydihlwsvonfy`
3. Navigate to **Edge Functions** in the left sidebar

### Step 2: Configure Secrets for continuous-price-poller

1. Click on the **continuous-price-poller** function
2. Click on **Settings** or **Secrets** tab
3. Add the following secrets:

   **METAAPI_TOKEN**
   ```
   eyJhbGciOiJSUzUxMiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI1MDUzN2VhZWFjOGIyYWMxZmY4ZWQ2MTRhMjkzZjZkOCIsImFjY2Vzc1J1bGVzIjpbeyJpZCI6InRyYWRpbmctYWNjb3VudC1tYW5hZ2VtZW50LWFwaSIsIm1ldGhvZHMiOlsidHJhZGluZy1hY2NvdW50LW1hbmFnZW1lbnQtYXBpOnJlc3Q6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcmVzdC1hcGkiLCJtZXRob2RzIjpbIm1ldGFhcGktYXBpOnJlc3Q6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcnBjLWFwaSIsIm1ldGhvZHMiOlsibWV0YWFwaS1hcGk6d3M6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcmVhbC10aW1lLXN0cmVhbWluZy1hcGkiLCJtZXRob2RzIjpbIm1ldGFhcGktYXBpOndzOnB1YmxpYzoqOioiXSwicm9sZXMiOlsicmVhZGVyIiwid3JpdGVyIl0sInJlc291cmNlcyI6WyIqOiRVU0VSX0lEJDoqIl19LHsiaWQiOiJtZXRhc3RhdHMtYXBpIiwibWV0aG9kcyI6WyJtZXRhc3RhdHMtYXBpOnJlc3Q6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6InJpc2stbWFuYWdlbWVudC1hcGkiLCJtZXRob2RzIjpbInJpc2stbWFuYWdlbWVudC1hcGk6cmVzdDpwdWJsaWM6KjoqIl0sInJvbGVzIjpbInJlYWRlciIsIndyaXRlciJdLCJyZXNvdXJjZXMiOlsiKjokVVNFUl9JRCQ6KiJdfV0sImlnbm9yZVJhdGVMaW1pdHMiOmZhbHNlLCJ0b2tlbklkIjoiMjAyMTAyMTMiLCJpbXBlcnNvbmF0ZWQiOmZhbHNlLCJyZWFsVXNlcklkIjoiNTA1MzdlYWVhYzhiMmFjMWZmOGVkNjE0YTI5M2Y2ZDgiLCJpYXQiOjE3NjE2MjU1NDR9.VKdHTz4ONF639nOSv746-TViY4fvnZRgjQdj0twpE_sfRVgIU2f-6TEykdnZlP0VfUpbVINdbEMzNHgG_eTnPgzbpCmXL1EUZb4lBb7wKkr5GgGjTpWBxrsJZzrnc8bDirJd6uhZfD0v9E7KgNlxQpDhBAPI63ZAxtw9oz6uZ6w4eWt_p2A6gXDjGbQIPgrYnLi8u8qOwZuPJ6C_oD9PHx9HT1T3XRfhLlwoBV83BRTL3EUwldGFBaKWV210kywSWsvDkVtGgq-6dUgeLylfJbLgialnSzUNfHAH0AQGr2BlRA6bgWRR6FmJJwYGxWgcwaaq8WNgaSgkov8QvM1-FU-OXRWzqnmWV0XhSHOIgj9GAWs8FfdApPIrkyVUwsbXsFhtxaWXSBldu1iJcSaAC3WL3OSGCkrfOvhNLBh2MLl0Bx-1y4zoK4tVQR13CNTTt5iRc6GARTPaa1xTaanw0T-XKSSx0Gofim8ci4aQyebbMioLA8-vtkxuoY4Yzl3Xy-MWUyAcTi9n7I8Getp96kbZr2yOtyNlNvZOeoqIuDnufgNvgnHIjWkcnqZ-plI8LB2tr3rBh1KdSOfJQm_TYBvpSkrmMAoSCMG4wqfu4Om7OFi9GDMcj2mNawlkHJaR2YK2bsErJhKeD2XMqZs14gBdCxA8H3i0w25K44b-LoM
   ```

   **METAAPI_ACCOUNT_ID**
   ```
   169ff8dd-bb46-4618-91b4-28f696fba223
   ```

   **METAAPI_REGION**
   ```
   london
   ```

4. Click **Save** or **Update**

### Step 3: Verify Configuration

After configuring the secrets:

1. Wait 1-2 minutes for the next cron job to run
2. Check the Edge Function logs:
   - Go to **Edge Functions** → **continuous-price-poller** → **Logs**
   - Look for "✅ MetaAPI" messages indicating successful fetches
   - If you see "❌ MetaAPI credentials not configured", secrets aren't set correctly

3. Verify real data is flowing:
   ```sql
   SELECT symbol, source, bid, ask, created_at
   FROM realtime_prices
   WHERE created_at > NOW() - INTERVAL '5 minutes'
   ORDER BY created_at DESC
   LIMIT 10;
   ```
   - `source` should show `'metaapi_edge_function'` instead of `'mock-fallback'`

### Step 4: Verify Candles Have Wicks

After real data flows for a few minutes:

```bash
node check-recent.js
```

Expected output:
```
Recent candles (last 2 hours):

✅ EURUSD M1 at 10:50:00
✅ GBPUSD M1 at 10:50:00
✅ USDJPY M1 at 10:50:00
...

📊 Complete: 15 | Incomplete: 0
Success rate: 100.0%
```

## How It Works

### Data Flow
1. **Cron Job** (every minute) → Calls `invoke_continuous_price_poller()` function
2. **continuous-price-poller** Edge Function → Fetches prices from MetaAPI → Saves to `realtime_prices` table
3. **aggregate-candles** Edge Function (every 5 min) → Reads ticks from `realtime_prices` → Aggregates into OHLC candles → Saves to `forex_candles` table
4. **Chart** → Polls `forex_candles` table every 2 seconds → Displays candlestick chart

### Why Mock Data Creates Flat Candles

Mock data uses:
- Base price with ±0.1% random variation
- Example: EURUSD base = 1.0850
- Over 1 minute: prices might range from 1.08499 to 1.08501
- This creates candles where: high - low = 0.00002 (basically flat)

Real MetaAPI data:
- Live bid/ask updates every few seconds
- Natural price movement creates proper wicks
- Example: In 1 minute, EURUSD might move 5-10 pips, creating visible candles

## Troubleshooting

### Secrets Not Working

If secrets don't take effect:
1. Try redeploying the function after adding secrets
2. Check the Edge Function logs for error messages
3. Verify the MetaAPI account is active and not suspended

### MetaAPI Connection Issues

If you see "MetaAPI error: 401" or "403":
- Token may be expired or invalid
- Account ID may be incorrect
- Region may be wrong (try 'new-york' instead of 'london')

### Market Closed

If polling shows "Market is closed":
- This is normal outside forex trading hours
- Market opens: Sunday 5:00 PM EST
- Market closes: Friday 5:00 PM EST

## Alternative: Temporary Mock Fix

If you can't configure Edge Function secrets immediately, you can improve the mock data variation:

Edit `supabase/functions/continuous-price-poller/index.ts`:

```typescript
function generateMockPrice(symbol: string): PriceData {
  // Increase variation from 0.001 to 0.01 (10x more movement)
  const variation = (Math.random() - 0.5) * 0.01;
  // Rest of function stays the same...
}
```

This will create more visible wicks, but it's still not real market data.

## Next Steps

Once MetaAPI is configured and working:
1. Monitor the `price_polling_health` table for success rates
2. Check candle quality with `node check-recent.js`
3. View improved charts with proper candlestick wicks
4. The system will automatically maintain continuous data collection
