# Live Ticks Deployment Guide

This guide explains how to fix and verify live market ticks in production.

## Problem Summary

The application was showing the error `Unexpected token '<', "<!doctype "... is not valid JSON` when trying to fetch live prices. This happens when Netlify Functions return HTML 404 pages instead of executing properly.

## Solution Implemented

### 1. Environment Detection

Created `/src/lib/environment.ts` to detect if the app is running in:
- **Production**: pipnosis.com or *.netlify.app domains
- **Development**: localhost or local IPs
- **WebContainer**: Bolt.new development environment

### 2. Enhanced Error Logging

Updated `global-polling-coordinator.ts` to:
- Detect when HTML is returned instead of JSON
- Provide clear error messages about function deployment
- Skip polling in non-production environments
- Log helpful debugging information

### 3. Netlify Configuration

Updated `netlify.toml` to:
- Explicitly define the functions directory
- Add timeout configurations for `get-live-price` and `verify-metaapi-connection`
- Add redirect rule to prevent API routes from redirecting to index.html

## Deployment Steps

### Step 1: Verify Environment Variables in Netlify

1. Go to Netlify Dashboard → Your Site → Site Settings → Environment Variables
2. Ensure these variables are set:
   ```
   METAAPI_TOKEN=<your_token>
   METAAPI_ACCOUNT_ID=169ff8dd-bb46-4618-91b4-28f696fba223
   METAAPI_REGION=london
   SUPABASE_SERVICE_ROLE_KEY=<your_service_role_key>
   VITE_SUPABASE_URL=https://nzisgxdlydihlwsvonfy.supabase.co
   VITE_SUPABASE_ANON_KEY=<your_anon_key>
   OPENAI_API_KEY=<your_openai_key>
   ```

### Step 2: Deploy to Production

Option A - Using Build Hook:
```bash
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

Option B - Manual Deploy:
1. Push changes to your Git repository
2. Netlify will auto-deploy
3. Or use "Trigger deploy" button in Netlify dashboard

### Step 3: Verify Functions Are Deployed

After deployment completes:

1. Check the build log in Netlify for function bundling:
   ```
   ◈ Functions bundling
   ◈ get-live-price bundled successfully
   ◈ verify-metaapi-connection bundled successfully
   ```

2. Test function endpoints directly:
   ```bash
   # Test verify connection
   curl https://pipnosis.com/.netlify/functions/verify-metaapi-connection

   # Test live price
   curl https://pipnosis.com/.netlify/functions/get-live-price?symbol=EURUSD
   ```

3. Both should return JSON, not HTML

### Step 4: Verify Live Ticks in Browser

1. Open https://pipnosis.com/trade
2. Open Browser DevTools Console (F12)
3. Look for these success messages:
   ```
   🌍 Environment Detection:
     - Environment: production
     - Functions Available: true

   ✅ MetaAPI connection verified successfully
   ✅ Started polling for EURUSD (every 5000ms)
   ✅ [EURUSD] Price updated: 1.05432/1.05434
   ```

4. Check the chart header for:
   - "Live Price Updates Active" indicator (green pulsing dot)
   - Update counter incrementing
   - Price flashing when new ticks arrive

5. Verify in Network tab:
   - Filter for "get-live-price"
   - Should see requests every 5 seconds
   - Status should be 200
   - Response should be JSON with bid/ask prices

### Step 5: Verify Database Updates

1. Open Supabase Dashboard
2. Go to Table Editor → realtime_prices table
3. Verify:
   - New rows are being inserted every 5 seconds
   - created_at timestamps are recent
   - bid and ask values are valid numbers
   - All 12 currency pairs are being updated

## Troubleshooting

### Functions Still Return HTML 404

**Cause**: Functions not being built or deployed

**Solution**:
1. Check Netlify build logs for errors
2. Verify `netlify/functions/` directory exists
3. Ensure TypeScript files are compiling
4. Check functions are listed in Functions tab of Netlify dashboard

### MetaAPI Connection Fails

**Cause**: Invalid credentials or expired token

**Solution**:
1. Verify METAAPI_TOKEN in Netlify environment variables
2. Check token hasn't expired (they expire after a year)
3. Verify METAAPI_ACCOUNT_ID is correct
4. Check account is active in MetaAPI dashboard
5. Ensure account has market data subscription

### Prices Not Updating in Chart

**Cause**: Supabase Realtime not subscribed or RLS blocking

**Solution**:
1. Check browser console for subscription status
2. Verify realtime_prices table RLS policies allow SELECT
3. Check Supabase Realtime is enabled for the table
4. Verify no ad-blockers are blocking WebSocket connections

### High Error Rate

**Cause**: Rate limiting or network issues

**Solution**:
1. Check error messages in console
2. Verify not hitting MetaAPI rate limits
3. Check Netlify function execution limits
4. Review error count vs success count ratio

## Expected Behavior

When working correctly:

1. **On Page Load**:
   - Environment detected as "production"
   - Functions available: true
   - MetaAPI connection verified
   - 12 currency pairs start polling

2. **During Operation**:
   - Price requests every 5 seconds per pair
   - 99%+ success rate for price fetches
   - New rows in realtime_prices table every 5 seconds
   - Chart updates within 300ms of new data
   - "Live" indicator stays green

3. **In Console**:
   ```
   ✅ Global polling coordinator initialized for 12 pairs
   ✅ [EURUSD] Price updated: 1.05432/1.05434
   ✅ [GBPUSD] Price updated: 1.26789/1.26791
   📊 [EURUSD] Response: {ok: true, bid: 1.05432, ask: 1.05434}
   [Chart Update] EURUSD - Price: 1.05433, Time: ...
   ```

## Development vs Production

### Development (Bolt/WebContainer)
- Functions NOT available
- Polling automatically disabled
- App uses cached price data from Supabase
- Warning message shown in console

### Production (pipnosis.com)
- Functions available
- Polling enabled automatically
- Live prices from MetaAPI
- Real-time chart updates

## Support

If issues persist after following this guide:

1. Check Netlify function logs for errors
2. Review MetaAPI dashboard for account status
3. Verify Supabase connection and RLS policies
4. Check browser console for detailed error messages
5. Test individual function endpoints with curl

## Files Changed

- `src/lib/environment.ts` - New environment detection utility
- `src/services/global-polling-coordinator.ts` - Enhanced error handling
- `netlify.toml` - Added function configurations and redirect rules
