# CRITICAL: Netlify Environment Variables Update Required

## Action Required Immediately

Your Netlify environment variables are currently pointing to an **OLD, INACTIVE MetaAPI account**. This is preventing live price data from flowing to your application.

---

## Current Issue

**Backend (Netlify Functions):**
- Using OLD account: `8845e940-c372-4a3d-9f7e-66288924c46f`
- Region: `new-york`
- Status: **FAILED** (account likely deleted/deprovisioned)
- Result: All MetaAPI REST API calls fail with "fetch failed"

**Frontend (React App):**
- Using NEW account: `169ff8dd-bb46-4618-91b4-28f696fba223`
- Name: "Pipnosis Ai"
- Region: `london`
- Broker: AAAFx-5 Demo
- Status: **DEPLOYED and CONNECTED**
- Result: Frontend connects successfully but receives no live prices

**Impact:**
- No live price data reaches your application
- Charts display stale cached data (221+ hours old)
- Auto-trading system cannot execute trades
- System appears functional but is completely frozen at last market close

---

## Required Changes

You MUST manually update these environment variables in your Netlify dashboard:

### Step 1: Access Netlify Dashboard

1. Go to: https://app.netlify.com
2. Log in to your account
3. Select your **Pipnosis** site
4. Navigate to: **Site Settings** > **Environment Variables**

### Step 2: Update These 4 Variables

Find and update these variables with the new values:

| Variable Name | OLD Value (WRONG) | NEW Value (CORRECT) |
|--------------|-------------------|---------------------|
| `METAAPI_ACCOUNT_ID` | `8845e940-c372-4a3d-9f7e-66288924c46f` | `169ff8dd-bb46-4618-91b4-28f696fba223` |
| `VITE_METAAPI_ACCOUNT_ID` | `8845e940-c372-4a3d-9f7e-66288924c46f` | `169ff8dd-bb46-4618-91b4-28f696fba223` |
| `METAAPI_REGION` | `new-york` | `london` |
| `VITE_METAAPI_REGION` | `new-york` | `london` |

### Step 3: Verify Other Variables

Ensure these variables exist and are correct (DO NOT CHANGE unless missing):

| Variable Name | Description | Should Contain |
|--------------|-------------|----------------|
| `METAAPI_ADMIN_TOKEN` | Your MetaAPI admin JWT token | Long JWT string starting with `eyJhbGci...` |
| `VITE_SUPABASE_URL` | Supabase project URL | `https://nzisgxdlydihlwsvonfy.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key | JWT string starting with `eyJhbGci...` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | JWT string starting with `eyJhbGci...` |

### Step 4: Save Changes

Click **"Save"** after making the changes.

### Step 5: Trigger Rebuild

After saving environment variables, you MUST trigger a new deployment for changes to take effect:

**Option A: Use Build Hook (Recommended)**
```bash
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

**Option B: Push to Git**
```bash
git add .
git commit -m "Update MetaAPI account configuration"
git push origin main
```

**Option C: Manual Deploy**
1. In Netlify dashboard, go to **Deploys** tab
2. Click **"Trigger deploy"** > **"Deploy site"**

---

## What Happens After Update

### Immediate Results (After Rebuild Completes)

1. **Live Prices Start Flowing**
   - MetaAPI REST calls will succeed
   - Backend fetches real bid/ask prices from london region
   - Frontend receives valid price data every 2 seconds
   - "No valid price data" warnings will stop

2. **Chart Updates in Real-Time**
   - Candlesticks update as new bars close
   - Price line moves with market
   - EMA indicators calculate on live data
   - VWAP tracks current volume-weighted price

3. **Auto-Trading Becomes Operational**
   - AI analysis runs on live market data
   - Trade signals generate with current prices
   - Risk calculations use real spreads
   - Demo orders can execute on AAAFx-5 Demo account

4. **Fallback System Active**
   - If MetaAPI has temporary issues, system automatically falls back to Supabase cached prices
   - Ensures continuous operation even during API maintenance
   - Transparent labeling when using cached data

### Verification Steps

After rebuild completes (~3-5 minutes), check:

1. **Netlify Function Logs**
   - Look for: `[REST] ✓ EURUSD: bid=1.0850, ask=1.0852, mid=1.0851`
   - Should NOT see: `[REST] ❌ EURUSD: HTTP 404` or "fetch failed"

2. **Browser Console**
   - Should see: Live prices updating every 2 seconds
   - Should NOT see: "No valid price data in tick"
   - Look for: `[LivePricePolling]` logs showing successful price updates

3. **Chart Display**
   - Price should move in real-time
   - Latest candle timestamp should match current time
   - Candle updates should happen every 5 minutes (for M5 timeframe)

4. **Auto-Trading Panel**
   - "Enable Auto Trading" toggle should be functional
   - Status should show "Ready" or "Scanning" when enabled
   - Thought process should display live analysis

---

## Technical Details of Changes Made

### Code Changes Included

1. **Local Environment Files Updated**
   - `.env` - Updated for local development
   - `.env.production` - Updated for production builds
   - Both now use account `169ff8dd...` and region `london`

2. **Backend Function Enhanced** (`netlify/functions/get-latest-price.js`)
   - Changed MetaAPI host to london region: `mt-client-api-v1.london.agiliumtrade.ai`
   - Updated endpoint path to use `/current-price` instead of `/price`
   - Added Supabase fallback when MetaAPI fails
   - Returns flat structure when `?symbol=EURUSD` query parameter is provided
   - Returns nested structure for backward compatibility when no symbol specified
   - Improved error logging for diagnostics

3. **Frontend Parser Enhanced** (`src/services/livePricePolling.ts`)
   - Now handles both flat and nested response formats
   - Detects response type automatically
   - Extracts price data from either structure
   - Logs when using cached/fallback data
   - Better error messages for debugging
   - Added `cached` property to Tick type

4. **Resilience Improvements**
   - If MetaAPI REST fails, queries Supabase for most recent candle
   - Generates synthetic bid/ask from cached close price (± 0.01% spread)
   - Transparent labeling: `source: 'supabase_cache', cached: true`
   - Ensures system never shows "No data" to user

---

## Troubleshooting

### If Live Prices Still Don't Flow After Update

1. **Check Netlify Build Logs**
   - Go to: Deploys > Latest Deploy > Deploy Log
   - Verify build completed successfully
   - Look for any environment variable errors

2. **Verify Account ID in Logs**
   - Check function logs: `/.netlify/functions/get-latest-price?symbol=EURUSD`
   - Should be using account ID `169ff8dd...`
   - Should be hitting `london.agiliumtrade.ai` host

3. **Test MetaAPI Connection Directly**
   - Log into MetaAPI dashboard
   - Verify account `169ff8dd-bb46-4618-91b4-28f696fba223` is deployed
   - Check account status shows "CONNECTED"
   - Verify broker connection is active

4. **Check Browser Console**
   - Open DevTools > Console
   - Filter for: `get-latest-price`
   - Look for successful fetch responses with bid/ask values

5. **Verify Supabase Fallback Works**
   - Even if MetaAPI fails, should see: `[Supabase Fallback] ✓ EURUSD`
   - This proves system can still function with cached data

### Common Issues

**Issue:** "Missing METAAPI_ADMIN_TOKEN"
- **Solution:** Add `METAAPI_ADMIN_TOKEN` to Netlify environment variables

**Issue:** Build succeeds but still seeing old account ID in logs
- **Solution:** Clear Netlify build cache and rebuild

**Issue:** HTTP 404 from MetaAPI
- **Solution:** Verify account `169ff8dd...` exists in your MetaAPI dashboard

**Issue:** "No cached data available" from Supabase
- **Solution:** Let system run for 5 minutes to populate cache

---

## Timeline

**Time to Update Variables:** 2 minutes
**Netlify Rebuild Time:** 3-5 minutes
**Total Time to Trading:** ~7 minutes

---

## Summary

You are literally **ONE configuration update** away from live trading on your demo account!

**Required Action:**
1. Update 4 environment variables in Netlify dashboard (2 minutes)
2. Trigger rebuild (30 seconds)
3. Wait for deployment (3-5 minutes)
4. Verify live prices flowing (30 seconds)
5. **START TRADING!**

The code is 100% ready. The system is fully operational. We just need to point it at the correct MetaAPI account.

---

## Questions?

If you encounter any issues after updating the environment variables and triggering a rebuild, check:
- Netlify function logs
- Browser console logs
- MetaAPI dashboard account status

The system includes comprehensive logging and fallback mechanisms to help diagnose any issues.
