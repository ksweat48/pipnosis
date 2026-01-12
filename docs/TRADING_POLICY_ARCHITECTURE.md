# Trading Policy Architecture - Controlled Pipeline Refactor

**Status:** Phase 1 & 2 Complete (Policy Layer + Entry Advisor)
**Date:** January 2026
**Goal:** Remove "automation trap" blocking, add fallback loops, enable strategy flexibility

---

## Executive Summary

This architecture replaces scattered threshold gates with a unified policy layer and transforms blocking coordinators into advisory services. The system now provides Alpha with multiple strategy options instead of silent vetoes, and never stops on one failed condition.

### Key Changes

1. **Unified Trading Policy** - Single source of truth for all constraint thresholds
2. **Entry Advisor** - Provides options instead of blocking
3. **Fallback Orchestrator** - Tries multiple strategies and symbols before giving up
4. **Strategy Awareness** - Alpha explicitly chooses between pullback, continuation, breakout, or immediate entries
5. **Decision Logging** - All rejections logged with alternatives provided

---

## Architecture Overview

### Three-Tier Constraint System

#### **Tier 1: RISK HARD BLOCKS** (Catastrophic Risk Only)
These are the ONLY conditions that can stop trade execution:
- Max daily loss exceeded (4-10% by risk mode)
- Max drawdown exceeded (20% hard stop)
- Insufficient margin (<$1000 or <20% account)
- Invalid position sizing (zero, negative, or exceeds limits)
- Stale data (>5 minutes old)
- Market closed (except 24/7 markets)
- Invalid TP/SL positioning (wrong side of entry)
- Spread makes profit mathematically impossible (>50% of SL distance)

**Philosophy:** Only block when profit is physically impossible or account survival at risk.

#### **Tier 2: SOFT WARNINGS** (Advisory Only - Never Block)
These provide guidance but NEVER block execution:
- **Entry Distance:** 2.5 ATR warning, 7.0 ATR backstop
- **Spread:** 2 pips warning, 5 pips extreme
- **Risk:Reward:** 0.5-1.2 minimum (by risk mode)
- **Min Profit:** Must exceed transaction costs
- **Stop Loss Distance:** Prevent stops too tight for volatility
- **Take Profit Distance:** Ensure realistic targets

**Philosophy:** Advisory systems inform Alpha's decision but don't prevent action.

#### **Tier 3: POLICY GUIDELINES** (Alpha's Decision Framework)
These define Alpha's decision-making framework:
- **Entry Strategy Selection:** Pullback vs continuation vs breakout vs immediate
- **Urgency Phases:** How strategy preferences change over time
- **Style-Based ATR Gates:** Volatility requirements per style
- **Session Constraints:** Time-based trade management
- **Confidence Penalty Caps:** Prevent "death by 1000 cuts"
- **Safety Zone Classification:** Setup quality tiers
- **Fallback Behavior:** What to try when primary strategy fails

**Philosophy:** Policy guides intelligent behavior without creating hidden vetoes.

---

## Entry Advisor Service

**Location:** `src/services/entry-advisor.ts`

### Purpose
Replaced the blocking Entry Monitor Coordinator with an advisory service that provides options instead of vetoes.

### What It Does

**Before (Coordinator - BLOCKER):**
```typescript
if (distanceATR > 2.5) {
  throw new Error("Price too far from zone");
}
// Trade blocked, system stops
```

**After (Advisor - PROVIDER):**
```typescript
const advisory = await entryAdvisor.generateAdvisory(request);
// Returns:
// - viability: 'CONTINUATION' (not 'BLOCKED')
// - warnings: ['Price 3.2 ATR from zone - consider continuation']
// - alternativeStrategies: [
//     { strategy: 'continuation', viability: 'HIGH', ... },
//     { strategy: 'pullback', viability: 'LOW', ... }
//   ]
// - recommendedStrategy: continuation entry
// Alpha decides, not automatic block
```

### Advisory Output Structure

```typescript
interface EntryAdvisory {
  viability: 'IMMEDIATE' | 'PULLBACK' | 'CONTINUATION' | 'UNLIKELY' | 'BLOCKED';
  distanceATR: number;
  distancePips: number;
  estimatedSecondsToZone: number | null;
  warnings: EntryWarning[];              // Advisory guidance
  alternativeStrategies: EntryStrategy[]; // All options
  recommendedStrategy: EntryStrategy;     // System suggestion
  hardBlockReason: string | null;         // Only for risk hard blocks
  marketContext: {
    currentPrice: number;
    atr: number;
    spread: number;
    timeActive: number;
  };
}
```

### Key Benefits

1. **No Silent Vetoes:** Every rejection has reason + alternative
2. **Multiple Options:** Alpha sees all viable strategies
3. **Context Awareness:** Distance, time, warnings all provided
4. **Only Blocks for Risk:** Hard blocks only for catastrophic conditions
5. **Logged Decisions:** Every attempt tracked for analysis

---

## Fallback Orchestrator

**Location:** `src/services/fallback-orchestrator.ts`

### Purpose
Ensures system never stops on one failed condition. Implements cascade strategy across symbols and entry methods.

### Cascade Strategy

```
1. Try best symbol with multiple strategies:
   - Immediate (if very close)
   - Pullback (traditional)
   - Continuation (if far)
   - Breakout (if near structure)

2. If all fail, try next 2 best symbols:
   - Pullback
   - Continuation

3. If all symbols exhausted:
   - 60-second cooldown
   - Automatic rescan
   - Max 5 attempts before user notification
```

### Key Features

- **Never Dies:** System always has next move
- **Tracks Attempts:** All attempts logged to `scan_attempts` table
- **Smart Cooldown:** Brief pause between scan cycles
- **User Feedback:** Real-time updates showing progress
- **Hard Block Aware:** Stops only for risk hard blocks

### Database Tracking

```sql
CREATE TABLE scan_attempts (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL,
  symbol text NOT NULL,
  strategy text NOT NULL, -- pullback, continuation, breakout, immediate
  outcome text NOT NULL,  -- SUCCESS, REJECTED, BLOCKED
  distance_atr numeric,
  viability text,
  warnings_count integer,
  rejection_reason text,
  created_at timestamptz DEFAULT now()
);
```

---

## Entry Strategy Framework

### Four Strategy Types

#### **1. IMMEDIATE ENTRY**
- **When:** Price within 3-8 pips of zone OR <0.5 ATR distance
- **Action:** Execute now at current price
- **Ideal:** Price already in perfect position
- **Example:** "Price 1.08523 in zone 1.08510-1.08535, execute immediately"

#### **2. PULLBACK ENTRY** (Traditional)
- **When:** Price 0.5-2.5 ATR from entry zone
- **Action:** WAIT for retracement into ideal zone
- **Ideal:** Setup fresh (<15 minutes), good pullback probability
- **Example:** "Price 50 pips above zone, wait for retracement"

#### **3. CONTINUATION ENTRY** (Momentum)
- **When:** Price 2.5-7.0 ATR from zone OR setup aging (>15 min)
- **Action:** Trade into momentum at current price
- **Stop:** Wider (1.5 ATR) structure-based
- **Target:** Conservative (1.5x instead of 2x)
- **Ideal:** Strong momentum, pullback unlikely
- **Example:** "Price 3.2 ATR above zone, strong momentum, continuation at 1.08720"

#### **4. BREAKOUT ENTRY** (Structure-based)
- **When:** Price near key structure level awaiting break
- **Action:** WAIT for structure break confirmation
- **Ideal:** Clear support/resistance nearby, volume building

### Strategy Selection Logic

```typescript
function selectStrategy(distanceATR: number, minutesActive: number) {
  // Immediate if very close
  if (distanceATR < 0.5) return 'IMMEDIATE';

  // Phase A (fresh): Prefer pullback
  if (minutesActive < 15) {
    if (distanceATR <= 2.5) return 'PULLBACK';
    if (distanceATR <= 7.0) return 'CONTINUATION';
  }

  // Phase B (aging): More flexible
  if (minutesActive < 60) {
    if (distanceATR <= 2.5) return 'PULLBACK';
    if (distanceATR <= 7.0) return 'CONTINUATION';
  }

  return 'CONTINUATION';
}
```

---

## Alpha Strategy Awareness

### Updated System Prompt

Alpha now explicitly receives strategy options and must choose:

```
ENTRY STRATEGY OPTIONS (Choose Best Approach for Current Conditions)

You have FOUR entry strategies available:
1. IMMEDIATE ENTRY - Execute now (distance < 0.5 ATR)
2. PULLBACK ENTRY - Wait for retracement (0.5-2.5 ATR)
3. CONTINUATION ENTRY - Trade into momentum (2.5-7.0 ATR)
4. BREAKOUT ENTRY - Wait for structure break

DECISION FRAMEWORK FOR STRATEGY SELECTION:
- Distance < 0.5 ATR → IMMEDIATE
- Distance 0.5-2.5 ATR + Fresh (<15min) → PULLBACK
- Distance 2.5-7.0 ATR → CONTINUATION
- Distance > 7.0 ATR → Setup likely invalid
```

### Output Format

```json
{
  "action": "BUY|SELL|WAIT",
  "preferredStrategy": "immediate|pullback|continuation|breakout",
  "trade_confidence": 75,
  "entry_quality_score": 45,
  "reasoning": "Price 3.2 ATR above zone with strong momentum. Choosing CONTINUATION entry to capture move before reversal. Structure-based stop at 1.5 ATR..."
}
```

---

## Integration Points

### 1. Goal Session Live Engine

**Before:**
```typescript
// Coordinator blocks silently
if (distanceATR > 2.5) return; // Dead stop
```

**After:**
```typescript
// Generate advisory
const advisory = await entryAdvisor.generateAdvisory(request);

// Try fallback cascade
const fallbackResult = await fallbackOrchestrator.attemptTrade(
  sessionId, userId, rankedSymbols, riskMode
);

if (fallbackResult.success) {
  // Execute trade with selected strategy
} else if (fallbackResult.nextAction === 'COOLDOWN_RESCAN') {
  // Schedule 60-second cooldown and retry
} else {
  // Hard block or user notification
}
```

### 2. Entry Monitor Coordinator (Legacy)

**Status:** To be deprecated
**Replacement:** Entry Advisor + Fallback Orchestrator

The old coordinator will be gradually replaced as we integrate the new services. For now, both can coexist.

---

## File Structure

```
src/
├── config/
│   ├── trading-policy.ts              # NEW - Unified policy SSOT
│   ├── alpha-identity.ts              # UPDATED - Strategy awareness
│   ├── trade-constraints.ts           # DEPRECATED - Merge into policy
│   ├── execution-eligibility.ts       # DEPRECATED - Merge into policy
│   └── hard-block-rules.ts            # DEPRECATED - Merge into policy
│
├── services/
│   ├── entry-advisor.ts               # NEW - Advisory service
│   ├── fallback-orchestrator.ts       # NEW - Retry cascade
│   ├── continuation-entry-strategy.ts # NEW - Momentum entries
│   └── entry-monitor-coordinator.ts   # LEGACY - To be replaced
│
└── docs/
    └── TRADING_POLICY_ARCHITECTURE.md # This file
```

---

## Migration Path

### Phase 1: Policy Layer (✅ Complete)
- Created `trading-policy.ts` with three-tier system
- All thresholds consolidated from scattered files
- Clear SSOT for all constraint checks

### Phase 2: Entry Advisor (✅ Complete)
- Created `entry-advisor.ts` service
- Provides options instead of blocks
- Generates alternative strategies
- Only blocks for risk hard blocks

### Phase 3: Fallback Orchestrator (✅ Complete)
- Created `fallback-orchestrator.ts`
- Cascade strategy across symbols and methods
- Database tracking in `scan_attempts` table
- Never stops on one failure

### Phase 4: Alpha Integration (✅ Complete)
- Updated Alpha system prompt
- Added strategy awareness
- Output format includes `preferredStrategy`

### Phase 5: Goal Session Integration (⏳ Next)
- Wire fallback orchestrator into live engine
- Replace coordinator blocking logic
- Add decision logging
- Test end-to-end flow

### Phase 6: Testing & Validation (⏳ Pending)
- Test scenario: Price 5x ATR from zone
- Test scenario: All top 3 symbols fail
- Test scenario: Fallback cascade succeeds
- Verify decision logging

### Phase 7: Cleanup (⏳ Pending)
- Deprecate old constraint files
- Remove duplicate math helpers
- Document policy change process

---

## Success Metrics

### Before (Current State)
- One block kills entire scan cycle
- 2.5x ATR distance = hard stop
- No alternative strategies attempted
- System appears "shut down" after one rejection

### After (Target State)
- System tries 3 strategies on best symbol
- Then tries 2 strategies on next 2 symbols
- Then 60-second cooldown and rescan
- Only stops for risk hard blocks (margin, max loss, etc.)
- All rejections logged with alternatives provided
- Alpha explicitly chooses strategy with full context

### Measurable Outcomes
- **Scan continuation rate:** >95% (only stops for user pause or risk blocks)
- **Strategy attempts per cycle:** 3-7 (multiple options tried)
- **Trade execution rate:** +40% (more opportunities captured)
- **False stops:** <5% (blocks only for real risk issues)

---

## Policy Change Guide

### How to Adjust Soft Warning Thresholds

All thresholds are in `src/config/trading-policy.ts`:

```typescript
// Example: Change entry distance warning threshold
export const SOFT_WARNINGS = {
  entryDistance: {
    softWarning: 2.5,    // Change this
    advisory: 4.0,       // Or this
    hardBackstop: 7.0    // Or this
  }
}
```

**No code changes required.** All services reference this file.

### How to Add New Risk Hard Block

1. Add condition to `RISK_HARD_BLOCKS` in `trading-policy.ts`
2. Implement check in `entry-advisor.ts` → `checkHardBlocks()`
3. Add to `isRiskHardBlock()` helper

### How to Modify Fallback Behavior

```typescript
// In trading-policy.ts
export const POLICY_GUIDELINES = {
  fallbackBehavior: {
    maxSymbolsToTry: 3,           // Try 3 symbols
    strategiesPerSymbol: ['pullback', 'continuation'],
    cooldownSeconds: 60,          // 60-second pause
    maxScanAttempts: 5            // 5 retries max
  }
}
```

---

## Troubleshooting

### "System stopped scanning after one rejection"
- **Check:** Entry Advisor returning 'BLOCKED' viability
- **Solution:** Review `checkHardBlocks()` logic - ensure only catastrophic conditions block

### "No alternative strategies provided"
- **Check:** `generateStrategyOptions()` in Entry Advisor
- **Solution:** Verify distance thresholds and viability calculations

### "Fallback orchestrator not trying next symbol"
- **Check:** `attemptTrade()` loop logic
- **Solution:** Verify `rankedSymbols` array has multiple entries

### "Decision not logged to database"
- **Check:** `scan_attempts` table and RLS policies
- **Solution:** Ensure service role can insert, user can read own attempts

---

## Next Steps

1. **Integrate Fallback Orchestrator** into `goal-session-live-engine.ts`
2. **Wire Entry Advisor** into scan flow (replace coordinator calls)
3. **Add Decision UI** showing strategy attempts and outcomes
4. **Test End-to-End** with real scenarios
5. **Document Results** and refine thresholds based on data

---

## Key Principles (Never Forget)

1. **Provide Options, Not Vetoes** - Advisory systems guide, don't block
2. **Never Stop on One Failure** - Always have next move
3. **Log Every Decision** - Transparency enables learning
4. **Policy Over Code** - Change thresholds in config, not scattered logic
5. **Alpha Decides** - System provides context, Alpha chooses action

---

**End of Document**
