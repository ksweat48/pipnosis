# MetaAPI Connection Fix - Complete Solution

## Date: October 27, 2025

## Problem Summary
MetaAPI showed as "Connected (full redundancy)" in the dashboard, but the application was not receiving live ticks or historical chart data.

## Root Causes Identified

### 1. **Configuration Misalignment**
- Backend functions were using inconsistent region defaults (`new-york` vs `london`)
- Missing `METAAPI_ACCOUNT_ID` environment variable for backend functions
- Only `VITE_METAAPI_ACCOUNT_ID` was set, causing backend functions to fail

### 2. **Region Configuration Issues**
- `.env` file had `VITE_METAAPI_REGION=london`
- Backend functions defaulted to `new-york` or `london` inconsistently
- Frontend service defaulted to `new-york`
- This mismatch prevented proper connection to MetaAPI account

### 3. **Connection Initialization Problems**
- Backend functions not properly waiting for synchronization
- No timeout specified for `waitSynchronized()` calls
- Missing error handling for connection failures

### 4. **Environment Variable Gaps**
- Backend Netlify functions only checked for `METAAPI_ACCOUNT_ID`
- Frontend only set `VITE_METAAPI_ACCOUNT_ID`
- No fallback logic between the two variable names

## Solutions Implemented

### 1. **Updated Backend Functions**

#### `netlify/functions/verify-metaapi-account.js`
- Added fallback: `process.env.METAAPI_ACCOUNT_ID || process.env.VITE_METAAPI_ACCOUNT_ID`
- Changed region default: `process.env.METAAPI_REGION || process.env.VITE_METAAPI_REGION || 'london'`

#### `netlify/functions/get-live-price.js`
- Added account ID fallback logic
- Changed region default to `london`
- Added 60-second timeout for synchronization: `waitSynchronized({ timeoutInSeconds: 60 })`
- Improved error logging

#### `netlify/functions/stream-prices.js`
- Added account ID fallback logic
- Changed region default to `london`
- Added 90-second timeout for synchronization: `waitSynchronized({ timeoutInSeconds: 90 })`
- Enhanced connection logging

### 2. **Updated Frontend Services**

#### `src/services/metaapi.ts`
- Changed default region from `new-york` to `london`
- Enhanced verification logging with region information
- Added region mismatch detection and warning
- Improved error messages for debugging

#### `src/lib/env-validator.ts`
- Updated default region warning message to `london`
- Changed default region display to `london`

### 3. **Environment Configuration**

#### Updated `.env` file
Added both sets of environment variables for full compatibility:
```env
METAAPI_ADMIN_TOKEN=<your_token>
METAAPI_ACCOUNT_ID=169ff8dd-bb46-4618-91b4-28f696fba223
METAAPI_REGION=london
VITE_METAAPI_ACCOUNT_ID=169ff8dd-bb46-4618-91b4-28f696fba223
VITE_METAAPI_REGION=london
```

## What to Set in Netlify Dashboard

Navigate to: **Netlify Dashboard > Site Settings > Environment Variables**

Add or verify these variables:

```
METAAPI_ADMIN_TOKEN=<your_admin_token>
METAAPI_ACCOUNT_ID=169ff8dd-bb46-4618-91b4-28f696fba223
METAAPI_REGION=london
VITE_METAAPI_ACCOUNT_ID=169ff8dd-bb46-4618-91b4-28f696fba223
VITE_METAAPI_REGION=london
VITE_SUPABASE_URL=https://nzisgxdlydihlwsvonfy.supabase.co
VITE_SUPABASE_ANON_KEY=<your_anon_key>
SUPABASE_SERVICE_ROLE_KEY=<your_service_role_key>
ADMIN_REFRESH_KEY=<your_admin_key>
```

## Expected Behavior After Fix

### 1. **On Application Startup**
- Frontend will call `/netlify/functions/verify-metaapi-account`
- Backend will connect to MetaAPI with correct region (`london`)
- Console will show:
  ```
  ✅ MetaAPI account verified successfully
     Account: Pipnosis Ai (169ff8dd...)
     Platform: mt5
     Region: london
     Server: AAAFx-5 Demo
     State: DEPLOYED
     Connection Status: CONNECTED
  ```

### 2. **Live Price Data**
- Application will start polling `/netlify/functions/get-live-price`
- Backend will fetch live prices via MetaAPI RPC connection
- Prices will be stored in `realtime_prices` table
- Frontend receives price updates every 2 seconds

### 3. **WebSocket Streaming (Optional)**
- `/netlify/functions/stream-prices` can be used for real-time streaming
- Server-Sent Events provide continuous price updates
- Automatic fallback to Supabase realtime if WebSocket fails

### 4. **Historical Chart Data**
- Application loads historical candles from Supabase cache
- Live prices update the current candle in real-time
- Chart displays smooth price movement

## Testing Steps

### 1. **Local Testing**
```bash
npm run build
npm run preview
```

### 2. **Check Console Output**
Look for these messages:
- `✅ MetaAPI account verified successfully`
- `✅ Market data service initialized successfully with LIVE MetaAPI connection`
- `📡 Real-time streaming active for all subscribed symbols`

### 3. **Verify Live Data**
- Open browser DevTools > Network tab
- Watch for calls to `get-live-price?symbol=EURUSD`
- Should return `200 OK` with bid/ask prices
- Source should be `metaapi-rpc` (not cached)

### 4. **Check Database**
```sql
-- Check for recent price data
SELECT * FROM realtime_prices
ORDER BY created_at DESC
LIMIT 10;

-- Should show prices from last few seconds
```

## Deployment Command

```bash
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

## Troubleshooting

### If MetaAPI Still Shows "Not Connected"

1. **Check Netlify Environment Variables**
   - Ensure all variables listed above are set
   - Especially `METAAPI_ACCOUNT_ID` and `METAAPI_REGION`

2. **Verify Region Match**
   - Check your MetaAPI dashboard for actual account region
   - Must match `METAAPI_REGION` setting

3. **Check Function Logs**
   - Netlify Dashboard > Functions > Select function > View logs
   - Look for connection errors or timeout messages

4. **Test Backend Directly**
   ```bash
   # Test verification
   curl https://your-site.netlify.app/.netlify/functions/verify-metaapi-account

   # Test live price
   curl https://your-site.netlify.app/.netlify/functions/get-live-price?symbol=EURUSD
   ```

### Common Errors and Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| "Account not deployed" | MetaAPI account not active | Deploy account in MetaAPI dashboard |
| "Region mismatch" | Wrong region configured | Update `METAAPI_REGION` to match dashboard |
| "Account verification failed" | Missing credentials | Check `METAAPI_ADMIN_TOKEN` is set |
| "Timeout waiting for sync" | Network/firewall issue | Check Netlify function timeout settings |
| "No cached prices available" | No recent data | Wait 30 seconds for initial data collection |

## Files Changed

### Backend Functions
- `netlify/functions/verify-metaapi-account.js`
- `netlify/functions/get-live-price.js`
- `netlify/functions/stream-prices.js`

### Frontend Services
- `src/services/metaapi.ts`
- `src/lib/env-validator.ts`

### Configuration
- `.env` (added missing variables)

## Technical Notes

### Why Both Variable Formats?
- `VITE_*` variables are exposed to browser code (Vite build process)
- Non-prefixed variables are only available to backend functions
- Having both ensures compatibility across frontend and backend

### Region Consistency
The `london` region was chosen because:
- It appears in your MetaAPI dashboard as the deployed region
- Provides good latency for European markets
- Matches your account's actual configuration

### Connection Flow
1. Frontend initializes → calls verify-metaapi-account
2. Backend creates MetaAPI instance → connects to account
3. Backend waits for synchronization (60-90s timeout)
4. Connection established → backend caches connection
5. Frontend starts live price polling
6. Prices flow: MetaAPI → Backend → Supabase → Frontend

## Success Indicators

When everything works correctly, you'll see:
1. ✅ Green "All Systems Operational" in app header
2. ✅ "MetaApi: Connected" status indicator
3. ✅ Live prices updating every 2 seconds
4. ✅ Chart candles moving with current price
5. ✅ No errors in browser console
6. ✅ Recent entries in `realtime_prices` table

## Next Steps

After deployment:
1. Monitor Netlify function logs for first 5 minutes
2. Check application console for connection success
3. Verify live price data in UI
4. Test with multiple currency pairs
5. Confirm historical chart data loads properly

---

**Build Status:** ✅ Successfully built (October 27, 2025)
**Ready for Deployment:** YES
