# Critical Fixes Implementation Plan
## From Comprehensive Live Demo Goal Trading Flow Audit

**Date:** November 26, 2025
**Priority:** CRITICAL - Production Blocker
**Estimated Total Time:** 16-20 hours

---

## 🔴 CRITICAL FIX #1: Pass Goal Context to Main LLM Decision Pipeline

### Problem
Goal context (target amount, progress, remaining, trade count) is NOT passed to the 5-layer LLM pipeline in `event-based-llm-engine.ts`. The LLM makes decisions without knowing the user's goal.

### Root Cause
- `goal-session-live-engine.ts` Line 309 calls `eventBasedLLMEngine.processCandle()`
- Does not pass goal context
- LLM receives market data but no goal awareness

### Files to Modify

#### 1. `src/services/goal-session-live-engine.ts` (Lines 299-313)

**BEFORE:**
```typescript
const engineConfig: EventBasedEngineConfig = {
  symbol: this.config.symbol,
  timeframe: this.config.timeframe,
  useLLM: this.config.useLLM,
  riskMode: this.config.riskMode,
  maxConcurrentTrades: this.config.maxConcurrentTrades,
  initialBalance: this.config.initialBalance
};

const result = await eventBasedLLMEngine.processCandle(
  sortedCandles,
  engineConfig,
  this.openTrades
);
```

**AFTER:**
```typescript
//  Get goal session from database
const { data: goalSession } = await supabase
  .from('goal_sessions')
  .select('target_value, current_progress, starting_balance')
  .eq('id', this.activeSession)
  .single();

const tradesCompleted = this.openTrades.filter(t => t.outcome !== 'open').length;
const stats = localSessionMemory.getSessionStatistics(`live-${this.activeSession}`);
const currentProgress = stats?.totalPnL || 0;
const targetAmount = goalSession?.target_value || this.config.initialBalance;
const remainingAmount = targetAmount - currentProgress;

const goalContext = {
  goalSessionId: this.activeSession,
  targetAmount,
  currentProgress,
  remainingAmount,
  tradesCompleted,
  tradesPlanned: 3 // From goal breakdown logic
};

const engineConfig: EventBasedEngineConfig = {
  symbol: this.config.symbol,
  timeframe: this.config.timeframe,
  useLLM: this.config.useLLM,
  riskMode: this.config.riskMode,
  maxConcurrentTrades: this.config.maxConcurrentTrades,
  initialBalance: this.config.initialBalance,
  goalContext  // ← ADD THIS
};

const result = await eventBasedLLMEngine.processCandle(
  sortedCandles,
  engineConfig,
  this.openTrades
);
```

#### 2. `src/services/event-based-llm-engine.ts`

**a) Update EventBasedEngineConfig interface (Line 21)**
```typescript
export interface EventBasedEngineConfig {
  symbol: string;
  timeframe: string;
  useLLM: boolean;
  riskMode: 'low' | 'medium' | 'high';
  maxConcurrentTrades: number;
  initialBalance?: number;
  goalContext?: {
    goalSessionId?: string;
    targetAmount: number;
    currentProgress: number;
    remainingAmount: number;
    tradesCompleted: number;
    tradesPlanned: number;
  };
}
```

**b) Update processCandle() to accept goal context (Line 102)**
```typescript
async processCandle(
  candles: any[],
  config: EventBasedEngineConfig,
  openTrades: SimulatedTrade[] = []
): Promise<{ trade: SimulatedTrade | null; trigger: TriggerEvent | null; llmCalled: boolean }>
```

**c) Pass goal context through pipeline (Line 158)**
```typescript
console.log(`[Event Engine] 🚀 Calling 5-Layer LLM Pipeline...`);
if (config.goalContext) {
  console.log(`[Event Engine] 🎯 Goal: $${config.goalContext.currentProgress.toFixed(2)} / $${config.goalContext.targetAmount} (${((config.goalContext.currentProgress / config.goalContext.targetAmount) * 100).toFixed(1)}%)`);
  console.log(`[Event Engine] 📊 Remaining: $${config.goalContext.remainingAmount.toFixed(2)} | Trade ${config.goalContext.tradesCompleted + 1}/${config.goalContext.tradesPlanned}`);
}

const llmDecision = await this.callLLM(topTrigger, snapshot, openTrades, config.goalContext);
```

**d) Update callLLM() signature (Line 251)**
```typescript
private async callLLM(
  trigger: TriggerEvent,
  snapshot: MarketSnapshot,
  openPositions: SimulatedTrade[],
  goalContext?: {
    goalSessionId?: string;
    targetAmount: number;
    currentProgress: number;
    remainingAmount: number;
    tradesCompleted: number;
    tradesPlanned: number;
  }
): Promise<LLMTradeDecision>
```

**e) Update execute5LayerPipeline() signature (Line 266)**
```typescript
private async execute5LayerPipeline(
  trigger: TriggerEvent,
  snapshot: MarketSnapshot,
  openPositions: SimulatedTrade[],
  goalContext?: { ... }  // Same as above
): Promise<LLMTradeDecision>
```

**f) Update executeSingleLLMCall() signature and prompt (Line 679)**
```typescript
private async executeSingleLLMCall(
  trigger: TriggerEvent,
  snapshot: MarketSnapshot,
  openPositions: SimulatedTrade[],
  overrideConfidence?: number,
  goalContext?: { ... }  // Add goal context param
): Promise<LLMTradeDecision> {
  const llmSnapshot = llmSnapshotBuilder.buildSnapshot(
    trigger,
    snapshot.ohlc,
    snapshot.indicators,
    snapshot.priceAction,
    openPositions,
    goalContext  // ← Pass to builder
  );
  // ... rest of logic
}
```

#### 3. `src/services/llm-snapshot-builder.ts`

**a) Update buildSnapshot() to accept goal context**
```typescript
buildSnapshot(
  trigger: TriggerEvent,
  ohlc: any[],
  indicators: any,
  priceAction: any,
  openPositions: SimulatedTrade[],
  goalContext?: {
    targetAmount: number;
    currentProgress: number;
    remainingAmount: number;
    tradesCompleted: number;
    tradesPlanned: number;
  }
): LLMSnapshot {
  return {
    // ... existing fields
    goalContext  // ← Add to snapshot
  };
}
```

**b) Update formatSnapshotAsPrompt() to include goal section**
```typescript
formatSnapshotAsPrompt(snapshot: LLMSnapshot): string {
  let prompt = `... existing prompt ...`;

  if (snapshot.goalContext) {
    prompt += `\n\n=== YOUR TRADING GOAL ===\n`;
    prompt += `Target: $${snapshot.goalContext.targetAmount.toFixed(2)}\n`;
    prompt += `Current Progress: $${snapshot.goalContext.currentProgress.toFixed(2)} (${((snapshot.goalContext.currentProgress / snapshot.goalContext.targetAmount) * 100).toFixed(1)}%)\n`;
    prompt += `Remaining: $${snapshot.goalContext.remainingAmount.toFixed(2)}\n`;
    prompt += `This is trade ${snapshot.goalContext.tradesCompleted + 1} of ${snapshot.goalContext.tradesPlanned} planned\n`;
    prompt += `\n`;

    if (snapshot.goalContext.remainingAmount < 50) {
      prompt += `⚡ CLOSE TO GOAL! Only $${snapshot.goalContext.remainingAmount.toFixed(2)} remaining - one good trade can complete it!\n`;
    } else if (snapshot.goalContext.tradesCompleted === 0) {
      prompt += `🎯 FIRST TRADE: Aim for premium setup to hit goal in one trade if possible\n`;
    } else if (snapshot.goalContext.tradesCompleted >= snapshot.goalContext.tradesPlanned - 1) {
      prompt += `⚠️ LAST PLANNED TRADE: This is your final opportunity to hit the goal - be selective\n`;
    }
  }

  return prompt;
}
```

### Testing Checklist
- [ ] Goal context appears in console logs
- [ ] LLM prompt includes goal section
- [ ] Trade decisions reference goal proximity
- [ ] Progress correctly calculated

### Time Estimate: 3 hours

---

## 🔴 CRITICAL FIX #2: Correct Progress Percentage Calculation

### Problem
Progress percentage uses `initialBalance` as denominator instead of `goalTarget`. Shows wrong progress to user.

**Location:** `goal-session-live-engine.ts` Line 527

### Root Cause
```typescript
progress_percentage: (stats.totalPnL / this.config!.initialBalance) * 100
```

Should be:
```typescript
progress_percentage: (stats.totalPnL / goalTarget) * 100
```

### Fix

#### 1. `src/services/goal-session-live-engine.ts` (Lines 520-530)

**BEFORE:**
```typescript
const stats = localSessionMemory.getSessionStatistics(`live-${this.activeSession}`);
if (stats) {
  await supabase
    .from('goal_sessions')
    .update({
      current_progress: stats.totalPnL,
      progress_percentage: (stats.totalPnL / this.config!.initialBalance) * 100
    })
    .eq('id', this.activeSession);
}
```

**AFTER:**
```typescript
const stats = localSessionMemory.getSessionStatistics(`live-${this.activeSession}`);
if (stats) {
  // Get goal target from database
  const { data: goalSession } = await supabase
    .from('goal_sessions')
    .select('target_value')
    .eq('id', this.activeSession)
    .single();

  const goalTarget = goalSession?.target_value || this.config!.initialBalance;
  const remainingAmount = goalTarget - stats.totalPnL;

  await supabase
    .from('goal_sessions')
    .update({
      current_progress: stats.totalPnL,
      progress_percentage: (stats.totalPnL / goalTarget) * 100,
      remaining_amount: remainingAmount  // Also update remaining
    })
    .eq('id', this.activeSession);

  console.log(`[Goal Progress] $${stats.totalPnL.toFixed(2)} / $${goalTarget} = ${((stats.totalPnL / goalTarget) * 100).toFixed(1)}%`);
  console.log(`[Goal Progress] Remaining: $${remainingAmount.toFixed(2)}`);
}
```

#### 2. Add `remaining_amount` column to database

**Migration:** Create new migration file

```sql
-- Add remaining_amount column to goal_sessions
ALTER TABLE goal_sessions
ADD COLUMN IF NOT EXISTS remaining_amount numeric DEFAULT 0;

-- Update existing sessions to calculate remaining
UPDATE goal_sessions
SET remaining_amount = target_value - COALESCE(current_progress, 0)
WHERE remaining_amount IS NULL OR remaining_amount = 0;

-- Add index for efficient queries
CREATE INDEX IF NOT EXISTS idx_goal_sessions_remaining
ON goal_sessions(remaining_amount)
WHERE status IN ('scanning', 'trade_pending', 'in_trade');
```

### Testing Checklist
- [ ] Progress shows as percentage of goal, not account balance
- [ ] Remaining amount calculated correctly
- [ ] UI displays correct progress bar
- [ ] Completion detected when progress >= 100% of goal

### Time Estimate: 1 hour

---

## 🔴 CRITICAL FIX #3: Integrate Goal Sessions into Learning Loop

### Problem
`sessionMemoryLoader` queries `daily_session_results` but goal sessions are stored in `goal_sessions` table. Goal sessions don't learn from past goal sessions.

**Location:** `session-memory-loader.ts` Line 45-48

### Fix

#### 1. `src/services/session-memory-loader.ts` (Lines 38-84)

**Update loadRecentSessionLearnings() to query both tables:**

```typescript
async loadRecentSessionLearnings(
  userId: string,
  limit: number = 5
): Promise<SessionMemorySummary | null> {
  console.log(`[Session Memory] 📚 Loading last ${limit} sessions for user ${userId}`);

  try {
    // Try goal_sessions first (priority for goal mode)
    const { data: goalSessions, error: goalError } = await supabase
      .from('goal_sessions')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['goal_achieved', 'user_stopped', 'expired'])
      .order('end_time', { ascending: false })
      .limit(limit);

    // Try daily_session_results as backup
    const { data: dailySessions, error: dailyError } = await supabase
      .from('daily_session_results')
      .select('*')
      .eq('user_id', userId)
      .order('session_date', { ascending: false })
      .limit(limit);

    // Merge both sources
    const allSessions: SessionLearning[] = [];

    // Transform goal sessions
    if (goalSessions && goalSessions.length > 0) {
      for (const gs of goalSessions) {
        // Query trades for this session
        const { data: trades } = await supabase
          .from('goal_session_trades')
          .select('*')
          .eq('goal_session_id', gs.id);

        const winningTrades = trades?.filter(t => t.profit_loss > 0).length || 0;
        const totalTrades = trades?.length || 0;
        const totalPnL = trades?.reduce((sum, t) => sum + (t.profit_loss || 0), 0) || 0;
        const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

        allSessions.push({
          sessionId: gs.id,
          sessionDate: new Date(gs.end_time || gs.start_time),
          sessionType: 'goal_trading',
          bestSetup: null,  // Could analyze trades to find best
          worstSetup: null,
          keyLearnings: [],  // Extract from AI conversations if available
          patternsDiscovered: [],
          patternsDegraded: [],
          recommendations: [],
          sessionMetrics: {
            winRate,
            profitFactor: 0,  // Calculate if we have win/loss amounts
            totalTrades,
            totalPnL
          }
        });
      }
    }

    // Transform daily sessions
    if (dailySessions && dailySessions.length > 0) {
      allSessions.push(...dailySessions.map(session => ({
        sessionId: session.id,
        sessionDate: new Date(session.session_date),
        sessionType: session.session_type || 'backtest',
        bestSetup: session.best_setup,
        worstSetup: session.worst_setup,
        keyLearnings: session.key_learnings || [],
        patternsDiscovered: session.patterns_discovered || [],
        patternsDegraded: session.patterns_degraded || [],
        recommendations: session.recommendations || [],
        sessionMetrics: {
          winRate: session.win_rate || 0,
          profitFactor: session.profit_factor || 0,
          totalTrades: session.total_trades || 0,
          totalPnL: session.total_pnl || 0
        }
      })));
    }

    // Sort by date and take most recent
    const recentSessions = allSessions
      .sort((a, b) => b.sessionDate.getTime() - a.sessionDate.getTime())
      .slice(0, limit);

    if (recentSessions.length === 0) {
      console.log('[Session Memory] No historical sessions found');
      return null;
    }

    console.log(`[Session Memory] ✅ Loaded ${recentSessions.length} sessions (${allSessions.filter(s => s.sessionType === 'goal_trading').length} goal sessions)`);

    const aggregatedLearnings = this.aggregateLearnings(recentSessions);
    const overallTrends = this.calculateTrends(recentSessions);

    return {
      recentSessions,
      aggregatedLearnings,
      overallTrends
    };
  } catch (error) {
    console.error('[Session Memory] Unexpected error:', error);
    return null;
  }
}
```

### Testing Checklist
- [ ] Goal sessions appear in session memory
- [ ] Win rates from goal sessions included
- [ ] Learning trends incorporate goal trading data
- [ ] Console shows "X goal sessions" in load log

### Time Estimate: 2 hours

---

## 🔴 CRITICAL FIX #4: Add Mutex to Prevent Race Conditions

### Problem
`processCandleUpdate()` is async but no mutex prevents overlapping executions. If processing takes > 15s, next interval fires before previous completes, causing duplicate triggers and potentially double entries.

**Location:** `goal-session-live-engine.ts` Lines 216-221

### Fix

#### 1. `src/services/goal-session-live-engine.ts`

**a) Add processing flag (Line 65)**
```typescript
private pollingInterval: NodeJS.Timeout | null = null;
private sessionStartTime: Date | null = null;
private lastProcessedCandleTime: Date | null = null;
private scanCount = 0;
private lastAIUpdateTime = 0;
private isProcessingCandle = false;  // ← ADD THIS
```

**b) Update startPolling() with mutex (Lines 215-221)**
```typescript
private startPolling(): void {
  this.pollingInterval = setInterval(async () => {
    if (this.isProcessingCandle) {
      console.log('[Goal Live Engine] ⚠️ Previous candle still processing, skipping this interval');
      return;
    }

    this.isProcessingCandle = true;
    try {
      await this.processCandleUpdate();
    } catch (error) {
      console.error('[Goal Live Engine] Error in processCandleUpdate:', error);
    } finally {
      this.isProcessingCandle = false;
    }
  }, this.POLLING_INTERVAL_MS);

  // Also run immediately on start
  this.processCandleUpdate().then(() => {
    this.isProcessingCandle = false;
  }).catch(err => {
    console.error('[Goal Live Engine] Initial candle processing error:', err);
    this.isProcessingCandle = false;
  });
}
```

**c) Reset flag in stopPolling() (Lines 226-231)**
```typescript
private stopPolling(): void {
  if (this.pollingInterval) {
    clearInterval(this.pollingInterval);
    this.pollingInterval = null;
  }
  this.isProcessingCandle = false;  // ← ADD THIS
}
```

### Testing Checklist
- [ ] No duplicate trigger detections
- [ ] No double entries on same candle
- [ ] Console shows "skipping" message if slow processing
- [ ] Processing flag resets on errors

### Time Estimate: 1 hour

---

## 🔴 CRITICAL FIX #5: Make Daily Loss Limit Percentage-Based

### Problem
Daily loss limit is hardcoded to `-$500`, unfair for different account sizes. Should be percentage of starting balance.

**Location:** `goal-session-live-engine.ts` Line 68

### Fix

#### 1. `src/services/goal-session-live-engine.ts`

**a) Replace hardcoded constant (Line 68)**
```typescript
// BEFORE:
private readonly MAX_DAILY_LOSS = -500;

// AFTER:
private readonly MAX_DAILY_LOSS_PERCENT = 5;  // 5% of starting balance
```

**b) Update loss check logic (Lines 289-294)**
```typescript
// BEFORE:
if (currentBalance <= this.config.initialBalance + this.MAX_DAILY_LOSS) {
  console.error('[Goal Live Engine] Daily loss limit reached, stopping session');
  await this.stopSession();
  return;
}

// AFTER:
const maxDailyLoss = this.config.initialBalance * (this.MAX_DAILY_LOSS_PERCENT / 100);
const currentLoss = this.config.initialBalance - currentBalance;

if (currentLoss >= maxDailyLoss) {
  console.error(`[Goal Live Engine] Daily loss limit reached: -$${currentLoss.toFixed(2)} (${this.MAX_DAILY_LOSS_PERCENT}% of ${this.config.initialBalance})`);

  // Send notification to user
  await supabase.from('goal_ai_conversations').insert({
    goal_session_id: this.activeSession,
    user_id: this.config.userId,
    role: 'ai',
    message: `🛑 Session stopped: Daily loss limit reached (-$${currentLoss.toFixed(2)}, ${this.MAX_DAILY_LOSS_PERCENT}% of starting balance). This is a protective measure to preserve your capital.`,
    sentiment: 'cautionary',
    context: {
      loss_amount: currentLoss,
      loss_percent: (currentLoss / this.config.initialBalance) * 100,
      limit_percent: this.MAX_DAILY_LOSS_PERCENT
    }
  });

  await this.stopSession();
  return;
}
```

**c) Add configurable limit (optional enhancement)**
```typescript
// In GoalSessionLiveConfig interface
export interface GoalSessionLiveConfig {
  goalSessionId: string;
  userId: string;
  symbol: string;
  timeframe: string;
  useLLM: boolean;
  riskMode: 'low' | 'medium' | 'high';
  maxConcurrentTrades: number;
  initialBalance: number;
  autoExecute: boolean;
  maxDailyLossPercent?: number;  // ← Optional override, default 5%
}

// In class constructor or startSession
private maxDailyLossPercent: number;

async startSession(config: GoalSessionLiveConfig) {
  // ...
  this.maxDailyLossPercent = config.maxDailyLossPercent || 5;
  // ...
}
```

### Testing Checklist
- [ ] Loss limit scales with account size
- [ ] $10k account: -$500 limit (5%)
- [ ] $100k account: -$5k limit (5%)
- [ ] Console shows percentage-based message
- [ ] User notification sent on limit hit

### Time Estimate: 1 hour

---

## 🟠 HIGH PRIORITY FIX #1: Handle JPY Pairs Correctly

### Problem
Pip calculation assumes 0.0001 for all pairs. JPY pairs use 0.01, causing 100x error in position sizing and risk calculations.

**Location:** `goal-session-live-engine.ts` Lines 363, 484

### Fix

#### Create utility function `src/utils/pip-calculator.ts`

```typescript
export function getPipValue(symbol: string): number {
  const upperSymbol = symbol.toUpperCase();

  // JPY pairs use 2 decimal places (0.01 pip)
  if (upperSymbol.includes('JPY')) {
    return 0.01;
  }

  // All other pairs use 4 decimal places (0.0001 pip)
  return 0.0001;
}

export function calculatePips(
  symbol: string,
  priceA: number,
  priceB: number
): number {
  const pipValue = getPipValue(symbol);
  return Math.abs(priceA - priceB) / pipValue;
}
```

#### Update `goal-session-live-engine.ts`

**Line 1:** Add import
```typescript
import { calculatePips, getPipValue } from '../utils/pip-calculator';
```

**Lines 363-367:** Fix position sizing calculation
```typescript
// BEFORE:
const riskPips = Math.abs(trade.entryPrice - trade.stopLoss) / 0.0001;
const rewardPips = Math.abs(trade.takeProfit - trade.entryPrice) / 0.0001;

// AFTER:
const riskPips = calculatePips(trade.symbol, trade.entryPrice, trade.stopLoss);
const rewardPips = calculatePips(trade.symbol, trade.entryPrice, trade.takeProfit);
```

**Lines 483-485:** Fix PnL calculation
```typescript
// BEFORE:
const pips = priceDiff / 0.0001;

// AFTER:
const pips = priceDiff / getPipValue(trade.symbol);
```

### Testing Checklist
- [ ] USDJPY position sizing correct
- [ ] EURJPY position sizing correct
- [ ] EURUSD still works correctly
- [ ] Console logs show correct pip values

### Time Estimate: 1 hour

---

## 🟠 HIGH PRIORITY FIX #2: Add SL/TP Direction Validation

### Problem
No validation that SL is in correct direction for trade. LLM could return buy with SL above entry, causing instant stop out.

**Location:** `trade-execution-engine.ts` Lines 74-111

### Fix

#### `src/services/trade-execution-engine.ts`

**Add validation in `validateSignal()` method (after Line 111)**

```typescript
// Validate SL/TP direction
if (signal.direction === 'buy') {
  if (signal.stopLoss >= signal.entryPrice) {
    return {
      valid: false,
      reason: `Invalid buy setup: Stop loss (${signal.stopLoss.toFixed(5)}) must be below entry (${signal.entryPrice.toFixed(5)})`
    };
  }
  if (signal.takeProfit <= signal.entryPrice) {
    return {
      valid: false,
      reason: `Invalid buy setup: Take profit (${signal.takeProfit.toFixed(5)}) must be above entry (${signal.entryPrice.toFixed(5)})`
    };
  }
} else if (signal.direction === 'sell') {
  if (signal.stopLoss <= signal.entryPrice) {
    return {
      valid: false,
      reason: `Invalid sell setup: Stop loss (${signal.stopLoss.toFixed(5)}) must be above entry (${signal.entryPrice.toFixed(5)})`
    };
  }
  if (signal.takeProfit >= signal.entryPrice) {
    return {
      valid: false,
      reason: `Invalid sell setup: Take profit (${signal.takeProfit.toFixed(5)}) must be below entry (${signal.entryPrice.toFixed(5)})`
    };
  }
}

// Validate minimum SL distance (prevent too-tight stops)
const slDistance = Math.abs(signal.entryPrice - signal.stopLoss);
const minDistance = signal.entryPrice * 0.0005;  // 0.05% minimum
if (slDistance < minDistance) {
  return {
    valid: false,
    reason: `Stop loss too tight: ${slDistance.toFixed(5)} (minimum ${minDistance.toFixed(5)})`
  };
}
```

### Testing Checklist
- [ ] Buy with SL above entry rejected
- [ ] Sell with SL below entry rejected
- [ ] Correct setups pass validation
- [ ] Too-tight stops rejected

### Time Estimate: 1 hour

---

## 🟠 HIGH PRIORITY FIX #3: Implement Session Cleanup Mechanism

### Problem
Sessions can be stuck in "scanning" status if crash occurs. User gets "Another session already running" error and can't start new one.

### Fix

#### Create new service: `src/services/session-health-monitor.ts`

```typescript
import { supabase } from '../lib/supabase';

export class SessionHealthMonitor {
  private readonly STALE_SESSION_THRESHOLD_MS = 5 * 60 * 1000;  // 5 minutes

  /**
   * Check for stale sessions and mark them as crashed
   */
  async checkAndCleanStaleSessions(): Promise<number> {
    const staleTime = new Date(Date.now() - this.STALE_SESSION_THRESHOLD_MS);

    const { data: staleSessions, error } = await supabase
      .from('goal_sessions')
      .select('id, user_id, last_scan_time, status')
      .in('status', ['scanning', 'initializing', 'trade_pending'])
      .lt('last_scan_time', staleTime.toISOString());

    if (error || !staleSessions || staleSessions.length === 0) {
      return 0;
    }

    console.log(`[Session Health] Found ${staleSessions.length} stale sessions`);

    for (const session of staleSessions) {
      await supabase
        .from('goal_sessions')
        .update({
          status: 'crashed',
          end_time: new Date().toISOString(),
          error_message: 'Session marked as crashed due to inactivity (no updates for 5+ minutes)'
        })
        .eq('id', session.id);

      console.log(`[Session Health] Marked session ${session.id} as crashed`);
    }

    return staleSessions.length;
  }

  /**
   * Check if user has a stale session before starting new one
   */
  async cleanUserStaleSessions(userId: string): Promise<void> {
    const staleTime = new Date(Date.now() - this.STALE_SESSION_THRESHOLD_MS);

    const { data: staleSessions } = await supabase
      .from('goal_sessions')
      .select('id')
      .eq('user_id', userId)
      .in('status', ['scanning', 'initializing', 'trade_pending'])
      .lt('last_scan_time', staleTime.toISOString());

    if (staleSessions && staleSessions.length > 0) {
      console.log(`[Session Health] Cleaning ${staleSessions.length} stale sessions for user ${userId}`);

      await supabase
        .from('goal_sessions')
        .update({
          status: 'crashed',
          end_time: new Date().toISOString()
        })
        .in('id', staleSessions.map(s => s.id));
    }
  }
}

export const sessionHealthMonitor = new SessionHealthMonitor();
```

#### Update `goal-session-live-engine.ts`

**Add cleanup before starting session (Line 73, inside startSession())**
```typescript
// Clean any stale sessions for this user first
await sessionHealthMonitor.cleanUserStaleSessions(config.userId);
```

#### Add background cleanup job (optional)

Create `src/services/background-session-cleaner.ts`
```typescript
import { sessionHealthMonitor } from './session-health-monitor';

class BackgroundSessionCleaner {
  private interval: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL_MS = 2 * 60 * 1000;  // Every 2 minutes

  start(): void {
    if (this.interval) return;

    console.log('[Background Cleaner] Starting session health monitor');

    this.interval = setInterval(async () => {
      const cleaned = await sessionHealthMonitor.checkAndCleanStaleSessions();
      if (cleaned > 0) {
        console.log(`[Background Cleaner] Cleaned ${cleaned} stale sessions`);
      }
    }, this.CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      console.log('[Background Cleaner] Stopped');
    }
  }
}

export const backgroundSessionCleaner = new BackgroundSessionCleaner();
```

### Testing Checklist
- [ ] Stale sessions marked as crashed after 5 minutes
- [ ] User can start new session after stale cleanup
- [ ] Background job runs every 2 minutes
- [ ] No false positives (active sessions not cleaned)

### Time Estimate: 2 hours

---

## 🟠 HIGH PRIORITY FIX #4: Persist Stats to Database Continuously

### Problem
Session stats stored in-memory (`local-session-memory.ts`). If server crashes, progress lost. Must reconstruct from trades table.

### Fix

#### Update `goal-session-live-engine.ts`

**After each trade closure, persist full stats (around Line 455)**

```typescript
private async handleTradeClosure(trade: SimulatedTrade): Promise<void> {
  if (!this.activeSession) return;

  logger.info(LogCategory.AI_TRADING, `Trade closed: ${trade.outcome.toUpperCase()} - PnL: $${trade.pnl.toFixed(2)}`);

  // ... existing logic ...

  // ✅ ADD THIS: Persist stats to database
  const stats = localSessionMemory.getSessionStatistics(`live-${this.activeSession}`);
  if (stats && this.config) {
    const { data: goalSession } = await supabase
      .from('goal_sessions')
      .select('target_value')
      .eq('id', this.activeSession)
      .single();

    const goalTarget = goalSession?.target_value || this.config.initialBalance;

    await supabase
      .from('goal_sessions')
      .update({
        // Progress tracking
        current_progress: stats.totalPnL,
        progress_percentage: (stats.totalPnL / goalTarget) * 100,
        remaining_amount: goalTarget - stats.totalPnL,

        // Session stats
        total_trades: stats.totalTrades,
        winning_trades: stats.winningTrades,
        losing_trades: stats.losingTrades,
        win_rate: (stats.winningTrades / stats.totalTrades) * 100,

        // Trigger stats
        triggers_detected: stats.triggersDetected,
        llm_calls_made: stats.llmCallsMade,

        // Timestamp
        last_trade_time: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', this.activeSession);

    console.log(`[Stats Persistence] ✅ Stats saved to database`);
  }
}
```

#### Add recovery mechanism in `startSession()` (Line 108)

```typescript
// Load previous stats from database if resuming
const { data: existingSession } = await supabase
  .from('goal_sessions')
  .select('total_trades, winning_trades, losing_trades, triggers_detected, llm_calls_made, current_progress')
  .eq('id', config.goalSessionId)
  .single();

if (existingSession && existingSession.total_trades > 0) {
  console.log(`[Session Recovery] Restoring stats: ${existingSession.total_trades} trades, ${existingSession.winning_trades} wins`);

  // Initialize local memory with recovered stats
  localSessionMemory.createSession(
    `live-${config.goalSessionId}`,
    config.userId,
    `Live Goal Session: ${config.symbol}`,
    {
      symbol: config.symbol,
      timeframe: config.timeframe,
      useLLM: config.useLLM,
      riskMode: config.riskMode,
      initialBalance: config.initialBalance,
      // Recovered state
      previousTrades: existingSession.total_trades,
      previousWins: existingSession.winning_trades,
      previousLosses: existingSession.losing_trades,
      previousPnL: existingSession.current_progress
    }
  );
}
```

### Testing Checklist
- [ ] Stats persisted after each trade
- [ ] Server restart preserves progress
- [ ] Win rate/trade count accurate after recovery
- [ ] No duplicate stat tracking

### Time Estimate: 2 hours

---

## 🟠 HIGH PRIORITY FIX #5: Add Market Hours Validation

### Problem
No check if forex market is open. May attempt trades during weekends, rollover, or holidays.

### Fix

#### Create utility: `src/utils/market-hours.ts`

```typescript
export interface MarketStatus {
  isOpen: boolean;
  reason?: string;
  nextOpen?: Date;
  nextClose?: Date;
}

export class ForexMarketHours {
  /**
   * Check if forex market is currently open
   */
  static isMarketOpen(now: Date = new Date()): MarketStatus {
    const day = now.getUTCDay();
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();

    // Weekend check
    if (day === 0) {  // Sunday
      if (hour < 22) {
        return {
          isOpen: false,
          reason: 'Weekend - Market opens Sunday 22:00 UTC',
          nextOpen: this.getNextSundayOpen(now)
        };
      }
      return { isOpen: true };
    }

    if (day === 6) {  // Saturday
      return {
        isOpen: false,
        reason: 'Weekend - Market opens Sunday 22:00 UTC',
        nextOpen: this.getNextSundayOpen(now)
      };
    }

    if (day === 5) {  // Friday
      if (hour >= 22) {
        return {
          isOpen: false,
          reason: 'Weekend - Market opens Sunday 22:00 UTC',
          nextOpen: this.getNextSundayOpen(now)
        };
      }
    }

    // Rollover period (22:00-23:00 UTC daily)
    if (hour === 22) {
      return {
        isOpen: false,
        reason: 'Daily rollover period (22:00-23:00 UTC)',
        nextOpen: new Date(now.getTime() + (60 - minute) * 60 * 1000)
      };
    }

    return { isOpen: true };
  }

  /**
   * Get next Sunday 22:00 UTC
   */
  private static getNextSundayOpen(now: Date): Date {
    const daysUntilSunday = (7 - now.getUTCDay()) % 7 || 7;
    const nextSunday = new Date(now);
    nextSunday.setUTCDate(now.getUTCDate() + daysUntilSunday);
    nextSunday.setUTCHours(22, 0, 0, 0);
    return nextSunday;
  }

  /**
   * Check if specific day/time is during rollover
   */
  static isRolloverPeriod(now: Date = new Date()): boolean {
    const hour = now.getUTCHours();
    return hour === 22;
  }
}
```

#### Update `goal-session-live-engine.ts`

**Add check in processCandleUpdate() (Line 236, at start of method)**

```typescript
private async processCandleUpdate(): Promise<void> {
  if (!this.config || !this.activeSession) {
    return;
  }

  // ✅ ADD THIS: Check market hours
  const marketStatus = ForexMarketHours.isMarketOpen();
  if (!marketStatus.isOpen) {
    console.log(`[Goal Live Engine] ⏸️ Market closed: ${marketStatus.reason}`);
    if (this.scanCount % 20 === 0) {  // Log every ~5 minutes
      await supabase.from('goal_ai_conversations').insert({
        goal_session_id: this.activeSession,
        user_id: this.config.userId,
        role: 'ai',
        message: `⏸️ Market closed: ${marketStatus.reason}. Scanning will resume when market opens.`,
        sentiment: 'neutral',
        context: { market_status: marketStatus }
      });
    }
    return;  // Skip processing
  }

  try {
    // ... rest of existing logic
  }
}
```

### Testing Checklist
- [ ] No scanning on Saturday
- [ ] No scanning on Sunday before 22:00 UTC
- [ ] No scanning during rollover (22:00-23:00 UTC)
- [ ] User notified when market closed
- [ ] Resumes automatically when market opens

### Time Estimate: 1 hour

---

## 📋 IMPLEMENTATION ORDER

### Week 1 (8 hours)
1. ✅ Critical #1: Goal context to LLM (3 hours)
2. ✅ Critical #2: Progress calculation (1 hour)
3. ✅ Critical #4: Mutex for polling (1 hour)
4. ✅ Critical #5: Percentage-based loss limit (1 hour)
5. ✅ High #1: JPY pairs (1 hour)
6. ✅ High #2: SL/TP validation (1 hour)

### Week 2 (8 hours)
7. ✅ Critical #3: Goal sessions in learning (2 hours)
8. ✅ High #3: Session cleanup (2 hours)
9. ✅ High #4: Persist stats continuously (2 hours)
10. ✅ High #5: Market hours validation (1 hour)
11. 🧪 Integration testing (1 hour)

### Week 3 (Medium/Low priority - if time permits)
12. Medium fixes (trailing stops, slippage, etc.)
13. Low priority enhancements
14. Documentation updates

---

## 🧪 TESTING STRATEGY

### Unit Tests
- [ ] Goal context propagation through pipeline
- [ ] Progress calculation accuracy
- [ ] Mutex prevents overlaps
- [ ] JPY pip calculations
- [ ] SL/TP direction validation
- [ ] Market hours detection

### Integration Tests
- [ ] End-to-end goal trading flow
- [ ] Session recovery after crash
- [ ] Multiple trades in one session
- [ ] Goal completion detection
- [ ] Learning loop data flow

### Manual Testing
- [ ] Create goal "Make $100 today"
- [ ] Verify LLM sees goal in prompts
- [ ] Check progress updates correctly
- [ ] Test with USDJPY (JPY pair)
- [ ] Crash server mid-session, verify recovery
- [ ] Try starting session on weekend

---

## 📊 SUCCESS METRICS

- ✅ Zero duplicate trades in 100 session sample
- ✅ Progress percentage accurate to 0.1%
- ✅ All 5 critical fixes verified in production
- ✅ Session recovery success rate > 95%
- ✅ No invalid SL/TP orders in 1000 trade sample
- ✅ JPY pairs trade correctly with proper position sizing

---

## 🚀 DEPLOYMENT CHECKLIST

- [ ] All fixes implemented and tested locally
- [ ] Database migration applied (remaining_amount column)
- [ ] npm run build succeeds
- [ ] No TypeScript errors
- [ ] Integration tests pass
- [ ] Manual smoke test completed
- [ ] Backup database before deployment
- [ ] Deploy to staging
- [ ] Run goal trading session on staging
- [ ] Verify all fixes in staging
- [ ] Deploy to production
- [ ] Monitor first 10 production sessions
- [ ] Document any issues found

---

**END OF IMPLEMENTATION PLAN**
