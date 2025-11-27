# Autonomous LLM Risk Management System

## **Architecture Overview**

Pipnosis AI now operates with **true autonomy** where the LLM controls its own trading psychology and decision-making, while users only set **financial exposure caps** for capital protection.

---

## **🔥 Key Principle: Separation of Concerns**

### **What the USER Controls (Financial Safety)**
- **Capital Exposure Level**: Maximum % of account to risk per trade
  - **Conservative**: Max 1% per trade
  - **Moderate**: Max 2% per trade
  - **Aggressive**: Max 5% per trade

### **What the LLM Controls (Trading Psychology)**
- Confidence thresholds for trade execution
- Volatility acceptance
- Pattern selection
- Stop loss width/placement
- Trade timing
- Strategy adaptation
- Conviction assessment
- Market regime interpretation

---

## **Why This Design?**

### **Problem with Old System (FIXED)**

**Before:**
```
User: "Make me $100 with low risk"
     ↓
System: Forces 80% minimum confidence threshold
        Forces tight stop losses
        Rejects volatile setups
        Blocks patterns below threshold
     ↓
LLM: Must behave like Bronze, even if Omega rank with 6-win streak
     Cannot express its learned intelligence
     Reward engine becomes meaningless
```

**Result:** User's mood overrides AI's intelligence, breaking autonomy.

---

### **Solution: LLM Autonomy + User Safety Cap**

**Now:**
```
User: "Make me $100 with conservative exposure"
     ↓
System: Sets max risk per trade = 1% of account
     ↓
LLM: Analyzes market autonomously:
     - Current rank: Omega
     - Win streak: 6 trades
     - Conviction: 85%
     - Pattern: Proven winner
     - Market: High volatility acceptable
     ↓
Decision: "I'll take this trade with 0.8% risk (within user's 1% cap)
           SL = 2.5x ATR (my conviction level)
           Volatility = acceptable for Omega"
```

**Result:** AI trades intelligently, user's capital is protected.

---

## **Implementation Details**

### **1. Position Sizing Function**

**File:** `src/utils/currencyHelpers.ts`

```typescript
function calculateAutonomousPositionSize(
  symbol: string,
  accountBalance: number,
  userExposureLevel: 'conservative' | 'moderate' | 'aggressive',
  llmConviction: number,      // 0-100
  llmRank: 'bronze' | 'silver' | 'gold' | 'alpha' | 'omega',
  entryPrice: number,
  stopLoss: number
): number
```

**Logic:**
1. User exposure cap = max risk allowed (1%, 2%, or 5%)
2. LLM desired risk = cap × rank_multiplier × conviction_multiplier
3. Actual risk = MIN(LLM desire, user cap)

**Example:**
- User: Conservative (1% max)
- LLM: Omega rank (100% multiplier), 85% conviction
- LLM desires: 1% × 1.0 × 0.85 = 0.85%
- Actual: 0.85% (within cap)

---

### **2. Confidence Threshold Removal**

**Files Modified:**
- `src/services/goal-scanner.ts`
- `src/services/autonomous-reasoning-engine.ts`

**Before (REMOVED):**
```typescript
const riskThresholds = {
  low: 80,      // User forces 80% confidence
  medium: 75,
  high: 70
};
```

**After:**
```typescript
// LLM controls confidence autonomously
// Based on: rank, streak, pattern history, market conditions
```

---

### **3. LLM Prompt Updates**

**File:** `src/services/autonomous-reasoning-engine.ts`

**Added to prompts:**
```
NOTE: Capital Exposure Level controls position sizing, NOT your confidence requirements or trading psychology.
YOU control confidence thresholds based on your internal state (rank, streak, pattern history).
```

---

### **4. UI Language Changes**

**File:** `src/components/SmartGoalPanel.tsx`

**Before:**
- "Make me $100 with low risk"
- "Make me $200 aggressively"

**After:**
- "Make me $100 with conservative exposure"
- "Make me $200 with aggressive exposure"

**Goal Parser Updates:**
- Recognizes: "conservative exposure", "moderate exposure", "aggressive exposure"
- Interprets as capital caps, not behavioral constraints

---

## **How It Works in Practice**

### **Scenario 1: Omega LLM, Conservative User**

```
User Setting: Conservative Exposure (1% max)
LLM State: Omega rank, 6-win streak, 90% conviction
Market: High volatility, proven pattern

LLM Decision:
- "I'm Omega with hot streak, this setup works"
- "High volatility is acceptable for my rank"
- "90% conviction justifies full position within user cap"
- Position: 0.9% risk (within 1% cap)
- SL: 2.5x ATR (wide, because confident)
- ✅ EXECUTES
```

---

### **Scenario 2: Bronze LLM, Aggressive User**

```
User Setting: Aggressive Exposure (5% max)
LLM State: Bronze rank, 2 recent losses, 72% conviction
Market: Moderate volatility

LLM Decision:
- "I'm Bronze, still learning"
- "Recent losses require caution"
- "72% conviction, but not overwhelming"
- Position: 1.8% risk (well below 5% cap)
- SL: 1.5x ATR (tight, because uncertain)
- ✅ EXECUTES (cautiously)
```

---

### **Scenario 3: Adaptive Risk Manager Intervention**

```
User Setting: Moderate Exposure (2% max)
LLM State: Gold rank, BUT 2 consecutive losses just occurred
Market: Good setup, 80% conviction

Adaptive Risk Manager:
- Detects: 2 consecutive losses
- Activates: Defensive Mode
- Reduces: Position size by 50%
- Position: 0.8% risk (half of 1.6% desired)
- ✅ EXECUTES (defensively)
```

**This is LLM-driven adaptation, NOT user override.**

---

## **Rank-Based Behavior**

### **Bronze LLM (Learning Phase)**
- Uses 40% of available exposure cap
- Requires 75%+ conviction
- Prefers tight stop losses (1.5x ATR)
- Avoids high volatility
- Cautious pattern selection

### **Silver LLM (Building Phase)**
- Uses 60% of available exposure cap
- Requires 72%+ conviction
- Moderate stop losses (2x ATR)
- Accepts moderate volatility
- More pattern flexibility

### **Gold LLM (Confident Phase)**
- Uses 80% of available exposure cap
- Requires 70%+ conviction
- Wider stop losses (2.5x ATR)
- Accepts high volatility
- Pattern innovation enabled

### **Alpha LLM (Advanced Phase)**
- Uses 95% of available exposure cap
- Requires 68%+ conviction
- Adaptive stop losses (context-dependent)
- High volatility comfortable
- Advanced pattern recognition

### **Omega LLM (Master Phase)**
- Uses 100% of available exposure cap
- Requires 65%+ conviction
- Optimal stop losses (conviction-based)
- All volatility regimes
- Full autonomy enabled

---

## **Reward Engine Integration**

The reward engine now **directly affects trading behavior**:

### **Win Streaks**
- 3+ wins: +5% conviction scaling
- 6+ wins: +10% conviction scaling
- LLM becomes more aggressive (within cap)

### **Loss Streaks**
- 2 losses: -30% position size reduction
- 3 losses: Defensive mode (raise confidence threshold)

### **Rank Progression**
- Unlock higher exposure utilization
- Lower minimum confidence requirements
- More pattern flexibility

---

## **Benefits of This System**

### **1. True AI Autonomy**
- LLM learns from experience
- Rank progression has real impact
- Personality develops naturally
- Reward engine drives behavior

### **2. User Capital Protection**
- Absolute cap on position size
- No surprise large trades
- Adjustable risk tolerance

### **3. Consistent Learning**
- Feedback loops intact
- Pattern recognition improves
- Confidence calibration works
- Strategy evolution enabled

### **4. Natural Adaptation**
- LLM goes defensive after losses (not user)
- LLM becomes aggressive after wins (not user)
- Market regime affects decisions (not user mood)

---

## **Migration Notes**

### **Backward Compatibility**

- Field name `risk_mode` kept in database
- Semantics changed to `exposure_level`
- Old values (`low`, `medium`, `high`) still work
- New UI uses "exposure" terminology

### **Database Schema**

No changes required. Existing fields:
- `risk_mode` in `goal_sessions` table
- Now interpreted as `exposure_level`

### **Supabase Functions**

Edge functions updated to pass `exposure_level` to LLM context, not behavioral constraints.

---

## **Testing Checklist**

- [ ] Bronze LLM with conservative exposure: cautious position sizing
- [ ] Omega LLM with conservative exposure: full utilization of 1% cap
- [ ] Bronze LLM with aggressive exposure: modest position despite 5% cap
- [ ] Omega LLM with aggressive exposure: full utilization of 5% cap
- [ ] Defensive mode activation: automatic position reduction
- [ ] Win streak: increased aggression (within cap)
- [ ] Loss streak: defensive behavior (regardless of cap)
- [ ] UI displays exposure levels correctly
- [ ] Goal parser recognizes "conservative exposure"
- [ ] Position sizing logs show autonomous calculations

---

## **Summary**

**Old System:**
- User controls AI behavior ❌
- Rank/streak ignored ❌
- Reward engine decorative ❌
- Inconsistent learning ❌

**New System:**
- User controls capital only ✅
- Rank/streak drives behavior ✅
- Reward engine functional ✅
- Consistent learning loops ✅

**The LLM is now a true autonomous trader, not a user-controlled bot.**

---

## **Documentation Updated**
- Architecture diagrams: Updated
- API documentation: Exposure levels
- User guides: New terminology
- Developer notes: Autonomous system

---

**Version:** 1.0
**Date:** 2025-11-27
**Status:** ✅ **IMPLEMENTED**
