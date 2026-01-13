# Alpha Sovereignty - Quick Reference Guide

**Build Status:** ✅ PASSED
**Deployment:** Ready
**Date:** 2026-01-13

---

## What Changed

### Before (Over-Governed System)
- ❌ Confidence <60% → BLOCKED
- ❌ Distance >2.5 ATR → BLOCKED
- ❌ EQS below threshold → BLOCKED
- ❌ Multiple gatekeepers judging Alpha

### After (Alpha Sovereignty)
- ✅ ALL confidence levels execute (with sizing)
- ✅ ALL distances monitored (no blocking)
- ✅ EQS advisory only
- ✅ Alpha is sole decision maker

---

## New Files Created

1. **`src/types/alpha-decision-contract.ts`**
   - Standardizes Alpha decision format
   - EXECUTE_NOW | WAIT | PASS actions
   - Entry plan and execution policy for WAIT

2. **`src/services/mandatory-safety-validator.ts`**
   - Only allowed blocker
   - 4 categories: margin, market, SSOT, format
   - All other checks removed

3. **`src/config/alpha-authority.ts`**
   - Defines sovereignty rules
   - Lists advisory-only metrics
   - Entry Optimizer permissions
   - PCPE permissions

---

## Key Removals

### Entry Monitor (lines 279-305)
**Removed:** 2.5x ATR distance block
**Now:** Advisory warning, intent always created

### PCPE (multiple locations)
**Removed:** BLOCKED band (<58% confidence)
**Now:** MICRO band (0.25x size, no floor)

### Goal Scanner (line 368)
**Removed:** 60% confidence threshold
**Now:** All BUY/SELL decisions valid

---

## Only 4 Allowed Blocks

1. **Margin/Drawdown/Exposure Breach**
   - Account risk limits exceeded
   - Daily loss limit reached
   - Position size too large

2. **Market Closed**
   - Symbol halted
   - Outside trading hours
   - Weekend/holiday

3. **Invalid SSOT**
   - Missing trade context
   - Corrupted data
   - Data integrity failure

4. **Malformed Order**
   - NaN values
   - Negative prices
   - Invalid decimals
   - Broker format errors

**Everything else is ADVISORY ONLY.**

---

## How It Works Now

### Low Confidence Trade (e.g., 45%)
```
Alpha decides: confidence=45%, EXECUTE_NOW
→ PCPE classifies: MICRO band
→ Size multiplier: 0.25x
→ Executes: YES (reduced size)
→ Blocked: NO
```

### Distant Zone WAIT (e.g., 5x ATR)
```
Alpha decides: WAIT, zone 5x ATR away
→ Entry Monitor: Creates intent (no block)
→ Pre-flight: RED advisory (warning only)
→ Entry Optimizer: Monitors price movement
→ Result: Intent created, monitoring active
```

### Mandatory Safety Failure
```
Alpha decides: EXECUTE_NOW
→ Mandatory Safety: Margin insufficient
→ Result: BLOCKED (only mandatory can block)
→ User notified: "Margin breach - reduce size"
```

---

## PCPE Behavior

### Confidence Bands (New)
- **FULL:** ≥78% → 1.0x size
- **REDUCED:** 68-77% → 0.5x size
- **MICRO:** <68% → 0.25x size
- **BLOCKED:** REMOVED

### Reachability (Advisory)
- FULL → REDUCED if >1.2x ATR
- REDUCED → MICRO if >1.5x ATR
- MICRO → NEVER downgrades (Alpha authority)

### Chase Zones
- Not viable → Converts to PRIMARY
- No blocking, just zone conversion

---

## Entry Optimizer Role

### CAN Do:
✅ Monitor price movement
✅ Calculate metrics (distance, EQS)
✅ Provide telemetry
✅ Abandon if invalidation zone hit
✅ Abandon if timeout expires

### CANNOT Do:
❌ Block intent creation
❌ Override Alpha's zones
❌ Apply ATR distance limits
❌ Return NO_TRADE on Alpha's WAIT

**Optimizer SERVES Alpha, doesn't judge Alpha.**

---

## Testing Checklist

### Test 1: Low Confidence
- Set confidence to 40%
- Expected: Executes with 0.25x size
- Check: No confidence block

### Test 2: Distant Zone
- Set zone 5x ATR away
- Expected: Intent created, monitoring starts
- Check: No distance block

### Test 3: Margin Breach
- Simulate insufficient margin
- Expected: BLOCKED by mandatory safety
- Check: Proper error message

### Test 4: Market Closed
- Try trade on weekend
- Expected: BLOCKED by market check
- Check: Weekend protection working

### Test 5: NaN Value
- Set entry price to NaN
- Expected: BLOCKED by format check
- Check: Validation catches error

---

## Configuration Access

### Import Alpha Authority
```typescript
import { ALPHA_AUTHORITY } from '@/config/alpha-authority';

// Check if metric is advisory
if (ALPHA_AUTHORITY.ADVISORY_METRICS.includes('confidence')) {
  // This is advisory only, never block
}
```

### Import Mandatory Safety
```typescript
import { mandatorySafetyValidator } from '@/services/mandatory-safety-validator';

const result = await mandatorySafetyValidator.validate(
  userId, sessionId, symbol, direction,
  entry, stopLoss, takeProfit, lotSize
);

if (!result.allowed) {
  // Only mandatory safety blocks
  console.error(`Blocked: ${result.blockReason}`);
}
```

### Import Alpha Contract
```typescript
import {
  createExecuteNowContract,
  createWaitContract
} from '@/types/alpha-decision-contract';

const contract = createExecuteNowContract(
  tradeSpec, confidence, reasoning, marketContext
);
```

---

## Rollback Plan

If issues occur:

1. **Quick Disable:**
   ```typescript
   // In alpha-authority.ts
   export const ALPHA_AUTHORITY = {
     MANDATORY_BLOCKS_ONLY: false, // Reverts to old logic
     ...
   };
   ```

2. **Full Revert:**
   ```bash
   git revert <commit-hash>
   npm run build
   ```

3. **Restore BLOCKED band:**
   - Add back to `src/types/pcpe.ts`
   - Restore threshold checks
   - Restore distance limits

---

## Monitoring After Deploy

Watch for:
1. ✅ Low confidence trades executing (new behavior)
2. ✅ Entry Optimizer abandonment frequency
3. ✅ PCPE downgrade rates (FULL→REDUCED→MICRO)
4. ✅ Only mandatory safety blocks firing

Expected changes:
- More trades execute (was blocked before)
- More MICRO band trades (low confidence)
- More distant zone monitoring (was blocked)
- Same mandatory safety blocks (unchanged)

---

## Support

For questions or issues:
1. Check `docs/ALPHA_SOVEREIGNTY_IMPLEMENTATION_COMPLETE.md` for full details
2. Review `src/config/alpha-authority.ts` for sovereignty rules
3. Test with `src/services/mandatory-safety-validator.ts` validation

---

**Status:** ✅ READY FOR DEPLOYMENT
**CCIP:** ✅ Validated
**Build:** ✅ PASSED
**Philosophy:** Alpha decides, components serve
