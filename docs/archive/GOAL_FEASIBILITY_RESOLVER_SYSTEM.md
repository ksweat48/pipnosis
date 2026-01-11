# Goal Feasibility Resolver System

**Status:** ✅ Implemented (January 5, 2026)

## Core Philosophy

> **"If the market can offer something MEANINGFUL, adapt and trade.
> If it can only offer NOISE, wait — don't churn."**

**Critical Distinction:** "Possible" ≠ "Worth Trading"

This system prevents the platform from becoming an overactive "take crumbs" engine in dead markets while still adapting intelligently when markets can deliver reasonable opportunities.

---

## The Problem This Solves

### Before This System
- **Binary Decision:** Execute or block entirely
- **Bad UX:** User sets $171 goal → System blocks with "impossible"
- **Missed Opportunities:** Market could deliver $106 safely, but we rejected it
- **Alternative Problem:** Silently cheating constraints → Trust erosion

### After This System
- **Three-Tier Response:** Execute / Wait / Block
- **Transparent Adaptation:** "Market can deliver 62% of goal ($106)"
- **Meaningful Trade Gates:** Only execute if opportunity passes quality thresholds
- **Alpha Authority:** System proposes, Alpha decides

---

## System Architecture

### Decision Flow

```
User Goal Request
    ↓
Goal Feasibility Resolver
    ├─ Calculate what market CAN deliver (70% ATR safety)
    ├─ Check if it's MEANINGFUL (4 threshold system)
    └─ Propose downshift with full transparency
    ↓
Alpha Re-Confirmation
    ├─ Receive downshift proposal
    ├─ Evaluate strategic value
    └─ Decide: AFFIRM / WAIT / REJECT
    ↓
Execution Eligibility Gate
    └─ Validate physics if AFFIRM
    ↓
Execute Trade
```

### Key Modules

1. **Goal Feasibility Resolver** (`goal-feasibility-resolver.ts`)
   - Calculates deliverable profit based on current market volatility
   - Checks meaningfulness against 4 thresholds
   - Generates downshift proposals

2. **Meaningful Trade Calculator** (`meaningful-trade-calculator.ts`)
   - Computes threshold values (volatility, account, spread, historical)
   - Validates trade meaningfulness
   - Provides detailed explanations

3. **Alpha Downshift Evaluator** (`alpha-downshift-evaluator.ts`)
   - LLM-powered strategic evaluation
   - Receives full proposal context
   - Makes final AFFIRM/WAIT/REJECT decision

4. **Goal Feasibility Card** (`GoalFeasibilityCard.tsx`)
   - Transparent UI display
   - Shows original vs adjusted goals
   - Displays all meaningfulness checks
   - Explains Alpha's reasoning

---

## Meaningful Trade Thresholds

A trade is considered "meaningful" if it meets **at least ONE** of these criteria:

### 1. Volatility-Relative Floor (15%)
```typescript
expectedProfit >= (dailyATR * accountBalance * 0.15)
```
Trade must capture at least 15% of typical daily movement opportunity.

### 2. Account-Relative Floor (0.15%)
```typescript
expectedProfit >= (accountBalance * 0.0015)
```
Trade must be at least 0.15% of account balance.
- $500 account = $0.75 minimum
- $5,000 account = $7.50 minimum
- $10,000 account = $15 minimum

### 3. Spread-Adjusted Floor (3x)
```typescript
expectedProfit >= (spreadCost * 3.0)
```
Trade must deliver at least 3x the spread cost (raised from 2x for downshifted trades).

### 4. Historical Performance Floor (25%)
```typescript
expectedProfit >= (user30DayAvgWin * 0.25)
```
Trade must be at least 25% of user's typical winning trade. Prevents "taking crumbs" below historical signal quality.

**Action:** If NO thresholds are met → **WAIT_FOR_VOLATILITY** instead of executing.

---

## Three-Tier Response System

### Tier 1: EXECUTE (After Downshift + Alpha Confirmation)
**When:**
- Market can deliver ≥20% of original goal
- Adjusted profit meets meaningful trade thresholds
- Alpha affirms the adjusted plan

**Result:** Trade executes with adjusted target

### Tier 2: WAIT_FOR_VOLATILITY
**When:**
- Market could deliver with 2x current ATR
- Session is suboptimal (Asian hours, low liquidity)
- Adjusted profit below meaningful thresholds
- Too many recent trades (churn prevention)

**Result:** No execution. User sees: "Current market too quiet. Waiting for better opportunity."

### Tier 3: BLOCK_WITH_ALTERNATIVES
**When:**
- Goal exceeds 30% of account (growth mode)
- No foreseeable market state could satisfy goal safely
- Market retention <20% even with adjustments

**Result:** Clear explanation + alternative suggestions (staged targets, timeframe extension, etc.)

---

## Example Scenarios

### Scenario A: Meaningful Downshift → Execute
```
Account: $5,000
Goal: $171
Market can deliver: $106

Checks:
✅ Retention: 62% (above 20% floor)
✅ Account floor: $106 > $7.50 (passes)
✅ Volatility floor: Meets 15% of daily ATR
✅ Spread floor: $106 > 3x spread cost

Flow:
1. System proposes $106 adjusted goal
2. Alpha evaluates → AFFIRM
3. Trade executes with $106 target
```

### Scenario B: Possible But Not Meaningful → Wait
```
Account: $10,000
Goal: $171
Market can deliver: $18

Checks:
❌ Retention: 10.5% (below 20% floor)
✅ Account floor: $18 > $15 (barely passes)
❌ Volatility floor: Only 8% of daily ATR (fails)
❌ Historical floor: User avg win $85, $18 is 21% (fails)

Flow:
1. System detects: possible but not meaningful
2. Tier: WAIT_FOR_VOLATILITY
3. Message: "Expected profit ($18) only 10% of goal and below
   typical opportunity levels. Waiting for higher volatility."
```

### Scenario C: Dead Market → Wait, Don't Churn
```
Account: $2,000
Goal: $40
Current ATR: 0.0008 (very low)
Market can deliver: $8

Checks:
✅ Retention: 20% (exactly at floor)
✅ Account floor: $8 > $3 (passes)
❌ Volatility floor: Only 5% of typical movement (fails)
❌ Spread floor: $8 < 3x spread $12 (fails)

Flow:
1. System detects: technically possible, but spread-dominated
2. Tier: WAIT_FOR_VOLATILITY
3. Message: "Market volatility too low. Trade would be
   spread-dominated. Waiting for session open or increased movement."
```

### Scenario D: Near Goal Completion → Execute
```
Account: $3,000
Goal: $50
Progress: $48
Remaining: $2
Market can deliver: $2.20

Checks:
✅ Retention: 110% (can complete goal)
✅ Special case: Within 10% of goal completion → relax floors
✅ Account floor check overridden (near completion)

Flow:
1. System proposes $2.20 to complete goal
2. Alpha evaluates → AFFIRM (strategic completion)
3. Trade executes to finish goal
```

---

## Configuration

All thresholds and behavior are centralized in `goal-feasibility-config.ts`:

```typescript
export const GOAL_FEASIBILITY_CONFIG = {
  downshift: {
    enabled: true,
    minGoalRetentionPercent: 0.20,        // Must deliver ≥20%
    maxDownshiftPercent: 0.80,            // Can't reduce by >80%
    requireAlphaReconfirmation: true,
  },

  meaningfulTrade: {
    volatilityFloorPercent: 0.15,         // 15% of daily ATR
    accountFloorPercent: 0.0015,          // 0.15% of account
    spreadMultiplierMin: 3.0,             // 3x spread cost
    historicalFloorPercent: 0.25,         // 25% of avg win
    actionOnFailure: 'WAIT_FOR_VOLATILITY',
  },

  calculation: {
    atrSafetyFactor: 0.7,                 // Use 70% of ATR (conservative)
    minTimeToFillMinutes: 15,
    maxTimeToFillMinutes: 180,
  },

  waitConditions: {
    minATRMultiplierRequired: 1.5,
    minSessionLiquidity: 'medium',
    maxTradesInLastHour: 2,               // Prevent churn
  },

  transparency: {
    showRetentionPercent: true,
    showOriginalVsAdjusted: true,
    showMeaningfulnessChecks: true,
    explainWaitReason: true,
  }
};
```

---

## Alpha's Authority

**Critical:** Alpha maintains final decision authority.

### Alpha's Evaluation Process

1. **Receives Downshift Proposal:**
   ```typescript
   interface DownshiftProposal {
     originalGoal: number;
     adjustedGoal: number;
     retentionPercent: number;
     adjustedTrade: AdjustedTradeParameters;
     volatilityContext: VolatilityContext;
     meaningfulnessChecks: MeaningfulnessChecks;
     reasonsForDownshift: string[];
   }
   ```

2. **Strategic Evaluation:**
   - Is this opportunity worth trading given current session state?
   - Does it align with recent performance patterns?
   - Is volatility trending up or down?
   - Are we near goal completion?

3. **Decision:**
   - **AFFIRM:** "This adjusted goal makes strategic sense. Execute."
   - **WAIT:** "Market conditions not optimal yet. Wait for better setup."
   - **REJECT:** "Not strategically worthwhile even with adjustments."

### Why Alpha Decides (Not Automatic)

- Prevents mechanical execution in deteriorating markets
- Allows strategic overrides based on session context
- Preserves decision provenance and learning
- Maintains trust through intentional choices

---

## Database Tracking

All decisions are logged to `goal_feasibility_decisions` table for:

- **Analytics:** When do downshifts happen? What's the success rate?
- **Learning:** Which Alpha decisions perform best?
- **Transparency:** Complete audit trail
- **Performance:** Measure system effectiveness

### Key Metrics Tracked

- Retention percentages
- Meaningfulness check results
- Alpha decision outcomes
- Actual profit vs expected
- Success rates by tier

### Analytics Functions

```sql
-- Get user's feasibility analytics
SELECT * FROM get_user_feasibility_analytics(user_id);

-- Get recent decisions
SELECT * FROM get_recent_feasibility_decisions(user_id, 10);
```

---

## Benefits

### 1. Prevents Death-by-Small-Wins
- No grinding in dead markets
- Preserves Alpha's win rate
- Protects against spread erosion

### 2. Preserves Alpha's Authority
- System proposes, Alpha decides
- No silent auto-execution
- Clean decision provenance

### 3. Scales Naturally
- Works for $500 and $50,000 accounts
- Adapts to user's historical performance
- Respects volatility regimes

### 4. Maintains Discipline
- Still enforces SL×ATR caps
- Still respects R:R minimums
- Still blocks impossible goals

### 5. Honest UX
- "Waiting for better opportunity" > "Here's your $4 profit"
- Teaches users about market states
- Builds trust through transparency

---

## Integration Points

### Where to Use This System

1. **Goal Session Initialization:**
   ```typescript
   const feasibility = await GoalFeasibilityResolver.analyzeFeasibility({
     userId, sessionId, goalAmount, currentProgress,
     accountBalance, symbol, currentATR, typicalATR, dailyATR,
     currentSpread, currentPrice
   });
   ```

2. **Before Each Trade Scan:**
   - Check if goal is still feasible given current market
   - Update user if conditions changed

3. **After Market Regime Changes:**
   - Re-evaluate if volatility dropped significantly
   - Propose waiting instead of forcing trades

4. **In Trade Rejection Flows:**
   - Instead of generic "can't find trades"
   - Show specific feasibility analysis

### UI Integration

```tsx
import { GoalFeasibilityCard } from './GoalFeasibilityCard';

<GoalFeasibilityCard
  proposal={feasibilityResult.proposal}
  alphaResponse={alphaDecision}
  showDetails={true}
/>
```

---

## Future Enhancements

### Potential Improvements

1. **Dynamic Threshold Learning:**
   - Adjust thresholds based on user's historical performance
   - Personalize meaningfulness criteria

2. **Market Regime Awareness:**
   - Different thresholds for high/low volatility periods
   - Session-specific adjustments

3. **Multi-Trade Proposals:**
   - "Can't reach $171 in one trade, but can in 3 trades of $57 each"
   - Offer staged execution plans

4. **Volatility Forecasting:**
   - "Volatility likely to increase in 2 hours (session open)"
   - Smart wait timing recommendations

---

## Testing Checklist

When testing this system, verify:

- [ ] Downshifts only when retention ≥20%
- [ ] WAIT triggered when no meaningful thresholds met
- [ ] Alpha receives full proposal context
- [ ] Alpha can override system recommendations
- [ ] UI shows transparent breakdowns
- [ ] Database logs all decisions correctly
- [ ] Special cases handled (near completion, growth mode)
- [ ] Churn prevention works (max trades per hour)
- [ ] Session liquidity affects decisions
- [ ] Historical floor uses recent wins only

---

## Summary

This Goal Feasibility Resolver system solves the core problem:

**"The market analysis is correct, the direction is valid, but the goal physics are impossible."**

By introducing:
1. **Transparent downshifting** (original → adjusted)
2. **Meaningful trade thresholds** (4 criteria)
3. **Alpha re-confirmation** (maintains authority)
4. **Three-tier responses** (Execute / Wait / Block)

It transforms Pipnosis from a binary "all or nothing" system into an **adaptive, transparent, anti-churn trading platform** that respects both market reality and user goals.

**The one-sentence rule:**

> "If the market can offer something meaningful, adapt and trade. If it can only offer noise, wait — don't churn."
