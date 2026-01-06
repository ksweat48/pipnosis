# Omega-9 Constraint Architecture Refactor

**Date:** January 6, 2026
**Status:** ✅ COMPLETE
**Impact:** High - Changes fundamental decision authority in trading system

---

## 🎯 Problem Statement

### The Original Issue (NAS100 Example)

**Scenario:**
- Symbol: NAS100 @ $25,491
- Alpha proposed: 10 pip stop loss
- Omega-9 blocked the trade

**The Diagnosis Was CORRECT:**
- 10 pips on NAS100 = $254.91 distance
- As percentage of price: 0.039%
- This is effectively **statistical noise**
- The stop would be hit by normal spread + volatility before the trade thesis could play out

**But The Solution Was WRONG:**
- Omega-9 was using **hard veto power** before Alpha could respond
- This violated the core architectural principle: **Alpha has final authority**
- The system was becoming "no trades ever" under different names

---

## 🏗️ Architectural Principle

### The Correct Model

```
┌─────────────────────────────────────────────┐
│  Omega-9: Constraint Generator              │
│  - Defines feasibility bounds               │
│  - Calculates noise floors                  │
│  - Reports violations                       │
│  - Does NOT veto (except catastrophic)      │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│  Alpha: Decision Engine                     │
│  - Receives constraints                     │
│  - Chooses response:                        │
│    • Adjust stop/TP                         │
│    • Switch style (SCALP → INTRADAY)        │
│    • Reduce position size                   │
│    • Accept smaller profit                  │
│    • WAIT for better setup                  │
│    • NO_TRADE                               │
└─────────────────────────────────────────────┘
```

**Key Insight:**
> If Alpha wants $180 but the market can only give $60 — **take the $60**.
> Omega-9 should provide the constraints, not block the decision.

---

## ✅ What Was Implemented

### 1. **Noise Floor Calculation** (`risk-aware-stop-calculator.ts`)

Added context-aware minimum stops to prevent microscopic stops:

```typescript
calculateNoiseFloor(symbol: string, entryPrice: number, atr: number): {
  noiseFloorPips: number;
  reasoning: string;
}
```

**Method:**
Uses **TWO calculations** and takes the **LARGER** (more conservative):

1. **Percentage of Price** (asset-class specific):
   - INDEX (NAS100): 0.15% minimum → 38 pips @ $25,491
   - CRYPTO (BTC): 0.20% minimum → $180 @ $90,000
   - GOLD (XAU): 0.20% minimum → $5.20 @ $2,600
   - FOREX: 0.05% minimum → 5 pips @ 1.0000

2. **ATR Multiplier** (volatility-based):
   - 1.25x ATR minimum
   - Prevents stops inside volatility noise

**Result:**
```
NAS100 @ $25,491:
- Percent floor: 38 pips (0.15% of price)
- ATR floor: 28 pips (1.25x ATR)
- Noise floor: 38 pips ← LARGER (controlling)
```

---

### 2. **Enhanced Omega-9 Constraints** (`omega9-constraint-provider.ts`)

Added noise floor to constraint output:

```typescript
export interface Omega9Constraints {
  // Stop-Loss Constraints
  minStopLossPips: number;        // Now enforces noise floor
  maxStopLossPips: number;
  recommendedStopLossPips: number;

  // NEW: Noise Floor (statistical minimum)
  noiseFloorPips: number;
  noiseFloorReasoning: string;

  // Take-Profit Constraints
  minTakeProfitPips: number;
  maxTakeProfitPips: number;
  // ...
}
```

**Integration:**
```typescript
const noiseFloor = riskAwareStopCalculator.calculateNoiseFloor(symbol, entry, atr);

const constraints: Omega9Constraints = {
  minStopLossPips: Math.max(profileMinPips, noiseFloor.noiseFloorPips),
  noiseFloorPips: noiseFloor.noiseFloorPips,
  noiseFloorReasoning: noiseFloor.reasoning,
  // ...
};
```

---

### 3. **Downgraded Omega-9 Validation** (`omega9-hallucination-brain.ts`)

**Changed from:** Hard-blocking judge
**Changed to:** Constraint violation reporter

#### Only 2 Hard-Block Conditions Remain:

1. **Stop Inside Spread:**
   ```typescript
   if (slDistancePips < spreadPips * 1.5) {
     return HARD_BLOCK; // Literally impossible to hit
   }
   ```

2. **R:R < 0.5 (Catastrophic):**
   ```typescript
   if (rr < 0.5) {
     return HARD_BLOCK; // Mathematically terrible
   }
   ```

#### Everything Else = Constraint Violation (not block):

```typescript
// OLD: Hard-blocked if stop < minimum
if (slDistancePips < minStopLossPips) {
  return HARD_BLOCK;
}

// NEW: Reports violation, Alpha decides
if (slDistancePips < noiseFloorPips) {
  constraintViolations.push({
    type: 'STOP_BELOW_NOISE_FLOOR',
    severity: 'WARNING',
    currentValue: slDistancePips,
    minimumValue: noiseFloorPips,
    suggestedActions: [
      'Increase stop to ${noiseFloorPips} pips',
      'Switch from SCALP to INTRADAY style',
      'Reduce position size',
      'Accept smaller TP',
      'Wait for better setup'
    ]
  });

  return { pass: true, constraintViolations }; // NOT blocking
}
```

---

### 4. **Updated Types** (`types/omega.ts`, `types/omega9-constraints.ts`)

Added constraint violation reporting:

```typescript
export interface Omega9ValidationResult {
  pass: boolean;
  flags: string[];
  confidence_adjustment: number;
  corrections: Omega9Corrections;
  reasoning: string;
  safety_zone?: SafetyZone;
  safety_evaluation?: SafetyEvaluation;
  constraintViolations?: Omega9ConstraintViolation[]; // NEW
}

export interface Omega9ConstraintViolation {
  type:
    | 'STOP_BELOW_NOISE_FLOOR'
    | 'STOP_INSIDE_SPREAD'
    | 'RR_CATASTROPHIC'
    | 'MATHEMATICAL_ERROR';
  severity: 'WARNING' | 'HARD_BLOCK';
  currentValue: number;
  minimumValue?: number;
  message: string;
  suggestedActions: string[];
}
```

---

## 🔄 How It Works Now

### NAS100 Scenario (Revised)

**Setup:**
- NAS100 @ $25,491
- Alpha proposes: 10 pip stop
- Noise floor: 38 pips

**Flow:**

1. **Omega-9 Constraint Provider:**
   ```
   ⚠️ Noise floor calculation:
   - Percent method: 38 pips (0.15% of $25,491)
   - ATR method: 28 pips (1.25x ATR)
   - Controlling: 38 pips (percent-based)
   ```

2. **Omega-9 Validation:**
   ```
   ⚠️ Constraint violation detected:
   Type: STOP_BELOW_NOISE_FLOOR
   Current: 10 pips
   Minimum: 38 pips
   Severity: WARNING (not HARD_BLOCK)
   ```

3. **Alpha Revision Handler:**
   ```
   📋 Constraint violation report sent to Alpha:

   "Your 10 pip stop is below the noise floor (38 pips).

   OPTIONS:
   1. Increase stop to 38 pips (reduces R:R to 0.4:1)
   2. Switch from SCALP to INTRADAY style
   3. Reduce position size to compensate
   4. Accept smaller TP (15 pips given session time)
   5. WAIT for better setup
   6. NO_TRADE

   YOU DECIDE."
   ```

4. **Alpha Decides:**
   - Alpha can **adjust** (widen stop, reduce TP, switch style)
   - Alpha can **accept** reduced expectations
   - Alpha can **wait** or **NO_TRADE**
   - Alpha maintains **final authority**

---

## 🎨 Constraint-First Prompt to Alpha

Alpha now receives constraints BEFORE making the decision:

```
🎯 OMEGA-9 TRADING CONSTRAINTS (Your Operating Boundaries)

STOP-LOSS BOUNDARIES:
• Noise Floor: 38.0 pips (INDEX noise floor: 38.0 pips (price-based: 0.15% of price = 38.0 pips OR 1.25x ATR[H1] = 28.0 pips, whichever larger))
• Minimum: 38.0 pips (max of profile floor and noise floor)
• Maximum: 120.0 pips (risk profile ceiling)
• Recommended: 55.0 pips

YOUR AUTHORITY:
✅ You may choose ANY SL within min-max range
✅ You may choose ANY TP within min-max range
✅ You may override recommendations with reasoning
✅ You may tighten or widen based on structure

WHAT HAPPENS IF YOU VIOLATE:
• R:R < 1.0 → Auto-corrected to minimum (confidence penalty)
• TP > maximum → Auto-corrected to maximum (moderate penalty)
• SL below noise floor → WARNING reported (your choice to adjust)
```

---

## 📊 Comparison: Old vs New

| Aspect | Old (Hard Veto) | New (Constraint Generator) |
|--------|-----------------|----------------------------|
| **Omega-9 Role** | Judge & blocker | Constraint generator |
| **Alpha Role** | Proposal engine | Decision engine |
| **NAS100 10 pip stop** | Hard-blocked immediately | Reports violation, Alpha decides |
| **Noise floor** | Fixed 10 pips (all symbols) | Context-aware (38 pips NAS100) |
| **Adaptability** | "No trades ever" spiral | Alpha can adjust & learn |
| **Hard blocks** | 10+ conditions | Only 2 (spread, R:R < 0.5) |

---

## 🛡️ Safety Preserved

### Hard-Block Conditions (Only 2)

1. **Stop Inside Spread:**
   - Stop < spread × 1.5
   - **Mathematically impossible** to hit
   - Example: 1 pip stop with 2 pip spread

2. **R:R < 0.5:**
   - Risk > 2x reward
   - **Catastrophically poor** trade setup
   - Example: 20 pip stop for 8 pip profit

### Everything Else = Alpha Authority

- Stop below noise floor → **WARNING** (Alpha adjusts)
- R:R < 1.0 → **AUTO-CORRECTED** (if Alpha doesn't revise)
- TP beyond session time → **ADVISORY** (Alpha justifies)
- Suboptimal structure → **ADVISORY** (Alpha overrides)

---

## 📈 Benefits

### 1. **Alpha Learns & Adapts**
- No longer blocked before getting chance to adjust
- Can accept reduced expectations (smaller TP, wider SL)
- Learns from constraint violations vs just hitting blocks

### 2. **Trade Frequency Maintained**
- Fewer "no trades ever" scenarios
- Alpha can trade in imperfect conditions
- System adapts to market opportunities

### 3. **Context-Aware Minimums**
- NAS100: 38 pips minimum (not 10)
- EURUSD: 5 pips minimum (not 38)
- BTC: $180 minimum (not $20)
- Each asset class has appropriate floor

### 4. **Architectural Clarity**
- Omega-9 = Constraint generator (boundaries)
- Alpha = Decision engine (optimizes within boundaries)
- Clear separation of concerns

---

## 🚀 Examples

### Example 1: NAS100 Scalp (After Fix)

**Alpha Initial Decision:**
- Direction: BUY
- Entry: 25,491
- Stop: 25,481 (10 pips)
- TP: 25,511 (20 pips)
- R:R: 2:1

**Omega-9 Response:**
```
⚠️ Constraint violation:
Stop 10 pips < Noise floor 38 pips

Suggested actions:
1. Increase stop to 38 pips → R:R becomes 0.53:1
2. Switch to INTRADAY style (wider stops acceptable)
3. Reduce position size by 75% to maintain dollar risk
4. WAIT for better setup
```

**Alpha Revision:**
```
✅ Revised decision:
- Direction: BUY
- Entry: 25,491
- Stop: 25,453 (38 pips) ← Widened to noise floor
- TP: 25,548 (57 pips) ← Increased to maintain 1.5:1 R:R
- R:R: 1.5:1
- Confidence: 75% (-5% for constraint violation)
- Reasoning: "Widened stop to survive noise floor, maintained professional R:R"
```

---

### Example 2: EURUSD in Dead Zone

**Alpha Initial Decision:**
- Direction: SELL
- Entry: 1.0500
- Stop: 1.0515 (15 pips)
- TP: 1.0470 (30 pips)
- R:R: 2:1

**Omega-9 Response:**
```
✅ No constraint violations
Noise floor: 5.0 pips (FOREX minimum)
Stop: 15.0 pips > 5.0 pips ✓
R:R: 2.0:1 > 1.0:1 ✓

⚡ YELLOW ZONE: Suboptimal conditions (dead zone)
Advisory: Consider waiting for London open
```

**Alpha Decision:**
```
✅ Proceed with caution
Confidence: 68% (-5% yellow zone penalty)
Reasoning: "Setup valid despite dead zone, R:R justifies execution"
```

---

## 📝 Files Modified

1. **`src/types/omega9-constraints.ts`**
   - Added `noiseFloorPips` and `noiseFloorReasoning`
   - Enhanced `ConstraintViolation` with `currentValue`, `minimumValue`, `suggestedActions`

2. **`src/types/omega.ts`**
   - Added `Omega9ConstraintViolation` interface
   - Added `constraintViolations` to `Omega9ValidationResult`

3. **`src/services/risk-aware-stop-calculator.ts`**
   - Added `calculateNoiseFloor()` method
   - Uses percentage-of-price AND ATR multiplier (takes larger)
   - Asset-class specific percentages

4. **`src/services/omega9-constraint-provider.ts`**
   - Calls `calculateNoiseFloor()` during constraint generation
   - Enforces noise floor in `minStopLossPips`
   - Includes noise floor in prompt to Alpha

5. **`src/brains/omega9-hallucination-brain.ts`**
   - Added `estimateSpread()` helper
   - Downgraded validation from hard-block to constraint reporting
   - Only 2 hard-block conditions remain
   - Returns constraint violations for Alpha to handle

---

## ✅ Testing & Validation

### Build Status
✅ **Build completed successfully** (no TypeScript errors)

### Expected Behavior

**Before:**
```
NAS100 @ $25,491, 10 pip stop
→ Omega-9: HARD BLOCK
→ Result: NO_TRADE
```

**After:**
```
NAS100 @ $25,491, 10 pip stop
→ Omega-9: Constraint violation (10 < 38 pips)
→ Alpha: Revise to 38 pips or switch style
→ Result: Adjusted trade OR NO_TRADE (Alpha decides)
```

---

## 🎓 Philosophy

### The Core Principle

> **"If the user wants $180 but the market can only give $60 — take the $60."**

This refactor embodies this principle:

1. **Omega-9 defines constraints** (the market can only give $60)
2. **Alpha adapts** (adjusts expectations, accepts $60)
3. **Trade executes** (system doesn't rigidly block)

### The Right Question

Not: *"Should this trade be blocked?"*
But: *"What must Alpha adjust to make this trade viable?"*

---

## 🏁 Conclusion

This refactor fundamentally shifts the architecture from:

**❌ Omega-9 as Judge** → **✅ Omega-9 as Constraint Generator**

The system now:
- Maintains safety (hard-blocks catastrophic errors)
- Preserves Alpha's authority (final decision power)
- Enables adaptation (Alpha adjusts to constraints)
- Prevents "no trades ever" spiral (constraint-aware flexibility)

**Status:** ✅ Architecture refactor complete and building successfully.
