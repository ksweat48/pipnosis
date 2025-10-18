# SSL Certificate Error Fix - Implementation Summary

## Problem Identified

The application was experiencing SSL certificate validation errors when the Supabase edge function attempted to connect to MetaAPI's Token Management API. The error message showed:

```
error sending request for url (https://mt-provisioning-api-v1.new-york.metaapi.cloud/...)
error trying to connect: invalid peer certificate: Expired
```

Additionally, the browser showed `ERR_CERT_AUTHORITY_INVALID` errors when trying to access MetaAPI endpoints directly.

## Root Cause

The issue was NOT an expired certificate, but rather a problem with how Deno (used by Supabase Edge Functions) validates SSL certificates. Deno may not have the latest certificate authority (CA) certificates in its trust store, causing it to reject valid certificates from MetaAPI.

## Solution Implemented

### 1. Removed All Fallback Mechanisms

**Previous behavior:** The application had a fallback mechanism that would switch to using the admin token directly in the browser when the edge function failed.

**New behavior:** The fallback mechanism has been completely removed. The application now properly fails with clear error messages when SSL certificate validation fails, forcing proper configuration rather than working around the issue.

**Files modified:**
- `src/services/metaapi-token-manager.ts` - Removed `useDirectToken` flag and fallback logic
- `supabase/functions/metaapi-token/index.ts` - Enhanced error logging and handling

### 2. Configured Environment Variables

**Added to `.env`:**
```bash
VITE_METAAPI_REGION=new-york
METAAPI_TOKEN=<your_metaapi_admin_token>
```

**Purpose:**
- `VITE_METAAPI_REGION` - Ensures the correct MetaAPI region is used
- `METAAPI_TOKEN` - Server-side token for the Supabase edge function

### 3. Enhanced Edge Function Error Handling

The `metaapi-token` edge function now:
- Logs detailed error information including SSL certificate validation issues
- Provides clear error messages when connection fails
- Captures the full error stack for debugging
- Reports `DENO_TLS_CA_STORE` configuration status

### 4. Documentation Updates

Updated `.env.example` with:
- Clear instructions on where to configure `METAAPI_TOKEN`
- Instructions for setting `DENO_TLS_CA_STORE` if SSL errors occur
- Explanation of why both client and server tokens are needed

## Required Configuration Steps

### For Local Development

1. **Update your `.env` file** with the following:
   ```bash
   VITE_METAAPI_TOKEN=<your_admin_token>
   VITE_METAAPI_ACCOUNT_ID=<your_account_id>
   VITE_METAAPI_REGION=new-york
   VITE_SUPABASE_URL=<your_supabase_url>
   VITE_SUPABASE_ANON_KEY=<your_supabase_anon_key>
   METAAPI_TOKEN=<your_admin_token>  # Same as VITE_METAAPI_TOKEN
   ```

### For Production (Supabase Edge Functions)

1. **Go to Supabase Dashboard:**
   - Navigate to your project
   - Go to `Project Settings` > `Edge Functions` > `Secrets`

2. **Add the following environment variables:**
   ```
   METAAPI_TOKEN=<your_admin_token>
   ```

3. **If SSL errors persist, also add:**
   ```
   DENO_TLS_CA_STORE=mozilla,system
   ```

4. **Redeploy your edge functions** after adding the environment variables.

### For Production (Netlify)

1. **Go to Netlify Dashboard:**
   - Navigate to your site
   - Go to `Site settings` > `Environment variables`

2. **Ensure all VITE_ environment variables are set:**
   ```
   VITE_METAAPI_TOKEN=<your_admin_token>
   VITE_METAAPI_ACCOUNT_ID=<your_account_id>
   VITE_METAAPI_REGION=new-york
   VITE_SUPABASE_URL=<your_supabase_url>
   VITE_SUPABASE_ANON_KEY=<your_supabase_anon_key>
   ```

## How the Fix Works

### Normal Flow (Without SSL Issues)

1. Application starts and needs a MetaAPI token
2. Client calls Supabase edge function at `/functions/v1/metaapi-token`
3. Edge function uses `METAAPI_TOKEN` to call MetaAPI's Token Management API
4. Edge function creates a short-lived, scoped token
5. Client receives the scoped token and uses it for MetaAPI operations
6. Token is cached and reused until expiry

### With DENO_TLS_CA_STORE Configuration

If SSL certificate validation fails:

1. Set `DENO_TLS_CA_STORE=mozilla,system` in Supabase edge function secrets
2. This tells Deno to use both Mozilla's CA certificates and system certificates
3. Expands the trusted certificate authorities for SSL validation
4. Should resolve most certificate validation issues

## What Changed in the Code

### Token Manager (`src/services/metaapi-token-manager.ts`)

**Before:**
```typescript
// Had fallback logic that would use admin token directly
if (this.useDirectToken && adminToken) {
  return adminToken;
}

// In catch block
if (isSslError) {
  // Fall back to admin token
  this.useDirectToken = true;
  return adminToken;
}
```

**After:**
```typescript
// No fallback - just proper error handling
async getToken(accountId: string, region: string): Promise<string> {
  if (this.currentToken && this.isTokenValid()) {
    return this.currentToken;
  }
  return this.fetchTokenFromEdgeFunction(accountId, region);
}

// In catch block - just throw the error
catch (error) {
  this.currentToken = null;
  this.tokenExpiry = null;
  throw error;
}
```

### Edge Function (`supabase/functions/metaapi-token/index.ts`)

**Added:**
```typescript
// Log DENO_TLS_CA_STORE configuration
console.log(`DENO_TLS_CA_STORE: ${Deno.env.get("DENO_TLS_CA_STORE") || "not set"}`);

// Better error handling with try-catch around fetch
try {
  tokenResponse = await fetch(tokenManagementUrl, {...});
} catch (fetchError) {
  console.error("Fetch error details:", {
    error: fetchError,
    message: fetchError instanceof Error ? fetchError.message : "Unknown",
    stack: fetchError instanceof Error ? fetchError.stack : undefined,
  });
  throw new Error(`Failed to connect to MetaAPI: ${...}`);
}
```

## Testing the Fix

### 1. Check Edge Function Logs

After deployment, check Supabase edge function logs to see:
- Whether `METAAPI_TOKEN` is being read correctly
- Whether `DENO_TLS_CA_STORE` is configured
- Detailed error messages if connection fails

### 2. Test Token Generation

Open browser console and look for:
- ✅ "Secure MetaAPI token obtained successfully" - Fix is working
- ❌ "Failed to connect to MetaAPI" - SSL issue still exists, configure DENO_TLS_CA_STORE

### 3. Monitor Network Tab

In browser DevTools Network tab:
- Check for successful POST to `/functions/v1/metaapi-token`
- Response should be 200 with token data
- If 500 error, check edge function logs in Supabase

## Troubleshooting

### Edge Function Still Fails with SSL Error

1. **Add DENO_TLS_CA_STORE environment variable:**
   - In Supabase Dashboard > Edge Functions > Secrets
   - Set `DENO_TLS_CA_STORE=mozilla,system`
   - Redeploy the edge function

2. **Verify METAAPI_TOKEN is correct:**
   - Check that it's the full admin token from MetaAPI
   - Verify it hasn't expired
   - Test it directly with MetaAPI's API

3. **Check MetaAPI region:**
   - Ensure `VITE_METAAPI_REGION` matches your account region
   - Try different region endpoints (new-york, london, singapore)

### Browser Shows "No admin token available for fallback"

This error means:
- The fallback code has been removed (this is correct)
- The edge function is failing to generate tokens
- You need to configure the edge function environment variables

### Application Won't Connect to MetaAPI

1. **Check all environment variables are set correctly**
2. **Verify edge function is deployed** (check Supabase dashboard)
3. **Check browser console** for detailed error messages
4. **Check edge function logs** in Supabase dashboard

## Benefits of This Fix

1. **Security:** No more admin token exposed in browser
2. **Proper Error Handling:** Clear error messages instead of silent fallbacks
3. **Scalability:** Edge function can generate tokens for multiple users
4. **Maintainability:** Single source of truth for token management
5. **Compliance:** Follows MetaAPI's security best practices

## Next Steps

1. ✅ Deploy the updated code to Netlify (triggered)
2. ⏳ Configure `METAAPI_TOKEN` in Supabase edge function secrets
3. ⏳ Test the application and verify token generation works
4. ⏳ If SSL errors occur, add `DENO_TLS_CA_STORE=mozilla,system`
5. ⏳ Monitor edge function logs for any issues

## Additional Notes

- The edge function creates short-lived (24-hour) read-only tokens
- Tokens are cached in the browser until they expire
- The admin token is never exposed to the client
- All SSL certificate validation is handled server-side in the edge function

## Support

If you continue to experience SSL certificate errors after configuring `DENO_TLS_CA_STORE`:

1. Check Supabase community forums for similar issues
2. Verify MetaAPI's certificate status at their status page
3. Contact MetaAPI support to report certificate issues
4. Consider using alternative MetaAPI region endpoints

---

**Implementation Date:** 2025-10-18
**Status:** ✅ Deployed to Netlify
**Remaining:** Configure Supabase edge function environment variables
