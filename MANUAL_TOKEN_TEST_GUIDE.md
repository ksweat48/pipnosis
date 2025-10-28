# Manual Token Testing Guide

## Overview

The MetaAPI Direct Test page now supports manual token input, allowing you to test your MetaAPI connection by directly providing your token, bypassing any environment variable issues.

## How to Use

### Access the Test Page

Navigate to: `https://your-site.netlify.app/test-metaapi-direct`

### Option 1: Test with Environment Variables (Default)

1. Click **"Test with Environment Variables"** button
2. This will use the tokens stored in Netlify environment variables
3. The function checks for tokens in this priority order:
   - `METAAPI_ADMIN_TOKEN` (current standard)
   - `METAAPI_TOKEN` (legacy fallback)

### Option 2: Test with Manual Token Input

1. **Check the box**: "Use manual token input (bypasses environment variables)"
2. **Enter your MetaAPI token**:
   - Get your token from [MetaAPI Dashboard → Account → API Tokens](https://app.metaapi.cloud/)
   - Paste it into the "MetaAPI Token" field
   - Use the lock/unlock icon to show/hide the token
3. **Optional**: Enter Account ID
   - If left empty, uses the environment default
   - Format: `8845e940-c372-4a3d-9f7e-66288924c46f`
4. **Select Region**:
   - London (default)
   - New York
   - Singapore
   - Tokyo
5. Click **"Test with Manual Token"** button

## Understanding the Results

### 🟢 GREEN LIGHT - Success

If you see "GREEN LIGHT - MetaAPI is working!", the test succeeded. The results will show:

- **Token Source**: Where the token came from
  - `manual_input` - You entered it manually
  - `METAAPI_ADMIN_TOKEN` - From environment variable
  - `METAAPI_TOKEN` - From legacy environment variable
- **Token Length**: Number of characters (for verification)
- **Account Information**: Your MetaAPI account details
- **Symbol Count**: Number of trading symbols available
- **Current Price**: Live EURUSD price data
- **Configuration**: Region and Account ID used

**What this means**: MetaAPI connection is working correctly. If your app still has issues, the problem is in the Pipnosis integration code, not MetaAPI.

### 🔴 RED LIGHT - Failure

If you see "RED LIGHT - MetaAPI connection failed!", check the error details:

#### "Token missing"

**Environment Variable Test:**
- Check if `METAAPI_ADMIN_TOKEN` is set in Netlify Dashboard
- Go to: Site Settings → Environment Variables
- Add the variable and redeploy

**Manual Token Test:**
- Verify you checked "Use manual token input"
- Verify you entered the token correctly
- Check for extra spaces or characters

#### "HTTP 401" or "Invalid token"

**Possible causes:**
- Token is incorrect (copy/paste error)
- Token has expired
- Token doesn't have proper permissions
- Account ID doesn't match the token

**Solution:**
1. Go to [MetaAPI Dashboard](https://app.metaapi.cloud/)
2. Navigate to Account → API Tokens
3. Verify the token or generate a new one
4. Test again with the correct token

#### "HTTP 404" or "Account not found"

**Possible causes:**
- Incorrect Account ID
- Account not deployed in MetaAPI dashboard
- Wrong region selected

**Solution:**
1. Verify Account ID in MetaAPI dashboard
2. Check account deployment status
3. Try different regions (New York, London, Singapore, Tokyo)

#### "HTTP 403" or "Access denied"

**Possible causes:**
- Token doesn't have access to the account
- Account is not properly connected

**Solution:**
1. Verify token permissions in MetaAPI dashboard
2. Check account connection status
3. Ensure account is deployed and running

## Security Warning

⚠️ **Important Security Notes:**

1. **Do not share screenshots** containing your token
2. **Use this feature only in secure environments**
3. The token is sent via HTTPS POST (encrypted in transit)
4. The token is never stored or logged in full
5. Clear your browser cache after testing if on a shared computer

## Diagnostic Information

When a test runs, you'll see diagnostic information:

### In Browser Console

```
🧪 Starting direct MetaAPI test...
🔑 Using manual token input
  Token length: 128
  Account ID: 8845e940-c372-4a3d-9f7e-66288924c46f
  Region: london
Test result: {...}
```

### In Netlify Function Logs

```
🧪 DIRECT METAAPI TEST - NO PIPNOSIS CODE
🔑 Token source: manual_input
📋 Environment Check:
  Token Source: manual_input
  Token: ✓ Present (length: 128, preview: eyJ0...aXQi)
  Account ID: 8845e940-c372-4a3d-9f7e-66288924c46f
  Region: london
```

## Process of Elimination

This test helps identify where the problem is:

| Test Result | What It Means | Next Steps |
|------------|---------------|------------|
| Manual Token: 🟢 GREEN<br>Environment: 🔴 RED | Token is valid, but environment variables are wrong | Fix Netlify environment variables |
| Manual Token: 🔴 RED<br>Environment: 🔴 RED | Token or MetaAPI setup is wrong | Check MetaAPI dashboard, verify token |
| Manual Token: 🟢 GREEN<br>Environment: 🟢 GREEN | Everything works | Issue is in Pipnosis integration code |

## Troubleshooting Tips

### Token Format Verification

A valid MetaAPI token should:
- Be approximately 100-200 characters long
- Contain alphanumeric characters
- May start with "eyJ" if it's a JWT format

### Region Selection

If one region fails, try others:
- Your account might be deployed in a specific region
- Check MetaAPI dashboard for the correct region
- Most US accounts use "new-york"
- Most EU accounts use "london"

### Network Issues

If all tests fail:
- Check your internet connection
- Verify no firewall is blocking `*.agiliumtrade.ai`
- Try from a different network
- Check if MetaAPI status page shows any outages

## Getting Your MetaAPI Token

1. Go to https://app.metaapi.cloud/
2. Log in to your account
3. Navigate to **Account → API Tokens**
4. Copy your existing token or create a new one
5. Paste it into the manual token field

## Need More Help?

If issues persist after testing:

1. **Check Netlify function logs**:
   ```bash
   netlify functions:log test-metaapi-direct --live
   ```

2. **Review environment variables**:
   - Netlify Dashboard → Site Settings → Environment Variables
   - Verify `METAAPI_ADMIN_TOKEN` is set
   - Ensure no typos in variable names

3. **Test token directly in MetaAPI dashboard**:
   - Use MetaAPI's built-in API explorer
   - Verify the token works there first

4. **Review related documentation**:
   - `NETLIFY_ENV_SETUP.md` - Environment variable setup
   - `SECURE_TOKEN_DEPLOYMENT_GUIDE.md` - Detailed token configuration
   - `METAAPI_SETUP.md` - MetaAPI account setup

## Summary

This manual token testing feature gives you immediate diagnostic capability to:

✅ Test your MetaAPI token without waiting for deployment
✅ Bypass environment variable issues during troubleshooting
✅ Verify token validity and permissions
✅ Identify whether issues are with MetaAPI or Pipnosis code
✅ Test different regions and account IDs quickly

Use this tool whenever you need to verify your MetaAPI connection is working correctly.
