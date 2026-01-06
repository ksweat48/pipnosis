# Snapshot SSOT Migration - Quick Start

## 🎯 Goal
Replace "caching Omega votes" with "caching input snapshots" for better performance and consistency.

---

## ✅ What's Already Done (Phase 1)

1. **MarketSnapshotCache** created (`src/services/market-snapshot-cache.ts`)
   - Caches market data inputs (candles + indicators)
   - TTL: 5s-10m based on timeframe
   - Ensures all Omegas see SAME data

2. **SharedIntelligenceCoordinator** refactored (`src/services/shared-intelligence-coordinator-refactored.ts`)
   - Removed Omega vote caching
   - Added snapshot SSOT management
   - Kept Alpha LLM caching

3. **Documentation** complete
   - Migration guide
   - Implementation summary
   - This quick start

---

## 🚀 Next Steps: Complete the Migration

### Step 1: Update Alpha-Omega-Orchestrator

**File:** `src/services/alpha-omega-orchestrator.ts`

**Current code (lines ~156-313):**
```typescript
// ❌ OLD: Build snapshots separately
const trendSnap = this.buildTrendSnapshot(marketState);
const scalperSnap = this.buildScalperSnapshot(marketState);
// ... etc

// ❌ OLD: Call Omegas with cache wrapper
const [trendCached, scalperCached, ...] = await Promise.all([
  sharedIntelligenceCoordinator.getOmegaIntelligence(
    marketState.symbol,
    entryTimeframe,
    'trend',
    marketState.recentCandles,
    async () => {
      const result = omegaTrend.evaluate(trendSnap);
      return { vote: result.vote, confidence: result.confidence, ... };
    }
  ),
  // ... repeat for each Omega
]);

const trendVote = trendCached ? trendCached.vote : null;
```

**Replace with:**
```typescript
// ✅ NEW: Get shared snapshot ONCE
const snapshot = await sharedIntelligenceCoordinator.getMarketSnapshot(
  marketState.symbol,
  entryTimeframe,
  riskMode
);

console.log(`[Alpha+Omega] 📊 Snapshot: ${snapshot.snapshotHash}`);
console.log(`  Price: ${snapshot.price} | ATR: ${snapshot.atr} | Trend: ${snapshot.trend}`);

// ✅ NEW: Call Omegas directly (deterministic, instant)
const [trendVote, scalperVote, confirmationVote, reversalVote, volatilityVote, omega8Vote] = await Promise.all([
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
  omegaConfirmation.evaluate({
    p: snapshot.price,
    sup: snapshot.support,
    res: snapshot.resistance,
    sw: { h: snapshot.swingHigh, l: snapshot.swingLow },
    str: this.determineStructure(snapshot.structure),
    tr: snapshot.trend
  }),
  omegaReversal.evaluate({
    p: snapshot.price,
    rsi: snapshot.rsi,
    st: snapshot.stochRsi,
    mom: snapshot.momentum,
    e20: snapshot.ema20,
    e50: snapshot.ema50,
    tr: snapshot.trend,
    vol: snapshot.volatility
  }),
  omegaVolatility.evaluate({
    atr: snapshot.atr,
    atr_avg: snapshot.atr,
    vol: snapshot.volatility,
    c: snapshot.candles.slice(-5).map(c => [c.open, c.high, c.low, c.close]),
    wick_ratio: this.calculateWickRatio(snapshot.candles.slice(-5).map(c => [c.open, c.high, c.low, c.close]))
  }),
  omega8Hybrid.runOmega8({
    symbol: snapshot.symbol,
    timeframe: entryTimeframe,
    price: snapshot.price,
    atr: snapshot.atr,
    candles: snapshot.candles.slice(-30).map(c => ({
      time: c.open_time ? new Date(c.open_time).getTime() : Date.now(),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume || 1000
    })),
    trendBias: snapshot.trend === 'bull' ? 'up' : snapshot.trend === 'bear' ? 'down' : 'sideways',
    support: snapshot.support,
    resistance: snapshot.resistance
  })
]).catch(errors => {
  console.error('[Alpha+Omega] Omega evaluation errors:', errors);
  return [null, null, null, null, null, null];
});
```

**Remove these methods (no longer needed):**
- `buildTrendSnapshot()`
- `buildScalperSnapshot()`
- `buildConfirmationSnapshot()`
- `buildReversalSnapshot()`
- `buildVolatilitySnapshot()`
- `buildOmega8HybridSnapshot()`

---

### Step 2: Update Imports

**At top of `alpha-omega-orchestrator.ts`:**

**Remove:**
```typescript
import { sharedIntelligenceCoordinator, type CachedOmegaIntelligence } from './shared-intelligence-coordinator';
```

**Add:**
```typescript
import { sharedIntelligenceCoordinator } from './shared-intelligence-coordinator-refactored';
```

---

### Step 3: Update evaluateMultipleSymbols()

**File:** `src/services/alpha-omega-orchestrator.ts` (lines ~502-592)

**Before each symbol evaluation:**
```typescript
// ✅ NEW: Pre-fetch snapshot (will be cached)
const snapshot = await sharedIntelligenceCoordinator.getMarketSnapshot(
  marketState.symbol,
  entryTimeframe,
  goalContext?.riskMode || 'medium'
);
```

---

### Step 4: Replace Old Coordinator

**After testing:**
```bash
# Backup old coordinator
mv src/services/shared-intelligence-coordinator.ts \
   src/services/shared-intelligence-coordinator-OLD-BACKUP.ts

# Activate new coordinator
mv src/services/shared-intelligence-coordinator-refactored.ts \
   src/services/shared-intelligence-coordinator.ts
```

---

### Step 5: Test Everything

**Run tests:**
```bash
npm run test
npm run build
```

**Check for import errors:**
```bash
# Search for old Omega caching usage
grep -r "getOmegaIntelligence" src/
# Should return: No matches (or only in backup files)

grep -r "CachedOmegaIntelligence" src/
# Should return: No matches (or only in backup files)
```

**Manual testing:**
1. Start app
2. Run a trade analysis
3. Check logs for:
   ```
   [SnapshotCache] ⚡ HIT: EURUSD@M15 (age: 2s) | Saved DB read
   [Alpha+Omega] 📊 Snapshot: 2025-01-06T12:00:00_1.09234
   ```
4. Verify all Omegas log SAME snapshot hash
5. Check no errors in console

---

### Step 6: Monitor Performance

**Before migration (baseline):**
- DB queries per scan: ~7-10
- Response time: ~200-500ms
- Cache inconsistencies: Yes (Omega drift bugs)

**After migration (target):**
- DB queries per scan: ~1 (80% cached)
- Response time: ~50-150ms
- Cache inconsistencies: None (all Omegas see same snapshot)

**Check cache stats:**
```typescript
// In console or add to monitoring
marketSnapshotCache.logStats();
// Expected output:
// [SnapshotCache] 📊 Stats:
//   Hits: 24 | Misses: 6 | Hit Rate: 80.0%
//   Cache Size: 5 snapshots
//   DB Reads Avoided: 24
```

---

## 🔧 Common Issues & Fixes

### Issue 1: "Cannot find module 'market-snapshot-cache'"
**Fix:**
```typescript
// Add to src/services/index.ts
export { marketSnapshotCache } from './market-snapshot-cache';
```

### Issue 2: Type errors with snapshot
**Fix:**
```typescript
// Import the type
import type { MarketSnapshotData } from './market-snapshot-cache';

// Use it
const snapshot: MarketSnapshotData = await ...;
```

### Issue 3: Omegas getting wrong data format
**Fix:**
- Check snapshot property names match Omega expectations
- Example: Omega expects `p` but snapshot has `price`
- Map: `p: snapshot.price`

### Issue 4: Cache hit rate too low (<40%)
**Fix:**
- Check TTL isn't too short
- Verify same symbol/timeframe is being queried
- Add logging to see cache keys

---

## 📊 Verification Checklist

After migration, verify:

- [ ] App builds without errors: `npm run build`
- [ ] Tests pass: `npm run test`
- [ ] No "getOmegaIntelligence" references: `grep -r "getOmegaIntelligence" src/`
- [ ] Snapshot cache is being used (check logs)
- [ ] All Omegas log SAME snapshot hash
- [ ] No "price drift" errors between Omegas
- [ ] Cache hit rate >60% after warm-up
- [ ] Response time <150ms (80% of requests)
- [ ] DB query count reduced by 80-90%

---

## 🎉 Success Criteria

Your migration is successful when:

1. ✅ All Omegas see identical snapshot hash per cycle
2. ✅ Cache hit rate >60% (check `marketSnapshotCache.getStats()`)
3. ✅ DB queries reduced from ~7 to ~1 per scan
4. ✅ No "Omega-1 saw X, Omega-2 saw Y" bugs
5. ✅ Response time improved by 40-60%
6. ✅ All tests pass
7. ✅ No console errors

---

## 📚 Documentation Reference

- **Full Migration Guide:** `SNAPSHOT_SSOT_MIGRATION_GUIDE.md`
- **Implementation Summary:** `SNAPSHOT_SSOT_IMPLEMENTATION_SUMMARY.md`
- **Architecture Diagrams:** See migration guide

---

## 🆘 Need Help?

**Debug snapshot cache:**
```typescript
// Log what's happening
console.log('[Debug] Snapshot cache stats:', marketSnapshotCache.getStats());
console.log('[Debug] Coordinator stats:', sharedIntelligenceCoordinator.getSnapshotStats());

// Force cache clear
marketSnapshotCache.clearAll();
```

**Check if snapshot is fresh:**
```typescript
const snapshot = await sharedIntelligenceCoordinator.getMarketSnapshot(...);
const age = Date.now() - snapshot.createdAt;
console.log(`Snapshot age: ${age}ms`);
// Should be <5000ms for M5, <30000ms for M15
```

---

## 💡 Pro Tips

1. **Test with single symbol first** - Easier to debug
2. **Check logs frequently** - Verify cache hits/misses
3. **Monitor cache size** - Should stay small (<10 snapshots)
4. **Start with longer TTL** - Can fine-tune later
5. **Keep old coordinator as backup** - Easy rollback if needed

---

**Ready to migrate? Start with Step 1! 🚀**
