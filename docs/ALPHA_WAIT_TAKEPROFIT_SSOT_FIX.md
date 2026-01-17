# Alpha WAIT TakeProfit SSOT Fix

## Issue Identified

**Reporter**: User flagged potential SSOT violation where hardcoded 2:1 R:R was being used for WAIT decisions instead of Alpha's output.

**Root Cause**: The fix applied to address 0.033:1 R:R ratios added a hardcoded fallback calculation:
```typescript
const targetRR = 2.0; // Conservative R:R for WAIT decisions
const calculatedTP = isWaitBuy
  ? entryMidpoint + (slDistance * targetRR)
  : entryMidpoint - (slDistance * targetRR);
const finalTakeProfit = parsed.takeProfit || calculatedTP; // ❌ VIOLATES SSOT
```

This violated the architectural principle: **"Engines validate. Alpha decides. Engines never invent intent."**

## Architectural Clarification

### WAIT is a Full Trade Plan

**Critical Understanding**:
- WAIT decisions are complete trade plans with delayed execution
- Waiting changes **WHEN** we enter, not **WHAT** the trade is
- Therefore, Alpha MUST provide: `entry`, `stopLoss`, `takeProfit`, `thesis`, `confidence`

### Golden Rule

**If Alpha does not specify `takeProfit`, the trade plan is invalid.**

Not "fallback" — Not "auto-correct" — Not "reasonable default" — **Invalid**.

## Fix Applied

### 1. Enhanced Alpha Prompt (coordinator-alpha.ts:1418-1437)

Added explicit instructions that WAIT requires full trade plan:

```typescript
When choosing WAIT, specify:
• Target entry zone (min/max prices)
• Invalidation price (where setup becomes invalid)
• Wait reasoning (what you're waiting for)
• FULL TRADE PLAN including entry, stopLoss, and takeProfit

CRITICAL: WAIT is a full trade plan with delayed execution.
You MUST provide entry, stopLoss, and takeProfit for WAIT decisions.
Waiting changes WHEN we enter, not WHAT the trade is.

Return JSON with structured reasoning:
{
  "takeProfit": price,  // REQUIRED for all actions including WAIT
  ...
}
```

### 2. Strict Validation with Fail-Fast (coordinator-alpha.ts:2587-2636)

Removed hardcoded fallback and enforced strict validation:

```typescript
// SSOT ENFORCEMENT: Alpha MUST provide takeProfit for WAIT decisions
// WAIT is a full trade plan with delayed execution - not a partial decision
// Engines validate. Alpha decides. Engines never invent intent.
if (!parsed.takeProfit) {
  console.error('[Alpha Coordinator] ❌ SSOT VIOLATION: Alpha did not provide takeProfit for WAIT decision');

  // Log violation for monitoring and learning (non-blocking)
  logViolation({
    violationType: 'ALPHA_MISSING_TAKEPROFIT_WAIT',
    symbol: marketContext.symbol,
    attemptedOperation: 'wait_decision',
    callLocation: 'coordinator-alpha.ts:2591',
    blocked: true,
    errorDetails: {
      action: parsed.action,
      hasEntry: !!parsed.entry,
      hasStopLoss: !!parsed.stopLoss,
      hasTakeProfit: false,
      wait_condition: waitCondition,
      reasoning: parsed.reasoning,
      timestamp: new Date().toISOString(),
    }
  }).catch(err => console.error('[Alpha Coordinator] Failed to log SSOT violation:', err));

  return {
    action: 'NO_TRADE',
    decision: 'NO_TRADE',
    confidence: 0,
    reasoning: 'Invalid WAIT decision: Alpha did not provide takeProfit. WAIT requires full trade plan.',
    ...
  };
}

const finalTakeProfit = parsed.takeProfit; // Alpha's decision - no fallbacks
```

### 3. SSOT Violation Logging

Added new violation type for monitoring:
- **Type**: `ALPHA_MISSING_TAKEPROFIT_WAIT`
- **Purpose**: Track when Alpha fails to provide TP for WAIT decisions
- **Action**: Blocks trade execution (NO_TRADE)
- **Learning**: Logs to `ssot_violations` table for prompt refinement

## Comparison: Before vs After

### Before (INCORRECT)
```typescript
// If Alpha doesn't provide TP, calculate 2:1 R:R
const finalTakeProfit = parsed.takeProfit || calculatedTP;
```
**Problem**: Engine invents intent when Alpha fails

### After (CORRECT)
```typescript
// If Alpha doesn't provide TP, fail fast
if (!parsed.takeProfit) {
  logViolation(...);
  return { action: 'NO_TRADE', reasoning: 'Invalid WAIT decision...' };
}
const finalTakeProfit = parsed.takeProfit; // No fallbacks
```
**Solution**: Fail explicitly, force Alpha to provide complete plan

## Architectural Benefits

1. **Preserves Alpha as SSOT**: No silent overrides of Alpha's authority
2. **Forces Prompt Correctness**: Incomplete outputs are rejected
3. **Makes Failures Explicit**: Engineers know when Alpha needs improvement
4. **Improves Learning**: Violations are logged for analysis
5. **Prevents Behavior Drift**: No hidden fallback logic to debug later

## Related Distinction: Auto-Correction vs Fallbacks

**BUY/SELL Auto-Correction (lines 2664-2678)**: Acceptable
- When TP is on **wrong side** (LLM hallucination)
- Emergency safety measure (1.5:1 R:R)
- Prevents catastrophic execution errors

**WAIT Fallback (REMOVED)**: Not acceptable
- WAIT is deliberate planning, not hallucination
- Missing TP indicates incomplete prompt output
- Using fallback blurs two different concepts

## Testing

Build status: ✅ Passed
- No compilation errors
- SSOT validation enforced
- Violation logging functional

## File Modified

- `src/brains/coordinator-alpha.ts`
  - Lines 106: Added `logViolation` import
  - Lines 1418-1437: Enhanced WAIT prompt instructions
  - Lines 2587-2636: Replaced fallback with strict validation

## Monitoring

Check `ssot_violations` table for:
```sql
SELECT * FROM ssot_violations
WHERE violation_type = 'ALPHA_MISSING_TAKEPROFIT_WAIT'
ORDER BY created_at DESC;
```

If violations occur frequently:
1. Review Alpha's prompt understanding
2. Verify LLM model is parsing schema correctly
3. Consider adding schema validation examples to prompt

## One-Line Principle

**Engines validate. Alpha decides. Engines never invent intent.**
