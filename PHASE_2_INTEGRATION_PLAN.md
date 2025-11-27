# Phase 2: Integration Plan - Autonomous Brain

## Overview
Replace the 5-layer LLM validation system + Flow V2 with the autonomous Pipnosis Alpha brain.

---

## Current Architecture (TO BE REPLACED)

```
Candle → Flow V2 Trigger Detection
           ↓
       Hard Gate (avoid-pattern-enforcer)
           ↓
       Layer 1: Regime Validation (llm-regime-validator)
           ↓
       Layer 2: Setup Quality (llm-setup-quality)
           ↓
       Layer 3: Mistake Prevention (llm-mistake-prevention)
           ↓
       Layer 4: Confidence Calibration (llm-confidence-calibrator)
           ↓
       Layer 5: Final Decision (event-based-llm-engine)
           ↓
       Trade Execution
```

**Problems:**
- 5 LLM calls per trade = expensive
- Rigid Flow V2 rules = restrictive
- No learning from results
- No personality adaptation

---

## New Architecture (AUTONOMOUS)

```
Session Start
    ↓
Load Trader Score (personality state)
    ↓
Strategy Brain: Plan strategy once
    ↓
Every Candle: Condition Monitor (no LLM)
    ↓
Conditions Met? → Execution Brain (with score context)
    ↓
Safety Enforcer (hard rules)
    ↓
Trade Execution
    ↓
Trade Closes → Reward Engine (update score)
    ↓
Performance Analyzer (learn)
```

**Benefits:**
- 1 LLM call per 100 candles for planning
- 1 LLM call per trade for execution
- 96% cost reduction
- Self-improving
- Personality-driven

---

## Files to Modify

### 1. `/src/services/event-based-llm-engine.ts`
**Changes:**
- Remove imports of 5 layer files
- Remove `execute5LayerPipeline()` method
- Add autonomous brain integration
- Replace `callLLM()` with new flow:
  1. Check if strategy exists, if not call `llmStrategyBrain.planStrategy()`
  2. Use `conditionMonitor.checkConditions()`
  3. If ready, call `llmExecutionBrain.decideTrade()`
- Remove Flow V2 dependency from processCandle
- Keep existing helper methods (calculateEMA, ATR, etc.)

### 2. `/src/services/goal-session-live-engine.ts`
**Changes:**
- Remove "5-layer pipeline" messaging
- Update initialization to load trader score
- Add strategy planning on session start
- Update polling to use condition monitoring
- Integrate reward engine on trade close
- Add performance analyzer calls

### 3. `/src/services/llm-snapshot-builder.ts`
**Changes:**
- Add EMA200 calculation
- Add Stoch RSI calculation
- Add swing high/low detection
- Add compressed snapshot builder for strategy planning
- Add micro snapshot builder for execution

### 4. Delete These Files:
- `/src/services/llm-regime-validator.ts`
- `/src/services/llm-setup-quality.ts`
- `/src/services/llm-mistake-prevention.ts`
- `/src/services/llm-confidence-calibrator.ts`
- `/src/services/avoid-pattern-enforcer.ts`

### 5. `/src/services/trigger-detection-rules.ts`
**Status:** Keep for now (used by condition monitor)
**Future:** May be replaced entirely by LLM-defined conditions

---

## Implementation Steps

### Step 1: Update event-based-llm-engine.ts
```typescript
// Add imports
import { rewardEngine } from './reward-engine';
import { llmStrategyBrain } from './llm-strategy-brain';
import { conditionMonitor } from './condition-monitor';
import { llmExecutionBrain } from './llm-execution-brain';
import { safetyEnforcer } from './safety-enforcer';
import { performanceAnalyzer } from './performance-analyzer';

// Add class properties
private currentStrategy: StrategyPlan | null = null;
private traderScore: TraderScore | null = null;
private strategyPlanCount: number = 0;

// Replace processCandle() method
async processCandle(
  candles: any[],
  config: EventBasedEngineConfig,
  openTrades: SimulatedTrade[] = []
): Promise<{ trade: SimulatedTrade | null; llmCalled: boolean }> {

  // 1. Load trader score if not loaded
  if (!this.traderScore) {
    this.traderScore = await rewardEngine.loadTraderScore(this.userId);
  }

  // 2. Plan strategy if not planned or every N candles
  if (!this.currentStrategy || this.strategyPlanCount >= 100) {
    const snapshot = this.buildStrategySnapshot(candles, config);
    this.currentStrategy = await llmStrategyBrain.planStrategy(
      snapshot,
      this.traderScore
    );
    this.strategyPlanCount = 0;
  }
  this.strategyPlanCount++;

  // 3. Check conditions (NO LLM)
  const marketState = this.buildMarketState(candles);
  const conditionCheck = conditionMonitor.checkConditions(
    this.currentStrategy,
    marketState
  );

  if (!conditionCheck.ready) {
    return { trade: null, llmCalled: false };
  }

  // 4. Execute decision (LLM call)
  const microSnapshot = this.buildMicroSnapshot(candles, marketState);
  const decision = await llmExecutionBrain.decideTrade(
    conditionCheck.trigger,
    microSnapshot,
    this.traderScore,
    this.currentStrategy.mode,
    conditionCheck.conditionsMet
  );

  if (decision.action === 'NO_TRADE') {
    return { trade: null, llmCalled: true };
  }

  // 5. Safety validation
  const safetyCheck = safetyEnforcer.validateTrade(decision, {
    balance: config.initialBalance || 10000,
    currentExposure: this.calculateExposure(openTrades),
    openTrades: openTrades.length,
    dailyDrawdown: this.calculateDrawdown(),
    atr: marketState.atr,
    currentPrice: marketState.price
  });

  if (!safetyCheck.passed) {
    console.warn('[Event Engine] Trade blocked by safety enforcer');
    return { trade: null, llmCalled: true };
  }

  // 6. Create trade
  const trade = this.createTradeFromDecision(decision, candles);
  return { trade, llmCalled: true };
}
```

### Step 2: Add trade close handler
```typescript
async onTradeClose(
  trade: SimulatedTrade,
  config: EventBasedEngineConfig
): Promise<void> {
  if (!this.userId || !this.traderScore) return;

  // Calculate outcome
  const outcome = trade.pnl > 0 ? 'win' : trade.pnl < 0 ? 'loss' : 'breakeven';

  const tradeContext = {
    symbol: trade.symbol,
    direction: trade.direction,
    entry_price: trade.entryPrice,
    exit_price: trade.exitPrice!,
    pnl: trade.pnl,
    risk_amount: (config.initialBalance || 10000) * 0.03,
    duration_minutes: trade.holdingMinutes || 0,
    max_drawdown: 0,
    atr: 0,
    outcome
  };

  // Apply reward/penalty
  let scoreImpact;
  if (outcome === 'win') {
    scoreImpact = await rewardEngine.applyWinReward(
      this.userId,
      tradeContext,
      this.traderScore
    );
  } else if (outcome === 'loss') {
    scoreImpact = await rewardEngine.applyLossPenalty(
      this.userId,
      tradeContext,
      this.traderScore
    );
  }

  // Reload score
  this.traderScore = await rewardEngine.loadTraderScore(this.userId);

  // Analyze performance
  if (scoreImpact) {
    await performanceAnalyzer.analyzeTradePerformance(
      this.userId,
      tradeContext,
      scoreImpact,
      trade.id
    );
  }
}
```

### Step 3: Update goal-session-live-engine.ts
```typescript
// Add to startSession()
// After line 136 (this.activeSession = config.goalSessionId)

// Load trader score
const traderScore = await rewardEngine.loadTraderScore(config.userId);
console.log(`[Goal Live] Trader Score: ${traderScore.current_score}/100`);
console.log(`[Goal Live] Personality: ${traderScore.confidence_level}`);
console.log(`[Goal Live] Risk Appetite: ${traderScore.risk_appetite}%`);

// Initialize autonomous brain
await eventBasedLLMEngine.initialize(config.userId, config.goalSessionId);
console.log('✅ Autonomous Pipnosis Alpha Brain ACTIVATED');
console.log('✅ Strategy planning + condition monitoring enabled');

// Remove old 5-layer pipeline code (lines 141-145)
// Delete:
// eventBasedLLMEngine.set5LayerPipeline(true);
// logger.info(LogCategory.AI_TRADING, '✅ 5-Layer LLM Pipeline ACTIVATED');
```

### Step 4: Enhance llm-snapshot-builder.ts
Add these methods:
```typescript
// Add EMA200 calculation
calculateEMA200(closes: number[]): number {
  return this.calculateEMA(closes, 200);
}

// Add Stoch RSI
calculateStochRSI(closes: number[], period: number = 14): number {
  const rsi = this.calculateRSI(closes, period);
  const rsiPeriod = closes.slice(-period).map((_, i) =>
    this.calculateRSI(closes.slice(0, closes.length - period + i + 1), period)
  );

  const minRSI = Math.min(...rsiPeriod);
  const maxRSI = Math.max(...rsiPeriod);

  if (maxRSI === minRSI) return 50;
  return ((rsi - minRSI) / (maxRSI - minRSI)) * 100;
}

// Detect swing high/low
detectSwingLevels(candles: any[]): { high: number; low: number } {
  const recentCandles = candles.slice(-20);
  const highs = recentCandles.map(c => c.high);
  const lows = recentCandles.map(c => c.low);

  return {
    high: Math.max(...highs),
    low: Math.min(...lows)
  };
}
```

### Step 5: Delete old layer files
```bash
rm src/services/llm-regime-validator.ts
rm src/services/llm-setup-quality.ts
rm src/services/llm-mistake-prevention.ts
rm src/services/llm-confidence-calibrator.ts
rm src/services/avoid-pattern-enforcer.ts
```

---

## Testing Checklist

After implementation:
- [ ] Build passes without errors
- [ ] Can start goal session
- [ ] Strategy brain plans strategy
- [ ] Condition monitor detects triggers
- [ ] Execution brain makes decisions
- [ ] Safety enforcer validates
- [ ] Trades execute correctly
- [ ] Score updates on trade close
- [ ] Performance analysis runs
- [ ] Personality changes when score changes

---

## Rollback Plan

If anything breaks:
1. Revert event-based-llm-engine.ts
2. Restore old layer files from git
3. Revert goal-session-live-engine.ts changes
4. System will work as before

---

## Success Metrics

After integration:
- ✅ No compilation errors
- ✅ Session starts successfully
- ✅ Token usage drops 90%+
- ✅ Trader score updates correctly
- ✅ Strategy plans generated
- ✅ Conditions monitored
- ✅ Trades execute with personality context

---

## Next Session Tasks

1. Implement all changes above
2. Test thoroughly
3. Deploy to production
4. Monitor first autonomous trades
5. Celebrate! 🎉
