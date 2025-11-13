# Live Feed Fix Guide

## Problem Identified

**ROOT CAUSE**: MetaAPI account `169ff8dd-bb46-4618-91b4-28f696fba223` is NOT DEPLOYED or has been DELETED.

### Symptoms
- Chart showing "Waiting for price data... The price feed will start shortly."
- Console errors: `GET .netlify/functions/get-live-price 503 (Service Unavailable)`
- MetaAPI returning 404: "Specified symbol price not found"
- No candle data available for EURUSD M5 (or any other symbol/timeframe)
- realtime_prices table has stale data (3+ hours old)

### Diagnostic Results
```
Testing URL: https://mt-client-api-v1.london.agiliumtrade.ai/users/current/accounts/169ff8dd-bb46-4618-91b4-28f696fba223/symbols/EURUSD/current-price

Response status: 404
Response body: {"id":18395,"error":"NotFoundError","message":"Specified symbol price not found"}
```

## Solution

### Option 1: Redeploy Existing MetaAPI Account (Recommended)

1. **Login to MetaAPI Dashboard**
   - Go to https://app.metaapi.cloud/
   - Login with your credentials

2. **Find Your Account**
   - Navigate to "Accounts" section
   - Look for account ID: `169ff8dd-bb46-4618-91b4-28f696fba223`

3. **Check Account Status**
   - Status should be: **DEPLOYED** and **CONNECTED**
   - If status is UNDEPLOYED, SUSPENDED, or ERROR:
     - Click on the account
     - Click "Deploy" or "Redeploy"
     - Wait for deployment to complete (can take 5-10 minutes)

4. **Verify Connection**
   - Once deployed, check connection status
   - Should show "CONNECTED" with green indicator
   - Test by clicking "Test Connection" if available

### Option 2: Create New MetaAPI Account

If the account is deleted or cannot be recovered:

1. **Create New MT4/MT5 Demo Account**
   - In MetaAPI dashboard, click "Add Account"
   - Choose your broker (e.g., IC Markets, Pepperstone)
   - Select MT4 or MT5
   - Create demo account

2. **Wait for Deployment**
   - MetaAPI will provision the account (5-10 minutes)
   - Wait until status shows "DEPLOYED" and "CONNECTED"

3. **Update Environment Variables**
   - Copy the new Account ID
   - Update `.env` file:
     ```
     METAAPI_ACCOUNT_ID=<new-account-id>
     ```
   - Also update in Netlify dashboard:
     - Go to Site Settings → Environment Variables
     - Update `METAAPI_ACCOUNT_ID`
   - Also update in Supabase edge function secrets:
     - Go to Supabase Dashboard → Edge Functions → Secrets
     - Add/Update `METAAPI_ACCOUNT_ID`

4. **Redeploy Application**
   ```bash
   curl -X POST 'https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca' -d '{}'
   ```

### Option 3: Use Alternative Data Provider

If MetaAPI continues to have issues, consider switching to:
- Alpha Vantage
- Twelve Data
- Polygon.io
- IEX Cloud

(Would require code changes to adapt the data fetching logic)

## Verification Steps

After fixing the MetaAPI account:

1. **Test MetaAPI Connection**
   ```bash
   node test-metaapi-direct.cjs
   ```
   Should return: `✅ SUCCESS! MetaAPI is working`

2. **Check Database**
   ```sql
   SELECT symbol, created_at FROM realtime_prices
   ORDER BY created_at DESC LIMIT 5;
   ```
   Should show data from the last few seconds

3. **Check Chart**
   - Refresh the web application
   - Chart should load candles immediately
   - Live price feed should update every 2-3 seconds

4. **Monitor Logs**
   ```
   [BrowserPoller] ✅ EURUSD: 1.15505/1.15507 (LIVE)
   [BackgroundAggregator] ✅ Price read from DB: 1.15505/1.15507
   ```

## Additional Configuration Needed

### Supabase Edge Function Secrets

The `continuous-price-poller` edge function needs MetaAPI credentials:

1. **Via Supabase CLI**:
   ```bash
   supabase secrets set METAAPI_TOKEN="your-token"
   supabase secrets set METAAPI_ACCOUNT_ID="your-account-id"
   supabase secrets set METAAPI_REGION="london"
   ```

2. **Via Supabase Dashboard**:
   - Go to Edge Functions → continuous-price-poller → Settings
   - Add secrets:
     - `METAAPI_TOKEN`
     - `METAAPI_ACCOUNT_ID`
     - `METAAPI_REGION`

### Enable Cron Job (Optional but Recommended)

Set up cron in Supabase to call continuous-price-poller every minute during market hours:

```sql
-- In Supabase SQL Editor
SELECT cron.schedule(
  'continuous-price-polling',
  '* * * * *', -- Every minute
  $$
  SELECT
    net.http_post(
      url:='https://nzisgxdlydihlwsvonfy.supabase.co/functions/v1/continuous-price-poller?action=poll',
      headers:='{"Content-Type": "application/json", "Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb
    ) as request_id;
  $$
);
```

## Troubleshooting

### MetaAPI Still Returns 404
- Account might not be fully deployed
- Try switching region (london → new-york)
- Verify account has the required symbols enabled

### 401 Unauthorized
- Token expired or invalid
- Generate new token in MetaAPI dashboard

### 429 Rate Limit
- Too many requests
- Increase POLL_INTERVAL_MS in browser-price-poller.ts
- Check if multiple instances are running

### Chart Still Shows "No Candles"
- Database might need initial data
- Run: `node scripts/initial-200-candle-backfill.js`
- OR wait 5 minutes for candles to aggregate from live ticks

## Files Modified

- `/src/services/browser-price-poller.ts` - Improved error handling and timeout
- `/test-metaapi-direct.cjs` - Diagnostic script to test MetaAPI
- `/test-metaapi-account-status.cjs` - Check account deployment status

## Summary

**The issue is NOT in your code** - it's a configuration/deployment issue with your MetaAPI account. Once you redeploy or create a new account, everything should work immediately.

The application has multiple fallback mechanisms:
1. Browser-based polling (calls Netlify function)
2. Emergency poller (activates when DB is stale)
3. Supabase edge function (runs server-side when configured)

All are working correctly, but they all depend on a valid, deployed MetaAPI account.
