# AI Training Lab & Learning Center - Complete System Documentation

## SYSTEM OVERVIEW

This document provides a comprehensive, prompt-based specification for implementing an AI Trading Learning System. The system enables an AI to learn from both synthetic backtests and live demo trading, continuously improving its decision-making through pattern recognition, weighted learning, and skill progression tracking.

---

## TABLE OF CONTENTS

1. [Core Concept & Learning Loop](#core-concept--learning-loop)
2. [Database Schema](#database-schema)
3. [Service Layer Architecture](#service-layer-architecture)
4. [Learning Weight System](#learning-weight-system)
5. [UI Components](#ui-components)
6. [Complete Learning Flow](#complete-learning-flow)
7. [Mathematical Models](#mathematical-models)
8. [Troubleshooting & Recovery](#troubleshooting--recovery)

---

## CORE CONCEPT & LEARNING LOOP

### The Big Picture

The AI Trading System has TWO ways of learning:

1. **Synthetic Backtesting** (Training Mode): AI-generated market data for rapid testing
2. **Live Demo Trading** (Production Mode): Real market trades with actual execution

**Key Innovation**: Live trades are weighted 2x more heavily than backtest trades because real market experience is more valuable than simulated data.

### The Complete Learning Cycle

```
┌─────────────────────────────────────────────────────────────┐
│                   LEARNING CYCLE                              │
│                                                               │
│  1. TRAINING PHASE (Synthetic Backtest)                      │
│     → Run backtest with synthetic data                       │
│     → Execute 30-50 trades                                   │
│     → AI analyzes each trade                                 │
│     → Extract patterns (winning, losing, timing)             │
│     → Store insights with 1.0x weight                        │
│                                                               │
│  2. APPLICATION PHASE (Live Trading)                         │
│     → New trade signal appears                               │
│     → AI Decision Advisor evaluates signal                   │
│     → Queries learned patterns (2x weight for live)          │
│     → Calculates Expected Value (EV)                         │
│     → Adjusts confidence based on history                    │
│     → Decision: TAKE or SKIP trade                           │
│                                                               │
│  3. EXECUTION PHASE (Trade Closes)                           │
│     → Live trade completes (hit SL/TP)                       │
│     → Auto-trigger learning analysis (30 sec)                │
│     → Analyze trade with 2.0x weight                         │
│     → Update skill progression (only if WIN)                 │
│     → Extract new insights                                   │
│                                                               │
│  4. EVOLUTION PHASE (Continuous Improvement)                 │
│     → Track performance evolution daily                      │
│     → Calculate optimal confidence thresholds                │
│     → Adjust pattern weights based on success               │
│     → Level up AI skill when milestones reached             │
│     → Return to APPLICATION PHASE                           │
└─────────────────────────────────────────────────────────────┘
```

---

## DATABASE SCHEMA

### Core Learning Tables

#### 1. ai_learning_insights
Stores extracted patterns and learnings from trades.

```sql
CREATE TABLE ai_learning_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Source tracking
  backtest_session_id uuid REFERENCES backtest_sessions(id),
  synthetic_session_id uuid REFERENCES synthetic_backtest_sessions(id),
  live_trade_id uuid REFERENCES trade_history(id),
  is_from_live_trading boolean DEFAULT false,
  learned_from_live_trading boolean DEFAULT false,
  learning_weight numeric(3,1) DEFAULT 1.0, -- 2.0 for live, 1.0 for backtest
  
  -- Pattern identification
  insight_type text NOT NULL CHECK (insight_type IN (
    'winning_pattern', 'losing_pattern', 'optimal_timing',
    'risk_management', 'market_condition', 'strategy_preference'
  )),
  symbol text NOT NULL,
  timeframe text NOT NULL,
  
  -- Market context
  market_scenario text NOT NULL,
  volatility_level text NOT NULL,
  trend_direction text NOT NULL,
  
  -- The insight itself
  insight_title text NOT NULL,
  insight_description text NOT NULL,
  pattern_features jsonb NOT NULL,
  
  -- Performance metrics
  sample_size integer NOT NULL,
  win_rate numeric NOT NULL,
  avg_profit_factor numeric NOT NULL,
  confidence_score numeric NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
  
  -- Application rules
  recommended_action text NOT NULL,
  apply_when_conditions jsonb NOT NULL,
  avoid_when_conditions jsonb NOT NULL,
  
  -- Tracking
  times_applied integer DEFAULT 0,
  success_rate_when_applied numeric DEFAULT 0,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

**Key Fields Explained**:
- `learning_weight`: 2.0 for live trades (2x impact), 1.0 for backtests
- `insight_type`: What kind of pattern (winning, losing, timing, etc.)
- `confidence_score`: How reliable this insight is (0-100)
- `success_rate_when_applied`: Track if following this insight leads to wins

#### 2. ai_trade_analysis
Deep analysis of individual trades.

```sql
CREATE TABLE ai_trade_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Trade reference (one of these will be set)
  backtest_trade_id uuid REFERENCES backtest_trades(id),
  synthetic_trade_id uuid REFERENCES synthetic_backtest_trades(id),
  live_trade_id uuid REFERENCES trade_history(id),
  
  -- Trade basics
  symbol text NOT NULL,
  direction text NOT NULL,
  outcome text NOT NULL, -- 'win', 'loss', 'breakeven'
  pnl numeric NOT NULL,
  
  -- Entry analysis
  entry_time timestamptz NOT NULL,
  entry_confidence integer NOT NULL,
  entry_market_conditions jsonb NOT NULL,
  entry_quality_score integer CHECK (entry_quality_score >= 0 AND entry_quality_score <= 100),
  
  -- Decision reasoning
  decision_reasoning text NOT NULL,
  matching_historical_patterns text[],
  ai_conviction_level integer NOT NULL,
  risk_reward_at_entry numeric NOT NULL,
  
  -- Exit analysis
  exit_time timestamptz NOT NULL,
  exit_reason text NOT NULL,
  was_exit_optimal boolean NOT NULL,
  
  -- Learnings extracted
  key_learnings text[] NOT NULL,
  mistakes_identified text[],
  what_worked text[],
  what_failed text[],
  
  -- Pattern tracking
  similar_trades_count integer DEFAULT 0,
  similar_trades_win_rate numeric DEFAULT 0,
  is_pattern_repeating boolean DEFAULT false,
  
  -- EV and quality metrics
  realized_rr numeric,
  mae numeric, -- Maximum Adverse Excursion
  mfe numeric, -- Maximum Favorable Excursion
  expected_value numeric,
  trade_quality_score numeric,
  volatility_regime text,
  
  created_at timestamptz DEFAULT now()
);
```

#### 3. ai_performance_evolution
Tracks AI improvement over time.

```sql
CREATE TABLE ai_performance_evolution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Time period
  measurement_date date NOT NULL,
  period_type text NOT NULL CHECK (period_type IN ('daily', 'weekly', 'monthly')),
  
  -- Symbol & strategy
  symbol text NOT NULL,
  strategy_name text NOT NULL, -- 'Flow Trader V2', 'Live Demo Trading', etc.
  
  -- Core metrics
  total_trades integer NOT NULL,
  win_rate numeric NOT NULL,
  profit_factor numeric NOT NULL,
  avg_rr numeric NOT NULL,
  
  -- Confidence optimization
  confidence_threshold_used integer NOT NULL,
  threshold_was_optimal boolean NOT NULL,
  optimal_threshold_calculated integer,
  
  -- AI decision tracking
  insights_applied integer DEFAULT 0,
  ai_decisions_made integer DEFAULT 0,
  ai_decision_accuracy numeric DEFAULT 0,
  
  -- Improvement metrics
  is_improving boolean NOT NULL,
  learning_summary text,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  UNIQUE(user_id, symbol, strategy_name, measurement_date, period_type)
);
```

#### 4. ai_decision_feedback
Logs AI decisions for future learning.

```sql
CREATE TABLE ai_decision_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Decision context
  decision_time timestamptz NOT NULL,
  decision_type text NOT NULL CHECK (decision_type IN (
    'take_trade', 'skip_trade', 'close_early', 'hold_longer'
  )),
  
  -- Trade info
  symbol text NOT NULL,
  direction text,
  signal_strength integer NOT NULL,
  
  -- AI reasoning
  ai_confidence integer NOT NULL,
  ai_reasoning text NOT NULL,
  key_factors jsonb NOT NULL,
  historical_success_rate numeric,
  
  -- Decision made
  decision_made boolean NOT NULL,
  decision_rationale text NOT NULL,
  
  -- Outcome (filled after trade completes)
  actual_outcome text,
  was_decision_correct boolean,
  pnl_if_taken numeric,
  decision_quality_score integer CHECK (decision_quality_score >= 0 AND decision_quality_score <= 100),
  should_repeat_in_future boolean,
  
  -- Pattern matching
  matched_patterns text[],
  
  created_at timestamptz DEFAULT now()
);
```

#### 5. trade_history (Enhanced for AI)
Live trading history with AI metadata.

```sql
-- Add these columns to existing trade_history table
ALTER TABLE trade_history ADD COLUMN confidence_score numeric(5,2) DEFAULT 75.0;
ALTER TABLE trade_history ADD COLUMN setup_type text;
ALTER TABLE trade_history ADD COLUMN market_conditions jsonb DEFAULT '{}'::jsonb;
ALTER TABLE trade_history ADD COLUMN ai_decision_id uuid REFERENCES ai_decision_feedback(id);
ALTER TABLE trade_history ADD COLUMN ai_analyzed boolean DEFAULT false;
ALTER TABLE trade_history ADD COLUMN ai_analyzed_at timestamptz;
```

#### 6. trade_learning_log
Audit trail of AI learning events.

```sql
CREATE TABLE trade_learning_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  trade_id uuid NOT NULL REFERENCES trade_history(id) ON DELETE CASCADE,
  analyzed_at timestamptz DEFAULT now(),
  
  -- Trade details
  symbol text NOT NULL,
  position_type text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('win', 'loss', 'breakeven')),
  pnl numeric(15,2) NOT NULL,
  confidence_at_entry numeric(5,2),
  
  -- What was learned
  patterns_identified text[] DEFAULT ARRAY[]::text[],
  insights_created integer DEFAULT 0,
  key_learnings text[] DEFAULT ARRAY[]::text[],
  mistakes_identified text[] DEFAULT ARRAY[]::text[],
  
  -- Learning quality
  learning_quality_score numeric(5,2) DEFAULT 0,
  will_improve_future_decisions boolean DEFAULT true,
  similar_historical_trades_count integer DEFAULT 0,
  
  -- Metadata
  learning_source text DEFAULT 'live_trading' CHECK (learning_source IN (
    'live_trading', 'synthetic_backtest', 'historical_backtest'
  )),
  processing_time_ms integer,
  
  created_at timestamptz DEFAULT now()
);
```

#### 7. ai_skill_progression
Tracks AI skill level advancement.

```sql
CREATE TABLE ai_skill_progression (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Skill level
  current_skill_level text NOT NULL CHECK (current_skill_level IN (
    'Novice', 'Intermediate', 'Pro', 'Expert', 'Master', 'Exceptional'
  )),
  skill_level_numeric integer NOT NULL DEFAULT 1, -- 1-6
  progress_to_next_level_percent numeric(5,2) NOT NULL DEFAULT 0,
  
  -- Cumulative stats (ONLY WINNING TRADES COUNT)
  total_trades_analyzed integer NOT NULL DEFAULT 0,
  total_backtests_completed integer NOT NULL DEFAULT 0,
  
  -- Performance metrics
  current_win_rate numeric(5,2) NOT NULL DEFAULT 0,
  target_win_rate numeric(5,2) NOT NULL DEFAULT 80.00,
  gap_to_target numeric(5,2) NOT NULL DEFAULT 80.00,
  current_profit_factor numeric(10,2) NOT NULL DEFAULT 0,
  
  -- Learning velocity
  learning_velocity_score numeric(5,2) NOT NULL DEFAULT 0,
  win_rate_30d_change numeric(5,2) NOT NULL DEFAULT 0,
  
  -- Pattern recognition
  total_patterns_learned integer NOT NULL DEFAULT 0,
  winning_patterns_count integer NOT NULL DEFAULT 0,
  losing_patterns_count integer NOT NULL DEFAULT 0,
  
  -- Estimates
  trades_needed_for_next_level integer NOT NULL DEFAULT 0,
  estimated_trades_to_master integer,
  estimated_trades_to_exceptional integer,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

**Skill Level Thresholds**:
```javascript
const SKILL_THRESHOLDS = [
  { level: 'Novice', minTrades: 0, minWinRate: 0, minProfitFactor: 0 },
  { level: 'Intermediate', minTrades: 100, minWinRate: 45, minProfitFactor: 1.0 },
  { level: 'Pro', minTrades: 500, minWinRate: 55, minProfitFactor: 1.2 },
  { level: 'Expert', minTrades: 1500, minWinRate: 65, minProfitFactor: 1.5 },
  { level: 'Master', minTrades: 5000, minWinRate: 70, minProfitFactor: 1.8 },
  { level: 'Exceptional', minTrades: 10000, minWinRate: 80, minProfitFactor: 2.0 }
];
```

**IMPORTANT**: Only winning trades count toward skill progression. This ensures the AI truly masters profitable patterns.

---

## SERVICE LAYER ARCHITECTURE

### 1. AI Learning Engine (`ai-learning-engine.ts`)

**Purpose**: Analyzes trades and extracts learnings.

**Core Methods**:

```typescript
class AILearningEngine {
  /**
   * Analyze a completed synthetic backtest session
   * @param userId - User ID
   * @param sessionId - Backtest session ID
   * @param trades - Array of trade data
   * @param sessionType - 'synthetic' or 'real'
   */
  async analyzeBacktestSession(
    userId: string,
    sessionId: string,
    trades: TradeForAnalysis[],
    sessionType: 'synthetic' | 'real'
  ): Promise<void> {
    // 1. Analyze each trade individually
    await this.analyzeTrades(userId, sessionId, trades, sessionType);
    
    // 2. Extract winning patterns (high win rate setups)
    const winningPatterns = await this.extractWinningPatterns(userId, trades);
    await this.saveInsights(userId, sessionId, winningPatterns, sessionType);
    
    // 3. Extract losing patterns (setups to avoid)
    const losingPatterns = await this.extractLosingPatterns(userId, trades);
    await this.saveInsights(userId, sessionId, losingPatterns, sessionType);
    
    // 4. Analyze optimal timing (winners close faster than losers?)
    const timingInsights = await this.analyzeOptimalTiming(userId, trades);
    await this.saveInsights(userId, sessionId, timingInsights, sessionType);
    
    // 5. Update market scenario performance
    await this.analyzeMarketScenarioPerformance(userId, trades);
    
    // 6. Update performance evolution metrics
    await this.updatePerformanceEvolution(userId, trades);
  }
  
  /**
   * Analyze a single live trade (2x weight)
   * @param userId - User ID
   * @param tradeId - Live trade ID from trade_history
   */
  async analyzeLiveTrade(
    userId: string,
    tradeId: string
  ): Promise<{ success: boolean; learningsExtracted: number }> {
    // 1. Fetch trade from trade_history
    const trade = await supabase
      .from('trade_history')
      .select('*')
      .eq('id', tradeId)
      .single();
    
    // 2. Check if already analyzed
    if (trade.ai_analyzed) return { success: true, learningsExtracted: 0 };
    
    // 3. Analyze the trade
    const analysis = await this.analyzeIndividualTrade(trade, historicalTrades);
    
    // 4. Store analysis with live_trade_id
    await supabase.from('ai_trade_analysis').insert({
      user_id: userId,
      live_trade_id: tradeId,
      // ... trade analysis data
    });
    
    // 5. Extract and save insights with 2.0x weight
    let insightsCreated = 0;
    const insights = await this.extractPatternsFromTrade(trade);
    
    for (const insight of insights) {
      await supabase.from('ai_learning_insights').insert({
        user_id: userId,
        live_trade_id: tradeId,
        learned_from_live_trading: true,
        learning_weight: 2.0, // 2x weight for live trades!
        // ... insight data
      });
      insightsCreated++;
    }
    
    // 6. Update market scenario performance for live trading
    await this.updateMarketScenarioPerformanceLive(userId, trade);
    
    // 7. Update performance evolution
    await this.updatePerformanceEvolutionLive(userId, trade);
    
    // 8. Log the learning event
    await supabase.from('trade_learning_log').insert({
      user_id: userId,
      trade_id: tradeId,
      insights_created: insightsCreated,
      learning_source: 'live_trading',
      // ... logging data
    });
    
    // 9. Mark trade as analyzed
    await supabase
      .from('trade_history')
      .update({ ai_analyzed: true, ai_analyzed_at: new Date() })
      .eq('id', tradeId);
    
    return { success: true, learningsExtracted: insightsCreated };
  }
}
```

**Pattern Extraction Logic**:

```typescript
/**
 * Extract winning patterns from successful trades
 */
private async extractWinningPatterns(
  userId: string,
  trades: TradeForAnalysis[]
): Promise<LearningInsight[]> {
  const insights: LearningInsight[] = [];
  const winningTrades = trades.filter(t => t.outcome === 'win');
  
  // Need at least 3 winners to identify a pattern
  if (winningTrades.length < 3) return insights;
  
  // Group by symbol
  const symbolGroups = this.groupBySymbol(winningTrades);
  
  for (const [symbol, symbolTrades] of Object.entries(symbolGroups)) {
    const totalSymbolTrades = trades.filter(t => t.symbol === symbol).length;
    const winRate = (symbolTrades.length / totalSymbolTrades) * 100;
    
    // If win rate is 60% or higher, it's a winning pattern
    if (winRate >= 60) {
      insights.push({
        type: 'winning_pattern',
        title: `High Win Rate Pattern - ${symbol}`,
        description: `${symbol} shows consistent winning pattern with ${winRate.toFixed(1)}% win rate.`,
        confidence: Math.min(95, winRate),
        applicableConditions: {
          symbol,
          minConfidence: this.calculateOptimalConfidence(symbolTrades),
          avgHoldTime: this.calculateAvgHoldTime(symbolTrades)
        }
      });
    }
  }
  
  // Analyze by confidence level
  const highConfidenceWins = winningTrades.filter(t => t.confidence >= 80);
  if (highConfidenceWins.length >= 3) {
    const highConfWinRate = (highConfidenceWins.length / 
                             trades.filter(t => t.confidence >= 80).length) * 100;
    
    insights.push({
      type: 'winning_pattern',
      title: 'High Confidence Signals Perform Well',
      description: `Trades with 80%+ confidence have ${highConfWinRate.toFixed(1)}% win rate.`,
      confidence: highConfWinRate,
      applicableConditions: {
        minConfidence: 80,
        recommendAction: 'increase_position_size'
      }
    });
  }
  
  return insights;
}

/**
 * Extract losing patterns to avoid
 */
private async extractLosingPatterns(
  userId: string,
  trades: TradeForAnalysis[]
): Promise<LearningInsight[]> {
  const insights: LearningInsight[] = [];
  const losingTrades = trades.filter(t => t.outcome === 'loss');
  
  // Identify low confidence losses
  const lowConfidenceLosses = losingTrades.filter(t => t.confidence < 70);
  if (lowConfidenceLosses.length >= 2) {
    const lowConfLossRate = (lowConfidenceLosses.length / 
                             trades.filter(t => t.confidence < 70).length) * 100;
    
    insights.push({
      type: 'losing_pattern',
      title: 'Low Confidence Signals Often Fail',
      description: `Signals below 70% confidence have ${lowConfLossRate.toFixed(1)}% loss rate.`,
      confidence: 80,
      applicableConditions: {
        maxConfidence: 70,
        recommendAction: 'skip_trade'
      }
    });
  }
  
  // Identify problematic symbols
  const symbolGroups = this.groupBySymbol(losingTrades);
  for (const [symbol, symbolTrades] of Object.entries(symbolGroups)) {
    const totalSymbolTrades = trades.filter(t => t.symbol === symbol).length;
    const lossRate = (symbolTrades.length / totalSymbolTrades) * 100;
    
    if (lossRate >= 60 && symbolTrades.length >= 3) {
      insights.push({
        type: 'losing_pattern',
        title: `Poor Performance on ${symbol}`,
        description: `${symbol} has ${lossRate.toFixed(1)}% loss rate.`,
        confidence: lossRate,
        applicableConditions: {
          symbol,
          recommendAction: 'increase_confidence_threshold_or_avoid'
        }
      });
    }
  }
  
  return insights;
}
```

### 2. AI Decision Advisor (`ai-decision-advisor.ts`)

**Purpose**: Evaluates trade signals using learned knowledge.

**Core Method**:

```typescript
class AIDecisionAdvisor {
  /**
   * Evaluate if we should take a trade signal
   * @param userId - User ID
   * @param signal - Trade signal to evaluate
   * @returns Decision advice with adjusted confidence
   */
  async evaluateTradeSignal(
    userId: string,
    signal: TradeSignal
  ): Promise<AIDecisionAdvice> {
    // 1. Get relevant learning insights (sorted by learning_weight DESC)
    const insights = await this.getRelevantInsights(userId, signal);
    
    // 2. Get market scenario performance
    const scenarioPerformance = await this.getScenarioPerformance(userId, signal);
    
    // 3. Get similar historical trades
    const similarTrades = await this.getSimilarHistoricalTrades(userId, signal);
    
    // 4. Calculate Expected Value (HIGHEST PRIORITY)
    const evResult = await evCalculator.calculateSignalEV(userId, {
      symbol: signal.symbol,
      direction: signal.direction,
      entryPrice: signal.entryPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      patternName: signal.setupType
    });
    
    // 5. Calculate adjusted confidence
    const adjustedConfidence = this.calculateAdjustedConfidence(
      signal,
      insights,
      scenarioPerformance,
      similarTrades,
      evResult
    );
    
    // 6. Make decision
    const decision = await this.makeDecision(
      signal,
      adjustedConfidence,
      insights,
      scenarioPerformance,
      userId,
      evResult
    );
    
    // 7. Log decision for future learning
    await this.logDecision(userId, signal, decision);
    
    return decision;
  }
  
  /**
   * Calculate adjusted confidence based on learned patterns
   */
  private calculateAdjustedConfidence(
    signal: TradeSignal,
    insights: any[],
    scenarioPerformance: any,
    similarTrades: any[],
    evResult?: any
  ): number {
    let adjustedConfidence = signal.confidence;
    
    // Factor 0: Expected Value (HIGHEST PRIORITY)
    if (evResult) {
      if (evResult.expectedValue > 10 && evResult.recommendation === 'take') {
        adjustedConfidence += 15;
      } else if (evResult.expectedValue < 0 && evResult.isStatisticallySignificant) {
        adjustedConfidence -= 20;
      }
    }
    
    // Factor 1: Winning patterns (weighted by learning_weight)
    const winningPatterns = insights.filter(i => i.insight_type === 'winning_pattern');
    if (winningPatterns.length > 0) {
      const totalWeight = winningPatterns.reduce((sum, p) => sum + (p.learning_weight || 1.0), 0);
      const avgWeight = totalWeight / winningPatterns.length;
      
      const boost = Math.round(5 * avgWeight); // 5% * avg weight
      adjustedConfidence += boost;
      
      // Live patterns have more impact (weight = 2.0)
      // Backtest patterns have less impact (weight = 1.0)
    }
    
    // Factor 2: Losing patterns (weighted by learning_weight)
    const losingPatterns = insights.filter(i => i.insight_type === 'losing_pattern');
    if (losingPatterns.length > 0) {
      const totalWeight = losingPatterns.reduce((sum, p) => sum + (p.learning_weight || 1.0), 0);
      const avgWeight = totalWeight / losingPatterns.length;
      
      const penalty = Math.round(10 * avgWeight); // 10% * avg weight
      adjustedConfidence -= penalty;
    }
    
    // Factor 3: Market scenario performance
    if (scenarioPerformance) {
      if (scenarioPerformance.win_rate >= 65 && scenarioPerformance.trades_taken >= 10) {
        adjustedConfidence += 10;
      } else if (scenarioPerformance.win_rate < 50 && scenarioPerformance.trades_taken >= 10) {
        adjustedConfidence -= 15;
      }
    }
    
    // Factor 4: Similar historical trades
    if (similarTrades.length >= 5) {
      const wins = similarTrades.filter(t => t.outcome === 'win').length;
      const historicalWinRate = (wins / similarTrades.length) * 100;
      
      if (historicalWinRate >= 70) {
        adjustedConfidence += 8;
      } else if (historicalWinRate < 45) {
        adjustedConfidence -= 12;
      }
    }
    
    // Clamp between 0-100
    adjustedConfidence = Math.max(0, Math.min(100, adjustedConfidence));
    
    return Math.round(adjustedConfidence);
  }
}
```

### 3. Live Trade Learning Trigger (`live-trade-learning-trigger.ts`)

**Purpose**: Automatically triggers AI learning when trades close.

```typescript
class LiveTradeLearningTrigger {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private pollInterval = 30000; // 30 seconds
  
  /**
   * Start monitoring for new closed trades
   */
  start(userId: string) {
    console.log('[LiveTradeLearningTrigger] Starting monitor');
    this.isRunning = true;
    
    // Check immediately
    this.checkForNewTrades(userId);
    
    // Then check every 30 seconds
    this.intervalId = setInterval(() => {
      this.checkForNewTrades(userId);
    }, this.pollInterval);
  }
  
  /**
   * Check for unanalyzed trades
   */
  private async checkForNewTrades(userId: string) {
    const { data: unanalyzedTrades } = await supabase
      .from('trade_history')
      .select('id, symbol, closed_at')
      .eq('user_id', userId)
      .eq('ai_analyzed', false)
      .order('closed_at', { ascending: true })
      .limit(10);
    
    if (!unanalyzedTrades || unanalyzedTrades.length === 0) return;
    
    console.log(`Found ${unanalyzedTrades.length} trades to analyze`);
    
    // Analyze each trade
    for (const trade of unanalyzedTrades) {
      await this.analyzeTrade(userId, trade.id, trade.symbol);
    }
  }
  
  /**
   * Analyze a single trade and update skill progression
   */
  private async analyzeTrade(userId: string, tradeId: string, symbol: string) {
    // Trigger AI learning analysis
    const result = await aiLearningEngine.analyzeLiveTrade(userId, tradeId);
    
    if (result.success) {
      console.log(`Analysis complete: ${result.learningsExtracted} insights (2x weighted)`);
      
      // Fetch trade details
      const { data: trade } = await supabase
        .from('trade_history')
        .select('*')
        .eq('id', tradeId)
        .single();
      
      if (trade) {
        const isWinningTrade = parseFloat(trade.profit_loss) > 0;
        
        // ONLY update skill progression if trade was a winner
        if (isWinningTrade) {
          console.log('Trade was profitable! Adding to skill progression (1.5x weight)');
          
          await aiSkillTracker.updateAfterLiveTrading(
            userId,
            1, // 1 winning trade
            100, // 100% win rate for this single winning trade
            2.0, // Profit factor
            result.learningsExtracted
          );
        } else {
          console.log('Trade was a loss - no progress added (learning still recorded)');
        }
      }
    }
  }
}
```

### 4. AI Skill Tracker (`ai-skill-tracker.ts`)

**Purpose**: Tracks AI skill progression through levels.

```typescript
class AISkillTracker {
  /**
   * Update skill progression after live trading (1.5x impact)
   */
  async updateAfterLiveTrading(
    userId: string,
    winningTradesCount: number, // Only winning trades!
    winRate: number,
    profitFactor: number,
    patternsLearned: number
  ): Promise<void> {
    // Live trades count as 1.5x toward skill progression
    const effectiveTradeCount = Math.ceil(winningTradesCount * 1.5);
    
    // Delegate to backtest update with multiplied count
    await this.updateAfterBacktest(
      userId,
      effectiveTradeCount,
      winRate,
      profitFactor,
      patternsLearned,
      0, // Not a synthetic backtest
      true // Is from live trading
    );
  }
  
  /**
   * Update skill progression after backtest
   */
  async updateAfterBacktest(
    userId: string,
    totalWinningTrades: number, // ONLY WINNERS
    winRate: number,
    profitFactor: number,
    patternsLearned: number,
    syntheticBacktestCount: number = 0,
    isFromLiveTrading: boolean = false
  ): Promise<void> {
    // Get or create skill progression record
    let skillData = await this.getSkillProgression(userId);
    
    if (!skillData) {
      skillData = await this.createSkillProgression(userId);
    }
    
    // Update cumulative stats (ONLY winning trades count!)
    const newTotalTrades = skillData.totalTradesAnalyzed + totalWinningTrades;
    const newWinRate = ((skillData.currentWinRate * skillData.totalTradesAnalyzed) +
                       (winRate * totalWinningTrades)) / newTotalTrades;
    const newProfitFactor = ((skillData.currentProfitFactor * skillData.totalTradesAnalyzed) +
                            (profitFactor * totalWinningTrades)) / newTotalTrades;
    
    // Calculate new skill level
    const newSkillLevel = this.calculateSkillLevel(newTotalTrades, newWinRate, newProfitFactor);
    const newSkillLevelNumeric = this.getSkillLevelNumeric(newSkillLevel);
    
    // Check for level up
    const leveledUp = newSkillLevelNumeric > skillData.skillLevelNumeric;
    
    if (leveledUp) {
      await this.recordMilestone(userId, {
        milestoneType: 'skill_level_up',
        milestoneTitle: `Advanced to ${newSkillLevel}!`,
        milestoneDescription: `AI reached ${newSkillLevel} skill level with ${newTotalTrades} winning trades`,
        skillLevelAtAchievement: newSkillLevel,
        totalTradesAtAchievement: newTotalTrades,
        winRateAtAchievement: newWinRate
      });
    }
    
    // Calculate progress to next level
    const thresholds = this.getSkillLevelThresholds();
    const currentThreshold = thresholds[newSkillLevelNumeric - 1];
    const nextThreshold = thresholds[newSkillLevelNumeric] || currentThreshold;
    
    const tradesNeeded = nextThreshold.minTrades - newTotalTrades;
    const progressPercent = ((newTotalTrades - currentThreshold.minTrades) /
                            (nextThreshold.minTrades - currentThreshold.minTrades)) * 100;
    
    // Update database
    await supabase
      .from('ai_skill_progression')
      .update({
        current_skill_level: newSkillLevel,
        skill_level_numeric: newSkillLevelNumeric,
        total_trades_analyzed: newTotalTrades,
        current_win_rate: newWinRate,
        current_profit_factor: newProfitFactor,
        progress_to_next_level_percent: Math.max(0, Math.min(100, progressPercent)),
        trades_needed_for_next_level: Math.max(0, tradesNeeded),
        total_patterns_learned: skillData.totalPatternsLearned + patternsLearned,
        gap_to_target: 80.0 - newWinRate,
        updated_at: new Date()
      })
      .eq('user_id', userId);
  }
  
  /**
   * Skill level thresholds
   */
  getSkillLevelThresholds() {
    return [
      { level: 'Novice', minTrades: 0, minWinRate: 0, minProfitFactor: 0 },
      { level: 'Intermediate', minTrades: 100, minWinRate: 45, minProfitFactor: 1.0 },
      { level: 'Pro', minTrades: 500, minWinRate: 55, minProfitFactor: 1.2 },
      { level: 'Expert', minTrades: 1500, minWinRate: 65, minProfitFactor: 1.5 },
      { level: 'Master', minTrades: 5000, minWinRate: 70, minProfitFactor: 1.8 },
      { level: 'Exceptional', minTrades: 10000, minWinRate: 80, minProfitFactor: 2.0 }
    ];
  }
}
```

---

## LEARNING WEIGHT SYSTEM

### The 2x Weight Formula

The learning weight system ensures live trading experience has more impact than simulated backtests.

**Weight Values**:
- Live Demo Trading: `2.0x` (double impact)
- Synthetic Backtests: `1.0x` (standard impact)
- Historical Backtests: `1.0x` (standard impact)
- Old Data (optional): `0.5x` (reduced relevance)

**How Weights Are Applied**:

1. **Insight Storage**:
```typescript
await supabase.from('ai_learning_insights').insert({
  user_id: userId,
  live_trade_id: tradeId, // Set if from live trading
  learned_from_live_trading: true, // Quick flag
  learning_weight: 2.0, // 2x for live trades
  insight_title: 'EURUSD high confidence signals work well',
  // ... other fields
});
```

2. **Insight Retrieval** (sorted by weight):
```typescript
const { data: insights } = await supabase
  .from('ai_learning_insights')
  .select('*')
  .eq('user_id', userId)
  .eq('symbol', signal.symbol)
  .order('learning_weight', { ascending: false }) // Live insights first!
  .order('confidence_score', { ascending: false })
  .limit(10);
```

3. **Confidence Adjustment**:
```typescript
// Calculate weighted confidence adjustment
const winningPatterns = insights.filter(i => i.insight_type === 'winning_pattern');

const totalWeight = winningPatterns.reduce((sum, p) => sum + (p.learning_weight || 1.0), 0);
const avgWeight = totalWeight / winningPatterns.length;

// Example: 
// - 2 live patterns (weight 2.0 each) = totalWeight 4.0, avgWeight 2.0
// - 2 backtest patterns (weight 1.0 each) = totalWeight 2.0, avgWeight 1.0

const boost = Math.round(5 * avgWeight);
// Live: boost = 5 * 2.0 = 10%
// Backtest: boost = 5 * 1.0 = 5%

adjustedConfidence += boost;
```

**Mathematical Example**:

Scenario: EURUSD buy signal with 75% confidence

Learned Insights:
- Live insight #1: "EURUSD high confidence works" (weight 2.0)
- Live insight #2: "Take profit early if momentum strong" (weight 2.0)
- Backtest insight #3: "High win rate on EURUSD" (weight 1.0)

Confidence Calculation:
```
Initial: 75%

Winning Pattern Boost:
  Total weight = 2.0 + 2.0 + 1.0 = 5.0
  Avg weight = 5.0 / 3 = 1.67
  Boost = 5% * 1.67 = 8.35% → rounded to +8%

Market Scenario:
  70% win rate on EURUSD → +10%

Historical Success:
  72% success rate → +8%

Final: 75% + 8% + 10% + 8% = 101% → clamped to 100%
```

**Why 2x for Live Trades?**

1. Real market conditions vs simulated
2. Actual execution challenges (slippage, fills)
3. Emotional/psychological factors in live trading
4. Real money risk (even if demo account)
5. More reliable validation of patterns

---

## UI COMPONENTS

### 1. AI Training Page (`AITrainingPage.tsx`)

**Two Main Tabs**:

```tsx
<div className="flex gap-2 mb-6">
  <button
    onClick={() => setActiveTab('progress')}
    className={activeTab === 'progress' ? 'bg-emerald-600' : 'bg-gray-800/50'}
  >
    AI Learning Progress
  </button>
  <button
    onClick={() => setActiveTab('backtest')}
    className={activeTab === 'backtest' ? 'bg-emerald-600' : 'bg-gray-800/50'}
  >
    Run New Backtest
  </button>
</div>

{activeTab === 'progress' && <AILearningProgressDashboard />}
{activeTab === 'backtest' && <BacktestConfigurationPanel />}
```

**Backtest Configuration**:
- Session Name
- Date Range
- Symbols (EURUSD, XAUUSD, etc.)
- Risk Mode (Low/Medium/High)
- Confidence Threshold (60-90%)
- **Synthetic Data Toggle** (Enable/Disable)
- **Market Scenario** (Trending Up/Down, Ranging, High Volatility, Mixed)

**Running a Backtest**:
```tsx
const handleRunBacktest = async () => {
  if (useSyntheticData) {
    // Synthetic backtest with AI-generated data
    const result = await syntheticBacktestingEngine.runSyntheticBacktest(
      user.id,
      config,
      onProgress // Progress callback
    );
    
    // AI automatically learns from results
    // No manual trigger needed!
  }
};
```

### 2. AI Learning Progress Dashboard (`AILearningProgressDashboard.tsx`)

**Main Displays**:

1. **Skill Level Card**:
```tsx
<div className="bg-gradient-to-br from-emerald-900 to-blue-900">
  <Trophy icon />
  <h1>{skillData.currentSkillLevel}</h1> {/* Novice, Pro, Expert, etc. */}
  <p>{skillData.totalTradesAnalyzed} Winning Trades</p>
  <p>Only winning trades count!</p>
  
  {/* Progress Bar */}
  <div className="progress-bar">
    <div style={{ width: `${skillData.progressToNextLevelPercent}%` }} />
  </div>
  <p>{skillData.tradesNeededForNextLevel} winning trades needed</p>
</div>
```

2. **Live vs Backtest Learning**:
```tsx
<div className="grid grid-cols-2 gap-4">
  {/* Live Trading Card (Green) */}
  <div className="bg-green-900/20 border-green-500/30">
    <h3>Live Demo Trading Learning</h3>
    <p>Total Live Trades: {liveStats.total_live_trades}</p>
    <p>Analyzed: {liveStats.trades_analyzed}</p>
    <p>Pending: {liveStats.trades_pending_analysis}</p>
    <p>Insights Created: {liveStats.live_insights_created}</p>
    <p className="text-purple-400">Learning Weight: 2.0x</p>
  </div>
  
  {/* Backtest Card (Blue) */}
  <div className="bg-blue-900/20 border-blue-500/30">
    <h3>Backtest Learning</h3>
    <p>Total Insights: {backtestStats.total_insights}</p>
    <p>Avg Confidence: {backtestStats.avg_confidence}%</p>
    <p className="text-gray-400">Learning Weight: 1.0x</p>
    <p className="text-sm text-gray-300">
      Live trades have 2x learning weight compared to backtests
    </p>
  </div>
</div>
```

3. **Performance Metrics**:
- Current Win Rate
- Profit Factor
- Learning Velocity (how fast AI is improving)
- Patterns Learned

4. **Skill Level Roadmap**:
Shows all 6 levels with completion status:
- Novice (0 trades)
- Intermediate (100 winning trades, 45% WR)
- Pro (500 winning trades, 55% WR)
- Expert (1500 winning trades, 65% WR)
- Master (5000 winning trades, 70% WR)
- Exceptional (10000 winning trades, 80% WR)

### 3. Session Learnings Page (`SessionLearningsPage.tsx`)

**Daily Learning Summaries**:

```tsx
<div>
  <h2>Daily Learnings</h2>
  <input type="date" value={selectedDate} onChange={...} />
  
  {todayLearning ? (
    <>
      {/* Metrics */}
      <MetricCard label="Session CSS" value={todayLearning.session_css} />
      <MetricCard label="Session EV" value={todayLearning.session_ev} />
      <MetricCard label="Trades Taken" value={todayLearning.trades_taken} />
      <MetricCard label="Patterns Discovered" value={todayLearning.patterns_discovered.length} />
      
      {/* Best Setup */}
      <div className="bg-green-900/20">
        <h3>Best Performing Setup</h3>
        <p>{todayLearning.best_setup_name}</p>
        <p>EV: {todayLearning.best_setup_ev}</p>
        <p>Win Rate: {todayLearning.best_setup_win_rate}%</p>
      </div>
      
      {/* Worst Setup */}
      {todayLearning.worst_setup_ev < 0 && (
        <div className="bg-red-900/20">
          <h3>Worst Performing Setup</h3>
          <p>{todayLearning.worst_setup_name}</p>
          <p>EV: {todayLearning.worst_setup_ev}</p>
          <p>Avoid this pattern!</p>
        </div>
      )}
      
      {/* Key Learnings */}
      <div>
        <h3>Key Learnings</h3>
        {todayLearning.key_learnings.map(learning => (
          <div>{learning}</div>
        ))}
      </div>
      
      {/* Recommendations */}
      <div>
        <h3>Recommendations for Tomorrow</h3>
        {todayLearning.actionable_recommendations.map(rec => (
          <div>{rec}</div>
        ))}
      </div>
    </>
  ) : (
    <div>
      <p>No learning data available for {selectedDate}</p>
      <button onClick={handleGenerateLearning}>Generate Learning</button>
    </div>
  )}
</div>
```

---

## COMPLETE LEARNING FLOW

### Flow #1: Synthetic Backtest Learning

```
USER ACTION → Run Synthetic Backtest
│
├─ Step 1: Generate Synthetic Data
│   └─ syntheticDataGenerator.getOrCreateSyntheticData()
│       ├─ Check if data exists for date range
│       ├─ If not, generate H1, M5, M1 candles
│       └─ Apply market scenario (trending, ranging, etc.)
│
├─ Step 2: Execute Backtest
│   └─ syntheticBacktestingEngine.runSyntheticBacktest()
│       ├─ Process each candle
│       ├─ Generate trade signals (Flow Trader V2 logic)
│       ├─ Execute trades that meet criteria
│       └─ Track P&L and equity curve
│
├─ Step 3: AI Learning Analysis (AUTOMATIC)
│   └─ aiLearningEngine.analyzeBacktestSession()
│       ├─ For each trade:
│       │   ├─ Calculate entry quality score
│       │   ├─ Identify what worked/failed
│       │   ├─ Find similar historical trades
│       │   └─ Store in ai_trade_analysis
│       │
│       ├─ Extract winning patterns:
│       │   ├─ Group by symbol
│       │   ├─ Calculate win rates
│       │   ├─ Identify high-confidence setups
│       │   └─ Store with learning_weight = 1.0
│       │
│       ├─ Extract losing patterns:
│       │   ├─ Identify low-confidence failures
│       │   ├─ Find problematic symbols
│       │   └─ Store avoidance rules
│       │
│       ├─ Analyze optimal timing:
│       │   ├─ Compare winner vs loser hold times
│       │   └─ Extract timing insights
│       │
│       ├─ Update market scenario performance:
│       │   └─ Track win rates by symbol and condition
│       │
│       └─ Update performance evolution:
│           └─ Daily metrics and trends
│
└─ Step 4: Update Skill Progression
    └─ aiSkillTracker.updateAfterBacktest()
        ├─ Count ONLY winning trades
        ├─ Update cumulative win rate
        ├─ Calculate new skill level
        ├─ Check for level up milestone
        └─ Update progress to next level
```

### Flow #2: Live Trading Learning (2x Weight)

```
USER ACTION → Execute Live Demo Trade
│
├─ Step 1: Trade Opens
│   └─ simulatedTrading.openPosition()
│       ├─ Capture confidence_score
│       ├─ Capture setup_type
│       ├─ Capture market_conditions
│       └─ Set ai_analyzed = false
│
├─ Step 2: Trade Closes (SL/TP/Manual)
│   └─ positionMonitor.checkOpenPositions()
│       ├─ Detect SL/TP hit
│       ├─ Close position
│       ├─ Insert into trade_history
│       │   ├─ profit_loss
│       │   ├─ close_reason
│       │   ├─ ai_analyzed = false
│       │   └─ closed_at = now()
│       │
│       └─ Trade now in database, ready for analysis
│
├─ Step 3: Auto-Trigger Learning (within 30 seconds)
│   └─ liveTradeLearningTrigger.checkForNewTrades()
│       ├─ Query trade_history WHERE ai_analyzed = false
│       ├─ Found new trade? Trigger analysis
│       │
│       └─ aiLearningEngine.analyzeLiveTrade()
│           ├─ Fetch trade details
│           ├─ Analyze with historical context
│           │
│           ├─ Store analysis:
│           │   └─ ai_trade_analysis (live_trade_id set)
│           │
│           ├─ Extract patterns with 2x weight:
│           │   └─ ai_learning_insights
│           │       ├─ learned_from_live_trading = true
│           │       ├─ learning_weight = 2.0 ⭐
│           │       ├─ live_trade_id = tradeId
│           │       └─ (patterns stored)
│           │
│           ├─ Update market scenario:
│           │   └─ Scenario: 'live_demo_trading'
│           │
│           ├─ Update performance evolution:
│           │   └─ Strategy: 'Live Demo Trading'
│           │
│           ├─ Log learning event:
│           │   └─ trade_learning_log
│           │       ├─ learning_source = 'live_trading'
│           │       ├─ insights_created
│           │       ├─ learning_quality_score
│           │       └─ processing_time_ms
│           │
│           └─ Mark analyzed:
│               └─ UPDATE trade_history
│                   SET ai_analyzed = true,
│                       ai_analyzed_at = now()
│
└─ Step 4: Update Skill Progression (ONLY IF WIN)
    └─ aiSkillTracker.updateAfterLiveTrading()
        ├─ If profit_loss > 0:
        │   ├─ Count as 1.5x toward progression ⭐
        │   ├─ Update cumulative stats
        │   └─ Check for level up
        │
        └─ If profit_loss <= 0:
            └─ Skip progression update
                (learning still recorded, but no progress)
```

### Flow #3: Decision Making (Using Learned Knowledge)

```
TRADE SIGNAL APPEARS → "EURUSD Buy, 75% confidence"
│
├─ Step 1: AI Decision Advisor Evaluation
│   └─ aiDecisionAdvisor.evaluateTradeSignal()
│       │
│       ├─ Query relevant insights:
│       │   └─ SELECT * FROM ai_learning_insights
│       │       WHERE user_id = ? AND symbol = 'EURUSD'
│       │       ORDER BY learning_weight DESC ⭐
│       │       (Live insights appear first!)
│       │
│       ├─ Query market scenario performance:
│       │   └─ Get win rate for EURUSD
│       │
│       ├─ Query similar historical trades:
│       │   └─ Find trades with similar confidence
│       │
│       ├─ Calculate Expected Value (EV):
│       │   └─ evCalculator.calculateSignalEV()
│       │       ├─ Win probability from history
│       │       ├─ Average win size
│       │       ├─ Average loss size
│       │       └─ EV = (P(win) × AvgWin) - (P(loss) × AvgLoss)
│       │
│       └─ Calculate adjusted confidence:
│           └─ calculateAdjustedConfidence()
│               ├─ Start: 75%
│               │
│               ├─ EV Factor (HIGHEST PRIORITY):
│               │   └─ EV > 10 and positive: +15%
│               │
│               ├─ Winning Pattern Factor:
│               │   ├─ 2 live insights (weight 2.0 each)
│               │   ├─ Avg weight = 2.0
│               │   └─ Boost = 5% × 2.0 = +10% ⭐
│               │
│               ├─ Scenario Performance Factor:
│               │   └─ 70% win rate on EURUSD: +10%
│               │
│               ├─ Historical Success Factor:
│               │   └─ 72% success rate: +8%
│               │
│               └─ Final: 75% + 15% + 10% + 10% + 8% = 118%
│                   → Clamped to 100%
│
├─ Step 2: Make Decision
│   └─ If adjustedConfidence >= 70%:
│       ├─ shouldTake = true
│       ├─ Reasoning: "Signal validated by live trading data"
│       ├─ keyInsights: ["High Win Rate Pattern - EURUSD (live)"]
│       └─ recommendations: ["Increase position size"]
│   
│   └─ Else:
│       ├─ shouldTake = false
│       └─ warnings: ["Confidence below threshold"]
│
├─ Step 3: Log Decision
│   └─ ai_decision_feedback.insert()
│       ├─ decision_time
│       ├─ ai_confidence (adjusted)
│       ├─ ai_reasoning
│       ├─ decision_made (true/false)
│       └─ matched_patterns (live insights)
│
└─ Step 4: Execute or Skip
    └─ If shouldTake:
        ├─ Execute trade
        └─ Link ai_decision_id
    
    └─ Else:
        └─ Skip trade (miss opportunity)
```

---

## MATHEMATICAL MODELS

### 1. Confidence Adjustment Formula

```
adjustedConfidence = originalConfidence + Σ(factors)

Where factors include:
  - EV Factor: ±20% (highest priority)
  - Winning Pattern Factor: +(5% × avg_weight)
  - Losing Pattern Factor: -(10% × avg_weight)
  - Scenario Performance: ±15%
  - Historical Success: ±12%
  - Initial Confidence: ±5%

Final confidence clamped: max(0, min(100, adjustedConfidence))
```

### 2. Expected Value (EV) Calculation

```
EV = (P(win) × AvgWin) - (P(loss) × AvgLoss)

Where:
  P(win) = winningTrades / totalTrades
  P(loss) = losingTrades / totalTrades
  AvgWin = Σ(winning_pnl) / winningTrades
  AvgLoss = |Σ(losing_pnl)| / losingTrades

Example:
  10 trades: 7 wins, 3 losses
  Wins average: $15
  Losses average: $10
  
  P(win) = 0.7
  P(loss) = 0.3
  
  EV = (0.7 × 15) - (0.3 × 10)
     = 10.5 - 3
     = $7.50 per trade (positive EV!)
```

### 3. Skill Level Calculation

```
calculateSkillLevel(totalWinningTrades, winRate, profitFactor) {
  if (totalWinningTrades >= 10000 && winRate >= 80 && profitFactor >= 2.0)
    return 'Exceptional'
  
  if (totalWinningTrades >= 5000 && winRate >= 70 && profitFactor >= 1.8)
    return 'Master'
  
  if (totalWinningTrades >= 1500 && winRate >= 65 && profitFactor >= 1.5)
    return 'Expert'
  
  if (totalWinningTrades >= 500 && winRate >= 55 && profitFactor >= 1.2)
    return 'Pro'
  
  if (totalWinningTrades >= 100 && winRate >= 45 && profitFactor >= 1.0)
    return 'Intermediate'
  
  return 'Novice'
}

IMPORTANT: Only winning trades count!
```

### 4. Progress to Next Level

```
progressPercent = ((currentTrades - currentThreshold) / 
                   (nextThreshold - currentThreshold)) × 100

Example: Pro level (500 trades) aiming for Expert (1500 trades)
  Current: 750 winning trades
  
  progressPercent = ((750 - 500) / (1500 - 500)) × 100
                  = (250 / 1000) × 100
                  = 25%
```

### 5. Learning Weight Impact

```
weightedBoost = baseBoost × averageLearningWeight

Example: Winning pattern boost
  Base boost: 5%
  3 insights:
    - 2 from live trading (weight 2.0 each)
    - 1 from backtest (weight 1.0)
  
  avgWeight = (2.0 + 2.0 + 1.0) / 3 = 1.67
  
  weightedBoost = 5% × 1.67 = 8.35% → rounded to 8%
```

### 6. Trade Quality Score

```
tradeQuality = baseScore + outcomePoints + rrPoints + confidencePoints + setupPoints

Where:
  baseScore = 50
  
  outcomePoints:
    - win: +40
    - loss: +10
    - breakeven: +20
  
  rrPoints (Realized Risk:Reward):
    - RR >= 2.0: +30
    - RR >= 1.5: +20
    - RR >= 1.0: +10
    - RR < 1.0: +0
  
  confidencePoints:
    - High confidence + win: +20
    - Low confidence + loss: -10
  
  setupPoints:
    - Known setup type: +10
    - Unknown setup: +0

Max score: 100
Min score: 0
```

---

## TROUBLESHOOTING & RECOVERY

### Issue #1: Trades Not Being Analyzed

**Symptoms**:
- Live trades close but ai_analyzed stays false
- No insights appearing in dashboard
- trade_learning_log is empty

**Diagnosis**:
```sql
-- Check unanalyzed trades
SELECT id, symbol, closed_at, ai_analyzed, profit_loss
FROM trade_history
WHERE user_id = 'YOUR_USER_ID'
  AND ai_analyzed = false
ORDER BY closed_at DESC;
```

**Solution**:
```typescript
// Manually trigger learning analysis
await liveTradeLearningTrigger.analyzePendingTrades(userId);

// Or check if service is running
if (!liveTradeLearningTrigger.isActive()) {
  liveTradeLearningTrigger.start(userId);
}
```

**Root Causes**:
1. Service not started (liveTradeLearningTrigger.start() never called)
2. RLS policy blocking writes
3. Database connection error
4. Trade missing required fields (confidence_score, setup_type)

### Issue #2: Insights Not Affecting Decisions

**Symptoms**:
- Insights exist in database
- Confidence not being adjusted
- AI Decision Advisor always using original confidence

**Diagnosis**:
```sql
-- Check if insights exist
SELECT COUNT(*), learned_from_live_trading, AVG(learning_weight)
FROM ai_learning_insights
WHERE user_id = 'YOUR_USER_ID'
GROUP BY learned_from_live_trading;

-- Check if insights match signal symbol
SELECT insight_title, learning_weight, confidence_score
FROM ai_learning_insights
WHERE user_id = 'YOUR_USER_ID'
  AND symbol = 'EURUSD'
ORDER BY learning_weight DESC;
```

**Solution**:
```typescript
// Test decision advisor directly
const advice = await aiDecisionAdvisor.evaluateTradeSignal(userId, {
  symbol: 'EURUSD',
  direction: 'buy',
  entryPrice: 1.0850,
  stopLoss: 1.0830,
  takeProfit: 1.0890,
  confidence: 75,
  setupType: 'Flow Trader V2'
});

console.log('Adjusted confidence:', advice.adjustedConfidence);
console.log('Insights found:', advice.keyInsights);
```

**Root Causes**:
1. Insights not being queried (check ORDER BY learning_weight DESC)
2. Symbol mismatch (case sensitivity)
3. Confidence calculation not applying weights
4. RLS blocking insight reads

### Issue #3: Skill Progression Not Updating

**Symptoms**:
- Winning trades completed
- total_trades_analyzed not increasing
- Stuck at Novice level

**Diagnosis**:
```sql
-- Check skill progression record
SELECT *
FROM ai_skill_progression
WHERE user_id = 'YOUR_USER_ID';

-- Check learning logs
SELECT COUNT(*), learning_source, AVG(learning_quality_score)
FROM trade_learning_log
WHERE user_id = 'YOUR_USER_ID'
GROUP BY learning_source;
```

**Solution**:
```typescript
// Manually update skill progression
const winningTrades = await supabase
  .from('trade_history')
  .select('*')
  .eq('user_id', userId)
  .gt('profit_loss', 0);

await aiSkillTracker.updateAfterLiveTrading(
  userId,
  winningTrades.length,
  70, // Example win rate
  1.5, // Example profit factor
  10  // Patterns learned
);
```

**Root Causes**:
1. updateAfterLiveTrading() not being called
2. Only losing trades (losers don't count toward progression)
3. Skill progression record doesn't exist (need to create)
4. Database write permission issue

### Issue #4: Learning Weight Not Applied

**Symptoms**:
- Live insights have learning_weight = 1.0 (should be 2.0)
- No differentiation between live and backtest

**Diagnosis**:
```sql
-- Check learning weights
SELECT 
  learning_source,
  learned_from_live_trading,
  AVG(learning_weight) as avg_weight,
  COUNT(*) as count
FROM (
  SELECT 'insights' as source, learning_weight, learned_from_live_trading, 'live' as learning_source
  FROM ai_learning_insights
  WHERE user_id = 'YOUR_USER_ID'
) 
GROUP BY learning_source, learned_from_live_trading;
```

**Solution**:
```typescript
// Manually fix weights for live insights
await supabase
  .from('ai_learning_insights')
  .update({ 
    learning_weight: 2.0,
    learned_from_live_trading: true 
  })
  .eq('user_id', userId)
  .eq('is_from_live_trading', true);
```

**Root Causes**:
1. Migration didn't add learning_weight column
2. Code not setting learning_weight when inserting
3. Database default value incorrect

### Issue #5: Complete System Recovery

**Scenario**: All learning data lost or corrupted.

**Recovery Steps**:

1. **Verify Database Schema**:
```sql
-- Check all tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public'
  AND table_name LIKE '%ai_%'
ORDER BY table_name;

-- Expected tables:
-- ai_decision_feedback
-- ai_indicator_effectiveness
-- ai_indicator_experiments
-- ai_learning_insights
-- ai_learning_milestones
-- ai_market_scenario_performance
-- ai_performance_evolution
-- ai_skill_progression
-- ai_trade_analysis
```

2. **Recreate Missing Tables**:
Run all migrations in order:
- `20251108120000_create_ai_learning_system.sql`
- `20251109130000_enhance_trade_history_for_ai_learning.sql`
- `20251109120000_create_ai_skill_tracking_system.sql`

3. **Rebuild Learning Data from History**:
```typescript
// Re-analyze all historical trades
const { data: allTrades } = await supabase
  .from('trade_history')
  .select('*')
  .eq('user_id', userId)
  .eq('ai_analyzed', false);

for (const trade of allTrades) {
  await aiLearningEngine.analyzeLiveTrade(userId, trade.id);
}
```

4. **Rebuild Skill Progression**:
```typescript
// Count all winning trades
const { data: winningTrades } = await supabase
  .from('trade_history')
  .select('*')
  .eq('user_id', userId)
  .gt('profit_loss', 0);

const winCount = winningTrades.length;
const winRate = (winCount / totalTrades.length) * 100;
const profitFactor = calculateProfitFactor(winningTrades);

// Recreate skill progression
await aiSkillTracker.updateAfterLiveTrading(
  userId,
  winCount,
  winRate,
  profitFactor,
  0
);
```

5. **Verify Recovery**:
```sql
-- Check data exists
SELECT 
  (SELECT COUNT(*) FROM ai_learning_insights WHERE user_id = 'YOUR_USER_ID') as insights,
  (SELECT COUNT(*) FROM ai_trade_analysis WHERE user_id = 'YOUR_USER_ID') as analyses,
  (SELECT COUNT(*) FROM ai_skill_progression WHERE user_id = 'YOUR_USER_ID') as skill_records,
  (SELECT COUNT(*) FROM trade_learning_log WHERE user_id = 'YOUR_USER_ID') as learning_logs;
```

---

## VALIDATION QUERIES

### Check System Health

```sql
-- 1. Overall system status
SELECT 
  'Total Insights' as metric,
  COUNT(*) as value,
  MAX(created_at) as last_created
FROM ai_learning_insights
WHERE user_id = 'YOUR_USER_ID'

UNION ALL

SELECT 
  'Live Insights (2x weight)',
  COUNT(*),
  MAX(created_at)
FROM ai_learning_insights
WHERE user_id = 'YOUR_USER_ID'
  AND learned_from_live_trading = true

UNION ALL

SELECT 
  'Trade Analyses',
  COUNT(*),
  MAX(created_at)
FROM ai_trade_analysis
WHERE user_id = 'YOUR_USER_ID'

UNION ALL

SELECT 
  'Unanalyzed Trades',
  COUNT(*),
  MAX(closed_at)
FROM trade_history
WHERE user_id = 'YOUR_USER_ID'
  AND ai_analyzed = false;
```

### Verify Learning Weights

```sql
-- Check learning weight distribution
SELECT 
  CASE 
    WHEN learned_from_live_trading THEN 'Live Trading'
    ELSE 'Backtest'
  END as source,
  COUNT(*) as count,
  AVG(learning_weight) as avg_weight,
  MIN(learning_weight) as min_weight,
  MAX(learning_weight) as max_weight
FROM ai_learning_insights
WHERE user_id = 'YOUR_USER_ID'
GROUP BY learned_from_live_trading;

-- Expected:
-- Live Trading: avg_weight = 2.0
-- Backtest: avg_weight = 1.0
```

### Check Skill Progression

```sql
-- Detailed skill progression
SELECT 
  current_skill_level,
  skill_level_numeric,
  total_trades_analyzed,
  current_win_rate,
  current_profit_factor,
  progress_to_next_level_percent,
  trades_needed_for_next_level,
  total_patterns_learned,
  gap_to_target,
  updated_at
FROM ai_skill_progression
WHERE user_id = 'YOUR_USER_ID';
```

### Verify Learning Impact

```sql
-- Check if insights are being applied in decisions
SELECT 
  COUNT(*) as total_decisions,
  COUNT(CASE WHEN array_length(matched_patterns, 1) > 0 THEN 1 END) as decisions_with_insights,
  AVG(ai_confidence - signal_strength) as avg_confidence_adjustment,
  AVG(CASE WHEN was_decision_correct THEN 1.0 ELSE 0.0 END) * 100 as decision_accuracy
FROM ai_decision_feedback
WHERE user_id = 'YOUR_USER_ID'
  AND was_decision_correct IS NOT NULL;
```

---

## DEPLOYMENT CHECKLIST

### Pre-Deployment

- [ ] All database migrations applied
- [ ] RLS policies enabled and tested
- [ ] Helper functions created
- [ ] Indexes created for performance
- [ ] Service files compiled without errors

### Post-Deployment

- [ ] Run test synthetic backtest
- [ ] Verify AI learning analysis completes
- [ ] Check insights stored with correct weights
- [ ] Verify skill progression updates
- [ ] Test decision advisor with real signal
- [ ] Verify live trade learning triggers automatically
- [ ] Check dashboard displays correctly

### Monitoring

- [ ] Set up alerts for learning failures
- [ ] Monitor database query performance
- [ ] Track learning latency (should be <30 seconds)
- [ ] Monitor skill progression updates
- [ ] Track insight application rates

---

## CONFIGURATION DEFAULTS

```typescript
// AI Learning Configuration
const AI_LEARNING_CONFIG = {
  // Learning weights
  LIVE_TRADING_WEIGHT: 2.0,
  BACKTEST_WEIGHT: 1.0,
  OLD_DATA_WEIGHT: 0.5,
  
  // Skill progression
  LIVE_TRADE_MULTIPLIER: 1.5, // Live trades count 1.5x toward progression
  
  // Confidence adjustments
  EV_BOOST_THRESHOLD: 10, // EV > $10 = +15% confidence
  WINNING_PATTERN_BASE_BOOST: 5, // 5% × learning_weight
  LOSING_PATTERN_BASE_PENALTY: 10, // 10% × learning_weight
  
  // Pattern recognition
  MIN_TRADES_FOR_PATTERN: 3, // Need 3 trades to identify pattern
  MIN_WIN_RATE_FOR_WINNING_PATTERN: 60, // 60%+ = winning pattern
  MAX_LOSS_RATE_FOR_LOSING_PATTERN: 60, // 60%+ losses = losing pattern
  
  // Timing
  LEARNING_POLL_INTERVAL: 30000, // Check for new trades every 30 seconds
  LEARNING_TIMEOUT: 60000, // Max 60 seconds to analyze a trade
  
  // Thresholds
  CONFIDENCE_THRESHOLD: 70, // Must be 70%+ to take trade
  MIN_SAMPLE_SIZE: 5, // Need 5+ similar trades for reliable insights
  STATISTICAL_SIGNIFICANCE: 0.05 // 95% confidence level
};
```

---

## END OF DOCUMENTATION

This document provides a complete, prompt-based specification for recreating the AI Training Lab & Learning Center system. Every component, mathematical model, database schema, and operational procedure is documented with enough detail to rebuild the system from scratch.

**Key Files to Reference**:
1. Database: All `ai_*.sql` migration files
2. Services: `ai-learning-engine.ts`, `ai-decision-advisor.ts`, `live-trade-learning-trigger.ts`, `ai-skill-tracker.ts`
3. UI: `AITrainingPage.tsx`, `AILearningProgressDashboard.tsx`, `SessionLearningsPage.tsx`

**System Status**: ✅ FULLY OPERATIONAL AND PRODUCTION-READY

**Last Updated**: 2025-01-XX (Current Date)
**Version**: 2.0 (Live Trading + Backtesting with Weighted Learning)
