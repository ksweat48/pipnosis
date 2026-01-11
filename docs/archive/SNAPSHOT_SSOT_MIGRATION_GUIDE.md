# Snapshot SSOT Migration Guide

## Overview

This guide explains the architectural refactoring from **caching Omega outputs** (wrong) to **caching input snapshots** (correct).

---

## The Problem with Old Architecture

### OLD FLOW (Wrong):
```
1. Alpha-Omega-Orchestrator starts
2. For each Omega:
   - Build snapshot separately
   - Check if Omega vote is cached
   - If cached: return cached vote
   - If not: compute vote → cache it
3. Omegas see DIFFERENT data (timing + separate queries)
4. "Omega-1 saw 4461.70, Omega-2 saw 4461.42" bugs
5. Repeated DB reads (7+ queries per scan)
```

### Issues:
- ❌ Caching deterministic outputs (Omega votes)
- ❌ Each Omega queries candles separately
- ❌ Inconsistent ATR/price across Omegas
- ❌ Repeated indicator computation
- ❌ Stale cache causing incorrect signals

---

## The Solution: Snapshot SSOT

### NEW FLOW (Correct):
```
1. Alpha-Omega-Orchestrator starts
2. Get shared snapshot ONCE (from cache or build fresh):
   - Fetch candles (ONE DB query)
   - Compute indicators (EMA, RSI, ATR, VWAP) ONCE
   - Compute OmegaSensors (BOS, CHoCH, etc.) ONCE
   - Cache snapshot with short TTL (5-30s based on timeframe)
3. Pass SAME snapshot to ALL Omegas
4. Each Omega computes vote (instant, deterministic, <5ms)
5. Collect votes → pass to Alpha
6. Check Alpha cache (LLM decision caching)
7. If Alpha cached: return decision
8. If not: Call OpenAI → cache decision
```

### Benefits:
- ✅ One DB query per symbol/timeframe/cycle
- ✅ All Omegas see IDENTICAL data
- ✅ No "price drift" bugs between Omegas
- ✅ Indicators computed ONCE
- ✅ Cache only expensive operations (Alpha LLM calls)
- ✅ Deterministic Omega votes always fresh

---

## Implementation

### 1. New Services Created

#### A. `market-snapshot-cache.ts` (SSOT Input Cache)
```typescript
// Purpose: Cache expensive INPUT operations
class MarketSnapshotCache {
  async getSnapshot(symbol, timeframe, riskMode): MarketSnapshotData {
    // Check cache first (TTL: 5-30s based on timeframe)
    // If cached: return (avoids DB read)
    // If not: build fresh snapshot:
    //   - Fetch candles (ONE DB query)
    //   - Compute ALL indicators
    //   - Compute OmegaSensors
    //   - Cache for short TTL
    // Return snapshot
  }
}
```

**What it caches:**
- Raw candle data
- Technical indicators (EMA, RSI, ATR, VWAP, MACD)
- OmegaSensors (BOS, CHoCH, volume spikes, etc.)
- Market structure analysis
- Support/resistance levels

**TTL Configuration:**
- M5: 5 seconds (fast-moving)
- M15: 30 seconds (medium)
- H1: 2 minutes (slow)
- H4: 5 minutes (very slow)

#### B. `shared-intelligence-coordinator-refactored.ts`
```typescript
// Purpose: Manage snapshot SSOT + Alpha LLM cache
class SharedIntelligenceCoordinator {
  // NEW: Get snapshot (delegates to MarketSnapshotCache)
  async getMarketSnapshot(symbol, timeframe, riskMode): MarketSnapshotData {
    return marketSnapshotCache.getSnapshot(symbol, timeframe, riskMode);
  }

  // KEEP: Alpha LLM cache (expensive operation)
  async getAlphaStrategicInsight(...): AlphaStrategicInsight {
    // Check cache → return if hit
    // Otherwise: call LLM → cache decision
  }

  // REMOVED: getOmegaIntelligence() - no longer needed
}
```

---

### 2. Migration Steps for Alpha-Omega-Orchestrator

#### BEFORE (Old Architecture):
```typescript
async makeTradeDecision(marketState, ...): Promise<AlphaDecision> {
  // ❌ OLD: Build snapshots separately for each Omega
  const trendSnap = this.buildTrendSnapshot(marketState);
  const scalperSnap = this.buildScalperSnapshot(marketState);
  // ... repeat for each Omega

  // ❌ OLD: Call Omegas with cache wrapper (caching deterministic votes)
  const [trendCached, scalperCached, ...] = await Promise.all([
    sharedIntelligenceCoordinator.getOmegaIntelligence('trend', ...),
    sharedIntelligenceCoordinator.getOmegaIntelligence('scalper', ...),
    // ... repeat for each Omega
  ]);

  // Convert cached results to votes
  const trendVote = trendCached ? trendCached.vote : null;
  // ...
}
```

#### AFTER (New Architecture):
```typescript
async makeTradeDecision(marketState, ...): Promise<AlphaDecision> {
  // ✅ NEW: Get shared snapshot ONCE (from cache or build fresh)
  const snapshot = await sharedIntelligenceCoordinator.getMarketSnapshot(
    marketState.symbol,
    entryTimeframe,
    riskMode
  );

  console.log(`[Alpha+Omega] 📊 Snapshot: ${snapshot.snapshotHash}`);
  console.log(`  Price: ${snapshot.price} | ATR: ${snapshot.atr}`);
  console.log(`  All Omegas will see THIS EXACT DATA`);

  // ✅ NEW: Call Omegas directly (deterministic, instant)
  const [trendVote, scalperVote, ...] = await Promise.all([
    omegaTrend.evaluate({
      p: snapshot.price,
      e20: snapshot.ema20,
      e50: snapshot.ema50,
      e200: snapshot.ema200,
      mom: snapshot.momentum,
      tr: snapshot.trend,
      vol: snapshot.volatility
    }),
    omegaScalper.evaluate({
      p: snapshot.price,
      vw: snapshot.vwap,
      atr: snapshot.atr,
      rsi: snapshot.rsi,
      vol: snapshot.volatility,
      c: snapshot.candles.slice(-3).map(c => [c.open, c.high, c.low, c.close])
    }),
    // ... call other Omegas with shared snapshot
  ]);

  // ✅ Collect votes (no cache wrapper needed)
  const omegaVotes = [
    { brainName: 'trend', vote: trendVote.vote, confidence: trendVote.confidence },
    { brainName: 'scalper', vote: scalperVote.vote, confidence: scalperVote.confidence },
    // ...
  ];

  // ✅ KEEP: Alpha LLM cache (expensive operation)
  const alphaInsight = await sharedIntelligenceCoordinator.getAlphaStrategicInsight(
    marketState.symbol,
    entryTimeframe,
    omegaVotes,
    async () => {
      // Call OpenAI (~$0.20)
      return await alphaCoordinator.coordinate(...);
    }
  );

  return alphaInsight;
}
```

---

## Key Architectural Principles

### 1. Cache Inputs, Not Outputs
**❌ Wrong:**
```typescript
// Caching deterministic Omega votes
const cachedVote = cache.get('omega:trend:vote');
if (cachedVote) return cachedVote;

const vote = computeTrendVote(snapshot);
cache.set('omega:trend:vote', vote);
```

**✅ Correct:**
```typescript
// Cache the snapshot (input SSOT)
const snapshot = await snapshotCache.get(symbol, timeframe);
// All Omegas use the SAME snapshot

// Compute votes fresh (deterministic, instant)
const trendVote = omegaTrend.evaluate(snapshot);
const scalperVote = omegaScalper.evaluate(snapshot);
```

### 2. Cache Only Expensive Operations
**What to cache:**
- ✅ Alpha LLM calls (~$0.10-0.50, 500-2000ms)
- ✅ Market snapshots (DB reads + indicator computation, ~100-500ms)
- ✅ Midtrade LLM escalations (if used)

**What NOT to cache:**
- ❌ Deterministic Omega votes (<5ms computation)
- ❌ Simple math operations
- ❌ Local lookups

### 3. SSOT for Market Data
**One snapshot per symbol/timeframe/cycle:**
- All Omegas see identical price
- All Omegas see identical ATR
- All Omegas see identical indicators
- No "drift" between Omegas

### 4. TTL Matches Market Dynamics
**Fast timeframes = short TTL:**
- M5: 5 seconds (price changes rapidly)
- M15: 30 seconds (moderate movement)
- H1: 2 minutes (slower changes)

**Why?**
- Balance between cache efficiency and data freshness
- Prevent stale signals in fast-moving markets
- Allow cache reuse in stable conditions

---

## Database Schema Changes

### Keep:
- `alpha_strategic_cache` - Alpha LLM decisions
- `cache_stats_log` - Analytics

### Remove (Optional):
- `omega_market_intelligence` - No longer needed (Omega votes not cached)
- Can be kept for analytics/debugging if desired

### Add (Optional):
- `market_snapshot_cache` - If DB persistence is desired
- Currently using in-memory cache (faster, simpler)

---

## Testing the Migration

### 1. Verify Snapshot SSOT
```typescript
// All Omegas should log the SAME snapshot hash
console.log(`[Omega-1] Snapshot hash: abc123def456`);
console.log(`[Omega-2] Snapshot hash: abc123def456`); // ✅ Same
console.log(`[Omega-3] Snapshot hash: abc123def456`); // ✅ Same
```

### 2. Check Cache Hit Rates
```typescript
const stats = marketSnapshotCache.getStats();
console.log(`Snapshot cache hit rate: ${stats.hitRate.toFixed(1)}%`);
// Expected: 60-80% after warm-up

const alphaStats = await sharedIntelligenceCoordinator.getCacheStats();
console.log(`Alpha cache hit rate: ${alphaStats[0].hitRate.toFixed(1)}%`);
// Expected: 50-70% (depends on market volatility)
```

### 3. Monitor Performance
```typescript
// Before (old architecture):
// - 7+ DB queries per scan
// - 200-500ms total latency
// - Inconsistent data across Omegas

// After (new architecture):
// - 1 DB query per scan (if not cached)
// - 50-150ms total latency (80% from cache)
// - 100% consistent data across Omegas
```

---

## Rollout Plan

### Phase 1: Deploy New Services ✅
- [x] Create `market-snapshot-cache.ts`
- [x] Create `shared-intelligence-coordinator-refactored.ts`
- [x] Test in isolation

### Phase 2: Update Alpha-Omega-Orchestrator
- [ ] Refactor `makeTradeDecision()` to use snapshot-first flow
- [ ] Remove per-Omega cache lookups
- [ ] Update snapshot building logic
- [ ] Test with single symbol

### Phase 3: Update Multi-Symbol Scanner
- [ ] Refactor to use shared snapshots
- [ ] Test with multiple symbols
- [ ] Monitor cache performance

### Phase 4: Cleanup
- [ ] Replace old `SharedIntelligenceCoordinator` with refactored version
- [ ] Remove obsolete cache tables (optional)
- [ ] Update documentation
- [ ] Monitor production metrics

### Phase 5: Optimization (Optional)
- [ ] Fine-tune TTLs based on production data
- [ ] Add DB persistence for snapshots (if needed)
- [ ] Implement cache warming strategies

---

## Expected Improvements

### Performance:
- **DB Load:** 80-90% reduction (1 query vs 7+ per scan)
- **Latency:** 40-60% reduction (cache hits)
- **Consistency:** 100% (all Omegas see same data)

### Cost:
- **Alpha LLM:** 50-70% savings (cache hits)
- **Infrastructure:** Lower DB costs (fewer queries)

### Reliability:
- **Bug Reduction:** Eliminates "price drift" bugs
- **Predictability:** Deterministic Omega behavior
- **Debugging:** Easier to trace (snapshot hash)

---

## Troubleshooting

### Issue: Low Cache Hit Rate
**Symptoms:** Hit rate < 40%
**Causes:**
- TTL too short
- High market volatility
- Frequent symbol switching

**Solutions:**
- Increase TTL (but watch for stale data)
- Pre-warm cache for active symbols
- Monitor cache invalidation frequency

### Issue: Stale Data
**Symptoms:** Old prices, outdated indicators
**Causes:**
- TTL too long
- Cache not invalidated on price drift

**Solutions:**
- Reduce TTL for fast timeframes
- Implement price drift detection
- Force refresh on user actions

### Issue: Memory Usage
**Symptoms:** High RAM consumption
**Causes:**
- Too many cached snapshots
- Large candle arrays in cache

**Solutions:**
- Limit cache size (LRU eviction)
- Reduce candle count in snapshot
- Move to DB-backed cache if needed

---

## Summary

### Old Model:
```
❌ Cache Omega votes (deterministic outputs)
❌ Each Omega queries separately
❌ Inconsistent data across Omegas
❌ Repeated DB reads
```

### New Model:
```
✅ Cache market snapshots (expensive inputs)
✅ All Omegas share SAME snapshot
✅ One DB query per cycle
✅ Cache only Alpha LLM calls
✅ Deterministic Omegas always fresh
```

### Result:
- **Faster:** 40-60% latency reduction
- **Cheaper:** 50-70% LLM cost reduction
- **Correct:** 100% data consistency
- **Simpler:** Cleaner architecture

---

## Next Steps

1. Review this guide
2. Test new services in development
3. Refactor Alpha-Omega-Orchestrator
4. Deploy to staging
5. Monitor metrics
6. Roll out to production
7. Clean up old code

---

**Architecture is now correct: Cache inputs (snapshots), not outputs (votes).**
