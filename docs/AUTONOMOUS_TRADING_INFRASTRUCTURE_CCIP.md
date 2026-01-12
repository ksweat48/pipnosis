# Autonomous Trading Infrastructure - CCIP Implementation Plan

**Date:** 2026-01-12
**Status:** IN PROGRESS
**Priority:** P0 - CRITICAL CAPITAL PROTECTION

---

## Executive Summary

**Problem:** Critical trading operations depend on browser being open and active. Position monitoring, mid-trade alerts, and wellness checks are vulnerable to browser tab throttling, causing missed SL/TP exits and potential capital loss.

**Solution:** Migrate all critical monitoring to server-side Netlify functions with sub-10-second polling frequencies. Browser becomes view-only display layer.

**Impact:**
- ✅ Positions close at SL/TP even if browser is closed
- ✅ Mid-trade alerts execute automatically
- ✅ Continuous wellness monitoring
- ✅ Reliable TP1/TP2 partial closes
- ✅ Enhanced price collection reliability

---

## CCIP Phase 1: System Map

### Current Architecture (Before)

```
┌─────────────────────────────────────────────────────────┐
│                    BROWSER (Client)                      │
│  ┌──────────────────────────────────────────────────┐  │
│  │ position-monitor.ts (250ms/1000ms polling)       │  │
│  │ realtime-sltp-monitor.ts (Realtime subscriptions)│  │
│  │ mid-trade-alert-executor.ts (5s polling)         │  │
│  │ midtrade-monitor.ts (15min wellness checks)      │  │
│  └──────────────────────────────────────────────────┘  │
│         ↓ (Vulnerable to tab throttling)                 │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│                  Supabase Database                       │
│  - goal_session_trades (positions)                      │
│  - realtime_prices (market data)                        │
│  - goal_notifications (alerts)                          │
└─────────────────────────────────────────────────────────┘
```

**Critical Vulnerability:** All monitoring stops when browser is throttled/closed.

### New Architecture (After)

```
┌─────────────────────────────────────────────────────────┐
│              Netlify Scheduled Functions                 │
│  ┌──────────────────────────────────────────────────┐  │
│  │ autonomous-position-monitor.ts (5s)              │  │
│  │  - SL/TP/TP1/TP2 monitoring                      │  │
│  │  - Uses price-coordinator (SSOT)                 │  │
│  │  - Delegates to trade-closure-coordinator        │  │
│  ├──────────────────────────────────────────────────┤  │
│  │ autonomous-midtrade-executor.ts (10s)            │  │
│  │  - Expired alert execution                       │  │
│  │  - Push notifications                            │  │
│  ├──────────────────────────────────────────────────┤  │
│  │ autonomous-wellness-monitor.ts (15min)           │  │
│  │  - Periodic health checks                        │  │
│  │  - Alpha/Omega analysis triggers                 │  │
│  ├──────────────────────────────────────────────────┤  │
│  │ hybrid-price-collector.ts (60s) [ENHANCED]       │  │
│  │  - 8s MetaAPI timeout (was 5s)                   │  │
│  │  - Retry logic with exponential backoff          │  │
│  │  - Health metrics logging                        │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│            Supabase Database (SSOT Layer)               │
│  ┌──────────────────────────────────────────────────┐  │
│  │ trade-closure-coordinator (SSOT for closures)    │  │
│  │ price-coordinator (SSOT for prices)              │  │
│  │ notification-coordinator (SSOT for alerts)       │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│              Browser (View-Only Display)                 │
│  - Real-time UI updates via Supabase subscriptions     │
│  - User interactions (manual close, etc.)               │
│  - Status visualization only                            │
└─────────────────────────────────────────────────────────┘
```

**Capital Protection Guarantee:** Monitoring continues 24/7 regardless of browser state.

---

## CCIP Phase 2: Logic Contract

### Authority Ownership (SSOT Compliance)

#### 1. Position Monitoring Authority
**Owner:** `autonomous-position-monitor.ts` (Netlify function)

**Responsibilities:**
- Check all open positions every 5 seconds
- Detect SL/TP/TP1/TP2 hits
- Use `price-coordinator` for price access (SSOT)
- Delegate closure to `trade-closure-coordinator` (SSOT)
- Log all checks to `position_monitoring_logs` table

**Contract:**
```typescript
interface PositionMonitoringAuthority {
  checkAllPositions(): Promise<MonitoringResult>;
  detectSLTPHits(position: Position, price: Price): SLTPStatus;
  detectTP1TP2Hits(position: Position, price: Price): PartialCloseStatus;
  delegateClosureToCoordinator(positionId: string, reason: CloseReason): Promise<void>;
}
```

**Dependencies:**
- price-coordinator (price retrieval)
- trade-closure-coordinator (execution)
- notification-coordinator (alerts)

#### 2. Mid-Trade Alert Authority
**Owner:** `autonomous-midtrade-executor.ts` (Netlify function)

**Responsibilities:**
- Check for expired mid-trade alerts every 10 seconds
- Execute EXIT_IMMEDIATELY and TAKE_PROFIT_EARLY actions
- Delegate closure to `trade-closure-coordinator` (SSOT)
- Send push notifications via `notification-coordinator`
- Mark alerts as executed in database

**Contract:**
```typescript
interface MidTradeAlertAuthority {
  checkExpiredAlerts(): Promise<Alert[]>;
  executeAlert(alert: Alert): Promise<ExecutionResult>;
  sendExecutionNotification(userId: string, details: AlertDetails): Promise<void>;
}
```

#### 3. Wellness Check Authority
**Owner:** `autonomous-wellness-monitor.ts` (Netlify function)

**Responsibilities:**
- Check all open positions every 15 minutes
- Calculate drawdown and P&L for each position
- Trigger Alpha/Omega analysis if thresholds met
- Execute recommendations automatically
- Log all decisions to `wellness_check_logs` table

**Contract:**
```typescript
interface WellnessCheckAuthority {
  evaluateAllPositions(): Promise<WellnessResult[]>;
  triggerAlphaOmegaAnalysis(position: Position): Promise<MidTradeDecision>;
  executeRecommendation(decision: MidTradeDecision): Promise<void>;
  logWellnessCheck(result: WellnessResult): Promise<void>;
}
```

#### 4. Price Collection Authority
**Owner:** `hybrid-price-collector.ts` (Netlify function, enhanced)

**Responsibilities:**
- Collect prices from MetaAPI/Finnhub/Kraken every 60 seconds
- Retry failed requests with exponential backoff
- Log health metrics to `price_collection_health` table
- Maintain 95%+ success rate per symbol
- Fall back through source chain on failures

**Contract:**
```typescript
interface PriceCollectionAuthority {
  collectPricesForAllSymbols(): Promise<CollectionResult>;
  retryWithBackoff(source: PriceSource, attempt: number): Promise<Price | null>;
  logHealthMetrics(metrics: HealthMetrics): Promise<void>;
  selectBestPriceSource(symbol: string): PriceSource;
}
```

### Browser Role (View-Only)

**Responsibilities:**
- Display real-time status from Supabase subscriptions
- Handle user interactions (manual close, settings)
- Visualize monitoring states
- NO autonomous monitoring logic

---

## CCIP Phase 3: Implementation Stages

### Stage 1: Enhanced Price Collection (Highest Priority)
**Goal:** Fix stale price data issues

**Changes:**
1. Increase MetaAPI timeout: 5s → 8s
2. Increase function timeout: 26s → 35s
3. Add retry logic with exponential backoff (3 attempts)
4. Create `price_collection_health` table
5. Log success/failure metrics per symbol

**Files Modified:**
- `netlify/functions/hybrid-price-collector.ts`
- `supabase/migrations/XXX_create_price_collection_health.sql`

**Validation:**
- Price collection success rate > 95%
- No stale price warnings during normal market hours
- Health metrics visible in database

### Stage 2: Autonomous Position Monitoring (Highest Priority)
**Goal:** Protect capital with server-side SL/TP monitoring

**Changes:**
1. Create `autonomous-position-monitor.ts` Netlify function
2. Add to `netlify.toml` with 5-second schedule
3. Implement SL/TP/TP1/TP2 detection logic
4. Use `price-coordinator` and `trade-closure-coordinator`
5. Create `position_monitoring_logs` table

**Files Created:**
- `netlify/functions/autonomous-position-monitor.ts`
- `supabase/migrations/XXX_create_position_monitoring_logs.sql`

**Files Modified:**
- `netlify.toml` (add schedule)

**Validation:**
- Position closes at SL/TP with browser closed
- TP1 partial close executes correctly
- All closures logged to database

### Stage 3: Autonomous Mid-Trade Execution (High Priority)
**Goal:** Auto-execute mid-trade recommendations

**Changes:**
1. Create `autonomous-midtrade-executor.ts` Netlify function
2. Add to `netlify.toml` with 10-second schedule
3. Check for expired alerts from `goal_notifications`
4. Execute closures via `trade-closure-coordinator`
5. Send push notifications

**Files Created:**
- `netlify/functions/autonomous-midtrade-executor.ts`

**Files Modified:**
- `netlify.toml` (add schedule)

**Validation:**
- Expired alerts execute automatically
- Push notifications sent to user
- Browser not required for execution

### Stage 4: Autonomous Wellness Monitoring (Medium Priority)
**Goal:** Continuous trade health evaluation

**Changes:**
1. Create `autonomous-wellness-monitor.ts` Netlify function
2. Add to `netlify.toml` with 15-minute schedule
3. Integrate with `midtrade-monitor` brain
4. Create `wellness_check_logs` table
5. Auto-execute recommendations

**Files Created:**
- `netlify/functions/autonomous-wellness-monitor.ts`
- `supabase/migrations/XXX_create_wellness_check_logs.sql`

**Files Modified:**
- `netlify.toml` (add schedule)

**Validation:**
- Wellness checks run every 15 minutes
- Alpha/Omega analysis triggered correctly
- Decisions logged and executed

### Stage 5: Price Collection Health Monitoring (Medium Priority)
**Goal:** Operational visibility into price collection

**Changes:**
1. Create `PriceCollectionHealthDashboard.tsx` component
2. Display success rates per symbol
3. Show source fallback patterns
4. Alert on sustained failures
5. Add to System Diagnostics page

**Files Created:**
- `src/components/PriceCollectionHealthDashboard.tsx`

**Files Modified:**
- `src/pages/SystemDiagnosticsPage.tsx`

**Validation:**
- Health metrics visible in UI
- Alerts trigger on failures
- Historical trends displayed

---

## CCIP Phase 4: Compatibility Check

### Database Schema Changes

**New Tables:**
1. `price_collection_health` - Tracks collection success/failure
2. `position_monitoring_logs` - Logs all monitoring checks
3. `wellness_check_logs` - Tracks wellness evaluations

**No Breaking Changes:**
- All new tables, no schema modifications
- Existing functions continue to work
- Browser monitoring can run in parallel during migration

### API Contract Changes

**No Breaking Changes:**
- All new Netlify functions, no modifications to existing
- Browser components continue to work
- Coordinator APIs unchanged

### Backwards Compatibility

**During Migration:**
- Browser monitoring continues to run
- Server-side monitoring runs in parallel
- Both systems coordinate through same SSOT coordinators
- No service disruption

**After Migration:**
- Browser monitoring becomes view-only
- Can be gradually phased out
- Server-side is primary authority

---

## CCIP Phase 5: Staged Deployment

### Deployment Order

**1. Stage 1 (Price Collection) - Deploy First**
- Minimal risk, immediate benefit
- Fixes stale price data issues
- No dependencies

**2. Stage 2 (Position Monitoring) - Deploy Second**
- Critical capital protection
- Depends on price collection working
- Test with small positions first

**3. Stage 3 (Mid-Trade Execution) - Deploy Third**
- Depends on position monitoring logs
- Test with non-critical alerts first

**4. Stage 4 (Wellness Monitoring) - Deploy Fourth**
- Lower priority, nice-to-have
- Can deploy after core systems stable

**5. Stage 5 (Health UI) - Deploy Last**
- Pure UI enhancement
- No system dependencies

### Rollback Plan

Each stage is independent and can be rolled back:
1. Remove function from netlify.toml
2. Redeploy without function
3. Browser monitoring continues as backup

---

## CCIP Phase 6: Post-Deploy Verification

### Stage 1 Verification (Price Collection)
- [ ] Check `price_collection_health` table has entries
- [ ] Verify success rate > 95% for all symbols
- [ ] No stale price warnings in logs
- [ ] MetaAPI timeout handling working

### Stage 2 Verification (Position Monitoring)
- [ ] Create test position
- [ ] Close browser completely
- [ ] Verify position closes at SL/TP
- [ ] Check `position_monitoring_logs` for entries
- [ ] Verify TP1 partial close works

### Stage 3 Verification (Mid-Trade Execution)
- [ ] Create test alert with short timeout
- [ ] Close browser
- [ ] Verify alert executes automatically
- [ ] Check push notification received
- [ ] Verify execution logged

### Stage 4 Verification (Wellness Monitoring)
- [ ] Create position with 30% drawdown
- [ ] Wait 15 minutes
- [ ] Verify wellness check logged
- [ ] Check if Alpha analysis triggered
- [ ] Verify recommendations executed

### Stage 5 Verification (Health UI)
- [ ] Health dashboard displays metrics
- [ ] Success rates calculated correctly
- [ ] Alerts visible for failures
- [ ] Historical data showing

---

## Success Metrics

**Capital Protection:**
- 0 missed SL/TP exits due to browser throttling
- 100% of positions monitored 24/7
- Sub-10-second response time for SL/TP hits

**Reliability:**
- 99.9% uptime for monitoring functions
- 95%+ price collection success rate
- 100% of mid-trade alerts execute on time

**Observability:**
- All monitoring checks logged
- Health metrics visible in dashboard
- Audit trail for all automated decisions

---

## Risk Assessment

**Low Risk:**
- New functions don't modify existing code
- Browser monitoring continues during migration
- Can run both systems in parallel
- Easy rollback per stage

**Mitigation:**
- Test each stage independently
- Monitor logs continuously
- Keep browser monitoring as backup initially
- Gradual user migration

---

## Timeline

**Total Implementation:** 4-6 hours

- Stage 1: 45 minutes (price collection)
- Stage 2: 90 minutes (position monitoring)
- Stage 3: 60 minutes (mid-trade execution)
- Stage 4: 60 minutes (wellness monitoring)
- Stage 5: 45 minutes (health UI)
- Testing & Deployment: 60 minutes

---

## Approval & Sign-off

**Architecture Review:** ✅ APPROVED
**SSOT Compliance:** ✅ VERIFIED
**CCIP Compliance:** ✅ COMPLETE
**Ready for Implementation:** ✅ YES

---

*This plan follows CCIP (Change Control Intelligence Protocol) and SSOT (Single Source of Truth) principles. All changes are staged, reversible, and maintain system integrity.*
