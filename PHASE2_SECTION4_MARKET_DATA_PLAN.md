# Phase 2, Section 4: Market Data Access Consolidation - Plan

**Status:** PLANNED - To be implemented in future phase
**Priority:** HIGH - 16 services making direct database queries
**Complexity:** HIGH - Large refactor across many files

---

## Executive Summary

**Goal:** Consolidate all direct `forex_candles` database queries to use `MarketDataService` as the Single Source of Truth.

**Problem:** 16 services bypass MarketDataService and query `forex_candles` table directly, creating:
- Duplicate query logic
- No centralized caching strategy
- Inconsistent data access patterns
- Difficult to add new data sources

**Solution:** Route all candle data access through `MarketDataService`, establishing it as the authoritative data access layer.

---

## Violations Found (16 Files)

From architectural compliance test:

1. services/aggregator-health-monitor.ts
2. services/cache-warming-service.ts
3. services/chart-data-guarantor.ts
4. services/concurrent-bulk-loader.ts
5. services/coordinators/price-coordinator.ts
6. services/daily-narrative-builder.ts
7. services/emergency-price-poller.ts
8. services/gap-monitoring-service.ts
9. services/goal-session-manager.ts
10. services/historical-backfill-service.ts
11. services/historical-data-monitor.ts
12. services/kraken-backfill-service.ts
13. services/market-snapshot-cache.ts
14. services/position-monitor.ts
15. services/trade-lifecycle-manager.ts
16. services/wick-reconstruction-service.ts

---

## SSOT Authority

**MarketDataService** (`src/services/market-data-service.ts`)
- **Responsibility:** All candle data access
- **Methods:**
  - `getCandles(symbol, timeframe, limit)`
  - `getLatestCandle(symbol, timeframe)`
  - `getCandleRange(symbol, timeframe, startTime, endTime)`
  - Caching strategy
  - Data validation
  - Multi-source fallback

---

## Implementation Strategy

### Phase 1: Categorize Violations by Complexity

**Low Complexity (Quick Wins):**
- Simple SELECT queries
- Single table access
- No complex joins
- Easy to replace with MarketDataService calls

**Medium Complexity:**
- Queries with filtering/ordering
- Multiple timeframes
- Aggregations
- May need new MarketDataService methods

**High Complexity:**
- Complex joins
- Write operations (backfill services)
- Performance-critical paths
- May need architectural changes

### Phase 2: Create Missing MarketDataService Methods

Audit all direct queries and ensure MarketDataService has equivalent methods:
- Bulk operations for backfill services
- Gap detection queries
- Health check queries
- Aggregation queries

### Phase 3: Refactor Services

For each violating service:
1. Import MarketDataService
2. Replace direct queries with service calls
3. Remove direct supabase imports
4. Test thoroughly
5. Document changes

---

## Example Refactor

### BEFORE (Direct Query):
```typescript
// services/position-monitor.ts
const { data: candles } = await supabase
  .from('forex_candles')
  .select('*')
  .eq('symbol', symbol)
  .eq('timeframe', timeframe)
  .order('timestamp', { ascending: false })
  .limit(100);
```

### AFTER (Via MarketDataService):
```typescript
// services/position-monitor.ts
import { marketDataService } from './market-data-service';

const candles = await marketDataService.getCandles(symbol, timeframe, 100);
```

**Benefits:**
- ✅ Centralized caching
- ✅ Consistent error handling
- ✅ Easier to switch data sources
- ✅ Single point for data validation

---

## Risks & Mitigation

### Risk 1: Performance Degradation
**Mitigation:**
- Ensure MarketDataService has efficient caching
- Batch operations where possible
- Monitor query performance

### Risk 2: Breaking Backfill Services
**Mitigation:**
- Backfill services may need write access
- Consider creating BackfillService layer
- Thorough testing of historical data operations

### Risk 3: Large Refactor Scope
**Mitigation:**
- Break into smaller phases
- Fix high-traffic services first
- Deploy incrementally

---

## Success Criteria

- ✅ Zero direct forex_candles queries outside MarketDataService
- ✅ All services import MarketDataService for candle data
- ✅ Architectural compliance test passes
- ✅ No performance degradation
- ✅ All tests pass

---

## Estimated Effort

- **Planning:** 1 hour (complete)
- **MarketDataService enhancements:** 2-3 hours
- **Service refactoring:** 4-6 hours (16 files)
- **Testing:** 2-3 hours
- **Total:** 9-13 hours

---

## Recommendation

**DEFER to Phase 3** due to:
1. Large scope (16 files)
2. Risk of breaking critical data paths
3. Requires careful testing
4. Phase 2 Sections 1 & 2 already deliver significant value

---

## Next Steps (Future Phase)

1. Audit MarketDataService API completeness
2. Add missing methods for complex queries
3. Create BackfillService for write operations
4. Refactor services in priority order:
   - High-traffic read paths first
   - Low-risk services next
   - Backfill services last
5. Deploy incrementally with monitoring

---

**Status:** Documented for future implementation
**Priority:** HIGH (but deferred to Phase 3)
**Impact:** Would eliminate 16 SSOT violations and centralize all data access
