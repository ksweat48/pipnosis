# MetaAPI Token Generation Timeout Fix

## Date: October 23, 2025

## Problem Description

The MetaAPI token generation test was failing at step 4 (Generate Token) with timeout errors. The narrowDownToken API call was exceeding the configured 20-second timeout, causing the test to fail and preventing proper token generation for the application.

### Error Details
```
Failed to generate token
Error: MetaAPI API call timed out. The service may be slow or unavailable.
```

## Root Cause Analysis

1. **Insufficient Timeout Duration**: The API_CALL_TIMEOUT_MS was set to 20 seconds, which was too aggressive for MetaAPI's token generation endpoint
2. **No Retry Logic**: Single-attempt API calls with no fallback mechanism for transient failures
3. **Network Latency**: Calls to the new-york.agiliumtrade.ai endpoint can experience variable latency
4. **MetaAPI Service Load**: The MetaAPI servers can be slow during peak usage times
5. **Function Timeout Mismatch**: Netlify function timeouts were too short to accommodate retry attempts

## Solution Implemented

### 1. Timeout Configuration Updates

**File: `netlify/functions/metaapi-utils.js`**

- **API_CALL_TIMEOUT_MS**: Increased from 20s to 45s
  - Reason: Allows sufficient time for slow MetaAPI responses

- **FUNCTION_TIMEOUT_MS**: Increased from 25s to 50s
  - Reason: Accommodates multiple retry attempts with delays

- **Added Constants**:
  ```javascript
  MAX_RETRIES = 3
  RETRY_DELAYS = [2000, 5000, 10000] // ms
  ```

### 2. Retry Logic with Exponential Backoff

**New Function: `withRetry()`**

Implements automatic retry with exponential backoff:
- **Attempt 1**: Immediate execution
- **Attempt 2**: After 2 second delay
- **Attempt 3**: After 5 second delay
- **Attempt 4**: After 10 second delay

Features:
- Only retries on timeout and network errors
- Preserves original error on non-retryable failures
- Detailed logging of each attempt
- Graceful failure after all retries exhausted

### 3. Enhanced Error Handling

**Improved Error Messages for:**
- Timeout errors with context about retries
- Network connectivity issues with endpoint details
- Authentication failures with actionable guidance
- Rate limiting with recommended wait times
- 404 errors with account/region verification tips

### 4. Network Optimization

**Added to MetaAPI Client Configuration:**
```javascript
headers: {
  'User-Agent': 'Pipnosis/1.0',
  'Accept-Encoding': 'gzip, deflate'
}
```

Benefits:
- Better server-side routing
- Compressed responses for faster transfer
- Reduced bandwidth usage

### 5. Netlify Function Timeout Updates

**File: `netlify.toml`**

- `get-metaapi-token`: 10s → 30s
- `test-metaapi-token`: 30s → 60s
- `verify-metaapi-account`: 30s → 60s

### 6. Performance Monitoring

**Added Timing Instrumentation:**
- Request start/end timestamps
- Elapsed time logging for each operation
- Duration reporting in success/failure messages

### 7. UI Improvements

**File: `src/pages/TestMetaApiToken.tsx`**

- Extended client-side timeout from 26s to 58s
- Updated UI to show retry information
- Added "Enhanced Reliability" info panel
- Improved troubleshooting guidance with specific scenarios
- Better error messages with actionable next steps

## Technical Details

### generateNarrowedToken() Flow

```
1. Validate inputs (token, accountId)
2. Log request details (endpoint, validity)
3. Enter retry loop (up to 3 retries):
   a. Create MetaAPI client
   b. Call narrowDownToken API (45s timeout)
   c. Validate response format
   d. Log success/failure
   e. On failure: wait, then retry
4. Return token or throw detailed error
```

### verifyAccount() Flow

```
1. Validate inputs (token, accountId)
2. Log verification details
3. Enter retry loop (up to 3 retries):
   a. Create MetaAPI client
   b. Call getAccount API (45s timeout)
   c. Parse account information
   d. Log success/failure
   e. On failure: wait, then retry
4. Return account info or throw detailed error
```

## Testing Recommendations

### Test Scenarios

1. **Normal Operation**
   - Run test with valid credentials
   - Should complete in 5-10 seconds
   - All steps should pass

2. **Slow Network**
   - Run test during peak hours
   - May take 20-40 seconds
   - Should succeed with retries

3. **MetaAPI Service Issues**
   - Test may timeout even with retries
   - Should provide clear error messages
   - Should suggest waiting and retrying

4. **Invalid Credentials**
   - Should fail quickly (no retries needed)
   - Should provide clear authentication error

### Expected Behavior

- **First Attempt Success**: ~5-15 seconds
- **Retry on Timeout**: 2-45 seconds per attempt
- **Maximum Duration**: ~3 minutes (4 attempts × 45s + delays)
- **Function Timeout**: 60 seconds (prevents excessive waiting)

## Deployment Steps

1. **Verify Environment Variables**
   ```
   METAAPI_ADMIN_TOKEN=<your-token>
   VITE_METAAPI_ACCOUNT_ID=<your-account-id>
   VITE_METAAPI_REGION=new-york
   ```

2. **Deploy to Netlify**
   ```bash
   npm run build
   # Commit and push changes
   # Netlify will auto-deploy
   ```

3. **Test Token Generation**
   - Navigate to `/test-metaapi` page
   - Click "Run MetaAPI Token Test"
   - Verify all steps pass
   - Check logs for retry attempts if any

## Monitoring

### Success Metrics
- Token generation success rate > 95%
- Average generation time < 15 seconds
- Retry rate < 10%

### Failure Indicators
- Consistent timeouts even after retries
- High retry rate (> 30%)
- Authentication errors

### Log Messages to Watch

**Success Patterns:**
```
✓ Narrowed token generated successfully
✓ Request duration: XXXXms
```

**Retry Patterns:**
```
Retry attempt N/3 for Token Generation after XXXms delay...
✓ Token Generation succeeded on retry attempt N
```

**Failure Patterns:**
```
Token generation failed after all retries
MetaAPI token generation timed out after multiple attempts
```

## Rollback Plan

If issues arise, revert these files:
1. `netlify/functions/metaapi-utils.js`
2. `netlify/functions/test-metaapi-token.js`
3. `netlify.toml`
4. `src/pages/TestMetaApiToken.tsx`

Previous timeout values:
- API_CALL_TIMEOUT_MS: 20000
- FUNCTION_TIMEOUT_MS: 25000

## Future Improvements

1. **Token Caching**
   - Cache generated tokens in Supabase
   - Reduce API calls by reusing valid tokens
   - Implement background refresh before expiration

2. **Health Check Endpoint**
   - Pre-flight connectivity check to MetaAPI
   - Report server status before attempting token generation

3. **Alternative Regions**
   - Auto-fallback to alternate regions on timeout
   - Test london/singapore regions if new-york is slow

4. **Metrics Dashboard**
   - Track token generation performance over time
   - Alert on degraded MetaAPI service
   - Historical success/failure trends

## References

- MetaAPI Documentation: https://metaapi.cloud/docs/
- Netlify Functions: https://docs.netlify.com/functions/
- Exponential Backoff: https://en.wikipedia.org/wiki/Exponential_backoff

## Related Files Modified

1. `/netlify/functions/metaapi-utils.js` - Core retry logic and timeout updates
2. `/netlify/functions/test-metaapi-token.js` - Enhanced error messages
3. `/netlify.toml` - Function timeout configurations
4. `/src/pages/TestMetaApiToken.tsx` - UI improvements and documentation

## Summary

The MetaAPI token generation timeout issue has been resolved by:
- Increasing API call timeouts from 20s to 45s
- Adding automatic retry with exponential backoff (up to 3 retries)
- Enhancing error handling with specific troubleshooting guidance
- Optimizing network settings with compression and proper headers
- Improving UI feedback and documentation

The changes make the token generation process resilient to temporary network issues and slow MetaAPI responses while providing better visibility into failures through enhanced logging and user feedback.
