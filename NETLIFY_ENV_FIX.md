# 🚨 CRITICAL FIX: Netlify Environment Variables

## Problem Identified

The hybrid-price-collector scheduled function is running every 60 seconds as expected, but it's **silently failing** to collect forex price data due to an environment variable naming mismatch.

### Root Cause

- **Documentation error**: `.env.production` incorrectly referenced `METAAPI_ADMIN_TOKEN`
- **Code expects**: `METAAPI_TOKEN` (NOT `METAAPI_ADMIN_TOKEN`)
- **Result**: Function runs but skips ALL forex symbols (XAUUSD, EURUSD, GBPUSD, etc.)
- **User impact**: "No price data available" errors when trying to trade forex pairs

### Evidence

```typescript
// Code everywhere expects this variable name:
const metaApiToken = process.env.METAAPI_TOKEN!;

// But documentation said to set:
METAAPI_ADMIN_TOKEN  // ❌ WRONG NAME
```

When MetaAPI credentials are missing:
- Function logs: "WARNING: Missing MetaAPI credentials, crypto-only mode"
- Only collects crypto prices via Kraken fallback (BTCUSD, ETHUSD)
- **Zero forex data collected**
- Goal sessions with forex symbols fail with "Price data is Infinitys old"

---

## ✅ How to Fix (2 Minutes)

### Step 1: Open Netlify Dashboard

1. Go to https://app.netlify.com/
2. Select your Pipnosis site
3. Navigate to: **Site Settings** → **Environment Variables**

### Step 2: Check Current Variables

Look for these variables:
- ❌ If you see `METAAPI_ADMIN_TOKEN` → **This is wrong, needs to be renamed**
- ✅ If you see `METAAPI_TOKEN` → **Correct, verify it's set**

### Step 3: Set Correct Variable

**If `METAAPI_ADMIN_TOKEN` exists:**
1. Copy the value from `METAAPI_ADMIN_TOKEN`
2. Delete `METAAPI_ADMIN_TOKEN`
3. Create new variable: `METAAPI_TOKEN` with the copied value

**If `METAAPI_TOKEN` is missing:**
1. Click "Add variable"
2. **Key**: `METAAPI_TOKEN`
3. **Value**: Your MetaAPI token from https://app.metaapi.cloud/
4. **Scopes**: Production, Deploy Previews, Branch Deploys (all recommended)

### Step 4: Verify All Required Variables

Ensure these are ALL present:

#### Supabase (Required)
- ✅ `VITE_SUPABASE_URL`
- ✅ `VITE_SUPABASE_ANON_KEY`
- ✅ `SUPABASE_SERVICE_ROLE_KEY`

#### MetaAPI (Critical for Forex)
- ✅ `METAAPI_TOKEN` (NOT METAAPI_ADMIN_TOKEN)
- ✅ `METAAPI_ACCOUNT_ID`
- ✅ `METAAPI_REGION` (usually "london")
- ✅ `VITE_METAAPI_ACCOUNT_ID` (same as METAAPI_ACCOUNT_ID)
- ✅ `VITE_METAAPI_REGION` (same as METAAPI_REGION)

#### OpenAI (For AI Analysis)
- ✅ `OPENAI_API_KEY`

#### Push Notifications (Optional)
- ✅ `VITE_VAPID_PUBLIC_KEY`
- ✅ `VAPID_PRIVATE_KEY`
- ✅ `VAPID_PUBLIC_KEY`

### Step 5: Redeploy

After setting the variables:
1. Go to **Deploys** tab
2. Click **Trigger deploy** → **Clear cache and deploy site**
3. Wait for deployment to complete (~2 minutes)

---

## 🔍 Verification

### Method 1: Check Netlify Function Logs

1. Go to **Deploys** → Select latest deploy → **Function logs**
2. Wait for next scheduled execution (runs every minute)
3. Look for:
   - ✅ **Good**: "Starting hybrid price collection... Forex symbols: XAUUSD, US30, EURUSD..."
   - ❌ **Bad**: "❌ CRITICAL: Missing MetaAPI credentials!"

### Method 2: Check Database

Run this SQL in Supabase SQL Editor:

```sql
-- Check if forex prices are being collected
SELECT
  symbol,
  COUNT(*) as price_count,
  MAX(created_at) as latest_price,
  EXTRACT(EPOCH FROM (NOW() - MAX(created_at))) as age_seconds
FROM realtime_prices
WHERE created_at > NOW() - INTERVAL '5 minutes'
  AND symbol IN ('XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY')
GROUP BY symbol
ORDER BY age_seconds;
```

**Expected results:**
- Each forex symbol should have prices less than 120 seconds old
- If age > 300 seconds or no results → MetaAPI token still not working

### Method 3: Check Health Metrics

```sql
-- Check price collection success rate
SELECT * FROM get_price_collection_health_summary(5);
```

**Expected results:**
- Success rate should be > 95% for all symbols
- Primary source for forex should be "metaapi", not "finnhub"
- If seeing high finnhub usage → MetaAPI credentials issue

---

## 📊 What Changed

### Files Updated

1. **`.env.example`**
   - Changed: `METAAPI_ADMIN_TOKEN` → `METAAPI_TOKEN`
   - Added clear warning about correct variable name

2. **`.env.production`**
   - Fixed misleading comment about `METAAPI_ADMIN_TOKEN`
   - Now correctly documents `METAAPI_TOKEN`

3. **`netlify/functions/hybrid-price-collector.ts`**
   - Enhanced error logging when MetaAPI credentials missing
   - Now explicitly shows which variable name it's looking for
   - Provides actionable fix instructions in logs

### No Code Logic Changes

The code **already worked correctly** - it was always looking for `METAAPI_TOKEN`. The bug was purely a **documentation error** that led to the wrong environment variable being set in Netlify.

---

## 🎯 Impact After Fix

Once the correct `METAAPI_TOKEN` variable is set:

1. **Immediate** (next 60 seconds):
   - hybrid-price-collector will start collecting forex prices
   - XAUUSD, EURUSD, GBPUSD, etc. will have fresh data

2. **Within 2 minutes**:
   - All forex symbols will have multiple price ticks
   - Goal sessions can start successfully with forex pairs
   - "No price data" errors will disappear

3. **Monitoring**:
   - Check `price_collection_health` table for 95%+ success rate
   - Verify MetaAPI is primary source (not finnhub fallback)
   - Confirm all active symbols have data < 120 seconds old

---

## 🔐 Security Note

The `METAAPI_TOKEN` variable:
- Is your MetaAPI authentication token
- Should NEVER be exposed in browser/frontend code
- Should ONLY be set in Netlify environment variables (server-side)
- Is NOT the same as a "temporary token" (those are cached in Supabase)
- Has full access to your MetaAPI account (keep it secure)

---

## 📞 Support

If price data still doesn't appear after following these steps:

1. Check Netlify function logs for errors
2. Verify MetaAPI token is valid at https://app.metaapi.cloud/
3. Check MetaAPI account status (active, not expired)
4. Verify account has access to the symbols you're trading
5. Check `price_collection_health` table for specific error messages

---

**Last Updated**: 2026-01-13
**Severity**: P0 - Blocks all forex trading functionality
**Resolution Time**: 2 minutes (just rename environment variable)
