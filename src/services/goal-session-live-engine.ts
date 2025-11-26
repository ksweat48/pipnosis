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
import { tradeExecutionEngine } from './trade-execution-engine';
import { midTradeTriggerDetector, type MarketConditions } from './mid-trade-trigger-detector';
import { llmMidTradeEvaluator } from './llm-mid-trade-evaluator';
import { logger, LogCategory } from '../lib/logger';
import { openAIClient } from './openai-client';
import { normalizeTimeframeToDb } from './chart-preferences';

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
  private scanCount = 0;
  private lastAIUpdateTime = 0;
  private processingLock = false;

  private readonly POLLING_INTERVAL_MS = 15000;
  private readonly MAX_DAILY_LOSS_PERCENT = 10;

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

      logger.info(LogCategory.AI_TRADING, `Starting goal session: ${config.goalSessionId}`);

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

      // ✅ CRITICAL: Initialize 5-layer LLM pipeline
      await eventBasedLLMEngine.initialize(config.userId, config.goalSessionId);
      eventBasedLLMEngine.set5LayerPipeline(true);
      logger.info(LogCategory.AI_TRADING, '✅ 5-Layer LLM Pipeline ACTIVATED');
      logger.debug(LogCategory.AI_TRADING, '✅ Hard Gate + 4 validation layers enabled');

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

      logger.info(LogCategory.AI_TRADING, '✅ Session started - LIVE DEMO MODE with real price monitoring');
      logger.debug(LogCategory.AI_TRADING, '✅ SL/TP will be visible on charts');
      logger.debug(LogCategory.AI_TRADING, '✅ Polling every 15 seconds for triggers');

      return {
        success: true,
        message: 'Live demo trading session started with 5-layer protection'
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

      logger.info(LogCategory.AI_TRADING, `Stopping goal session: ${this.activeSession}`);

      this.stopPolling();

      if (this.openTrades.length > 0) {
        logger.info(LogCategory.AI_TRADING, `Closing ${this.openTrades.length} open trades...`);
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

      logger.info(LogCategory.AI_TRADING, 'Session stopped successfully');

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
   * Process candle update with mutex to prevent race conditions
   */
  private async processCandleUpdate(): Promise<void> {
    if (!this.config || !this.activeSession) {
      return;
    }

    if (this.processingLock) {
      logger.debug(LogCategory.AI_TRADING, 'Polling already in progress, skipping...');
      return;
    }

    this.processingLock = true;

    try {
      const dbTimeframe = normalizeTimeframeToDb(this.config.timeframe);
      logger.debug(LogCategory.AI_TRADING, `Querying candles: ${this.config.symbol} ${this.config.timeframe} -> ${dbTimeframe}`);

      const { data: candles, error } = await supabase
        .from('forex_candles')
        .select('*')
        .eq('symbol', this.config.symbol)
        .eq('timeframe', dbTimeframe)
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
      this.scanCount++;

      // Update open trades and check for closures
      this.openTrades = eventBasedLLMEngine.updateOpenTrades(this.openTrades, latestCandle);

      // Check for mid-trade triggers and evaluate with LLM if needed
      for (const trade of this.openTrades) {
        if (trade.outcome === 'open') {
          await this.checkMidTradeTriggers(trade, sortedCandles, latestCandle);
        }
      }

      // Send monitoring updates for open positions (every minute)
      if (this.openTrades.length > 0 && Date.now() - this.lastAIUpdateTime > 60000) {
        await this.sendTradeMonitoringUpdate(latestCandle);
        this.lastAIUpdateTime = Date.now();
      }

      const closedTrades = this.openTrades.filter(t => t.outcome !== 'open');
      for (const trade of closedTrades) {
        await this.handleTradeClosure(trade);
      }
      this.openTrades = this.openTrades.filter(t => t.outcome === 'open');

      const currentBalance = this.calculateCurrentBalance();
      const maxLossAmount = -(this.config.initialBalance * (this.MAX_DAILY_LOSS_PERCENT / 100));
      if (currentBalance <= this.config.initialBalance + maxLossAmount) {
        console.error(`[Goal Live Engine] Daily loss limit reached (${this.MAX_DAILY_LOSS_PERCENT}%), stopping session`);
        await this.stopSession();
        return;
      }

      if (this.openTrades.length >= this.config.maxConcurrentTrades) {
        return;
      }

      // Get goal session details for context
      const { data: goalSession } = await supabase
        .from('goal_sessions')
        .select('*')
        .eq('id', this.activeSession)
        .single();

      const goalContext = goalSession ? {
        goalSessionId: this.activeSession,
        targetValue: goalSession.target_value,
        currentProgress: goalSession.current_progress || 0,
        progressPercentage: goalSession.progress_percentage || 0,
        timeframe: goalSession.timeframe,
        riskMode: goalSession.risk_mode,
        tradesRemaining: this.config.maxConcurrentTrades - this.openTrades.length
      } : undefined;

      const engineConfig: EventBasedEngineConfig = {
        symbol: this.config.symbol,
        timeframe: this.config.timeframe,
        useLLM: this.config.useLLM,
        riskMode: this.config.riskMode,
        maxConcurrentTrades: this.config.maxConcurrentTrades,
        initialBalance: this.config.initialBalance,
        goalContext
      };

      const result = await eventBasedLLMEngine.processCandle(
        sortedCandles,
        engineConfig,
        this.openTrades
      );

      // Send scanning status update (every 4th scan = every minute)
      if (this.scanCount % 4 === 0 && this.openTrades.length === 0) {
        await this.sendScanningUpdate(latestCandle, result.trigger);
      }

      if (result.trigger) {
        localSessionMemory.recordTrigger(`live-${this.activeSession}`, result.trigger);
        logger.debug(LogCategory.AI_TRADING, `Trigger detected: ${result.trigger.type} (${result.trigger.confidence}%)`);

        // Send trigger detection message
        await this.sendTriggerDetectedMessage(result.trigger, latestCandle);
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
    } finally {
      this.processingLock = false;
    }
  }

  /**
   * Handle new trade signal - Routes through trade-execution-engine for proper simulated_positions creation
   */
  private async handleNewTradeSignal(trade: SimulatedTrade): Promise<void> {
    if (!this.config || !this.activeSession) {
      return;
    }

    logger.info(LogCategory.AI_TRADING, `✅ Trade approved: ${trade.direction.toUpperCase()} @ ${trade.entryPrice} (${trade.confidence}% confidence)`);
    logger.debug(LogCategory.AI_TRADING, `Trigger: ${trade.triggerType}`);

    localSessionMemory.recordTrade(`live-${this.activeSession}`, trade);

    // Calculate risk/reward for validation
    const riskPips = Math.abs(trade.entryPrice - trade.stopLoss) / 0.0001;
    const rewardPips = Math.abs(trade.takeProfit - trade.entryPrice) / 0.0001;
    const riskReward = rewardPips / riskPips;
    const expectedProfit = rewardPips * 10 * trade.positionSize;

    // Route through trade-execution-engine to create simulated_positions
    const executionResult = await tradeExecutionEngine.executeSignal(
      {
        sessionId: this.activeSession,
        symbol: trade.symbol,
        direction: trade.direction,
        entryPrice: trade.entryPrice,
        stopLoss: trade.stopLoss,
        takeProfit: trade.takeProfit,
        positionSize: trade.positionSize,
        confidence: trade.confidence,
        setupType: trade.triggerType,
        reasoning: trade.reasoning,
        riskReward,
        expectedProfit
      },
      this.config.userId,
      this.config.autoExecute
    );

    if (executionResult.success) {
      logger.info(LogCategory.AI_TRADING, `✅ Trade created: ID ${executionResult.tradeId} - SL/TP visible on chart`);
      logger.debug(LogCategory.AI_TRADING, 'simulated_positions table updated');

      if (this.config.autoExecute) {
        this.openTrades.push(trade);
      }

      // Send detailed trade execution message to AI conversation
      const message = `🎯 Trade Executed: ${trade.symbol} ${trade.direction.toUpperCase()} @ ${trade.entryPrice.toFixed(5)}\n` +
        `📊 Entry: ${trade.entryPrice.toFixed(5)} | SL: ${trade.stopLoss.toFixed(5)} | TP: ${trade.takeProfit.toFixed(5)}\n` +
        `💰 Risk: $${(riskPips * 10 * trade.positionSize).toFixed(2)} | Reward: $${expectedProfit.toFixed(2)} | R:R ${riskReward.toFixed(2)}\n` +
        `🎲 Confidence: ${trade.confidence}% | Setup: ${trade.triggerType}\n` +
        `🔄 Monitoring every 15 seconds for TP/SL hit...`;

      await supabase.from('goal_ai_conversations').insert({
        goal_session_id: this.activeSession,
        user_id: this.config.userId,
        role: 'ai',
        message,
        context: {
          trade_id: executionResult.tradeId,
          execution_result: executionResult
        },
        sentiment: 'encouraging',
        technical_data: {
          entry_price: trade.entryPrice,
          stop_loss: trade.stopLoss,
          take_profit: trade.takeProfit,
          risk_pips: riskPips,
          reward_pips: rewardPips,
          risk_reward: riskReward
        },
        market_snapshot: {
          confidence: trade.confidence,
          setup_type: trade.triggerType
        }
      });
    } else {
      console.error(`[Goal Live Engine] ❌ Trade execution failed: ${executionResult.message}`);

      // Send failure message
      await supabase.from('goal_ai_conversations').insert({
        goal_session_id: this.activeSession,
        user_id: this.config.userId,
        role: 'ai',
        message: `❌ Trade execution failed: ${executionResult.message}. Continuing to scan for next opportunity...`,
        context: { error: executionResult.message },
        sentiment: 'cautionary'
      });
    }
  }

  /**
   * Handle trade closure
   */
  private async handleTradeClosure(trade: SimulatedTrade): Promise<void> {
    if (!this.activeSession) {
      return;
    }

    logger.info(LogCategory.AI_TRADING, `Trade closed: ${trade.outcome.toUpperCase()} - PnL: $${trade.pnl.toFixed(2)}`);

    // Clear mid-trade triggers for this trade
    midTradeTriggerDetector.clearTriggers(trade.id);

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

    // Calculate trade duration
    const tradeDuration = Math.floor((trade.exitTime!.getTime() - trade.entryTime.getTime()) / 60000);
    const durationText = tradeDuration < 60
      ? `${tradeDuration}m`
      : `${Math.floor(tradeDuration / 60)}h ${tradeDuration % 60}m`;

    // Calculate pips
    const isLong = trade.direction === 'buy';
    const priceDiff = isLong
      ? (trade.exitPrice! - trade.entryPrice)
      : (trade.entryPrice - trade.exitPrice!);
    const pips = priceDiff / 0.0001;

    // Determine exit reason and emoji
    const isWin = trade.outcome === 'win';
    const emoji = isWin ? '✅' : '❌';
    const exitReason = trade.exitReason || (isWin ? 'Take profit hit' : 'Stop loss hit');

    // Send trade closure message
    const closureMessage = `${emoji} Trade Closed: ${trade.symbol} ${trade.direction.toUpperCase()}\\n` +
      `📊 Exit: ${trade.exitPrice?.toFixed(5)} | Reason: ${exitReason}\\n` +
      `⏱️ Duration: ${durationText}\\n` +
      `💰 P&L: ${trade.pnl >= 0 ? '+' : ''}$${trade.pnl.toFixed(2)} (${pips >= 0 ? '+' : ''}${pips.toFixed(1)} pips)`;

    await supabase.from('goal_ai_conversations').insert({
      goal_session_id: this.activeSession,
      user_id: this.config!.userId,
      role: 'ai',
      message: closureMessage,
      context: {
        trade_id: trade.id,
        outcome: trade.outcome,
        duration_minutes: tradeDuration
      },
      sentiment: isWin ? 'encouraging' : 'educational',
      technical_data: {
        entry_price: trade.entryPrice,
        exit_price: trade.exitPrice,
        pnl: trade.pnl,
        pips,
        duration: durationText
      },
      market_snapshot: {
        exit_reason: exitReason
      }
    });

    // Get session stats and send post-trade analysis
    const stats = localSessionMemory.getSessionStatistics(`live-${this.activeSession}`);
    if (stats) {
      // Get fresh goal session data for progress calculation
      const { data: goalSessionData } = await supabase
        .from('goal_sessions')
        .select('target_value')
        .eq('id', this.activeSession)
        .single();

      const targetValue = goalSessionData?.target_value || this.config!.initialBalance;

      // Update progress in database
      await supabase
        .from('goal_sessions')
        .update({
          current_progress: stats.totalPnL,
          progress_percentage: (stats.totalPnL / targetValue) * 100
        })
        .eq('id', this.activeSession);

      // Get intelligent post-trade analysis from LLM
      const llmAnalysis = await this.generatePostTradeAnalysis(trade, stats);

      const progressMessage = `\\n🎯 Goal Progress: ${stats.totalPnL >= 0 ? '+' : ''}$${stats.totalPnL.toFixed(2)} / $${targetValue.toFixed(2)} target (${((stats.totalPnL / targetValue) * 100).toFixed(1)}%)\\n` +
        `📊 Session Stats: ${stats.totalTrades} trades | ${stats.winningTrades} wins | ${((stats.winningTrades / stats.totalTrades) * 100).toFixed(0)}% win rate\\n` +
        `💪 Continuing to scan for next high-quality setup...`;

      await supabase.from('goal_ai_conversations').insert({
        goal_session_id: this.activeSession,
        user_id: this.config!.userId,
        role: 'ai',
        message: llmAnalysis + progressMessage,
        context: {
          stats,
          trade_id: trade.id,
          llm_analysis: true
        },
        sentiment: 'analytical',
        technical_data: {
          total_pnl: stats.totalPnL,
          win_rate: (stats.winningTrades / stats.totalTrades) * 100,
          total_trades: stats.totalTrades
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
      // Generate learning insights from session
      const stats = summary.statistics;
      const learningInsights: string[] = [];

      // Performance insights
      if (stats.winRate >= 70) {
        learningInsights.push('✅ Excellent win rate - your pattern recognition is improving');
      } else if (stats.winRate >= 50) {
        learningInsights.push('📊 Solid win rate - building consistency');
      } else if (stats.winRate > 0) {
        learningInsights.push('📉 Win rate needs improvement - will adjust strategy next session');
      }

      // Trigger efficiency
      if (stats.triggersDetected > 0) {
        const triggerToTradeRatio = (stats.tradesExecuted / stats.triggersDetected) * 100;
        if (triggerToTradeRatio >= 50) {
          learningInsights.push('🎯 High trigger quality - filtering working well');
        } else if (triggerToTradeRatio < 20) {
          learningInsights.push('⚡ Many triggers filtered out - being selective');
        }
      }

      // P&L insights
      if (stats.totalPnL > 0) {
        learningInsights.push(`💰 Profitable session: +$${stats.totalPnL.toFixed(2)}`);
      } else if (stats.totalPnL < 0) {
        learningInsights.push(`📚 Learning from losses: -$${Math.abs(stats.totalPnL).toFixed(2)}`);
        learningInsights.push('🔄 Will avoid similar setups next time');
      }

      // Trade count insights
      if (stats.tradesExecuted === 0) {
        learningInsights.push('⏳ No trades today - waiting for premium setups');
      } else if (stats.tradesExecuted >= 5) {
        learningInsights.push('📈 Active session - multiple opportunities found');
      }

      const learningSummary = `
🎓 SESSION COMPLETE - What I Learned:

📊 Performance:
• Win Rate: ${stats.winRate.toFixed(1)}%
• Trades: ${stats.tradesExecuted} executed from ${stats.triggersDetected} triggers
• P&L: ${stats.totalPnL >= 0 ? '+' : ''}$${stats.totalPnL.toFixed(2)}

💡 Key Insights:
${learningInsights.map(insight => `• ${insight}`).join('\n')}

🔮 Next Session:
• I'll remember today's patterns (${stats.winRate >= 50 ? 'repeat winners' : 'avoid losers'})
• Focus on high-confidence setups (${stats.llmCallsMade} LLM evaluations today)
• Continue building long-term edge

This learning will carry forward to improve future sessions!
      `.trim();

      await supabase.from('goal_ai_conversations').insert({
        goal_session_id: this.activeSession,
        user_id: this.config!.userId,
        role: 'ai',
        message: learningSummary,
        context: {
          ...summary.statistics,
          learningInsights,
          sessionType: 'live_goal_mode'
        },
        sentiment: stats.totalPnL > 0 ? 'celebratory' : 'educational'
      });

      logger.info(LogCategory.AI_TRADING, 'Learning summary sent to user');
      logger.debug(LogCategory.AI_TRADING, `Insights: ${learningInsights.length} generated`);
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

  /**
   * Send scanning status update to AI conversation
   */
  private async sendScanningUpdate(latestCandle: any, trigger: any | null): Promise<void> {
    if (!this.config || !this.activeSession) return;

    const price = latestCandle.close;
    const time = new Date(latestCandle.open_time).toLocaleTimeString();

    let message: string;
    if (trigger) {
      message = `📊 Scan ${this.config.symbol} @ ${price.toFixed(5)} - ${trigger.type} trigger detected (${trigger.confidence}% confidence) - Analyzing...`;
    } else {
      const sessionDuration = this.sessionStartTime
        ? Math.floor((Date.now() - this.sessionStartTime.getTime()) / 60000)
        : 0;
      message = `🔍 Scanning ${this.config.symbol} @ ${price.toFixed(5)} - No triggers yet. Session running ${sessionDuration}m - Waiting for high-quality setups...`;
    }

    await supabase.from('goal_ai_conversations').insert({
      goal_session_id: this.activeSession,
      user_id: this.config.userId,
      role: 'ai',
      message,
      context: { scanCount: this.scanCount, hasOpenTrades: this.openTrades.length > 0 },
      sentiment: trigger ? 'excited' : 'neutral',
      technical_data: { price, symbol: this.config.symbol, time },
      market_snapshot: { trigger: trigger?.type || null }
    });
  }

  /**
   * Send trigger detected message
   */
  private async sendTriggerDetectedMessage(trigger: any, latestCandle: any): Promise<void> {
    if (!this.config || !this.activeSession) return;

    const message = `🎯 Potential setup detected on ${this.config.symbol}! Type: ${trigger.type} | Confidence: ${trigger.confidence}% | Initiating 5-layer validation...`;

    await supabase.from('goal_ai_conversations').insert({
      goal_session_id: this.activeSession,
      user_id: this.config.userId,
      role: 'ai',
      message,
      context: { trigger, price: latestCandle.close },
      sentiment: 'analytical',
      technical_data: {
        trigger_type: trigger.type,
        confidence: trigger.confidence,
        price: latestCandle.close
      }
    });
  }

  /**
   * Check for mid-trade triggers and evaluate with LLM if needed
   */
  private async checkMidTradeTriggers(
    trade: SimulatedTrade,
    allCandles: any[],
    latestCandle: any
  ): Promise<void> {
    if (!this.config || !this.activeSession) return;

    // Build market conditions from candles
    const marketConditions: MarketConditions = {
      currentPrice: latestCandle.close,
      ohlc: allCandles,
      indicators: {
        vwap: latestCandle.vwap,
        ema20: latestCandle.ema20,
        ema50: latestCandle.ema50
      },
      priceAction: {
        trend: this.detectTrend(allCandles),
        volatility: this.detectVolatility(allCandles),
        momentum: this.detectMomentum(allCandles)
      }
    };

    // Check for triggers
    const triggerResult = midTradeTriggerDetector.checkForTriggers(trade, marketConditions);

    if (triggerResult.triggered && triggerResult.shouldCallLLM) {
      logger.debug(LogCategory.AI_TRADING, `Mid-trade trigger: ${triggerResult.triggerType} - ${triggerResult.triggerReason}`);

      // Send trigger notification to AI conversation
      await this.sendMidTradeTriggerMessage(triggerResult, trade, latestCandle);

      // Get goal context
      const goalContext = {
        goalSessionId: this.activeSession,
        targetValue: this.config.initialBalance,
        currentProgress: this.calculateCurrentBalance() - this.config.initialBalance,
        tradesRemaining: this.config.maxConcurrentTrades - this.openTrades.length
      };

      // Call LLM for evaluation
      const evaluation = await llmMidTradeEvaluator.evaluateTrade(
        {
          trade,
          marketConditions,
          trigger: triggerResult,
          goalContext
        },
        this.config.userId
      );

      logger.info(LogCategory.AI_TRADING, `Mid-trade LLM: ${evaluation.recommendation} (${evaluation.confidence}% confidence)`);
      logger.debug(LogCategory.AI_TRADING, `Reasoning: ${evaluation.reasoning}`);
      logger.debug(LogCategory.AI_TRADING, `Cost: $${evaluation.costUsd.toFixed(4)} | Tokens: ${evaluation.tokensUsed}`);

      // Send LLM evaluation to AI conversation
      await this.sendMidTradeEvaluationMessage(evaluation, trade, latestCandle);

      // Validate and apply recommendation
      await this.applyMidTradeRecommendation(evaluation, trade);
    }
  }

  /**
   * Apply LLM mid-trade recommendation with hard rule validation
   */
  private async applyMidTradeRecommendation(
    evaluation: any,
    trade: SimulatedTrade
  ): Promise<void> {
    if (!this.config || !this.activeSession) return;

    // Validate recommendation against hard rules
    const validation = llmMidTradeEvaluator.validateRecommendation(evaluation, trade);

    if (!validation.isValid) {
      logger.warn(LogCategory.AI_TRADING, `Mid-trade recommendation rejected: ${validation.violations.join(', ')}`);

      // Send rejection message
      await supabase.from('goal_ai_conversations').insert({
        goal_session_id: this.activeSession,
        user_id: this.config.userId,
        role: 'ai',
        message: `⚠️ LLM recommendation rejected: ${validation.violations.join('. ')}. Keeping current parameters for safety.`,
        context: { evaluation, validation },
        sentiment: 'cautionary'
      });

      return;
    }

    // Apply recommendation
    let actionMessage = '';

    switch (evaluation.recommendation) {
      case 'HOLD':
        actionMessage = `✓ LLM Decision: Continue holding position. ${evaluation.reasoning}`;
        break;

      case 'MOVE_SL':
        if (evaluation.suggestedActions?.newStopLoss) {
          trade.stopLoss = evaluation.suggestedActions.newStopLoss;
          actionMessage = `✓ Stop Loss adjusted to ${trade.stopLoss.toFixed(5)}. ${evaluation.reasoning}`;

          // Update database
          await supabase
            .from('goal_session_trades')
            .update({ stop_loss: trade.stopLoss })
            .eq('id', trade.id);
        }
        break;

      case 'MOVE_TP':
        if (evaluation.suggestedActions?.newTakeProfit) {
          trade.takeProfit = evaluation.suggestedActions.newTakeProfit;
          actionMessage = `✓ Take Profit adjusted to ${trade.takeProfit.toFixed(5)}. ${evaluation.reasoning}`;

          // Update database
          await supabase
            .from('goal_session_trades')
            .update({ take_profit: trade.takeProfit })
            .eq('id', trade.id);
        }
        break;

      case 'TAKE_PROFIT_EARLY':
      case 'EXIT_IMMEDIATELY':
        // Force close the trade
        trade.outcome = 'win'; // Will be recalculated
        trade.exitTime = new Date();
        trade.exitPrice = evaluation.suggestedActions?.exitPrice || trade.entryPrice;
        trade.exitReason = evaluation.recommendation === 'EXIT_IMMEDIATELY'
          ? 'LLM emergency exit'
          : 'LLM early profit taking';

        actionMessage = `${evaluation.recommendation === 'EXIT_IMMEDIATELY' ? '❌' : '🎯'} Position closed by LLM at ${trade.exitPrice.toFixed(5)}. ${evaluation.reasoning}`;
        break;

      default:
        actionMessage = `✓ LLM Decision: ${evaluation.recommendation}`;
    }

    // Send action message to AI conversation
    await supabase.from('goal_ai_conversations').insert({
      goal_session_id: this.activeSession,
      user_id: this.config.userId,
      role: 'ai',
      message: actionMessage,
      context: { evaluation, trade_id: trade.id },
      sentiment: evaluation.recommendation === 'EXIT_IMMEDIATELY' ? 'cautionary' : 'analytical',
      technical_data: {
        recommendation: evaluation.recommendation,
        confidence: evaluation.confidence,
        new_sl: trade.stopLoss,
        new_tp: trade.takeProfit
      }
    });

    logger.info(LogCategory.AI_TRADING, `Mid-trade action: ${evaluation.recommendation}`);
  }

  /**
   * Send mid-trade trigger notification
   */
  private async sendMidTradeTriggerMessage(trigger: any, trade: SimulatedTrade, candle: any): Promise<void> {
    if (!this.config || !this.activeSession) return;

    const message = `⚠️ Mid-Trade Event: ${trigger.triggerReason}. Requesting LLM evaluation...`;

    await supabase.from('goal_ai_conversations').insert({
      goal_session_id: this.activeSession,
      user_id: this.config.userId,
      role: 'ai',
      message,
      context: { trigger, trade_id: trade.id },
      sentiment: 'analytical',
      technical_data: {
        trigger_type: trigger.triggerType,
        confidence: trigger.confidence,
        current_price: candle.close
      }
    });
  }

  /**
   * Send LLM mid-trade evaluation results
   */
  private async sendMidTradeEvaluationMessage(evaluation: any, trade: SimulatedTrade, candle: any): Promise<void> {
    if (!this.config || !this.activeSession) return;

    const emoji = evaluation.recommendation === 'EXIT_IMMEDIATELY' ? '❌' :
                   evaluation.recommendation === 'TAKE_PROFIT_EARLY' ? '🎯' :
                   evaluation.recommendation === 'HOLD' ? '✓' : '📊';

    const message = `${emoji} LLM Evaluation (${evaluation.processingTimeMs}ms): ${evaluation.reasoning}\\n` +
      `Recommendation: ${evaluation.recommendation} | Confidence: ${evaluation.confidence}%`;

    await supabase.from('goal_ai_conversations').insert({
      goal_session_id: this.activeSession,
      user_id: this.config.userId,
      role: 'ai',
      message,
      context: { evaluation, trade_id: trade.id },
      sentiment: 'analytical',
      technical_data: {
        recommendation: evaluation.recommendation,
        confidence: evaluation.confidence,
        cost_usd: evaluation.costUsd,
        tokens_used: evaluation.tokensUsed
      }
    });
  }

  /**
   * Detect trend from candles (simple EMA-based)
   */
  private detectTrend(candles: any[]): string {
    if (candles.length < 20) return 'unknown';

    const latest = candles[candles.length - 1];
    if (!latest.ema20 || !latest.ema50) return 'unknown';

    if (latest.close > latest.ema20 && latest.ema20 > latest.ema50) return 'bullish';
    if (latest.close < latest.ema20 && latest.ema20 < latest.ema50) return 'bearish';
    return 'neutral';
  }

  /**
   * Detect volatility from candles (simple ATR-based)
   */
  private detectVolatility(candles: any[]): string {
    if (candles.length < 10) return 'unknown';

    const recent10 = candles.slice(-10);
    const avgRange = recent10.reduce((sum, c) => sum + (c.high - c.low), 0) / 10;

    // Simple thresholds for forex
    if (avgRange > 0.001) return 'high';
    if (avgRange > 0.0005) return 'medium';
    return 'low';
  }

  /**
   * Detect momentum from candles (simple price change)
   */
  private detectMomentum(candles: any[]): string {
    if (candles.length < 5) return 'unknown';

    const recent = candles.slice(-5);
    const priceChange = ((recent[4].close - recent[0].close) / recent[0].close) * 100;

    if (Math.abs(priceChange) > 0.5) return priceChange > 0 ? 'strong_up' : 'strong_down';
    if (Math.abs(priceChange) > 0.2) return priceChange > 0 ? 'moderate_up' : 'moderate_down';
    return 'weak';
  }

  /**
   * Generate intelligent post-trade analysis using LLM
   */
  private async generatePostTradeAnalysis(trade: SimulatedTrade, stats: any): Promise<string> {
    try {
      const isWin = trade.outcome === 'win';
      const tradeDuration = Math.floor((trade.exitTime!.getTime() - trade.entryTime.getTime()) / 60000);

      const prompt = `Analyze this completed trade and provide educational insights:

TRADE DETAILS:
- Symbol: ${trade.symbol}
- Direction: ${trade.direction.toUpperCase()}
- Entry: ${trade.entryPrice.toFixed(5)}
- Exit: ${trade.exitPrice?.toFixed(5)} (${trade.exitReason || 'Unknown'})
- Result: ${isWin ? 'WIN' : 'LOSS'}
- P&L: $${trade.pnl.toFixed(2)}
- Duration: ${tradeDuration} minutes
- Setup Type: ${trade.triggerType}
- Initial Confidence: ${trade.confidence}%

SESSION CONTEXT:
- Total Trades: ${stats.totalTrades}
- Win Rate: ${((stats.winningTrades / stats.totalTrades) * 100).toFixed(0)}%
- Total P&L: $${stats.totalPnL.toFixed(2)}

Provide:
1. Why did this trade win/lose?
2. What can we learn from this outcome?
3. Should we adjust our approach for similar setups?
4. Brief actionable insight (1-2 sentences)

Keep response under 100 words, educational tone.`;

      const response = await openAIClient.createChatCompletion([
        {
          role: 'system',
          content: 'You are a professional trading mentor providing concise, educational post-trade analysis. Focus on learning and improvement.'
        },
        {
          role: 'user',
          content: prompt
        }
      ], {
        model: 'gpt-4o-mini',
        temperature: 0.4,
        max_tokens: 200
      });

      return `💡 ${response.content}`;

    } catch (error) {
      console.error('[Post-Trade Analysis] LLM error:', error);

      // Fallback to template if LLM fails
      const isWin = trade.outcome === 'win';
      return isWin
        ? `💡 Analysis: Setup executed well. ${trade.triggerType} pattern performed as expected. Confidence ${trade.confidence}% was justified.`
        : `💡 Analysis: ${trade.exitReason || 'Trade closed'}. Initial setup quality was ${trade.confidence}%. Market conditions changed after entry.`;
    }
  }

  /**
   * Send trade monitoring update for open positions
   */
  private async sendTradeMonitoringUpdate(latestCandle: any): Promise<void> {
    if (!this.config || !this.activeSession || this.openTrades.length === 0) return;

    const trade = this.openTrades[0]; // Monitor first open trade
    const currentPrice = latestCandle.close;
    const isLong = trade.direction === 'buy';

    // Calculate current P&L
    const priceDiff = isLong
      ? (currentPrice - trade.entryPrice)
      : (trade.entryPrice - currentPrice);
    const pips = priceDiff / 0.0001;
    const pnl = pips * 10 * trade.positionSize;

    // Calculate time open
    const timeOpen = Math.floor((Date.now() - trade.entryTime.getTime()) / 60000);

    // Calculate distance to TP and SL
    const distanceToTP = isLong
      ? ((trade.takeProfit - currentPrice) / 0.0001)
      : ((currentPrice - trade.takeProfit) / 0.0001);
    const distanceToSL = isLong
      ? ((currentPrice - trade.stopLoss) / 0.0001)
      : ((trade.stopLoss - currentPrice) / 0.0001);

    let sentiment = 'neutral';
    let emoji = '🔄';
    let statusText = 'Holding';

    if (pnl > 10) {
      sentiment = 'encouraging';
      emoji = '📈';
      statusText = 'In profit';
    } else if (pnl < -10) {
      sentiment = 'cautionary';
      emoji = '⚠️';
      statusText = 'Underwater';
    }

    if (Math.abs(distanceToSL) < 5) {
      sentiment = 'cautionary';
      emoji = '🚨';
      statusText = 'Near stop loss';
    } else if (Math.abs(distanceToTP) < 5) {
      sentiment = 'encouraging';
      emoji = '🎯';
      statusText = 'Near take profit';
    }

    const message = `${emoji} ${statusText}: ${trade.symbol} ${trade.direction.toUpperCase()} (${timeOpen}m) | Price: ${currentPrice.toFixed(5)} | P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pips >= 0 ? '+' : ''}${pips.toFixed(1)} pips)`;

    await supabase.from('goal_ai_conversations').insert({
      goal_session_id: this.activeSession,
      user_id: this.config.userId,
      role: 'ai',
      message,
      context: {
        trade_id: trade.id,
        time_open: timeOpen,
        current_pnl: pnl
      },
      sentiment,
      technical_data: {
        current_price: currentPrice,
        entry_price: trade.entryPrice,
        stop_loss: trade.stopLoss,
        take_profit: trade.takeProfit,
        pnl,
        pips
      },
      market_snapshot: {
        distance_to_tp: distanceToTP,
        distance_to_sl: distanceToSL
      }
    });
  }
}

export const goalSessionLiveEngine = new GoalSessionLiveEngine();
