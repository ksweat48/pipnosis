# Deployment Checklist: MetaAPI Gateway Timeout Fix

## Pre-Deployment Verification

### ✅ Code Changes Complete
- [x] Updated `netlify/functions/metaapi-utils.js` with optimized timeouts
- [x] Added token caching to `netlify/functions/get-metaapi-token.js`
- [x] Updated `netlify/functions/test-metaapi-token.js` with new messages
- [x] Added `@supabase/supabase-js` to `netlify/functions/package.json`
- [x] Reduced function timeouts in `netlify.toml`
- [x] Updated test UI in `src/pages/TestMetaApiToken.tsx`
- [x] Created database migration `add_metaapi_token_cache`

### ✅ Build Status
```bash
npm run build
# Status: PASSING ✅
# Build time: ~13 seconds
# No errors or warnings
```

### ✅ Dependencies Installed
```bash
cd netlify/functions && npm install
# Status: COMPLETE ✅
# Packages: 229 installed
# Supabase client: Included
```

## Deployment Steps

### Step 1: Review Environment Variables ⏳
Verify these are set in Netlify dashboard:

**Required:**
- [ ] `METAAPI_ADMIN_TOKEN` - Your MetaAPI admin token
- [ ] `VITE_METAAPI_ACCOUNT_ID` - Your MetaAPI account ID
- [ ] `VITE_METAAPI_REGION` - MetaAPI region (e.g., "new-york")
- [ ] `VITE_SUPABASE_URL` - Your Supabase project URL
- [ ] `VITE_SUPABASE_ANON_KEY` - Your Supabase anon key

**How to Check:**
1. Go to Netlify Dashboard
2. Select your site
3. Go to Site Settings > Environment Variables
4. Verify all variables are present and correct

### Step 2: Deploy Database Migration ⏳

**Option A: Via Supabase Dashboard**
1. Go to Supabase Dashboard → SQL Editor
2. The migration has already been applied ✅
3. Verify table exists:
   ```sql
   SELECT * FROM metaapi_token_cache LIMIT 5;
   ```

**Option B: Verify via CLI**
```bash
# If using Supabase CLI
supabase db push
```

### Step 3: Deploy to Netlify ⏳

**Option A: Using Build Hook (Recommended)**
```bash
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

**Option B: Git Push (Auto-Deploy)**
```bash
git add .
git commit -m "Fix: MetaAPI gateway timeout with token caching and optimized timeouts"
git push origin main
```

**Wait for deployment:**
- Monitor build logs in Netlify dashboard
- Typical deployment time: 2-3 minutes
- Look for "Published" status

### Step 4: Post-Deployment Verification ⏳

**Test 1: Basic Connectivity**
- [ ] Navigate to https://pipnosis.com
- [ ] Verify site loads without errors
- [ ] Check browser console for errors

**Test 2: Token Generation Test (First Run)**
- [ ] Navigate to https://pipnosis.com/test-metaapi
- [ ] Click "Run MetaAPI Token Test"
- [ ] **Expected**: Completes in 20-25 seconds
- [ ] **Expected**: All 5 steps should pass
- [ ] **Expected**: Token shown with prefix and length

**Test 3: Token Generation Test (Second Run - Cache Test)**
- [ ] Click "Run MetaAPI Token Test" again
- [ ] **Expected**: Completes in <1 second
- [ ] **Expected**: All steps pass immediately
- [ ] **Expected**: Token retrieved from cache

**Test 4: Check Netlify Function Logs**
- [ ] Go to Netlify Dashboard → Functions
- [ ] Select `get-metaapi-token` function
- [ ] Check recent logs for:
  ```
  ✓ Found cached token for [account_id]
  ✓ Using cached token for account [account_id]
  ```

**Test 5: Verify Cache in Database**
```sql
-- Run in Supabase SQL Editor
SELECT
  account_id,
  region,
  expires_at,
  is_valid,
  created_at,
  validity_hours
FROM metaapi_token_cache
ORDER BY created_at DESC
LIMIT 5;
```
- [ ] Should see at least 1 cached token
- [ ] `is_valid` should be `true`
- [ ] `expires_at` should be ~1 hour in future

## Success Criteria

### ✅ All Tests Passing
- [x] Project builds successfully
- [ ] Token test completes (first run: 20-25s)
- [ ] Token test completes (second run: <1s)
- [ ] No HTTP 504 errors
- [ ] Cache entries in database

### ✅ Performance Metrics
- [ ] First token generation: 5-25 seconds
- [ ] Cached token retrieval: <1 second
- [ ] Error rate: <5%
- [ ] Cache hit rate: >80% (after initial requests)

### ✅ User Experience
- [ ] No gateway timeout errors
- [ ] Clear error messages if issues occur
- [ ] Fast response times for cached tokens
- [ ] Test UI shows caching information

## Rollback Plan

If critical issues occur:

### Immediate Rollback
```bash
# Revert to previous deployment
# Via Netlify Dashboard: Deploys → Previous Deploy → Publish Deploy
```

### Code Rollback
```bash
git revert HEAD
git push origin main
```

### Database Rollback
```sql
-- Disable the cache table (don't drop, just stop using it)
UPDATE metaapi_token_cache SET is_valid = false;
```

## Monitoring (First 24 Hours)

### What to Watch

**Netlify Function Logs:**
- Token generation times
- Cache hit/miss ratios
- Error rates and types

**Supabase Database:**
- Cache table size
- Token expiration patterns
- Query performance

**User Reports:**
- Token generation speed
- Any timeout errors
- Overall experience

### Alert Thresholds
- 🚨 Error rate >10%: Investigate immediately
- ⚠️ Cache hit rate <50%: Check caching logic
- ⚠️ Average response time >5s: Check MetaAPI status

## Troubleshooting Guide

### Issue: Test Still Timing Out

**Check:**
1. Verify Supabase credentials in Netlify env vars
2. Check MetaAPI admin token is valid
3. Review function logs for specific errors
4. Test Supabase connection manually

**Solution:**
- May need to increase aggressive timeout to 25s
- Check if MetaAPI service is down
- Verify region setting is correct

### Issue: Tokens Not Being Cached

**Check:**
1. Database table exists and is accessible
2. User has admin role in `user_profiles`
3. RLS policies are correctly applied
4. Function logs show cache attempts

**Solution:**
- Verify admin user setup
- Check RLS policies with `\d+ metaapi_token_cache`
- Test insert manually in SQL editor

### Issue: Stale Cached Tokens

**Check:**
1. Token expiration trigger is working
2. Tokens are 1 hour old or less
3. `is_valid` flag is correct

**Solution:**
```sql
-- Manual cleanup
UPDATE metaapi_token_cache
SET is_valid = false
WHERE expires_at < now();
```

## Next Steps After Successful Deployment

1. **Monitor for 24 hours**: Watch logs and metrics
2. **Gather feedback**: Check user experience
3. **Document patterns**: Note cache hit rates and timings
4. **Plan enhancements**: Consider multi-region fallback
5. **Update documentation**: Add any learnings

## Key Contacts

- **MetaAPI Support**: https://metaapi.cloud/support
- **Netlify Status**: https://www.netlifystatus.com/
- **Supabase Status**: https://status.supabase.com/

## Documentation References

- **Full Fix Details**: `/docs/fixes/GATEWAY_TIMEOUT_FIX_SUMMARY.md`
- **Quick Reference**: `/QUICK_FIX_REFERENCE.md`
- **Database Setup**: `/docs/setup/DATABASE_SETUP.md`
- **Netlify Config**: `/docs/setup/NETLIFY_CONFIGURATION_GUIDE.md`

---

## Deployment Status

- **Date**: October 23, 2025
- **Ready to Deploy**: ✅ YES
- **Build Status**: ✅ PASSING
- **Dependencies**: ✅ INSTALLED
- **Migration**: ✅ APPLIED
- **Risk Level**: 🟢 LOW (includes rollback plan)

**Deployment Command:**
```bash
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```
