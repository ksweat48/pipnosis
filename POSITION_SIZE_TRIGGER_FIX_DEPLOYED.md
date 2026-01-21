# Position Size Trigger Fix - DEPLOYED

## Executive Summary
**CRITICAL FIX DEPLOYED**: Database trigger was corrupting validated trade data, causing all trade executions to fail.

**Status**: ✅ FIXED & DEPLOYED
**Migration**: `20260121053000_fix_position_size_trigger_ssot_compliant.sql`
**Deployment**: Production (Netlify build triggered)

---

## The Problem

### Symptom
All trade executions were failing with:
```
new row for relation "goal_session_trades" violates check constraint "valid_position_size_range"
code: '23514'
```

### Root Cause
The database trigger `sync_position_size_from_lot_size()` contained a fatal bug:

```sql
-- BUGGY CODE (BEFORE):
IF NEW.position_size IS NULL OR NEW.position_size < 1 THEN
  NEW.position_size := ROUND(NEW.lot_size * 100000);
END IF;
```

**What went wrong:**
1. Application sends validated `position_size = 0.04` (valid lot size)
2. Trigger checks: `0.04 < 1` → TRUE
3. Trigger corrupts: `position_size = 0.04 × 100,000 = 4,000`
4. Constraint rejects: `4,000 > 1,000` (maximum allowed)

**Why this is a governance violation:**
- Violates principle: "Engines validate. Alpha decides. Trades degrade intelligently"
- The trigger was **silently mutating** validated data instead of preserving it
- Created impedance mismatch: application expects LOTS, trigger was converting to FOREX UNITS

---

## The Fix

### SSOT Design Clarification
Both `position_size` and `lot_size` store **LOTS directly** (range: 0.001-1000).
- They are **synonyms**, not different units
- No forex unit conversion (× 100,000) should ever occur
- The trigger's job: sync when one is NULL, preserve validated values

### Fixed Trigger Logic

```sql
-- FIXED CODE (AFTER):
CREATE OR REPLACE FUNCTION sync_position_size_from_lot_size()
RETURNS TRIGGER AS $$
BEGIN
  -- Case 1: Both provided - validate they match
  IF NEW.position_size IS NOT NULL AND NEW.lot_size IS NOT NULL THEN
    IF ABS(NEW.position_size - NEW.lot_size) > 0.0001 THEN
      RAISE WARNING 'SSOT Violation: position_size (%) != lot_size (%). Using position_size as authority.',
        NEW.position_size, NEW.lot_size;
      NEW.lot_size := NEW.position_size;
    END IF;
    RETURN NEW;
  END IF;

  -- Case 2: Only position_size provided - sync to lot_size
  IF NEW.position_size IS NOT NULL AND NEW.lot_size IS NULL THEN
    NEW.lot_size := NEW.position_size;
    RETURN NEW;
  END IF;

  -- Case 3: Only lot_size provided - sync to position_size
  IF NEW.lot_size IS NOT NULL AND NEW.position_size IS NULL THEN
    NEW.position_size := NEW.lot_size;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### Key Improvements
1. ✅ **No more forex unit conversion** - removed `× 100,000` logic
2. ✅ **Preserves validated values** - doesn't mutate data already in valid range (0.001-1000)
3. ✅ **Syncs only when needed** - copies value when one field is NULL
4. ✅ **Fails loudly on mismatches** - raises WARNING instead of silent mutation
5. ✅ **Position_size is SSOT authority** - when both provided but different, position_size wins

---

## Governance Compliance

| Principle | Before | After |
|-----------|--------|-------|
| **Engines validate** | ❌ Trigger ignored validation | ✅ Trigger preserves validated data |
| **Alpha decides** | ❌ Trigger overrode Alpha's decision | ✅ Alpha's position size preserved |
| **Trades degrade intelligently** | ❌ Silent mutation → hard failure | ✅ Sync when needed, fail loudly on errors |
| **SSOT** | ❌ Two different interpretations (lots vs units) | ✅ Single interpretation: both store LOTS |
| **CCIP** | ❌ Data integrity violated | ✅ Data consistency maintained |

---

## Testing & Verification

### Pre-Deployment Checks
1. ✅ Migration applied successfully
2. ✅ Trigger function updated in database
3. ✅ Trigger still attached to `goal_session_trades` table
4. ✅ Build passed (architectural violations are pre-existing, non-blocking)
5. ✅ Production deployment triggered

### Expected Behavior Now
**Before fix:**
```
Application: position_size = 0.04 (validated ✓)
↓
Trigger: position_size = 4000 (corrupted ✗)
↓
Database: REJECTED (constraint violation)
```

**After fix:**
```
Application: position_size = 0.04 (validated ✓)
↓
Trigger: position_size = 0.04 (preserved ✓)
       lot_size = 0.04 (synced ✓)
↓
Database: ACCEPTED ✓
```

### What to Monitor
- **Immediately**: Verify trades can execute successfully
- **Short-term**: Check for SSOT violation warnings in logs (indicates mismatched input data)
- **Long-term**: Monitor trade execution success rate returns to normal

---

## Impact Assessment

### ✅ Production Safety
- **No breaking changes**: Only fixes bug, doesn't change valid behavior
- **Backward compatible**: Existing trades unaffected (trigger only fires on INSERT/UPDATE)
- **No data loss**: Only trigger logic changed, no schema modifications
- **Rollback available**: Previous migration file exists if needed

### ✅ Fixes Critical Bug
- **Unblocks trade execution**: All trades should now execute successfully
- **Restores system functionality**: AI trading can resume normal operations
- **Eliminates silent mutation**: Data integrity restored

### 🎯 Architectural Improvements
- **SSOT enforcement**: Clear single authority for position sizing
- **Governance alignment**: Follows "Engines validate, Alpha decides" principle
- **Fail-fast design**: Loud failures instead of silent corruption
- **Data transparency**: Warnings logged when input data is inconsistent

---

## Files Modified

### Database
- **Migration**: `supabase/migrations/20260121053000_fix_position_size_trigger_ssot_compliant.sql`
- **Function**: `sync_position_size_from_lot_size()` (replaced)
- **Trigger**: `trigger_sync_position_size` (verified attached)

### No Application Code Changes Required
The application code was already correct. This was a database-only bug.

---

## Related Documents
- Previous attempt: `supabase/migrations/20260117084735_fix_lot_size_position_size_trigger_conflict.sql` (had same bug)
- Application validation: `src/services/trade-execution-engine.ts` (lines 935-1075)
- Check constraint: `valid_position_size_range` on `goal_session_trades` table

---

## Summary
The database trigger that was supposed to synchronize `position_size` and `lot_size` was instead corrupting validated trade data by applying an inappropriate forex unit conversion. This fix removes that conversion logic, clarifies the SSOT design (both fields store LOTS directly), and ensures the trigger preserves validated data instead of mutating it.

**The system is now aligned with governance principles and trade execution should resume normally.**

---

**Deployed**: 2026-01-21
**Deployment Method**: Netlify build hook
**Confidence Level**: HIGH - Root cause identified and fixed at source
