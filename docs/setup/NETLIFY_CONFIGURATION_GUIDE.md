# Netlify Environment Configuration Guide

## Critical Environment Variables for Production

This guide provides the exact steps to configure your Netlify deployment for the Pipnosis AI Trading Platform.

---

## Required Environment Variables

You must add these 6 environment variables in your Netlify dashboard for the data refresh functionality to work.

### How to Add Variables

1. Go to: https://app.netlify.com
2. Select your site: **pipnosis.com**
3. Navigate to: **Site configuration → Environment variables**
4. Click **"Add a variable"**
5. For each variable below:
   - Enter the **Key** (exact name)
   - Enter the **Value** (your specific value)
   - Select scopes: **All**, **Production**, **Deploy previews**, **Branch deploys**
   - Click **"Create variable"**

---

## Variable 1: VITE_SUPABASE_URL

**Purpose:** Supabase project URL for database connections

**Key:** `VITE_SUPABASE_URL`

**Value:** `https://xhunxrzwwaejancoquwd.supabase.co`

**Required:** ✅ Critical

---

## Variable 2: SUPABASE_SERVICE_ROLE_KEY

**Purpose:** Server-side database access with full permissions (used by Netlify functions)

**Key:** `SUPABASE_SERVICE_ROLE_KEY`

**Value:** Your Supabase service role key

**How to get this value:**
1. Go to: https://app.supabase.com/project/xhunxrzwwaejancoquwd/settings/api
2. Find section: **"Project API keys"**
3. Look for: **"service_role"** (NOT "anon public")
4. Click **"Reveal"** or copy icon
5. Copy the entire key (starts with `eyJ...`)

**Required:** ✅ Critical

**Security Warning:**
- This key has FULL database access
- NEVER commit this to git
- NEVER expose in client-side code
- Only use in Netlify Functions (server-side)

---

## Variable 3: VITE_METAAPI_TOKEN

**Purpose:** MetaAPI authentication token for MT5 data access

**Key:** `VITE_METAAPI_TOKEN`

**Value:** Your MetaAPI token

**How to get this value:**
1. Go to: https://app.metaapi.cloud
2. Navigate to: **Settings → API tokens**
3. Copy your existing token or create a new one

**Required:** ✅ Critical

---

## Variable 4: VITE_METAAPI_ACCOUNT_ID

**Purpose:** Your MetaAPI account ID for MT5 connection

**Key:** `VITE_METAAPI_ACCOUNT_ID`

**Value:** Your MetaAPI account ID

**How to get this value:**
1. Go to: https://app.metaapi.cloud
2. Navigate to: **Accounts**
3. Find your deployed MT5 account
4. Copy the **Account ID** (usually starts with a letter and numbers)

**Required:** ✅ Critical

---

## Variable 5: VITE_METAAPI_REGION

**Purpose:** MetaAPI server region for optimal performance

**Key:** `VITE_METAAPI_REGION`

**Value:** `new-york` (or your preferred region)

**Available regions:**
- `new-york` (default)
- `london`
- `singapore`
- `frankfurt`

**Required:** ⚠️ Optional (defaults to new-york if not set)

**Tip:** Use the region closest to your MT5 broker's server location

---

## Variable 6: ADMIN_REFRESH_KEY

**Purpose:** Secret key to protect the data refresh endpoint from unauthorized access

**Key:** `ADMIN_REFRESH_KEY`

**Value:** A strong random secret (generate one below)

**How to generate a secure key:**

Option 1 - Online generator:
1. Go to: https://www.random.org/strings/
2. Generate a 32-character string
3. Use alphanumeric characters

Option 2 - Command line (if you have OpenSSL):
```bash
openssl rand -hex 32
```

Option 3 - Node.js:
```javascript
require('crypto').randomBytes(32).toString('hex')
```

**Example value:** `a7b3c9d2e5f8a1b4c7d0e3f6a9b2c5d8e1f4a7b0c3d6e9f2a5b8c1d4e7f0a3b6`

**Required:** ✅ Critical

**Security Warning:**
- Keep this secret safe
- Never commit to git
- Never share publicly
- Rotate periodically

---

## After Adding All Variables

### Step 1: Verify Variables Are Set

1. In Netlify dashboard, go to: **Site configuration → Environment variables**
2. You should see all 6 variables listed:
   - ✅ VITE_SUPABASE_URL
   - ✅ SUPABASE_SERVICE_ROLE_KEY
   - ✅ VITE_METAAPI_TOKEN
   - ✅ VITE_METAAPI_ACCOUNT_ID
   - ✅ VITE_METAAPI_REGION
   - ✅ ADMIN_REFRESH_KEY

### Step 2: Trigger a New Deploy

**IMPORTANT:** Environment variables only take effect on NEW deploys!

Option 1 - Use build hook:
```bash
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

Option 2 - Manual trigger:
1. Go to: **Deploys**
2. Click: **Trigger deploy → Deploy site**

Option 3 - Push a commit:
```bash
git commit --allow-empty -m "chore: trigger deploy for env vars"
git push
```

### Step 3: Wait for Deploy to Complete

1. Monitor the deploy in Netlify dashboard
2. Wait for "Published" status
3. Check deploy logs for any errors

### Step 4: Test the Data Refresh Function

1. Open your admin dashboard: https://pipnosis.com/admin/dashboard
2. Open browser DevTools → Console
3. Click **"Batch Refresh All"** button
4. Watch for:
   - ✅ Console shows progress messages
   - ✅ Network tab shows 200 OK response (NOT 500)
   - ✅ Success notification appears
   - ✅ No error messages

### Step 5: Verify Data in Supabase

1. Go to: https://app.supabase.com/project/xhunxrzwwaejancoquwd/editor
2. Run this query:
```sql
SELECT
  symbol,
  timeframe,
  COUNT(*) as candle_count,
  MIN(time) as earliest_candle,
  MAX(time) as latest_candle
FROM historical_candles
GROUP BY symbol, timeframe
ORDER BY symbol, timeframe;
```
3. You should see data for multiple symbols and timeframes
4. Recent candles should be present (within last few hours)

---

## Troubleshooting

### Issue: Netlify Function Returns 500 Error

**Check:**
1. All 6 environment variables are set correctly
2. No typos in variable names (they are case-sensitive!)
3. Service role key is the SECRET key, not the anon public key
4. MetaAPI account is deployed and active
5. Check Netlify function logs:
   - Go to: **Site → Functions → refresh-candles**
   - Click **View logs**
   - Look for specific error messages

### Issue: "Missing Supabase configuration" Error

**Solution:**
- Verify `VITE_SUPABASE_URL` is set
- Verify `SUPABASE_SERVICE_ROLE_KEY` is set
- Redeploy after adding variables

### Issue: MetaAPI Connection Failed

**Check:**
1. Token is valid and not expired
2. Account ID is correct
3. Account is deployed in MetaAPI dashboard
4. Account status is "DEPLOYED" not "UNDEPLOYED"
5. Region matches your account's region

### Issue: "Unauthorized" or "Invalid admin key"

**Solution:**
- Verify `ADMIN_REFRESH_KEY` is set in Netlify
- Update your admin dashboard code to use the same key
- Key must match EXACTLY (case-sensitive)

### Issue: Database Constraint Violations

**Solution:**
- Verify you ran the market_analysis migration successfully
- Check table exists: `SELECT * FROM market_analysis LIMIT 1;`
- Check constraints: `SELECT * FROM pg_constraint WHERE conrelid = 'market_analysis'::regclass;`

---

## Security Best Practices

### DO:
✅ Store all secrets in Netlify environment variables only
✅ Use strong random keys for ADMIN_REFRESH_KEY
✅ Keep service role key secret and secure
✅ Rotate keys periodically (every 90 days)
✅ Use different keys for development and production
✅ Monitor function logs for suspicious activity

### DON'T:
❌ Commit secrets to git repository
❌ Share keys in chat, email, or screenshots
❌ Use service role key in client-side/browser code
❌ Use simple or guessable admin keys
❌ Expose admin endpoints publicly without authentication
❌ Log sensitive keys in console or error messages

---

## Quick Reference Card

Print this and keep it handy:

| Variable | Purpose | Where to Get It |
|----------|---------|-----------------|
| VITE_SUPABASE_URL | Database URL | Fixed: `https://xhunxrzwwaejancoquwd.supabase.co` |
| SUPABASE_SERVICE_ROLE_KEY | Server DB access | Supabase → Settings → API → service_role |
| VITE_METAAPI_TOKEN | MT5 auth | MetaAPI → Settings → API tokens |
| VITE_METAAPI_ACCOUNT_ID | MT5 account | MetaAPI → Accounts → Account ID |
| VITE_METAAPI_REGION | Server region | Choose: new-york / london / singapore |
| ADMIN_REFRESH_KEY | Endpoint protection | Generate random 32+ chars |

---

## Testing Checklist

After configuration, verify:

- [ ] All 6 environment variables added to Netlify
- [ ] New deploy triggered after adding variables
- [ ] Deploy completed successfully (no build errors)
- [ ] Admin dashboard loads without errors
- [ ] "Batch Refresh All" returns 200 OK
- [ ] Console shows no ReferenceError about marketHoursService
- [ ] Data appears in Supabase historical_candles table
- [ ] market_analysis table accepts data without constraint errors
- [ ] Charts display updated data
- [ ] No security warnings in browser console

---

## Support

If you encounter issues after following this guide:

1. Check Netlify function logs for detailed error messages
2. Check Supabase logs for database errors
3. Verify all variables are spelled correctly (case-sensitive)
4. Ensure you redeployed after adding variables
5. Test MetaAPI connection independently

**Common Resolution:** 90% of issues are resolved by:
- Double-checking variable names (exact spelling)
- Verifying service role key is correct (not anon key)
- Redeploying after adding variables

---

## Summary

Once all variables are configured and deployed:

✅ marketHoursService import error = FIXED
✅ Database schema constraint error = FIXED
✅ Netlify function 500 error = FIXED
✅ Data refresh functionality = WORKING
✅ Historical candles = FETCHING
✅ Admin dashboard = FUNCTIONAL

Your production deployment will be fully operational!
