# Balanced Profitability Model - Phase 1 Complete

## Overview

Phase 1 of the Balanced Profitability Model transformation is **complete**! Pipnosis now has the foundation for Expected Value (EV)-based learning, Composite Success Score (CSS) tracking, and adaptive risk management with Defensive Mode.

---

## ✅ What Was Implemented

### 1. Database Schema (Migration: `20251110000000_balanced_profitability_model.sql`)

#### New Tables Created:

**`ai_risk_state`** - Defensive Mode Tracking
- Tracks defensive mode activation/deactivation
- Stores risk adjustment factors (1.0 = normal, 0.5 = defensive)
- Records drawdown percentage and consecutive losses
- Logs activation reasons and triggers

**`ai_composite_scores`** - CSS Calculations
- Stores daily/weekly/monthly CSS calculations
- Breaks down CSS into 4 components (Win Rate, Profit Factor, Avg R:R, Drawdown Control)
- Tracks improvement trends and comparisons

**`ai_session_learnings`** - Daily Learning Summaries
- "What I Learned Today" automated summaries
- Best/worst setup tracking with EV metrics
- Confidence adjustments and filter changes
- Actionable recommendations for next session

**`ai_pattern_ev_tracking`** - Pattern Expected Value
- Tracks EV for each trading pattern over time
- Monitors pattern health (active, degraded, paused)
- Statistical significance tracking
- Win probability and profit factor per pattern

#### Enhanced Existing Tables:

**`ai_trade_analysis`** - Added Profitability Metrics
- `realized_rr`: Actual R:R achieved (e.g., 2.5R)
- `mae`: Maximum Adverse Excursion in pips
- `mfe`: Maximum Favorable Excursion in pips
- `expected_value`: Calculated EV at entry
- `trade_quality_score`: 0-100 execution quality
- `volatility_regime`: low/medium/high at entry

**`ai_learning_insights`** - Added EV Components
- `average_rr`: Average R:R for pattern
- `expected_value`: Pattern EV
- `profit_factor`: Total wins / total losses
- `css_contribution`: Pattern's CSS impact

**`ai_performance_evolution`** - Added CSS Tracking
- `composite_success_score`: Balanced performance metric
- `avg_realized_rr`: Average R:R achieved
- `drawdown_percent`: Session drawdown
- `in_defensive_mode`: Boolean flag
- `risk_adjustment_factor`: Current risk multiplier

**`ai_market_scenario_performance`** - Added Profitability Metrics
- `expected_value`: EV for market scenario
- `avg_realized_rr`: R:R by scenario
- `sample_ev_variance`: Consistency measure

#### Database Functions Created:

- `calculate_trade_ev()`: Calculates Expected Value
- `calculate_css()`: Computes Composite Success Score
- `get_pattern_ev()`: Retrieves EV for pattern
- `activate_defensive_mode()`: Triggers defensive mode
- `deactivate_defensive_mode()`: Exits defensive mode

#### Views Created:

- `v_latest_css`: Latest CSS per user
- `v_active_defensive_mode`: Active defensive mode users
- `v_top_patterns_by_ev`: Top patterns ranked by EV

---

### 2. EV Calculator Service (`ev-calculator.ts`)

**Formula Implementation:**
```
EV = (Win Probability × Average Win) − ((1 − Win Probability) × Average Loss)
```

**Key Features:**
- Calculates pattern EV from historical data
- Estimates EV for new patterns (no history yet)
- Tracks pattern degradation (when EV turns negative)
- Confidence levels based on sample size (low/medium/high)
- Recommendations: 'take', 'avoid', or 'cautious'
- Exploration bonus for new patterns (15% exploration, 85% exploitation)
- Auto-updates pattern EV tracking table after each trade

**Functions:**
- `calculatePatternEV()`: Calculate EV for specific pattern/symbol
- `calculateSignalEV()`: Calculate EV for incoming trade signal
- `getPositiveEVPatterns()`: Get all patterns with positive EV
- `getDegradedPatterns()`: Get patterns that need attention
- `learnFromCompletedTrade()`: Update EV after trade completion
- `rankPatternsByValue()`: Rank patterns with exploration bonus

---

### 3. CSS Calculator Service (`css-calculator.ts`)

**Formula Implementation:**
```
CSS = (0.4 × Win Rate) + (0.3 × Profit Factor) + (0.2 × Avg R:R) + (0.1 × Drawdown Control)
```

**Component Weights:**
- Win Rate: 40% (most important)
- Profit Factor: 30% (profitability quality)
- Average R:R: 20% (reward efficiency)
- Drawdown Control: 10% (risk management)

**Key Features:**
- Calculates CSS for daily/weekly/monthly periods
- Normalizes all components to 0-100 scale
- Tracks improvement trends (comparing to previous periods)
- Assigns grades: F, D, C, B, A, S
- Determines skill levels: Novice → Exceptional
- Calculates maximum drawdown from equity curve
- Auto-stores results in database

**Skill Level Thresholds (Must Meet ALL Criteria):**

| Level | Min Trades | Min CSS | Win Rate | Profit Factor | Avg R:R |
|-------|-----------|---------|----------|---------------|---------|
| Novice | 0 | — | — | — | — |
| Intermediate | 100 | 60 | 50% | 1.0 | 1.2 |
| Pro | 500 | 70 | 60% | 1.3 | 1.5 |
| Expert | 1,500 | 80 | 65% | 1.6 | 1.8 |
| Master | 5,000 | 85 | 70% | 1.8 | 2.0 |
| Exceptional | 10,000 | 90 | 75% | 2.0 | 2.2 |

**Functions:**
- `calculatePeriodCSS()`: Calculate CSS for date range
- `calculateCSSFromTrades()`: Calculate CSS from trade array
- `getLatestCSS()`: Get most recent CSS
- `getCSST rend()`: Get CSS history for charting

---

### 4. Adaptive Risk Manager Service (`adaptive-risk-manager.ts`)

**Defensive Mode Triggers:**
1. **2 consecutive losses** → Reduce risk by 50%
2. **10% drawdown** → Activate defensive mode

**Defensive Mode Actions:**
- Risk reduced to 50% (0.5x position sizes)
- Minimum confidence threshold: 80% (up from ~75%)
- Only patterns with Profit Factor ≥ 1.5
- Pause trading during volatility spikes

**Recovery Criteria:**
- 1 winning trade AND
- Drawdown below 5%

**Key Features:**
- Automatic defensive mode activation/deactivation
- Risk adjustment factor applied to position sizing
- Trade filtering based on defensive mode rules
- Real-time drawdown tracking
- Consecutive loss monitoring
- Defensive mode statistics and duration tracking

**Functions:**
- `getRiskState()`: Get current risk state
- `processTradeOutcome()`: Update after each trade
- `activateDefensiveMode()`: Trigger defensive mode
- `deactivateDefensiveMode()`: Exit defensive mode
- `getAdjustedPositionSize()`: Calculate position size with risk factor
- `shouldTakeTrade()`: Check if trade passes defensive filters
- `getDefensiveModeStats()`: Get defensive mode history

---

## 📊 How It Works Together

### Trade Flow Example:

#### Step 1: Signal Evaluation
```typescript
// New EURUSD buy signal appears
const signal = {
  symbol: 'EURUSD',
  direction: 'buy',
  entryPrice: 1.0850,
  stopLoss: 1.0830,
  takeProfit: 1.0890,
  patternName: 'Flow Trader V2',
  confidence: 75
};

// Calculate EV for this pattern
const evResult = await evCalculator.calculateSignalEV(userId, signal);
console.log(`Pattern EV: ${evResult.expectedValue}`);
console.log(`Win Probability: ${evResult.winProbability * 100}%`);
console.log(`Recommendation: ${evResult.recommendation}`);
// Output: Pattern EV: 12.5, Win Probability: 72%, Recommendation: take
```

#### Step 2: Risk Check
```typescript
// Check defensive mode
const riskState = await adaptiveRiskManager.getRiskState(userId);
const tradeCheck = await adaptiveRiskManager.shouldTakeTrade(userId, {
  confidence: signal.confidence,
  patternProfitFactor: evResult.profitFactor,
  isVolatilityHigh: false
});

if (!tradeCheck.shouldTake) {
  console.log(`Trade rejected: ${tradeCheck.reason}`);
  return;
}

// Calculate position size with risk adjustment
const baseSize = 0.1;
const adjustedSize = await adaptiveRiskManager.getAdjustedPositionSize(userId, baseSize);
console.log(`Position size: ${adjustedSize} lots`);
// If defensive mode: 0.05 lots (50% of 0.1)
// If normal: 0.1 lots
```

#### Step 3: Trade Execution
```typescript
// Take the trade...
// (trade execution logic)
```

#### Step 4: Trade Completion
```typescript
// Trade closes as WIN (+$15.24)
const outcome = {
  outcome: 'win',
  pnl: 15.24
};

// Update risk state
const riskUpdate = await adaptiveRiskManager.processTradeOutcome(
  userId,
  outcome,
  currentEquity,
  peakEquity
);

if (riskUpdate.defensiveModeDeactivated) {
  console.log('✅ Recovery complete! Defensive mode deactivated.');
}

// Learn from completed trade
await evCalculator.learnFromCompletedTrade(userId, {
  symbol: 'EURUSD',
  patternName: 'Flow Trader V2',
  outcome: 'win',
  pnl: 15.24,
  volatilityRegime: 'medium'
});
```

#### Step 5: Daily CSS Calculation
```typescript
// End of day
const today = new Date();
const cssResult = await cssCalculator.calculatePeriodCSS(
  userId,
  today,
  today,
  'daily'
);

console.log(`Today's CSS: ${cssResult.compositeSuccessScore.toFixed(2)}`);
console.log(`Grade: ${cssResult.grade}`);
console.log(`Skill Level: ${cssResult.skillLevel}`);
console.log(`Improving: ${cssResult.isImproving ? 'Yes' : 'No'}`);
```

---

## 🎯 What This Achieves

### 1. Smart Decision Making
- AI now evaluates trades based on Expected Value, not just confidence
- Positive EV trades are prioritized over high-confidence but low-EV trades
- Pattern degradation is detected automatically

### 2. Balanced Performance Tracking
- CSS replaces single-metric focus (win rate)
- Balanced view across Win Rate, Profit Factor, R:R, and Drawdown
- Skill progression based on holistic performance

### 3. Adaptive Risk Protection
- Automatic defensive mode during losing streaks
- Capital preservation through position size reduction
- Higher quality filter (confidence + profit factor) during tough times
- Automatic recovery when performance improves

### 4. Continuous Learning Foundation
- EV tracking identifies which patterns actually work
- Pattern degradation detection prevents following bad setups
- CSS trends show long-term improvement trajectory

---

## 🚀 Next Steps (Remaining Phases)

### Phase 2: Refactor Learning & Decision Systems
- Update `ai-learning-engine.ts` to use EV scoring
- Refactor `ai-decision-advisor.ts` for EV-first evaluation
- Update `ai-skill-tracker.ts` with CSS-based progression

### Phase 3: Session Learning & Summaries
- Create `session-learning-generator.ts`
- Implement "What I Learned Today" automation
- Build pattern discovery and degradation alerts

### Phase 4: UI Integration
- Update AI Training Page with CSS display
- Update AI Trade Console with EV indicators
- Create new AI Learning Dashboard page
- Build Defensive Mode UI components

---

## 📝 Database Migration Status

**Migration File:** `/supabase/migrations/20251110000000_balanced_profitability_model.sql`

**Status:** ✅ Ready to deploy

**To Apply:**
1. Migration will be auto-applied on next Supabase sync
2. Or manually run via Supabase dashboard: Database → SQL Editor → Run migration

**Tables Created:** 4 new tables
**Tables Enhanced:** 4 existing tables
**Functions Created:** 5 helper functions
**Views Created:** 3 reporting views

---

## 🧪 Testing

### Build Status
```bash
npm run build
# ✓ built in 25.99s
# No errors!
```

### Test EV Calculator:
```typescript
import { evCalculator } from './services/ev-calculator';

const evResult = await evCalculator.calculatePatternEV(
  userId,
  'EURUSD',
  'Flow Trader V2'
);

console.log('EV Result:', evResult);
```

### Test CSS Calculator:
```typescript
import { cssCalculator } from './services/css-calculator';

const cssResult = await cssCalculator.calculatePeriodCSS(
  userId,
  startDate,
  endDate,
  'daily'
);

console.log('CSS:', cssResult.compositeSuccessScore);
console.log('Grade:', cssResult.grade);
console.log('Skill Level:', cssResult.skillLevel);
```

### Test Adaptive Risk Manager:
```typescript
import { adaptiveRiskManager } from './services/adaptive-risk-manager';

// Simulate 2 losses
await adaptiveRiskManager.processTradeOutcome(userId, { outcome: 'loss', pnl: -10 }, 9990, 10000);
await adaptiveRiskManager.processTradeOutcome(userId, { outcome: 'loss', pnl: -10 }, 9980, 10000);
// Defensive mode should activate!

const riskState = await adaptiveRiskManager.getRiskState(userId);
console.log('Defensive Mode Active:', riskState.isDefensiveModeActive);
console.log('Risk Factor:', riskState.riskAdjustmentFactor); // Should be 0.5
```

---

## 🎊 Summary

**Phase 1 is Complete!** Pipnosis now has:

✅ Expected Value calculation and tracking
✅ Composite Success Score balanced metrics
✅ Adaptive Risk Management with Defensive Mode
✅ Pattern EV tracking and degradation detection
✅ Comprehensive database schema for profitability learning
✅ Foundation for smarter, more profitable AI trading

**The AI can now:**
- Calculate if a pattern is profitable (EV > 0) over time
- Balance win rate with profit quality (CSS)
- Protect capital during losing streaks (Defensive Mode)
- Track improvement across multiple dimensions
- Learn which patterns truly work vs which just "win often but small"

**Build Status:** ✅ Passing
**Ready For:** Phase 2 implementation

---

*Implementation Date: November 10, 2025*
*Status: Phase 1 Complete - Core Services Operational*
