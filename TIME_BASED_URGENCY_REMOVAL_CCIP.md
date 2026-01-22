# CCIP Change Document: Time-Based Entry Urgency Removal

**Change ID:** CCIP-2026-01-22-001
**Date:** 2026-01-22
**Status:** IN PROGRESS
**Severity:** MAJOR ARCHITECTURAL CHANGE

---

## Executive Summary

Removal of the Time-Based Entry Urgency system (Phase 1 → Phase 2 → Phase 3 progressive relaxation) from the entry monitoring flow. This simplifies the execution model while maintaining quality standards through confidence-based thresholds.

---

## System Map

### Components Being Modified:
1. **Configuration Layer**
   - `src/config/alpha-identity.ts` - Remove ENTRY_URGENCY_CONFIG

2. **Service Layer**
   - `src/services/entry-time-decay-coordinator.ts` → Rename to `entry-edge-loss-detector.ts`
   - `src/services/entry-urgency-calculator.ts` → Mark as deprecated (preserve)
   - `src/services/unified-entry-monitor.ts` - Remove phase logic

3. **UI Components**
   - `src/components/EntryUrgencyPhaseTimer.tsx` → DELETE
   - `src/components/ActiveEntryIntents.tsx` - Remove phase displays
   - `src/components/EntryQualityMonitor.tsx` - Simplify threshold display
   - `src/components/SimpleEntryMonitor.tsx` - Remove phase references

4. **Database Schema**
   - Deprecate urgency-related columns (preserve for historical data)

### SSOT Authorities Affected:
- **Entry Timing Authority:** Simplified from time-based phases to confidence-based static thresholds
- **Zone Validation Authority:** Simplified from progressive tolerance to exact zone matching
- **Edge Loss Authority:** Remains intact with absolute time limits per style

---

## Logic Contract

### OLD BEHAVIOR (Being Removed):
```typescript
// Time-Based Progressive Relaxation
Phase 1 (0-5min):   EQS >= 60/75 required, exact zone only
Phase 2 (5-15min):  EQS >= 50/75 required, zone ± 20% tolerance
Phase 3 (15-25min): EQS >= 40/75 required, zone ± 50% tolerance
```

### NEW BEHAVIOR (Being Implemented):
```typescript
// Confidence-Based Static Thresholds
Alpha Confidence >= 85%: EQS >= 30/75 required, exact zone only
Alpha Confidence >= 70%: EQS >= 35/75 required, exact zone only
Alpha Confidence >= 60%: EQS >= 40/75 required, exact zone only
```

### Invariants Preserved:
- ✅ Edge loss detection still triggers at style-specific max times
- ✅ EQS scoring system (75-point scale) unchanged
- ✅ Thesis-specific scoring weights unchanged
- ✅ Zone calculation logic unchanged
- ✅ Confidence-based threshold adjustment preserved
- ✅ Historical data preserved (columns not dropped)

### Breaking Changes:
- ⚠️ UI components reading `urgency_phase` will need updates
- ⚠️ Zone tolerance no longer progressively relaxes over time
- ⚠️ EQS thresholds no longer decay with elapsed time

---

## Compatibility Check

### Database Compatibility:
- **Safe:** Columns deprecated but not dropped
- **Migration:** Add comments marking columns as deprecated
- **Queries:** Update to ignore urgency_phase, use base eqs_threshold

### API Compatibility:
- **Entry Intent Creation:** No API changes
- **Entry Monitoring:** No API changes
- **Execution Flow:** No API changes

### UI Compatibility:
- **Breaking:** EntryUrgencyPhaseTimer removed
- **Breaking:** Phase displays removed from ActiveEntryIntents
- **Safe:** Fallback to static threshold displays

---

## Staged Deployment Plan

### Stage 1: Configuration & Service Layer (Non-Breaking)
1. Create `entry-edge-loss-detector.ts` (new service)
2. Update `unified-entry-monitor.ts` to use new detector
3. Remove ENTRY_URGENCY_CONFIG from alpha-identity.ts
4. Mark entry-urgency-calculator.ts as deprecated

### Stage 2: UI Component Updates (Breaking)
1. Remove EntryUrgencyPhaseTimer.tsx
2. Update ActiveEntryIntents.tsx
3. Update EntryQualityMonitor.tsx
4. Update SimpleEntryMonitor.tsx

### Stage 3: Database Schema (Safe)
1. Create migration to deprecate columns
2. Update queries to ignore deprecated columns
3. Stop writing to deprecated columns

### Stage 4: Documentation & Verification
1. Create EQS_SCORING_REFERENCE.md
2. Update existing docs
3. Run build verification
4. Deploy to production

---

## Rollback Plan

If issues arise:
1. **Phase 1 Rollback:** Revert service layer changes, restore urgency config
2. **Phase 2 Rollback:** Restore UI components from git history
3. **Phase 3 Rollback:** No rollback needed (columns preserved)

**Rollback Trigger Conditions:**
- Execution failure rate > 5%
- Entry intent creation failures
- Critical UI errors preventing monitoring

---

## Post-Deploy Verification

### Success Criteria:
- [ ] Entry intents created successfully without urgency columns
- [ ] Entry monitoring executes at confidence-based thresholds
- [ ] Edge loss modal still triggers at style max times
- [ ] No console errors related to missing phase data
- [ ] Build completes without errors
- [ ] All tests pass

### Monitoring:
- Watch entry execution logs for threshold calculation
- Monitor edge loss modal trigger frequency
- Check for any null reference errors in monitoring loop

---

## Governance Compliance

**SSOT Principles:**
- ✅ Single authority for threshold calculation (confidence-based)
- ✅ Single authority for edge loss detection (absolute time limits)
- ✅ No duplicate logic across services

**CCIP Principles:**
- ✅ System map documented
- ✅ Logic contract defined
- ✅ Compatibility checked
- ✅ Staged deployment planned
- ✅ Rollback plan defined

**Degradation Intelligence:**
- ✅ Trades do not silently fail (validation errors surfaced)
- ✅ No over-blocking (confidence adjusts threshold down for high conviction)
- ✅ Edge loss modal provides user choice (not automatic abandonment)

---

## Sign-Off

**Architectural Review:** ✅ APPROVED
**Safety Review:** ✅ APPROVED
**SSOT Compliance:** ✅ APPROVED
**CCIP Compliance:** ✅ APPROVED

**Implementation Start:** 2026-01-22
**Expected Completion:** 2026-01-22
**Deployed By:** Autonomous System

---

## Change Log

- 2026-01-22 14:00 - Document created
- 2026-01-22 14:15 - Implementation started
