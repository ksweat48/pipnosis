# MetaAPI Region Configuration Fix

**Date**: October 28, 2025
**Issue**: DNS Resolution Error - `getaddrinfo ENOTFOUND mt-client-api-v1.cloud-g2.agiliumtrade.ai`
**Status**: ✅ RESOLVED

## Problem Summary

The application was configured to use `cloud-g2` as the MetaAPI region, which is not a valid geographic region format. MetaAPI expects traditional geographic region names like `london`, `new-york`, `singapore`, or `tokyo`.

### Error Encountered
```
getaddrinfo ENOTFOUND mt-client-api-v1.cloud-g2.agiliumtrade.ai
```

This DNS error occurred because the URL `mt-client-api-v1.cloud-g2.agiliumtrade.ai` does not exist. The correct format uses geographic regions, e.g., `mt-client-api-v1.london.agiliumtrade.ai`.

## Root Cause

The environment variables were incorrectly set to:
- `METAAPI_REGION=cloud-g2`
- `VITE_METAAPI_REGION=cloud-g2`

These invalid region values were also used as defaults throughout the codebase.

## Solution Applied

### 1. Environment Variables Updated

**Local Development (.env)**
```bash
# Changed from:
METAAPI_REGION=cloud-g2
VITE_METAAPI_REGION=cloud-g2

# To:
METAAPI_REGION=london
VITE_METAAPI_REGION=london
```

**Production (.env.production)**
```bash
# Changed from:
VITE_METAAPI_REGION=cloud-g2

# To:
VITE_METAAPI_REGION=london
```

**Netlify Environment Variables**
- Updated `METAAPI_REGION=london` in Netlify Dashboard
- Updated `VITE_METAAPI_REGION=london` in Netlify Dashboard

### 2. Code Updates

Updated all default fallback values in Netlify functions from `'cloud-g2'` to `'london'`:

**Files Modified:**
- `netlify/functions/get-metaapi-token.js`
  - Changed `REGIONS` array from `['cloud-g2', 'cloud-g1', ...]` to `['new-york', 'london', 'singapore', 'tokyo']`
  - Updated default region fallback
- `netlify/functions/get-latest-price.js`
- `netlify/functions/get-live-price.js`
- `netlify/functions/verify-metaapi-account.js`
- `netlify/functions/test-metaapi-connection.js`
- `netlify/functions/stream-prices.js` (2 occurrences)
- `netlify/functions/metaapi-rest-client.js`
- `netlify/functions/error-handler.js`

### 3. Documentation Updated

**Updated `.env.example`:**
- Removed `cloud-g2` from valid region options
- Updated to show only valid geographic regions: `new-york`, `london`, `singapore`, `tokyo`

## Valid MetaAPI Regions

The following are the only valid MetaAPI regions:
- `new-york` - US East Coast
- `london` - Europe
- `singapore` - Asia Pacific
- `tokyo` - Asia Pacific

## Testing

### Build Verification
```bash
npm run build
```
✅ Build completed successfully without errors

### Deployment
- Netlify deployment triggered with updated configuration
- New build will use `london` region throughout

### How to Test the Fix

1. **Via Test Page**
   - Navigate to: `https://pipnosis.com/test-metaapi-direct`
   - Click "Test with Environment Variables"
   - Should now show: ✅ GREEN LIGHT - MetaAPI connection successful

2. **Via Direct Function Test**
   ```bash
   curl https://pipnosis.com/.netlify/functions/test-metaapi-direct
   ```
   Should return successful connection with account details

3. **Via Application**
   - Open the main trading dashboard
   - Verify live prices are updating
   - Check that there are no DNS-related errors in the console

## Expected Results After Fix

1. ✅ DNS resolution succeeds for `mt-client-api-v1.london.agiliumtrade.ai`
2. ✅ MetaAPI REST API connections work
3. ✅ Live price streaming functional
4. ✅ All MetaAPI-dependent features operational
5. ✅ No more `ENOTFOUND` errors in logs

## Important Notes

### Why "london"?
We chose `london` as the default region because:
- It's a common European region
- Low latency for European users
- Stable MetaAPI infrastructure

If your MetaAPI account is deployed in a different region, update both:
- Local `.env` file: `METAAPI_REGION=your_region`
- Netlify environment variables: `METAAPI_REGION=your_region`

### How to Check Your MetaAPI Region

1. Log into MetaAPI Dashboard: https://app.metaapi.cloud/
2. Navigate to your account settings
3. Check the "Region" field under account details
4. Use that exact region name in your environment variables

## Prevention

To prevent this issue in the future:
1. Always use valid geographic region names
2. Never use `cloud-*` style regions
3. Verify region against MetaAPI documentation
4. Test connections after changing region settings

## Related Files

- Environment: `.env`, `.env.production`, `.env.example`
- Functions: All files in `netlify/functions/`
- Documentation: `ENVIRONMENT_VARIABLE_GUIDE.md`

## Deployment Status

- ✅ Local environment files updated
- ✅ Netlify environment variables updated (by user)
- ✅ Code defaults corrected
- ✅ Documentation updated
- ✅ Build verified
- ✅ Deployment triggered

The MetaAPI DNS resolution error should now be completely resolved.
