# Live Demo vs Backtest Trade Separation - COMPLETE

**Date:** November 26, 2025
**Status:** ✅ Successfully Implemented

---

## Problem Statement

**Issue:** The "Historical Live Demo Trades" section was incorrectly counting **ALL trades** from `trade_history`, including synthetic backtest trades.

**User Impact:**
- Running a synthetic backtest would increase "Total Live Trades" count
- Live demo statistics were contaminated with backtest data
- No way to distinguish between real-time paper trading vs historical simulation

**Example:**
```
Historical Live Demo Trades
Total Live Trades: 55  ← WRONG (includes backtest trades)
```

---

## Root Cause Analysis

### 1. Database Function Issue
**File:** `supabase/migrations/20251109130000_enhance_trade_history_for_ai_learning.sql`

**Function:** `get_live_learning_stats()`
```sql
-- BEFORE (BUGGY):
SELECT COUNT(*) FROM trade_history
WHERE user_id = p_user_id;  -- No filtering by source!
```

This counted ALL trades regardless of source (live demo vs backtest).

### 2. Missing Discriminator Field
The `trade_history` table had no field to distinguish:
- **Live demo trades** - Real-time paper trading with simulated positions
- **Synthetic backtest trades** - Historical simulations for AI learning

---

## Solution Implemented

### 1. Database Schema Enhancement

**Added `trade_source` column:**
```sql
ALTER TABLE trade_history
ADD COLUMN trade_source text
CHECK (trade_source IN ('live_demo', 'synthetic_backtest', 'real_backtest'))
DEFAULT 'live_demo';
```

**Added performance index:**
```sql
CREATE INDEX idx_trade_history_source
ON trade_history(user_id, trade_source, closed_at DESC);
```

---

### 2. Updated Database Function

**Fixed `get_live_learning_stats()` function:**
```sql
-- AFTER (FIXED):
SELECT COUNT(*) FROM trade_history
WHERE user_id = p_user_id
  AND trade_source = 'live_demo';  -- Only count live demo trades!
```

**Result:** Function now returns statistics for **live demo trades only**.

---

### 3. Updated Services

#### A. Synthetic Backtest Trade Copier
**File:** `src/services/synthetic-trade-copier.ts`

**Added field to trade inserts:**
```typescript
await supabase.from('trade_history').insert({
  // ... existing fields ...
  trade_source: 'synthetic_backtest'  // Mark as synthetic backtest
});
```

#### B. Live Demo Trading Service
**File:** `src/services/simulated-trading.ts`

**Added field to trade inserts:**
```typescript
await supabase.from('trade_history').insert({
  // ... existing fields ...
  trade_source: 'live_demo'  // Mark as live demo trade
});
```

---

### 4. Data Backfill

**Migrated existing data:**
```sql
-- Mark trades with position_id as live demo
UPDATE trade_history
SET trade_source = 'live_demo'
WHERE position_id IS NOT NULL;

-- Mark trades without position_id as synthetic backtest
UPDATE trade_history
SET trade_source = 'synthetic_backtest'
WHERE position_id IS NULL;
```

---

## Changes Summary

| Component | File | Change |
|-----------|------|--------|
| **Database Schema** | Migration | Added `trade_source` column with CHECK constraint |
| **Database Function** | Migration | Added `WHERE trade_source = 'live_demo'` filter |
| **Synthetic Trades** | `synthetic-trade-copier.ts` | Set `trade_source: 'synthetic_backtest'` |
| **Live Demo Trades** | `simulated-trading.ts` | Set `trade_source: 'live_demo'` |
| **Existing Data** | Migration | Backfilled based on `position_id` presence |

---

## Verification

### Build Status
✅ **Build:** SUCCESS
✅ **TypeScript:** All checks passed
✅ **Migration:** Applied successfully

### Expected Behavior

**Before Fix:**
```
Running Synthetic Backtest
  ↓
Trades added to trade_history
  ↓
"Historical Live Demo Trades" count increases ❌ WRONG
```

**After Fix:**
```
Running Synthetic Backtest
  ↓
Trades added with trade_source = 'synthetic_backtest'
  ↓
"Historical Live Demo Trades" count stays the same ✅ CORRECT
```

**Live Demo Trading:**
```
Opening Live Demo Position
  ↓
Position closes
  ↓
Trade added with trade_source = 'live_demo'
  ↓
"Historical Live Demo Trades" count increases ✅ CORRECT
```

---

## Dashboard Sections Now Track:

### Historical Live Demo Trades
**Data Source:** `trade_history WHERE trade_source = 'live_demo'`

**Shows:**
- Total Live Trades (real-time paper trading only)
- Analyzed (AI-analyzed live trades)
- Pending Analysis (live trades waiting for AI)
- Insights Created (from live trading)
- Learning Weight (2.0x for live trades)
- Avg Quality Score

**Does NOT include:** Synthetic backtest trades

---

### Backtest Learning
**Data Source:** `ai_learning_insights WHERE learned_from_live_trading = false`

**Shows:**
- Total Insights (from backtests)
- Avg Confidence
- Real Data Weight (1.0x)
- Synthetic Weight (0.5x)
- Learning Weights explanation

**Does NOT include:** Live demo trade insights

---

## Testing Checklist

- [x] Database migration applied successfully
- [x] `trade_source` column added with constraints
- [x] Index created for performance
- [x] `get_live_learning_stats()` updated with filter
- [x] Synthetic trade copier sets `trade_source = 'synthetic_backtest'`
- [x] Live demo trading sets `trade_source = 'live_demo'`
- [x] Existing data backfilled correctly
- [x] Build passes with no errors
- [x] TypeScript compilation successful

---

## User Testing Steps

1. **Check Current State:**
   - Note the "Total Live Trades" count

2. **Run Synthetic Backtest:**
   - Start a synthetic backtest session
   - Complete the backtest
   - **Verify:** "Total Live Trades" does NOT increase
   - **Verify:** "Backtest Learning" stats update

3. **Execute Live Demo Trade:**
   - Open a live demo position
   - Close the position
   - **Verify:** "Total Live Trades" DOES increase by 1
   - **Verify:** New trade appears in live trade stats

---

## Database Query Examples

**Check live demo trades only:**
```sql
SELECT COUNT(*) FROM trade_history
WHERE user_id = '<your-user-id>'
  AND trade_source = 'live_demo';
```

**Check synthetic backtest trades only:**
```sql
SELECT COUNT(*) FROM trade_history
WHERE user_id = '<your-user-id>'
  AND trade_source = 'synthetic_backtest';
```

**See all trades with sources:**
```sql
SELECT symbol, opened_at, trade_source, profit_loss
FROM trade_history
WHERE user_id = '<your-user-id>'
ORDER BY opened_at DESC
LIMIT 20;
```

---

## Benefits

1. **Accurate Statistics:** Live demo section shows only real-time paper trading
2. **Clear Separation:** Backtest trades don't pollute live trading metrics
3. **Better Learning:** AI can distinguish between live and backtest performance
4. **Audit Trail:** Every trade has clear source tracking
5. **Performance:** Indexed queries for fast filtering

---

## Future Enhancements

The `trade_source` field supports three values:
- `'live_demo'` - Currently in use for real-time paper trading
- `'synthetic_backtest'` - Currently in use for historical simulations
- `'real_backtest'` - **Reserved** for future real-money backtesting

---

**Implementation complete! Live demo and backtest trades are now properly separated.** 🎉

The "Historical Live Demo Trades" section will now **only** track live demo trades, and running synthetic backtests will not affect those statistics.
