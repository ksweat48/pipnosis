# MetaAPI Endpoint Fix - October 28, 2025

## Problem Identified

The application was using the **wrong MetaAPI endpoint** for account information requests, causing 404 errors.

### Root Cause

MetaAPI has two separate API services:

1. **Provisioning API** (`mt-provisioning-api-v1.agiliumtrade.ai`)
   - Purpose: Account management and configuration
   - Endpoints: `/users/current/accounts`, `/users/current/accounts/{accountId}`
   - **No region in URL** (global service)

2. **Client API** (`mt-client-api-v1.{region}.agiliumtrade.ai`)
   - Purpose: Trading operations and market data
   - Endpoints: Price data, symbols, trades, positions
   - **Requires region** (london, new-york, singapore, tokyo)

### The Bug

The code was calling:
```
https://mt-client-api-v1.london.agiliumtrade.ai/users/current/accounts/169ff8dd-bb46-4618-91b4-28f696fba223
```

This endpoint **doesn't exist** on the Client API! It only exists on the Provisioning API:
```
https://mt-provisioning-api-v1.agiliumtrade.ai/users/current/accounts/169ff8dd-bb46-4618-91b4-28f696fba223
```

## Solution Implemented

### Files Updated

1. **netlify/functions/test-metaapi-direct.js**
   - Test 1 (Account Info): Now uses Provisioning API
   - Test 2 (Symbols): Uses Client API (correct)
   - Test 3 (Price): Uses Client API (correct)

2. **netlify/functions/metaapi-rest-client.js**
   - Added `provisioningUrl` property for account management calls
   - Added `clientUrl` property for trading/market data calls
   - Updated `getAccountInformation()` to use Provisioning API
   - All price/symbol methods continue using Client API

3. **netlify/functions/verify-metaapi-account.js**
   - Updated logging to show both URLs being used
   - Account info now correctly uses Provisioning API via updated client

4. **netlify/functions/get-latest-price.js**
   - No changes needed (already using correct Client API)

### API Endpoint Reference

| Endpoint Type | Base URL | Region Required |
|--------------|----------|-----------------|
| Account Info | `https://mt-provisioning-api-v1.agiliumtrade.ai` | No |
| Symbols List | `https://mt-client-api-v1.{region}.agiliumtrade.ai` | Yes |
| Current Price | `https://mt-client-api-v1.{region}.agiliumtrade.ai` | Yes |
| Trade Execution | `https://mt-client-api-v1.{region}.agiliumtrade.ai` | Yes |

## Configuration

Your environment variables are **CORRECT**:
- `METAAPI_ACCOUNT_ID=169ff8dd-bb46-4618-91b4-28f696fba223` ✓
- `METAAPI_REGION=london` ✓
- `METAAPI_ADMIN_TOKEN=eyJhbGci...` ✓

The issue was purely in the endpoint URLs used by the code, not your configuration.

## Testing

The fix has been applied and the project builds successfully.

### Next Steps

1. Deploy to Netlify using your build hook:
   ```bash
   curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
   ```

2. Wait for deployment to complete (check Netlify dashboard)

3. Test the endpoints:
   - Visit: `/.netlify/functions/test-metaapi-direct`
   - Should now successfully retrieve account info
   - Should successfully retrieve symbols
   - Should successfully retrieve EURUSD price

## Expected Results

After deployment, you should see:
- ✅ **TEST 1 PASSED** - Account found (from Provisioning API)
- ✅ **TEST 2 PASSED** - Symbols retrieved (from Client API)
- ✅ **TEST 3 PASSED** - Price retrieved (from Client API)

All three tests should now pass with proper 200 OK responses instead of 404 errors.

## Technical Details

### Before Fix
```javascript
// WRONG - All using Client API
const accountInfo = await makeRequest(
  `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}`,
  token
);  // Returns 404 - endpoint doesn't exist on Client API
```

### After Fix
```javascript
// CORRECT - Using Provisioning API for account info
const accountInfo = await makeRequest(
  `https://mt-provisioning-api-v1.agiliumtrade.ai/users/current/accounts/${accountId}`,
  token
);  // Returns 200 - endpoint exists on Provisioning API

// CORRECT - Using Client API for market data
const price = await makeRequest(
  `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}/symbols/EURUSD/current-price`,
  token
);  // Returns 200 - endpoint exists on Client API
```

## Credits

Issue identified by analyzing MetaAPI's official documentation which clearly separates:
- Provisioning API: https://metaapi.cloud/docs/provisioning/
- Client API: https://metaapi.cloud/docs/client/

The 404 error was not an authentication issue, account ID issue, or user ID issue - it was simply calling the wrong API service for account information.
