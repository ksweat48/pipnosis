# Netlify Environment Variable Fix

## Problem Identified

The console errors showing HTTP 500 for `stream-prices` and `get-live-price` functions were caused by:

1. **Case-sensitivity issue**: `SUPABASE_SERVICE_ROLE_Key` (with lowercase 'ey') instead of `SUPABASE_SERVICE_ROLE_KEY` (all caps)
2. **Code inconsistency**: `function-logger.js` was using `SUPABASE_URL` instead of `VITE_SUPABASE_URL`

## Code Changes Applied ✅

1. **Fixed `function-logger.js`**: Changed `process.env.SUPABASE_URL` to `process.env.VITE_SUPABASE_URL`
2. **Updated `netlify.toml`**: Added explicit timeout configurations for all serverless functions
3. **Build verified**: Project builds successfully

## Required Netlify Dashboard Actions

### Critical Fix Required

In your Netlify dashboard (Site Settings > Environment Variables):

**1. Fix the case-sensitivity issue:**
   - Find: `SUPABASE_SERVICE_ROLE_Key`
   - Delete it
   - Re-add it as: `SUPABASE_SERVICE_ROLE_KEY` (all uppercase KEY)
   - Value: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56aXNneGRseWRpaGx3c3ZvbmZ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTU5NTU0MCwiZXhwIjoyMDc1MTcxNTQwfQ.Bas3dKkvMSzBPAK4zUJ24JC-T0-bcLQeJ458KYv-X5U`

**2. Verify all other variables are correctly named:**

Your Netlify environment should have these exact variable names:
- ✅ `ADMIN_REFRESH_KEY`
- ✅ `METAAPI_ACCOUNT_ID`
- ✅ `METAAPI_ADMIN_TOKEN`
- ✅ `METAAPI_REGION`
- ✅ `OPENAI_API_KEY`
- ✅ `SITE_BASE_URL`
- ✅ `SUPABASE_ANON_KEY`
- ❌ `SUPABASE_SERVICE_ROLE_Key` → Change to `SUPABASE_SERVICE_ROLE_KEY`
- ✅ `VITE_SUPABASE_URL`

### After Making Changes

1. Save the environment variable changes in Netlify
2. Trigger a new deployment (or push code changes to trigger auto-deploy)
3. Wait for deployment to complete (~2-3 minutes)
4. Test the functions:
   ```bash
   curl https://pipnosis.com/.netlify/functions/get-live-price?symbol=EURUSD
   ```
   Should return price data instead of "Supabase not configured" error

## What Was Fixed

### File: `netlify/functions/function-logger.js`
```diff
- const supabaseUrl = process.env.SUPABASE_URL;
+ const supabaseUrl = process.env.VITE_SUPABASE_URL;
```

### File: `netlify.toml`
Added explicit timeout configurations:
```toml
[functions."stream-prices"]
  timeout = 540

[functions."get-live-price"]
  timeout = 26

[functions."get-metaapi-token"]
  timeout = 26

[functions."connection-health"]
  timeout = 26
```

## Why This Matters

Environment variables in serverless functions are **case-sensitive**. When the functions tried to access:
- `process.env.SUPABASE_SERVICE_ROLE_KEY`

But Netlify had:
- `SUPABASE_SERVICE_ROLE_Key` (wrong case)

The variable was `undefined`, causing the "Supabase not configured" error, which prevented all MetaAPI operations from running.

## Expected Result

After fixing the environment variable name in Netlify:
- ✅ `stream-prices` function will connect successfully
- ✅ `get-live-price` function will return real-time prices
- ✅ Console errors will disappear
- ✅ Live price streaming will work
- ✅ Charts will update in real-time

## Testing After Deploy

1. Open browser console
2. Look for these success messages:
   - `✅ MetaAPI connection verified successfully`
   - `[RealtimePriceStream] Stream connected`
   - `✅ Started live feed polling for EURUSD M5`

3. Verify no more 500 errors for:
   - `/.netlify/functions/stream-prices`
   - `/.netlify/functions/get-live-price`
