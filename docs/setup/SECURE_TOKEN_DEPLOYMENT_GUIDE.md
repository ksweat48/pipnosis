# Secure MetaAPI Token Management - Deployment Guide

## Overview

This implementation fixes the MetaAPI "demo mode" security issue by moving the admin token from client-side environment variables to a secure backend token service. The frontend now receives temporary, restricted tokens with 1-hour validity from a Netlify serverless function.

## Security Improvements

### Before (Insecure)
- ❌ Admin token exposed in browser via `VITE_METAAPI_TOKEN`
- ❌ Token visible in DevTools and network requests
- ❌ Full admin privileges accessible to any user
- ❌ No token expiration or rotation
- ❌ Demo mode warning due to security concerns

### After (Secure)
- ✅ Admin token stored securely on backend only
- ✅ Temporary tokens with 1-hour expiration
- ✅ Tokens restricted to specific account access
- ✅ Automatic token refresh before expiration
- ✅ No sensitive credentials in browser
- ✅ Demo mode resolved with proper security

## Architecture

```
Frontend (Browser)
    ↓ Request token for account
Backend (Netlify Function)
    ↓ Validate request
    ↓ Use admin token to generate temporary token
    ↓ Return restricted token (1-hour TTL)
Frontend receives token
    ↓ Initialize MetaAPI with temporary token
    ↓ Cache token (50-minute cache)
    ↓ Auto-refresh before expiration
```

## Files Changed

### New Files
1. `/netlify/functions/get-metaapi-token.ts` - Backend token generation service
2. `/src/services/token-manager.ts` - Frontend token caching and management

### Modified Files
1. `/src/services/metaapi.ts` - Updated to use dynamic tokens
2. `/netlify.toml` - Enhanced CSP headers
3. `/public/_headers` - Enhanced CSP headers
4. `/.env.example` - Updated configuration template

## Deployment Steps

### 1. Update Netlify Environment Variables

**Important:** Set these in Netlify Dashboard, NOT in `.env` files!

Navigate to: **Netlify Dashboard > Your Site > Site settings > Environment variables**

**Add/Update:**
```bash
# Backend Only - NEVER expose this
METAAPI_ADMIN_TOKEN=your_actual_admin_token_here

# Keep existing variables
VITE_METAAPI_ACCOUNT_ID=8845e940-c372-4a3d-9f7e-66288924c46f
VITE_METAAPI_REGION=new-york
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
ADMIN_REFRESH_KEY=your_admin_refresh_key
```

**Remove (if exists):**
```bash
VITE_METAAPI_TOKEN  # No longer needed - replaced by backend token service
```

### 2. Update Local Development Environment

Update your local `.env` file (for development only):

```bash
# Frontend variables (safe to have locally)
VITE_DEV_MODE=true
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_METAAPI_ACCOUNT_ID=8845e940-c372-4a3d-9f7e-66288924c46f
VITE_METAAPI_REGION=new-york

# Backend variables (for local testing)
METAAPI_ADMIN_TOKEN=your_admin_token_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
ADMIN_REFRESH_KEY=your_admin_key_here
```

**Important:** Never commit `.env` with real credentials to git!

### 3. Deploy to Netlify

Run the deployment:

```bash
npm run build
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

Or deploy via Netlify CLI:
```bash
netlify deploy --prod
```

### 4. Verify Deployment

After deployment, verify the implementation:

1. **Check Token Service**
   ```bash
   curl -X POST https://your-site.netlify.app/.netlify/functions/get-metaapi-token \
     -H "Content-Type: application/json" \
     -d '{"accountId":"8845e940-c372-4a3d-9f7e-66288924c46f"}'
   ```

   Expected response:
   ```json
   {
     "token": "temporary_token_here",
     "expiresIn": 3600,
     "accountId": "8845e940-c372-4a3d-9f7e-66288924c46f"
   }
   ```

2. **Check Browser DevTools**
   - Open browser DevTools > Network tab
   - Load your application
   - Verify NO requests contain `VITE_METAAPI_TOKEN`
   - Verify you see request to `/get-metaapi-token`
   - Check Application > Local Storage - no admin token stored

3. **Check Console Logs**
   - Look for: "Fetching secure temporary token from backend..."
   - Look for: "✓ Received secure temporary token"
   - Should NOT see: "demo mode" warnings

4. **Verify Demo Mode is Gone**
   - Load the application
   - Check for absence of demo mode banner/warning
   - Verify live MetaAPI connection established
   - Check market data is streaming correctly

## Token Lifecycle

1. **Initial Request**
   - Frontend requests token from backend
   - Backend validates request
   - Backend uses admin token to generate temporary token
   - Temporary token returned with 1-hour expiration

2. **Caching**
   - Token cached in memory for 50 minutes
   - Prevents unnecessary backend calls
   - Reduces latency for MetaAPI operations

3. **Automatic Refresh**
   - Token manager checks expiration before each use
   - Automatically fetches new token when < 5 minutes remaining
   - Seamless rotation without user interruption

4. **Expiration Handling**
   - Expired tokens trigger automatic refresh
   - Failed refresh attempts fall back to demo mode
   - Clear error messages for debugging

## Security Best Practices

### ✅ DO
- Store `METAAPI_ADMIN_TOKEN` only in Netlify environment variables
- Use the token management API for all browser-based access
- Monitor token usage in Netlify function logs
- Rotate admin token periodically (every 90 days)
- Set up alerts for failed token generation attempts

### ❌ DON'T
- Never commit admin token to git
- Never expose admin token in client-side code
- Never log full tokens in console or logs
- Never store tokens in localStorage or sessionStorage
- Never increase token TTL beyond 24 hours

## Troubleshooting

### Issue: "Failed to fetch MetaAPI token"

**Cause:** Backend function not finding admin token

**Solution:**
1. Verify `METAAPI_ADMIN_TOKEN` is set in Netlify Dashboard
2. Redeploy site after setting environment variable
3. Check Netlify function logs for errors

### Issue: "Token fetch failed: 500"

**Cause:** Invalid admin token or MetaAPI API error

**Solution:**
1. Verify admin token is valid in MetaAPI dashboard
2. Check token has not expired
3. Ensure token has necessary permissions
4. Check Netlify function logs for detailed error

### Issue: Still seeing demo mode

**Cause:** Frontend still using old token method

**Solution:**
1. Clear browser cache and reload
2. Hard refresh (Ctrl+Shift+R or Cmd+Shift+R)
3. Check browser console for initialization errors
4. Verify build includes updated code

### Issue: CORS errors

**Cause:** CSP blocking token service requests

**Solution:**
1. Verify `netlify.toml` has correct CSP headers
2. Check `public/_headers` matches CSP configuration
3. Ensure `https://metaapi.cloud` is in `connect-src`
4. Redeploy after CSP changes

## Monitoring

### Key Metrics to Monitor

1. **Token Generation Rate**
   - Track calls to `/get-metaapi-token` function
   - Should see ~1 call per hour per active user
   - Spike indicates caching issues

2. **Token Generation Failures**
   - Monitor 500 errors from token endpoint
   - Indicates admin token or MetaAPI issues
   - Set up alerts for > 5% error rate

3. **Token Expiration Events**
   - Monitor automatic refresh logs
   - Verify seamless token rotation
   - Track any failed refresh attempts

### Netlify Function Logs

View function logs:
```bash
netlify functions:log get-metaapi-token
```

Example successful log:
```
Generating temporary token for account: c9991ce7-...
Successfully generated temporary token for account: c9991ce7-...
```

Example error log:
```
Error generating MetaAPI token: Invalid admin token
METAAPI_ADMIN_TOKEN environment variable not set
```

## Cost Impact

### Netlify Functions Usage

- **Function:** `get-metaapi-token`
- **Frequency:** ~1 request per hour per active user
- **Duration:** ~200-500ms per request
- **Cost:** Minimal - well within free tier limits

### MetaAPI Token Generation

- **API Calls:** Token generation counts toward MetaAPI limits
- **Cost:** No additional cost - included in subscription
- **Rate Limits:** No special limits on token generation

## Rollback Plan

If issues occur, rollback steps:

1. **Revert Environment Variables**
   ```bash
   # In Netlify Dashboard
   VITE_METAAPI_TOKEN=your_admin_token  # Add back
   # Remove METAAPI_ADMIN_TOKEN
   ```

2. **Revert Code Changes**
   ```bash
   git revert HEAD
   git push
   ```

3. **Redeploy**
   ```bash
   curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
   ```

## Support

For issues or questions:
1. Check Netlify function logs
2. Review browser console errors
3. Verify environment variables in Netlify Dashboard
4. Test token endpoint directly with curl
5. Check MetaAPI dashboard for account status

## References

- [MetaAPI Token Management API](https://github.com/metaapi/metaapi-javascript-sdk/blob/main/docs/tokenManagementApi.md)
- [Netlify Functions Documentation](https://docs.netlify.com/functions/overview/)
- [Content Security Policy Guide](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [MetaAPI JavaScript SDK](https://github.com/metaapi/metaapi-javascript-sdk)

## Changelog

### v1.0.0 - Secure Token Implementation
- Added backend token generation service
- Implemented frontend token management with caching
- Removed admin token from client-side code
- Enhanced CSP headers for MetaAPI domains
- Added automatic token refresh logic
- Resolved demo mode security issue
