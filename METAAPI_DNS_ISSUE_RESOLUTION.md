# MetaAPI DNS Resolution Issue - Diagnosis and Resolution

**Status**: Under Investigation
**Date**: October 27, 2025
**Severity**: Critical - Blocking live price streaming

## Problem Summary

The Netlify serverless functions are experiencing DNS resolution failures when attempting to connect to MetaAPI servers. This is preventing real-time price streaming functionality from working.

### Error Details

```
ENOTFOUND. Request URL: https://mt-provisioning-api-v1.agiliumtrade.ai/users/current/accounts/169ff8dd-bb46-4618-91b4-28f696fba223
```

### Impact

1. **stream-prices function**: Returns 502 Bad Gateway errors immediately
2. **get-live-price function**: Falls back to cached data (Supabase realtime_prices table)
3. **MetaAPI connection**: Cannot establish connection from Netlify infrastructure

## Root Cause Analysis

### Confirmed Issues
1. DNS resolution failing for `mt-provisioning-api-v1.agiliumtrade.ai` from Netlify infrastructure
2. This suggests either:
   - Network restrictions in Netlify's AWS region
   - DNS propagation issues for agiliumtrade.ai domain
   - Firewall/security blocking at MetaAPI or Netlify level
   - Geographic routing issues (your region: london)

### What We Know Works
- ✅ Database schema is correct (candles view created)
- ✅ Fallback mechanisms are in place
- ✅ RLS policies are properly configured
- ✅ Environment variables are set correctly

## Diagnostic Steps

### 1. Test MetaAPI Connection
Use the new diagnostic endpoint:

```bash
curl https://pipnosis.com/.netlify/functions/test-metaapi-connection
```

This will test:
- Environment variable configuration
- DNS resolution for MetaAPI domains
- MetaAPI SDK initialization
- Account verification

### 2. Check Netlify Function Logs
Monitor real-time logs in Netlify dashboard for detailed error messages

### 3. Verify MetaAPI Account Status
Log into MetaAPI dashboard and verify:
- Account is in DEPLOYED state
- Region is set to "london"
- API token is valid and not expired
- Account has proper permissions

## Workarounds Implemented

### Immediate Workarounds (Already Active)
1. **REST Polling Fallback**: Frontend automatically falls back to REST polling when streaming fails
2. **Cached Price Fallback**: get-live-price uses Supabase cached prices if MetaAPI is unavailable
3. **Market Data Fallback**: Falls back to historical market_data table if cache is empty
4. **Connection Timeout**: Reduced from 90s to 20s to fail faster and use fallbacks

### How It Works Now
```
User opens app
  ↓
Try WebSocket streaming (fails with DNS error)
  ↓
Fall back to REST polling (/.netlify/functions/get-live-price)
  ↓
Try MetaAPI direct connection (fails with DNS error)
  ↓
Fall back to Supabase cached prices
  ↓
If cache empty, fall back to market_data table
```

## Potential Solutions

### Option 1: Contact Netlify Support
Ask Netlify to whitelist MetaAPI domains or investigate DNS resolution issues from their infrastructure.

**MetaAPI domains to whitelist:**
- mt-provisioning-api-v1.agiliumtrade.ai
- mt-client-api-v1.agiliumtrade.ai
- metaapi.cloud

### Option 2: Use MetaAPI from Different Infrastructure
Deploy MetaAPI-dependent functions to:
- Vercel (different cloud provider)
- AWS Lambda directly
- Railway or Render
- Your own VPS

### Option 3: Create Proxy Service
Run a lightweight proxy service (on VPS or different cloud) that:
1. Connects to MetaAPI successfully
2. Exposes REST API for your Netlify functions
3. Handles WebSocket connections and forwards data

### Option 4: Alternative Trading Data Provider
Consider switching to a provider with better serverless compatibility:
- Alpaca Markets
- OANDA API
- Twelve Data
- Finnhub

## Next Steps

### Immediate Actions Required

1. **Run Diagnostic Tool**
   ```bash
   curl https://pipnosis.com/.netlify/functions/test-metaapi-connection
   ```
   Share output with support team

2. **Check MetaAPI Dashboard**
   - Verify account status
   - Check API token validity
   - Review any error messages or alerts

3. **Contact Support**
   - MetaAPI Support: Check if there are known issues with agiliumtrade.ai domain
   - Netlify Support: Ask about DNS resolution failures for specific domain

4. **Test from Local Environment**
   ```bash
   npm run dev
   ```
   Verify that MetaAPI works from your local machine (not through Netlify)

### Testing After Changes

After implementing any fix:

1. Check function logs: `netlify logs --function=stream-prices`
2. Monitor browser console for connection status
3. Verify prices update in real-time
4. Check Supabase realtime_prices table for new inserts

## Environment Variables Checklist

Verify these are set in Netlify dashboard (Site Settings > Environment Variables):

```
METAAPI_ADMIN_TOKEN=<your-token>
METAAPI_ACCOUNT_ID=169ff8dd-bb46-4618-91b4-28f696fba223
METAAPI_REGION=london
VITE_SUPABASE_URL=<your-url>
SUPABASE_SERVICE_ROLE_KEY=<your-key>
```

## Related Files

- `/netlify/functions/stream-prices.js` - SSE streaming function
- `/netlify/functions/get-live-price.js` - REST polling function
- `/netlify/functions/test-metaapi-connection.js` - Diagnostic tool
- `/src/services/realtimePriceStream.ts` - Frontend streaming client
- `/src/services/livePricePolling.ts` - Frontend polling client

## Support Resources

- MetaAPI Documentation: https://metaapi.cloud/docs/
- MetaAPI Support: support@metaapi.cloud
- Netlify Support: https://www.netlify.com/support/
- Project Discord/Slack: [Your support channel]

## Updates

### October 27, 2025 - Initial Investigation
- Identified DNS resolution failure
- Implemented comprehensive fallback system
- Created diagnostic tools
- Updated database schema for compatibility
- Reduced timeouts for faster failure detection

---

**Note**: The application continues to work with cached data and fallbacks, but real-time streaming is currently unavailable until the DNS issue is resolved.
