# Phase 3.1 Section 4: Market Data Consolidation - Analysis

**Status:** IN PROGRESS
**Date:** January 22, 2026
**CCIP Stage:** System Map

---

## Current State

**Problem:** 16 services bypass MarketDataService and query `forex_candles` directly

**Impact:**
- No centralized caching strategy
- Inconsistent data access patterns
- Difficult to optimize queries
- Scattered business logic
- Hard to maintain and debug

---

## Violating Services Analysis

### Category 1: Health & Monitoring (Read-Only)
**Services:** 5
- `aggregator-health-monitor.ts` - Candle freshness, count, intervals
- `historical-data-monitor.ts` - Coverage statistics
- `gap-monitoring-service.ts` - Gap detection in time ranges
- `chart-data-guarantor.ts` - Data availability checks
- `position-monitor.ts` - Candle availability for price updates

**Common Patterns:**
- Get last candle time
- Count candles (total, by timeframe, in range)
- Get candles in time range
- Calculate intervals between candles

**Complexity:** LOW
**Risk:** LOW (read-only)

---

### Category 2: Caching & Warming (Read-Only)
**Services:** 3
- `cache-warming-service.ts` - Pre-load candles
- `concurrent-bulk-loader.ts` - Bulk candle fetching
- `market-snapshot-cache.ts` - Multi-symbol candle caching

**Common Patterns:**
- Bulk fetch candles for multiple symbols
- Get latest N candles
- Time-range queries

**Complexity:** MEDIUM
**Risk:** LOW (read-only, performance-critical)

---

### Category 3: Trade Lifecycle (Read-Only)
**Services:** 3
- `goal-session-manager.ts` - Session candle tracking
- `trade-lifecycle-manager.ts` - Trade candle context
- `price-coordinator.ts` - Price/candle coordination

**Common Patterns:**
- Get latest candle
- Get candles for trade timeframe
- Candle-to-price mapping

**Complexity:** MEDIUM
**Risk:** MEDIUM (critical path)

---

### Category 4: Backfill & Write Operations
**Services:** 3
- `historical-backfill-service.ts` - Candle statistics, writes
- `kraken-backfill-service.ts` - Crypto candle backfill
- `wick-reconstruction-service.ts` - Candle reconstruction

**Common Patterns:**
- Count candles by source/quality
- Insert/update candles
- Deduplication
- Quality validation

**Complexity:** HIGH
**Risk:** HIGH (write operations, data integrity)

---

### Category 5: Processing & Analysis (Mixed)
**Services:** 2
- `daily-narrative-builder.ts` - Day summary from candles
- `emergency-price-poller.ts` - Fallback candle-based pricing

**Common Patterns:**
- Get candles for date range
- Latest candle as price source
- Aggregation queries

**Complexity:** MEDIUM
**Risk:** MEDIUM

---

## Missing MarketDataService Methods

### Read Operations Needed

#### 1. getLastCandle()
```typescript
async getLastCandle(
  symbol: string,
  timeframe: string
): Promise<CandleData | null>
```
**Used by:** 8 services
**Purpose:** Get most recent candle for symbol/timeframe

#### 2. getCandleCount()
```typescript
async getCandleCount(
  symbol?: string,
  timeframe?: string,
  startTime?: Date,
  endTime?: Date
): Promise<number>
```
**Used by:** 5 services
**Purpose:** Count candles with optional filters

#### 3. getCandlesInRange()
```typescript
async getCandlesInRange(
  symbol: string,
  timeframe: string,
  startTime: Date,
  endTime: Date,
  orderAsc?: boolean
): Promise<CandleData[]>
```
**Used by:** 7 services
**Purpose:** Get candles within time window

#### 4. getBulkCandles()
```typescript
async getBulkCandles(
  symbols: string[],
  timeframe: string,
  limit: number
): Promise<Map<string, CandleData[]>>
```
**Used by:** 3 services
**Purpose:** Efficient multi-symbol fetch

#### 5. getCandleStatistics()
```typescript
async getCandleStatistics(
  symbol?: string,
  timeframe?: string
): Promise<CandleStats>
```
**Used by:** 2 services
**Purpose:** Aggregate statistics (oldest, newest, count, gaps)

#### 6. detectGaps()
```typescript
async detectGaps(
  symbol: string,
  timeframe: string,
  startTime: Date,
  endTime: Date,
  expectedIntervalMinutes: number
): Promise<Gap[]>
```
**Used by:** 2 services
**Purpose:** Find missing candles in expected sequence

---

## BackfillService Methods Needed

### Write Operations (Separate Authority)

#### 1. insertCandles()
```typescript
async insertCandles(
  candles: CandleInsert[],
  options?: { deduplicate?: boolean, validate?: boolean }
): Promise<InsertResult>
```
**Used by:** 3 services
**Purpose:** Batch insert with deduplication

#### 2. updateCandleQuality()
```typescript
async updateCandleQuality(
  symbol: string,
  timeframe: string,
  openTime: string,
  qualityScore: number
): Promise<boolean>
```
**Used by:** 2 services
**Purpose:** Update quality metrics

#### 3. deleteDuplicates()
```typescript
async deleteDuplicates(
  symbol?: string,
  timeframe?: string
): Promise<number>
```
**Used by:** 1 service
**Purpose:** Clean duplicate candles

---

## Implementation Strategy

### Phase 1: Enhance MarketDataService (2 hours)
1. Add 6 new read-only methods
2. Comprehensive JSDoc documentation
3. Error handling and logging
4. Query optimization

### Phase 2: Create BackfillService (1.5 hours)
1. New service for write operations
2. 3 write methods with validation
3. Deduplication logic
4. Quality checks

### Phase 3: Refactor Services - Batch 1 (2 hours)
**Low Complexity (5 services):**
- aggregator-health-monitor.ts
- gap-monitoring-service.ts
- chart-data-guarantor.ts
- position-monitor.ts
- historical-data-monitor.ts

**Changes:** Simple method replacements
**Risk:** LOW

### Phase 4: Refactor Services - Batch 2 (2.5 hours)
**Medium Complexity (5 services):**
- cache-warming-service.ts
- concurrent-bulk-loader.ts
- market-snapshot-cache.ts
- goal-session-manager.ts
- price-coordinator.ts

**Changes:** Method replacements with slight logic adjustments
**Risk:** MEDIUM

### Phase 5: Refactor Services - Batch 3 (3 hours)
**High Complexity (6 services):**
- trade-lifecycle-manager.ts
- daily-narrative-builder.ts
- emergency-price-poller.ts
- historical-backfill-service.ts
- kraken-backfill-service.ts
- wick-reconstruction-service.ts

**Changes:** Significant refactoring, write operation migration
**Risk:** HIGH

**Total Time:** 11 hours over 2-3 sessions

---

## Risk Mitigation

### Testing Strategy
- Unit tests for new methods
- Integration tests for critical paths
- Canary deployment (batch by batch)
- Rollback plan for each batch

### Rollback Points
- After Phase 1 (API enhancement)
- After Phase 2 (BackfillService)
- After each batch deployment

### Monitoring
- Query performance metrics
- Error rates per service
- Candle freshness checks
- Cache hit rates

---

## Success Criteria

- [ ] All 16 services use MarketDataService or BackfillService
- [ ] Zero direct forex_candles queries outside authorities
- [ ] No performance degradation
- [ ] Architectural compliance tests pass
- [ ] Production deployment successful

---

## Next Steps

1. Enhance MarketDataService with 6 new methods
2. Create BackfillService with 3 write methods
3. Begin Batch 1 refactoring (5 low-complexity services)
4. Deploy and monitor
5. Continue with Batches 2 and 3

---

**Status:** Analysis Complete - Ready for Implementation
**Estimated Total Time:** 11 hours (3 sessions)
**Priority:** HIGH (completes Phase 2 SSOT consolidation)
