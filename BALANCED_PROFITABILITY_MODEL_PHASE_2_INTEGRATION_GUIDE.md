# Balanced Profitability Model - Phase 2 Integration Guide

## Overview

This document outlines how to integrate the new EV Calculator, CSS Calculator, and Adaptive Risk Manager into the existing AI Learning Engine, AI Decision Advisor, and AI Skill Tracker.

---

## Integration Points

### 1. AI Learning Engine (`ai-learning-engine.ts`)

#### **Import New Services**

Add at the top of the file:
```typescript
import { evCalculator } from './ev-calculator';
import { cssCalculator } from './css-calculator';
import { adaptiveRiskManager } from './adaptive-risk-manager';
```

#### **Enhance `analyzeTrades()` Method**

When inserting into `ai_trade_analysis`, add these new fields:

```typescript
// Before insert, calculate:
const realizedRR = this.calculateRealizedRR(trade);
const { mae, mfe } = this.calculateMAEMFE(trade);
const tradeEV = await this.calculateTradeEV(userId, trade, allTrades);
const tradeQuality = this.calculateTradeQuality(trade, realizedRR);
const volatilityRegime = this.determineVolatilityRegime(trade);

// Then add to insert:
realized_rr: realizedRR,
mae: mae,
mfe: mfe,
expected_value: tradeEV,
trade_quality_score: tradeQuality,
volatility_regime: volatilityRegime
```

#### **Add New Method: `updatePatternEVTracking()`**

After `analyzeMarketScenarioPerformance()`, add:

```typescript
private async updatePatternEVTracking(
  userId: string,
  trades: TradeForAnalysis[]
): Promise<void> {
  console.log('[AI Learning Engine] Updating pattern EV tracking...');

  const symbolGroups = this.groupBySymbol(trades);

  for (const [symbol, symbolTrades] of Object.entries(symbolGroups)) {
    for (const trade of symbolTrades) {
      // Calculate EV for this pattern
      const evResult = await evCalculator.calculatePatternEV(
        userId,
        symbol,
        trade.setupType || 'Unknown',
        this.determineVolatilityRegime(trade) as 'low' | 'medium' | 'high'
      );

      if (evResult) {
        await evCalculator.updatePatternEVTracking(
          userId,
          symbol,
          trade.setupType || 'Unknown',
          evResult,
          this.determineVolatilityRegime(trade) as 'low' | 'medium' | 'high'
        );
      }

      // Learn from completed trade
      await evCalculator.learnFromCompletedTrade(userId, {
        symbol,
        patternName: trade.setupType || 'Unknown',
        outcome: trade.outcome,
        pnl: trade.pnl,
        volatilityRegime: this.determineVolatilityRegime(trade) as 'low' | 'medium' | 'high'
      });
    }
  }

  console.log('[AI Learning Engine] ✓ Pattern EV tracking updated');
}
```

#### **Add New Method: `calculateSessionCSS()`**

```typescript
private async calculateSessionCSS(
  userId: string,
  trades: TradeForAnalysis[]
): Promise<void> {
  console.log('[AI Learning Engine] Calculating CSS for session...');

  if (trades.length === 0) return;

  const tradeData = trades.map(t => ({
    outcome: t.outcome,
    pnl: t.pnl,
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice || t.entryPrice,
    stopLoss: t.stopLoss,
    takeProfit: t.takeProfit
  }));

  const cssResult = cssCalculator.calculateCSSFromTrades(tradeData);

  console.log(`[AI Learning Engine] Session CSS: ${cssResult.compositeSuccessScore.toFixed(2)}`);
  console.log(`  Win Rate: ${cssResult.rawMetrics.winRate.toFixed(1)}%`);
  console.log(`  Profit Factor: ${cssResult.rawMetrics.profitFactor.toFixed(2)}`);\n  console.log(`  Avg R:R: ${cssResult.rawMetrics.avgRR.toFixed(2)}`);
  console.log(`  Max Drawdown: ${cssResult.rawMetrics.maxDrawdown.toFixed(1)}%`);
  console.log(`  Grade: ${cssResult.grade}`);
  console.log(`  Skill Level: ${cssResult.skillLevel}`);

  console.log('[AI Learning Engine] ✓ CSS calculated');
}
```

#### **Update `analyzeBacktestSession()` Main Flow**

Modify step 6-7 to include new steps:

```typescript
// 6. Update performance evolution metrics (with CSS)
await this.updatePerformanceEvolution(userId, trades);

// 7. Calculate EV for all patterns and update tracking
await this.updatePatternEVTracking(userId, trades);

// 8. Calculate and store CSS for session
await this.calculateSessionCSS(userId, trades);

// 9. Calculate and store overall session learnings
await this.generateSessionSummary(userId, sessionId, trades, sessionType);
```

#### **Add Helper Methods**

```typescript
private calculateRealizedRR(trade: TradeForAnalysis): number {
  const riskAmount = Math.abs(trade.entryPrice - trade.stopLoss);
  if (riskAmount === 0) return 0;
  const actualPnL = Math.abs((trade.exitPrice || trade.entryPrice) - trade.entryPrice);
  return actualPnL / riskAmount;
}

private calculateMAEMFE(trade: TradeForAnalysis): { mae: number; mfe: number } {
  const priceMove = Math.abs((trade.exitPrice || trade.entryPrice) - trade.entryPrice);
  if (trade.outcome === 'win') {
    return { mae: priceMove * 0.3, mfe: priceMove };
  } else if (trade.outcome === 'loss') {
    return { mae: priceMove, mfe: priceMove * 0.2 };
  }
  return { mae: 0, mfe: 0 };
}

private async calculateTradeEV(
  userId: string,
  trade: TradeForAnalysis,
  allTrades: TradeForAnalysis[]
): Promise<number> {
  const similarTrades = this.findSimilarTrades(trade, allTrades);
  if (similarTrades.length < 3) return 0;

  const wins = similarTrades.filter(t => t.outcome === 'win');
  const losses = similarTrades.filter(t => t.outcome === 'loss');
  const winProbability = wins.length / similarTrades.length;
  const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length) : 0;

  return (winProbability * avgWin) - ((1 - winProbability) * avgLoss);
}

private calculateTradeQuality(trade: TradeForAnalysis, realizedRR: number): number {
  let score = 50;
  if (trade.outcome === 'win') score += 40;
  else if (trade.outcome === 'loss') score += 10;
  else score += 20;

  if (realizedRR >= 2.0) score += 30;
  else if (realizedRR >= 1.5) score += 20;
  else if (realizedRR >= 1.0) score += 10;

  if (trade.confidence >= 80 && trade.outcome === 'win') score += 20;
  else if (trade.confidence < 70 && trade.outcome === 'loss') score -= 10;

  if (trade.setupType && trade.setupType !== 'Unknown') score += 10;

  return Math.max(0, Math.min(100, score));
}

private determineVolatilityRegime(trade: TradeForAnalysis): string {
  const range = Math.abs(trade.takeProfit - trade.stopLoss);
  const avgPrice = (trade.takeProfit + trade.stopLoss) / 2;
  const rangePercent = (range / avgPrice) * 100;

  if (rangePercent > 1.5) return 'high';
  if (rangePercent > 0.8) return 'medium';
  return 'low';
}
```

#### **Update `updatePerformanceEvolution()` to Include CSS**

Add CSS fields when inserting/updating:

```typescript
composite_success_score: cssResult?.compositeSuccessScore || 0,
avg_realized_rr: avgRR,
drawdown_percent: drawdownPercent,
in_defensive_mode: false, // Check with adaptiveRiskManager if needed
risk_adjustment_factor: 1.0
```

---

### 2. AI Decision Advisor (`ai-decision-advisor.ts`)

#### **Import New Services**

```typescript
import { evCalculator } from './ev-calculator';
import { adaptiveRiskManager } from './adaptive-risk-manager';
```

#### **Add EV-First Evaluation to `evaluateTradeSignal()`**

After getting insights, scenarioPerformance, and similarTrades:

```typescript
// NEW: Calculate Expected Value for this pattern
const evResult = await evCalculator.calculateSignalEV(userId, {
  symbol: signal.symbol,
  direction: signal.direction,
  entryPrice: signal.entryPrice,
  stopLoss: signal.stopLoss,
  takeProfit: signal.takeProfit,
  patternName: signal.setupType
});

console.log(`[AI Decision Advisor] Pattern EV: ${evResult?.expectedValue.toFixed(2) || 'N/A'}`);
console.log(`[AI Decision Advisor] Recommendation: ${evResult?.recommendation || 'N/A'}`);
```

#### **Enhance `calculateAdjustedConfidence()` with EV Weighting**

Add EV factor at the beginning:

```typescript
let adjustedConfidence = signal.confidence;

// Factor 0: Expected Value (HIGHEST PRIORITY)
if (evResult) {
  if (evResult.expectedValue > 10 && evResult.recommendation === 'take') {
    adjustedConfidence += 15;
    console.log(`[AI Decision Advisor] ⬆️ +15% from strong positive EV (${evResult.expectedValue.toFixed(2)})`);
  } else if (evResult.expectedValue < 0 && evResult.isStatisticallySignificant) {
    adjustedConfidence -= 20;
    console.log(`[AI Decision Advisor] ⬇️ -20% from negative EV (${evResult.expectedValue.toFixed(2)})`);
  } else if (evResult.expectedValue > 0 && evResult.recommendation === 'cautious') {
    adjustedConfidence += 5;
    console.log(`[AI Decision Advisor] ⬆️ +5% from positive EV but limited data`);
  }
}

// Then continue with existing factors...
```

#### **Add Defensive Mode Check to `makeDecision()`**

Before returning decision:

```typescript
// Check defensive mode filters
const riskState = await adaptiveRiskManager.getRiskState(userId);
const tradeCheck = await adaptiveRiskManager.shouldTakeTrade(userId, {
  confidence: adjustedConfidence,
  patternProfitFactor: evResult?.profitFactor,
  isVolatilityHigh: signal.marketConditions?.volatility === 'high'
});

if (!tradeCheck.shouldTake && riskState.isDefensiveModeActive) {
  return {
    shouldTake: false,
    adjustedConfidence,
    reasoning: `Defensive Mode: ${tradeCheck.reason}`,
    riskLevel: 'high',
    historicalSuccessRate,
    keyInsights,
    warnings: [...warnings, `🛡️ Defensive Mode Active: ${tradeCheck.reason}`],
    recommendations: ['Wait for defensive mode to end', 'Focus on high-quality setups only']
  };
}
```

---

### 3. AI Skill Tracker (`ai-skill-tracker.ts`)

#### **Import CSS Calculator**

```typescript
import { cssCalculator } from './css-calculator';
```

#### **Update SKILL_THRESHOLDS to Match Balanced Model**

Replace existing thresholds with:

```typescript
private readonly SKILL_THRESHOLDS: SkillLevelThresholds[] = [
  {
    level: 'Novice',
    minTrades: 0,
    minWinRate: 0,
    minProfitFactor: 0,
    minAvgRR: 0,
    minCSS: 0,
    description: 'Just starting to learn trading patterns.'
  },
  {
    level: 'Intermediate',
    minTrades: 100,
    minWinRate: 50,
    minProfitFactor: 1.0,
    minAvgRR: 1.2,
    minCSS: 60,
    description: 'Understanding basic patterns.'
  },
  {
    level: 'Pro',
    minTrades: 500,
    minWinRate: 60,
    minProfitFactor: 1.3,
    minAvgRR: 1.5,
    minCSS: 70,
    description: 'Consistent performance with good risk management.'
  },
  {
    level: 'Expert',
    minTrades: 1500,
    minWinRate: 65,
    minProfitFactor: 1.6,
    minAvgRR: 1.8,
    minCSS: 80,
    description: 'Advanced pattern recognition across conditions.'
  },
  {
    level: 'Master',
    minTrades: 5000,
    minWinRate: 70,
    minProfitFactor: 1.8,
    minAvgRR: 2.0,
    minCSS: 85,
    description: 'Mastery of strategies with exceptional consistency.'
  },
  {
    level: 'Exceptional',
    minTrades: 10000,
    minWinRate: 75,
    minProfitFactor: 2.0,
    minAvgRR: 2.2,
    minCSS: 90,
    description: 'Peak performance. Elite-level trading.'
  }
];
```

#### **Update `calculateSkillLevel()` to Use CSS**

Replace method with:

```typescript
private calculateSkillLevel(
  totalTrades: number,
  winRate: number,
  profitFactor: number,
  avgRR: number,
  css: number
): SkillLevel {
  for (let i = this.SKILL_THRESHOLDS.length - 1; i >= 0; i--) {
    const threshold = this.SKILL_THRESHOLDS[i];

    // Must meet ALL criteria
    if (
      totalTrades >= threshold.minTrades &&
      winRate >= threshold.minWinRate &&
      profitFactor >= threshold.minProfitFactor &&
      avgRR >= threshold.minAvgRR &&
      css >= threshold.minCSS
    ) {
      return threshold.level;
    }
  }

  return 'Novice';
}
```

#### **Update `updateAfterBacktest()` to Calculate CSS**

Add CSS calculation:

```typescript
// Calculate CSS for skill determination
const recentTrades = await this.getRecentTrades(userId, 100);
let cssValue = 0;

if (recentTrades.length >= 20) {
  const cssResult = cssCalculator.calculateCSSFromTrades(recentTrades);
  cssValue = cssResult.compositeSuccessScore;
}

// Determine new skill level with CSS
const newLevel = this.calculateSkillLevel(
  newTotalTrades,
  newWinRate,
  newProfitFactor,
  avgRR, // Need to calculate this
  cssValue
);
```

#### **Add Method to Fetch Recent Trades**

```typescript
private async getRecentTrades(userId: string, limit: number): Promise<any[]> {
  const { data: trades } = await supabase
    .from('trade_history')
    .select('*')
    .eq('user_id', userId)
    .order('closed_at', { ascending: false })
    .limit(limit);

  if (!trades) return [];

  return trades.map(t => ({
    outcome: parseFloat(t.profit_loss) > 0 ? 'win' : (parseFloat(t.profit_loss) < 0 ? 'loss' : 'breakeven'),
    pnl: parseFloat(t.profit_loss),
    entryPrice: parseFloat(t.entry_price),
    exitPrice: parseFloat(t.exit_price),
    stopLoss: parseFloat(t.stop_loss),
    takeProfit: parseFloat(t.take_profit)
  }));
}
```

---

## Summary of Changes

### AI Learning Engine
- ✅ Add EV, CSS, and Adaptive Risk Manager imports
- ✅ Calculate realized R:R, MAE/MFE, EV, trade quality, volatility for each trade
- ✅ Add pattern EV tracking after each session
- ✅ Calculate CSS for each session
- ✅ Update performance evolution with CSS metrics
- ✅ Add helper methods for calculations

### AI Decision Advisor
- ✅ Add EV Calculator import
- ✅ Calculate signal EV before making decision
- ✅ Prioritize EV in confidence adjustment (highest weight)
- ✅ Check defensive mode filters before final decision
- ✅ Reject trades that don't meet defensive mode criteria

### AI Skill Tracker
- ✅ Add CSS Calculator import
- ✅ Update skill thresholds to include CSS and Avg R:R requirements
- ✅ Modify skill level calculation to require ALL criteria (not just trades + win rate)
- ✅ Calculate CSS from recent trades for skill determination
- ✅ Add method to fetch recent trades

---

## Testing After Integration

1. **Run a synthetic backtest** → Check that EV and CSS are calculated
2. **Complete a live trade** → Verify EV pattern tracking updates
3. **Check defensive mode** → Simulate 2 losses and verify activation
4. **View skill progression** → Confirm CSS is factored into skill level

---

## Next Steps

After Phase 2 integration:
- **Phase 3**: Build session learning summaries and pattern discovery
- **Phase 4**: Create UI components and dashboards for visualization

---

*Phase 2 Integration Guide*
*Updated: November 10, 2025*
