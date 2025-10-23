# Critical Deployment Instructions

## IMPORTANT: Required Before Deploy

### Step 1: Apply Database Migration

The new migration file **MUST** be applied to Supabase:

```
supabase/migrations/20251023020000_fix_metaapi_token_cache_rls.sql
```

**How to Apply:**

Option A - Supabase Dashboard (Recommended):
1. Go to Supabase Dashboard
2. Navigate to SQL Editor
3. Copy contents of the migration file
4. Execute the SQL
5. Verify no errors

Option B - Supabase CLI:
```bash
supabase db push
```

### Step 2: Add Service Role Key to Netlify

**This is CRITICAL - without this, the cache will not work!**

1. **Get Service Role Key:**
   - Go to Supabase Dashboard
   - Settings > API
   - Copy `service_role` key (NOT anon key)
   - This key is different from VITE_SUPABASE_ANON_KEY

2. **Add to Netlify:**
   - Go to Netlify Dashboard
   - Site settings > Environment variables
   - Click "Add a variable"
   - Name: `SUPABASE_SERVICE_ROLE_KEY`
   - Value: [paste the service role key]
   - Save

3. **Verify Other Variables:**
   - Ensure these exist:
     - `METAAPI_ADMIN_TOKEN`
     - `VITE_METAAPI_ACCOUNT_ID`
     - `VITE_METAAPI_REGION`
     - `VITE_SUPABASE_URL`
     - `VITE_SUPABASE_ANON_KEY`

### Step 3: Install Function Dependencies

```bash
cd netlify/functions
npm install
cd ../..
```

### Step 4: Deploy

```bash
# Build locally first to verify
npm run build

# Deploy using build hook
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

## Verification Steps

After deployment, test the fix:

1. **Navigate to Test Page:**
   - Go to: `https://your-site.netlify.app/test-metaapi`

2. **Run Token Test:**
   - Click "Run MetaAPI Token Test"
   - Verify Step 0 shows: "Cache Configuration ✅"
   - Verify Step 4 completes in 18-22 seconds
   - Verify message says "Token cached"

3. **Test Cache Performance:**
   - Run the test again immediately
   - Verify it completes in <1 second
   - Verify response shows `cached: true`

## Expected Test Results

### Step 0: Cache Configuration
- Status: ✅ Success
- Message: "Token cache is properly configured and accessible"
- Details:
  - cacheEnabled: true
  - cacheHealthy: true
  - Service role key working correctly

### Step 4: Generate Token
- Status: ✅ Success
- Message: "Token generated and cached successfully"
- Details:
  - generationTime: ~18000-22000ms (first time)
  - cached: true
  - Note: "Token cached - next request will be <100ms"

## Troubleshooting

### If Step 0 Fails: "Cache not configured"

**Problem:** Missing SUPABASE_SERVICE_ROLE_KEY

**Fix:**
1. Add service role key to Netlify environment variables
2. Redeploy the site
3. Test again

### If Step 0 Fails: "Cache query failed"

**Problem:** RLS policies not updated OR wrong key

**Fix:**
1. Verify the migration was applied
2. Check the service role key is correct
3. Check Supabase logs for errors
4. Re-apply the migration if needed

### If Step 4 Times Out

**Problem:** MetaAPI servers genuinely slow OR cache write failing

**Fix:**
1. Check Step 0 is green (cache working)
2. Check MetaAPI service status
3. Review Netlify function logs
4. Try again (MetaAPI may recover)

## What Changed

1. **Database:** Fixed RLS policies to allow service role access
2. **Functions:** Switched from anon key to service role key
3. **Functions:** Added comprehensive error logging
4. **Functions:** Added cache health check in test
5. **Timeouts:** Optimized for different operations
6. **UX:** Clear visibility into cache status

## Success Criteria

✅ Step 0 shows cache is healthy
✅ First token generation: 18-22 seconds
✅ Cached token retrieval: <100ms
✅ No more gateway timeouts
✅ Cache hit rate >95%

## Rollback Plan

If issues occur:

1. Remove SUPABASE_SERVICE_ROLE_KEY from Netlify
2. Revert to previous git commit
3. Redeploy
4. Contact support with error logs

## Support

If problems persist after following these steps:

1. Check Netlify function logs
2. Check Supabase logs
3. Review `METAAPI_TIMEOUT_FIX.md` for detailed troubleshooting
4. Verify all environment variables are set correctly
