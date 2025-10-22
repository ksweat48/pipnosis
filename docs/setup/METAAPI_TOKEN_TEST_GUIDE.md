# MetaAPI Token Function - Testing Guide

## Overview

This guide provides curl commands to test the MetaAPI token generation function after deployment.

## Environment Setup

Before testing, ensure the following environment variable is set in Netlify Dashboard:

```bash
METAAPI_ADMIN_TOKEN=your_actual_admin_token_here
```

You also need your MetaAPI account ID (from `.env`):

```bash
VITE_METAAPI_ACCOUNT_ID=your_account_id_here
```

## Test Commands

### 1. Test Successful Token Generation (POST with valid accountId)

```bash
curl -X POST https://your-site.netlify.app/.netlify/functions/get-metaapi-token \
  -H "Content-Type: application/json" \
  -d '{"accountId":"YOUR_ACCOUNT_ID_HERE"}'
```

**Expected Response (200):**
```json
{
  "token": "eyJhbGciOiJSUzUxMiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600
}
```

### 2. Test Missing accountId Error (400)

```bash
curl -X POST https://your-site.netlify.app/.netlify/functions/get-metaapi-token \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected Response (400):**
```json
{
  "error": "Missing accountId in request body"
}
```

### 3. Test Invalid JSON Body Error (400)

```bash
curl -X POST https://your-site.netlify.app/.netlify/functions/get-metaapi-token \
  -H "Content-Type: application/json" \
  -d 'invalid-json'
```

**Expected Response (400):**
```json
{
  "error": "Invalid JSON body"
}
```

### 4. Test Method Not Allowed Error (405)

```bash
curl -X GET https://your-site.netlify.app/.netlify/functions/get-metaapi-token
```

**Expected Response (405):**
```json
{
  "error": "Method Not Allowed. Use POST."
}
```

### 5. Test OPTIONS Preflight Request (CORS)

```bash
curl -X OPTIONS https://your-site.netlify.app/.netlify/functions/get-metaapi-token \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type" \
  -v
```

**Expected Response (200):**
- Status: 200
- Headers should include:
  - `Access-Control-Allow-Origin: *`
  - `Access-Control-Allow-Methods: POST, OPTIONS`

### 6. Test Local Development (if running Netlify Dev)

```bash
# Start Netlify Dev locally first
netlify dev

# Then test the local endpoint
curl -X POST http://localhost:8888/.netlify/functions/get-metaapi-token \
  -H "Content-Type: application/json" \
  -d '{"accountId":"YOUR_ACCOUNT_ID_HERE"}'
```

## Verification Checklist

After deployment, verify the following:

- [ ] Token generation succeeds with valid accountId (200 response)
- [ ] Missing accountId returns proper error (400 response)
- [ ] Invalid JSON returns proper error (400 response)
- [ ] Wrong HTTP method returns 405 error
- [ ] OPTIONS request returns proper CORS headers
- [ ] Function logs appear in Netlify Dashboard
- [ ] No admin token visible in response or logs
- [ ] Frontend successfully fetches tokens
- [ ] MetaAPI connection initializes without demo mode
- [ ] Browser DevTools shows no admin token exposure

## Troubleshooting

### Error: "Server misconfiguration: METAAPI_ADMIN_TOKEN missing"

**Solution:** Set `METAAPI_ADMIN_TOKEN` in Netlify Dashboard > Site settings > Environment variables, then redeploy.

### Error: "Failed to generate MetaAPI token"

**Possible Causes:**
1. Invalid admin token
2. Admin token expired
3. MetaAPI API is down
4. Account ID is invalid

**Solution:**
- Check Netlify function logs for detailed error message
- Verify admin token is valid in MetaAPI dashboard
- Ensure accountId matches your MetaAPI account

### Error: CORS issues in browser

**Solution:**
- Verify the function returns CORS headers
- Check CSP headers in `netlify.toml` allow MetaAPI domains
- Ensure frontend is calling the correct endpoint

### Function times out

**Solution:**
- Check Netlify function logs for errors
- Verify MetaAPI service is reachable
- Consider increasing timeout in `netlify.toml` (currently 10 seconds)

## Monitoring

View function logs in Netlify Dashboard:
```
Site > Functions > get-metaapi-token > View logs
```

Or via Netlify CLI:
```bash
netlify functions:log get-metaapi-token
```

Expected log patterns:
- No errors for successful requests
- Clear error messages for failed requests
- No sensitive token values logged

## Security Notes

- Admin token is never exposed to the frontend
- Generated tokens are short-lived (1 hour expiration)
- Tokens are scoped to specific account access
- CORS headers allow frontend to call the function
- No caching of token responses (Cache-Control not set, which is correct)

## Integration with Frontend

The frontend `token-manager.ts` automatically:
1. Calls this function when a token is needed
2. Caches the token for 55 minutes (5-minute buffer before expiration)
3. Automatically refreshes tokens before they expire
4. Handles errors gracefully and falls back to demo mode if needed

No manual frontend changes are required after deploying this function.
