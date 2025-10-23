# MetaAPI Token Fix - Quick Reference

## What Was Fixed

The Netlify logs showed:
```
PRIMARY method failed: metaApi.tokenManagementApi.generateToken is not a function
narrowDownToken API call failed after 9000ms: Operation timed out
```

**Root Cause**: Using non-existent SDK method + slow API call with too many retries = 20+ second timeout

## Solution Summary

1. **Removed bad method**: Deleted `generateTokenFast()` that called non-existent `generateToken()`
2. **Single method only**: Now uses `narrowDownTokenResources()` exclusively
3. **Better timeouts**: 14 seconds per attempt, no retries (down from 9s with 1 retry)
4. **Cache-first**: Checks Supabase cache before generating (< 100ms vs 14+ seconds)
5. **Emergency fallback**: Returns slightly expired tokens if generation fails
6. **Fixed RLS**: Service role can now read/write cache

## Key Performance Changes

| Metric | Before | After |
|--------|--------|-------|
| First request | 20+ sec (timeout) | ~14 seconds |
| Cached requests | 20+ sec (cache broken) | < 100ms |
| Retries | 1 (2 total attempts) | 0 (1 attempt) |
| Cache working | ❌ No | ✅ Yes |
| Fallback | ❌ No | ✅ Yes |

## How to Verify It Works

### Quick Test (30 seconds):
```bash
# Run twice in a row
curl -X POST https://your-site.netlify.app/.netlify/functions/test-metaapi-token \
  -H "Content-Type: application/json" -d '{}'

# First call: ~14s, source: "generated"
# Second call: < 300ms, source: "cache"
```

### Check Cache in Supabase:
```sql
SELECT account_id, expires_at, is_valid FROM metaapi_token_cache;
```

Should see entries with `is_valid = true` and `expires_at` about 1 hour in the future.

## Critical Environment Variables

Must be set in Netlify:
- `METAAPI_ADMIN_TOKEN` ✅
- `VITE_METAAPI_ACCOUNT_ID` ✅
- `SUPABASE_SERVICE_ROLE_KEY` ⚠️ **CRITICAL FOR CACHING**

Without service role key, every request takes 14+ seconds!

## New Token Response Format

Before:
```json
{
  "token": "...",
  "expiresIn": 3600,
  "cached": false
}
```

After:
```json
{
  "token": "...",
  "expiresIn": 3600,
  "expiresAt": "2025-10-23T06:00:00Z",
  "cached": true,
  "source": "cache",
  "warning": null,
  "executionTime": 87
}
```

## Files Changed

1. `netlify/functions/metaapi-utils.js` - Core fixes
2. `netlify/functions/get-metaapi-token.js` - Simplified
3. `netlify/functions/test-metaapi-token.js` - Updated tests
4. `supabase/migrations/20251023020000_*.sql` - Fixed RLS + unique constraint

## Troubleshooting One-Liners

**Not caching?**
```bash
# Check if SUPABASE_SERVICE_ROLE_KEY is set
netlify env:list | grep SUPABASE_SERVICE_ROLE_KEY
```

**Still seeing "is not a function"?**
```bash
# Check SDK version (should be 29.3.1)
cat netlify/functions/package.json | grep metaapi
```

**Tokens timing out?**
```bash
# Check function timeout in netlify.toml (should be 26)
grep -A2 "test-metaapi-token" netlify.toml
```

## Expected Logs After Fix

✅ Good logs:
```
[Cache] ✓ Valid cached token found (expires in 57 minutes)
Token retrieval completed in 89ms (source: cache)
```

❌ Bad logs (means caching not working):
```
No cached token found for account
Generating token WITHOUT caching
WARNING: Token caching disabled
```

## Rollback If Needed

Disable caching temporarily:
```bash
# In Netlify dashboard, delete or unset:
SUPABASE_SERVICE_ROLE_KEY

# This makes every request slow but functional
# Useful if cache is causing issues
```

## Success Metrics

After 24 hours, check:
- 95%+ requests served from cache
- Average response time < 500ms
- No 504 Gateway Timeout errors
- Cache table has 1-5 entries (one per account/region)

## Questions?

See full details in:
- `METAAPI_TOKEN_FIX_SUMMARY.md` - Complete implementation guide
- `DEPLOYMENT_VERIFICATION.md` - Step-by-step verification checklist
