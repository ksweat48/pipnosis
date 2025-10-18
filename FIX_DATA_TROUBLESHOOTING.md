# Fix Data Button - Troubleshooting Guide

## Quick Diagnostics

### Check Connection Status in Console

When you click Fix Data, the console will show:
```javascript
📊 Current connection status: {
  isConnected: false,
  isDemoMode: true,
  hasCredentials: true,
  initializationError: "...",
  accountState: "DEPLOYED",
  region: "new-york"
}
```

### Connection Test Results

```javascript
🔍 Connection test result: {
  success: true,
  stage: "complete",
  message: "Connection test passed. MetaAPI is ready.",
  details: {
    state: "DEPLOYED",
    region: "new-york",
    server: "ICMarkets-Demo"
  }
}
```

## Common Issues & Solutions

### Issue 1: "MetaAPI credentials not configured"

**Console Shows:**
```
❌ MetaAPI credentials not configured
```

**Cause:** Missing environment variables

**Solution:**
1. Check your `.env` file exists in project root
2. Verify it contains:
   ```env
   VITE_METAAPI_TOKEN=eyJhbGc...
   VITE_METAAPI_ACCOUNT_ID=abc123...
   VITE_METAAPI_REGION=new-york
   ```
3. Restart dev server after adding credentials
4. Hard refresh browser (Ctrl+Shift+R)

---

### Issue 2: "Region mismatch"

**Console Shows:**
```
❌ Connection test failed at stage: region_mismatch
Region mismatch: Account is in 'london' but SDK configured for 'new-york'
```

**Cause:** Your MetaAPI account is in a different region than configured

**Solution:**
1. Check your account region in MetaAPI dashboard
2. Update `.env` file:
   ```env
   VITE_METAAPI_REGION=london
   ```
3. Available regions: `new-york`, `london`, `singapore`
4. Restart dev server
5. Refresh browser

---

### Issue 3: "Account is not deployed"

**Console Shows:**
```
❌ Connection test failed at stage: account_state
Account is not deployed. Current state: UNDEPLOYED
```

**Cause:** MetaAPI account not active

**Solution:**
1. Go to [MetaAPI Dashboard](https://app.metaapi.cloud/)
2. Find your account
3. Click "Deploy" button
4. Wait for status to show "DEPLOYED" (may take 1-2 minutes)
5. Try Fix Data button again

---

### Issue 4: "Failed to fetch account"

**Console Shows:**
```
❌ Connection test failed at stage: account_fetch
Failed to fetch account: 401 Unauthorized
```

**Cause:** Invalid token or account ID

**Solution:**
1. Go to [MetaAPI Dashboard](https://app.metaapi.cloud/)
2. Navigate to Settings → API tokens
3. Copy the correct token
4. Navigate to Accounts and copy account ID
5. Update `.env`:
   ```env
   VITE_METAAPI_TOKEN=your_correct_token
   VITE_METAAPI_ACCOUNT_ID=your_correct_account_id
   ```
6. Restart dev server
7. Refresh browser

---

### Issue 5: Connection timeout

**Console Shows:**
```
❌ Failed to reconnect to MetaAPI: Connection timeout
Synchronization failed: TimeoutError
```

**Cause:** Network issue or account not connected to broker

**Solution:**
1. Check your internet connection
2. Verify MetaAPI dashboard shows account as "Connected"
3. Check broker server status (e.g., ICMarkets)
4. If broker is down, wait and retry later
5. If persistent, check firewall/proxy settings

---

### Issue 6: "Demo mode: Using cached candles"

**Console Shows:**
```
💾 Demo mode: Using 500 cached candles for XAUUSD M1
⚠️ MetaAPI not available, can only validate existing data
```

**Cause:** MetaAPI failed to initialize on page load

**With the fix, this should now trigger automatic reconnection. If it still happens:**

**Solution:**
1. Check browser console for initialization errors
2. Look for earlier error messages about why MetaAPI failed
3. Clear browser cache and refresh
4. Try Fix Data button again (should auto-reconnect)
5. If still in demo mode, check credentials and account state

---

## Step-by-Step Verification

### 1. Verify Environment Variables

```bash
# In project root, check .env file
cat .env | grep VITE_METAAPI
```

Should show:
```
VITE_METAAPI_TOKEN=eyJhbGc...
VITE_METAAPI_ACCOUNT_ID=abc123-...
VITE_METAAPI_REGION=new-york
```

### 2. Check MetaAPI Dashboard

1. Login to https://app.metaapi.cloud/
2. Go to "Accounts"
3. Find your account
4. Verify:
   - ✅ Status: "DEPLOYED"
   - ✅ Connection: "Connected"
   - ✅ Region matches your .env
   - ✅ Broker server is online

### 3. Test in Browser Console

Open browser console and run:
```javascript
// Check if credentials are loaded
console.log('Has token:', !!import.meta.env.VITE_METAAPI_TOKEN);
console.log('Has account ID:', !!import.meta.env.VITE_METAAPI_ACCOUNT_ID);
console.log('Region:', import.meta.env.VITE_METAAPI_REGION);
```

### 4. Monitor Fix Data Process

When clicking Fix Data, you should see this sequence:

```
✅ Step 1: Check connection status
📊 Current connection status: { ... }

✅ Step 2: Test connection (if not connected)
🔍 Testing MetaAPI connection...
✓ Account fetched successfully

✅ Step 3: Force reconnect
🔄 Force reconnecting to MetaAPI...
Initializing MetaApi connection...
✓ Account deployed successfully
✓ Connected to streaming endpoint
✓ Synchronization completed
✅ MetaAPI connection established successfully

✅ Step 4: Fetch data
📡 Requesting 500 candles from MetaAPI for XAUUSD M1...
✅ Received 500 candles from MetaAPI

✅ Step 5: Save and verify
✅ Data quality improved from 17.4% to 98.5%
```

## Understanding Progress Messages

| Message | What It Means |
|---------|---------------|
| "Checking MetaAPI connection..." | Verifying if already connected |
| "Testing MetaAPI connection..." | Running lightweight connection test |
| "Running connection diagnostics..." | Checking credentials, account state, region |
| "Connecting to MetaAPI..." | Establishing full connection with streaming |
| "Clearing stale cache..." | Removing old cached data |
| "Fetching fresh data from MetaAPI..." | Requesting candles from broker |
| "[M5] Analyzing current data..." | Processing specific timeframe |
| "Validating and repairing data..." | Checking candle sequence integrity |
| "Saving to cache..." | Writing to Supabase database |
| "Reloading current chart..." | Refreshing UI with new data |

## Expected Time

| Phase | Typical Duration |
|-------|------------------|
| Connection test | 2-5 seconds |
| Force reconnection | 15-60 seconds |
| Fetch per timeframe | 5-15 seconds |
| Total (7 timeframes) | 2-4 minutes |

If it takes longer than 5 minutes, check for:
- Network issues
- Broker server problems
- Rate limiting (wait and retry)
- Account synchronization issues

## Success Indicators

### Console Output
```
✅ All 7 timeframes successfully backfilled!
Total: 4500 candles fetched and saved to database.
```

### UI Message
Green banner showing:
```
✅ All 7 timeframes successfully backfilled! Total: 4500 candles fetched and saved to database.
```

### Data Quality Improved
Chart header shows:
```
Data: 98% (0 gaps)  ← Previously: 17% (28 gaps)
```

### Chart Updates
- Chart displays more candles
- Gaps are filled
- Price action is continuous

## Still Having Issues?

### Check Supabase Edge Function

The token manager uses a Supabase Edge Function. Verify:

1. Function exists: `supabase/functions/metaapi-token/index.ts`
2. Function is deployed
3. Check edge function logs for errors

### Network Debugging

```javascript
// In browser console, test edge function directly
const response = await fetch(
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/metaapi-token`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify({
      accountId: import.meta.env.VITE_METAAPI_ACCOUNT_ID,
      region: import.meta.env.VITE_METAAPI_REGION
    })
  }
);
const data = await response.json();
console.log('Token response:', data);
```

### Database Connection

Verify Supabase is accessible:
```javascript
// In browser console
const { data, error } = await supabase
  .from('historical_candles')
  .select('symbol')
  .limit(1);
console.log('Database test:', { data, error });
```

## Getting More Help

If none of these solutions work:

1. **Copy full console output** during Fix Data attempt
2. **Note which stage fails** (credentials, account_fetch, connection, etc.)
3. **Check MetaAPI dashboard** for account status
4. **Verify .env values** (without sharing actual tokens)
5. **Note any network errors** in browser Network tab

With this information, the issue can be diagnosed and resolved quickly!
