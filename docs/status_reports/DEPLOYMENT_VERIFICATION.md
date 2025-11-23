# Deployment Verification Guide

## Deployment Status

✅ **Build completed successfully** - All files compiled without errors
✅ **Netlify deployment triggered** - Build hook invoked at 2025-11-21

---

## Wait Time

**Please wait 3-5 minutes** for Netlify to:
1. Pull latest code from repository
2. Install dependencies
3. Build the project
4. Deploy functions
5. Activate scheduled functions

---

## Verification Steps (Run After 5 Minutes)

### 1. Check Polling Health

```bash
curl https://pipnosis.com/.netlify/functions/polling-health
```

**Expected Response:**
```json
{
  "success": true,
  "overallStatus": "healthy",
  "summary": {
    "totalSymbols": 5,
    "active": 5
  }
}
```

### 2. Test Price Collector Manually

```bash
curl -X POST https://pipnosis.com/.netlify/functions/continuous-price-collector
```

**Expected Response:**
```json
{
  "success": true,
  "pricesCollected": 5,
  "pricesFailed": 0
}
```

### 3. Check Database for New Prices

```sql
SELECT
  symbol,
  bid,
  source,
  created_at,
  EXTRACT(EPOCH FROM (NOW() - created_at)) as age_seconds
FROM realtime_prices
WHERE source = 'netlify_continuous_collector'
ORDER BY created_at DESC
LIMIT 10;
```

**Expected Results:**
- Source: `netlify_continuous_collector`
- Age: Less than 300 seconds (5 minutes)
- All 5 symbols present

### 4. Verify Candle Generation

```sql
SELECT
  symbol,
  timeframe,
  open_time,
  close,
  EXTRACT(EPOCH FROM (NOW() - open_time)) as age_seconds
FROM forex_candles
WHERE symbol IN ('XAUUSD', 'US30')
AND open_time > NOW() - INTERVAL '1 hour'
ORDER BY open_time DESC
LIMIT 20;
```

**Expected Results:**
- Fresh M1/M5 candles for XAUUSD and US30
- Candles within last hour

### 5. Check Netlify Function Logs

1. Go to https://app.netlify.com
2. Select your site
3. Navigate to **Functions** tab
4. Check `continuous-price-collector` logs
5. Look for successful executions

---

## Expected Timeline

| Time | Event |
|------|-------|
| T+0 | Deployment triggered |
| T+2 min | Build completes |
| T+3 min | Functions deployed |
| T+4 min | First scheduled run (price collector) |
| T+6 min | Second scheduled run |
| T+8 min | First candle aggregation run |

---

## Troubleshooting Commands

### Check if scheduled functions are running:

```bash
# Check price collector (runs every 2 minutes)
curl -X POST https://pipnosis.com/.netlify/functions/continuous-price-collector

# Check candle aggregator (runs every 5 minutes)
curl -X POST https://pipnosis.com/.netlify/functions/continuous-candle-aggregator

# Check gap filler (runs every 5 minutes)
curl -X POST https://pipnosis.com/.netlify/functions/fill-candle-gaps
```

### Verify environment variables are set:

If any function returns `500` or mentions missing environment variables:

1. Go to Netlify Dashboard → Site Settings → Environment Variables
2. Verify these are set:
   - `VITE_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `METAAPI_TOKEN`
   - `METAAPI_ACCOUNT_ID`
   - `METAAPI_REGION`
3. Re-deploy if you added any variables

---

## Success Indicators

✅ **System Healthy When:**
- Polling health shows "healthy" status
- All 5 symbols show "active" status
- Prices update every 2 minutes
- Candles generate every 5 minutes
- EURUSD price near 1.1538 (correct live price)
- Source shows `netlify_continuous_collector`

⚠️ **Action Required When:**
- Polling health shows "degraded" or "critical"
- Any symbols show "no_data" status
- Prices older than 5 minutes
- Source still shows old values

🔴 **Critical Issue When:**
- All symbols show "no_data"
- No prices in last 10 minutes
- Functions return 500 errors
- Environment variables missing

---

## Quick Health Check SQL

Run this single query to see everything:

```sql
WITH latest_prices AS (
  SELECT DISTINCT ON (symbol)
    symbol,
    bid,
    source,
    created_at,
    EXTRACT(EPOCH FROM (NOW() - created_at)) as age_seconds
  FROM realtime_prices
  ORDER BY symbol, created_at DESC
),
latest_candles AS (
  SELECT DISTINCT ON (symbol, timeframe)
    symbol,
    timeframe,
    open_time,
    close,
    EXTRACT(EPOCH FROM (NOW() - open_time)) as candle_age_seconds
  FROM forex_candles
  WHERE timeframe = 'M1'
  ORDER BY symbol, timeframe, open_time DESC
)
SELECT
  p.symbol,
  p.bid as current_price,
  p.source,
  ROUND(p.age_seconds) as price_age_sec,
  CASE
    WHEN p.age_seconds < 180 THEN 'ACTIVE'
    WHEN p.age_seconds < 600 THEN 'STALE'
    ELSE 'INACTIVE'
  END as price_status,
  c.close as latest_candle_close,
  ROUND(c.candle_age_seconds) as candle_age_sec,
  CASE
    WHEN c.candle_age_seconds < 120 THEN 'FRESH'
    WHEN c.candle_age_seconds < 600 THEN 'AGING'
    ELSE 'OLD'
  END as candle_status
FROM latest_prices p
LEFT JOIN latest_candles c ON p.symbol = c.symbol
ORDER BY p.symbol;
```

---

## Contact for Issues

If deployment verification fails:
1. Check Netlify build logs
2. Check Netlify function logs
3. Verify environment variables in Netlify dashboard
4. Re-trigger deployment if needed

---

**Next Check:** Wait 5 minutes, then run verification steps above
