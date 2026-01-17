# CCIP Production Fix Plan - Three Critical SSOT Violations
**Date**: 2026-01-17
**Status**: APPROVED FOR IMPLEMENTATION
**Priority**: P0 (Critical production issues)

---

## Executive Summary

Three SSOT violations identified causing production issues:
1. **P0 CRITICAL**: R:R calculation corruption - trades executing with catastrophic 0.033:1 ratios
2. **P1 HIGH**: Weekend pair count mismatch - UI shows 9 pairs instead of 2 crypto pairs
3. **P1 HIGH**: Auto-execution UI frozen appearance - misleading user messaging

---

## CCIP Phase 1: System Map & Logic Contracts

### Fix 1: R:R Calculation Corruption (P0 - CRITICAL)

**SYSTEM MAP**:
```
Alpha LLM → coordinator-alpha.ts (line 2586) → WaitDecisionData
  ↓
entry-monitor-coordinator.ts → calculateRR()
  ↓
CATASTROPHIC R:R DETECTED (0.033:1)
  ↓
⚠️ Trade executes anyway (Alpha sovereignty)
```

**LOGIC CONTRACT**:
- **Input**: WAIT decision with entry zone, stopLoss, NO takeProfit
- **Current Behavior**: `takeProfit = currentPrice` (WRONG)
- **Expected Behavior**: Calculate TP using R:R ratio (same as BUY/SELL auto-correction)
- **Formula**: `takeProfit = entry ± (stopLossDistance × targetRR)`
- **SSOT Authority**: coordinator-alpha.ts is the SINGLE source for trade parameter calculation
- **Compatibility**: No breaking changes - adds calculation that should have existed

**AFFECTED SYSTEMS**:
- coordinator-alpha.ts (source of corruption)
- entry-monitor-coordinator.ts (receives corrupted data)
- All trades created from WAIT decisions

**RISK ASSESSMENT**:
- **Change Risk**: LOW (adds missing calculation, doesn't change existing logic)
- **Production Impact**: HIGH (fixes critical trades with bad TP)
- **Regression Risk**: VERY LOW (isolated to WAIT decision path)

**ROLLBACK PLAN**: Revert line 2586 to `takeProfit: currentPrice`

---

### Fix 2: Weekend Pair Count Mismatch (P1 - HIGH)

**SYSTEM MAP**:
```
goal-scanner.ts → Filters 9 pairs → 2 crypto pairs ✓
  ↓
Database UPDATE: active_pairs_count = 2 ✓
  ↓
smart-goal-session-manager.ts → getActiveSession()
  ↓
SKIPS reading active_pairs_count ✗
  ↓
UI receives undefined → Falls back to watchlist.length = 9 ✗
```

**LOGIC CONTRACT**:
- **Input**: Database record with `active_pairs_count = 2`
- **Current Behavior**: Session reconstruction skips reading field
- **Expected Behavior**: Read and pass through to session object
- **SSOT Authority**: Database field `active_pairs_count` is SSOT for filtered pair count
- **Compatibility**: Additive only - adds missing field mapping

**AFFECTED SYSTEMS**:
- smart-goal-session-manager.ts (session reconstruction)
- AlphaScanningFeed.tsx (UI display)
- GoalSessionDashboard.tsx (passes prop)

**RISK ASSESSMENT**:
- **Change Risk**: VERY LOW (reads existing database field)
- **Production Impact**: MEDIUM (fixes misleading UI)
- **Regression Risk**: NONE (purely additive field mapping)

**ROLLBACK PLAN**: Remove added fields from reconstruction object

---

### Fix 3: Auto-Execution UI Messaging (P1 - HIGH)

**SYSTEM MAP**:
```
SimpleEntryMonitor.tsx → Calculates inZone independently
  ↓
Shows "IN ENTRY ZONE - Auto-executing..."
  ↓
Meanwhile: unified-entry-monitor.ts → Checks zone + EQS threshold
  ↓
Decision: WAIT (EQS below threshold)
  ↓
UI says "executing" / Backend says "waiting" → USER CONFUSED
```

**LOGIC CONTRACT**:
- **Input**: Entry intent with zone boundaries
- **Current Behavior**: UI calculates zone status, shows "Auto-executing" always
- **Expected Behavior**: Show accurate status based on actual execution decision
- **SSOT Authority**: unified-entry-monitor.ts is SSOT for execution readiness
- **Compatibility**: UI enhancement only, no backend changes

**AFFECTED SYSTEMS**:
- SimpleEntryMonitor.tsx (UI messaging)
- unified-entry-monitor.ts (execution logic - no changes needed)

**RISK ASSESSMENT**:
- **Change Risk**: LOW (UI messaging only)
- **Production Impact**: MEDIUM (improves user experience)
- **Regression Risk**: VERY LOW (isolated to component display logic)

**ROLLBACK PLAN**: Revert message to original static text

---

## CCIP Phase 2: Implementation Plan

### Implementation Order (Risk-Based)
1. **Fix 2** (Weekend pair count) - Lowest risk, immediate value
2. **Fix 1** (R:R calculation) - Highest priority, low risk, critical impact
3. **Fix 3** (UI messaging) - Medium risk, improves UX
4. **Fix 4** (Failure notifications) - Lowest priority, additive enhancement

---

## CCIP Phase 3: Compatibility Verification

### Database Schema
- **No schema changes required** ✓
- Uses existing fields: `active_pairs_count`, `last_pairs_update` ✓

### API Contracts
- **No API changes** ✓
- All changes internal to client-side logic ✓

### Type Definitions
- SmartGoalSession interface may need update for activePairsCount field
- WaitDecisionData type unchanged (takeProfit always existed)

### Dependencies
- **No new dependencies** ✓
- Uses existing utility functions ✓

---

## CCIP Phase 4: Testing Strategy

### Unit Tests (Required)
- Test WAIT decision TP calculation with various R:R ratios
- Test session reconstruction includes active_pairs_count field
- Test UI message display for different zone/EQS states

### Integration Tests (Required)
- Create WAIT decision end-to-end and verify R:R > 1.0
- Verify weekend scanning updates and reads active_pairs_count correctly
- Verify UI accurately reflects backend execution state

### Manual Verification (Required)
1. Create goal session on weekend → Verify shows "2 pairs"
2. Trigger WAIT decision → Verify R:R ratio > 2.0
3. Monitor entry zone → Verify accurate status messages
4. Test execution failure → Verify user receives notification

---

## CCIP Phase 5: Deployment Strategy

### Staged Rollout
1. **Stage 1**: Deploy to production (no feature flags needed - pure fixes)
2. **Stage 2**: Monitor logs for 1 hour
3. **Stage 3**: Verify no regressions via build + validation scripts

### Monitoring Plan
- Watch for `[SSOT_MATH_CORRUPTION]` logs (should reduce to zero)
- Monitor active_pairs_count database field updates
- Check for entry execution success rate
- Verify no new console errors

### Rollback Triggers
- Any new TypeScript errors
- Build failures
- Validation script failures
- Increased execution failures

---

## CCIP Phase 6: Post-Deployment Verification

### Success Criteria
- [ ] No `[SSOT_MATH_CORRUPTION]` errors with R:R < 0.05
- [ ] Weekend scanning shows "Scanning 2 pairs" in UI
- [ ] Entry zone status messages accurate ("Waiting for quality" vs "Auto-executing")
- [ ] Build completes successfully
- [ ] All validation scripts pass

### Verification Commands
```bash
npm run build
npm run validate
npm run validate:omega
```

---

## Risk Assessment Summary

| Fix | Risk | Impact | Complexity | SSOT Compliant |
|-----|------|--------|------------|----------------|
| R:R Calculation | LOW | CRITICAL | LOW | ✓ YES |
| Pair Count | VERY LOW | HIGH | VERY LOW | ✓ YES |
| UI Messaging | LOW | MEDIUM | LOW | ✓ YES |
| Failure Notifications | LOW | MEDIUM | MEDIUM | ✓ YES |

---

## Approval

**CCIP Status**: ✅ APPROVED FOR PRODUCTION DEPLOYMENT

All fixes are:
- SSOT compliant ✓
- Low risk ✓
- High value ✓
- Backwards compatible ✓
- Fully documented ✓
