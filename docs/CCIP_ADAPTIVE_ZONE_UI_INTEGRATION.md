# CCIP: Adaptive Zone UI Integration Plan
**Date:** 2026-01-11
**Status:** IN PROGRESS
**Risk Level:** LOW (Display-only changes, no trading logic affected)

---

## 1. SYSTEM MAP

### Affected Components

```
┌─────────────────────────────────────────────────────────────┐
│                    ALPHA COORDINATOR                         │
│  - Calls EntryIntentClassifier.classifyEntryIntent()       │
│  - Receives adaptive zone data (zone_type, micro_regime)   │
│  - Logs to console (currently) ✅                           │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│              ENTRY INTENT CLASSIFIER                         │
│  - Calculates zone_type (limit/hybrid/momentum)            │
│  - Identifies micro_regime_used                             │
│  - Returns EntryIntentClassification ✅                     │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│                  ENTRY PLANNER                               │
│  - Creates entry_intents row in database                    │
│  - ❌ MISSING: Does NOT save zone_type or micro_regime      │
│  - ❌ BUG: Adaptive data is lost here                       │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│                   DATABASE                                   │
│  Table: entry_intents                                        │
│  - ✅ HAS columns: zone_type, micro_regime_used, etc.       │
│  - ❌ Columns are NULL (never populated)                    │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│           ENTRY INTENT MONITOR MODE                          │
│  - Reads entry_intents from database                        │
│  - ❌ TypeScript interface missing adaptive fields          │
│  - Returns EntryIntentData                                   │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│           ENTRY QUALITY MONITOR (UI)                         │
│  - Displays entry intent status                             │
│  - ❌ HARDCODED: "pull back" / "rally" text                 │
│  - ❌ Ignores actual regime and zone type                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. LOGIC CONTRACT

### Current Behavior (BROKEN)
```typescript
// UI always shows generic text regardless of regime
direction === 'long' ? 'pull back' : 'rally'
```

### New Behavior (REGIME-AWARE)
```typescript
// UI shows regime-specific language
zone_type === 'momentum' && direction === 'long'
  ? 'Chase tight momentum entry'

zone_type === 'limit' && direction === 'long'
  ? 'Wait for pullback to entry zone'

zone_type === 'hybrid' && direction === 'long'
  ? 'Wait for retest of structure'
```

### Zone Type to Language Mapping

| Zone Type | Long Entry Message | Short Entry Message |
|-----------|-------------------|---------------------|
| `momentum` | "Chase tight momentum entry" | "Chase tight momentum entry" |
| `limit` | "Wait for pullback to entry zone" | "Wait for rally to entry zone" |
| `hybrid` | "Wait for structured retest" | "Wait for structured retest" |
| `null` (fallback) | "Wait for pullback" | "Wait for rally" |

---

## 3. DATA FLOW CHANGES

### Before (Data Loss)
```
Alpha Coordinator
  → EntryIntentClassifier (calculates zone_type)
    → Entry Planner (❌ DROPS zone_type)
      → Database (zone_type = NULL)
        → UI (hardcoded text)
```

### After (Data Preserved)
```
Alpha Coordinator
  → EntryIntentClassifier (calculates zone_type)
    → Entry Planner (✅ SAVES zone_type + micro_regime)
      → Database (zone_type populated)
        → EntryIntentMonitor (reads zone_type)
          → UI (displays regime-aware text)
```

---

## 4. COMPATIBILITY CHECK

### Breaking Changes: NONE
- All changes are additive (optional fields)
- Existing code continues to work (fallback to generic text)
- Database columns already exist (safe)

### Type Safety
- Add optional fields to TypeScript interfaces
- Use `zone_type?: string` (nullable for backward compat)
- Graceful degradation if fields are null

---

## 5. IMPLEMENTATION STEPS

### Step 1: Update TypeScript Interfaces ✅ SAFE
**File:** `src/services/entry-intent-monitor-mode.ts`
```typescript
export interface EntryIntentData {
  // ... existing fields ...

  // Adaptive zone fields (v2.0)
  zone_type?: string | null;
  micro_regime_used?: string | null;
  primary_zone_min?: number | null;
  primary_zone_max?: number | null;
  secondary_zone_min?: number | null;
  secondary_zone_max?: number | null;
  zone_reachability_distance_pips?: number | null;
  zone_downgrade_applied?: boolean | null;
  position_size_multiplier?: number | null;
}
```

### Step 2: Update Entry Planner Insert ✅ SAFE
**File:** `src/services/entry-planner.ts`
```typescript
.insert({
  // ... existing fields ...

  // Add adaptive zone fields
  zone_type: request.zone_type,
  micro_regime_used: request.micro_regime_used,
  primary_zone_min: request.primary_zone_min,
  primary_zone_max: request.primary_zone_max,
  secondary_zone_min: request.secondary_zone_min,
  secondary_zone_max: request.secondary_zone_max,
  zone_reachability_distance_pips: request.zone_reachability_distance_pips,
  zone_downgrade_applied: request.zone_downgrade_applied,
  position_size_multiplier: request.position_size_multiplier,
})
```

### Step 3: Create Regime-Aware Language Service ✅ SAFE
**File:** `src/utils/regime-zone-language.ts` (NEW)
- Pure function, no side effects
- Maps zone_type to UI text
- Handles null/undefined gracefully

### Step 4: Update UI Component ✅ SAFE
**File:** `src/components/EntryQualityMonitor.tsx`
- Replace hardcoded text with function call
- Fallback to existing behavior if zone_type is null
- No layout changes, only text

---

## 6. ROLLBACK PLAN

If issues arise:
1. Revert UI component (restore hardcoded text)
2. Database columns remain (no harm)
3. Entry planner insert is backward compatible (optional fields)

---

## 7. VERIFICATION

### Pre-Deploy Checks
- [ ] `npm run build` succeeds
- [ ] No TypeScript errors
- [ ] All interfaces aligned

### Post-Deploy Checks
- [ ] UI shows regime-specific text for new entries
- [ ] Old entries (zone_type=null) still display generic text
- [ ] No console errors
- [ ] Logs show adaptive zone data being saved

---

## RISK ASSESSMENT: ✅ LOW

- **No trading logic changes**
- **Display-only modifications**
- **Backward compatible**
- **Database schema already exists**
- **Graceful degradation for null values**

---

## SSOT COMPLIANCE

### Single Source of Truth: `entry_intents` table
- `zone_type` column is the authority
- UI reads from database (not calculated client-side)
- No duplicate regime detection in frontend

### No Duplication
- Zone type calculated ONCE in EntryIntentClassifier
- Persisted to database
- UI simply displays what's in database

---

**APPROVED FOR IMPLEMENTATION**
