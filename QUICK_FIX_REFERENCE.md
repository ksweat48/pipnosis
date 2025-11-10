# Quick Fix Reference - Price Polling Issue

## What Was Fixed

### 1. Frontend Error
**Error:** `TypeError: nt.startStatusLogging is not a function`
- **Fixed:** Removed invalid method call from `src/App.tsx`
- **Status:** ✅ Complete

### 2. Database Cron Error
**Error:** `unrecognized configuration parameter "app.settings.supabase_url"`
- **Fixed:** Created migration to fix the `invoke_continuous_price_poller()` function
- **Status:** ✅ Complete

### 3. Price Data Staleness
**Issue:** Prices are 54+ minutes old
- **Cause:** MetaAPI credentials not configured in Supabase Edge Functions
- **Status:** ⚠️ Requires manual configuration

---

## CRITICAL: Complete the Fix

To get live price data flowing, you must add MetaAPI credentials to Supabase:

### Step 1: Go to Supabase Dashboard
URL: https://supabase.com/dashboard/project/nzisgxdlydihlwsvonfy

### Step 2: Navigate to Edge Functions Settings
Dashboard → Edge Functions → Settings → Secrets

### Step 3: Add Three Secrets

| Secret Name | Value |
|-------------|-------|
| `METAAPI_TOKEN` | (See .env file or PRICE_POLLING_FIX_SUMMARY.md) |
| `METAAPI_ACCOUNT_ID` | `169ff8dd-bb46-4618-91b4-28f696fba223` |
| `METAAPI_REGION` | `london` |

### Step 4: Verify (Wait 2 Minutes)

Run this query in Supabase SQL Editor:

```sql
SELECT
  symbol,
  created_at,
  EXTRACT(EPOCH FROM (now() - created_at)) as age_seconds
FROM realtime_prices
ORDER BY created_at DESC
LIMIT 5;
```

**Expected:** `age_seconds` should be less than 60

---

## Quick Verification Commands

### Check Recent Prices
```sql
SELECT COUNT(*) as recent_count
FROM realtime_prices
WHERE created_at > now() - interval '2 minutes';
```
**Expected:** 5+ records (one per symbol per poll)

### Check Cron Health
```sql
SELECT
  successful_pairs,
  failed_pairs,
  error_message,
  created_at
FROM price_polling_health
ORDER BY created_at DESC
LIMIT 3;
```
**Expected:** `successful_pairs = 5`, `failed_pairs = 0`

---

## Deployment Status

- ✅ Code fixed and built successfully
- ✅ Migration applied to database
- 🚀 Netlify deployment triggered (check: https://app.netlify.com)
- ⚠️ **ACTION REQUIRED:** Add MetaAPI secrets to Supabase

---

## If Prices Still Don't Update

1. Check if market is open (Forex: Sun 5pm EST - Fri 5pm EST)
2. Verify MetaAPI account is active and not suspended
3. Check Edge Function logs in Supabase dashboard
4. Manually test: `curl -X POST "https://nzisgxdlydihlwsvonfy.supabase.co/functions/v1/continuous-price-poller?action=poll" -H "Authorization: Bearer [ANON_KEY]"`

---

## System is Working When

- ✅ No console errors about `startStatusLogging`
- ✅ No database errors in `price_polling_health` table
- ✅ `successful_pairs` = 5 in recent polling health records
- ✅ Fresh prices appearing in `realtime_prices` every 60 seconds
- ✅ Browser showing live price updates
