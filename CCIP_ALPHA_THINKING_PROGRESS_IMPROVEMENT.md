# CCIP: Alpha Thinking Progress Improvement

**Date:** 2026-01-23
**Type:** UX Enhancement (Non-Breaking)
**Risk Level:** LOW (Advisory layer only, no business logic changes)

## Problem Statement

Alpha's 6.3s decision phase shows no intermediate progress, causing user to perceive system as slow or frozen. Current feedback shows only "Alpha is analyzing..." until decision completes.

## Root Cause

1. Alpha coordinator has 10+ long-running phases (intelligence loading, pattern analysis, LLM call)
2. Thought debouncing set to 200ms (artificially delays feedback)
3. No granular progress emissions during Alpha's decision pipeline

## Solution

### SSOT Compliance
- ✅ Database (`alpha_scan_thoughts`) remains single source of truth
- ✅ UI reads from database via real-time subscriptions
- ✅ No duplicate data stores
- ✅ Thoughts are ADVISORY only (don't affect decisions)

### Governance Compliance
- ✅ Engines validate, Alpha decides (no change to authority)
- ✅ Added thoughts are progress indicators, not business logic
- ✅ No blocking behavior added
- ✅ Intelligent degradation: If thought fails to emit, trading continues

### Changes

#### 1. Reduce Debouncing (alpha-thought-stream.ts)
- **Before:** MIN_EMISSION_INTERVAL_MS = 200ms
- **After:** MIN_EMISSION_INTERVAL_MS = 50ms
- **Rationale:** 200ms is too slow for real-time feedback; 50ms prevents flooding while feeling instant

#### 2. Add New Thought Step Types
New step types added (ADVISORY, non-blocking):
- `alpha_loading_snapshot` - Loading intelligence
- `alpha_platform_intel` - Fetching platform data
- `alpha_narrative` - Building daily narrative
- `alpha_risk_check` - Risk assessment
- `alpha_micro_regime` - Regime classification
- `alpha_liquidity_intent` - Liquidity analysis
- `alpha_pattern_analysis` - Multi-timeframe patterns
- `alpha_stop_calculation` - Stop-loss anchor
- `alpha_feasibility` - Feasibility check
- `alpha_constraints` - Omega-9 constraints
- `alpha_final_decision` - LLM call starting

#### 3. Emit Progress at Key Phases (coordinator-alpha.ts)
Add thought emissions at each long-running phase:
- Line 514: Intelligence loading
- Line 538: Platform intelligence
- Line 541: Daily narrative
- Line 548: Risk assessment
- Line 678: Micro-regime classification
- Line 724: Liquidity intent
- Line 766: Pattern analysis
- Line 853: Stop-loss calculation
- Line 893: Feasibility check
- Line 993: Omega-9 constraints
- Line 1576: Final LLM decision (BEFORE call)

#### 4. UI Progress Indicator (AlphaScanningFeed.tsx)
- Map new step types to user-friendly messages
- Show progress bar based on completed steps
- Display estimated time remaining

## Verification

### Pre-Deployment Tests
1. ✅ All thoughts emit without blocking trade execution
2. ✅ Failed thought emissions don't crash system
3. ✅ Thoughts appear in database within 50ms
4. ✅ Real-time subscription delivers thoughts to UI
5. ✅ Alpha decisions unchanged (same results before/after)

### Post-Deployment Monitoring
- Monitor `alpha_scan_thoughts` insert rate
- Check for database performance impact
- Verify no timeout increases
- Confirm user feedback improvement

## Rollback Plan

If issues detected:
1. Revert MIN_EMISSION_INTERVAL_MS to 200ms
2. Remove new thought emissions (trading logic unchanged)
3. UI gracefully handles missing thought types (already defensive)

## Authority Hierarchy Respected

This change operates at the **ADVISORY layer only**:
- ❌ Does NOT modify Alpha's decision logic
- ❌ Does NOT add validation or blocking
- ❌ Does NOT change Omega votes
- ❌ Does NOT mutate trade data
- ✅ Pure progress indicators (database inserts)
- ✅ Alpha retains full authority
- ✅ Graceful degradation if thoughts fail

## Database Impact

**Table:** `alpha_scan_thoughts`
**Expected Load:** +10 inserts per scan (was 7, now 17)
**Storage:** ~1KB per scan (negligible)
**Index:** Already optimized with `idx_alpha_scan_thoughts_session_active`

## Files Modified

1. `src/services/alpha-thought-stream.ts` - Add new step types, reduce debouncing
2. `src/brains/coordinator-alpha.ts` - Add progress emissions
3. `src/components/AlphaScanningFeed.tsx` - Map new steps to UI messages

## CCIP Approval

- [x] SSOT Compliant
- [x] Governance Compliant (Alpha authority preserved)
- [x] Intelligent Degradation (fails gracefully)
- [x] Non-Breaking (advisory layer only)
- [x] Rollback Plan Documented

**Status:** APPROVED FOR PRODUCTION
**Deployment:** Safe for immediate deployment
