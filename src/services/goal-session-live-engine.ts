/**
 * Goal Session Live Trading Engine
 *
 * Real-time trading engine for Goal Mode using event-based LLM architecture
 * Streams live candles, detects triggers with Flow V2, evaluates with LLM
 * Manages positions and executes trades based on goal session configuration
 */

import { supabase } from '../lib/supabase';
import { eventBasedLLMEngine, EventBasedEngineConfig, SimulatedTrade } from './event-based-llm-engine';
import { localSessionMemory } from './local-session-memory';
import { PIPNOSIS_CORE_RULES } from '../lib/pipnosis-core-rules';

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
}

export interface LiveTradeSignal {
  goalSessionId: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  positionSize: number;
  confidence: number;
  reasoning: string;
  triggerType: string;
  timestamp: Date;
}

export interface LiveEngineStatus {
  isRunning: boolean;
  sessionId: string | null;
  currentSymbol: string | null;
  lastCandleTime: Date | null;
  triggersDetected: number;
  llmCallsMade: number;
  tradesExecuted: number;
  openTrades: number;
  currentBalance: number;
  uptime: number;
}

class GoalSessionLiveEngine {
  private activeSession: string | null = null;
  private config: GoalSessionLiveConfig | null = null;
  private openTrades: SimulatedTrade[] = [];
  private pollingInterval: NodeJS.Timeout | null = null;
  private sessionStartTime: Date | null = null;
  private lastProcessedCandleTime: Date | null = null;

  private readonly POLLING_INTERVAL_MS = 15000;
  private readonly MAX_DAILY_LOSS = -500;

  /**
   * Start live trading engine for a goal session
   */
  async startSession(config: GoalSessionLiveConfig): Promise<{ success: boolean; message: string }> {
    try {
      if (this.activeSession) {
        return {
          success: false,
          message: 'Another session is already running. Stop it first.'
        };
      }

      console.log(`[Goal Live Engine] Starting session: ${config.goalSessionId}`);

      const { data: goalSession, error } = await supabase
        .from('goal_sessions')
        .select('*')
        .eq('id', config.goalSessionId)
        .single();

      if (error || !goalSession) {
        return {
          success: false,
          message: 'Goal session not found'
        };
      }

      if (goalSession.status !== 'scanning' && goalSession.status !== 'initializing') {
        return {
          success: false,
          message: `Cannot start trading: session status is ${goalSession.status}`
        };
      }

      this.config = config;
      this.activeSession = config.goalSessionId;
      this.sessionStartTime = new Date();
      this.openTrades = [];

      localSessionMemory.createSession(
        `live-${config.goalSessionId}`,
        config.userId,
        `Live Goal Session: ${config.symbol}`,
        {
          symbol: config.symbol,
          timeframe: config.timeframe,
          useLLM: config.useLLM,
          riskMode: config.riskMode,
          initialBalance: config.initialBalance
        }
      );

      await supabase
        .from('goal_sessions')
        .update({
          status: 'scanning',
          last_scan_time: new Date().toISOString()
        })
        .eq('id', config.goalSessionId);

      this.startPolling();

      console.log('[Goal Live Engine] Session started successfully');

      return {
        success: true,
        message: 'Live trading session started'
      };
    } catch (error) {
      console.error('[Goal Live Engine] Error starting session:', error);
      return {
        success: false,
        message: `Failed to start session: ${(error as Error).message}`
      };
    }
  }

  /**
   * Stop live trading engine
   */
  async stopSession(): Promise<{ success: boolean; message: string }> {
    try {
      if (!this.activeSession) {
        return {
          success: false,
          message: 'No active session to stop'
        };
      }

      console.log(`[Goal Live Engine] Stopping session: ${this.activeSession}`);

      this.stopPolling();

      if (this.openTrades.length > 0) {
        console.log(`[Goal Live Engine] Closing ${this.openTrades.length} open trades...`);
        await this.closeAllPositions('session_stopped');
      }

      const summary = localSessionMemory.generateSessionSummary(`live-${this.activeSession}`);
      if (summary) {
        await this.saveLiveSessionSummary(summary);
      }

      await supabase
        .from('goal_sessions')
        .update({
          status: 'user_stopped',
          end_time: new Date().toISOString()
        })
        .eq('id', this.activeSession);

      localSessionMemory.closeSession(`live-${this.activeSession}`);

      const sessionId = this.activeSession;
      this.activeSession = null;
      this.config = null;
      this.openTrades = [];
      this.sessionStartTime = null;

      console.log('[Goal Live Engine] Session stopped successfully');

      return {
        success: true,
        message: 'Live trading session stopped'
      };
    } catch (error) {
      console.error('[Goal Live Engine] Error stopping session:', error);
      return {
        success: false,
        message: `Failed to stop session: ${(error as Error).message}`
      };
    }
  }

  /**
   * Start candle polling
   */
  private startPolling(): void {
    this.pollingInterval = setInterval(async () => {
      await this.processCandleUpdate();
    }, this.POLLING_INTERVAL_MS);

    this.processCandleUpdate();
  }

  /**
   * Stop candle polling
   */
  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Process candle update
   */
  private async processCandleUpdate(): Promise<void> {
    if (!this.config || !this.activeSession) {
      return;
    }

    try {
      const { data: candles, error } = await supabase
        .from('forex_candles')
        .select('*')
        .eq('symbol', this.config.symbol)
        .eq('timeframe', this.config.timeframe.toLowerCase())
        .order('open_time', { ascending: false })
        .limit(100);

      if (error || !candles || candles.length < 50) {
        console.warn('[Goal Live Engine] Insufficient candle data');
        return;
      }

      const sortedCandles = candles.reverse();
      const latestCandle = sortedCandles[sortedCandles.length - 1];

      if (this.lastProcessedCandleTime &&
          new Date(latestCandle.open_time).getTime() <= this.lastProcessedCandleTime.getTime()) {
        return;
      }

      this.lastProcessedCandleTime = new Date(latestCandle.open_time);
      localSessionMemory.recordCandleProcessed(`live-${this.activeSession}`);

      this.openTrades = eventBasedLLMEngine.updateOpenTrades(this.openTrades, latestCandle);

      const closedTrades = this.openTrades.filter(t => t.outcome !== 'open');
      for (const trade of closedTrades) {
        await this.handleTradeClosure(trade);
      }
      this.openTrades = this.openTrades.filter(t => t.outcome === 'open');

      const currentBalance = this.calculateCurrentBalance();
      if (currentBalance <= this.config.initialBalance + this.MAX_DAILY_LOSS) {
        console.error('[Goal Live Engine] Daily loss limit reached, stopping session');
        await this.stopSession();
        return;
      }

      if (this.openTrades.length >= this.config.maxConcurrentTrades) {
        return;
      }

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

      if (result.trigger) {
        localSessionMemory.recordTrigger(`live-${this.activeSession}`, result.trigger);
        console.log(`[Goal Live Engine] Trigger detected: ${result.trigger.type} (${result.trigger.confidence}%)`);
      }

      if (result.llmCalled) {
        localSessionMemory.recordLLMCall(`live-${this.activeSession}`, 0, {});
      }

      if (result.trade) {
        await this.handleNewTradeSignal(result.trade);
      }

      await supabase
        .from('goal_sessions')
        .update({
          last_scan_time: new Date().toISOString(),
          next_scan_time: new Date(Date.now() + this.POLLING_INTERVAL_MS).toISOString()
        })
        .eq('id', this.activeSession);

    } catch (error) {
      console.error('[Goal Live Engine] Error processing candle update:', error);
    }
  }

  /**
   * Handle new trade signal
   */
  private async handleNewTradeSignal(trade: SimulatedTrade): Promise<void> {
    if (!this.config || !this.activeSession) {
      return;
    }

    console.log(`[Goal Live Engine] New trade signal: ${trade.direction.toUpperCase()} @ ${trade.entryPrice}`);

    localSessionMemory.recordTrade(`live-${this.activeSession}`, trade);

    const { error } = await supabase
      .from('goal_session_trades')
      .insert({
        goal_session_id: this.activeSession,
        symbol: trade.symbol,
        direction: trade.direction,
        entry_price: trade.entryPrice,
        stop_loss: trade.stopLoss,
        take_profit: trade.takeProfit,
        position_size: trade.positionSize,
        status: this.config.autoExecute ? 'open' : 'pending',
        opened_at: this.config.autoExecute ? new Date().toISOString() : null
      });

    if (error) {
      console.error('[Goal Live Engine] Error saving trade signal:', error);
      return;
    }

    if (this.config.autoExecute) {
      this.openTrades.push(trade);
      console.log(`[Goal Live Engine] Trade executed automatically (auto-execute enabled)`);
    } else {
      console.log(`[Goal Live Engine] Trade signal saved (awaiting manual approval)`);
    }

    await supabase
      .from('goal_notifications')
      .insert({
        goal_session_id: this.activeSession,
        user_id: this.config.userId,
        notification_type: 'signal',
        priority: 'high',
        title: 'New Trade Signal',
        message: `${trade.direction.toUpperCase()} ${trade.symbol} @ ${trade.entryPrice} | Confidence: ${trade.confidence}%`,
        data: {
          trade_id: trade.id,
          symbol: trade.symbol,
          direction: trade.direction,
          entry_price: trade.entryPrice,
          confidence: trade.confidence
        }
      });
  }

  /**
   * Handle trade closure
   */
  private async handleTradeClosure(trade: SimulatedTrade): Promise<void> {
    if (!this.activeSession) {
      return;
    }

    console.log(`[Goal Live Engine] Trade closed: ${trade.outcome.toUpperCase()} - PnL: $${trade.pnl.toFixed(2)}`);

    localSessionMemory.recordTradeClosure(`live-${this.activeSession}`, trade);

    const { error } = await supabase
      .from('goal_session_trades')
      .update({
        exit_price: trade.exitPrice,
        profit_loss: trade.pnl,
        status: 'closed',
        closed_at: new Date().toISOString()
      })
      .eq('goal_session_id', this.activeSession)
      .eq('symbol', trade.symbol)
      .eq('entry_price', trade.entryPrice)
      .is('closed_at', null);

    if (error) {
      console.error('[Goal Live Engine] Error updating closed trade:', error);
    }

    const stats = localSessionMemory.getSessionStatistics(`live-${this.activeSession}`);
    if (stats) {
      await supabase
        .from('goal_sessions')
        .update({
          current_progress: stats.totalPnL,
          progress_percentage: (stats.totalPnL / this.config!.initialBalance) * 100
        })
        .eq('id', this.activeSession);

      await supabase
        .from('goal_notifications')
        .insert({
          goal_session_id: this.activeSession,
          user_id: this.config!.userId,
          notification_type: 'progress',
          priority: trade.outcome === 'win' ? 'medium' : 'high',
          title: `Trade Closed: ${trade.outcome.toUpperCase()}`,
          message: `${trade.symbol} ${trade.direction.toUpperCase()} closed with ${trade.outcome} | P&L: $${trade.pnl.toFixed(2)}`,
          data: {
            trade_id: trade.id,
            outcome: trade.outcome,
            pnl: trade.pnl,
            total_pnl: stats.totalPnL
          }
        });
    }
  }

  /**
   * Close all open positions
   */
  private async closeAllPositions(reason: string): Promise<void> {
    if (!this.config) {
      return;
    }

    const { data: candles } = await supabase
      .from('forex_candles')
      .select('*')
      .eq('symbol', this.config.symbol)
      .eq('timeframe', this.config.timeframe.toLowerCase())
      .order('open_time', { ascending: false })
      .limit(1);

    if (!candles || candles.length === 0) {
      return;
    }

    const latestCandle = candles[0];

    for (const trade of this.openTrades) {
      eventBasedLLMEngine.updateOpenTrades([trade], latestCandle);
      if (trade.outcome !== 'open') {
        await this.handleTradeClosure(trade);
      }
    }

    this.openTrades = [];
  }

  /**
   * Calculate current balance
   */
  private calculateCurrentBalance(): number {
    if (!this.activeSession) {
      return this.config?.initialBalance || 0;
    }

    const stats = localSessionMemory.getSessionStatistics(`live-${this.activeSession}`);
    return stats?.finalBalance || this.config?.initialBalance || 0;
  }

  /**
   * Save live session summary to database
   */
  private async saveLiveSessionSummary(summary: any): Promise<void> {
    try {
      await supabase.from('goal_ai_conversations').insert({
        goal_session_id: this.activeSession,
        user_id: this.config!.userId,
        role: 'ai',
        message: `Session complete! Processed ${summary.statistics.candlesProcessed} candles, detected ${summary.statistics.triggersDetected} triggers, executed ${summary.statistics.tradesExecuted} trades. Win rate: ${summary.statistics.winRate.toFixed(1)}%, Total P&L: $${summary.statistics.totalPnL.toFixed(2)}`,
        context: summary.statistics,
        sentiment: summary.statistics.totalPnL > 0 ? 'celebratory' : 'educational'
      });

      console.log('[Goal Live Engine] Session summary saved');
    } catch (error) {
      console.error('[Goal Live Engine] Error saving summary:', error);
    }
  }

  /**
   * Get current engine status
   */
  getStatus(): LiveEngineStatus {
    const stats = this.activeSession
      ? localSessionMemory.getSessionStatistics(`live-${this.activeSession}`)
      : null;

    return {
      isRunning: this.activeSession !== null,
      sessionId: this.activeSession,
      currentSymbol: this.config?.symbol || null,
      lastCandleTime: this.lastProcessedCandleTime,
      triggersDetected: stats?.triggersDetected || 0,
      llmCallsMade: stats?.llmCallsMade || 0,
      tradesExecuted: stats?.tradesExecuted || 0,
      openTrades: this.openTrades.length,
      currentBalance: this.calculateCurrentBalance(),
      uptime: this.sessionStartTime
        ? Math.floor((Date.now() - this.sessionStartTime.getTime()) / 1000)
        : 0
    };
  }

  /**
   * Check if session is active
   */
  isSessionActive(): boolean {
    return this.activeSession !== null;
  }

  /**
   * Get active session ID
   */
  getActiveSessionId(): string | null {
    return this.activeSession;
  }
}

export const goalSessionLiveEngine = new GoalSessionLiveEngine();
