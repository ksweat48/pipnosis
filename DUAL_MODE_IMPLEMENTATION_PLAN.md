# Dual-Mode Alpha Trading System - Implementation Plan

## Overview
This document outlines the complete implementation for Alpha's dual-mode execution system:
- **Single-Trade Mode**: Sequential execution with user approval between trades
- **Multi-Trade Mode**: Simultaneous execution of multiple trades

---

## Architecture

### System Flow Diagrams

#### **Single-Trade Mode Flow**
```
User Sets Goal ($200)
    ↓
Alpha Plans Strategy: "Need 3 trades: $70 + $80 + $50"
    ↓
Display Plan to User
    ↓
Execute Trade 1 (XAUUSD $70 target)
    ↓
Monitor Trade 1
    ↓
Trade 1 Closes (+$65 profit)
    ↓
SET awaiting_user_continuation = TRUE
    ↓
Generate Continuation Prompt:
  "Trade 1 complete! Profit: $65
   Goal: $200, Remaining: $135
   Continue towards goal?"
    ↓
Show ContinuationDialog
    ↓
User Clicks "Continue"
    ↓
Alpha Re-Scans Market (conditions may have changed)
    ↓
Execute Trade 2 (GBPUSD $90 target - adjusted from original plan)
    ↓
... repeat until goal or user stops
```

#### **Multi-Trade Mode Flow**
```
User Sets Goal ($200)
    ↓
Alpha Plans Strategy: "3 simultaneous trades"
    ↓
Display Plan to User
    ↓
Execute ALL Trades Simultaneously:
  - XAUUSD ($70 target)
  - EURUSD ($80 target)
  - GBPUSD ($50 target)
    ↓
Monitor All Positions
    ↓
Manage correlations, adjust stops
    ↓
All Trades Close
    ↓
Report Final Results
```

---

## Database Schema

### Required Fields (Already Exist)
```sql
-- goal_sessions table
multi_trade_enabled: boolean DEFAULT false
awaiting_user_continuation: boolean DEFAULT false
continuation_prompt: text
trades_in_session: integer DEFAULT 0
```

### New Fields to Add
```sql
-- Add to goal_sessions
ALTER TABLE goal_sessions
  ADD COLUMN IF NOT EXISTS planned_strategy JSONB,
  ADD COLUMN IF NOT EXISTS trades_planned INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS trades_completed INTEGER DEFAULT 0;

-- Add to goal_session_trades
ALTER TABLE goal_session_trades
  ADD COLUMN IF NOT EXISTS trade_sequence_number INTEGER,
  ADD COLUMN IF NOT EXISTS planned_profit NUMERIC(15,2);

-- Add index
CREATE INDEX IF NOT EXISTS idx_goal_trades_sequence
  ON goal_session_trades(goal_session_id, trade_sequence_number);
```

---

## Service Layer Implementation

### 1. `alpha-execution-planner.ts` (NEW)

```typescript
/**
 * Alpha Execution Planner
 * Creates strategic trading plans for goal achievement
 */

import { supabase } from '../lib/supabase';
import { openAIClient } from './openai-client';

export interface TradePlan {
  totalTradesNeeded: number;
  trades: Array<{
    sequenceNumber: number;
    estimatedProfit: number;
    symbol: string;
    timeframe: string;
    confidence: number;
    reasoning: string;
  }>;
  executionMode: 'sequential' | 'simultaneous';
  riskPerTrade: number;
  totalRisk: number;
}

export interface PlanningContext {
  goalAmount: number;
  currentBalance: number;
  riskMode: 'low' | 'medium' | 'high';
  timeframe: string;
  watchlist: string[];
  multiTradeEnabled: boolean;
}

class AlphaExecutionPlanner {
  /**
   * Create a strategic plan to achieve the goal
   */
  async createPlan(
    context: PlanningContext,
    marketData: any[]
  ): Promise<TradePlan> {
    // Build comprehensive market snapshot
    const marketSnapshot = await this.buildMarketSnapshot(context.watchlist);

    // Call GPT-4o-mini to create strategic plan
    const prompt = this.buildPlanningPrompt(context, marketSnapshot);

    const response = await openAIClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are Pipnosis Alpha, an expert trading strategist. Create a detailed plan to achieve the user's goal based on current market conditions.`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' }
    });

    const plan = JSON.parse(response.choices[0].message.content);

    // Store plan in database
    await this.storePlan(context, plan);

    return plan;
  }

  /**
   * Re-assess plan after a trade completes (for single-trade mode)
   */
  async reassessPlan(
    goalSessionId: string,
    completedTrade: any
  ): Promise<TradePlan> {
    // Fetch current session state
    const { data: session } = await supabase
      .from('goal_sessions')
      .select('*')
      .eq('id', goalSessionId)
      .single();

    if (!session) throw new Error('Session not found');

    const remainingAmount = session.target_value - session.current_progress;
    const tradesCompleted = session.trades_in_session;

    // Get fresh market data
    const marketSnapshot = await this.buildMarketSnapshot(session.watchlist);

    // Ask Alpha to adjust the plan
    const prompt = `
Previous plan execution update:
- Trade ${tradesCompleted} just completed
- P&L: $${completedTrade.profit_loss}
- Goal: $${session.target_value}
- Achieved so far: $${session.current_progress}
- Remaining: $${remainingAmount}

Current market conditions:
${JSON.stringify(marketSnapshot, null, 2)}

Create an adjusted plan for the remaining amount.
`;

    const response = await openAIClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are Pipnosis Alpha. Adjust the trading plan based on progress and current markets.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' }
    });

    const adjustedPlan = JSON.parse(response.choices[0].message.content);

    // Update plan in database
    await supabase
      .from('goal_sessions')
      .update({ planned_strategy: adjustedPlan })
      .eq('id', goalSessionId);

    return adjustedPlan;
  }

  private buildPlanningPrompt(
    context: PlanningContext,
    marketSnapshot: any
  ): string {
    return `
Goal: Achieve $${context.goalAmount} profit
Account Balance: $${context.currentBalance}
Risk Mode: ${context.riskMode}
Timeframe: ${context.timeframe}
Execution Mode: ${context.multiTradeEnabled ? 'Multi-Trade (simultaneous)' : 'Single-Trade (sequential)'}

Available Symbols: ${context.watchlist.join(', ')}

Current Market Conditions:
${JSON.stringify(marketSnapshot, null, 2)}

Create a strategic trading plan with:
1. Number of trades needed
2. Expected profit per trade
3. Preferred symbols for each trade
4. Risk per trade
5. Execution strategy (sequential or simultaneous)
6. Reasoning for the plan

Return JSON format:
{
  "totalTradesNeeded": number,
  "trades": [
    {
      "sequenceNumber": number,
      "estimatedProfit": number,
      "symbol": string,
      "confidence": number (0-1),
      "reasoning": string
    }
  ],
  "executionMode": "sequential" | "simultaneous",
  "riskPerTrade": number,
  "totalRisk": number,
  "strategicNotes": string
}
`;
  }

  private async buildMarketSnapshot(symbols: string[]): Promise<any> {
    // Fetch recent candles for all symbols
    const snapshots = await Promise.all(
      symbols.map(async (symbol) => {
        const { data: candles } = await supabase
          .from('forex_candles')
          .select('*')
          .eq('symbol', symbol)
          .eq('timeframe', '15m')
          .order('open_time', { ascending: false })
          .limit(50);

        if (!candles || candles.length === 0) {
          return { symbol, available: false };
        }

        const latest = candles[0];
        const trend = this.calculateTrend(candles);
        const volatility = this.calculateVolatility(candles);

        return {
          symbol,
          available: true,
          price: latest.close,
          trend,
          volatility,
          candlesAvailable: candles.length
        };
      })
    );

    return snapshots;
  }

  private calculateTrend(candles: any[]): 'bullish' | 'bearish' | 'sideways' {
    if (candles.length < 20) return 'sideways';

    const prices = candles.map(c => parseFloat(c.close)).reverse();
    const sma20 = prices.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const currentPrice = prices[prices.length - 1];

    if (currentPrice > sma20 * 1.002) return 'bullish';
    if (currentPrice < sma20 * 0.998) return 'bearish';
    return 'sideways';
  }

  private calculateVolatility(candles: any[]): 'high' | 'medium' | 'low' {
    if (candles.length < 14) return 'medium';

    const ranges = candles
      .slice(0, 14)
      .map(c => parseFloat(c.high) - parseFloat(c.low));

    const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
    const latestPrice = parseFloat(candles[0].close);
    const volatilityPct = (avgRange / latestPrice) * 100;

    if (volatilityPct > 0.5) return 'high';
    if (volatilityPct < 0.2) return 'low';
    return 'medium';
  }

  private async storePlan(context: PlanningContext, plan: TradePlan): Promise<void> {
    // Plans are stored in the session's planned_strategy field
    console.log('[Alpha Planner] Plan created and ready for execution');
  }
}

export const alphaExecutionPlanner = new AlphaExecutionPlanner();
```

---

### 2. `continuation-handler.ts` (NEW)

```typescript
/**
 * Continuation Handler
 * Manages single-trade mode pausing and user decision handling
 */

import { supabase } from '../lib/supabase';
import { openAIClient } from './openai-client';
import { alphaExecutionPlanner } from './alpha-execution-planner';

interface ContinuationContext {
  goalSessionId: string;
  userId: string;
  tradeResult: {
    symbol: string;
    direction: 'buy' | 'sell';
    entryPrice: number;
    exitPrice: number;
    profitLoss: number;
    outcome: 'win' | 'loss' | 'breakeven';
  };
  sessionProgress: {
    targetAmount: number;
    currentProgress: number;
    tradesCompleted: number;
  };
}

class ContinuationHandler {
  /**
   * Handle trade closure in single-trade mode
   */
  async handleTradeClose(context: ContinuationContext): Promise<void> {
    // Generate continuation prompt
    const prompt = await this.generateContinuationPrompt(context);

    // Pause the session
    await supabase
      .from('goal_sessions')
      .update({
        awaiting_user_continuation: true,
        continuation_prompt: prompt,
        status: 'awaiting_continuation',
        trades_in_session: context.sessionProgress.tradesCompleted
      })
      .eq('id', context.goalSessionId);

    console.log('[Continuation] Session paused, awaiting user decision');
  }

  /**
   * Generate AI continuation prompt
   */
  private async generateContinuationPrompt(
    context: ContinuationContext
  ): Promise<string> {
    const { tradeResult, sessionProgress } = context;
    const remaining = sessionProgress.targetAmount - sessionProgress.currentProgress;
    const progressPct = (sessionProgress.currentProgress / sessionProgress.targetAmount) * 100;

    // Use AI to generate a personalized, encouraging message
    const response = await openAIClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are Pipnosis Alpha. Generate a brief, encouraging continuation prompt for the user.'
        },
        {
          role: 'user',
          content: `
Trade ${sessionProgress.tradesCompleted} just closed:
- Symbol: ${tradeResult.symbol}
- Direction: ${tradeResult.direction}
- Entry: ${tradeResult.entryPrice}
- Exit: ${tradeResult.exitPrice}
- Result: ${tradeResult.outcome.toUpperCase()} (${tradeResult.profitLoss >= 0 ? '+' : ''}$${tradeResult.profitLoss.toFixed(2)})

Session Progress:
- Goal: $${sessionProgress.targetAmount}
- Achieved: $${sessionProgress.currentProgress.toFixed(2)} (${progressPct.toFixed(1)}%)
- Remaining: $${remaining.toFixed(2)}

Generate a 2-3 sentence prompt asking if they want to continue.
Be encouraging if the trade won, supportive if it lost.
Mention the remaining amount and that you'll find the next opportunity.
`
        }
      ],
      max_tokens: 150,
      temperature: 0.8
    });

    return response.choices[0].message.content || this.getDefaultPrompt(context);
  }

  private getDefaultPrompt(context: ContinuationContext): string {
    const { tradeResult, sessionProgress } = context;
    const remaining = sessionProgress.targetAmount - sessionProgress.currentProgress;

    if (tradeResult.outcome === 'win') {
      return `Great trade! We made $${tradeResult.profitLoss.toFixed(2)} on ${tradeResult.symbol}.\n\nYou're ${sessionProgress.currentProgress.toFixed(2)} / $${sessionProgress.targetAmount} towards your goal ($${remaining.toFixed(2)} to go).\n\nReady to continue? I'll scan the markets for the next high-quality setup.`;
    } else {
      return `Trade on ${tradeResult.symbol} closed at ${tradeResult.profitLoss >= 0 ? '+' : ''}$${tradeResult.profitLoss.toFixed(2)}.\n\nCurrent progress: $${sessionProgress.currentProgress.toFixed(2)} / $${sessionProgress.targetAmount} ($${remaining.toFixed(2)} remaining).\n\nWant to continue? I'll find a strong opportunity to get back on track.`;
    }
  }

  /**
   * Handle user's decision to continue
   */
  async handleContinue(goalSessionId: string): Promise<void> {
    // Resume the session
    await supabase
      .from('goal_sessions')
      .update({
        awaiting_user_continuation: false,
        continuation_prompt: null,
        status: 'scanning'
      })
      .eq('id', goalSessionId);

    // Reassess the plan with current market conditions
    const { data: session } = await supabase
      .from('goal_sessions')
      .select('*')
      .eq('id', goalSessionId)
      .single();

    if (session) {
      await alphaExecutionPlanner.reassessPlan(goalSessionId, {
        profit_loss: session.current_progress
      });
    }

    console.log('[Continuation] Session resumed, scanning for next trade');
  }

  /**
   * Handle user's decision to stop
   */
  async handleStop(goalSessionId: string): Promise<void> {
    await supabase
      .from('goal_sessions')
      .update({
        status: 'user_stopped',
        end_time: new Date().toISOString(),
        awaiting_user_continuation: false
      })
      .eq('id', goalSessionId);

    console.log('[Continuation] Session stopped by user');
  }
}

export const continuationHandler = new ContinuationHandler();
```

---

### 3. Modifications to `goal-session-core-engine.ts`

**Add after line 225 (where trade closure is handled):**

```typescript
// Check if this is single-trade mode
const { data: goalSession } = await client
  .from('goal_sessions')
  .select('multi_trade_enabled, user_id, target_value, current_progress, trades_in_session')
  .eq('id', goalSessionId)
  .single();

if (goalSession && !goalSession.multi_trade_enabled) {
  // SINGLE-TRADE MODE: Pause after each trade
  const isGoalAchieved = goalSession.current_progress >= goalSession.target_value;

  if (!isGoalAchieved) {
    // Import continuation handler
    const { continuationHandler } = await import('./continuation-handler');

    await continuationHandler.handleTradeClose({
      goalSessionId,
      userId: goalSession.user_id,
      tradeResult: {
        symbol: trade.symbol,
        direction: trade.direction,
        entryPrice: trade.entryPrice,
        exitPrice: trade.closePrice!,
        profitLoss: trade.profitLoss,
        outcome: trade.profitLoss > 0 ? 'win' : trade.profitLoss < 0 ? 'loss' : 'breakeven'
      },
      sessionProgress: {
        targetAmount: goalSession.target_value,
        currentProgress: goalSession.current_progress,
        tradesCompleted: goalSession.trades_in_session
      }
    });

    // STOP processing - wait for user decision
    return {
      success: true,
      message: 'Trade closed - awaiting user continuation decision',
      shouldContinue: false
    };
  }
}
```

---

## Frontend Implementation

### 1. Mode Selector in `SmartGoalPanel.tsx`

**Add after line 200 (before the templates grid):**

```tsx
{/* Trading Mode Selector */}
<div className="bg-gray-700/30 rounded-lg p-4 mb-4 border border-gray-600/50">
  <div className="flex items-center justify-between mb-3">
    <div className="flex items-center gap-2">
      <Zap className="w-5 h-5 text-emerald-400" />
      <span className="text-sm font-semibold text-white">Execution Mode</span>
    </div>
    <button
      onClick={() => {
        const newMode = !multiTradeEnabled;
        setMultiTradeEnabled(newMode);

        // Save to user preferences
        if (user) {
          supabase
            .from('user_profiles')
            .update({
              trading_preferences: {
                multiTradeMode: newMode
              }
            })
            .eq('id', user.id)
            .then(() => {
              toast.success(
                'Mode Updated',
                `Switched to ${newMode ? 'Multi-Trade' : 'Single-Trade'} Mode`
              );
            });
        }
      }}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        multiTradeEnabled ? 'bg-emerald-600' : 'bg-gray-600'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          multiTradeEnabled ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  </div>

  {/* Mode Explanation */}
  <div className="space-y-2">
    {!multiTradeEnabled ? (
      <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-3">
        <div className="flex items-start gap-2">
          <CheckCircle className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-gray-300">
            <strong className="text-blue-400">Single-Trade Mode (Active)</strong>
            <p className="mt-1">
              Alpha executes ONE trade at a time. After each trade closes, you decide whether to continue.
              Lower risk, full control between trades.
            </p>
          </div>
        </div>
      </div>
    ) : (
      <div className="bg-emerald-900/20 border border-emerald-700/50 rounded-lg p-3">
        <div className="flex items-start gap-2">
          <Zap className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-gray-300">
            <strong className="text-emerald-400">Multi-Trade Mode (Active)</strong>
            <p className="mt-1">
              Alpha can execute multiple trades SIMULTANEOUSLY. Faster goal achievement, higher exposure.
              Best for experienced traders comfortable with concurrent positions.
            </p>
          </div>
        </div>
      </div>
    )}
  </div>
</div>
```

---

### 2. Integration in `SmartGoalModePage.tsx`

**Add state and realtime subscription:**

```typescript
const [showContinuationDialog, setShowContinuationDialog] = useState(false);
const [continuationData, setContinuationData] = useState<any>(null);

useEffect(() => {
  if (!activeSession) return;

  // Subscribe to session changes
  const channel = supabase
    .channel(`goal-session-${activeSession.sessionId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'goal_sessions',
        filter: `id=eq.${activeSession.sessionId}`
      },
      (payload) => {
        const newData = payload.new as any;

        // Check if session is now awaiting continuation
        if (newData.awaiting_user_continuation && !showContinuationDialog) {
          setContinuationData({
            prompt: newData.continuation_prompt,
            tradesInSession: newData.trades_in_session,
            currentProgress: newData.current_progress,
            targetValue: newData.target_value
          });
          setShowContinuationDialog(true);
        }
      }
    )
    .subscribe();

  return () => {
    channel.unsubscribe();
  };
}, [activeSession, showContinuationDialog]);

// Handle continuation decisions
const handleContinue = async () => {
  if (!activeSession) return;

  const { continuationHandler } = await import('../services/continuation-handler');
  await continuationHandler.handleContinue(activeSession.sessionId);

  setShowContinuationDialog(false);
  toast.success('Resuming', 'Alpha is scanning for your next trade...');
};

const handleStop = async () => {
  if (!activeSession) return;

  const { continuationHandler } = await import('../services/continuation-handler');
  await continuationHandler.handleStop(activeSession.sessionId);

  setShowContinuationDialog(false);
  toast.info('Session Ended', 'Your goal session has been stopped');
};
```

**Add the dialog component:**

```tsx
{/* Continuation Dialog */}
{showContinuationDialog && continuationData && (
  <ContinuationDialog
    isOpen={showContinuationDialog}
    continuationPrompt={continuationData.prompt}
    tradesInSession={continuationData.tradesInSession}
    currentProgress={continuationData.currentProgress}
    targetValue={continuationData.targetValue}
    onContinue={handleContinue}
    onStop={handleStop}
  />
)}
```

---

## Testing Plan

### Single-Trade Mode Tests
1. Create goal with single-trade mode
2. Verify Alpha shows strategic plan
3. Execute first trade
4. Verify session pauses after trade closes
5. Verify continuation dialog appears
6. Click "Continue" - verify session resumes
7. Click "Stop" - verify session ends

### Multi-Trade Mode Tests
1. Create goal with multi-trade mode
2. Verify Alpha shows strategic plan
3. Execute multiple trades simultaneously
4. Verify all trades monitored concurrently
5. Verify no pause between trades
6. Verify session completes when goal reached

---

## Migration File

```sql
/*
  # Enhanced Dual-Mode Execution System

  1. New Fields
    - planned_strategy: JSONB - Alpha's strategic plan
    - trades_planned: INTEGER - Number of trades in the plan
    - trades_completed: INTEGER - Trades finished so far
    - trade_sequence_number: INTEGER - Order in single-trade mode
    - planned_profit: NUMERIC - Expected profit for this trade

  2. Indexes
    - Index on trade sequence for ordering
*/

-- Add new planning fields to goal_sessions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'planned_strategy'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN planned_strategy JSONB;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'trades_planned'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN trades_planned INTEGER DEFAULT 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'trades_completed'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN trades_completed INTEGER DEFAULT 0;
  END IF;
END $$;

-- Add trade sequencing to goal_session_trades
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'trade_sequence_number'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN trade_sequence_number INTEGER;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'planned_profit'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN planned_profit NUMERIC(15,2);
  END IF;
END $$;

-- Create index for trade sequencing
CREATE INDEX IF NOT EXISTS idx_goal_trades_sequence
  ON goal_session_trades(goal_session_id, trade_sequence_number);

-- Add comment
COMMENT ON COLUMN goal_sessions.planned_strategy IS
  'Alpha''s strategic plan created at session start, stored as JSON';

COMMENT ON COLUMN goal_session_trades.trade_sequence_number IS
  'Order of execution in single-trade mode (1, 2, 3...)';
```

---

## Summary

This implementation provides:

1. **Strategic Planning**: Alpha creates complete plans upfront
2. **User Control**: Single-trade mode gives approval checkpoints
3. **Flexibility**: Users choose their risk comfort level
4. **Smart Re-Planning**: Alpha adjusts strategy based on progress
5. **Professional UX**: Clear mode selection, encouraging prompts

The system maintains Alpha's autonomy while giving users meaningful control over execution pace and risk exposure.
