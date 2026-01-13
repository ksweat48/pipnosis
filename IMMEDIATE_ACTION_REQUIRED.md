# 🚨 IMMEDIATE ACTION REQUIRED - Price Data Fix

## ✅ What I Just Did

1. **Identified root cause**: Environment variable naming mismatch
   - Your local .env has `METAAPI_TOKEN` ✅
   - Your Netlify production likely has `METAAPI_ADMIN_TOKEN` ❌
   - Code expects `METAAPI_TOKEN` everywhere

2. **Fixed all documentation**:
   - ✅ Updated .env.example
   - ✅ Updated .env.production
   - ✅ Updated DEPLOYMENT.md
   - ✅ Enhanced error logging in hybrid-price-collector

3. **Deployed to production**:
   - ✅ Build completed successfully
   - ✅ Triggered Netlify deployment via build hook
   - ⏳ Deployment in progress (~2 minutes)

---

## 🎯 What YOU Need to Do (2 Minutes)

### Step 1: Fix Netlify Environment Variable

1. Open https://app.netlify.com/
2. Select your Pipnosis site
3. Go to: **Site Settings** → **Environment Variables**
4. Look for `METAAPI_ADMIN_TOKEN`
5. If found:
   - Copy its value
   - Delete `METAAPI_ADMIN_TOKEN`
   - Add new variable: `METAAPI_TOKEN` (exact spelling)
   - Paste the value
   - Scopes: All (Production, Deploy Previews, Branch Deploys)
6. If `METAAPI_TOKEN` already exists:
   - Verify it has the correct value
   - Make sure it's enabled for Production scope

### Step 2: Trigger Clean Deployment

1. Go to **Deploys** tab in Netlify
2. Click **Trigger deploy** → **Clear cache and deploy site**
3. Wait 2 minutes for deployment to complete

---

## 🔍 Verify It Works

### Option 1: Check Netlify Function Logs (Fastest)

1. Go to **Deploys** → Latest deploy → **Function logs**
2. Filter for "hybrid-price-collector"
3. Wait up to 60 seconds for next execution
4. Look for:
   - ✅ **GOOD**: "Starting hybrid price collection... Forex symbols: XAUUSD, US30, EURUSD..."
   - ❌ **BAD**: "❌ CRITICAL: Missing MetaAPI credentials!"

### Option 2: Check Database (Most Accurate)

Run this in Supabase SQL Editor:

```sql
SELECT
  symbol,
  COUNT(*) as ticks,
  MAX(created_at) as latest,
  EXTRACT(EPOCH FROM (NOW() - MAX(created_at))) as age_seconds
FROM realtime_prices
WHERE created_at > NOW() - INTERVAL '5 minutes'
  AND symbol IN ('XAUUSD', 'EURUSD', 'GBPUSD')
GROUP BY symbol;
```

**Expected**: All forex symbols with age < 120 seconds

### Option 3: Test in UI (User-Facing)

1. Start a goal session with XAUUSD
2. Should start immediately without "No price data" error
3. Chart should update in real-time

---

## 📋 Complete Environment Variable Checklist

Verify ALL of these are set in Netlify:

### Supabase (Critical)
- [ ] `VITE_SUPABASE_URL`
- [ ] `VITE_SUPABASE_ANON_KEY`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`

### MetaAPI (Critical - This is what's broken)
- [ ] `METAAPI_TOKEN` ← **THIS ONE! NOT METAAPI_ADMIN_TOKEN**
- [ ] `METAAPI_ACCOUNT_ID`
- [ ] `METAAPI_REGION`
- [ ] `VITE_METAAPI_ACCOUNT_ID`
- [ ] `VITE_METAAPI_REGION`

### OpenAI (Critical for AI features)
- [ ] `OPENAI_API_KEY`

### Other
- [ ] `ADMIN_REFRESH_KEY`
- [ ] `VITE_VAPID_PUBLIC_KEY`
- [ ] `VAPID_PRIVATE_KEY`
- [ ] `VAPID_PUBLIC_KEY`

---

## 🎯 Why This Happened

**Documentation Bug**: The `.env.production` file had a misleading comment that said to set `METAAPI_ADMIN_TOKEN`, but the code everywhere expects `METAAPI_TOKEN`.

**Your local environment works** because your local `.env` has the correct variable name: `METAAPI_TOKEN`.

**Production fails silently** because:
1. Function runs every 60 seconds ✅
2. Looks for `METAAPI_TOKEN` → not found ❌
3. Falls back to "crypto-only mode" (logs warning but continues)
4. Only collects BTCUSD, ETHUSD via Kraken
5. Skips ALL forex symbols (XAUUSD, EURUSD, etc.)
6. User tries to trade forex → "No price data" error

---

## 📊 Expected Timeline

| Time | Status | What's Happening |
|------|--------|------------------|
| **Now** | ⏳ Deployment in progress | Code with better error logging deploying |
| **+2 min** | ⚠️ Still showing error | Netlify deployed but env var still wrong |
| **+4 min** | ✅ You fix env var | Set `METAAPI_TOKEN` in Netlify dashboard |
| **+6 min** | ✅ Redeploy triggered | Clean deployment with correct env vars |
| **+8 min** | ✅ Working | hybrid-price-collector starts collecting forex data |
| **+9 min** | 🎉 Complete | All symbols have fresh data, users can trade |

---

## 🚨 If Still Not Working After Fix

1. **Check MetaAPI Token Is Valid**
   - Login to https://app.metaapi.cloud/
   - Verify token hasn't expired
   - Check account subscription is active

2. **Check Function Logs for Specific Errors**
   - Now shows exactly which variable it's looking for
   - Shows current status (SET vs UNDEFINED)
   - Provides actionable error messages

3. **Check Health Metrics**
   ```sql
   SELECT * FROM get_price_collection_health_summary(5);
   ```
   - Shows success rate per symbol
   - Shows which data source was used
   - Shows error messages if any

---

## 📚 Reference Documents

- `NETLIFY_ENV_FIX.md` - Complete fix guide with screenshots
- `PRICE_DATA_FIX_SUMMARY.md` - Technical deep-dive
- `.env.example` - Corrected variable names
- `.env.production` - Corrected for production deployment

---

**Next Step**: Open Netlify Dashboard and fix that environment variable!

**Priority**: P0 - Blocks all forex trading
**Fix Time**: 2 minutes
**Impact**: Immediate (price data flows within 60 seconds)
