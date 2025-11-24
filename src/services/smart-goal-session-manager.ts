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
import { goalSessionLiveEngine, GoalSessionLiveConfig } from './goal-session-live-engine';

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

    await this.startLiveEngine(sessionId, userId, config, accountBalance);

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

    // Persist trade to database
    const session = this.activeSessions.get(sessionId);
    if (session) {
      const direction = countdown.action === 'enter_long' ? 'buy' : 'sell';

      // Insert to goal_session_trades
      await supabase.from('goal_session_trades').insert({
        goal_session_id: sessionId,
        trade_id: trade.id,
        symbol: countdown.symbol,
        direction,
        entry_price: adjustment.adjustedEntry,
        stop_loss: adjustment.adjustedStop,
        take_profit: adjustment.adjustedTarget,
        position_size: 0.01,
        status: 'open',
        opened_at: new Date().toISOString()
      });

      // Insert to trade_history (with goal_session_id link)
      await supabase.from('trade_history').insert({
        id: trade.id,
        user_id: session.userId,
        goal_session_id: sessionId,
        symbol: countdown.symbol,
        position_type: direction,
        lot_size: 0.01,
        entry_price: adjustment.adjustedEntry,
        exit_price: direction === 'buy' ? adjustment.adjustedTarget : adjustment.adjustedStop,
        stop_loss: adjustment.adjustedStop,
        take_profit: adjustment.adjustedTarget,
        profit_loss: 0,
        opened_at: new Date().toISOString(),
        closed_at: new Date().toISOString(),
        strategy_name: 'Smart Goal - Event LLM',
        notes: countdown.originalDecision.reasoning
      }).select();
    }

    console.log(`[Smart Goal] Trade executed and persisted: ${trade.symbol} ${trade.direction} @ ${trade.entryPrice.toFixed(5)}`)

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
    const closeReasonDB = isWin ? 'take_profit' : 'stop_loss';

    // Calculate P&L
    const profitLoss = trade.direction === 'buy'
      ? (exitPrice - trade.entryPrice) * trade.positionSize * 100000
      : (trade.entryPrice - exitPrice) * trade.positionSize * 100000;

    localMemoryLayer.closeTrade(sessionId, tradeId, exitPrice, exitReason);

    // Update goal_session_trades
    await supabase
      .from('goal_session_trades')
      .update({
        exit_price: exitPrice,
        profit_loss: profitLoss,
        status: 'closed',
        closed_at: new Date().toISOString()
      })
      .eq('trade_id', tradeId);

    // Update trade_history
    await supabase
      .from('trade_history')
      .update({
        exit_price: exitPrice,
        profit_loss: profitLoss,
        closed_at: new Date().toISOString(),
        close_reason: closeReasonDB
      })
      .eq('id', tradeId);

    await supabaseSummaryWriter.writeTradeCompletionSummary(
      sessionId,
      trade.symbol,
      trade
    );

    console.log(`[Smart Goal] Trade closed and persisted: ${trade.symbol} ${trade.outcome} - ${exitReason} (P&L: $${profitLoss.toFixed(2)})`);

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

  private async startLiveEngine(
    sessionId: string,
    userId: string,
    config: SmartGoalConfig,
    accountBalance: number
  ): Promise<void> {
    try {
      const liveConfig: GoalSessionLiveConfig = {
        goalSessionId: sessionId,
        userId,
        symbol: config.watchlist[0],
        timeframe: '15m',
        useLLM: true,
        riskMode: config.riskMode,
        maxConcurrentTrades: 2,
        initialBalance: accountBalance,
        autoExecute: config.autoExecute
      };

      const result = await goalSessionLiveEngine.startSession(liveConfig);

      if (result.success) {
        console.log('[Smart Goal] Live engine started successfully');

        await supabase.from('goal_ai_conversations').insert({
          goal_session_id: sessionId,
          user_id: userId,
          role: 'ai',
          message: `Live trading engine activated! I'm now monitoring ${config.watchlist.join(', ')} for high-probability setups using the event-based LLM system. Scanning every 15 seconds for triggers.`,
          context: { liveEngineStatus: 'started' },
          sentiment: 'encouraging'
        });
      } else {
        console.error('[Smart Goal] Failed to start live engine:', result.message);

        await supabase.from('goal_ai_conversations').insert({
          goal_session_id: sessionId,
          user_id: userId,
          role: 'ai',
          message: `Note: Live engine startup encountered an issue: ${result.message}. Continuing with scheduled scans.`,
          context: { liveEngineStatus: 'error', error: result.message },
          sentiment: 'cautionary'
        });
      }
    } catch (error) {
      console.error('[Smart Goal] Error starting live engine:', error);
    }
  }

  async stopLiveEngine(sessionId: string): Promise<void> {
    try {
      if (goalSessionLiveEngine.getActiveSessionId() === sessionId) {
        const result = await goalSessionLiveEngine.stopSession();
        if (result.success) {
          console.log('[Smart Goal] Live engine stopped successfully');
        } else {
          console.error('[Smart Goal] Failed to stop live engine:', result.message);
        }
      }
    } catch (error) {
      console.error('[Smart Goal] Error stopping live engine:', error);
    }
  }

  getLiveEngineStatus(sessionId: string): any {
    if (goalSessionLiveEngine.getActiveSessionId() === sessionId) {
      return goalSessionLiveEngine.getStatus();
    }
    return null;
  }
}

export const smartGoalSessionManager = new SmartGoalSessionManager();
