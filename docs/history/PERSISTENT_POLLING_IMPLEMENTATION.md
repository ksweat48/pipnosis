# Persistent Polling Implementation

## Overview

This document describes the comprehensive persistent polling system that ensures continuous price data updates across all trading pairs and timeframes, regardless of page visibility, user navigation, or tab activity.

## Problem Statement

Browser-based applications face several challenges with persistent background operations:

1. **Browser Timer Throttling**: When a tab is hidden or inactive, browsers throttle `setInterval` and `setTimeout` to minimum intervals (typically 1000ms), reducing polling frequency
2. **Component Lifecycle Dependencies**: React components unmounting can inadvertently stop background services
3. **Connection Stability**: Network interruptions and WebSocket disconnections can silently halt data flow
4. **Resource Management**: Without proper monitoring, background services can fail without detection

## Solution Architecture

### 1. Global Polling Coordinator

**File**: `src/services/global-polling-coordinator.ts`

The coordinator manages price polling for all forex pairs with the following features:

#### Visibility Change Detection
```typescript
private setupVisibilityHandling(): void
```
- Monitors browser visibility API (`document.hidden`)
- Detects when tab becomes visible/hidden
- Triggers health verification on visibility change
- Logs visibility state transitions for debugging

#### Heartbeat Monitoring
```typescript
private startHeartbeatMonitoring(): void
```
- Runs every 5 seconds
- Measures timer drift to detect throttling
- Counts missed heartbeats
- Automatically recovers after 3 missed heartbeats
- Detects when browser is throttling intervals

#### Health Verification
```typescript
private verifyPollingHealth(): void
```
- Checks all pairs for staleness
- Active: Last success < 15 seconds ago
- Stale: Last success 15-60 seconds ago
- Dead: Last success > 60 seconds ago
- Automatically restarts dead pairs
- Initiates full restart if majority are stale

#### Recovery Mechanisms
```typescript
private recoverFromThrottling(): void
```
- Identifies stale polling operations
- Restarts individual pair polling
- Prevents cascading failures
- Uses staggered restart delays

### 2. Background Candle Aggregator

**File**: `src/services/background-candle-aggregator.ts`

Aggregates price ticks into candles for all timeframes with enhanced reliability:

#### Automatic Reconnection
```typescript
private handleConnectionError(): void
```
- Exponential backoff reconnection (1s, 2s, 4s, 8s, 16s, 30s max)
- Maximum 10 reconnection attempts
- Preserves candle state across reconnections
- Logs reconnection attempts and status

#### Health Monitoring
```typescript
private checkConnectionHealth(): void
```
- Monitors time since last message
- Threshold: 60 seconds without data = stale
- Forces reconnection on stale connections
- Runs every 15 seconds
- Provides detailed health metrics

#### Connection Status Tracking
```typescript
getStatus()
```
Returns comprehensive status including:
- Running state
- Active candle states
- Reconnection attempts
- Last message timestamp
- Connection health status
- Time since last message

### 3. Polling Health Dashboard

**File**: `src/components/PollingHealthDashboard.tsx`

Admin dashboard for real-time monitoring:

#### Overall Health Indicators
- **Healthy**: 80%+ pairs active, recent success, good connection
- **Degraded**: 50-80% pairs active or some issues
- **Critical**: <50% pairs active or major failures

#### Key Metrics
- Active pairs ratio
- Success rate percentage
- Last update timestamp
- Realtime feed connection status

#### Per-Pair Monitoring
- Individual pair status (active/stale/error/starting)
- Current price display
- Success/error counts
- Last successful poll time
- Error messages for failed pairs

#### Manual Controls
- Restart polling button
- Detailed status toggle
- Real-time updates every 5 seconds
- Visual health indicators

## Implementation Details

### Initialization Sequence

From `src/App.tsx`:

```typescript
// 1. Global polling coordinator (6 seconds after app start)
await globalPollingCoordinator.initialize();

// 2. Background candle aggregator (7 seconds after app start)
await backgroundCandleAggregator.start();

// 3. Persistent price polling service (8 seconds after app start)
await persistentPricePollingService.start();
```

**Staggered startup prevents resource contention and ensures services initialize in the correct order.**

### Priority-Based Polling

Symbols are polled at different intervals based on priority:

- **Critical (500ms)**: Symbols with open positions
- **High (1000ms)**: Currently viewed symbols
- **Normal (2000ms)**: Standard polling
- **Low (5000ms)**: Background symbols not being viewed

Priority adjusts dynamically as users:
- Open/close positions
- View different symbols
- Navigate between pages

### Data Flow

```
MetaAPI Price Feed
       ↓
Global Polling Coordinator
       ↓
realtime_prices table (Supabase)
       ↓
Background Candle Aggregator (Supabase Realtime)
       ↓
forex_candles + market_data tables
       ↓
MarketChart Components (via listeners)
```

### Persistence Guarantees

1. **Component Independence**: Polling continues when MarketChart unmounts
2. **Navigation Independence**: Polling survives page navigation
3. **Visibility Independence**: Polling continues when tab is hidden (with monitoring)
4. **Connection Resilience**: Automatic reconnection on failures
5. **Health Monitoring**: Continuous verification and recovery

## Key Features

### 1. Visibility-Aware Operation
- Detects tab visibility changes
- Compensates for browser throttling
- Verifies health when tab becomes visible
- Maintains operation when hidden

### 2. Intelligent Recovery
- Heartbeat monitoring detects silent failures
- Automatic recovery from throttling
- Exponential backoff prevents server overload
- Circuit breaker prevents infinite retry loops

### 3. Comprehensive Monitoring
- Real-time health dashboard
- Per-pair status tracking
- Connection health metrics
- Performance statistics

### 4. Resource Efficiency
- Priority-based polling intervals
- Adaptive polling based on user activity
- Queue management for API requests
- Graceful degradation under load

## Configuration

### Polling Intervals
```typescript
// Global Polling Coordinator
HEARTBEAT_INTERVAL_MS = 5000
MAX_MISSED_HEARTBEATS = 3
MARKET_CHECK_INTERVAL = 60000

// Background Candle Aggregator
HEALTH_CHECK_INTERVAL_MS = 15000
STALE_CONNECTION_THRESHOLD_MS = 60000
MAX_RECONNECT_ATTEMPTS = 10
BASE_RECONNECT_DELAY = 1000
```

### Monitored Forex Pairs
- XAUUSD (Gold)
- US30 (Dow Jones)
- EURUSD
- GBPUSD
- USDJPY

### Supported Timeframes
All timeframes are aggregated simultaneously:
- M1 (1 minute)
- M5 (5 minutes)
- M15 (15 minutes)
- M30 (30 minutes)
- H1 (1 hour)
- H4 (4 hours)
- D1 (1 day)
- W1 (1 week)

## Testing Persistence

To verify persistent polling:

1. **Tab Visibility Test**
   - Open the application
   - Open browser DevTools console
   - Switch to another tab
   - Wait 2-3 minutes
   - Return to application tab
   - Check console logs for:
     - "Tab hidden - polling continues in background"
     - "Tab became visible - verifying polling status"
     - Continuous polling logs even when hidden

2. **Navigation Test**
   - Start on Trade page with chart
   - Navigate to History page
   - Check console for continued polling
   - Navigate to Settings page
   - Verify polling still active
   - Return to Trade page
   - Confirm no interruption in data

3. **Connection Resilience Test**
   - Disable network connection
   - Wait 30 seconds
   - Re-enable network
   - Verify automatic reconnection
   - Check Admin Dashboard for reconnection attempts
   - Confirm data flow resumes

4. **Health Dashboard Verification**
   - Navigate to Admin → Polling Health
   - Verify all pairs show "active" status
   - Check success rate > 80%
   - Monitor for any stale/error states
   - Test manual restart button

## Troubleshooting

### Polling Stopped
1. Check Admin → Polling Health dashboard
2. Look for error messages in per-pair status
3. Click "Restart Polling" button
4. Check browser console for detailed logs

### High Error Rate
1. Verify MetaAPI credentials in environment variables
2. Check network connectivity
3. Review rate limiting in smart-request-queue
4. Inspect individual pair errors in dashboard

### Stale Connections
1. Aggregator shows high "Time since last message"
2. Check Supabase realtime connection status
3. Manual reconnection usually resolves
4. Verify Supabase project is active

### Browser Throttling Detected
1. Console shows "Heartbeat drift detected"
2. System automatically compensates
3. Polling may be slightly delayed when tab hidden
4. Returns to normal when tab visible

## Benefits

1. **Reliability**: Continuous data flow without manual intervention
2. **User Experience**: Charts always show current data
3. **Resource Efficiency**: Adaptive polling based on usage
4. **Transparency**: Real-time monitoring and diagnostics
5. **Maintainability**: Clear separation of concerns
6. **Scalability**: Handles multiple pairs and timeframes efficiently

## Future Enhancements

Potential improvements:

1. **Web Workers**: Move polling to dedicated worker thread (not throttled)
2. **Service Workers**: Enable offline capability and push notifications
3. **Broadcast Channel**: Coordinate polling across multiple browser tabs
4. **Server-Side Polling**: Netlify scheduled functions as backup
5. **Adaptive Intervals**: Machine learning to optimize polling frequency
6. **Data Compression**: Reduce bandwidth for historical data
7. **Predictive Caching**: Pre-fetch likely-needed timeframes

## Conclusion

The persistent polling implementation ensures that the Pipnosis AI Trading platform maintains continuous, reliable price data flow regardless of user activity or browser state. The multi-layered approach with visibility detection, heartbeat monitoring, automatic recovery, and comprehensive health monitoring provides a robust foundation for real-time trading applications.

**All polling is now truly persistent and independent of UI state, chart visibility, or page navigation.**
