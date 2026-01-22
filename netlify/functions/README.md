# MetaAPI Serverless Functions

This directory contains serverless functions for MetaAPI integration. All functions use CommonJS and proper Node.js SDK imports to avoid browser compatibility issues.

## Architecture

### Problem Solved
Previously, the MetaAPI SDK was being imported with its browser distribution (`dists/esm-web/index.js`) in serverless functions, causing "window is not defined" errors. This happened because:
1. Modern bundlers default to the `module` field in package.json
2. The SDK's `module` field points to the browser version
3. The browser version includes window/browser-specific APIs

### Solution
1. **Dedicated utility module** (`metaapi-utils.js`) that forces Node.js SDK imports
2. **CommonJS configuration** via `package.json` in functions directory
3. **Pure JavaScript functions** to avoid TypeScript transpilation issues
4. **Frontend isolation** - SDK is never imported on the frontend

## Files

### `metaapi-utils.js`
Shared utility module that handles all MetaAPI SDK operations:
- `initializeMetaApiSDK()` - Loads SDK with proper Node.js distribution
- `createMetaApiClient()` - Creates MetaAPI client instances
- `generateNarrowedToken()` - Generates account-scoped tokens
- `verifyAccount()` - Verifies account access
- `getSDKInfo()` - Returns SDK debugging information

### `get-metaapi-token.js` [REMOVED - SECURITY FIX]
**DEPRECATED AND REMOVED** for security reasons (exposed MetaAPI token to client).
- All MetaAPI access must be server-side only
- Use `hybrid-price-collector.ts` Netlify function for price data
- Client-side MetaAPI WebSocket disabled in `metaapi-websocket-client.ts`
- **Removal Date**: Phase 1 SSOT/CCIP Governance Implementation

### `test-metaapi-token.js`
Comprehensive testing function that validates the entire token generation flow.
- **Method**: POST
- **Input**: `{ testAdminToken?: string, testAccountId?: string }`
- **Output**: Step-by-step test results with detailed logging
- **Purpose**: Debugging and validation of MetaAPI integration

### `verify-metaapi-account.js`
Verifies account access with a given token.
- **Method**: POST
- **Input**: `{ token: string, accountId: string, region?: string }`
- **Output**: `{ success: boolean, account: {...} }`
- **Purpose**: Backend proxy for account verification

## Configuration

### `package.json`
Forces CommonJS module resolution:
```json
{
  "type": "commonjs",
  "dependencies": {
    "metaapi.cloud-sdk": "^29.3.1"
  }
}
```

### `.esbuild.config.js`
Configures esbuild bundler for proper Node.js targeting:
- Platform: `node`
- Target: `node18`
- Main fields priority: `['main', 'module']`
- Conditions: `['node', 'require', 'default']`

## Environment Variables Required

### Netlify Environment Variables
Set these in Netlify dashboard under Site Settings > Environment Variables:

- `METAAPI_ADMIN_TOKEN` - MetaAPI admin token (kept secret on server)
- `METAAPI_ACCOUNT_ID` - MetaAPI trading account ID
- `METAAPI_REGION` - MetaAPI region (e.g., 'new-york', 'london', 'singapore')

## Usage from Frontend

### Get Token
```typescript
const response = await fetch('/.netlify/functions/get-metaapi-token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ accountId: 'your-account-id' })
});

const { token, expiresIn } = await response.json();
```

### Test Integration
```typescript
const response = await fetch('/.netlify/functions/test-metaapi-token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({}) // Uses environment variables
});

const { success, testResults } = await response.json();
```

### Verify Account
```typescript
const response = await fetch('/.netlify/functions/verify-metaapi-account', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    token: 'narrowed-token',
    accountId: 'account-id',
    region: 'new-york'
  })
});

const { success, account } = await response.json();
```

## Debugging

### Check SDK Loading
All functions include detailed logging. Check Netlify function logs:
1. Go to Netlify dashboard
2. Navigate to Functions tab
3. Click on the function name
4. View real-time logs

### Common Issues

#### "SDK import failed"
- Check that `metaapi.cloud-sdk` is installed in functions directory
- Run `npm install` in `netlify/functions/`

#### "Token generation failed"
- Verify `METAAPI_ADMIN_TOKEN` is set correctly
- Check token has proper permissions in MetaAPI dashboard
- Verify account ID matches your MetaAPI account

#### "Region mismatch"
- Ensure `METAAPI_REGION` matches your account's actual region
- Check account region in MetaAPI dashboard

## Local Testing

To test functions locally:

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Install function dependencies
cd netlify/functions
npm install
cd ../..

# Run local dev server
netlify dev

# Test function
curl -X POST http://localhost:8888/.netlify/functions/test-metaapi-token \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Migration Notes

### Frontend Changes
The frontend service (`src/services/metaapi.ts`) no longer imports the MetaAPI SDK directly:
- SDK import is commented out
- Streaming functionality is disabled
- All operations use backend functions

### Benefits
1. **No browser errors** - SDK never loaded in browser
2. **Secure tokens** - Admin token stays on server
3. **Predictable bundling** - CommonJS ensures correct distribution
4. **Better debugging** - Detailed logs in serverless functions
5. **Smaller frontend bundle** - SDK not included in client code

## Recent Improvements

### Multi-Region Fallback (IMPLEMENTED)
Token generation now includes automatic multi-region fallback:
1. Tries primary region (from METAAPI_REGION)
2. Falls back to `new-york` if primary fails
3. Falls back to `london` if new-york fails
4. Falls back to `singapore` if london fails

This significantly improves reliability when a specific MetaAPI region is slow or timing out.

### Token Caching (IMPLEMENTED)
Tokens are cached in Supabase (`metaapi_token_cache` table) for 1 hour to reduce MetaAPI API calls and improve performance.

### Increased Timeout (IMPLEMENTED)
Token generation timeout increased from 14s to 22s to accommodate slower MetaAPI responses while staying under Netlify's 26s gateway timeout.

## Bootstrap Token Generation

To pre-generate and cache a token for immediate demo mode exit:

```bash
node scripts/generate-bootstrap-token.js
```

This script:
- Generates a fresh MetaAPI token
- Tries multiple regions automatically
- Caches the token in Supabase
- Provides immediate application access

**Required Environment Variables for Bootstrap:**
- `METAAPI_ADMIN_TOKEN`
- `METAAPI_ACCOUNT_ID`
- `METAAPI_REGION` (optional, defaults to new-york)
- `VITE_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Troubleshooting

### Token Generation Timeouts

If you see timeout errors:
1. The timeout is now 22 seconds (increased from 14s)
2. Multi-region fallback will automatically try other regions
3. Run the bootstrap script locally to pre-cache a token
4. Check Netlify function logs to see which region is responding

### All Regions Timing Out

If all regions timeout:
1. MetaAPI may be experiencing service-wide issues
2. Check MetaAPI status page
3. Wait a few minutes and try again
4. Use the bootstrap script during off-peak hours to cache a token

## Future Improvements

1. **Streaming alternative** - Implement WebSocket proxy for streaming data
2. **Rate limiting** - Add rate limiting to protect backend
3. **Monitoring** - Add error tracking and performance monitoring
4. **Type safety** - Generate TypeScript types from function responses
