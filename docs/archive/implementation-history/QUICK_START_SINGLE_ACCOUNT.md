# Quick Start: Single MetaAPI Account Configuration

**Status:** Fallback logic removed, single account only ✅

---

## Environment Variables Required

```bash
# MetaAPI Configuration (Frontend - build time)
VITE_METAAPI_ACCOUNT_ID=your_metaapi_account_id
VITE_METAAPI_REGION=london

# MetaAPI Configuration (Backend - runtime)
METAAPI_ACCOUNT_ID=your_metaapi_account_id  # SAME as VITE_ version
METAAPI_ADMIN_TOKEN=your_admin_token
METAAPI_REGION=london  # SAME as VITE_ version
```

---

## What Changed

### Removed ❌
- `METAAPI_ACCOUNT_ID_FALLBACK` - No longer needed
- Account switching logic - Removed
- Fallback retry system - Removed
- Complex health tracking - Removed

### Added ✅
- Single account usage only
- Clear 404 error messages
- Simpler configuration

---

## Deployment Checklist

### Netlify Environment Variables

Set these in **Netlify Dashboard → Site Settings → Environment Variables**:

1. ✅ `VITE_METAAPI_ACCOUNT_ID` (your account ID)
2. ✅ `VITE_METAAPI_REGION` (london, new-york, etc.)
3. ✅ `METAAPI_ACCOUNT_ID` (same as #1)
4. ✅ `METAAPI_ADMIN_TOKEN` (your admin token)
5. ✅ `METAAPI_REGION` (same as #2)
6. ❌ `METAAPI_ACCOUNT_ID_FALLBACK` (DELETE if exists)

### Deploy

```bash
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

---

## Error Handling

### If Symbol Not Available (404)

**Old Behavior:** Tried fallback account automatically
**New Behavior:** Clear error message

**Error Example:**
```
MetaAPI HTTP 404: Account doesn't have XAUUSD available
```

**Solution:** Ensure your MetaAPI account has the symbol enabled

---

## Testing

### 1. Test Live Price Fetch
```bash
curl "https://your-site.netlify.app/.netlify/functions/get-live-price?symbol=EURUSD"
```

**Expected:**
- ✅ Returns bid/ask prices
- ✅ Logs show single account ID in use

### 2. Test Health Check
```bash
curl "https://your-site.netlify.app/.netlify/functions/metaapi-health-check"
```

**Expected:**
```json
{
  "ok": true,
  "accountId": "12345678...",
  "region": "london",
  "message": "Single MetaAPI account configured",
  "timestamp": "2025-12-09T..."
}
```

### 3. Test Account Verification
```bash
curl "https://your-site.netlify.app/.netlify/functions/verify-metaapi-account"
```

**Expected:**
- ✅ Returns account state and connection status
- ✅ Uses single account only

---

## Common Issues

### Issue: "MetaAPI account ID not configured"
**Solution:** Set `METAAPI_ACCOUNT_ID` in Netlify env variables

### Issue: "Symbol not available" (404)
**Solution:** Enable the symbol in your MetaAPI account dashboard

### Issue: "MetaAPI token not configured"
**Solution:** Set `METAAPI_ADMIN_TOKEN` in Netlify env variables

---

## Files Changed

1. ❌ Deleted: `netlify/functions/_shared/metaapi-account-manager.ts`
2. ❌ Deleted: `src/services/metaapi-account-manager.ts`
3. ✅ Modified: `.env.example`
4. ✅ Modified: `netlify/functions/historical-backfill.ts`
5. ✅ Modified: `netlify/functions/get-live-price.ts`
6. ✅ Modified: `netlify/functions/metaapi-health-check.ts`
7. ✅ Modified: `netlify/functions/verify-metaapi-account.ts`

---

## Next Steps

1. ✅ Remove `METAAPI_ACCOUNT_ID_FALLBACK` from Netlify
2. ✅ Verify `METAAPI_ACCOUNT_ID` is set correctly
3. ✅ Deploy to production
4. ✅ Monitor logs for any issues
5. ✅ Test symbol availability

---

## Rollback (If Needed)

```bash
git checkout HEAD~1 -- netlify/functions/_shared/metaapi-account-manager.ts
git checkout HEAD~1 -- src/services/metaapi-account-manager.ts
# Revert other files as needed
```

Then redeploy.

---

**Complete Summary:** See `METAAPI_FALLBACK_REMOVED_COMPLETE.md`
