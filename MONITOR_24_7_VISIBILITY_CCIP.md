# CCIP: Monitor 24/7 Visibility Fix

**Date**: 2026-01-23
**Type**: Architecture Fix + Feature Enhancement
**Priority**: P1 - Improves user experience and system architecture

## Problem Statement

**SSOT Violation**: Monitor visibility logic was incorrectly tied to goal session state, causing Session Intelligence and VWAP Kiss monitors to only display when NO active session exists.

**User Impact**:
- Session Intelligence: Educational monitor showing best pairs for current trading session
- VWAP Kiss Detector: Advisory monitor detecting VWAP proximity for scalp opportunities
- Both should work 24/7 regardless of session state, but were hidden during active sessions

**Root Cause**:
1. No backend data population (tables existed but were empty)
2. Frontend components only shown in "empty state" section of GoalSessionDashboard
3. Monitor visibility incorrectly coupled to session lifecycle

## CCIP Stage 1: System Map

### Current System State
- ✅ Database tables exist: `session_intelligence_data`, `vwap_kiss_signals`
- ✅ Frontend components exist: `SessionIntelligenceMonitor`, `VWAPKissMonitor`
- ❌ No backend functions to populate data
- ❌ Components only shown when NO active session
- ✅ User preferences table exists for visibility control

### SSOT Authorities Identified

**Created Authorities:**
1. **Session Intelligence Authority**: `populate-session-intelligence` Netlify function
   - Determines current trading session (London/NY/Asian)
   - Analyzes market conditions
   - Ranks top 5 pairs with reasoning
   - Updates every hour

2. **VWAP Kiss Authority**: `scan-vwap-kisses` Netlify function
   - Scans all watchlist pairs for VWAP proximity
   - Calculates VWAP from 15m candles with volume
   - Generates signals for pairs within 0.5% of VWAP
   - Updates every 2 minutes

**Frontend Responsibilities:**
- Read-only consumers of SSOT data
- Subscribe to real-time updates via Supabase
- Display data regardless of session state
- Respect user preferences for visibility

## CCIP Stage 2: Logic Contract

### Session Intelligence Populator
```typescript
Location: netlify/functions/populate-session-intelligence.ts
Schedule: Every hour (0 * * * *)
Timeout: 30 seconds

Responsibilities:
1. Determine current session based on EST time
   - London: 3:00 AM - 12:00 PM EST
   - New York: 8:00 AM - 5:00 PM EST
   - Asian: 7:00 PM - 4:00 AM EST

2. Analyze market conditions
   - trending / ranging / volatile / quiet / sideways

3. Rank top 5 pairs for current session
   - Session-specific liquidity patterns
   - Confidence scores (0-100)
   - Clear reasoning for each pair

4. Insert into session_intelligence_data
   - Expires in 2 hours
   - Real-time push to frontend
```

### VWAP Kiss Scanner
```typescript
Location: netlify/functions/scan-vwap-kisses.ts
Schedule: Every 2 minutes (*/2 * * * *)
Timeout: 60 seconds

Responsibilities:
1. Fetch recent 15m candles for all watchlist pairs
   - Last 50 candles (12.5 hours of data)
   - Must have volume data

2. Calculate VWAP
   - Typical price = (high + low + close) / 3
   - VWAP = Σ(typical price × volume) / Σ(volume)

3. Detect VWAP proximity signals
   - HOT: Within 0.1% of VWAP (100 score)
   - GOOD: Within 0.3% of VWAP (75 score)
   - WATCH: Within 0.5% of VWAP (50 score)

4. Determine direction bias and suggestions
   - Bullish: Price below VWAP (buy the dip)
   - Bearish: Price above VWAP (sell the rally)
   - Entry/exit suggestions based on mean reversion

5. Insert into vwap_kiss_signals
   - Expires in 10 minutes
   - Real-time push to frontend
```

### Frontend Display Logic
```typescript
Location: src/components/GoalSessionDashboard.tsx

Monitor Visibility:
- Session Intelligence: Always visible when preference enabled
- VWAP Kiss: Always visible when preference enabled
- Entry Price Monitor: Only shows when active trade exists ✅

Display Locations:
1. Empty State: When NO active session (line 1184)
2. Active Session: When session is running (line 1630)

SSOT Compliance:
- Components are read-only data consumers
- No business logic in components
- All logic in backend SSOT authorities
```

## CCIP Stage 3: Dry-Run Simulation

### Scenario 1: Empty State (No Active Session)
**Before**: Session Intelligence and VWAP Kiss show placeholder text
**After**: Both monitors show live data populated by backend functions

**Test**:
1. User has no active session
2. Session Intelligence displays current session (London/NY/Asian)
3. VWAP Kiss displays active signals (if any exist)
4. Entry Price Monitor does NOT show (correct - no active trade)

### Scenario 2: Active Session (Scanning)
**Before**: Monitors hidden completely
**After**: All monitors show (Session Intelligence, VWAP Kiss, Entry Price if trade exists)

**Test**:
1. User starts goal session
2. Session Intelligence continues to show current session data
3. VWAP Kiss continues to show active signals
4. Entry Price Monitor shows only when Alpha executes a trade

### Scenario 3: Backend Data Population
**Before**: Tables are empty
**After**: Tables populated every hour (Session Intelligence) and every 2 minutes (VWAP)

**Test**:
1. Wait for hourly trigger (0 * * * *)
2. Verify session_intelligence_data has new entry
3. Wait for 2-minute trigger (*/2 * * * *)
4. Verify vwap_kiss_signals has new entries (if signals detected)

## CCIP Stage 4: Compatibility Check

### Breaking Changes
❌ NONE - This is purely additive

### Non-Breaking Changes
✅ New Netlify functions added
✅ Existing components now show in both states
✅ No changes to SSOT authorities (Alpha, Omega, etc.)
✅ No changes to trading execution logic

### Database Impact
✅ Tables already exist (created in migration 20260123065556)
✅ RLS policies already configured
✅ Realtime subscriptions already enabled

### Performance Impact
✅ Session Intelligence: Runs hourly (minimal load)
✅ VWAP Kiss: Runs every 2 minutes (scans ~15 pairs)
✅ Frontend: No additional polling (uses realtime subscriptions)

## CCIP Stage 5: Staged Deployment

### Stage 1: Backend Functions ✅
1. ✅ Create `populate-session-intelligence.ts`
2. ✅ Create `scan-vwap-kisses.ts`
3. ✅ Add scheduling to `netlify.toml`
4. ✅ Deploy to Netlify (triggers on next push)

### Stage 2: Frontend Updates ✅
1. ✅ Add `TradingMonitorStack` to active session view
2. ✅ Keep `TradingMonitorStack` in empty state view
3. ✅ No changes to monitor components (already subscribe to tables)

### Stage 3: Verification
1. ⏳ Wait for first hourly trigger (Session Intelligence)
2. ⏳ Wait for first 2-minute trigger (VWAP Kiss)
3. ⏳ Verify data appears in both empty and active states
4. ⏳ Verify monitors respect user preferences

## CCIP Stage 6: Post-Deploy Verification

### Success Criteria
1. **Session Intelligence**
   - [ ] Backend function runs every hour without errors
   - [ ] Data inserted into `session_intelligence_data`
   - [ ] Frontend component displays current session
   - [ ] Top 5 pairs shown with reasoning
   - [ ] Visible in both empty and active states

2. **VWAP Kiss**
   - [ ] Backend function runs every 2 minutes without errors
   - [ ] Signals detected and inserted into `vwap_kiss_signals`
   - [ ] Frontend component displays active signals
   - [ ] Entry/exit suggestions calculated correctly
   - [ ] Visible in both empty and active states

3. **Entry Price Monitor**
   - [ ] Only shows when active trade exists (unchanged behavior)
   - [ ] Does NOT show during scanning or empty state
   - [ ] Provides educational pullback zone recommendations

### Monitoring
- Watch Netlify function logs for errors
- Monitor database table growth
- Check user feedback on monitor visibility
- Verify no performance degradation

## Architecture Compliance

### SSOT ✅
- Single backend authority for each monitor type
- Frontend components are read-only consumers
- No duplicate logic across layers

### Governance ✅
- Advisory-only monitors (no impact on trading execution)
- Clear separation from Alpha's autonomous decisions
- Educational purpose documented

### CCIP ✅
- Full system mapping completed
- Logic contracts defined
- Compatibility verified
- Staged deployment plan
- Verification criteria established

## Files Modified

### Created
- `netlify/functions/populate-session-intelligence.ts` (173 lines)
- `netlify/functions/scan-vwap-kisses.ts` (273 lines)

### Modified
- `netlify.toml` (+14 lines) - Added scheduling configuration
- `src/components/GoalSessionDashboard.tsx` (+1 line) - Added TradingMonitorStack to active session view

### Unchanged
- `src/components/SessionIntelligenceMonitor.tsx` (already subscribes to data)
- `src/components/VWAPKissMonitor.tsx` (already subscribes to data)
- `src/components/TradingMonitorStack.tsx` (controls visibility based on preferences)
- Database schema (tables already exist)

## Success Metrics

**User Experience**:
- Monitors provide value 24/7 instead of only in empty state
- Real-time data updates without user action
- Educational insights always available

**Architecture**:
- SSOT compliance maintained
- Backend authorities clearly defined
- Frontend remains read-only consumer

**Performance**:
- No additional frontend polling
- Efficient backend scheduling
- Real-time updates via Supabase subscriptions

## Rollback Plan

If issues arise:
1. Remove scheduling from `netlify.toml` (disables backend functions)
2. Revert `GoalSessionDashboard.tsx` (removes monitor from active state)
3. Monitors return to empty-state-only visibility

## Next Steps

1. Deploy to production via build hook
2. Monitor first hour trigger (Session Intelligence)
3. Monitor first 2-minute trigger (VWAP Kiss)
4. Verify data population in database
5. Confirm frontend displays correctly
6. Gather user feedback

## Conclusion

This CCIP implementation fixes a critical SSOT violation where monitor visibility was incorrectly tied to session state. The solution:
- Creates proper backend authorities for data population
- Enables 24/7 monitor visibility regardless of session state
- Maintains SSOT and Governance compliance
- Provides educational value to users at all times

**Status**: ✅ Implementation Complete - Ready for Deployment
