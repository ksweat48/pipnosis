# Server-Side Polling Diagnostic Guide

**Date**: 2025-12-02
**Status**: ✅ Monitoring System Deployed
**Priority**: CRITICAL

## Problem

User reported that when the browser/page is closed, data collection stops. This indicates server-side polling may not be running.

## Expected Architecture

### Server-Side (Should Run 24/7 - Even When Browser Closed)

**Netlify Scheduled Functions** (configured in `netlify.toml`)

1. **continuous-price-collector**
   - Schedule: `* * * * *` (every minute)
   - Purpose: Fetches live prices from MetaAPI and saves to `realtime_prices` table
   - Source tag: `netlify_continuous_collector`
   - File: `netlify/functions/continuous-price-collector.ts`

2. **continuous-candle-aggregator**
   - Schedule: `*/5 * * * *` (every 5 minutes)
   - Purpose: Aggregates ticks into candles
   - File: `netlify/functions/continuous-candle-aggregator.ts`

3. **fill-candle-gaps**
   - Schedule: `*/5 * * * *` (every 5 minutes)
   - Purpose: Fills missing candle data
   - File: `netlify/functions/fill-candle-gaps.ts`

### Browser-Side (Only When Page Open)

- `global-polling-coordinator` - Reads from `realtime_prices` for display
- `background-candle-aggregator` - Monitors server-side health
- `chart-candle-poller` - Polls for chart updates

## How to Diagnose

### Step 1: Check Server-Side Function Health

1. Open the app and log in as admin
2. Navigate to **Admin Dashboard** → **Data Management** tab
3. Look at the **Server-Side Polling Monitor** section at the top
4. Check the status of `continuous-price-collector`:
   - 🟢 **Active**: Last execution < 120s ago (GOOD)
   - 🟡 **Stale**: Last execution 120-300s ago (WARNING)
   - 🔴 **Dead**: Last execution > 300s ago (ERROR)
   - ⚪ **Unknown**: No data found (CRITICAL - function not running)

### Step 2: Check Data Sources

In the same monitor, check "Data Sources (Last 5 Minutes)":

**Expected to see:**
- `netlify_continuous_collector` - If server-side is working
- Other browser-based sources - If only browser is collecting

**If you ONLY see browser sources**, server-side functions are NOT running.

### Step 3: Verify Netlify Scheduled Functions

#### Check in Netlify Dashboard:

1. Go to https://app.netlify.com
2. Select your site
3. Navigate to **Functions** in the left sidebar
4. Look for **Scheduled Functions** section
5. Verify these functions are listed and active:
   - `continuous-price-collector`
   - `continuous-candle-aggregator`
   - `fill-candle-gaps`

#### Check Function Logs:

1. In Netlify dashboard → **Functions**
2. Click on `continuous-price-collector`
3. View **Function log**
4. Look for recent executions (should be every minute)
5. Check for errors or warnings

### Step 4: Verify Environment Variables

In Netlify dashboard → **Site settings** → **Environment variables**, verify these exist:

Required:
- `METAAPI_TOKEN` - Your MetaAPI authentication token
- `METAAPI_ACCOUNT_ID` - Your MetaAPI account ID
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (NOT anon key)
- `VITE_SUPABASE_URL` - Your Supabase project URL

Optional:
- `METAAPI_REGION` - Defaults to 'new-york'

### Step 5: Manual Function Test

You can manually trigger the function to test:

```bash
curl -X POST https://YOUR-SITE.netlify.app/.netlify/functions/continuous-price-collector
```

Expected response:
```json
{
  "success": true,
  "executionId": "exec_1733097600000",
  "pricesCollected": 5,
  "pricesFailed": 0,
  "durationMs": 1234,
  "timestamp": "2025-12-02T10:00:00.000Z",
  "symbols": ["XAUUSD", "US30", "EURUSD", "GBPUSD", "USDJPY"]
}
```

### Step 6: Database Verification

Query the database directly:

```sql
-- Check recent data from server-side collector
SELECT
  source,
  symbol,
  created_at,
  EXTRACT(EPOCH FROM (NOW() - created_at))::int AS age_seconds
FROM realtime_prices
WHERE source = 'netlify_continuous_collector'
ORDER BY created_at DESC
LIMIT 10;
```

Expected: Rows with `age_seconds` less than 120 seconds.

## Common Issues and Solutions

### Issue 1: No Server-Side Data Found

**Symptoms:**
- Monitor shows "Unknown" status
- Only browser sources visible
- Data stops when browser closes

**Causes:**
1. Netlify plan doesn't include scheduled functions (requires Pro plan or higher)
2. Functions not deployed correctly
3. Environment variables missing

**Solutions:**

1. **Check Netlify Plan:**
   - Scheduled functions require Pro plan ($19/month) or higher
   - Free tier does NOT support scheduled functions
   - Upgrade if needed: Netlify dashboard → Billing

2. **Redeploy Functions:**
   ```bash
   # Trigger a new deployment
   git push origin main
   # Or use build hook
   curl -X POST -d '{}' https://api.netlify.com/build_hooks/YOUR_HOOK_ID
   ```

3. **Add Missing Environment Variables:**
   - Go to Netlify dashboard → Site settings → Environment variables
   - Add all required variables
   - Redeploy site after adding

### Issue 2: Functions Failing Silently

**Symptoms:**
- Functions are scheduled but not executing
- Error logs show authentication failures

**Solutions:**

1. **Check MetaAPI Credentials:**
   - Verify `METAAPI_TOKEN` is valid and not expired
   - Test token: https://metaapi.cloud/docs/client/
   - Regenerate if needed

2. **Check Supabase Credentials:**
   - Verify `SUPABASE_SERVICE_ROLE_KEY` (not anon key!)
   - Ensure service role has INSERT permissions on `realtime_prices`

3. **Check Function Timeout:**
   - Current timeout: 26 seconds
   - If MetaAPI is slow, may need to increase
   - Edit `netlify.toml`: `timeout = 60`

### Issue 3: Data Stale But Function Running

**Symptoms:**
- Monitor shows "Stale" status
- Data is 2-5 minutes old
- Functions appear to be running

**Solutions:**

1. **Check Market Hours:**
   - Forex market closed? No new prices available
   - Check market status in app

2. **Check MetaAPI Rate Limits:**
   - Free tier: 100 requests/day
   - May be rate limited
   - Upgrade MetaAPI plan if needed

3. **Verify Symbol Availability:**
   - Some symbols may not have live quotes
   - Check MetaAPI dashboard for symbol status

### Issue 4: Browser-Side Polling Working, Server-Side Not

**Symptoms:**
- Data flows when browser is open
- Data stops when browser closes
- Server shows no recent data

**This is the EXACT issue reported** - means scheduled functions aren't running.

**Root Cause:**
- Netlify scheduled functions NOT active
- Most likely cause: Free tier limitation

**Solution:**
1. Verify Netlify plan supports scheduled functions
2. If on free tier, upgrade to Pro plan
3. Alternative: Use Supabase Edge Functions with pg_cron (see below)

## Alternative Solution: Supabase Edge Functions

If Netlify scheduled functions aren't available, use Supabase:

### Advantages:
- Included in Supabase free tier
- More reliable for background jobs
- Direct database access (lower latency)

### Implementation:
1. Move polling logic to Supabase Edge Functions
2. Use `pg_cron` extension for scheduling
3. Configure in Supabase dashboard

See: `supabase/functions/` directory for existing edge functions

## Monitoring Best Practices

1. **Check Server-Side Monitor Daily:**
   - Should always show "Active" status
   - Data should be continuous

2. **Set Up Alerts:**
   - Use Netlify's function monitoring
   - Alert if functions fail repeatedly

3. **Verify After Deployment:**
   - Check monitor after each deployment
   - Ensure functions are still scheduled

4. **Close Browser Test:**
   - Close all browser windows
   - Wait 5 minutes
   - Reopen and check if new data appeared
   - If yes → Server-side working ✅
   - If no → Server-side NOT working ❌

## Testing Procedure

To verify server-side persistence is working:

1. **Baseline Check:**
   - Open Admin Dashboard → Data Management
   - Note the timestamp of last server-side data collection

2. **Close Browser:**
   - Close ALL browser windows/tabs
   - Wait exactly 5 minutes

3. **Reopen and Verify:**
   - Open Admin Dashboard → Data Management
   - Check Server-Side Polling Monitor
   - Should see 5 new data points (1 per minute)
   - Source should be `netlify_continuous_collector`

4. **Check Charts:**
   - Navigate to Charts page
   - Should see continuous data (no gaps)
   - If there's a 5-minute gap during your test = FAIL

## Success Criteria

✅ **Server-side polling is working when:**
- Monitor shows "Active" status
- Last execution < 120 seconds ago
- Data source = `netlify_continuous_collector`
- New data appears even when browser is closed
- Charts show continuous data with no gaps

❌ **Server-side polling is NOT working when:**
- Monitor shows "Unknown" or "Dead" status
- Only browser-based sources visible
- Data stops when browser closes
- Charts show gaps during closed browser periods

## Support Resources

1. **Netlify Scheduled Functions Docs:**
   https://docs.netlify.com/functions/scheduled-functions/

2. **Check Netlify Status:**
   https://www.netlifystatus.com/

3. **MetaAPI Status:**
   https://metaapi.cloud/status

4. **Supabase Status:**
   https://status.supabase.com/

## Next Steps

1. **Open the app and check the Server-Side Polling Monitor**
2. **Verify the status - is it Active, Stale, or Unknown?**
3. **If Unknown:**
   - Check Netlify dashboard for scheduled functions
   - Verify your Netlify plan supports scheduled functions
   - Check environment variables are set
   - Check function logs for errors
4. **If Active:**
   - Do the browser close test
   - Verify data persists while browser is closed
5. **Report findings so we can fix the root cause**

---

**Key Point**: The system is DESIGNED for persistence. If it's not working, it means the Netlify scheduled functions aren't running, most likely due to plan limitations or deployment issues. The monitoring component added in this update will help diagnose the exact issue.
