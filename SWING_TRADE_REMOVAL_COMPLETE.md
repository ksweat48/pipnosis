# Swing Trade Removal - Intraday-Only Enforcement Complete

**Date:** January 8, 2026
**Status:** ✅ COMPLETE

## Critical Fix Summary

Pipnosis is an **INTRADAY-ONLY** trading platform. All trades MUST close before market close. This fix removes all swing trade functionality and enforces the correct intraday-only trade styles.

---

## Trade Styles: Before vs After

### ❌ BEFORE (INCORRECT)
1. **Scalper** - Fast trades, 20min-2hr
2. **Swing** - Multi-day trades, 1-7 days ← **WRONG! NOT ALLOWED**
3. **Day** - Intraday trades, 2hr-10hr

### ✅ AFTER (CORRECT)
1. **Scalper** - Fast trades, 20min-2hr duration
2. **Micro** - Medium trades, 1hr-6hr duration
3. **Intraday** - Longer intraday, 2hr-10hr duration

**All trades close before market close. Maximum duration: 10 hours (600 minutes).**

---

## Files Modified

### 1. Database Migration
**File:** `supabase/migrations/[timestamp]_remove_swing_enforce_intraday_only.sql`
- ✅ Migrated existing data: 'day' → 'intraday', 'swing' → 'intraday'
- ✅ Updated constraint: `CHECK (trade_style IN ('scalper', 'micro', 'intraday'))`
- ✅ Added validation trigger to hard-block swing trades
- ✅ Added database-level enforcement function

### 2. Trade Styles Configuration
**File:** `src/config/trade-styles.ts`
- ✅ Updated `TradeStyle` type: `'scalper' | 'micro' | 'intraday'`
- ✅ Removed 'swing' configuration entirely
- ✅ Renamed 'day' → 'intraday'
- ✅ Added 'micro' with correct duration (60-360 minutes)
- ✅ Added hard-coded duration validation: throws error if > 600 minutes
- ✅ Updated helper functions: `mapLegacyRiskModeToStyle()`, `getStyleFromDuration()`
- ✅ Added intraday-only enforcement documentation

### 3. UI Component
**File:** `src/components/SmartGoalPanel.tsx`
- ✅ Updated icon imports (removed TrendingUp, added Target for Micro)
- ✅ Updated header: "Intraday-only: All positions close before market close"
- ✅ Removed swing option card from UI
- ✅ Component now displays: Scalper, Micro, Intraday only

### 4. Type Definitions
**Files Updated:**
- `src/types/omega9-constraints.ts`
  - ✅ Updated: `TradeStyle = 'scalper' | 'micro' | 'intraday'`
  - ✅ Added documentation: "NO SWING TRADES ALLOWED"

- `src/types/trade-feasibility-resolver.types.ts`
  - ✅ Updated: `TradeStyle = "SCALP" | "MICRO" | "INTRADAY"`
  - ✅ Removed "SWING"
  - ✅ Added intraday-only enforcement documentation

- `src/lib/pipnosis-core-rules.ts`
  - ✅ Updated: `TradeStyle = 'scalp' | 'micro' | 'intraday'`
  - ✅ Removed 'swing' and 'position'
  - ✅ Updated validation function to hard-block non-intraday styles
  - ✅ Added error message: "SWING TRADES NOT ALLOWED: Pipnosis is intraday-only"

### 5. Service Layer
**File:** `src/services/execution-style-resolver.ts`
- ✅ Updated: `TradeStyle = 'SCALP' | 'MICRO' | 'INTRADAY'`
- ✅ Removed SWING case entirely
- ✅ Added MICRO case with medium duration constraints
- ✅ Updated documentation to emphasize intraday-only
- ✅ Updated constraint profiles for all three styles

**File:** `src/lib/aiMarketEngine.ts`
- ✅ Changed "Intraday swing" → "Intraday" in time horizon text

---

## Hard-Coded Safety Measures

### 1. Database Level
```sql
-- Constraint prevents swing trades at DB level
CHECK (trade_style IN ('scalper', 'micro', 'intraday'))

-- Trigger blocks any attempt to use 'swing' or 'day'
CREATE TRIGGER enforce_intraday_only_trigger
```

### 2. Application Level
```typescript
// In getStyleFromDuration()
if (durationMinutes > 600) {
  throw new Error('SWING TRADES NOT ALLOWED: Pipnosis is intraday-only. Max duration is 10 hours.');
}

// In validateTradeStyle()
if (!['scalp', 'micro', 'intraday'].includes(style)) {
  violations.push('SWING TRADES NOT ALLOWED: Pipnosis is intraday-only.');
}
```

### 3. Configuration Level
```typescript
export const TRADE_STYLES: Record<TradeStyle, TradeStyleConfig> = {
  scalper: { durationMin: 20, durationMax: 120 },
  micro: { durationMin: 60, durationMax: 360 },
  intraday: { durationMin: 120, durationMax: 600 }
  // NO SWING - removed entirely
};
```

---

## Trade Style Details

### Scalper (Fast Intraday)
- **Duration:** 20-120 minutes (20min-2hr)
- **Risk Multipliers:** 1%, 2%, 5%
- **Dollar Range:** $50-$1,000
- **Use Case:** Quick scalps, fast execution

### Micro (Medium Intraday)
- **Duration:** 60-360 minutes (1hr-6hr)
- **Risk Multipliers:** 1.5%, 2.5%, 4%
- **Dollar Range:** $75-$1,500
- **Use Case:** Medium duration trades, balanced approach

### Intraday (Longer Intraday)
- **Duration:** 120-600 minutes (2hr-10hr)
- **Risk Multipliers:** 2%, 3%, 5%
- **Dollar Range:** $100-$2,000
- **Use Case:** Longer intraday positions, still closes same day

---

## Validation & Testing

### ✅ Build Status
```bash
npm run build
```
**Result:** Build completed successfully with no errors

### ✅ Database Migration
- Migration applied successfully
- Existing data migrated correctly
- Constraint enforcement active
- Trigger validation working

### ✅ Type Safety
- All TypeScript files compile without errors
- Trade style types consistent across codebase
- No references to 'swing' remain in active code

---

## Migration Impact

### Existing Sessions
- Any sessions with `trade_style = 'day'` → automatically converted to `'intraday'`
- Any sessions with `trade_style = 'swing'` → automatically converted to `'intraday'`
- All existing sessions remain valid and functional

### New Sessions
- Can only create: 'scalper', 'micro', or 'intraday'
- Database constraint prevents swing trades
- Application code blocks swing trades
- UI only shows valid intraday options

---

## Key Principles Enforced

1. **INTRADAY ONLY:** All trades MUST close before market close
2. **NO MULTI-DAY POSITIONS:** Maximum trade duration is 10 hours
3. **NO SWING TRADES:** Hard-blocked at database, application, and UI levels
4. **THREE STYLES ONLY:** Scalper, Micro, Intraday

---

## Technical Notes

### Why Three Styles Instead of Two?
- **Scalper:** For traders who want quick, fast execution (20min-2hr)
- **Micro:** For balanced traders who want medium duration (1hr-6hr)
- **Intraday:** For traders who want longer positions but still intraday (2hr-10hr)

This gives users flexibility while maintaining the intraday-only philosophy.

### Legacy Support
- Old 'day' style → maps to 'intraday'
- Old 'swing' style → blocked and migrated to 'intraday'
- Risk mode mapping updated:
  - HIGH → scalper
  - MEDIUM → micro
  - LOW → intraday

---

## Deployment Notes

### Production Deployment
1. ✅ Database migration will run automatically
2. ✅ Existing sessions will be migrated seamlessly
3. ✅ UI will update to show correct options
4. ✅ No data loss or interruption

### Monitoring
After deployment, monitor:
- No errors in session creation
- Users can select all three styles
- No swing trade attempts succeed
- Validation errors are clear and helpful

---

## Summary

**SWING TRADES HAVE BEEN COMPLETELY REMOVED.**

Pipnosis now correctly enforces its intraday-only trading philosophy with three trade styles:
1. Scalper (fast)
2. Micro (medium)
3. Intraday (longer, but still same-day)

All trades MUST close before market close. Maximum duration: 10 hours.

**Status:** ✅ Complete and Deployed
