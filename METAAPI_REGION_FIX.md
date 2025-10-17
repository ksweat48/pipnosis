# MetaAPI Region Configuration Fix

## Problem
The error "Failed to subscribe TimeoutError: It seems like the account is not connected to broker yet or SDK settings you use does not match the account region" occurs when:

1. The MetaAPI SDK region doesn't match your account's deployed region
2. The account is not properly connected to the broker
3. The account is not in a DEPLOYED state

## Solution

### 1. Configure the Correct Region

Add the `VITE_METAAPI_REGION` environment variable to your `.env` file:

```bash
VITE_METAAPI_REGION=new-york  # or london, or singapore
```

**Available Regions:**
- `new-york` - US region (default)
- `london` - EU region
- `singapore` - Asia region

### 2. Find Your Account's Region

To determine which region your MetaAPI account is in:

1. Log in to [MetaAPI Dashboard](https://app.metaapi.cloud/)
2. Go to your account details
3. Check the "Region" or "Server Location" field
4. Use that exact region name in your `.env` file

### 3. Verify Account Status

Before the app can connect, ensure:

1. **Account is Deployed**: In MetaAPI dashboard, account status must show "DEPLOYED"
2. **Broker Connected**: Your account must be connected to your broker
3. **Valid Credentials**: Broker login credentials must be correct
4. **Network Access**: Ensure WebSocket connectivity is not blocked

### 4. Update Your .env File

```bash
# Example for a US-based account
VITE_METAAPI_TOKEN=your_token_here
VITE_METAAPI_ACCOUNT_ID=your_account_id_here
VITE_METAAPI_REGION=new-york

# Example for an EU-based account
VITE_METAAPI_TOKEN=your_token_here
VITE_METAAPI_ACCOUNT_ID=your_account_id_here
VITE_METAAPI_REGION=london
```

## Enhanced Error Messages

The updated implementation now provides detailed error messages:

### Region Mismatch Error
```
Region mismatch: Account is in 'london' region but SDK is configured for 'new-york'.
Please set VITE_METAAPI_REGION=london in your .env file.
```

### Broker Connection Error
```
Broker connection error: Account is not connected to broker.
Please check MetaAPI dashboard and ensure:
1) Account is deployed
2) Broker credentials are correct
3) Region matches (current: new-york)
```

### Deployment Error
```
Account deployment timeout. Please ensure your account is deployed
and connected to broker in the MetaAPI dashboard.
```

## Troubleshooting Steps

### Step 1: Check MetaAPI Dashboard
1. Log in to MetaAPI dashboard
2. Verify account status is "DEPLOYED"
3. Confirm broker connection shows "Connected"
4. Note the region/server location

### Step 2: Update Environment Variables
1. Add or update `VITE_METAAPI_REGION` in your `.env` file
2. Ensure it matches the region from Step 1
3. Verify `VITE_METAAPI_TOKEN` and `VITE_METAAPI_ACCOUNT_ID` are correct

### Step 3: Restart the Application
```bash
# Clear any cached data
rm -rf node_modules/.vite

# Restart the dev server
npm run dev
```

### Step 4: Monitor Console Logs
The enhanced logging now shows:
```
Initializing MetaApi connection...
Region: new-york
Account ID: your-account-id
Account state: DEPLOYED
Account region: new-york
Broker server: ICMarkets-Demo01
✓ Account deployed successfully
Connecting to streaming endpoint at new-york.metaapi.cloud...
✓ Connected to streaming endpoint
Waiting for synchronization...
✓ Synchronization completed
✅ MetaApi initialized successfully with streaming connection
```

## What Changed

### Configuration Options Added
```typescript
new MetaApi(token, {
  application: 'Pipnosis',
  domain: `${region}.metaapi.cloud`,  // Dynamic region
  enableLatencyMonitor: false,
  requestTimeout: 60000,
  connectTimeout: 60000
})
```

### Enhanced Validation
- Region mismatch detection and clear error messages
- Broker connection status verification
- Deployment state validation
- Timeout handling with actionable error messages

### Better Logging
- Connection progress tracking
- Region and server information display
- Clear success/failure indicators
- Troubleshooting hints in error messages

## Common Issues

### Issue: "Region mismatch" Error
**Solution**: Update `VITE_METAAPI_REGION` to match your account's actual region

### Issue: "Not connected to broker" Error
**Solution**: Check MetaAPI dashboard, verify broker credentials, ensure account is deployed

### Issue: "Synchronization timeout" Error
**Solution**: Wait for account to fully deploy, check broker connection, verify network stability

### Issue: No error but no data
**Solution**: Check if account shows "Connected" in MetaAPI dashboard, verify region setting

## Additional Resources

- [MetaAPI Documentation](https://metaapi.cloud/docs/)
- [MetaAPI Account Setup Guide](https://metaapi.cloud/docs/client/websocket/api/connectToMetaTraderAccount/)
- [MetaAPI Regions](https://metaapi.cloud/docs/client/regions/)

## Support

If you continue to experience issues:

1. Check MetaAPI dashboard for account status
2. Verify all environment variables are set correctly
3. Review console logs for specific error messages
4. Contact MetaAPI support if account shows issues in dashboard
