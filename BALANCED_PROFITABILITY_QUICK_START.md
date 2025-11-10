# Balanced Profitability Model - Quick Start Guide

## Overview

Pipnosis has been transformed from a win-rate focused system (targeting 80% win rate) into a **Expected Value (EV) based system** with balanced profitability metrics. This guide shows you how to use the new system.

---

## Core Concepts

### 1. Expected Value (EV)

**Formula:** `EV = (Win Probability × Avg Win) − ((1 − Win Probability) × Avg Loss)`

- **Positive EV (> 0):** Pattern is profitable over time
- **Negative EV (< 0):** Pattern loses money over time
- **Target:** +5 or higher for strong patterns

### 2. Composite Success Score (CSS)

**Formula:** `CSS = (0.4 × Win Rate) + (0.3 × Profit Factor) + (0.2 × Avg R:R) + (0.1 × Drawdown Control)`

**Skill Levels:**
- **85-100:** Exceptional
- **80-84:** Advanced
- **70-79:** Pro
- **60-69:** Competent
- **50-59:** Improving
- **0-49:** Novice

### 3. Defensive Mode

**Triggers:**
- 2 consecutive losses
- 10% drawdown from peak

**Actions:**
- Reduces position size by 50%
- Increases confidence threshold from 75% → 85%
- Only takes highest quality setups

---

## Key Changes from Old System

| Old System | New System |
|-----------|-----------|
| Target: 80% win rate | Target: Positive EV + Balanced CSS |
| Win rate obsessed | Profit factor + R:R focused |
| No EV calculation | EV-first signal evaluation |
| Fixed risk | Adaptive risk with defensive mode |
| Limited metrics | 6 profitability metrics (EV, CSS, MAE, MFE, realized R:R, trade quality) |

---

## How AI Makes Decisions Now

### Step 1: EV Check (NEW)
```typescript
1. Calculate pattern EV for symbol/setup
2. If EV > 5 → Boost confidence by +15%
3. If EV < 0 → Reduce confidence by -20%
4. If EV < -5 → Skip trade entirely
```

### Step 2: Defensive Mode Check (NEW)
```typescript
If defensive mode active:
  - Only take trades with confidence ≥ 85%
  - Position size reduced by 50%
  - Must pass strict quality filters
```

### Step 3: Original Confidence (Existing)
```typescript
Calculate confidence based on:
- Indicator alignment
- Pattern recognition
- Historical win rate
```

### Step 4: Final Decision
```typescript
Adjusted Confidence = Original × EV Modifier × Defensive Modifier
Take trade if: Adjusted Confidence ≥ Threshold
```

---

## Using the New System

### 1. Check Pattern EV Status

```typescript
import { evCalculator } from '@/services/ev-calculator';

// Get all positive EV patterns
const patterns = await evCalculator.getPositiveEVPatterns(userId);

// Check specific pattern
const evResult = await evCalculator.calculatePatternEV(
  userId,
  'EURUSD',
  'Flow Trader V2',
  'medium' // volatility regime
);

console.log('EV:', evResult.expectedValue);
console.log('Status:', evResult.patternStatus); // active, degraded, paused
```

### 2. Calculate CSS

```typescript
import { cssCalculator } from '@/services/css-calculator';

const trades = [/* your trades */];
const cssResult = cssCalculator.calculateCSSFromTrades(trades);

console.log('CSS:', cssResult.compositeSuccessScore);
console.log('Grade:', cssResult.grade); // A+, A, B+, etc.
console.log('Skill Level:', cssResult.skillLevel);
console.log('Win Rate:', cssResult.rawMetrics.winRate);
console.log('Profit Factor:', cssResult.rawMetrics.profitFactor);
console.log('Avg R:R:', cssResult.rawMetrics.avgRR);
```

### 3. Check Defensive Mode

```typescript
import { adaptiveRiskManager } from '@/services/adaptive-risk-manager';

// Check if defensive mode is active
const status = await adaptiveRiskManager.checkDefensiveMode(userId, 'EURUSD');

if (status.defensiveModeActive) {
  console.log('Defensive Mode: ACTIVE');
  console.log('Position Size Multiplier:', status.positionSizeMultiplier); // 0.5
  console.log('Min Confidence Required:', status.minConfidenceThreshold); // 85
}

// Evaluate if trade should be taken
const shouldTake = await adaptiveRiskManager.shouldTakeTrade(
  userId,
  'EURUSD',
  75 // confidence score
);
```

### 4. Generate Daily Learning Summary

```typescript
import { sessionLearningGenerator } from '@/services/session-learning-generator';

// Generate today's learning summary
const summary = await sessionLearningGenerator.generateDailyLearning(userId);

console.log('Best Setup:', summary.bestSetup);
console.log('Worst Setup:', summary.worstSetup);
console.log('Session CSS:', summary.sessionCSS);
console.log('Session EV:', summary.sessionEV);
console.log('Recommendations:', summary.recommendations);
```

---

## Database Tables

### New Tables
1. **pattern_ev_tracking** - EV for each pattern/symbol combo
2. **css_performance_tracking** - CSS scores over time
3. **defensive_mode_events** - When defensive mode activates/deactivates
4. **ai_session_learnings** - Daily "What I Learned" summaries

### Enhanced Tables
1. **trade_history** - Added: confidence_score, setup_type, market_conditions, ai_analyzed
2. **ai_learning_insights** - Added: learning_weight (2x for live trades), learned_from_live_trading
3. **ai_trade_analysis** - Added: realized_rr, mae, mfe, expected_value, trade_quality_score
4. **ai_skill_tracker** - Enhanced with CSS and Avg R:R requirements

---

## Understanding the New Metrics

### MAE (Maximum Adverse Excursion)
- How far price moved against you before closing
- Lower MAE = Better entry timing

### MFE (Maximum Favorable Excursion)
- How far price moved in your favor before closing
- Higher MFE with win = Good profit capture
- Higher MFE with loss = Exited too late

### Realized R:R (Risk:Reward)
- Actual R:R achieved vs. planned R:R at entry
- Target: ≥ 2.0 for strong trades

### Trade Quality Score (0-100)
**Components:**
- Outcome (40 pts): Win/loss/breakeven
- R:R Achieved (30 pts): ≥2.0 gets full points
- Confidence Match (20 pts): High conf + win = bonus
- Setup Quality (10 pts): Known setup vs. unknown

---

## Best Practices

### 1. Trust EV Over Win Rate
- A 55% win rate with 2:1 R:R (EV: +10) is better than
- A 70% win rate with 1:1 R:R (EV: +5)

### 2. Respect Defensive Mode
- When active, be patient
- Only take highest quality setups
- Wait for confidence ≥ 85%

### 3. Monitor CSS Trends
- Weekly: Check if CSS is improving
- Monthly: Aim for Pro level (70+)
- Quarterly: Target Advanced (80+)

### 4. Pattern Degradation
- If EV drops below 0 for 10+ trades → STOP using pattern
- Re-evaluate after market conditions change
- Don't force trades on degraded patterns

### 5. Live Trading Weight
- Live trades get 2x learning weight
- AI learns faster from real trades
- Backtests still valuable but weighted 1x

---

## Quick Checks

### Before Taking a Trade
```
✓ Is pattern EV positive?
✓ Is defensive mode active? If yes, is confidence ≥ 85%?
✓ Does setup match known high-CSS patterns?
✓ Is R:R at entry ≥ 2.0?
✓ Is volatility regime suitable for pattern?
```

### After a Trade
```
✓ Did AI analyze the trade? (ai_analyzed = true)
✓ What was the realized R:R?
✓ Did the trade improve or hurt pattern EV?
✓ Any new insights created?
✓ CSS impact?
```

---

## Example Workflow

### Day 1: Setup Discovery
```typescript
// 1. Check which patterns have positive EV
const positivePatterns = await evCalculator.getPositiveEVPatterns(userId);

// 2. Focus on top 3 patterns with highest EV
const topPatterns = positivePatterns.slice(0, 3);

// 3. Set alerts for those symbol/setup combos
```

### Day 2: Active Trading
```typescript
// 1. Check defensive mode status
const status = await adaptiveRiskManager.checkDefensiveMode(userId, 'EURUSD');

// 2. If not defensive, take trades matching top patterns
// 3. If defensive, wait for exceptional setups only (85%+ confidence)
```

### Day 3: Review & Learn
```typescript
// 1. Generate daily learning summary
const summary = await sessionLearningGenerator.generateDailyLearning(userId);

// 2. Review best/worst setups
// 3. Check if any patterns degraded
// 4. Adjust strategy based on recommendations
```

---

## Troubleshooting

### "My win rate is only 55%"
**Answer:** That's okay! Check your:
- Profit Factor: Should be ≥ 1.5
- Avg R:R: Should be ≥ 2.0
- Pattern EV: Should be positive
- CSS: Should be ≥ 60

A 55% win rate with 2:1 R:R is profitable!

### "Defensive mode won't deactivate"
**Answer:** Defensive mode requires:
- No consecutive losses in last 2 trades
- Drawdown recovered to within 5% of peak
- At least 1 winning trade to demonstrate recovery

### "Pattern EV turned negative"
**Answer:** Pattern degraded. Options:
1. Pause pattern (wait 20+ trades)
2. Review why it's failing (market conditions changed?)
3. Adjust pattern parameters
4. Focus on other positive EV patterns

### "CSS stuck at 65"
**Answer:** To reach Pro (70+), improve:
- **Profit Factor:** Increase winners, decrease losers
- **Avg R:R:** Take profits at 2R+ targets
- **Drawdown Control:** Use defensive mode effectively
- **Win Rate:** Quality over quantity

---

## Success Metrics

### Week 1 Goals
- [ ] CSS ≥ 60 (Competent)
- [ ] At least 1 pattern with EV > 5
- [ ] Understand defensive mode triggers
- [ ] Daily learning summaries generated

### Month 1 Goals
- [ ] CSS ≥ 70 (Pro)
- [ ] 3+ patterns with EV > 5
- [ ] Profit Factor ≥ 1.5
- [ ] Avg R:R ≥ 1.8
- [ ] No defensive mode activations in final week

### Quarter 1 Goals
- [ ] CSS ≥ 80 (Advanced)
- [ ] 5+ patterns with EV > 10
- [ ] Profit Factor ≥ 2.0
- [ ] Avg R:R ≥ 2.0
- [ ] Consistent profitability across all symbols

---

## Resources

- **Full Documentation:** `/BALANCED_PROFITABILITY_MODEL_COMPLETE.md`
- **Database Migration:** `/supabase/migrations/20251110000000_balanced_profitability_model.sql`
- **EV Calculator:** `/src/services/ev-calculator.ts`
- **CSS Calculator:** `/src/services/css-calculator.ts`
- **Adaptive Risk Manager:** `/src/services/adaptive-risk-manager.ts`
- **Session Learning:** `/src/services/session-learning-generator.ts`

---

## Support

If you have questions about the Balanced Profitability Model:
1. Check the full documentation
2. Review the migration file for database structure
3. Look at service files for implementation details
4. Test in synthetic backtest first before live demo trading

---

**Remember:** The goal is **sustainable profitability**, not high win rates. Trust the EV, respect the CSS, and let the AI learn from every trade!
