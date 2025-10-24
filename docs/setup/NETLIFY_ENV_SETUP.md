# Netlify Environment Variable Setup - Quick Guide

## Critical Action Required

**You must set the `METAAPI_ADMIN_TOKEN` environment variable in Netlify Dashboard before the deployment will work properly.**

## Steps to Configure

### 1. Access Netlify Dashboard

1. Go to [Netlify Dashboard](https://app.netlify.com/)
2. Select your site: **pipnosis-ai-trading** (or your site name)
3. Click **Site settings** in the top navigation
4. Click **Environment variables** in the left sidebar

### 2. Add METAAPI_ADMIN_TOKEN

Click **Add a variable** button and enter:

```
Key:   METAAPI_ADMIN_TOKEN
Value: [Your MetaAPI admin token from MetaAPI dashboard]
Scope: Production, Deploy Previews, Branch Deploys (all selected)
```

**Important:** This is your actual admin token that was previously in `VITE_METAAPI_TOKEN`. Get it from:
- Your existing `.env` file (if you have it locally)
- MetaAPI Dashboard > Account > API Tokens

### 3. Remove Old Variable (if exists)

If you see `VITE_METAAPI_TOKEN` in the list:
1. Click the **...** menu next to it
2. Select **Delete**
3. Confirm deletion

This variable is no longer needed and should be removed for security.

### 4. Verify Required Variables

Ensure these variables are set (should already exist):

```bash
✓ VITE_METAAPI_ACCOUNT_ID=8845e940-c372-4a3d-9f7e-66288924c46f
✓ VITE_METAAPI_REGION=new-york
✓ VITE_SUPABASE_URL=[your Supabase URL]
✓ VITE_SUPABASE_ANON_KEY=[your Supabase anon key]
✓ SUPABASE_SERVICE_ROLE_KEY=[your Supabase service role key]
✓ ADMIN_REFRESH_KEY=[your admin refresh key]
✓ METAAPI_ADMIN_TOKEN=[your MetaAPI admin token] ← NEW
```

### 5. Trigger Rebuild

After adding the environment variable, the current deployment should automatically work. If not:

**Option 1: Via Dashboard**
1. Go to **Deploys** tab
2. Click **Trigger deploy** button
3. Select **Deploy site**

**Option 2: Via Command Line**
```bash
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

## Verification

After deployment completes:

### 1. Check Function Logs

```bash
# Via Netlify CLI
netlify functions:log get-metaapi-token --live

# Or in Dashboard
Deploys > [Latest Deploy] > Functions > get-metaapi-token > View logs
```

Look for:
```
✓ Generating temporary token for account: 8845e940-...
✓ Successfully generated temporary token
```

### 2. Test Token Endpoint

```bash
curl -X POST https://your-site.netlify.app/.netlify/functions/get-metaapi-token \
  -H "Content-Type: application/json" \
  -d '{"accountId":"8845e940-c372-4a3d-9f7e-66288924c46f"}'
```

Expected response:
```json
{
  "token": "eyJ0eXAiOiJKV1Q...",
  "expiresIn": 3600,
  "accountId": "8845e940-c372-4a3d-9f7e-66288924c46f"
}
```

### 3. Check Application

1. Open your application in browser
2. Open DevTools > Console
3. Look for these logs:
   ```
   Fetching secure temporary token from backend...
   ✓ Received secure temporary token
   Initializing MetaApi connection...
   ✓ MetaApi initialized successfully
   ```
4. **Verify NO "demo mode" warning appears**

## Troubleshooting

### Error: "METAAPI_ADMIN_TOKEN environment variable not set"

**Solution:**
1. Double-check variable name is exactly: `METAAPI_ADMIN_TOKEN` (case-sensitive)
2. Verify variable is set for Production scope
3. Trigger a new deploy after setting variable

### Error: "Invalid admin token" or 401 Unauthorized

**Solution:**
1. Verify token is correct (copy from MetaAPI dashboard)
2. Check token hasn't expired
3. Ensure token has full API access permissions

### Error: "Failed to generate token"

**Solution:**
1. Check Netlify function logs for detailed error
2. Verify MetaAPI account is active
3. Test token directly in MetaAPI dashboard

## Security Notes

⚠️ **NEVER commit `METAAPI_ADMIN_TOKEN` to git**

- Keep it only in Netlify Dashboard
- Don't add it to `.env` files that are committed
- Rotate token every 90 days for security
- If token is compromised, regenerate immediately in MetaAPI dashboard

## Summary

**Before:** Admin token exposed in browser as `VITE_METAAPI_TOKEN` ❌

**After:** Admin token secured in backend as `METAAPI_ADMIN_TOKEN` ✅

This change:
- ✅ Resolves demo mode issue
- ✅ Secures admin credentials
- ✅ Implements temporary token system
- ✅ Maintains full functionality
- ✅ No user-facing changes needed

## Need Help?

If you encounter issues:
1. Check Netlify function logs
2. Verify environment variable is set correctly
3. Test token endpoint with curl
4. Review browser console for errors
5. Check `SECURE_TOKEN_DEPLOYMENT_GUIDE.md` for detailed troubleshooting
