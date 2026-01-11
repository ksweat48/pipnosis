# Omega-9 LLM Hallucination Fix

## Problem

Omega-9 safety validator was calling LLM validation even when local validation passed with GREEN safety zone. The LLM was then **hallucinating incorrect R:R values** and blocking valid trades.

Example from logs:
- US30 had R:R **1.53:1** (meets requirements)
- Safety Zone: **GREEN**
- But LLM said "risk-reward ratio below 1" - **FALSE**

## Root Cause

In `omega9-hallucination-brain.ts`, when vote conflicts were detected (normal with diverse Omega council), the code would call LLM validation even though:
1. Local validation passed
2. Safety zone was GREEN
3. R:R was acceptable

The LLM would then hallucinate and block the trade.

## Fix Applied

Updated `validate()` method to trust Alpha's decision when conditions are favorable:

```typescript
const safetyZone = localValidation.safety_zone || 'YELLOW';
const onlyVoteConflicts = localValidation.flags.every(f =>
  f.includes('VOTE_SPLIT') ||
  f.includes('MAJORITY_NO_TRADE') ||
  f.includes('ADVISORY') ||
  f.includes('YELLOW_ZONE') ||
  f.includes('ORANGE_ZONE')
);

if (safetyZone === 'GREEN' && onlyVoteConflicts) {
  console.log('[Omega-9] ✅ GREEN zone with vote conflicts - trusting Alpha decision (skipping LLM)');
  return localValidation;
}

if (safetyZone === 'YELLOW' && onlyVoteConflicts) {
  console.log('[Omega-9] ⚡ YELLOW zone with vote conflicts - trusting Alpha decision (skipping LLM)');
  return localValidation;
}
```

## Behavior After Fix

- **GREEN zone + vote conflicts**: Skip LLM, trust Alpha (Alpha already resolved conflicts via weighted consensus)
- **YELLOW zone + vote conflicts**: Skip LLM, trust Alpha with advisory
- **ORANGE/RED zone or critical errors**: Still call LLM for validation
- **Mathematical errors (wrong SL/TP side)**: Still block or repair

## What Omega-9 Still Blocks

1. **RED zone violations** (mathematical survival threats)
2. **SL on wrong side of entry** (catastrophic positioning)
3. **TP on wrong side of entry** (impossible profit)
4. **Zero distance errors**

## What Omega-9 No Longer Blocks

1. Vote conflicts when safety zone is GREEN/YELLOW
2. Valid R:R trades that LLM incorrectly identified as risky
3. Trades where Alpha has already made a weighted consensus decision

## Files Changed

- `src/brains/omega9-hallucination-brain.ts` - Skip LLM for GREEN/YELLOW zones with only vote conflicts
