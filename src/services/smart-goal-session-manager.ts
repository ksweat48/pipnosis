/**
 * Smart Goal Session Manager (Refactored)
 *
 * Integrates LLM brain, local memory, and countdown notifications.
 * Breaks large goals into small trade accumulation strategy.
 */

import { supabase } from '../lib/supabase';
import { PIPNOSIS_CORE_RULES, PipnosisCoreRules } from '../lib/pipnosis-core-rules';
import { localMemoryLayer, LocalTrade } from './local-memory-layer';
import { llmStrategyBrain, MarketSnapshot, GoalContext, RelevantHistory } from './llm-strategy-brain';
import { marketSnapshotBuilder } from './market-snapshot-builder';
import { countdownNotificationSystem } from './countdown-notification-system';
import { supabaseSummaryWriter } from './supabase-summary-writer';

export interface SmartGoalConfig {
  goalAmount: number;
  timeframe: string;
  riskMode: 'low' | 'medium' | 'high';
  watchlist: string[];
  autoExecute: boolean;
  accountBalance: number;
}

export interface SmartGoalSession {
  sessionId: string;
  userId: string;
  config: SmartGoalConfig;
  status: 'active' | 'paused' | 'completed' | 'failed';
  strategy: {
    targetTradeCount: number;
    avgProfitPerTrade: number;
    maxProfitPerTrade: number;
    scanIntervalMinutes: number;
  };
  startTime: Date;
  nextScanTime: Date;
  lastScanTime?: Date;
}

class SmartGoalSessionManager {
  private activeSessions: Map<string, SmartGoalSession> = new Map();
  private scanTimers: Map<string, NodeJS.Timeout> = new Map();

  async createSmartGoalSession(
    userId: string,
    prompt: string,
    accountBalance: number
  ): Promise<SmartGoalSession> {
    const config = this.parseGoalPrompt(prompt, accountBalance);
    const sessionId = `goal-${userId}-${Date.now()}`;

    const breakDown = PipnosisCoreRules.breakGoalIntoSmallTrades(
      config.goalAmount,
      accountBalance,
      config.riskMode
    );

    const session: SmartGoalSession = {
      sessionId,
      userId,
      config,
      status: 'active',
      strategy: {
        targetTradeCount: breakDown.targetTradeCount,
        avgProfitPerTrade: breakDown.avgProfitPerTrade,
        maxProfitPerTrade: breakDown.maxProfitPerTrade,
        scanIntervalMinutes: PIPNOSIS_CORE_RULES.SCAN_FREQUENCY_MINUTES
      },
      startTime: new Date(),
      nextScanTime: new Date(),
      lastScanTime: undefined
    };

    localMemoryLayer.createSession(sessionId, accountBalance, config.goalAmount);

    this.activeSessions.set(sessionId, session);

    const { error } = await supabase.from('goal_sessions').insert({
      id: sessionId,
      user_id: userId,
      goal_type: 'profit_target',
      target_value: config.goalAmount,
      timeframe: config.timeframe,
      risk_mode: config.riskMode,
      status: 'active',
      starting_balance: accountBalance,
      current_progress: 0,
      progress_percentage: 0,
      scan_interval_minutes: session.strategy.scanIntervalMinutes,
      auto_execute: config.autoExecute,
      watchlist: config.watchlist,
      start_time: session.startTime.toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    if (error) {
      console.error('[Smart Goal] Error creating session record:', error);
    }

    this.scheduleNextScan(sessionId);

    console.log(`[Smart Goal] Created session ${sessionId}: Target $${config.goalAmount} via ${breakDown.targetTradeCount} trades`);

    return session;
  }

  private parseGoalPrompt(prompt: string, accountBalance: number): SmartGoalConfig {
    const lower = prompt.toLowerCase();

    const dollarMatch = lower.match(/\$?\s*(\d+(?:\.\d+)?)/);
    const goalAmount = dollarMatch ? parseFloat(dollarMatch[1]) : 100;

    const timeframePatterns = [
      { regex: /today|this\s+day/i, timeframe: '1 day' },
      { regex: /this\s+week|weekly/i, timeframe: '1 week' },
      { regex: /(\d+)\s+days?/i, extract: true },
    ];

    let timeframe = '1 day';
    for (const pattern of timeframePatterns) {
      const match = lower.match(pattern.regex);
      if (match) {
        timeframe = pattern.extract ? `${match[1]} days` : pattern.timeframe;
        break;
      }
    }

    const riskKeywords = {
      low: /safe|careful|conservative|low\s+risk/i,
      high: /aggressive|fast|risky|high\s+risk/i
    };

    let riskMode: 'low' | 'medium' | 'high' = 'medium';
    if (riskKeywords.low.test(lower)) riskMode = 'low';
    if (riskKeywords.high.test(lower)) riskMode = 'high';

    return {
      goalAmount,
      timeframe,
      riskMode,
      watchlist: ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'],
      autoExecute: true,
      accountBalance
    };
  }

  private scheduleNextScan(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session || session.status !== 'active') return;

    const existingTimer = this.scanTimers.get(sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const delayMs = session.strategy.scanIntervalMinutes * 60 * 1000;

    const timer = setTimeout(async () => {
      await this.executeScan(sessionId);
    }, delayMs);

    this.scanTimers.set(sessionId, timer);

    session.nextScanTime = new Date(Date.now() + delayMs);
    console.log(`[Smart Goal] Next scan scheduled for ${session.nextScanTime.toISOString()}`);
  }

  private async executeScan(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session || session.status !== 'active') return;

    console.log(`[Smart Goal] Executing scan for session ${sessionId}`);
    session.lastScanTime = new Date();

    const goalProgress = localMemoryLayer.getGoalProgress(sessionId);
    if (!goalProgress) {
      console.warn('[Smart Goal] No goal progress found');
      return;
    }

    if (goalProgress.progressPercent >= 100) {
      console.log(`[Smart Goal] Goal achieved! ${goalProgress.currentProfit.toFixed(2)} / ${goalProgress.targetAmount.toFixed(2)}`);
      await this.completeSession(sessionId);
      return;
    }

    for (const symbol of session.config.watchlist) {
      const snapshot = await marketSnapshotBuilder.buildSnapshot(symbol, 0, 0);
      if (!snapshot) continue;

      const goalContext: GoalContext = {
        targetAmount: goalProgress.targetAmount,
        currentProfit: goalProgress.currentProfit,
        progressPercent: goalProgress.progressPercent,
        remainingAmount: goalProgress.remainingAmount,
        tradesCompleted: goalProgress.tradesCompleted,
        avgProfitPerTrade: goalProgress.avgProfitPerTrade,
        sessionDuration: this.calculateSessionDuration(session.startTime)
      };

      const decision = await llmStrategyBrain.makeDecision(snapshot, goalContext);

      if (decision.action === 'enter_long' || decision.action === 'enter_short') {
        console.log(`[Smart Goal] LLM recommends ${decision.action} on ${symbol} (${decision.confidence}% confidence)`);

        const countdown = countdownNotificationSystem.createCountdown(
          session.userId,
          sessionId,
          symbol,
          decision,
          'M15',
          snapshot.timeframes.M15.volatility
        );

        countdownNotificationSystem.registerCallbacks(countdown.id, {
          onTick: (remaining) => {
            console.log(`[Smart Goal] Countdown: ${remaining}s remaining for ${symbol}`);
          },
          onComplete: async () => {
            await this.executeTradeFromCountdown(sessionId, countdown.id, snapshot);
          },
          onCancel: () => {
            console.log(`[Smart Goal] Countdown cancelled for ${symbol}`);
          }
        });

        break;
      }
    }

    this.scheduleNextScan(sessionId);
  }

  private async executeTradeFromCountdown(
    sessionId: string,
    countdownId: string,
    originalSnapshot: MarketSnapshot
  ): Promise<void> {
    const countdown = countdownNotificationSystem.getCountdown(countdownId);
    if (!countdown) return;

    const currentSnapshot = await marketSnapshotBuilder.buildSnapshot(countdown.symbol, 0, 0);
    if (!currentSnapshot) {
      console.warn('[Smart Goal] Could not fetch current snapshot for execution');
      return;
    }

    const currentPrice = currentSnapshot.timeframes.M15.currentPrice;
    const shouldExecute = countdownNotificationSystem.shouldStillExecute(
      countdown,
      currentPrice,
      currentSnapshot
    );

    if (!shouldExecute.shouldExecute) {
      console.log(`[Smart Goal] Skipping execution: ${shouldExecute.reason}`);
      return;
    }

    const atr = currentSnapshot.timeframes.M15.atr;
    const adjustment = countdownNotificationSystem.calculateExecutionAdjustment(
      countdown,
      currentPrice,
      atr
    );

    const trade = localMemoryLayer.addTrade(sessionId, {
      symbol: countdown.symbol,
      timeframe: 'M15',
      direction: countdown.action === 'enter_long' ? 'buy' : 'sell',
      entryTime: new Date(),
      entryPrice: adjustment.adjustedEntry,
      positionSize: 0.01,
      stopLoss: adjustment.adjustedStop,
      takeProfit: adjustment.adjustedTarget,
      pnl: 0,
      pnlPercent: 0,
      outcome: 'open',
      confidence: countdown.originalDecision.confidence,
      setupType: countdown.originalDecision.setupType,
      aiReasoning: countdown.originalDecision.reasoning
    });

    console.log(`[Smart Goal] Trade executed: ${trade.symbol} ${trade.direction} @ ${trade.entryPrice.toFixed(5)}`);

    setTimeout(async () => {
      await this.simulateTradeExit(sessionId, trade.id);
    }, (countdown.originalDecision.expectedDurationMinutes || 60) * 60 * 1000);
  }

  private async simulateTradeExit(sessionId: string, tradeId: string): Promise<void> {
    const trade = localMemoryLayer.getAllTrades(sessionId).find(t => t.id === tradeId);
    if (!trade || trade.outcome !== 'open') return;

    const winChance = trade.confidence / 100;
    const isWin = Math.random() < winChance;

    const exitPrice = isWin ? trade.takeProfit : trade.stopLoss;
    const exitReason = isWin ? 'Take profit hit' : 'Stop loss hit';

    localMemoryLayer.closeTrade(sessionId, tradeId, exitPrice, exitReason);

    await supabaseSummaryWriter.writeTradeCompletionSummary(
      sessionId,
      trade.symbol,
      trade
    );

    console.log(`[Smart Goal] Trade closed: ${trade.symbol} ${trade.outcome} - ${exitReason}`);

    const goalProgress = localMemoryLayer.getGoalProgress(sessionId);
    if (goalProgress && goalProgress.progressPercent >= 100) {
      await this.completeSession(sessionId);
    }
  }

  private async completeSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    session.status = 'completed';

    const existingTimer = this.scanTimers.get(sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.scanTimers.delete(sessionId);
    }

    const summary = localMemoryLayer.generateSessionSummary(
      sessionId,
      session.userId,
      `Smart Goal: $${session.config.goalAmount}`
    );

    if (summary) {
      await supabaseSummaryWriter.writeSessionSummary(summary, true);
    }

    localMemoryLayer.closeSession(sessionId);

    console.log(`[Smart Goal] Session ${sessionId} completed successfully!`);
  }

  private calculateSessionDuration(startTime: Date): string {
    const durationMs = Date.now() - startTime.getTime();
    const hours = Math.floor(durationMs / 3600000);
    const minutes = Math.floor((durationMs % 3600000) / 60000);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  getActiveSession(sessionId: string): SmartGoalSession | null {
    return this.activeSessions.get(sessionId) || null;
  }

  pauseSession(sessionId: string): boolean {
    const session = this.activeSessions.get(sessionId);
    if (!session || session.status !== 'active') return false;

    session.status = 'paused';

    const timer = this.scanTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.scanTimers.delete(sessionId);
    }

    console.log(`[Smart Goal] Session ${sessionId} paused`);
    return true;
  }

  resumeSession(sessionId: string): boolean {
    const session = this.activeSessions.get(sessionId);
    if (!session || session.status !== 'paused') return false;

    session.status = 'active';
    this.scheduleNextScan(sessionId);

    console.log(`[Smart Goal] Session ${sessionId} resumed`);
    return true;
  }
}

export const smartGoalSessionManager = new SmartGoalSessionManager();
