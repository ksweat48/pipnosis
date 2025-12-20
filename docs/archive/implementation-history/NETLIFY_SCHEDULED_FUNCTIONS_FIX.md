# NETLIFY SCHEDULED FUNCTIONS - DIAGNOSTIC & FIX GUIDE

## 🚨 CRITICAL ISSUE IDENTIFIED

Your scheduled functions (`continuous-price-collector` and `continuous-candle-aggregator`) are configured in `netlify.toml` but **NOT EXECUTING** on Netlify's servers.

**Result:** Candles only form when browser is open. When browser closes, data collection stops.

---

## ROOT CAUSE ANALYSIS

### ✅ What's Configured Correctly:

1. **netlify.toml** - Scheduled functions properly defined:
   ```toml
   [functions."continuous-price-collector"]
     timeout = 26
     schedule = "* * * * *"  # Every 1 minute

   [functions."continuous-candle-aggregator"]
     timeout = 60
     schedule = "*/5 * * * *"  # Every 5 minutes
   ```

2. **Function Code** - TypeScript files exist and are valid:
   - `netlify/functions/continuous-price-collector.ts` ✅
   - `netlify/functions/continuous-candle-aggregator.ts` ✅

3. **esbuild Config** - Proper configuration in `esbuild.config.js` ✅

### ❌ What's Missing / Broken:

1. **Functions May Not Be Deployed** - TypeScript needs to be compiled by Netlify's esbuild
2. **Environment Variables** - May not be set in Netlify dashboard
3. **Scheduled Functions** - May not be enabled/triggered on Netlify
4. **Build Process** - Local build doesn't compile functions (this is OK, Netlify should do it)

---

## IMMEDIATE FIX CHECKLIST

### Step 1: Verify Netlify Deployment Status

**Go to your Netlify Dashboard:**

1. Navigate to: https://app.netlify.com
2. Select your **Pipnosis** project
3. Click **"Deploys"** in the left sidebar
4. Check the most recent deploy:
   - ✅ Should show: "Published"
   - ❌ If "Failed" - click to see error logs

**Check Build Logs:**
- Look for: `Bundling functions with esbuild...`
- Should see: `continuous-price-collector` and `continuous-candle-aggregator` being bundled
- Any errors about TypeScript or missing dependencies?

### Step 2: Verify Functions Are Deployed

**In Netlify Dashboard → Functions:**

1. Click **"Functions"** in the left sidebar
2. You should see:
   - ✅ `continuous-price-collector`
   - ✅ `continuous-candle-aggregator`
   - Plus other functions (get-live-price, etc.)

3. Click on **`continuous-price-collector`**:
   - Check "Last invocation" - is it recent?
   - Check "Invocations" graph - is it showing activity?
   - If "Never invoked" or "Last invoked: days ago" → **PROBLEM CONFIRMED**

4. Click on **`continuous-candle-aggregator`**:
   - Same checks as above

### Step 3: Check Environment Variables

**In Netlify Dashboard → Site configuration → Environment variables:**

Verify these variables are set (NOT just in local `.env`):

**REQUIRED VARIABLES:**
```
VITE_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
METAAPI_TOKEN=your-metaapi-token
METAAPI_ACCOUNT_ID=your-account-id
METAAPI_REGION=london
```

**How to add if missing:**
1. Site configuration → Environment variables
2. Add variable → Key/Value
3. Click "Save"
4. **CRITICAL:** Redeploy site after adding variables

### Step 4: Manually Test Functions

**Test if functions work when manually triggered:**

1. In Netlify Dashboard → Functions → `continuous-price-collector`
2. Look for a "Test function" or "Trigger function" button
3. Or use curl from your terminal:

```bash
# Test price collector
curl https://pipnosis.com/.netlify/functions/continuous-price-collector

# Test candle aggregator
curl https://pipnosis.com/.netlify/functions/continuous-candle-aggregator
```

**Expected Response:**
```json
{
  "success": true,
  "pricesCollected": 5,
  "pricesFailed": 0,
  "durationMs": 1234,
  "timestamp": "2024-12-08T16:30:00.000Z"
}
```

**If you get 404 or "Function not found":**
- Functions are NOT deployed → Check build logs

**If you get 500 or error:**
- Functions are deployed but failing → Check error message for missing env vars

### Step 5: Check Function Logs

**In Netlify Dashboard → Functions → continuous-price-collector → Logs:**

Look for execution logs. You should see:
```
[PriceCollector:exec_1234567890] 🚀 Starting continuous price collection...
[PriceCollector:exec_1234567890] Using MetaAPI Account: 12345678...
[PriceCollector:exec_1234567890] ✅ Completed in 1234ms: 5 prices saved, 0 failed
```

**If NO LOGS:**
- Scheduled functions are not triggering
- Continue to Step 6

### Step 6: Force Scheduled Functions to Start

**Netlify scheduled functions sometimes need a "kick-start":**

1. Make a trivial code change (add a comment to any file)
2. Git commit and push
3. Wait for deployment to complete
4. Check function invocations after 5-10 minutes

**Alternative - Use Netlify CLI:**
```bash
npm install -g netlify-cli
netlify login
netlify functions:invoke continuous-price-collector
```

---

## VERIFICATION TEST

**After completing the steps above:**

1. **Close your browser completely**
2. **Wait 15 minutes**
3. **Reopen browser and check:**

```sql
-- Run this in Supabase SQL Editor
SELECT
  symbol,
  COUNT(*) as price_count,
  MAX(created_at) as last_price,
  MIN(created_at) as first_price,
  EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at)))/60 as minutes_span
FROM realtime_prices
WHERE created_at > NOW() - INTERVAL '20 minutes'
GROUP BY symbol
ORDER BY symbol;
```

**✅ SUCCESS if:**
- 5 symbols show continuous data
- `last_price` is within 1-2 minutes
- `minutes_span` is ~15-20 minutes
- New candles exist in chart

**❌ STILL BROKEN if:**
- No new data after closing browser
- `last_price` is old
- Gaps in chart remain

---

## ALTERNATIVE SOLUTION: External Cron Service (FREE)

**If Netlify scheduled functions won't work, use this FREE workaround:**

### Option A: Cron-job.org (Recommended)

1. Go to: https://cron-job.org/en/
2. Sign up (free account)
3. Create new cron job:
   - **Title:** Pipnosis Price Collector
   - **URL:** `https://pipnosis.com/.netlify/functions/continuous-price-collector`
   - **Schedule:** Every 1 minute
   - **Method:** GET
   - **Timeout:** 30 seconds

4. Create second cron job:
   - **Title:** Pipnosis Candle Aggregator
   - **URL:** `https://pipnosis.com/.netlify/functions/continuous-candle-aggregator`
   - **Schedule:** Every 5 minutes
   - **Method:** GET
   - **Timeout:** 60 seconds

5. Enable both jobs
6. Test immediately using "Execute now" button

**This will work immediately and is 100% free!**

### Option B: UptimeRobot (Alternative)

1. Go to: https://uptimerobot.com
2. Sign up (free account - 50 monitors)
3. Add new monitor:
   - **Monitor Type:** HTTP(s)
   - **Friendly Name:** Pipnosis Price Collector
   - **URL:** `https://pipnosis.com/.netlify/functions/continuous-price-collector`
   - **Monitoring Interval:** 5 minutes (free tier limit)

**Note:** UptimeRobot free tier only allows 5-minute intervals, so this is less ideal than cron-job.org

---

## QUICK DEBUGGING COMMANDS

**Check if functions are accessible:**
```bash
# Price collector
curl -I https://pipnosis.com/.netlify/functions/continuous-price-collector

# Candle aggregator
curl -I https://pipnosis.com/.netlify/functions/continuous-candle-aggregator
```

**Check database for recent activity:**
```sql
-- Most recent prices
SELECT symbol, bid, ask, created_at, source
FROM realtime_prices
ORDER BY created_at DESC
LIMIT 10;

-- Recent candles from Netlify aggregator
SELECT symbol, timeframe, open_time, data_source
FROM forex_candles
WHERE data_source = 'netlify_aggregator'
ORDER BY open_time DESC
LIMIT 10;
```

**Check function execution from browser console:**
```javascript
// Test price collector
fetch('/.netlify/functions/continuous-price-collector')
  .then(r => r.json())
  .then(data => console.log('Price Collector:', data));

// Test candle aggregator
fetch('/.netlify/functions/continuous-candle-aggregator')
  .then(r => r.json())
  .then(data => console.log('Candle Aggregator:', data));
```

---

## EXPECTED BEHAVIOR ONCE FIXED

**Server-Side (Netlify Scheduled Functions):**
- ✅ `continuous-price-collector` runs every 1 minute (even when browser closed)
- ✅ Saves prices to `realtime_prices` table with `source='netlify_continuous_collector'`
- ✅ `continuous-candle-aggregator` runs every 5 minutes (even when browser closed)
- ✅ Creates candles in `forex_candles` table with `data_source='netlify_aggregator'`

**Client-Side (Browser):**
- ✅ Polls database every 3 seconds for new prices
- ✅ Updates chart in real-time
- ✅ Shows "Server-side aggregation active" in console
- ✅ Charts continue to have data even after browser was closed

**Database:**
- ✅ Continuous flow of data 24/7 (except weekends)
- ✅ No gaps in `realtime_prices` table
- ✅ No gaps in `forex_candles` table
- ✅ All timeframes (M1, M5, M15, M30, H1, H4, D1, W1) have complete data

---

## NEXT STEPS

1. ✅ **Run through Steps 1-6** above to diagnose the issue
2. ✅ **Report findings** - Tell me what you see in Netlify dashboard
3. ✅ **Choose solution:**
   - Fix Netlify scheduled functions (preferred)
   - Use external cron service (immediate workaround)
   - Migrate to different platform (if Netlify won't work)

---

## DEPLOYMENT TRIGGERED

A new deployment has been triggered automatically. Check Netlify dashboard in 2-3 minutes to see:
- Build logs
- Function deployment status
- Any errors during build

**Build hook URL:** https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca

---

## SUPPORT RESOURCES

- **Netlify Scheduled Functions Docs:** https://docs.netlify.com/build/functions/scheduled-functions/
- **Netlify Functions Dashboard:** https://app.netlify.com → Your Site → Functions
- **Netlify Build Logs:** https://app.netlify.com → Your Site → Deploys → Latest Deploy
- **Supabase SQL Editor:** https://supabase.com/dashboard → Your Project → SQL Editor

---

## TROUBLESHOOTING COMMON ERRORS

### Error: "Function not found"
**Cause:** Functions not deployed during build
**Fix:** Check build logs for esbuild errors, ensure TypeScript is compiling

### Error: "Missing environment variable"
**Cause:** Environment variables not set in Netlify
**Fix:** Add variables in Netlify dashboard, redeploy

### Error: "MetaAPI 401 Unauthorized"
**Cause:** Invalid METAAPI_TOKEN or expired token
**Fix:** Get new token from MetaAPI dashboard, update in Netlify

### Error: "Supabase connection failed"
**Cause:** Invalid SUPABASE_SERVICE_ROLE_KEY
**Fix:** Copy service role key from Supabase settings → API

### Error: "Function timeout"
**Cause:** Function taking too long (> 26s for price collector, > 60s for aggregator)
**Fix:** Check MetaAPI account health, verify network connectivity

---

**Ready to diagnose? Go through Steps 1-6 and report what you find!**
