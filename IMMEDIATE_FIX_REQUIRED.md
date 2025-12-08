# 🚨 IMMEDIATE FIX REQUIRED - Environment Variables Missing

## ✅ GOOD NEWS: Functions Are Deployed!

**Test Results:**
```
continuous-price-collector: HTTP 500 (Internal Error)
continuous-candle-aggregator: HTTP 500 (Internal Error)
```

**What This Means:**
- ✅ Functions ARE deployed to Netlify
- ✅ TypeScript IS being compiled correctly
- ✅ Netlify IS trying to execute them
- ❌ Functions are CRASHING because environment variables are missing

**This is EASY TO FIX!**

---

## 🔧 THE FIX (5 Minutes)

### Go to Netlify Dashboard and Add Environment Variables:

1. **Open Netlify Dashboard:**
   - https://app.netlify.com
   - Select your **Pipnosis** site
   - Click **Site configuration** (left sidebar)
   - Click **Environment variables**

2. **Add These Variables:**

Copy these from your local `.env` file and paste into Netlify:

```
Variable Name: VITE_SUPABASE_URL
Value: [Copy from your .env file]

Variable Name: SUPABASE_SERVICE_ROLE_KEY
Value: [Copy from your .env file - starts with eyJhbGciOi...]

Variable Name: METAAPI_TOKEN
Value: [Copy from your .env file]

Variable Name: METAAPI_ACCOUNT_ID
Value: [Copy from your .env file]

Variable Name: METAAPI_REGION
Value: london
```

3. **Important:** After adding ALL variables, click **"Save"**

4. **Trigger Redeploy:**
   - Go to **Deploys** tab
   - Click **"Trigger deploy"** → **"Deploy site"**
   - Wait 2-3 minutes for deployment to complete

---

## 📋 COPY YOUR ENV VARS (Quick Reference)

**Your Local .env File Location:**
```
/tmp/cc-agent/58035261/project/.env
```

**To view your local values:**
```bash
cat .env | grep -E "VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|METAAPI_TOKEN|METAAPI_ACCOUNT_ID|METAAPI_REGION"
```

---

## ✅ VERIFICATION (After Adding Variables)

**Wait 3-4 minutes after deployment, then test:**

### Test 1: Check Functions Respond Successfully
```bash
# Should return {"success": true, ...} instead of 500 error
curl https://pipnosis.com/.netlify/functions/continuous-price-collector

curl https://pipnosis.com/.netlify/functions/continuous-candle-aggregator
```

### Test 2: Check Netlify Function Logs
1. Netlify Dashboard → **Functions** → **continuous-price-collector**
2. Click **"Logs"** tab
3. You should see execution logs like:
   ```
   [PriceCollector:exec_123] 🚀 Starting continuous price collection...
   [PriceCollector:exec_123] ✅ Completed in 1234ms: 5 prices saved
   ```

### Test 3: Check Database for New Data
Run this in **Supabase SQL Editor:**
```sql
SELECT
  symbol,
  bid,
  ask,
  created_at,
  source
FROM realtime_prices
WHERE created_at > NOW() - INTERVAL '5 minutes'
ORDER BY created_at DESC
LIMIT 20;
```

**Expected:** New rows with `source='netlify_continuous_collector'`

### Test 4: THE ULTIMATE TEST
1. **Close your browser completely**
2. **Wait 15 minutes**
3. **Reopen browser and check chart**
4. **✅ Success if:** Chart has new candles from while you were gone
5. **❌ Still broken if:** No new candles during browser-closed period

---

## 🎯 EXPECTED BEHAVIOR ONCE FIXED

**Every 1 Minute (Price Collector):**
- Netlify runs `continuous-price-collector`
- Fetches live prices from MetaAPI (EURUSD, XAUUSD, US30, GBPUSD, USDJPY)
- Saves to `realtime_prices` table
- Continues even when browser is closed

**Every 5 Minutes (Candle Aggregator):**
- Netlify runs `continuous-candle-aggregator`
- Reads prices from `realtime_prices` table
- Aggregates into candles (M1, M5, M15, M30, H1, H4, D1, W1)
- Saves to `forex_candles` table
- Backfills any missing candles from last 24 hours
- Continues even when browser is closed

**Result:**
- ✅ 24/7 data collection (except weekends)
- ✅ No gaps in charts
- ✅ Browser-independent operation
- ✅ Always have fresh data when you open the app

---

## 🐛 TROUBLESHOOTING

### Still Getting 500 Errors After Adding Variables?

**Check Function Logs for Specific Error:**
1. Netlify Dashboard → Functions → continuous-price-collector → Logs
2. Look for error messages like:
   - `"MetaAPI 401 Unauthorized"` → Invalid METAAPI_TOKEN
   - `"Supabase connection failed"` → Invalid SUPABASE_SERVICE_ROLE_KEY
   - `"Missing environment variable"` → Variable not set correctly

### How to Get Fresh Credentials:

**Supabase Credentials:**
1. https://supabase.com/dashboard
2. Select your project
3. Settings → API
4. Copy:
   - **Project URL** → Use for `VITE_SUPABASE_URL`
   - **service_role key** (secret) → Use for `SUPABASE_SERVICE_ROLE_KEY`

**MetaAPI Credentials:**
1. https://app.metaapi.cloud
2. Login
3. Copy your API token
4. Get account ID from your trading account

---

## 📊 HOW TO CHECK IF IT'S WORKING

### Option 1: Netlify Dashboard (Easiest)

1. Go to: https://app.netlify.com → Your Site → **Functions**
2. Look at **"Invocations"** column:
   - `continuous-price-collector`: Should show invocations every minute
   - `continuous-candle-aggregator`: Should show invocations every 5 minutes
3. Click on function name → **Usage** tab
4. Graph should show steady activity

### Option 2: Database Check (Most Reliable)

**Check for continuous price collection:**
```sql
SELECT
  COUNT(*) as total_prices,
  MAX(created_at) as most_recent,
  MIN(created_at) as oldest,
  COUNT(DISTINCT symbol) as symbols
FROM realtime_prices
WHERE created_at > NOW() - INTERVAL '1 hour'
  AND source = 'netlify_continuous_collector';
```

**Expected Result:**
- `total_prices`: ~300 (5 symbols × 60 minutes)
- `most_recent`: Within last 1-2 minutes
- `symbols`: 5

**Check for continuous candle aggregation:**
```sql
SELECT
  symbol,
  timeframe,
  COUNT(*) as candle_count,
  MAX(open_time) as latest_candle
FROM forex_candles
WHERE open_time > NOW() - INTERVAL '1 hour'
  AND data_source = 'netlify_aggregator'
GROUP BY symbol, timeframe
ORDER BY symbol, timeframe;
```

**Expected Result:**
- Each symbol should have candles for all timeframes (M1, M5, M15, M30, H1, H4)
- `latest_candle` should be within last 5-10 minutes
- No gaps in candle sequences

### Option 3: Browser Console (Quick Check)

Open browser console and run:
```javascript
// Check server-side aggregation status
fetch('/.netlify/functions/continuous-candle-aggregator')
  .then(r => r.json())
  .then(data => {
    console.log('Server-side aggregation:', data.success ? '✅ WORKING' : '❌ FAILED');
    console.log('Candles created:', data.candlesCreated);
  });
```

---

## 🚀 QUICK START COMMANDS

**Add all environment variables at once (from your terminal):**

1. First, show your local .env values:
```bash
cat .env
```

2. Then manually add each one to Netlify dashboard

**OR use Netlify CLI (if installed):**
```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login
netlify login

# Link to your site
netlify link

# Set environment variables
netlify env:set VITE_SUPABASE_URL "your-value-here"
netlify env:set SUPABASE_SERVICE_ROLE_KEY "your-value-here"
netlify env:set METAAPI_TOKEN "your-value-here"
netlify env:set METAAPI_ACCOUNT_ID "your-value-here"
netlify env:set METAAPI_REGION "london"

# Trigger redeploy
netlify deploy --prod
```

---

## ⏱️ TIMELINE

- **Immediate:** Add environment variables (5 minutes)
- **+2-3 minutes:** Deployment completes
- **+1 minute:** First price collection runs
- **+5 minutes:** First candle aggregation runs
- **+15 minutes:** Verify continuous operation with browser closed

**Total time to fix: ~25 minutes including verification**

---

## 💡 WHY THIS HAPPENED

**Your scheduled functions were configured correctly but couldn't access:**
- Supabase database (no SUPABASE_SERVICE_ROLE_KEY)
- MetaAPI (no METAAPI_TOKEN)
- Function crashed immediately with 500 error

**Local .env file ≠ Netlify environment variables**
- `.env` file only works locally
- Netlify needs variables set in dashboard
- This is a security feature (keeps secrets out of git)

---

## 📞 NEED HELP?

If you're still stuck after adding environment variables:

1. **Check Netlify Function Logs** - Will show exact error
2. **Check .env file** - Ensure values are correct
3. **Test MetaAPI connection** - Verify token is valid
4. **Test Supabase connection** - Verify service role key works

**Status check command:**
```bash
curl https://pipnosis.com/.netlify/functions/polling-health
```

---

**Next Step: Add environment variables to Netlify Dashboard NOW!**

https://app.netlify.com → Your Site → Site configuration → Environment variables
