# HOTFIX: THESIS_TTL_MS Import Error

**Date**: 2026-01-18
**Priority**: P0 - CRITICAL
**Status**: ✅ DEPLOYED

---

## Issue

**Production Error**:
```
ReferenceError: THESIS_TTL_MS is not defined
at getTTLForAlphaThesis
```

**Impact**:
- Alpha thesis caching system failing
- Every Alpha call triggering expensive LLM generation
- 60-85% cost optimization lost
- No functional break (degraded to no caching)

---

## Root Cause

TypeScript import error:

```typescript
// ❌ WRONG: Importing constant as TYPE
import type {
  AlphaMarketThesis,
  RegimeSignature,
  THESIS_TTL_MS  // Imported as type
} from '../types/alpha-thesis';

// Then trying to use as VALUE
function getTTLForAlphaThesis(): number {
  return THESIS_TTL_MS; // ReferenceError at runtime
}
```

**Why It Compiled**: TypeScript allows type-only imports in development, but Vite strips them during build, causing runtime error.

---

## Fix Applied

**File**: `src/services/shared-intelligence-coordinator.ts`

```typescript
// ✅ CORRECT: Import types and values separately
import type {
  AlphaMarketThesis,
  RegimeSignature
} from '../types/alpha-thesis';
import { THESIS_TTL_MS } from '../types/alpha-thesis';
```

**Single-line change**: Moved `THESIS_TTL_MS` from type-only import to value import.

---

## Verification

✅ Build passed: No TypeScript errors
✅ Runtime constant available: `THESIS_TTL_MS = 900000` (15 minutes)
✅ SSOT preserved: Constant defined once in `alpha-thesis.ts`
✅ No breaking changes: Additive fix only

---

## Deployment

**Method**: Netlify build hook
**Time**: 2026-01-18
**Rollout**: Immediate (static assets)

---

## CCIP Compliance

**System Map**: shared-intelligence-coordinator.ts → alpha-thesis.ts
**Logic Contract**: Import path only, no logic changed
**Compatibility**: 100% backward compatible
**SSOT**: Maintained - constant still defined in one place

---

## Monitoring

**Success Metrics**:
- Zero "THESIS_TTL_MS is not defined" errors
- Thesis cache hit rate restored to 60-85%
- LLM call volume returns to baseline

**Expected Behavior After Deploy**:
- Thesis caching resumes immediately
- Users see cached theses (15min TTL)
- Cost optimization restored

---

## Lessons Learned

**Issue**: TypeScript type-only imports are stripped at build time
**Prevention**: Add lint rule to catch constants imported as types
**Testing**: Runtime validation tests for constants

---

**Status**: ✅ HOTFIX DEPLOYED - Production system operational
