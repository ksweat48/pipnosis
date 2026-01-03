# MetaAPI Subscription Quota Fix

**Date:** 2026-01-03
**Status:** DEPLOYED ✅

## Problem

MetaAPI subscription quota exhaustion causing "TooManyRequestsError: You have used all your account subscriptions quota. You have 25 account subscriptions available and have used 34 subscriptions."

### Root Cause

Browser-based MetaAPI WebSocket connections were creating per-user subscriptions:

- **Architecture Flaw**: Each user's browser created separate MetaAPI WebSocket connections
- **Quota Math**: 7 symbols per user × 5 concurrent users = 35 subscriptions > 25 limit
- **Symbols Affected**: XAUUSD, US30, EURUSD, GBPUSD, USDJPY, NAS100, SPX500

### Why This Happened

1. `VITE_ENABLE_BROWSER_WEBSOCKET=true` enabled browser WebSocket connections
2. Every page load called `metaApiWebSocketClient.connect()`
3. Each connection subscribed to 7 forex symbols
4. Subscriptions weren't properly cleaned up on disconnect
5. Multiple users = quota exhaustion

## Solution Implemented

**Disabled MetaAPI browser WebSocket entirely** while keeping Kraken WebSocket for crypto.

### Architecture Changes

#### Before (BROKEN)
```
Browser 1 → MetaAPI WS → 7 subscriptions
Browser 2 → MetaAPI WS → 7 subscriptions
Browser 3 → MetaAPI WS → 7 subscriptions
Browser 4 → MetaAPI WS → 7 subscriptions
Browser 5 → MetaAPI WS → 7 subscriptions
Total: 35 subscriptions (QUOTA EXCEEDED ❌)
```

#### After (FIXED)
```
Browser 1 → Kraken WS → Crypto real-time ✅
Browser 2 → Kraken WS → Crypto real-time ✅
Browser 3 → Kraken WS → Crypto real-time ✅

All Browsers → Backend REST → Forex polling ✅
(No per-user MetaAPI subscriptions)
```

### Files Modified

**src/services/websocket-price-manager.ts**
- Removed `metaApiWebSocketClient.connect()` from browser
- Removed MetaAPI tick and status listeners
- Updated connection status logic
- Added clear documentation comments

**src/config/websocket-config.ts**
- Fixed Kraken symbol mapping (XBT/USD → BTC/USD for v2 API)

### Behavior Changes

| Symbol Type | Before | After |
|------------|--------|-------|
| **Crypto** (BTCUSD, ETHUSD) | Browser WebSocket (Kraken) ✅ | Browser WebSocket (Kraken) ✅ |
| **Forex** (XAUUSD, etc.) | Browser WebSocket (MetaAPI) ❌ | Backend REST Polling ✅ |

### Performance Impact

- **Crypto symbols**: Still have real-time WebSocket feeds (10-100 ticks/second)
- **Forex symbols**: Use backend REST polling (~1 update per 5 seconds)
- **Bundle size**: Reduced websocket-price-manager.js from 19.45 kB → 12.95 kB
- **MetaAPI quota**: Reduced from 34/25 → 0/25 (100% available)

## Why This is the Correct Solution

### Option Analysis

1. ❌ **Increase MetaAPI quota** - Costs money, doesn't scale
2. ❌ **Share single connection** - Complex, requires WebSocket server
3. ✅ **Use backend REST polling** - Already implemented, proven, scalable

### Backend REST Polling Advantages

- **No quota issues**: Server-side connections don't count per-user
- **Already working**: System was designed for this
- **Simpler architecture**: No browser WebSocket complexity
- **Better for forex**: 5-second polling is sufficient for forex trading
- **Kraken still fast**: Crypto gets real-time WebSocket (no limits)

## Monitoring

### Success Indicators

- ✅ No more "TooManyRequestsError" in console
- ✅ Crypto charts update in real-time (Kraken WebSocket)
- ✅ Forex charts update via polling (backend)
- ✅ WebSocket manager only connects to Kraken

### Logs to Watch

```javascript
// SUCCESS - should see this:
[WebSocketManager] MetaAPI browser WebSocket disabled - using backend REST polling for forex
[KrakenWS] Connected successfully
[KrakenWS] Subscribed to BTCUSD
[KrakenWS] Subscribed to ETHUSD

// FAILURE - should NOT see this:
[MetaApiWS] Connecting...
TooManyRequestsError: subscription quota
```

## Rollback Plan

If needed, revert `src/services/websocket-price-manager.ts` to restore MetaAPI browser WebSocket:

```bash
git diff HEAD~1 src/services/websocket-price-manager.ts
git checkout HEAD~1 -- src/services/websocket-price-manager.ts
npm run build
# Deploy
```

## Future Considerations

### If Real-Time Forex is Required

Options to restore real-time forex feeds without quota issues:

1. **Server-side WebSocket proxy**: Backend maintains single MetaAPI connection, broadcasts to all users via separate WebSocket server
2. **Upgrade MetaAPI plan**: Increase subscription quota (costly)
3. **Alternative data provider**: Switch to provider without per-user limits

### Recommendation

Current architecture (backend REST + browser Kraken WS) is **optimal** for the trading style:
- Crypto needs real-time (high volatility)
- Forex works fine with 5-second polling (slower markets)
- No quota limits or scaling issues

## Testing Performed

- ✅ Build succeeds without errors
- ✅ MetaAPI code removed from browser bundle
- ✅ Kraken WebSocket still included and functional
- ✅ Console shows correct initialization messages
- ✅ No TypeScript compilation errors

## Related Issues

- Fixed Kraken symbol mapping (XBT/USD → BTC/USD) in same deployment
- Both crypto and forex price feeds now working correctly
- No more subscription quota errors blocking user sessions
