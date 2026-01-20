# Phase 2: Section 3 - Market Data Fetching Consolidation Audit

**Date:** 2026-01-20
**Status:** 🔍 AUDIT COMPLETE - READY FOR IMPLEMENTATION
**Priority:** P0 - Critical Architecture Fix

---

## Executive Summary

**Authority:** `MarketDataService` at `/src/services/market-data-service.ts`

**Problem:** 86 files directly query `realtime_prices` (36 files) and `forex_candles` (50 files) tables, bypassing the central authority. This creates:
- ❌ Inconsistent freshness validation
- ❌ Duplicate price fetching logic
- ❌ No centralized error handling
- ❌ Performance issues (redundant queries)
- ❌ Maintenance nightmare (fix bugs in 86 places)

**Solution:** Route all market data fetching through `MarketDataService` as the Single Source of Truth.

---

## SSOT Violations by Priority

### 🔴 HIGH PRIORITY (Core Trading Logic) - 15 Files

These files are part of critical trading flows and MUST use MarketDataService:

1. **src/services/goal-session-live-engine.ts** (forex_candles)
   - Impact: Goal-based trade execution
   - Direct candle queries for analysis
   - Should use: `MarketDataService.getCandles()`

2. **src/services/alpha-execution-planner.ts** (forex_candles)
   - Impact: Alpha brain trade planning
   - Direct candle queries for setup validation
   - Should use: `MarketDataService.getCandles()`

3. **src/services/entry-advisor.ts** (realtime_prices)
   - Impact: Entry intent validation
   - Direct price queries for zone checks
   - Should use: `MarketDataService.getCurrentPrice()`

4. **src/services/trade-lifecycle-manager.ts** (both)
   - Impact: Trade execution and monitoring
   - Direct price and candle queries
   - Should use: Both `getCurrentPrice()` and `getCandles()`

5. **src/services/position-monitor.ts** (both)
   - Impact: Position SL/TP monitoring
   - Direct price queries for PnL calculation
   - Should use: `MarketDataService.getCurrentPrice()`

6. **src/services/coordinators/trade-closure-coordinator.ts** (realtime_prices)
   - Impact: Trade closure logic
   - Direct price queries for final PnL
   - Should use: `MarketDataService.getCurrentPrice()`

7. **src/services/market-snapshot-builder.ts** (forex_candles)
   - Impact: LLM context building
   - Direct candle queries for market state
   - Should use: `MarketDataService.getCandles()`

8. **src/services/enhanced-market-regime-detector.ts** (forex_candles)
   - Impact: Regime classification
   - Direct candle queries for volatility
   - Should use: `MarketDataService.getCandles()`

9. **src/services/market-regime-detector.ts** (forex_candles)
   - Impact: Legacy regime detection
   - Direct candle queries
   - Should use: `MarketDataService.getCandles()`

10. **src/services/m5-microstructure-provider.ts** (forex_candles)
    - Impact: Order flow analysis
    - Direct M5 candle queries
    - Should use: `MarketDataService.getCandles()`

11. **src/services/currency-correlation-service.ts** (forex_candles)
    - Impact: Correlation risk management
    - Direct candle queries for correlation calc
    - Should use: `MarketDataService.getCandles()`

12. **src/services/goal-scanner-trigger.ts** (forex_candles)
    - Impact: Automated scanning triggers
    - Direct candle queries for timing
    - Should use: `MarketDataService.getCandles()`

13. **src/services/llm-pair-selector.ts** (forex_candles)
    - Impact: Symbol selection for trading
    - Direct candle queries for volatility
    - Should use: `MarketDataService.getCandles()`

14. **src/services/multi-symbol-ranker.ts** (forex_candles)
    - Impact: Best pair selection
    - Direct candle queries for ranking
    - Should use: `MarketDataService.getCandles()`

15. **src/services/goal-session-core-engine.ts** (forex_candles)
    - Impact: Core goal session logic
    - Direct candle queries
    - Should use: `MarketDataService.getCandles()`

---

### 🟡 MEDIUM PRIORITY (Support Systems) - 12 Files

These files support trading but aren't critical path:

16. **src/services/chart-candle-poller.ts** (both)
    - Impact: Chart data provision
    - Borderline: May need direct access for performance
    - Consider: Use MarketDataService with caching

17. **src/services/optimized-candle-manager.ts** (both)
    - Impact: Chart optimization
    - Borderline: Performance-critical
    - Consider: Use MarketDataService with caching

18. **src/services/chart-direct-price-poller.ts** (realtime_prices)
    - Impact: Chart live prices
    - Borderline: Real-time updates
    - Consider: Use MarketDataService

19. **src/services/candle-data-service.ts** (forex_candles)
    - Impact: Legacy candle service
    - Should: Refactor to use MarketDataService or merge

20. **src/services/daily-narrative-builder.ts** (forex_candles)
    - Impact: Daily summaries
    - Should use: `MarketDataService.getCandles()`

21. **src/services/historical-data-monitor.ts** (forex_candles)
    - Impact: Data quality monitoring
    - Consider: May need direct access for monitoring

22. **src/services/gap-monitoring-service.ts** (forex_candles)
    - Impact: Gap detection
    - Should use: `MarketDataService.getCandles()`

23. **src/services/emergency-price-poller.ts** (forex_candles)
    - Impact: Fallback price fetching
    - Borderline: Emergency system
    - Consider: Use MarketDataService with timeout

24. **src/services/sltp-diagnostic-service.ts** (realtime_prices)
    - Impact: Diagnostic tool
    - Low priority: Monitoring only

25. **src/services/realtime-gap-detector.ts** (realtime_prices)
    - Impact: Price gap detection
    - Should use: `MarketDataService.getCurrentPrice()`

26. **src/services/weekend-protection-service.ts** (realtime_prices)
    - Impact: Weekend closure logic
    - Should use: `MarketDataService.getCurrentPrice()`

27. **src/services/omega10-scheduler.ts** (realtime_prices)
    - Impact: Omega brain scheduling
    - Should use: `MarketDataService.getCurrentPrice()`

---

### ⚪ LOW PRIORITY / EXEMPT (Data Producers & Diagnostics) - 22 Files

These files are DATA PRODUCERS or diagnostic tools and are EXEMPT from consolidation:

**Data Producers (EXEMPT):**
- netlify/functions/save-websocket-price.ts (writes to realtime_prices)
- netlify/functions/hybrid-price-collector.ts (writes to realtime_prices)
- netlify/functions/continuous-candle-aggregator.ts (writes to forex_candles)
- netlify/functions/automatic-gap-filler.ts (writes to forex_candles)
- netlify/functions/backfill-all-timeframes-new-pairs.ts (writes to forex_candles)
- netlify/functions/dukascopy-historical-backfill.ts (writes to forex_candles)
- supabase/functions/backfill-historical-candles/index.ts (writes to forex_candles)
- supabase/functions/twelve-data-bootstrap/index.ts (writes to forex_candles)
- supabase/functions/dukascopy-backfill/index.ts (writes to forex_candles)
- supabase/functions/finnhub-backfill/index.ts (writes to forex_candles)
- supabase/functions/metaapi-backfill/index.ts (writes to forex_candles)
- src/services/candle-persistence-service.ts (writes to forex_candles)
- src/services/background-candle-aggregator.ts (writes to forex_candles)
- src/services/wick-reconstruction-service.ts (writes to forex_candles)
- src/services/current-candle-reconstructor.ts (writes to forex_candles)
- src/services/historical-backfill-service.ts (writes to forex_candles)
- src/services/kraken-backfill-service.ts (writes to forex_candles)

**Diagnostic/Monitoring Tools (EXEMPT):**
- src/components/DataResetPanel.tsx (admin diagnostic)
- src/components/ServerSideAggregatorStatus.tsx (monitoring)
- src/components/ServerSidePollingMonitor.tsx (monitoring)
- src/pages/SystemDiagnosticsPage.tsx (diagnostic page)
- src/services/aggregator-health-monitor.ts (health monitoring)
- src/services/candle-quality-validator.ts (data quality)

**Special Cases:**
- netlify/functions/realtime-prices-cleanup.ts (maintenance)
- src/services/database-service.ts (legacy service)
- src/governance/price-freshness-gate.ts (freshness validation - may need direct access)
- src/services/coordinators/price-coordinator.ts (coordinator - review needed)

---

## Architecture Impact

### Before Section 3:
```
❌ 86 files directly query database
❌ No centralized freshness validation
❌ Duplicate error handling in 86 places
❌ Fix-in-many-places for price bugs
❌ Inconsistent staleness thresholds
❌ No centralized logging
```

### After Section 3:
```
✅ MarketDataService as Single Source of Truth
✅ Centralized freshness validation
✅ Unified error handling
✅ Fix-once-everywhere for price bugs
✅ Consistent staleness thresholds (10s fresh, 30s stale)
✅ Centralized logging and monitoring
```

---

## Implementation Plan

### Phase 1: HIGH PRIORITY (15 files) - Estimated 2 hours

1. **goal-session-live-engine.ts**
   - Replace direct forex_candles queries
   - Use `MarketDataService.getCandles()`

2. **alpha-execution-planner.ts**
   - Replace direct forex_candles queries
   - Use `MarketDataService.getCandles()`

3. **entry-advisor.ts**
   - Replace direct realtime_prices queries
   - Use `MarketDataService.getCurrentPrice()`

4. **trade-lifecycle-manager.ts**
   - Replace both price and candle queries
   - Use appropriate MarketDataService methods

5. **position-monitor.ts**
   - Replace direct realtime_prices queries
   - Use `MarketDataService.getCurrentPrice()`

6-15. Continue with remaining HIGH priority files...

### Phase 2: MEDIUM PRIORITY (12 files) - Estimated 1 hour

16-27. Refactor support systems to use MarketDataService...

### Phase 3: Testing & Verification - Estimated 30 minutes

- Build verification
- Manual testing of critical trading flows
- Monitor logs for errors

---

## MarketDataService API Reference

### Current Price Fetching
```typescript
// Get current price with freshness validation
const priceData = await marketDataService.getCurrentPrice(symbol);

// Returns:
{
  price: number,     // Mid price (bid + ask) / 2
  bid: number,
  ask: number,
  timestamp: Date,
  freshness: 'fresh' | 'stale' | 'invalid'
}

// Returns null if:
// - No data found
// - Price older than 30 seconds (invalid)
// - Database error
```

### Candle Data Fetching
```typescript
// Get recent candles for analysis
const candles = await marketDataService.getCandles(symbol, timeframe, limit);

// Returns CandleData[]
{
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
  open_time: string
}
```

---

## Success Metrics

### Code Quality
- [ ] 15 HIGH priority files refactored
- [ ] 12 MEDIUM priority files refactored
- [ ] Zero direct database queries in trading logic
- [ ] All market data routed through MarketDataService

### Architecture
- [ ] Single Source of Truth established
- [ ] Centralized freshness validation
- [ ] Unified error handling
- [ ] Centralized logging

### Testing
- [ ] Build passes without errors
- [ ] Goal-based trading works
- [ ] Entry intent execution works
- [ ] Position monitoring works
- [ ] Trade closure works

---

## Risk Assessment

### LOW RISK
- Changes are internal architecture improvements
- MarketDataService already exists and is battle-tested
- No breaking changes to external APIs
- Existing functionality preserved

### MITIGATION
- Implement HIGH priority files first
- Test after each file refactored
- Monitor production logs for errors
- Easy rollback if issues arise

---

## Next Steps

1. ✅ Audit complete (this document)
2. 🔜 Implement HIGH priority files (2 hours)
3. 🔜 Implement MEDIUM priority files (1 hour)
4. 🔜 Build verification and testing (30 minutes)
5. 🔜 Deploy to production
6. 🔜 Create completion report

**Total Estimated Time:** 3.5 hours
**Priority:** P0 - Critical for Phase 2 completion

---

**Audit By:** CCIP Governance System
**Date:** 2026-01-20
**Status:** Ready for Implementation
