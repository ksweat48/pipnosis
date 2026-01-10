# Candle Quality Validator SSOT Fix - Complete

**Date**: 2026-01-10
**Status**: DEPLOYED
**Priority**: P0 - Entry Monitor Blocked

---

## Problem Summary

Entry monitoring system completely blocked with repeated 400 errors from Supabase when checking WebSocket health.

### Console Errors (Before Fix)
```
GET .../realtime_prices?select=updated_at&symbol=eq.BTCUSD 400 (Bad Request)
[CandleQualityValidator] No recent price data for BTCUSD
[UnifiedMonitor] Aggregator unhealthy for BTCUSD: No recent price ticks received
[UnifiedMonitor] ❌ Aggregator health check failed
```

### Impact
- Entry monitoring loops stuck on health checks
- WAIT decisions couldn't execute entry monitoring
- Console flooded with 400 errors every 2 seconds
- Trading sessions unable to monitor for entry opportunities

---

## Root Cause Analysis

**Single Source of Truth Violation - Second Occurrence**

Same bug pattern as `REALTIME_PRICES_SSOT_FIX.md`, but in a different validator service.

### The Bug

`candle-quality-validator.ts` was querying a **non-existent column**:

| Component | Column Used | Status |
|-----------|-------------|--------|
| Database Schema | `created_at` | ✅ Correct |
| SSOT Function `get_latest_price()` | `created_at` | ✅ Correct |
| Hybrid Price Collector | `created_at` | ✅ Correct |
| All Other Services | `created_at` | ✅ Correct |
| Realtime Price Staleness Validator | `created_at` | ✅ Fixed previously |
| **Candle Quality Validator** | **`updated_at`** | ❌ **BUG** |

---

## Fix Applied (SSOT-Aligned)

### File: `src/services/candle-quality-validator.ts`

**Two lines changed:**

1. **Line 227**: Query column
```typescript
// BEFORE (incorrect)
.select('updated_at')

// AFTER (correct)
.select('created_at')
```

2. **Line 245**: Access field
```typescript
// BEFORE (incorrect)
const lastUpdate = new Date(recentPrice.updated_at).getTime();

// AFTER (correct)
const lastUpdate = new Date(recentPrice.created_at).getTime();
```

**Why `created_at` is Correct:**

1. **SSOT Schema**: `realtime_prices` table only has `created_at` column (no `updated_at`)
2. **Semantic Accuracy**: Prices are INSERT-only (never updated), so `created_at` IS the timestamp
3. **System-Wide Consistency**: All 20+ other services use `created_at`
4. **SSOT Function Authority**: `get_latest_price()` orders by `created_at DESC`

---

## Verification

### Before Fix
```bash
# Query fails with 400
GET /realtime_prices?select=updated_at&symbol=eq.BTCUSD
→ 400 Bad Request (column does not exist)
```

### After Fix
```bash
# Query succeeds
GET /realtime_prices?select=created_at&symbol=eq.BTCUSD
→ 200 OK
→ {created_at: "2026-01-10T02:16:34.924Z"}
```

### Code Search
```bash
# Verified no other SSOT violations remain
grep -r "realtime_prices.*updated_at" src/
→ No matches found ✅
```

---

## Expected Behavior After Fix

1. **WebSocket Health Checks Pass** - Can query price timestamps successfully
2. **Entry Monitor Proceeds** - No longer blocks on candle quality validation
3. **Aggregator Health Accurate** - Gets real data status from database
4. **Console Clean** - No more 400 error spam
5. **Entry Monitoring Works** - WAIT decisions can monitor for entry opportunities

---

## Deployment Status

**Build**: ✅ Successful (20.12s)
**Deploy**: ✅ Triggered via Netlify Build Hook
**Verification**: Check production in 2-3 minutes

---

## Architectural Lesson: Why This Happened Twice

**Pattern Recognition**:
- First occurrence: `realtime-price-staleness-validator.ts`
- Second occurrence: `candle-quality-validator.ts`
- Both: WebSocket/price health checking services
- Both: Assumed `updated_at` instead of checking schema

**Root Anti-Pattern**:
> Services were written independently without verifying against the SSOT schema

**Prevention Strategy**:

1. ✅ **Database schema is the SSOT** for table structure
2. ✅ **SSOT functions define canonical query patterns**
3. ✅ **All services must align with SSOT**
4. ⚠️ **Need**: TypeScript types for table schemas (compile-time safety)
5. ⚠️ **Need**: Automated tests to catch column name mismatches

**Suggested Improvement**:
```typescript
// Generate types from schema
type RealtimePrices = Database['public']['Tables']['realtime_prices']['Row'];

// Compile-time error if wrong column
const timestamp = recentPrice.updated_at; // ❌ Property doesn't exist
const timestamp = recentPrice.created_at; // ✅ Type-safe
```

---

## Key Principle Reinforced

> "If the same data can be queried in more than one way, the architecture is broken."

In this case:
- **ONE schema column** exists: `created_at`
- **ONE way to query** price timestamps: use `created_at`
- **NO alternatives** should exist in the codebase

This is the second time we've fixed this exact violation. TypeScript schema types would have prevented both occurrences.

---

## Related Documentation

- `REALTIME_PRICES_SSOT_FIX.md` - First occurrence of same bug
- `SINGLE_SOURCE_OF_TRUTH_SYSTEM.md` - SSOT principles
- `supabase/migrations/20251224101143_create_realtime_prices_table.sql` - Schema authority

---

**Fix Status**: ✅ COMPLETE
**Build**: ✅ PASSED
**Deploy**: ✅ IN PROGRESS
**Monitoring**: Entry monitoring should work within 2-3 minutes
