# Quick Fix: MetaAPI Region Error

## The Error You're Seeing

```
Failed to subscribe TimeoutError: It seems like the account 8845e940-c372-4a3d-9f7e-66288924c46f
is not connected to broker yet or SDK settings you use does not match the account region.
```

## Quick Solution (3 Steps)

### Step 1: Find Your Account's Region

1. Go to [MetaAPI Dashboard](https://app.metaapi.cloud/)
2. Click on your account
3. Look for the region or server location (it will be one of: US, EU, or Asia)

### Step 2: Update Your .env File

Open your `.env` file and add this line:

**For US Region:**
```bash
VITE_METAAPI_REGION=new-york
```

**For EU Region:**
```bash
VITE_METAAPI_REGION=london
```

**For Asia Region:**
```bash
VITE_METAAPI_REGION=singapore
```

### Step 3: Restart the App

Stop your dev server (Ctrl+C) and restart it:
```bash
npm run dev
```

## How to Verify the Fix

After restarting, you should see in the console:

```
Initializing MetaApi connection...
Region: new-york (or london/singapore)
Account ID: your-account-id
Account state: DEPLOYED
Account region: new-york (should match your setting)
✓ Account deployed successfully
✓ Connected to streaming endpoint
✓ Synchronization completed
✅ MetaApi initialized successfully
```

## Still Having Issues?

### Check Account Status in MetaAPI Dashboard

Your account must show:
- **Status**: DEPLOYED (green)
- **Broker**: Connected (green)

If not:
1. Deploy the account in MetaAPI dashboard
2. Verify broker credentials are correct
3. Wait for account to fully connect (can take 1-2 minutes)

### Common Issues

**Issue**: "Region mismatch" error
- **Fix**: The region in your .env doesn't match your account's actual region. Update it to match.

**Issue**: "Not connected to broker" error
- **Fix**: Your account isn't connected to the broker in MetaAPI dashboard. Check broker credentials.

**Issue**: "Deployment timeout" error
- **Fix**: Account is taking too long to deploy. Check MetaAPI dashboard for deployment status.

## Complete Example .env Configuration

```bash
# Frontend Environment Variables
VITE_DEV_MODE=true

# Supabase Configuration
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_key

# MetaApi Configuration (This is what you need to fix!)
VITE_METAAPI_TOKEN=your_token_here
VITE_METAAPI_ACCOUNT_ID=your_account_id_here
VITE_METAAPI_REGION=new-york  # ← ADD THIS LINE WITH YOUR REGION

# Admin Configuration
ADMIN_REFRESH_KEY=your_secure_key
```

## What This Fix Does

The update adds proper region configuration to the MetaAPI connection. MetaAPI has servers in different regions (US, EU, Asia), and you must connect to the correct region where your account is deployed. The previous version didn't specify the region, causing the connection to fail.

## Need More Help?

See the detailed guide: `METAAPI_REGION_FIX.md`
