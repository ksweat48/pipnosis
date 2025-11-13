# Persistent Polling Deployment Guide

## Quick Deployment

To deploy the persistent polling enhancements:

```bash
# Build the project
npm run build

# Deploy to Netlify (using build hook)
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

## What's Been Implemented

### 1. Enhanced Global Polling Coordinator
- ✅ Browser visibility change detection
- ✅ Heartbeat monitoring (5-second intervals)
- ✅ Automatic recovery from throttling
- ✅ Per-pair health verification
- ✅ Intelligent restart mechanisms

### 2. Resilient Background Candle Aggregator
- ✅ Automatic reconnection with exponential backoff
- ✅ Connection health monitoring (15-second intervals)
- ✅ Stale connection detection (60-second threshold)
- ✅ State preservation across reconnections
- ✅ Comprehensive status reporting

### 3. Polling Health Dashboard
- ✅ Real-time monitoring interface
- ✅ Overall health indicators (healthy/degraded/critical)
- ✅ Per-pair status display
- ✅ Manual restart controls
- ✅ Detailed metrics and diagnostics

## Key Features

### Persistent Across All Scenarios

✅ **Page Navigation**: Polling continues when navigating between pages
✅ **Tab Hidden**: Polling continues when browser tab is hidden or minimized
✅ **Component Unmount**: Polling continues when chart components unmount
✅ **Symbol/Timeframe Changes**: Polling continues for all pairs regardless of viewed symbol
✅ **Browser Throttling**: Automatically detects and compensates for throttled timers
✅ **Connection Drops**: Automatically reconnects with exponential backoff

## Verification Steps

After deployment, verify the implementation:

### 1. Console Logs
Open browser DevTools console and look for:
```
🚀 Initializing global polling coordinator for all forex pairs...
📊 Polling will continue regardless of page visibility or navigation
✅ Global polling coordinator initialized for 5 pairs
🔄 Polling is persistent and independent of UI state
💓 Starting heartbeat monitoring (every 5000ms)...
🚀 Starting background candle aggregator...
🔄 Auto-reconnection enabled for persistent operation
```

### 2. Hide Tab Test
1. Open the application
2. Wait for polling to start (watch console logs)
3. Switch to another browser tab
4. Wait 2-3 minutes
5. Return to application tab
6. Console should show:
   - "Tab hidden - polling continues in background"
   - "Tab became visible - verifying polling status..."
   - Continuous polling logs throughout

### 3. Health Dashboard Check
1. Log in as admin
2. Navigate to Admin → Polling Health
3. Verify:
   - Overall status shows "All systems operational"
   - Active pairs shows X/5 (where X >= 4)
   - Success rate > 80%
   - Last update shows "Just now" or recent timestamp
   - Realtime feed shows "Connected"

### 4. Navigation Test
1. Start on Trade page
2. Navigate to History
3. Navigate to Analysis
4. Navigate to Settings
5. Return to Trade
6. Verify console shows continuous polling throughout navigation

## Monitoring

### Real-Time Monitoring
Access the Polling Health Dashboard at:
- Path: `/admin/dashboard`
- Tab: "Polling Health"

### Key Metrics to Monitor
- **Active Pairs**: Should be 5/5 or 4/5 during normal operation
- **Success Rate**: Should be > 80% consistently
- **Last Update**: Should be "Just now" or < 30 seconds ago
- **Realtime Feed**: Should show "Connected"
- **Reconnect Attempts**: Should be 0 (non-zero indicates issues)

### Warning Signs
🟡 **Degraded State**
- Active pairs: 3-4 out of 5
- Success rate: 50-80%
- Last update: 30-60 seconds ago
- Action: Monitor, may self-recover

🔴 **Critical State**
- Active pairs: < 3 out of 5
- Success rate: < 50%
- Last update: > 60 seconds ago
- Action: Click "Restart Polling" button

## Troubleshooting

### Polling Not Starting
1. Check environment variables are set:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - MetaAPI credentials
2. Check browser console for errors
3. Verify Netlify Functions are deployed
4. Check MetaAPI connection status

### High Error Rate
1. Navigate to Admin → Polling Health
2. Check per-pair status for specific errors
3. Common issues:
   - Rate limiting (429 errors)
   - Network connectivity
   - MetaAPI account issues
   - Expired tokens

### Reconnection Loops
If reconnect attempts > 5:
1. Check Supabase project status
2. Verify realtime_prices table exists
3. Check RLS policies allow inserts
4. Review network connectivity
5. Click "Restart Polling" to reset

## Performance Impact

### Resource Usage
- **CPU**: Minimal (<1% additional)
- **Memory**: ~5-10 MB for polling state
- **Network**: 5 pairs × 1-5 KB/poll = ~25 KB every 2-5 seconds
- **Database**: ~1 insert/second per pair = ~5 writes/second

### Optimization
- Priority-based polling reduces unnecessary requests
- Smart request queue prevents duplicate calls
- Exponential backoff prevents server overload
- Connection pooling reuses database connections

## Expected Behavior

### Normal Operation
```
[Coordinator] ✅ [EURUSD] Price updated: 1.08345/1.08347 (high, 1000ms)
[Coordinator] ✅ [GBPUSD] Price updated: 1.26234/1.26236 (normal, 2000ms)
[Coordinator] ✅ [USDJPY] Price updated: 149.823/149.825 (normal, 2000ms)
[BackgroundAggregator] ✓ Saved EURUSD M5 candle (47 ticks)
💓 Health check passed (last message 3s ago, 35 active candles)
```

### During Tab Hide
```
🙈 Tab hidden - polling continues in background
ℹ️ Note: Browser may throttle timers, heartbeat will detect issues
[Coordinator] ✅ [EURUSD] Price updated... (continues)
[Coordinator] ✅ [GBPUSD] Price updated... (continues)
```

### After Tab Restore
```
👁️ Tab became visible - verifying polling status...
🔍 Verifying polling health across all pairs...
📊 Health check complete: 5 active, 0 stale/dead of 5 pairs
```

### During Reconnection
```
⚠️ [BackgroundAggregator] No messages received for 62s - connection may be stale
🔄 Forcing reconnection due to stale connection...
🔄 Attempting reconnection 1/10 in 1s...
🔌 Reconnecting (attempt 1)...
✅ Successfully subscribed to realtime_prices
```

## Support

### Debug Mode
To enable verbose logging:
1. Open browser console
2. Run: `localStorage.setItem('DEBUG', 'polling:*')`
3. Refresh page
4. See detailed polling logs

### Health Check Endpoint
Manual health verification:
```javascript
// In browser console
const status = globalPollingCoordinator.getCoordinatorStatus();
console.log('Overall Health:', status);

const aggStatus = backgroundCandleAggregator.getStatus();
console.log('Aggregator Health:', aggStatus);
```

## Rollback Procedure

If issues occur, rollback to previous version:

```bash
# Rollback on Netlify dashboard
# Or redeploy previous commit
git revert HEAD
git push origin main
```

Previous polling will resume without persistent features.

## Summary

The persistent polling system ensures:
- ✅ Continuous operation regardless of UI state
- ✅ Automatic recovery from failures
- ✅ Comprehensive monitoring and diagnostics
- ✅ Efficient resource usage
- ✅ Production-ready reliability

All forex pairs (XAUUSD, US30, EURUSD, GBPUSD, USDJPY) are continuously polled across all timeframes (M1, M5, M15, M30, H1, H4, D1, W1) with automatic health monitoring and recovery.

**Polling is now truly persistent! 🎉**
