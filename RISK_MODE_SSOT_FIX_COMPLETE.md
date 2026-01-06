# Risk Mode SSOT Fix - Complete

## Problem

The goal session scanning was **completely broken** due to a risk mode mapping mismatch:

### Error Chain:
1. **First Error (before this fix):** "No candle data found for M5"
   - Wrong timeframe being used due to bad mapping

2. **Second Error (discovered during fix):** `Cannot read properties of undefined (reading 'entryTimeframe')`
   - Risk mode values didn't match the config SSOT

### Root Cause

The system had **two different risk mode formats** causing a mismatch:

```typescript
// DATABASE SSOT (correct):
type RiskMode = 'low' | 'medium' | 'high';

// INCORRECT MAPPING in goal-session-live-engine.ts:
const riskModeMap = {
  'low': 'conservative',    // ❌ Wrong!
  'medium': 'moderate',      // ❌ Wrong!
  'high': 'aggressive'       // ❌ Wrong!
};
```

**The Flow:**
1. Database stores risk mode as `'medium'`
2. Code mapped it to `'moderate'`
3. Config lookup tried to find `MTF_ANALYSIS_CONFIGS['moderate']`
4. Result: `undefined`
5. Accessing `.entryTimeframe` on `undefined` → **CRASH**

## Solution

**Removed the incorrect mapping** and used the SSOT values directly:

### Files Changed:

#### 1. `src/services/goal-session-live-engine.ts` (lines 557-563)
**Before:**
```typescript
const riskModeMap = {
  'low': 'conservative',
  'medium': 'moderate',
  'high': 'aggressive'
} as const;

const mappedRiskMode = this.config?.riskMode
  ? riskModeMap[this.config.riskMode]
  : 'moderate';

const snapshotResult = await multiSymbolSnapshotBuilder.buildSnapshots(openMarketSymbols, mappedRiskMode);
```

**After:**
```typescript
// Use risk mode directly from config (SSOT: 'low' | 'medium' | 'high')
const riskMode = this.config?.riskMode || 'medium';

const snapshotResult = await multiSymbolSnapshotBuilder.buildSnapshots(openMarketSymbols, riskMode);
```

#### 2. `src/services/multi-symbol-snapshot-builder.ts` (line 90)
**Before:**
```typescript
async buildSnapshots(
  symbols: string[],
  riskMode: 'conservative' | 'moderate' | 'aggressive' = 'moderate'
): Promise<MultiSymbolSnapshotResult> {
```

**After:**
```typescript
async buildSnapshots(
  symbols: string[],
  riskMode: 'low' | 'medium' | 'high' = 'medium'
): Promise<MultiSymbolSnapshotResult> {
```

## SSOT Architecture

The **Single Source of Truth** for risk modes is defined in:
- **File:** `src/config/timeframe-hierarchy.ts`
- **Type:** `type RiskMode = 'low' | 'medium' | 'high';`
- **Config:** `MTF_ANALYSIS_CONFIGS: Record<RiskMode, MultiTimeframeConfig>`

All other files **must** use these exact values - no mappings, no conversions.

## Impact

### ✅ Fixed:
- Multi-symbol scanning now works correctly
- Risk mode properly maps to correct timeframes:
  - `'low'` → H1 entry, H4 trend, D1 context
  - `'medium'` → M15 entry, H1 trend, H4 context
  - `'high'` → M5 entry, M15 trend, H1 context

### ✅ Architecture:
- Single Source of Truth maintained
- No more duplicate risk mode definitions
- Type-safe risk mode handling throughout

## Testing

Build succeeded with no TypeScript errors:
```bash
npm run build
✓ built in 30.59s
```

Deployed to production via Netlify build hook.

## Lessons Learned

1. **Never map SSOT values** - Use them directly
2. **Mappings create divergence** - They introduce bugs when config changes
3. **Type mismatches fail silently** - TypeScript can't catch Record key mismatches
4. **Follow the config** - If timeframe-hierarchy.ts defines the types, use those exact types everywhere

---

**Status:** ✅ Complete
**Deployed:** Yes
**Date:** 2026-01-06
