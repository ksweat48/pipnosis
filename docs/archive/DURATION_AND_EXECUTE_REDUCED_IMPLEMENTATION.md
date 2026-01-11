# Duration and EXECUTE_REDUCED Implementation Summary

## Implementation Date
January 7, 2026

## Overview
This document summarizes the architectural decisions and implementations related to duration tracking and EXECUTE_REDUCED handling in Pipnosis.

---

## Question 1: EXECUTE_REDUCED Handling

### Decision: Treat as Distinct from EXECUTE with Full Downshift Proposal

**Rationale:**
- `EXECUTE_REDUCED` is specifically designed to AVOID the full Alpha downshift confirmation flow
- It represents simple, automatic goal reductions that are safe by design
- No Alpha LLM call needed - saves latency and cost
- Used for straightforward reductions (e.g., 80% of threshold) where safety is already determined

### Implementation

#### Type System Updates (`src/types/goal-feasibility.ts`)
```typescript
export interface ReducedGoalProposal {
  reducedGoal: number;
  retentionPercent: number;
  reason: string;
  advisoryMessage: string;
}

export interface FeasibilityResult {
  feasible: boolean;
  tier: 'EXECUTE' | 'EXECUTE_REDUCED' | 'WAIT_FOR_VOLATILITY' | 'BLOCK_WITH_ALTERNATIVES';
  proposal?: DownshiftProposal | ReducedGoalProposal;
  // ...
}
```

#### Live Engine Flow (`src/services/goal-session-live-engine.ts` ~line 949)
```typescript
// EXECUTE_REDUCED - Auto-apply without Alpha confirmation
if (feasibilityResult.feasible && feasibilityResult.tier === 'EXECUTE_REDUCED') {
  // 1. Log advisory message to user
  // 2. Apply reducedGoal from proposal automatically
  // 3. Recalculate trade parameters
  // 4. Proceed directly to execution eligibility gate
  // 5. Skip Alpha downshift confirmation entirely
}
// Full DOWNSHIFT - Requires Alpha confirmation
else if (feasibilityResult.feasible && feasibilityResult.proposal) {
  // Request Alpha evaluation via AlphaDownshiftEvaluator
  // Alpha can AFFIRM, WAIT, or REJECT
  // Only proceed if AFFIRM
}
```

### User Experience
- **EXECUTE_REDUCED**: User sees advisory message, reduction applied automatically, trade proceeds
- **Full DOWNSHIFT**: User waits for Alpha analysis, Alpha decides whether to proceed

### Philosophy Alignment
Supports "partial success > NO_TRADE" philosophy while avoiding unnecessary LLM overhead for straightforward reductions.

---

## Question 2: actual_duration_hours Calculation

### Decision: Trigger-Only (Already Correctly Implemented)

**Rationale (SSOT Principles):**
1. **Single source of truth** - Trigger calculates from authoritative `opened_at` and `closed_at` timestamps
2. **Automatic and reliable** - Cannot be forgotten or bypassed by application code paths
3. **Correct timing** - Uses actual DB values, not potentially stale local timestamps
4. **Consistency** - Works identically for ALL close paths (TP, SL, manual, force close, etc.)

### Implementation

#### Database Trigger (Already Implemented)
Migration: `20260107075800_add_duration_style_tracking.sql`

```sql
CREATE OR REPLACE FUNCTION calculate_actual_duration()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'closed' AND NEW.closed_at IS NOT NULL AND NEW.opened_at IS NOT NULL THEN
    NEW.actual_duration_hours := EXTRACT(EPOCH FROM (NEW.closed_at - NEW.opened_at)) / 3600.0;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

#### Application Code Responsibility
- **At trade OPEN**: Set `expected_duration_hours` from `timeToFillResult.expectedHours`
- **At trade CLOSE**: Do NOT touch `actual_duration_hours` - let trigger handle it
- **For analytics**: Read `actual_duration_hours` from closed trades

### Verification
```bash
# Confirmed: No application code attempts to set actual_duration_hours
grep -r "actual_duration_hours" /tmp/cc-agent/58035261/project/src/
# Result: No matches (correct)
```

---

## Question 3: Duration Calculator Consolidation

### Decision: Consolidate to time-to-fill-calculator.ts

**Rationale:**
Both files served essentially the same purpose with duplicate logic:

| Feature | time-to-fill-calculator.ts | duration-calculator.ts |
|---------|---------------------------|------------------------|
| Style bands | SCALP/MICRO/INTRADAY/EXTENDED | Same |
| Thresholds | 2h, 6h, 10h | Same |
| Output | Style upgrade, rewards/penalties | Same |
| Currently used | ✅ Active in live engine | ❌ No consumers |

**Issues with maintaining both:**
1. Duplicate band definitions (2h, 6h, 10h thresholds)
2. Risk of drift if one is updated and the other isn't
3. Developer confusion about which to call
4. SSOT violation - same responsibility split across two files

### Implementation
1. ✅ Verified `duration-calculator.ts` has no active consumers
2. ✅ Removed `duration-calculator.ts`
3. ✅ `time-to-fill-calculator.ts` remains as the single authority

### Future Improvement Opportunity
Both calculators currently define thresholds inline. Consider extracting to `STYLE_DURATION_BANDS` in `pipnosis-core-rules.ts` for single source of truth.

---

## Architectural Principles Applied

### 1. Single Source of Truth (SSOT)
- **actual_duration_hours**: One authority (trigger), not application code
- **Duration calculation**: One calculator, not two duplicate implementations
- **EXECUTE_REDUCED logic**: Distinct path, not duplicated in downshift flow

### 2. Anti-Regression
"If a bug can be fixed in more than one place, the architecture is incorrect."
- Trigger-based duration ensures all close paths inherit correct behavior
- Single duration calculator means fixes apply everywhere automatically

### 3. Partial Success > NO_TRADE
- EXECUTE_REDUCED enables partial goal achievement without blocking
- Avoids unnecessary LLM calls for straightforward reductions
- User gets some progress rather than complete rejection

---

## Testing Recommendations

### EXECUTE_REDUCED Flow
1. Create goal session with large goal (>30% of account)
2. Verify EXECUTE_REDUCED tier is returned
3. Confirm NO Alpha LLM call is made
4. Verify advisory message is shown to user
5. Verify trade parameters are adjusted correctly
6. Verify execution proceeds without waiting

### Duration Tracking
1. Open test trade
2. Close trade after known duration (e.g., 2.5 hours)
3. Query database: `SELECT actual_duration_hours FROM goal_session_trades WHERE id = ?`
4. Verify calculated value matches expected (should be ~2.5)
5. Verify `expected_duration_hours` was set at open time

### Consolidated Calculator
1. Import `timeToFillCalculator` in test
2. Verify style band calculations for various durations
3. Verify reward/penalty logic
4. Confirm no references to old `durationCalculator` remain

---

## Files Modified

### Created/Updated
- `src/types/goal-feasibility.ts` - Added `ReducedGoalProposal` type, updated tier enum
- `src/services/goal-session-live-engine.ts` - Added EXECUTE_REDUCED handling (line ~949)

### Removed
- `src/services/duration-calculator.ts` - Consolidated into time-to-fill-calculator.ts

### Verified (No Changes Needed)
- `supabase/migrations/20260107075800_add_duration_style_tracking.sql` - Trigger already correct
- `src/services/time-to-fill-calculator.ts` - Already active and correct

---

## Build Verification

```bash
npm run build
# Result: ✅ Build successful with no errors related to changes
```

---

## Summary

All three architectural questions have been resolved following Pipnosis SSOT principles:

1. ✅ **EXECUTE_REDUCED**: Distinct handling without Alpha confirmation
2. ✅ **actual_duration_hours**: Trigger-only calculation (already correct)
3. ✅ **Duration calculators**: Consolidated to single authority

Future code will inherit correct behavior by default, and there are no duplicate authorities for any responsibility.
