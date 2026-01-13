# Critical LLM Output Errors - Root Cause Analysis

**Date:** January 2026
**Status:** CRITICAL - Production Issues Identified
**Impact:** WAIT decisions convert to NO_TRADE, SELL trades have inverted TP

---

## Executive Summary

Two critical LLM output errors are causing Alpha to make invalid decisions:

1. **Missing `wait_condition`** → Valid WAIT decisions convert to NO_TRADE with 0% confidence
2. **TP Direction Mismatch** → SELL trades have TP above entry instead of below (instant loss)

Both issues stem from Alpha's LLM response not matching the expected output format.

---

## Issue 1: Missing `wait_condition` Fields

### Error Manifestation

```
[Alpha Coordinator] WAIT action missing required wait_condition fields
parseDecision @ watchlist-DeUSK199.js:707
Decision: NO_TRADE
Confidence: 0
Reasoning: WAIT decision malformed - missing target zones
```

### Root Cause

**Location:** `src/brains/coordinator-alpha.ts:2467-2486`

```typescript
// If WAIT, return with wait_condition
if (action === 'WAIT') {
  const waitCondition = parsed.wait_condition;

  if (!waitCondition || !waitCondition.target_entry_zone_min ||
      !waitCondition.target_entry_zone_max || !waitCondition.invalidation_price) {
    console.error('[Alpha Coordinator] WAIT action missing required wait_condition fields');
    return {
      action: 'NO_TRADE',
      decision: 'NO_TRADE',
      entry: currentPrice,
      stopLoss: currentPrice,
      takeProfit: currentPrice,
      confidence: 0,
      reasoning: 'WAIT decision malformed - missing target zones',
      // ...
    };
  }
}
```

**Required Fields:**
- `wait_condition.target_entry_zone_min` (number)
- `wait_condition.target_entry_zone_max` (number)
- `wait_condition.invalidation_price` (number)
- `wait_condition.wait_reasoning` (string - optional but expected)

**What's Happening:**
1. Alpha returns `{ "action": "WAIT", ... }`
2. Parser checks for `parsed.wait_condition` object
3. If wait_condition is missing OR any required field is missing/null → Convert to NO_TRADE with 0% confidence
4. Valid WAIT decision is lost

**Possible Causes:**
- LLM is not returning `wait_condition` object at all
- LLM is returning incomplete `wait_condition` (missing fields)
- JSON parsing issue (wait_condition gets lost during extraction)
- Prompt not clear enough about required format

---

## Issue 2: TP Direction Mismatch for SELL Trades

### Error Manifestation

```
[ENTRY_MONITOR_COORD] CRITICAL: TP direction mismatch
symbol: 'ETHUSD'
direction: 'SELL'
entryPrice: '3090.00000'
takeProfit: '3092.18500'  // WRONG - above entry for SELL
stopLoss: '3120.00000'     // CORRECT - above entry for SELL
issue: SELL trade has TP above entry - will lose money instantly!
```

### Root Cause

**Location:** `src/brains/coordinator-alpha.ts:2509-2553`

```typescript
// Get LLM values
let entry = parsed.entry || currentPrice;
let stopLoss = parsed.stopLoss;
let takeProfit = parsed.takeProfit;  // <-- Directly from LLM
const isBuy = action === 'BUY';

// ...

// 2. Check if TP is on WRONG SIDE of entry
if (takeProfit) {
  const tpOnWrongSide = (isBuy && takeProfit < entry) || (!isBuy && takeProfit > entry);
  if (tpOnWrongSide) {
    errorReason = `TP on WRONG SIDE of entry (${action}: TP ${takeProfit} vs Entry ${entry})`;
    catastrophicError = true;
  }
}
```

**Expected Behavior:**
- **BUY trades:** TP must be ABOVE entry, SL must be BELOW entry
- **SELL trades:** TP must be BELOW entry, SL must be ABOVE entry

**Actual Behavior (from logs):**
- Entry: 3090.00000
- TP: 3092.18500 (ABOVE entry - WRONG!)
- SL: 3120.00000 (ABOVE entry - CORRECT)
- **Current Price: 3092.18500**

**What's Happening:**
Alpha is returning **CURRENT PRICE** (3092.18500) as `takeProfit` instead of calculating the actual profit target below entry (~3060).

**Why This Is Critical:**
- SELL at 3090, TP at 3092 = instant 2.5 pip loss
- Price needs to move UP to hit TP, but SELL profits from DOWN movement
- Trade is mathematically invalid - will hit SL or lose money

**Possible Causes:**
1. **LLM Hallucination:** Alpha is confusing current price with target price
2. **Calculation Error:** Alpha is not calculating TP correctly for SELL direction
3. **Prompt Ambiguity:** Prompt doesn't clearly specify TP calculation methodology
4. **Context Confusion:** Alpha sees current price and uses it as reference instead of calculating offset

---

## Prompt Analysis

**Current Prompt Instructions:**

```
POSITIONING RULES:
BUY: SL below entry, TP above | SELL: SL above entry, TP below

Return JSON with structured reasoning:
{
  "action": "BUY|SELL|WAIT",
  "entry": price,
  "stopLoss": price,
  "takeProfit": price,
  "trade_confidence": 0-100,
  "entry_quality_score": 0-100,
  "entry_mode": "immediate|wait_pullback|wait_confirmation",
  "style": "SCALP|MICRO_INTRADAY|INTRADAY",
  "reasoning": "Brief professional reasoning (1-2 sentences)",
  "market_narrative": "Single-sentence cause-effect thesis (REQUIRED for BUY/SELL)",
  "wait_condition": {
    "target_entry_zone_min": price,
    "target_entry_zone_max": price,
    "invalidation_price": price,
    "wait_reasoning": "what you're waiting for"
  },
  ...
}

When choosing WAIT, specify:
• Target entry zone (min/max prices)
• Invalidation price (where setup becomes invalid)
• Wait reasoning (what you're waiting for)
```

**Issues with Current Prompt:**
1. **wait_condition is nested** - LLM may not generate nested objects consistently
2. **WAIT instructions are separate** - Not integrated into main format example
3. **TP calculation not explicit** - Just says "TP above/below" but doesn't explain HOW to calculate
4. **No validation examples** - No examples showing correct vs incorrect output

---

## Recommended Fixes

### Fix 1: Strengthen `wait_condition` Validation

**Option A: Defensive Parsing (Quick Fix)**

Add fallback logic to construct wait_condition from other fields if missing:

```typescript
// If WAIT, return with wait_condition
if (action === 'WAIT') {
  let waitCondition = parsed.wait_condition;

  // FALLBACK: Try to construct from top-level fields
  if (!waitCondition) {
    waitCondition = {
      target_entry_zone_min: parsed.target_entry_zone_min || parsed.entry - atr * 0.3,
      target_entry_zone_max: parsed.target_entry_zone_max || parsed.entry + atr * 0.3,
      invalidation_price: parsed.invalidation_price || parsed.stopLoss || (isBuy ? currentPrice - atr * 2 : currentPrice + atr * 2),
      wait_reasoning: parsed.reasoning || 'Waiting for better entry conditions'
    };
    console.warn('[Alpha Coordinator] ⚠️ wait_condition missing - constructed fallback');
  }

  // Validate required fields (with fallbacks)
  if (!waitCondition.target_entry_zone_min || !waitCondition.target_entry_zone_max || !waitCondition.invalidation_price) {
    console.error('[Alpha Coordinator] WAIT action missing required wait_condition fields even after fallback');
    console.error('[Alpha Coordinator] Parsed response:', JSON.stringify(parsed, null, 2));
    return {
      action: 'NO_TRADE',
      decision: 'NO_TRADE',
      entry: currentPrice,
      stopLoss: currentPrice,
      takeProfit: currentPrice,
      confidence: 0,
      reasoning: 'WAIT decision malformed - missing target zones',
      omega_summary: '',
      resolvedStyle
    };
  }

  // Continue with valid wait_condition...
}
```

**Option B: Improve Prompt (Proper Fix)**

Update prompt to make wait_condition required and provide clear examples:

```typescript
// In Alpha system prompt:

CRITICAL OUTPUT FORMAT:

If action = "WAIT":
{
  "action": "WAIT",
  "entry": 0,  // Not used for WAIT
  "stopLoss": 0,  // Not used for WAIT
  "takeProfit": 0,  // Not used for WAIT
  "trade_confidence": 70,
  "entry_quality_score": 0,
  "entry_mode": "wait_pullback",
  "style": "MICRO_INTRADAY",
  "reasoning": "Price 20 pips above VWAP, waiting for pullback",
  "market_narrative": "",  // Not required for WAIT
  "wait_condition": {  // ⚠️ REQUIRED FOR WAIT
    "target_entry_zone_min": 3070.00,  // Lower bound of desired entry zone
    "target_entry_zone_max": 3075.00,  // Upper bound of desired entry zone
    "invalidation_price": 3100.00,     // Price where setup becomes invalid
    "wait_reasoning": "Waiting for retracement to VWAP support zone"
  }
}

EXAMPLE WAIT RESPONSE:
Current price: 1.0890
Bias: BUY
Wait for pullback to 1.0850-1.0870

Correct JSON:
{
  "action": "WAIT",
  "entry": 0,
  "stopLoss": 0,
  "takeProfit": 0,
  "trade_confidence": 75,
  "entry_quality_score": 0,
  "entry_mode": "wait_pullback",
  "style": "MICRO_INTRADAY",
  "reasoning": "BUY bias confirmed, but price 20 pips above VWAP. WAIT for pullback to support.",
  "market_narrative": "",
  "wait_condition": {
    "target_entry_zone_min": 1.08500,
    "target_entry_zone_max": 1.08700,
    "invalidation_price": 1.08200,
    "wait_reasoning": "Waiting for pullback to VWAP support zone (1.0850-1.0870)"
  }
}
```

### Fix 2: Enforce Correct TP Calculation

**Option A: Add TP Calculation Instructions (Prompt Fix)**

```typescript
// In Alpha system prompt:

TP CALCULATION RULES (CRITICAL):

For BUY trades:
- Entry = desired entry price
- SL = entry - (ATR × stop_distance_multiplier)  // BELOW entry
- TP = entry + (ATR × target_distance_multiplier)  // ABOVE entry

For SELL trades:
- Entry = desired entry price
- SL = entry + (ATR × stop_distance_multiplier)  // ABOVE entry
- TP = entry - (ATR × target_distance_multiplier)  // BELOW entry

EXAMPLE SELL CALCULATION:
Current Price: 3092.18
Entry: 3090.00 (sell at current resistance)
ATR: 10.00
Stop Multiplier: 3.0
Target Multiplier: 2.0

Calculation:
- SL = 3090.00 + (10.00 × 3.0) = 3120.00 ✅ (ABOVE entry)
- TP = 3090.00 - (10.00 × 2.0) = 3070.00 ✅ (BELOW entry)

CRITICAL: For SELL, TP must be LOWER number than entry!

❌ WRONG: { "action": "SELL", "entry": 3090.00, "takeProfit": 3092.18 }
✅ CORRECT: { "action": "SELL", "entry": 3090.00, "takeProfit": 3070.00 }
```

**Option B: Post-LLM Validation & Auto-Correction (Code Fix)**

Add automatic correction if TP is on wrong side:

```typescript
// After getting LLM values
let entry = parsed.entry || currentPrice;
let stopLoss = parsed.stopLoss;
let takeProfit = parsed.takeProfit;
const isBuy = action === 'BUY';

// NEW: Auto-correct TP if on wrong side
if (takeProfit) {
  const tpOnWrongSide = (isBuy && takeProfit < entry) || (!isBuy && takeProfit > entry);
  if (tpOnWrongSide) {
    console.warn(`[Alpha Coordinator] ⚠️ TP on WRONG SIDE - auto-correcting`);
    console.warn(`[Alpha Coordinator] Original: ${action} Entry=${entry} TP=${takeProfit}`);

    // Calculate correct TP based on SL distance
    const slDistance = Math.abs(entry - stopLoss);
    const rrRatio = 1.5; // Default R:R for correction

    if (isBuy) {
      takeProfit = entry + (slDistance * rrRatio); // TP above entry
    } else {
      takeProfit = entry - (slDistance * rrRatio); // TP below entry
    }

    console.warn(`[Alpha Coordinator] Corrected: ${action} Entry=${entry} TP=${takeProfit} (R:R ${rrRatio}:1)`);
    console.warn(`[Alpha Coordinator] Applied -15% confidence penalty for LLM error`);

    // Don't block, but apply heavy confidence penalty
    adjustedConfidence = Math.max(0, adjustedConfidence - 15);
  }
}
```

**Option C: Hard Block (Nuclear Option)**

Current implementation already blocks with catastrophic error. This is the safest but loses valid setups.

---

## Implementation Priority

### Phase 1: Immediate Defensive Fixes (Today)
1. ✅ Add wait_condition fallback construction
2. ✅ Add TP auto-correction for wrong-side positioning
3. ✅ Add detailed logging of LLM raw responses when errors occur

### Phase 2: Prompt Improvements (This Week)
1. ✅ Add explicit TP calculation instructions with examples
2. ✅ Add WAIT response examples with complete wait_condition
3. ✅ Add validation examples (correct vs incorrect)

### Phase 3: Monitoring & Analysis (Ongoing)
1. ✅ Track frequency of wait_condition errors
2. ✅ Track frequency of TP direction errors
3. ✅ Log raw LLM responses for failed parses
4. ✅ Identify patterns in LLM failures

---

## Testing Checklist

### Test 1: WAIT Decision with Missing wait_condition
- **Input:** LLM returns `{ "action": "WAIT" }` without wait_condition
- **Expected:** Fallback constructs wait_condition from other fields OR converts to NO_TRADE with clear error
- **Verify:** No silent failures, clear logging

### Test 2: SELL Trade with TP Above Entry
- **Input:** LLM returns `{ "action": "SELL", "entry": 3090, "takeProfit": 3092 }`
- **Expected:** Auto-correction flips TP to below entry OR blocks with clear error
- **Verify:** Trade doesn't execute with invalid TP

### Test 3: Valid WAIT Decision
- **Input:** LLM returns complete wait_condition
- **Expected:** WAIT decision preserved with all fields
- **Verify:** No false positives

### Test 4: Valid SELL Trade
- **Input:** LLM returns `{ "action": "SELL", "entry": 3090, "takeProfit": 3070, "stopLoss": 3120 }`
- **Expected:** Trade passes validation, no corrections
- **Verify:** Valid trades not affected

---

## Metrics to Track

**Before Fix:**
- WAIT → NO_TRADE conversion rate: ???% (unknown)
- TP direction mismatch rate: ???% (unknown)

**After Fix (Target):**
- WAIT → NO_TRADE conversion rate: <5% (only genuine malformed responses)
- TP direction mismatch rate: 0% (auto-corrected or blocked)
- LLM output quality: >95% valid format

---

## Root Cause Summary

**Issue 1 (Missing wait_condition):**
- **Immediate Cause:** LLM not returning wait_condition object or returning incomplete object
- **Root Cause:** Prompt format shows wait_condition nested but doesn't emphasize requirement
- **Solution:** Add fallback logic + improve prompt with explicit examples

**Issue 2 (TP Direction Mismatch):**
- **Immediate Cause:** LLM returning current price as TP instead of calculating target
- **Root Cause:** Prompt doesn't explain TP calculation methodology, only positioning rules
- **Solution:** Add explicit TP calculation formulas + auto-correction for wrong-side TP

---

**End of Analysis**
