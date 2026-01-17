# Alpha Authority Refactor - Implementation Plan

**Principle**: "Engines validate. Alpha decides. Trades degrade intelligently — they do not silently mutate or over-block."

## Phase 1: Foundation (COMPLETED)

✅ Created `/src/types/alpha-repair.ts` - Repair system types
✅ Created `/src/services/alpha-repair-service.ts` - Repair LLM service
✅ Created `/src/services/alpha-validation-service.ts` - Hard block vs soft violation logic

## Phase 2: Remove Auto-Corrections (IN PROGRESS)

### A. coordinator-alpha.ts Changes

#### Location 1: Lines 1553-1577 - Remove Phase 3 Auto-Correction
**Current Code**:
```typescript
// Phase 3: Auto-correct decision to meet minimum constraints
const autoCorrection = omega9ConstraintProvider.autoCorrectDecision(
  {entry, stopLoss, takeProfit, direction},
  omega9Constraints,
  marketContext.symbol
);
if (autoCorrection.corrected) {
  if (autoCorrection.newStopLoss) decision.stopLoss = autoCorrection.newStopLoss;
  if (autoCorrection.newTakeProfit) decision.takeProfit = autoCorrection.newTakeProfit;
  decision.confidence = Math.max(0, decision.confidence - 10); // PENALTY
  decision.reasoning += ` [Auto-corrected: ${autoCorrection.corrections.join('; ')}]`;
}
```

**New Code**:
```typescript
// Phase 3: If Alpha didn't revise, block with clear SSOT violation
console.log('[Alpha Coordinator] ❌ Alpha declined revision - blocking trade');
decision.action = 'NO_TRADE';
decision.confidence = 0;
decision.reasoning = `Constraint violations not resolved: ${violations.map(v => v.message).join('; ')}`;

// Log SSOT violation for learning
await ssotViolationLogger.logViolation({
  violation_type: 'ALPHA_CONSTRAINT_VIOLATION_UNRESOLVED',
  severity: 'high',
  source_module: 'coordinator-alpha',
  violation_details: { violations, originalDecision: decision },
  resolution: 'blocked'
});
```

#### Location 2: Lines 2689-2692 - Remove SL Auto-Correction
**Current Code**:
```typescript
if (slOnWrongSide) {
  if (stopLossAnchor) {
    console.warn(`Auto-correcting to anchor: ${stopLossAnchor.stopLossPrice}`);
    stopLoss = stopLossAnchor.stopLossPrice; // SILENT MUTATION
  }
}
```

**New Code**:
```typescript
if (slOnWrongSide) {
  errorReason = `Stop Loss on WRONG SIDE: ${action} with Entry=${entry}, SL=${stopLoss}`;
  catastrophicError = true;
  // Log geometry violation
  await ssotViolationLogger.logViolation({
    violation_type: 'ALPHA_SL_WRONG_SIDE',
    severity: 'critical',
    source_module: 'coordinator-alpha.parseDecision',
    violation_details: { symbol, action, entry, stopLoss, direction },
    resolution: 'hard_blocked'
  });
}
```

#### Location 3: Lines 2704-2723 - Remove TP Auto-Correction with 1.5:1 R:R
**Current Code**:
```typescript
if (tpOnWrongSide) {
  if (stopLoss) {
    const slDistance = Math.abs(entry - stopLoss);
    const rrRatio = 1.5; // HARDCODED FALLBACK
    takeProfit = entry + (slDistance * rrRatio); // SILENT MUTATION
    adjustedConfidence = Math.max(0, adjustedConfidence - 15); // PENALTY
  }
}
```

**New Code**:
```typescript
if (tpOnWrongSide) {
  errorReason = `Take Profit on WRONG SIDE: ${action} with Entry=${entry}, TP=${takeProfit}`;
  catastrophicError = true;
  // Log geometry violation
  await ssotViolationLogger.logViolation({
    violation_type: 'ALPHA_TP_WRONG_SIDE',
    severity: 'critical',
    source_module: 'coordinator-alpha.parseDecision',
    violation_details: { symbol, action, entry, takeProfit, direction },
    resolution: 'hard_blocked'
  });
}
```

### B. omega9-hallucination-brain.ts Changes

#### Remove attemptRepair() Method (Lines 355-403)
**Current**: Calculates SL using 1.5x ATR, TP using 2.5x ATR
**New**: Remove entirely. Omega-9 detects but does NOT repair.

```typescript
// REMOVED: attemptRepair() method

// In validate() method, change:
if (hasCriticalError) {
  // OLD: corrections = this.attemptRepair(input, flags);
  // NEW: Just block
  return {
    pass: false,
    flags,
    confidence_adjustment: 0,
    corrections: null,
    reasoning: `Critical errors detected: ${flags.join(', ')}`
  };
}
```

### C. omega9-constraint-provider.ts Changes

#### Remove autoCorrectDecision() Method
**Current**: Auto-corrects TP to maxTPPips, auto-adjusts R:R
**New**: Remove method entirely. Replace with:

```typescript
/**
 * Provide constraint ranges for Alpha Repair (advisory only)
 */
getConstraintRanges(
  symbol: string,
  constraints: Omega9Constraints
): {
  slRange: { min: number; max: number };
  tpRange: { min: number; max: number };
  rrRange: { min: number; max: number };
} {
  return {
    slRange: {
      min: constraints.minStopLossPips * pipInfo.pipValue,
      max: constraints.maxStopLossPips * pipInfo.pipValue
    },
    tpRange: {
      min: constraints.minTakeProfitPips * pipInfo.pipValue,
      max: constraints.maxTakeProfitPips * pipInfo.pipValue
    },
    rrRange: {
      min: constraints.minRiskReward,
      max: constraints.maxRiskReward
    }
  };
}
```

### D. safety-enforcer.ts Changes

#### Remove All TP/SL Modifications (Lines 126-146, 202-216)
**Current**: Extends TP to 1.5:1 R:R, forces 2.0:1 during volatile sessions
**New**: Return advisory recommendations only

```typescript
enforceConstraints(decision, regime, adversarial) {
  const recommendations = {
    valid: true,
    violations: [],
    advisory: {
      recommendedRiskPct: decision.risk_pct,
      confidenceModifier: 1.0,
      reason: null
    }
  };

  // Check R:R (advisory only)
  if (rr < TARGET_RR_RATIO) {
    recommendations.violations.push({
      type: 'RR_BELOW_TARGET',
      severity: 'MEDIUM',
      current: rr,
      target: TARGET_RR_RATIO,
      recommendation: `Consider ${TARGET_RR_RATIO}:1 R:R for better edge`
    });
  }

  // Check volatility risk (advisory only)
  if (regime.is_high_risk_regime) {
    recommendations.advisory.recommendedRiskPct *= regime.risk_reduction_factor;
    recommendations.advisory.reason = 'High volatility detected';
  }

  return recommendations; // NO MUTATIONS
}
```

#### Remove Risk Reductions (Lines 185-190, 240-246)
**Current**: Silently reduces risk_pct by 50% for adversarial/volatility
**New**: Return recommendations, Alpha decides

## Phase 3: Enhance Alpha Revision Handler

Update `/src/services/alpha-revision-handler.ts`:

### Add Multi-Attempt Support
```typescript
// Allow 2-3 revision attempts instead of just 1
const MAX_REVISION_ATTEMPTS = 2;

async requestRevisionWithRetry(
  decision,
  violations,
  constraints,
  symbol,
  userId
): Promise<AlphaRevisionResponse> {
  for (let attempt = 1; attempt <= MAX_REVISION_ATTEMPTS; attempt++) {
    const response = await this.requestRevision(...);
    if (response.revised) {
      // Validate revised decision
      const stillViolating = this.checkViolations(response.revisedDecision);
      if (stillViolating.length === 0) {
        return response; // Success
      }
      // Still violating, try again
      violations = stillViolating;
    } else {
      break; // Alpha declined
    }
  }
  // All attempts exhausted
  return { revised: false, blockReason: 'Could not resolve violations' };
}
```

### Add Degradation Support
```typescript
// In revision prompt, add:
`
If user goal ($${userGoal}) exceeds market feasibility ($${maxFeasible}),
propose best available trade with clear user message:

Example:
{
  "revised": true,
  "takeProfit": (calculated for $maxFeasible),
  "degradationApplied": true,
  "degradationOriginal": "Target $100",
  "degradationRevised": "Target $50 (best available)",
  "degradationUserMessage": "Market can offer ~$50 right now — executing best available setup."
}
`
```

## Phase 4: Trade Execution Slippage (Keep but Make Explicit)

### trade-execution-engine.ts (Lines 810-828)
**Current**: Silently adjusts entry/SL/TP for slippage
**New**: Keep functionality but log explicitly

```typescript
if (useLivePrice) {
  const adjustedLevels = this.adjustLevelsForNewEntry(...);
  const slippagePips = calculatePipDistance(symbol, signal.entryPrice, executionBasePrice);

  logger.info(
    `[Execution] Slippage adjustment: ${slippagePips.toFixed(1)} pips ` +
    `(Entry ${signal.entryPrice} → ${executionBasePrice})`
  );

  // Store slippage for forensics
  await supabase.from('trade_forensics').insert({
    trade_id: tradeId,
    slippage_pips: slippagePips,
    original_entry: signal.entryPrice,
    executed_entry: executionBasePrice,
    original_sl: signal.stopLoss,
    executed_sl: adjustedLevels.stopLoss,
    original_tp: signal.takeProfit,
    executed_tp: adjustedLevels.takeProfit
  });
}
```

## Phase 5: Remove Confidence Penalties

Search and remove ALL instances of confidence penalties:
- `decision.confidence = Math.max(0, decision.confidence - 10)` → REMOVE
- `decision.confidence = Math.max(0, decision.confidence - 15)` → REMOVE
- `confidence_adjustment: -10` → CHANGE TO 0

**Rule**: Confidence measures decision quality, NOT compliance.

## Phase 6: Allowed Hard Blocks (Final List)

Only these may terminate a trade attempt:

```typescript
const ALLOWED_HARD_BLOCKS = [
  'SL_WRONG_SIDE',           // Geometry invalid
  'TP_WRONG_SIDE',           // Geometry invalid
  'ENTRY_EQUALS_SL',         // Zero distance
  'ENTRY_EQUALS_TP',         // Zero distance
  'MISSING_ENTRY',           // Required field
  'MISSING_SL',              // Required field
  'MISSING_TP',              // Required field
  'STALE_PRICES',            // Freshness Gate (P0)
  'STALE_INTELLIGENCE',      // Freshness Gate (P0)
  'PRICE_DRIFT_EXCESSIVE',   // Freshness Gate (P0)
  'MARKET_CLOSED',           // Cannot execute
  'INVALID_SYMBOL',          // Cannot execute
  'NAN_VALUE',               // Mathematical impossibility
  'SIZING_FAILED',           // Position sizing failed
];
```

Everything else → Alpha Repair or Advisory.

## Phase 7: Trade Forensics Packet

Create `/src/services/trade-forensics-service.ts`:

```typescript
interface TradeForensicsPacket {
  trade_id: string;

  // Alpha's reasoning
  alphaThesis: string;
  alphaConfidence: number;

  // Omega votes
  omegaVotes: OmegaVote[];
  omegaConsensus: number;

  // Entry quality
  entryQualityScore: number;
  entryQualityBreakdown: object;

  // Repairs applied
  repairsAttempted: number;
  repairsSuccessful: boolean;
  violationsDetected: string[];

  // Execution
  executionSlippagePips: number;

  // Post-trade classification
  outcomeType: 'market_loss' | 'logic_failure' | 'entry_failure' | 'risk_miscalibration';
  learningPoints: string[];
}

export async function generateForensicsPacket(tradeId: string): Promise<TradeForensicsPacket> {
  // Gather all trade intelligence
  // Store in database
  // Return for Alpha learning
}
```

## Expected Outcomes

✅ No engine invents SL/TP values
✅ No silent corrections
✅ Fewer NO_TRADE outcomes (repair instead of block)
✅ Intelligent degradation ("Take what market offers")
✅ Clear user messaging
✅ Full forensics for learning
✅ System matches stated principles

## Migration Notes

- All existing auto-corrections will be replaced with repair requests
- First repair attempt uses existing alphaRevisionHandler (enhanced)
- Second repair attempt uses alpha-repair-service (new)
- If both fail, block with clear SSOT violation logging
- Monitor SSOT violations to improve Alpha's prompt over time

## Validation Tests Needed

1. Test wrong-side SL/TP → Hard block (no repair)
2. Test R:R below minimum → Repair request
3. Test goal infeasible → Degradation with user message
4. Test revision success → Trade executes with revised levels
5. Test revision failure → Block with violation logging
6. Test slippage adjustment → Explicit logging, forensics stored
7. Test confidence NOT penalized for repairs
