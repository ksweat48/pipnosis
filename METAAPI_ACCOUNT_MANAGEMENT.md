# MetaAPI Account Management System

**Status**: ✅ Implemented
**Date**: 2025-12-02
**Version**: 1.0

---

## Overview

The MetaAPI Account Management System provides **automatic failover** between primary and fallback MetaAPI accounts with intelligent error detection and recovery.

### Key Features

- **Automatic Failover**: Switches to fallback account on auth/service errors
- **Smart Recovery**: Automatically retries primary account every 5 minutes
- **Error Classification**: Only fails over on specific error codes (401, 403, 404, 503, 504)
- **Performance Tracking**: Records success/failure rates for both accounts
- **Health Monitoring**: Real-time status via HTTP endpoint
- **Zero Downtime**: Seamless account switching without interrupting service

---

## Account Configuration

### Primary Account (NEW LIVE)
- **ID**: `28867898-bcc5-4a8d-969f-1acc6073eae2`
- **Purpose**: Main production account for all MetaAPI requests
- **Region**: `london`

### Fallback Account (OLD)
- **ID**: `169ff8dd-bb46-4618-91b4-28f696fba223`
- **Purpose**: Backup account used when primary fails
- **Region**: `london`

---

## How It Works

### Normal Operation

```
1. Request comes in
2. System uses PRIMARY account
3. Request succeeds ✓
4. Mark PRIMARY as healthy
5. Continue using PRIMARY
```

### Failure & Fallback

```
1. Request comes in
2. System uses PRIMARY account
3. Request fails with 401/403/404/503/504 ❌
4. Mark PRIMARY as failed (count: 1)
5. Next request tries PRIMARY again
6. Request fails again ❌
7. Mark PRIMARY as failed (count: 2)
8. SWITCH TO FALLBACK ACCOUNT ⚠️
9. All future requests use FALLBACK
10. PRIMARY is retried every 5 minutes
```

### Recovery to Primary

```
1. System is using FALLBACK
2. 5 minutes pass since last PRIMARY test
3. System tests PRIMARY account
4. PRIMARY request succeeds ✓
5. SWITCH BACK TO PRIMARY ✅
6. Normal operation resumes
```

---

## Error Classification

### Errors that Trigger Fallback

| Code | Description | Why Fallback? |
|------|-------------|---------------|
| 401 | Unauthorized | Invalid/expired token or account credentials |
| 403 | Forbidden | Account doesn't have required permissions |
| 404 | Not Found | Account not deployed or deleted |
| 503 | Service Unavailable | MetaAPI service is down |
| 504 | Gateway Timeout | MetaAPI gateway not responding |

### Errors that DO NOT Trigger Fallback

| Code | Description | Why No Fallback? |
|------|-------------|------------------|
| 429 | Rate Limit | Temporary, wait and retry same account |
| 500 | Internal Server Error | Transient, may work on retry |
| Network Timeout | Connection timeout | Network issue, not account issue |

**Rationale**: We only fallback when the error is specifically related to the account itself, not temporary network or rate limit issues.

---

## Configuration

### Environment Variables (CRITICAL - YOU MUST SET THESE)

#### Netlify Dashboard
Navigate to: `Netlify Dashboard → Site Settings → Environment Variables`

Add these TWO variables:

```
METAAPI_ACCOUNT_ID = 28867898-bcc5-4a8d-969f-1acc6073eae2
METAAPI_ACCOUNT_ID_FALLBACK = 169ff8dd-bb46-4618-91b4-28f696fba223
```

#### Supabase Dashboard (If using Edge Functions)
Navigate to: `Supabase Dashboard → Project Settings → Edge Functions`

Add the same variables:

```
METAAPI_ACCOUNT_ID = 28867898-bcc5-4a8d-969f-1acc6073eae2
METAAPI_ACCOUNT_ID_FALLBACK = 169ff8dd-bb46-4618-91b4-28f696fba223
```

#### Local Development (.env file)

```bash
METAAPI_ACCOUNT_ID=28867898-bcc5-4a8d-969f-1acc6073eae2
METAAPI_ACCOUNT_ID_FALLBACK=169ff8dd-bb46-4618-91b4-28f696fba223
METAAPI_REGION=london
```

---

## Monitoring

### Health Check Endpoint

**URL**: `https://pipnosis.com/.netlify/functions/metaapi-health-check`

**Response**:
```json
{
  "ok": true,
  "hasFallback": true,
  "currentActive": "primary",
  "lastSwitch": null,
  "primary": {
    "accountId": "28867898-...",
    "status": "healthy",
    "lastSuccess": "2025-12-02T10:30:00Z",
    "lastFailure": null,
    "consecutiveFailures": 0,
    "totalRequests": 150,
    "successfulRequests": 150,
    "successRate": 100,
    "timeSinceSuccess": 5000,
    "timeSinceFailure": null
  },
  "fallback": {
    "accountId": "169ff8dd-...",
    "status": "unknown",
    "lastSuccess": null,
    "lastFailure": null,
    "consecutiveFailures": 0,
    "totalRequests": 0,
    "successfulRequests": 0,
    "successRate": null,
    "timeSinceSuccess": null,
    "timeSinceFailure": null
  }
}
```

### Health Status Values

- **healthy**: Account working normally (recent success, no failures)
- **degraded**: One failure but recovered
- **failing**: 2+ consecutive failures, switched to fallback
- **unknown**: No requests yet or can't determine status

### Manual Reset to Primary

**URL**: `POST https://pipnosis.com/.netlify/functions/metaapi-health-check?action=reset`

Forces immediate switch back to primary account.

---

## Checking Which Account is Active

### Method 1: Check Netlify Function Logs

Navigate to: `Netlify Dashboard → Functions → continuous-price-collector`

Look for logs like:
```
[PriceCollector:exec_123] Using MetaAPI Account: 28867898...
```

### Method 2: Check Health Endpoint

```bash
curl https://pipnosis.com/.netlify/functions/metaapi-health-check
```

Look at `currentActive` field:
- `"primary"` = using new live account
- `"fallback"` = using old account

### Method 3: Check Admin Dashboard (Future)

When the UI component is added, you'll see real-time status in the Admin Dashboard.

---

## Files Modified

### Core Service
- `src/services/metaapi-account-manager.ts` (NEW) - Account management logic

### Netlify Functions (Updated)
- `netlify/functions/continuous-price-collector.ts` ← **Critical** (runs every minute)
- `netlify/functions/fill-candle-gaps.ts` ← **Critical** (runs every 5 min)
- `netlify/functions/get-live-price.ts`
- `netlify/functions/verify-metaapi-account.ts`

### New Functions
- `netlify/functions/metaapi-health-check.ts` (NEW) - Health monitoring endpoint

### Environment Files
- `.env` - Updated with new primary and fallback IDs
- `.env.example` - Documented fallback configuration

---

## Testing

### Test 1: Verify Primary Account is Active

1. Deploy changes to production
2. Wait 1-2 minutes for functions to run
3. Check Netlify logs: Should see `Using MetaAPI Account: 28867898...`
4. Check health endpoint: Should show `"currentActive": "primary"`

### Test 2: Test Fallback Trigger (DO NOT RUN IN PRODUCTION)

1. Temporarily change `METAAPI_ACCOUNT_ID` in Netlify to an invalid value
2. Wait 2-3 minutes (2 failures needed)
3. Check logs: Should see "SWITCHING TO FALLBACK"
4. Check health endpoint: Should show `"currentActive": "fallback"`
5. Restore correct `METAAPI_ACCOUNT_ID`
6. Wait 5 minutes
7. Check logs: Should see "PRIMARY ACCOUNT RECOVERED"
8. Check health endpoint: Should show `"currentActive": "primary"`

### Test 3: Verify Persistence After Browser Close

1. Close ALL browser windows
2. Wait 5 minutes
3. Reopen browser and check data
4. Should see continuous data collection (no 5-minute gap)
5. Verify account switching logs if any

---

## Troubleshooting

### Problem: Both Accounts Failing

**Symptoms**:
- Logs show "Both primary and fallback accounts are failing"
- Health endpoint shows both accounts in "failing" status

**Causes**:
- MetaAPI service is down globally
- Both account tokens are invalid
- Network connectivity issues
- Both accounts not deployed

**Solution**:
1. Check MetaAPI status: https://status.metaapi.cloud/
2. Verify both accounts are deployed in MetaAPI dashboard
3. Check account credentials are correct in Netlify
4. Test accounts manually via MetaAPI dashboard

### Problem: Stuck on Fallback Account

**Symptoms**:
- Health endpoint shows `"currentActive": "fallback"` for > 10 minutes
- Logs don't show primary recovery attempts

**Causes**:
- Primary account is still failing
- Primary retry interval not elapsed yet
- Code not checking primary account

**Solution**:
1. Check primary account status in MetaAPI dashboard
2. Verify primary account is deployed and active
3. Wait 5+ minutes for automatic retry
4. Manual reset: `POST /metaapi-health-check?action=reset`
5. Check logs for "testing primary account" messages

### Problem: Switching Too Frequently

**Symptoms**:
- Logs show constant switching between accounts
- Health endpoint shows `lastSwitch` changes every few minutes

**Causes**:
- Intermittent network issues
- Account permissions fluctuating
- Rate limiting triggering false positives

**Solution**:
1. Check network stability
2. Verify account has consistent permissions
3. Review error logs for specific error codes
4. Consider increasing failure threshold (currently 2)

### Problem: Environment Variables Not Applied

**Symptoms**:
- Logs still show old account ID
- Changes not reflected after deploy

**Causes**:
- Forgot to update Netlify environment variables
- Cached function instances using old values
- Updated wrong environment (preview vs production)

**Solution**:
1. Go to Netlify Dashboard → Environment Variables
2. Verify `METAAPI_ACCOUNT_ID` and `METAAPI_ACCOUNT_ID_FALLBACK` are set correctly
3. Check "Scopes" - should include "Production"
4. Trigger new deploy after updating variables
5. Check function logs after deploy completes

---

## Best Practices

### DO:
- ✅ Set both primary and fallback accounts in Netlify
- ✅ Monitor health endpoint regularly
- ✅ Check logs when switching occurs
- ✅ Test fallback system in staging first
- ✅ Keep both accounts deployed and active
- ✅ Use same region for both accounts

### DON'T:
- ❌ Remove fallback account (reduces reliability)
- ❌ Use different regions for primary/fallback
- ❌ Manually switch accounts without reason
- ❌ Ignore health check warnings
- ❌ Deploy primary account changes without testing

---

## Future Enhancements

### UI Dashboard (Planned)
- Real-time account status display
- Visual health indicators
- Manual reset button
- Historical switching logs
- Performance graphs

### Advanced Features (Consideration)
- Multiple fallback accounts
- Geographic load balancing
- Automatic account rotation
- Predictive failure detection
- Email alerts on account switching

---

## Support

### Quick Links
- MetaAPI Dashboard: https://app.metaapi.cloud/
- MetaAPI Documentation: https://metaapi.cloud/docs/
- Health Check Endpoint: https://pipnosis.com/.netlify/functions/metaapi-health-check

### Contact
If you encounter issues not covered in this guide:
1. Check Netlify function logs first
2. Check health endpoint response
3. Verify environment variables are set
4. Review error messages in logs
5. Test accounts manually in MetaAPI dashboard

---

## Summary

**The account management system is now active and will:**

1. ✅ Use your new live account (28867898-...) as primary
2. ✅ Automatically fall back to old account (169ff8dd-...) if primary fails
3. ✅ Retry primary account every 5 minutes when on fallback
4. ✅ Switch back to primary automatically when it recovers
5. ✅ Track performance and health of both accounts
6. ✅ Provide real-time monitoring via health endpoint

**Critical Next Steps:**

1. **YOU MUST** update `METAAPI_ACCOUNT_ID` and `METAAPI_ACCOUNT_ID_FALLBACK` in Netlify Dashboard
2. **YOU MUST** update the same variables in Supabase Dashboard (if using edge functions)
3. Verify new account ID appears in function logs after deploy
4. Monitor health endpoint to confirm primary account is active
5. Test persistence with browser close scenario

**Remember**: The code changes are complete, but the system won't use your new account until you update the environment variables in Netlify and Supabase dashboards!
