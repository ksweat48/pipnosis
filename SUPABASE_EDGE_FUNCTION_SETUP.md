# Supabase Edge Function Configuration Guide

## Quick Setup

### Step 1: Access Supabase Dashboard

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project: `nzisgxdlydihlwsvonfy`
3. Navigate to `Project Settings` (gear icon in bottom left)

### Step 2: Configure Environment Variables

1. Click on `Edge Functions` in the left sidebar
2. Click on the `Secrets` tab
3. Click `Add new secret`

### Step 3: Add Required Secrets

Add the following environment variables:

#### Required: METAAPI_TOKEN

```
Name: METAAPI_TOKEN
Value: eyJhbGciOiJSUzUxMiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI1MDUzN2VhZWFjOGIyYWMxZmY4ZWQ2MTRhMjkzZjZkOCIsImFjY2Vzc1J1bGVzIjpbeyJpZCI6InRyYWRpbmctYWNjb3VudC1tYW5hZ2VtZW50LWFwaSIsIm1ldGhvZHMiOlsidHJhZGluZy1hY2NvdW50LW1hbmFnZW1lbnQtYXBpOnJlc3Q6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcmVzdC1hcGkiLCJtZXRob2RzIjpbIm1ldGFhcGktYXBpOnJlc3Q6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcnBjLWFwaSIsIm1ldGhvZHMiOlsibWV0YWFwaS1hcGk6d3M6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcmVhbC10aW1lLXN0cmVhbWluZy1hcGkiLCJtZXRob2RzIjpbIm1ldGFhcGktYXBpOndzOnB1YmxpYzoqOioiXSwicm9sZXMiOlsicmVhZGVyIiwid3JpdGVyIl0sInJlc291cmNlcyI6WyIqOiRVU0VSX0lEJDoqIl19LHsiaWQiOiJtZXRhc3RhdHMtYXBpIiwibWV0aG9kcyI6WyJtZXRhc3RhdHMtYXBpOnJlc3Q6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6InJpc2stbWFuYWdlbWVudC1hcGkiLCJtZXRob2RzIjpbInJpc2stbWFuYWdlbWVudC1hcGk6cmVzdDpwdWJsaWM6KjoqIl0sInJvbGVzIjpbInJlYWRlciIsIndyaXRlciJdLCJyZXNvdXJjZXMiOlsiKjokVVNFUl9JRCQ6KiJdfSx7ImlkIjoiY29weWZhY3RvcnktYXBpIiwibWV0aG9kcyI6WyJjb3B5ZmFjdG9yeS1hcGk6cmVzdDpwdWJsaWM6KjoqIl0sInJvbGVzIjpbInJlYWRlciIsIndyaXRlciJdLCJyZXNvdXJjZXMiOlsiKjokVVNFUl9JRCQ6KiJdfSx7ImlkIjoibXQtbWFuYWdlci1hcGkiLCJtZXRob2RzIjpbIm10LW1hbmFnZXItYXBpOnJlc3Q6ZGVhbGluZzoqOioiLCJtdC1tYW5hZ2VyLWFwaTpyZXN0OnB1YmxpYzoqOioiXSwicm9sZXMiOlsicmVhZGVyIiwid3JpdGVyIl0sInJlc291cmNlcyI6WyIqOiRVU0VSX0lEJDoqIl19LHsiaWQiOiJiaWxsaW5nLWFwaSIsIm1ldGhvZHMiOlsiYmlsbGluZy1hcGk6cmVzdDpwdWJsaWM6KjoqIl0sInJvbGVzIjpbInJlYWRlciJdLCJyZXNvdXJjZXMiOlsiKjokVVNFUl9JRCQ6KiJdfV0sImlnbm9yZVJhdGVMaW1pdHMiOmZhbHNlLCJ0b2tlbklkIjoiMjAyMTAyMTMiLCJpbXBlcnNvbmF0ZWQiOmZhbHNlLCJyZWFsVXNlcklkIjoiNTA1MzdlYWVhYzhiMmFjMWZmOGVkNjE0YTI5M2Y2ZDgiLCJpYXQiOjE3NTk2MzY3MzV9.ZK59_Hut8Ly_UQyYyKYEYn6dMDOaVee5OX8ejjALAF3c7uSRpIEafWER8Qnpga95LX6ZPof_gs-_1Ha6gYW-AUFy_S5B0y_pA-puj_RcrxdrEngfqNnwC4kYqGuobP_XXFQb7xlg3aEAarHXgkC-Qzkgyisj_0Qp4suVVtXeucGthlzPNID9YVAZyH0ggdq8rAHlQFoTIKsz9iBwBBKIlAgQp8R1phH32Cs-ARb9ds5hhHqRJXUGF_vERqbsmr3GejS2co4xjkpCN5zdy0kA6y96Bb0lBshhps3_v8Vl_SQqGXli08vRSx9cLe2RWXdvmIT8BYIRkjsOlGTpbUrRqCBoW3IYX9dC6-yhpqbDy2kSVxTeu5JRXJ-HX4rs7C7DBZEd7Zbkyxg4L26PlCR5NiNF8fTRdqzVTt9IV2Q_i4eCVbWfx4JvKu5-PTGdrA3HjAgkOlDlOQL804pkpfVM6909dEFlTlPajTBg3iZol7Llzn2ziduga0uSvkiVGdKIeH_Z7dbsx38eQ3y_5dVEhQdwSkOtcuB1iJBCGtVb7V4pPbSrJPfJzRsi2hWYqnBzoEI-1uArUAEriiL2CI48IOTUV8z8cbuzIBSbyncUxip87r_WKKuHXqRt8lpaF2NK_G3fCt9nw3un9C6PahCrbVBC9gGairuV6-Xo-jw-wlw
```

**Purpose:** This is your MetaAPI admin token. The edge function uses it to create secure, short-lived tokens.

**Important:** This is the same value as your `VITE_METAAPI_TOKEN` from the `.env` file.

#### Optional: DENO_TLS_CA_STORE (Only if SSL errors occur)

```
Name: DENO_TLS_CA_STORE
Value: mozilla,system
```

**Purpose:** Expands the SSL certificate authorities that Deno trusts. Only add this if you see SSL certificate errors.

**When to add:** If the edge function logs show errors like:
- "invalid peer certificate: Expired"
- "invalid peer certificate: UnknownIssuer"
- "ERR_CERT_AUTHORITY_INVALID"

### Step 4: Verify Configuration

After adding the secrets:

1. The secrets should appear in the list with masked values
2. You should see:
   - `METAAPI_TOKEN` (required)
   - `DENO_TLS_CA_STORE` (optional, only if SSL errors)

### Step 5: Redeploy Edge Functions (if needed)

If your edge functions are already deployed, you may need to redeploy them to pick up the new environment variables:

1. Go to `Edge Functions` in the Supabase dashboard
2. Find the `metaapi-token` function
3. Click the `...` menu and select `Redeploy`

Alternatively, the next code deployment will automatically pick up the new environment variables.

## Verification

### Check Edge Function Logs

1. In Supabase Dashboard, go to `Edge Functions`
2. Click on `metaapi-token` function
3. Click on `Logs` tab
4. Look for:
   ```
   DENO_TLS_CA_STORE: mozilla,system (or "not set" if not configured)
   Attempting to create token for account...
   ```

### Test from Application

1. Open your application in the browser
2. Open browser DevTools console (F12)
3. Look for these log messages:
   - ✅ "🔑 Fetching secure MetaAPI token from edge function..."
   - ✅ "✅ Secure MetaAPI token obtained successfully"

If you see these messages, the configuration is working correctly!

### Test Edge Function Directly

You can test the edge function directly using curl:

```bash
curl -X POST https://nzisgxdlydihlwsvonfy.supabase.co/functions/v1/metaapi-token \
  -H "Authorization: Bearer YOUR_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -H "apikey: YOUR_SUPABASE_ANON_KEY" \
  -d '{"accountId": "c9991ce7-f9ab-49fd-bc67-12839e567e8f", "region": "new-york"}'
```

Expected response:
```json
{
  "token": "eyJ...",
  "expiresAt": "2025-10-19T...",
  "region": "new-york"
}
```

## Troubleshooting

### "MetaAPI configuration error"

**Cause:** `METAAPI_TOKEN` is not set in edge function secrets.

**Solution:**
1. Go to Supabase Dashboard > Edge Functions > Secrets
2. Add `METAAPI_TOKEN` with your MetaAPI admin token value
3. Redeploy the edge function

### "Invalid peer certificate: Expired"

**Cause:** Deno doesn't trust MetaAPI's SSL certificate.

**Solution:**
1. Go to Supabase Dashboard > Edge Functions > Secrets
2. Add `DENO_TLS_CA_STORE` with value `mozilla,system`
3. Redeploy the edge function

### Edge function returns 500 error

**Check the logs:**
1. Supabase Dashboard > Edge Functions > metaapi-token > Logs
2. Look for the specific error message
3. Common issues:
   - Missing `METAAPI_TOKEN` environment variable
   - Invalid MetaAPI token (expired or incorrect)
   - SSL certificate validation failure
   - MetaAPI API is down

### Token generation fails silently

**Check browser console:**
1. Open DevTools (F12)
2. Go to Console tab
3. Look for error messages starting with:
   - "Token fetch failed:"
   - "Failed to fetch secure token:"

**Check network requests:**
1. Open DevTools (F12)
2. Go to Network tab
3. Filter by "metaapi-token"
4. Check the response status and body

## Security Notes

1. **Never commit** `METAAPI_TOKEN` to git or expose it publicly
2. **Edge function secrets** are encrypted and only accessible server-side
3. **Generated tokens** are short-lived (24 hours) and read-only
4. **Client only receives** temporary tokens, never the admin token

## Additional Resources

- [Supabase Edge Functions Documentation](https://supabase.com/docs/guides/functions)
- [Deno TLS Configuration](https://deno.land/manual/runtime/tls_configuration)
- [MetaAPI Token Management API](https://metaapi.cloud/docs/client/tokenManagement/)

---

**Last Updated:** 2025-10-18
**Status:** Ready for configuration
