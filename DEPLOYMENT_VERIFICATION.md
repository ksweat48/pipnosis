# MetaAPI Token Fix - Deployment Verification Checklist

## Pre-Deployment ✅ (Completed)
- [x] Removed non-existent `generateToken()` SDK method
- [x] Implemented `narrowDownTokenResources()` as single generation method
- [x] Optimized timeouts (14s per attempt, 25.7s function timeout)
- [x] Implemented cache-first token retrieval
- [x] Added emergency fallback for expired tokens
- [x] Updated test function with new response format
- [x] Simplified main token endpoint
- [x] Updated database migration with unique constraint
- [x] Build passed successfully
- [x] Deployment triggered via build hook

## Post-Deployment Verification (To Do)

### 1. Environment Variables Check
Verify these are set in Netlify dashboard:
```
- [ ] METAAPI_ADMIN_TOKEN (starts with "token:")
- [ ] VITE_METAAPI_ACCOUNT_ID (UUID format)
- [ ] VITE_METAAPI_REGION (e.g., "new-york")
- [ ] VITE_SUPABASE_URL (your Supabase project URL)
- [ ] SUPABASE_SERVICE_ROLE_KEY (service_role key from Supabase)
```

**Critical**: Without `SUPABASE_SERVICE_ROLE_KEY`, caching won't work!

### 2. Database Migration Check
Run in Supabase SQL Editor:
```sql
-- Verify cache table exists
SELECT table_name 
FROM information_schema.tables 
WHERE table_name = 'metaapi_token_cache';

-- Verify unique constraint exists
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'metaapi_token_cache';

-- Verify RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE tablename = 'metaapi_token_cache';

-- Check existing policies
SELECT policyname, cmd, qual 
FROM pg_policies 
WHERE tablename = 'metaapi_token_cache';
```

Expected results:
- Table exists
- Unique constraint on (account_id, region)
- RLS enabled
- Multiple policies including service role access

### 3. Test Token Generation
```bash
# Test endpoint (replace with your Netlify URL)
curl -X POST https://your-site.netlify.app/.netlify/functions/test-metaapi-token \
  -H "Content-Type: application/json" \
  -d '{}' | jq

# Expected on FIRST call:
# - Step 4 duration: ~14 seconds
# - source: "generated"
# - cached: false

# Expected on SECOND call (run immediately after first):
# - Step 4 duration: < 300ms
# - source: "cache"
# - cached: true
```

Checklist:
```
- [ ] First call completes in ~14 seconds
- [ ] First call returns source: "generated"
- [ ] Second call completes in < 300ms
- [ ] Second call returns source: "cache"
- [ ] No "is not a function" errors in logs
- [ ] Account verification succeeds
```

### 4. Check Netlify Function Logs
In Netlify dashboard → Functions → get-metaapi-token:
```
Look for:
- [ ] "✓ Valid cached token found" (on cached requests)
- [ ] "Token generated successfully" (on fresh generation)
- [ ] "✓ Token cached successfully" (after generation)
- [ ] No timeout errors
- [ ] Function completes in < 26 seconds
```

### 5. Verify Supabase Cache Entries
Run in Supabase SQL Editor:
```sql
SELECT 
  account_id,
  region,
  is_valid,
  created_at,
  expires_at,
  EXTRACT(EPOCH FROM (expires_at - NOW())) / 60 as minutes_remaining,
  LENGTH(token) as token_length
FROM metaapi_token_cache
ORDER BY created_at DESC
LIMIT 5;
```

Checklist:
```
- [ ] At least one cache entry exists
- [ ] expires_at is ~1 hour in the future
- [ ] is_valid = true
- [ ] token_length > 100
- [ ] minutes_remaining between 55-60 (for fresh tokens)
```

### 6. Test Emergency Fallback (Optional)
To test fallback logic, you need to:
1. Have a cached token in Supabase
2. Wait for it to expire (or manually set expires_at to the past)
3. Temporarily make MetaAPI fail (e.g., wrong admin token)
4. Call the function
5. Should return the expired token with a warning

**Skip this unless you want to verify fallback works!**

### 7. Performance Monitoring
Over the next few hours/days:
```
- [ ] Monitor function execution times in Netlify
- [ ] Check for any 504 Gateway Timeout errors
- [ ] Verify cache hit rate is high (most requests < 1 second)
- [ ] Monitor Supabase cache table size (should stay small)
```

## Troubleshooting

### If tokens are NOT being cached:
1. Check `SUPABASE_SERVICE_ROLE_KEY` is set in Netlify
2. Verify RLS policies allow service role access
3. Check Netlify function logs for cache errors
4. Run database migration if not applied

### If getting "is not a function" errors:
1. Check MetaAPI SDK version in netlify/functions/package.json
2. May need to use `narrowDownToken()` instead of `narrowDownTokenResources()`
3. Check SDK documentation for available methods

### If still getting timeouts:
1. Verify timeouts are correct in metaapi-utils.js
2. Check Netlify function timeout in netlify.toml (should be 26s)
3. Consider increasing TOKEN_GENERATION_TIMEOUT_MS further
4. Check MetaAPI server status

### If cache hits but tokens don't work:
1. Verify token hasn't expired (check expires_at)
2. Check if MetaAPI account status changed
3. Try invalidating cache (delete entries) and regenerate

## Success Criteria

Token generation is fixed when:
- [x] Build completes successfully
- [ ] First token request: ~14 seconds (not 20+)
- [ ] Subsequent requests: < 300ms (from cache)
- [ ] No 504 Gateway Timeout errors
- [ ] No "is not a function" errors
- [ ] Cache entries visible in Supabase
- [ ] 95%+ requests served from cache after initial generation

## Contact

If issues persist:
1. Check Netlify function logs
2. Check Supabase logs
3. Review `METAAPI_TOKEN_FIX_SUMMARY.md` for implementation details
4. Consider reverting by removing `SUPABASE_SERVICE_ROLE_KEY` temporarily
