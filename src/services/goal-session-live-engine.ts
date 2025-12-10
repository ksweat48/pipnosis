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
import { logger, LogCategory, LogLevel } from '../lib/logger';
import { openAIClient } from './openai-client';
import { normalizeTimeframeToDb } from '../utils/timeframe-utils';
import { multiSymbolScanner } from './multi-symbol-scanner';
import { multiSymbolSnapshotBuilder, type SymbolSnapshot } from './multi-symbol-snapshot-builder';
import { alphaOmegaOrchestrator, type FullMarketState } from './alpha-omega-orchestrator';
import { bestSymbolSelector } from './best-symbol-selector';
import { getDefaultWatchlist } from '../config/watchlist';
import { TraderScore } from './ai-identity';

// 🚨 EMERGENCY: Restore full AI trading visibility for autonomous mode debugging
logger.setCategoryLevel(LogCategory.AI_TRADING, LogLevel.INFO);
console.log('%c[Goal Session Engine] 🔍 AI_TRADING logs set to INFO for autonomous debugging', 'color: #f59e0b; font-weight: bold');

export interface GoalSessionLiveConfig {
  goalSessionId: string;
  userId: string;
  symbol: string; // Kept for backward compatibility, but watchlist is now primary
  watchlist?: string[]; // Multi-symbol watchlist (e.g., ['EURUSD', 'XAUUSD', 'GBPUSD'])
  timeframe: string;
  useLLM: boolean;
  riskMode: 'low' | 'medium' | 'high';
  maxConcurrentTrades: number;
  initialBalance: number;
  autoExecute: boolean;
  minConfidence?: number; // Minimum confidence threshold for trades
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
  private lastAIMessageContent = '';
  private lastMarketState = { price: 0, trend: '', rsi: 0 };
  private timeframeExpired = false;
  private allowNewTrades = true;
  private tradesOpenAtExpiration = 0;

  private readonly POLLING_INTERVAL_MS = 60000; // 60s = 75% fewer LLM calls
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

      // ✅ CRITICAL: Test LLM availability BEFORE starting session
      logger.info(LogCategory.AI_TRADING, '🔍 Testing LLM availability...');
      try {
        const testResult = await openAIClient.chat([
          { role: 'system', content: 'You are a test.' },
          { role: 'user', content: 'Respond with OK if you can read this.' }
        ], {
          model: 'gpt-4o-mini',
          max_tokens: 10,
          requestType: 'llm_health_check'
        });

        if (!testResult || !testResult.choices || testResult.choices.length === 0) {
          logger.error(LogCategory.AI_TRADING, '❌ LLM health check failed - no response');
          return {
            success: false,
            message: '5-Layer LLM Pipeline unavailable - OpenAI API not responding. Check Netlify environment variables.'
          };
        }

        logger.info(LogCategory.AI_TRADING, '✅ LLM health check passed');
      } catch (llmError) {
        logger.error(LogCategory.AI_TRADING, '❌ LLM health check failed:', llmError);
        return {
          success: false,
          message: `5-Layer LLM Pipeline unavailable - ${(llmError as Error).message}. Cannot start session without LLM.`
        };
      }

      this.config = config;
      this.activeSession = config.goalSessionId;
      this.sessionStartTime = new Date();
      this.openTrades = [];
      this.timeframeExpired = false;
      this.allowNewTrades = true;
      this.tradesOpenAtExpiration = 0;

      // ✅ CRITICAL: Initialize autonomous Pipnosis Alpha brain
      await eventBasedLLMEngine.initialize(config.userId, config.goalSessionId);
      eventBasedLLMEngine.setAutonomousBrain(true);
      logger.info(LogCategory.AI_TRADING, '✅ Autonomous Pipnosis Alpha Brain ACTIVATED');
      logger.info(LogCategory.AI_TRADING, '✅ Strategy planning + condition monitoring enabled');
      logger.info(LogCategory.AI_TRADING, '✅ Reward-driven learning system active');

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
          last_scan_time: new Date().toISOString(),
          execution_mode: 'client',
          client_last_seen: new Date().toISOString()
        })
        .eq('id', config.goalSessionId);

      this.startPolling();

      logger.info(LogCategory.AI_TRADING, '✅ Session started - LIVE DEMO MODE with real price monitoring');
      logger.debug(LogCategory.AI_TRADING, '✅ SL/TP will be visible on charts');
      logger.debug(LogCategory.AI_TRADING, '✅ Polling every 15 seconds for triggers');

      return {
        success: true,
        message: 'Autonomous trading session started - Personality-driven AI active'
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
      await this.processCandleAutonomous();
    } catch (error) {
      console.error('[Goal Live Engine] Error processing candle update:', error);
      logger.error(LogCategory.AI_TRADING, 'Candle processing error', { error });
    } finally {
      this.processingLock = false;
    }
  }

  /**
   * Process multi-symbol trading cycle
   * Evaluates all watchlist symbols and selects the best opportunity
   */
  private async processMultiSymbolCycle(watchlist: string[]): Promise<void> {
    try {
      // CRITICAL: Execution lock to prevent race conditions in parallel evaluation
      if (this.processingLock) {
        logger.debug(LogCategory.AI_TRADING, '🔒 Already processing cycle - skipping to prevent race condition');
        return;
      }

      // CRITICAL: Check max trades BEFORE expensive operations
      if (this.openTrades.length >= this.config.maxConcurrentTrades) {
        logger.debug(LogCategory.AI_TRADING, `⏸️ Max trades (${this.config.maxConcurrentTrades}) reached - skipping expensive scan`);
        return;
      }

      // Set processing lock
      this.processingLock = true;

      logger.debug(LogCategory.AI_TRADING, `📊 Building snapshots for ${watchlist.length} symbols...`);

      const snapshotResult = await multiSymbolSnapshotBuilder.buildSnapshots(watchlist);

      if (snapshotResult.snapshots.length === 0) {
        logger.debug(LogCategory.AI_TRADING, '⚠️ No symbol data available');
        return;
      }

      logger.debug(LogCategory.AI_TRADING, `✅ ${snapshotResult.tradeableSymbols.length}/${snapshotResult.snapshots.length} symbols tradeable`);

      if (snapshotResult.blockedSymbols.size > 0) {
        snapshotResult.blockedSymbols.forEach((reason, symbol) => {
          logger.debug(LogCategory.AI_TRADING, `❌ ${symbol}: Blocked (${reason})`);
        });
      }

      const tradeableSnapshots = snapshotResult.snapshots.filter(s => s.tradeable);

      if (tradeableSnapshots.length === 0) {
        logger.debug(LogCategory.AI_TRADING, '🚫 No tradeable opportunities - WAIT mode');
        await this.sendAIMessage('Scanning 5 markets... No tradeable opportunities detected. Continuing scan.');
        return;
      }

      const marketStates: FullMarketState[] = tradeableSnapshots.map(snapshot => ({
        symbol: snapshot.symbol,
        price: snapshot.price,
        ema20: snapshot.ema20,
        ema50: snapshot.ema50,
        ema200: snapshot.ema200,
        rsi: snapshot.rsi,
        stochRsi: snapshot.stochRsi,
        atr: snapshot.atr,
        vwap: snapshot.vwap,
        trend: snapshot.trend,
        volatility: snapshot.volatility,
        momentum: snapshot.momentum,
        support: snapshot.support,
        resistance: snapshot.resistance,
        swingHigh: snapshot.swingHigh,
        swingLow: snapshot.swingLow,
        recentCandles: snapshot.recentCandles,
        structure: snapshot.structure,
        omegaSensors: snapshot.omegaSensors,
        regime: snapshot.regime,
        adversarial: snapshot.adversarial
      }));

      const traderScore: TraderScore = {
        currentLevel: 1,
        totalTrades: 0,
        winRate: 0,
        profitFactor: 1.0,
        avgHoldTime: 0,
        riskTolerance: this.config.riskMode === 'high' ? 0.8 : this.config.riskMode === 'medium' ? 0.5 : 0.3,
        preferredTimeframe: this.config.timeframe,
        learningProgress: 0
      };

      logger.debug(LogCategory.AI_TRADING, `🧠 Running Omega Council for ${marketStates.length} symbols...`);
      console.log('%c[AUTONOMOUS ENGINE] 🔮 Calling Alpha+Omega Orchestrator...', 'color: #8b5cf6; font-weight: bold');
      console.log('[AUTONOMOUS ENGINE] Market States:', marketStates.length);
      console.log('[AUTONOMOUS ENGINE] Trader Score:', traderScore);

      const omegaDecisions = await alphaOmegaOrchestrator.evaluateMultipleSymbols(
        marketStates,
        traderScore,
        this.config.userId
      );

      console.log('%c[AUTONOMOUS ENGINE] ✅ Omega decisions received:', 'color: #10b981; font-weight: bold', omegaDecisions.size);

      const bestSymbolResult = bestSymbolSelector.selectBestSymbol(
        tradeableSnapshots,
        omegaDecisions
      );

      bestSymbolSelector.logEvaluationDetails(bestSymbolResult);

      if (!bestSymbolResult.selected || !bestSymbolResult.symbol || !bestSymbolResult.evaluation) {
        logger.debug(LogCategory.AI_TRADING, '🚫 No symbols passed selection criteria');

        // Build detailed explanation of why no symbols were selected
        const detailedMessage = this.buildDetailedEvaluationMessage(
          snapshotsBySymbol,
          omegaDecisions
        );

        await this.sendAIMessage(detailedMessage);
        return;
      }

      const selectedSymbol = bestSymbolResult.symbol;
      const decision = bestSymbolResult.evaluation.omegaDecision;

      logger.debug(LogCategory.AI_TRADING, `🎯 SELECTED: ${selectedSymbol} | ${decision.action} @ ${decision.confidence}%`);

      if (decision.action === 'NO_TRADE') {
        await this.sendAIMessage(`Best symbol: ${selectedSymbol}. Setup detected but confidence threshold not met. Waiting for stronger signals.`);
        return;
      }

      if (this.openTrades.length >= this.config.maxConcurrentTrades) {
        logger.debug(LogCategory.AI_TRADING, 'Max concurrent trades reached');
        return;
      }

      if (!this.allowNewTrades) {
        logger.debug(LogCategory.AI_TRADING, '⏸️ Timeframe expired - not opening new trades');
        return;
      }

      const minConfidence = this.config.minConfidence || 70;
      if (decision.confidence < minConfidence) {
        logger.debug(LogCategory.AI_TRADING, `Confidence ${decision.confidence}% below threshold ${minConfidence}%`);
        return;
      }

      const snapshot = bestSymbolResult.evaluation.snapshot;
      const latestCandle = snapshot.recentCandles[snapshot.recentCandles.length - 1];

      // FINAL CHECK: Ensure we're not exceeding max trades (prevents race conditions)
      if (this.openTrades.length >= this.config.maxConcurrentTrades) {
        logger.debug(LogCategory.AI_TRADING, `BLOCKED: Already at max trades (${this.config.maxConcurrentTrades})`);
        await this.sendAIMessage(`Max trades (${this.config.maxConcurrentTrades}) limit reached. Pausing new trade scans to preserve credits. Monitoring open positions only.`);
        return;
      }

      // Calculate dynamic lot size based on account balance and goal
      const calculatedLotSize = await this.calculateOptimalLotSize(
        this.config.initialBalance,
        decision.entry,
        decision.stopLoss,
        this.config.riskMode
      );

      const trade: SimulatedTrade = {
        id: `trade-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        symbol: selectedSymbol,
        timeframe: this.config.timeframe,
        direction: decision.action.toLowerCase() as 'buy' | 'sell',
        entryTime: new Date(),
        entryPrice: decision.entry,
        stopLoss: decision.stopLoss,
        takeProfit: decision.takeProfit,
        positionSize: calculatedLotSize,
        confidence: decision.confidence,
        reasoning: decision.reasoning,
        triggerType: 'multi_symbol_best_opportunity',
        maxHoldMinutes: 240,
        pnl: 0,
        outcome: 'open'
      };

      // Calculate R:R for proper trade signal
      const riskPips = Math.abs(trade.entryPrice - trade.stopLoss) / 0.0001;
      const rewardPips = Math.abs(trade.takeProfit - trade.entryPrice) / 0.0001;
      const riskReward = rewardPips / riskPips;
      const expectedProfit = rewardPips * 10 * trade.positionSize;

      const executionResult = await tradeExecutionEngine.executeSignal(
        {
          sessionId: this.activeSession!,
          symbol: selectedSymbol,
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
        // CRITICAL: Update trade ID to match database UUID before tracking
        trade.id = executionResult.tradeId!;
        this.openTrades.push(trade);
        logger.debug(LogCategory.AI_TRADING, `Trade ${this.openTrades.length}/${this.config.maxConcurrentTrades} added with DB ID: ${trade.id}`);
        logger.info(LogCategory.AI_TRADING, `✅ Trade executed: ${selectedSymbol} ${trade.direction} @ ${trade.entryPrice} (confidence: ${trade.confidence}%)`);

        // Increment trade counter in database
        try {
          const { data: sessionData, error: fetchError } = await supabase
            .from('goal_sessions')
            .select('trades_in_session, multi_trade_enabled')
            .eq('id', this.activeSession)
            .single();

          if (fetchError) {
            logger.error(LogCategory.AI_TRADING, 'Failed to fetch session data for trade counter', { fetchError });
          } else {
            const newTradeCount = (sessionData?.trades_in_session || 0) + 1;
            const multiTradeEnabled = sessionData?.multi_trade_enabled || false;

            const { error: updateError } = await supabase
              .from('goal_sessions')
              .update({
                trades_in_session: newTradeCount,
                last_trade_id: trade.id
              })
              .eq('id', this.activeSession);

            if (updateError) {
              logger.error(LogCategory.AI_TRADING, 'Failed to update trade counter', { updateError });
            } else {
              logger.debug(LogCategory.AI_TRADING, `✅ Trade counter updated: ${newTradeCount} (multi-trade: ${multiTradeEnabled})`);
            }

            // If max trades reached AND multi-trade is DISABLED, just monitor (don't show dialog yet)
            if (this.openTrades.length >= this.config.maxConcurrentTrades && !multiTradeEnabled) {
              logger.info(LogCategory.AI_TRADING, '🛑 Max trades reached in single-trade mode - monitoring position');

              await this.sendAIMessage(
                `✅ Trade executed successfully!\n\n` +
                `🎯 Position opened: ${selectedSymbol} ${decision.action}\n` +
                `💰 Entry: ${decision.entry.toFixed(5)} | SL: ${decision.stopLoss.toFixed(5)} | TP: ${decision.takeProfit.toFixed(5)}\n\n` +
                `👀 Now monitoring this position until it hits TP or SL.\n` +
                `I'll let you know when it closes and we can decide on next steps.`
              );
              return; // Exit early to prevent the summary message below
            }
          }
        } catch (error) {
          logger.error(LogCategory.AI_TRADING, 'Error updating trade counter', { error });
        }
      } else {
        logger.error(LogCategory.AI_TRADING, `❌ Trade execution failed: ${executionResult.message}`);
      }

      const selectionSummary = bestSymbolResult.allEvaluations
        .slice(0, 3)
        .map((e, i) => `${i + 1}. ${e.symbol} (${e.overallScore.toFixed(1)})`)
        .join('\n');

      await this.sendAIMessage(
        `🎯 Trade Signal: ${selectedSymbol}\n\n` +
        `Direction: ${decision.action}\n` +
        `Entry: ${decision.entry.toFixed(5)}\n` +
        `SL: ${decision.stopLoss.toFixed(5)} | TP: ${decision.takeProfit.toFixed(5)}\n` +
        `Confidence: ${decision.confidence}%\n\n` +
        `Why ${selectedSymbol}?\n${decision.reasoning}\n\n` +
        `Symbol Rankings:\n${selectionSummary}`
      );

    } catch (error) {
      console.error('[Multi-Symbol] Error processing cycle:', error);
      logger.error(LogCategory.AI_TRADING, 'Multi-symbol cycle error', { error });
    } finally {
      // CRITICAL: Always release the lock
      this.processingLock = false;
    }
  }

  /**
   * Main autonomous candle processing logic (Multi-Symbol Mode)
   */
  private async processCandleAutonomous(): Promise<void> {
    try {
      // 🚨 EMERGENCY DIAGNOSTICS
      console.log('%c[AUTONOMOUS ENGINE] 🔍 Cycle starting...', 'color: #10b981; font-weight: bold; font-size: 14px');
      console.log('[AUTONOMOUS ENGINE] Session ID:', this.activeSession);
      console.log('[AUTONOMOUS ENGINE] Open Trades:', this.openTrades.length);
      console.log('[AUTONOMOUS ENGINE] Max Concurrent:', this.config.maxConcurrentTrades);
      console.log('[AUTONOMOUS ENGINE] Allow New Trades:', this.allowNewTrades);

      // CHECK: Is session awaiting user continuation?
      const { data: sessionCheck } = await supabase
        .from('goal_sessions')
        .select('awaiting_user_continuation')
        .eq('id', this.activeSession)
        .single();

      console.log('[AUTONOMOUS ENGINE] Awaiting continuation?', sessionCheck?.awaiting_user_continuation);

      if (sessionCheck?.awaiting_user_continuation) {
        logger.debug(LogCategory.AI_TRADING, '⏸️ Awaiting user continuation - not scanning for new trades');
        console.log('%c[AUTONOMOUS ENGINE] ⏸️ BLOCKED: Awaiting user continuation', 'color: #f59e0b; font-weight: bold');
        // Still monitor open positions
        const watchlist = this.config.watchlist || getDefaultWatchlist();
        const symbol = this.config.symbol || watchlist[0];
        await this.monitorOpenPositionsOnly(symbol);
        return;
      }

      // STOP SCANNING if max trades reached (saves tokens/credits)
      if (this.openTrades.length >= this.config.maxConcurrentTrades) {
        logger.debug(LogCategory.AI_TRADING, `⏸️ Max trades (${this.config.maxConcurrentTrades}) reached - PAUSING scanning to save credits`);
        // Still monitor open positions but don't scan for new trades
        const watchlist = this.config.watchlist || getDefaultWatchlist();
        const symbol = this.config.symbol || watchlist[0];
        await this.monitorOpenPositionsOnly(symbol);
        return;
      }

      const watchlist = this.config.watchlist || getDefaultWatchlist();
      const useMultiSymbolMode = watchlist.length > 1;

      console.log('[AUTONOMOUS ENGINE] Watchlist:', watchlist);
      console.log('[AUTONOMOUS ENGINE] Multi-symbol mode?', useMultiSymbolMode);

      if (useMultiSymbolMode) {
        // Double-check before expensive multi-symbol scan
        if (this.openTrades.length >= this.config.maxConcurrentTrades) {
          logger.debug(LogCategory.AI_TRADING, 'Max trades reached, monitoring only');
          console.log('%c[AUTONOMOUS ENGINE] ⏸️ BLOCKED: Max trades reached', 'color: #f59e0b; font-weight: bold');
          return;
        }
        console.log('%c[AUTONOMOUS ENGINE] 🔮 Starting multi-symbol scan...', 'color: #10b981; font-weight: bold');
        logger.debug(LogCategory.AI_TRADING, `🔍 Evaluating ${watchlist.length} symbols...`);
        await this.processMultiSymbolCycle(watchlist);
        console.log('%c[AUTONOMOUS ENGINE] ✅ Multi-symbol scan complete', 'color: #10b981; font-weight: bold');
        return;
      }

      const symbol = this.config.symbol || watchlist[0];
      const dbTimeframe = normalizeTimeframeToDb(this.config.timeframe);
      logger.debug(LogCategory.AI_TRADING, `Querying candles: ${symbol} ${this.config.timeframe} -> ${dbTimeframe}`);

      const { data: candles, error } = await supabase
        .from('forex_candles')
        .select('*')
        .eq('symbol', symbol)
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

      // Get goal session details for context
      const { data: goalSession } = await supabase
        .from('goal_sessions')
        .select('*')
        .eq('id', this.activeSession)
        .single();

      // Check if timeframe has expired
      if (goalSession && !this.timeframeExpired) {
        const endTime = goalSession.end_time ? new Date(goalSession.end_time) : null;
        const now = new Date();

        if (endTime && now >= endTime) {
          this.timeframeExpired = true;
          this.allowNewTrades = false;
          this.tradesOpenAtExpiration = this.openTrades.length;

          logger.info(LogCategory.AI_TRADING, `🏁 Session timeframe expired. ${this.openTrades.length} trades still open.`);
          logger.info(LogCategory.AI_TRADING, '✋ No new trades will be opened. Monitoring active positions...');

          await supabase
            .from('goal_sessions')
            .update({
              status: 'soft_closing',
              timeframe_expired_at: now.toISOString(),
              trades_open_at_expiration: this.openTrades.length
            })
            .eq('id', this.activeSession);

          const message = this.openTrades.length > 0
            ? `🏁 Your session timeframe has ended!\n\n` +
              `📊 Current Status:\n` +
              `• Goal: $${goalSession.target_value} | Progress: $${(goalSession.current_progress || 0).toFixed(2)} (${(goalSession.progress_percentage || 0).toFixed(1)}%)\n` +
              `• Completed Trades: ${goalSession.total_trades || 0}\n` +
              `• Active Trades: ${this.openTrades.length} position${this.openTrades.length > 1 ? 's' : ''} still open\n\n` +
              `🎯 What's Happening Now:\n` +
              `• No new trades will be opened\n` +
              `• Your ${this.openTrades.length} active trade${this.openTrades.length > 1 ? 's' : ''} will run their course\n` +
              `• All stop-loss and take-profit levels remain active\n` +
              `• I'll continue managing these trades until they close\n\n` +
              `You'll receive your final session summary once all trades complete.`
            : `🏁 Your session timeframe has ended!\n\n` +
              `📊 Final Status:\n` +
              `• Goal: $${goalSession.target_value} | Progress: $${(goalSession.current_progress || 0).toFixed(2)} (${(goalSession.progress_percentage || 0).toFixed(1)}%)\n` +
              `• Total Trades: ${goalSession.total_trades || 0}\n\n` +
              `All trades are closed. Generating final session summary...`;

          try {
            await supabase.from('goal_ai_conversations').insert({
              goal_session_id: this.activeSession,
              user_id: this.config.userId,
              role: 'ai',
              message,
              context: {
                timeframe_expired: true,
                trades_open: this.openTrades.length,
                will_soft_close: this.openTrades.length > 0
              },
              sentiment: 'neutral'
            });
          } catch (error) {
            console.error('[Goal Live Engine] Failed to log timeframe expiration:', error);
          }
        }
      }

      // Check if soft close is complete
      if (this.timeframeExpired && this.openTrades.length === 0) {
        logger.info(LogCategory.AI_TRADING, '✅ All trades closed after timeframe expiration. Finalizing session...');

        const softCloseStart = goalSession?.timeframe_expired_at ? new Date(goalSession.timeframe_expired_at) : null;
        const softCloseDuration = softCloseStart
          ? Math.floor((Date.now() - softCloseStart.getTime()) / 60000)
          : 0;

        await supabase
          .from('goal_sessions')
          .update({
            status: 'expired',
            soft_close_duration_minutes: softCloseDuration,
            end_time: new Date().toISOString()
          })
          .eq('id', this.activeSession);

        const finalMessage = `✅ Session Complete - All Trades Closed\n\n` +
          `⏱️ Soft Close Duration: ${softCloseDuration} minutes\n` +
          `📊 Trades at expiration: ${this.tradesOpenAtExpiration}\n\n` +
          `Generating comprehensive session summary...`;

        try {
          await supabase.from('goal_ai_conversations').insert({
            goal_session_id: this.activeSession,
            user_id: this.config!.userId,
            role: 'ai',
            message: finalMessage,
            context: {
              soft_close_complete: true,
              soft_close_duration_minutes: softCloseDuration,
              trades_at_expiration: this.tradesOpenAtExpiration
            },
            sentiment: 'neutral'
          });
        } catch (error) {
          console.error('[Goal Live Engine] Failed to log soft close completion:', error);
        }

        await this.stopSession();
        return;
      }

      if (this.openTrades.length >= this.config.maxConcurrentTrades) {
        return;
      }

      const goalContext = goalSession ? {
        goalSessionId: this.activeSession,
        targetValue: goalSession.target_value,
        currentProgress: goalSession.current_progress || 0,
        progressPercentage: goalSession.progress_percentage || 0,
        timeframe: goalSession.timeframe,
        riskMode: goalSession.risk_mode,
        tradesRemaining: this.config.maxConcurrentTrades - this.openTrades.length
      } : undefined;

      // ====================================================================
      // AUTONOMOUS PIPNOSIS ALPHA BRAIN
      // Let AI analyze market independently and make intelligent decisions
      // ====================================================================

      logger.debug(LogCategory.AI_TRADING, `🧠 Analyzing ${this.config.symbol}...`);
      logger.debug(LogCategory.AI_TRADING, `Open trades: ${this.openTrades.length}/${this.config.maxConcurrentTrades}`);

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

      // Show AI thought process
      if (result.llmCalled) {
        logger.debug(LogCategory.AI_TRADING, '✅ LLM called - strategy planned or trade analyzed');
        localSessionMemory.recordLLMCall(`live-${this.activeSession}`, 0, {});
      }

      if (result.trigger) {
        logger.debug(LogCategory.AI_TRADING, `✅ Conditions met: ${result.trigger.type} (${result.trigger.confidence}% confidence)`);
        localSessionMemory.recordTrigger(`live-${this.activeSession}`, result.trigger);
        logger.debug(LogCategory.AI_TRADING, `Trigger detected: ${result.trigger.type} (${result.trigger.confidence}%)`);
        await this.sendTriggerDetectedMessage(result.trigger, latestCandle);
      } else {
        logger.debug(LogCategory.AI_TRADING, 'Monitoring conditions... waiting for setup');
      }

      if (result.trade) {
        if (!this.allowNewTrades) {
          logger.debug(LogCategory.AI_TRADING, '⏸️ Valid setup detected but session timeframe expired - not opening new trade');
          logger.info(LogCategory.AI_TRADING, `Trade signal blocked: ${result.trade.direction} @ ${result.trade.entryPrice} (timeframe expired)`);

          try {
            await supabase.from('goal_ai_conversations').insert({
              goal_session_id: this.activeSession,
              user_id: this.config.userId,
              role: 'ai',
              message: `📊 Valid setup detected on ${this.config.symbol} but session timeframe has expired.\n\n` +
                `🎯 Signal: ${result.trade.direction.toUpperCase()} @ ${result.trade.entryPrice.toFixed(5)}\n` +
                `✋ Not executing - waiting for ${this.openTrades.length} active trade${this.openTrades.length > 1 ? 's' : ''} to complete.`,
              context: {
                blocked_trade: result.trade,
                reason: 'timeframe_expired',
                open_trades: this.openTrades.length
              },
              sentiment: 'neutral'
            });
          } catch (error) {
            console.error('[Goal Live Engine] Failed to log blocked trade:', error);
          }
        } else {
          logger.debug(LogCategory.AI_TRADING, `🎯 Trade decision: ${result.trade.direction} @ ${result.trade.entryPrice}`);
          logger.debug(LogCategory.AI_TRADING, `SL: ${result.trade.stopLoss} | TP: ${result.trade.takeProfit} | R:R 1:${((result.trade.takeProfit - result.trade.entryPrice) / (result.trade.entryPrice - result.trade.stopLoss)).toFixed(2)}`);
          await this.handleNewTradeSignal(result.trade);
        }
      }

      // Send AI thinking update every scan when no open trades
      if (this.openTrades.length === 0) {
        await this.sendAIThinkingUpdate(latestCandle, sortedCandles, result);
      }

      await supabase
        .from('goal_sessions')
        .update({
          last_scan_time: new Date().toISOString(),
          next_scan_time: new Date(Date.now() + this.POLLING_INTERVAL_MS).toISOString(),
          client_last_seen: new Date().toISOString()
        })
        .eq('id', this.activeSession);

    } catch (error) {
      console.error('[Goal Live Engine] Autonomous processing error:', error);
      logger.error(LogCategory.AI_TRADING, 'Autonomous processing error', { error });
      throw error; // Re-throw to be caught by outer handler
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
        // CRITICAL: Update trade ID to match database UUID before tracking
        trade.id = executionResult.tradeId!;
        this.openTrades.push(trade);
      }

      // Send detailed trade execution message to AI conversation
      const message = `🎯 Trade Executed: ${trade.symbol} ${trade.direction.toUpperCase()} @ ${trade.entryPrice.toFixed(5)}\n` +
        `📊 Entry: ${trade.entryPrice.toFixed(5)} | SL: ${trade.stopLoss.toFixed(5)} | TP: ${trade.takeProfit.toFixed(5)}\n` +
        `💰 Risk: $${(riskPips * 10 * trade.positionSize).toFixed(2)} | Reward: $${expectedProfit.toFixed(2)} | R:R ${riskReward.toFixed(2)}\n` +
        `🎲 Confidence: ${trade.confidence}% | Setup: ${trade.triggerType}\n` +
        `🔄 Monitoring every 15 seconds for TP/SL hit...`;

      try {
        await supabase.from('goal_ai_conversations').insert({
          goal_session_id: this.activeSession,
          user_id: this.config.userId,
          role: 'ai',
          message,
          context: {
            trade_id: executionResult.tradeId,
            execution_result: executionResult,
            entry_price: trade.entryPrice,
            stop_loss: trade.stopLoss,
            take_profit: trade.takeProfit,
            risk_pips: riskPips,
            reward_pips: rewardPips,
            risk_reward: riskReward,
            confidence: trade.confidence,
            setup_type: trade.triggerType
          },
          sentiment: 'encouraging'
        });
      } catch (error) {
        console.error('[Goal Live Engine] Failed to log trade execution conversation:', error);
      }

      // CHECK: Should we pause for user review after this trade?
      await this.checkAndPauseForReview(executionResult.tradeId, trade);

    } else {
      console.error(`[Goal Live Engine] ❌ Trade execution failed: ${executionResult.message}`);

      // Send failure message
      try {
        await supabase.from('goal_ai_conversations').insert({
          goal_session_id: this.activeSession,
          user_id: this.config.userId,
          role: 'ai',
          message: `❌ Trade execution failed: ${executionResult.message}. Continuing to scan for next opportunity...`,
          context: { error: executionResult.message },
          sentiment: 'cautionary'
        });
      } catch (error) {
        console.error('[Goal Live Engine] Failed to log trade failure conversation:', error);
      }
    }
  }

  /**
   * Check if we should pause scanning after trade execution for user review
   * Only applies when multi_trade_enabled = false (single-trade default mode)
   */
  private async checkAndPauseForReview(tradeId: string, trade: SimulatedTrade): Promise<void> {
    if (!this.activeSession || !this.config) {
      console.log('[Goal Live Engine] checkAndPauseForReview: No active session or config');
      return;
    }

    try {
      console.log('[Goal Live Engine] 🔍 Checking if should pause for review after trade:', tradeId);

      // Get current session settings
      const { data: session, error } = await supabase
        .from('goal_sessions')
        .select('multi_trade_enabled, trades_in_session, target_value, current_progress')
        .eq('id', this.activeSession)
        .single();

      if (error) {
        console.error('[Goal Live Engine] ❌ Error fetching session for pause check:', error);
        return;
      }

      if (!session) {
        console.log('[Goal Live Engine] ⚠️ Session not found for pause check');
        return;
      }

      console.log('[Goal Live Engine] Session pause check data:', {
        multi_trade_enabled: session.multi_trade_enabled,
        trades_in_session: session.trades_in_session,
        session_id: this.activeSession
      });

      // If multi-trade mode enabled, don't pause
      if (session.multi_trade_enabled) {
        console.log('[Goal Live Engine] ✅ Multi-trade mode enabled - continuing to scan');
        logger.info(LogCategory.AI_TRADING, 'Multi-trade mode enabled - continuing to scan');
        return;
      }

      // PAUSE SCANNING - User must review and approve continuation
      console.log('[Goal Live Engine] 🛑 Single-trade mode detected - pausing for user review');
      logger.info(LogCategory.AI_TRADING, '🛑 Single-trade mode: Pausing for user review');

      // Generate AI continuation prompt
      const continuationPrompt = await this.generateContinuationPrompt(trade, session);

      // Update session to awaiting continuation state
      await supabase
        .from('goal_sessions')
        .update({
          awaiting_user_continuation: true,
          continuation_prompt: continuationPrompt,
          last_trade_id: tradeId,
          trades_in_session: (session.trades_in_session || 0) + 1
        })
        .eq('id', this.activeSession);

      // Send continuation prompt to AI conversation
      try {
        await supabase.from('goal_ai_conversations').insert({
          goal_session_id: this.activeSession,
          user_id: this.config.userId,
          role: 'ai',
          message: continuationPrompt,
          context: {
            awaiting_continuation: true,
            trade_id: tradeId,
            trades_in_session: (session.trades_in_session || 0) + 1
          },
          sentiment: 'neutral'
        });
      } catch (error) {
        console.error('[Goal Live Engine] Failed to log continuation prompt:', error);
      }

      console.log('[Goal Live Engine] 🛑 Scanning paused - awaiting user continuation decision');

    } catch (error) {
      console.error('[Goal Live Engine] Error checking pause for review:', error);
    }
  }

  /**
   * Generate AI continuation prompt after trade execution
   * Provides context and asks user whether to continue scanning
   */
  private async generateContinuationPrompt(trade: SimulatedTrade, session: any): Promise<string> {
    const tradesCompleted = (session.trades_in_session || 0) + 1;
    const currentProgress = session.current_progress || 0;
    const targetValue = session.target_value || 0;
    const progressPercent = targetValue > 0 ? (currentProgress / targetValue) * 100 : 0;

    const prompt = `
🎯 Trade #${tradesCompleted} Executed!

📊 Session Progress:
• Current: $${currentProgress.toFixed(2)} / $${targetValue.toFixed(2)} (${progressPercent.toFixed(1)}%)
• Trades Completed: ${tradesCompleted}

💭 This trade is now live and I'll monitor it until it hits TP or SL.

🤔 What would you like to do next?

**Continue Scanning** - I'll look for another high-quality setup while this trade runs
**Wait & Watch** - Stop scanning and just monitor this position
**Stop Session** - Close everything and end this goal session

Your decision keeps you in control of your risk and prevents runaway trading.
    `.trim();

    return prompt;
  }

  /**
   * Handle user's continuation response
   * Called when user decides to continue, wait, or stop after a trade
   */
  async handleUserContinuationResponse(
    response: 'continue' | 'wait' | 'stop'
  ): Promise<{ success: boolean; message: string }> {
    if (!this.activeSession || !this.config) {
      return {
        success: false,
        message: 'No active session'
      };
    }

    try {
      switch (response) {
        case 'continue':
          // Resume scanning for next trade
          await supabase
            .from('goal_sessions')
            .update({
              awaiting_user_continuation: false,
              continuation_prompt: null
            })
            .eq('id', this.activeSession);

          logger.info(LogCategory.AI_TRADING, '✅ User chose to continue - resuming scan');

          try {
            await supabase.from('goal_ai_conversations').insert({
              goal_session_id: this.activeSession,
              user_id: this.config.userId,
              role: 'ai',
              message: '✅ Resuming scan for next opportunity... I\'ll monitor your open position and look for another high-quality setup.',
              sentiment: 'encouraging'
            });
          } catch (error) {
            console.error('[Goal Live Engine] Failed to log continuation response:', error);
          }

          return {
            success: true,
            message: 'Scanning resumed'
          };

        case 'wait':
          // Stop scanning but keep monitoring open trades
          this.allowNewTrades = false;

          await supabase
            .from('goal_sessions')
            .update({
              awaiting_user_continuation: false,
              continuation_prompt: null,
              status: 'soft_closing'
            })
            .eq('id', this.activeSession);

          logger.info(LogCategory.AI_TRADING, '⏸️ User chose to wait - monitoring open trades only');

          try {
            await supabase.from('goal_ai_conversations').insert({
              goal_session_id: this.activeSession,
              user_id: this.config.userId,
              role: 'ai',
              message: '⏸️ Got it! I\'ll stop scanning for new trades and just monitor your open position until it closes.',
              sentiment: 'neutral'
            });
          } catch (error) {
            console.error('[Goal Live Engine] Failed to log wait response:', error);
          }

          return {
            success: true,
            message: 'Now monitoring open trades only'
          };

        case 'stop':
          // Stop entire session
          await this.stopSession();

          logger.info(LogCategory.AI_TRADING, '🛑 User chose to stop - ending session');

          return {
            success: true,
            message: 'Session stopped'
          };

        default:
          return {
            success: false,
            message: 'Invalid response'
          };
      }
    } catch (error) {
      console.error('[Goal Live Engine] Error handling continuation response:', error);
      return {
        success: false,
        message: `Error: ${(error as Error).message}`
      };
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

    // CRITICAL: Update trader score via autonomous brain
    await eventBasedLLMEngine.onTradeClose(trade);

    // Clear mid-trade triggers for this trade
    midTradeTriggerDetector.clearTriggers(trade.id);

    localSessionMemory.recordTradeClosure(`live-${this.activeSession}`, trade);

    // CRITICAL: Use trade.id to ensure we only close THIS specific trade
    // Using symbol + entry_price could close multiple positions!
    const { error } = await supabase
      .from('goal_session_trades')
      .update({
        exit_price: trade.exitPrice,
        profit_loss: trade.pnl,
        status: 'closed',
        closed_at: new Date().toISOString(),
        close_reason: trade.outcome === 'win' ? 'take_profit' : 'stop_loss'
      })
      .eq('id', trade.id)
      .eq('goal_session_id', this.activeSession)
      .eq('status', 'open');

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

    try {
      await supabase.from('goal_ai_conversations').insert({
        goal_session_id: this.activeSession,
        user_id: this.config!.userId,
        role: 'ai',
        message: closureMessage,
        context: {
          trade_id: trade.id,
          outcome: trade.outcome,
          duration_minutes: tradeDuration,
          entry_price: trade.entryPrice,
          exit_price: trade.exitPrice,
          pnl: trade.pnl,
          pips,
          duration: durationText,
          exit_reason: exitReason
        },
        sentiment: isWin ? 'encouraging' : 'educational'
      });
    } catch (error) {
      console.error('[Goal Live Engine] Failed to log trade closure conversation:', error);
    }

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

      try {
        await supabase.from('goal_ai_conversations').insert({
          goal_session_id: this.activeSession,
          user_id: this.config!.userId,
          role: 'ai',
          message: llmAnalysis + progressMessage,
          context: {
            stats,
            trade_id: trade.id,
            llm_analysis: true,
            total_pnl: stats.totalPnL,
            win_rate: (stats.winningTrades / stats.totalTrades) * 100,
            total_trades: stats.totalTrades
          },
          sentiment: 'neutral'
        });
      } catch (error) {
        console.error('[Goal Live Engine] Failed to log post-trade analysis conversation:', error);
      }
    }

    // Update goal progress after trade closure
    await this.updateGoalProgress();

    // CRITICAL: Check if we should show continuation dialog (single-trade mode only)
    await this.checkContinuationAfterTradeClose(trade);
  }

  /**
   * Check if continuation dialog should be shown after trade closes
   * Only in single-trade mode and only if goal is NOT met
   */
  private async checkContinuationAfterTradeClose(trade: SimulatedTrade): Promise<void> {
    try {
      // Fetch current session data
      const { data: session, error: sessionError } = await supabase
        .from('goal_sessions')
        .select('multi_trade_enabled, current_progress, target_value, trades_in_session')
        .eq('id', this.activeSession)
        .single();

      if (sessionError || !session) {
        logger.error(LogCategory.AI_TRADING, 'Failed to fetch session for continuation check', { sessionError });
        return;
      }

      // If multi-trade mode enabled, don't show dialog
      if (session.multi_trade_enabled) {
        logger.info(LogCategory.AI_TRADING, '✅ Multi-trade mode enabled - continuing to scan automatically');
        return;
      }

      // Check if goal is met
      const currentProgress = session.current_progress || 0;
      const targetValue = session.target_value || 0;
      const goalMet = currentProgress >= targetValue;

      if (goalMet) {
        // Goal achieved! Celebrate and close session
        logger.info(LogCategory.AI_TRADING, '🎉 GOAL ACHIEVED! Stopping session');

        await supabase
          .from('goal_sessions')
          .update({
            status: 'goal_achieved',
            completed_at: new Date().toISOString()
          })
          .eq('id', this.activeSession);

        await this.sendAIMessage(
          `🎉🎉🎉 GOAL ACHIEVED! 🎉🎉🎉\n\n` +
          `💰 Target: $${targetValue.toFixed(2)}\n` +
          `✅ Achieved: $${currentProgress.toFixed(2)}\n\n` +
          `🏆 Congratulations! Your goal session is complete!`
        );

        // Stop the session
        this.stopSession();
        return;
      }

      // Goal NOT met - show continuation dialog in single-trade mode
      const remainingAmount = targetValue - currentProgress;
      const isWin = trade.outcome === 'win';
      const outcome = isWin ? 'WIN' : 'LOSS';
      const emoji = isWin ? '✅' : '❌';

      const continuationPrompt =
        `${emoji} Trade #${session.trades_in_session} closed with ${outcome}\n\n` +
        `💰 P&L: ${trade.pnl >= 0 ? '+' : ''}$${trade.pnl.toFixed(2)}\n` +
        `📊 Progress: $${currentProgress.toFixed(2)} / $${targetValue.toFixed(2)}\n` +
        `🎯 Remaining: $${remainingAmount.toFixed(2)} to goal\n\n` +
        `Would you like to continue scanning for another trade?`;

      // Set awaiting_user_continuation flag
      const { error: updateError } = await supabase
        .from('goal_sessions')
        .update({
          awaiting_user_continuation: true,
          continuation_prompt: continuationPrompt
        })
        .eq('id', this.activeSession);

      if (updateError) {
        logger.error(LogCategory.AI_TRADING, 'Failed to set awaiting_user_continuation', { updateError });
      } else {
        logger.info(LogCategory.AI_TRADING, '🛑 Single-trade mode: Trade closed, awaiting user decision');
      }

    } catch (error) {
      console.error('[Goal Live Engine] Error checking continuation after trade close:', error);
      logger.error(LogCategory.AI_TRADING, 'Error in checkContinuationAfterTradeClose', { error });
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

      try {
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
      } catch (error) {
        console.error('[Goal Live Engine] Failed to log learning summary conversation:', error);
      }

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
   * Send AI thinking update - shows real-time analysis with change detection
   */
  private async sendAIThinkingUpdate(latestCandle: any, candles: any[], result: any): Promise<void> {
    if (!this.config || !this.activeSession) return;

    const price = latestCandle.close;
    const time = new Date().toLocaleTimeString();

    const ema20 = latestCandle.ema20 || 0;
    const ema50 = latestCandle.ema50 || 0;
    const rsi = latestCandle.rsi || 50;

    const priceDiff = candles.length >= 2 ? price - candles[candles.length - 2].close : 0;
    const priceDirection = priceDiff > 0 ? '↑' : priceDiff < 0 ? '↓' : '→';
    const priceChangePercent = candles.length >= 2
      ? ((priceDiff / candles[candles.length - 2].close) * 100).toFixed(3)
      : '0.000';

    const trend = price > ema50 ? 'Bullish' : price < ema50 ? 'Bearish' : 'Neutral';

    // Detect significant changes
    const priceChanged = Math.abs(price - this.lastMarketState.price) / this.lastMarketState.price > 0.001; // 0.1% change
    const trendChanged = trend !== this.lastMarketState.trend;
    const rsiChanged = Math.abs(rsi - this.lastMarketState.rsi) > 5; // 5 point change
    const hasSignificantChange = priceChanged || trendChanged || rsiChanged || result.trigger || result.trade;

    let message = `🧠 Analyzing ${this.config.symbol} (${time})\n`;
    message += `📊 Price: $${price.toFixed(2)} (${priceDirection}${Math.abs(parseFloat(priceChangePercent))}%)\n`;
    message += `📈 Trend: ${trend} | RSI: ${rsi.toFixed(0)}\n`;

    if (result.trade) {
      message += `\n✅ Trade approved by GPT-4o!\n`;
      message += `🎯 ${result.trade.direction.toUpperCase()} @ $${result.trade.entryPrice}\n`;
      message += `📝 ${result.trade.reasoning}`;
    } else if (result.trigger) {
      message += `\n🔍 Setup forming: ${result.trigger.type}\n`;
      message += `🤖 Validating with GPT-4o...`;
    } else {
      const strategy = await this.getCurrentStrategy();
      if (strategy) {
        message += `\n🎯 AI Strategy: ${strategy.mode.toUpperCase()}\n`;
        message += `📋 Conditions: ${strategy.conditions.slice(0, 3).join(' + ')}\n`;
        message += `🎲 Confidence: ${strategy.confidence}% | Risk: ${strategy.risk_pct}%\n`;
        if (strategy.rationale) {
          message += `💭 Rationale: ${strategy.rationale.substring(0, 80)}${strategy.rationale.length > 80 ? '...' : ''}\n`;
        }

        // Check if nothing changed
        if (!hasSignificantChange) {
          message += `⏳ No changes - still monitoring conditions (${time})`;
        } else {
          message += `⏳ Evaluating setup...`;
        }
      } else {
        message += `\n🤖 Building strategy plan...\n`;
        message += `🔍 Analyzing: market structure, regime, adversarial patterns\n`;
        message += `⏳ Will share strategy once AI decides approach`;
      }
    }

    // Only send update if something changed OR it's been >2 minutes since last update
    const timeSinceLastUpdate = Date.now() - this.lastAIUpdateTime;
    const shouldSendUpdate = hasSignificantChange || timeSinceLastUpdate > 120000 || result.trade || result.trigger;

    if (!shouldSendUpdate) {
      logger.debug(LogCategory.AI_TRADING, 'Skipping duplicate AI update (no significant changes)');
      return;
    }

    try {
      await supabase.from('goal_ai_conversations').insert({
        goal_session_id: this.activeSession,
        user_id: this.config.userId,
        role: 'ai',
        message,
        context: {
          scanCount: this.scanCount,
          price,
          symbol: this.config.symbol,
          time,
          trend,
          rsi,
          hasSetup: !!result.trigger,
          hasTrade: !!result.trade
        },
        sentiment: result.trade ? 'encouraging' : 'neutral'
      });

      // Update last state
      this.lastMarketState = { price, trend, rsi };
      this.lastAIMessageContent = message;
      this.lastAIUpdateTime = Date.now();

      logger.debug(LogCategory.AI_TRADING, 'AI update sent with changes');
    } catch (error) {
      console.error('[Goal Live Engine] Failed to log AI thinking update:', error);
    }
  }

  /**
   * Get current strategy from event engine
   */
  private async getCurrentStrategy(): Promise<any | null> {
    try {
      const strategy = (eventBasedLLMEngine as any).currentStrategy;
      return strategy || null;
    } catch {
      return null;
    }
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

    try {
      await supabase.from('goal_ai_conversations').insert({
        goal_session_id: this.activeSession,
        user_id: this.config.userId,
        role: 'ai',
        message,
        context: {
          scanCount: this.scanCount,
          hasOpenTrades: this.openTrades.length > 0,
          price,
          symbol: this.config.symbol,
          time,
          trigger: trigger?.type || null
        },
        sentiment: trigger ? 'encouraging' : 'neutral'
      });
    } catch (error) {
      console.error('[Goal Live Engine] Failed to log scanning update conversation:', error);
    }
  }

  /**
   * Send trigger detected message
   */
  /**
   * Send a simple AI message to the user
   */
  /**
   * Build detailed evaluation message explaining why symbols were blocked or rejected
   */
  private buildDetailedEvaluationMessage(
    snapshots: Map<string, SymbolSnapshot>,
    decisions: Map<string, AlphaDecision>
  ): string {
    const parts: string[] = [];
    const evaluated = Array.from(snapshots.keys());

    parts.push(`Evaluated ${evaluated.length} symbols: ${evaluated.join(', ')}`);
    parts.push('');

    let blockedCount = 0;
    let noTradeCount = 0;

    for (const [symbol, snapshot] of snapshots) {
      // Check if blocked by adversarial
      if (!snapshot.tradeable) {
        blockedCount++;
        const reason = snapshot.blockReason || 'Unknown';
        parts.push(`❌ ${symbol}: BLOCKED - ${reason}`);

        // Add specific adversarial details if available
        if (snapshot.adversarial && snapshot.adversarial.stop_run_classification) {
          const stopRun = snapshot.adversarial.stop_run_classification;
          if (stopRun.type !== 'none') {
            parts.push(`   → ${stopRun.reasoning}`);
          }
        }
        continue;
      }

      // Check Alpha decision
      const decision = decisions.get(symbol);
      if (!decision || decision.action === 'NO_TRADE') {
        noTradeCount++;

        if (decision && decision.omega_votes) {
          const votes = decision.omega_votes;
          const buyVotes = [votes.trend, votes.scalper, votes.swing, votes.reversal, votes.volatility, votes.omega8]
            .filter(v => v?.vote === 'BUY').length;
          const sellVotes = [votes.trend, votes.scalper, votes.swing, votes.reversal, votes.volatility, votes.omega8]
            .filter(v => v?.vote === 'SELL').length;
          const noTrade = 7 - buyVotes - sellVotes;

          parts.push(`⚠️ ${symbol}: Alpha declined - ${decision.reasoning}`);
          parts.push(`   → Omega Council: ${buyVotes} BUY, ${sellVotes} SELL, ${noTrade} NO_TRADE`);

          // Highlight Risk concerns if present
          if (votes.risk && votes.risk.vote === 'NO_TRADE') {
            parts.push(`   → Risk Advisory: ${votes.risk.reasoning}`);
          }
        } else {
          parts.push(`⚠️ ${symbol}: No tradeable setup detected`);
        }
      }
    }

    parts.push('');
    if (blockedCount + noTradeCount === evaluated.length) {
      parts.push('No high-quality setups found. Continuing to scan for opportunities...');
    }

    return parts.join('\n');
  }

  private async sendAIMessage(message: string): Promise<void> {
    if (!this.activeSession || !this.config) {
      return;
    }

    try {
      await supabase.from('goal_ai_conversations').insert({
        goal_session_id: this.activeSession,
        user_id: this.config.userId,
        role: 'ai',
        message,
        sentiment: 'neutral'
      });
    } catch (error) {
      console.error('[Goal Live Engine] Failed to send AI message:', error);
    }
  }

  private async sendTriggerDetectedMessage(trigger: any, latestCandle: any): Promise<void> {
    if (!this.config || !this.activeSession) return;

    const message = `🎯 Potential setup detected on ${this.config.symbol}! Type: ${trigger.type} | Confidence: ${trigger.confidence}% | Initiating 5-layer validation...`;

    try {
      await supabase.from('goal_ai_conversations').insert({
        goal_session_id: this.activeSession,
        user_id: this.config.userId,
        role: 'ai',
        message,
        context: {
          trigger,
          price: latestCandle.close,
          trigger_type: trigger.type,
          confidence: trigger.confidence
        },
        sentiment: 'neutral'
      });
    } catch (error) {
      console.error('[Goal Live Engine] Failed to log trigger detected conversation:', error);
    }
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
      try {
        await supabase.from('goal_ai_conversations').insert({
          goal_session_id: this.activeSession,
          user_id: this.config.userId,
          role: 'ai',
          message: `⚠️ LLM recommendation rejected: ${validation.violations.join('. ')}. Keeping current parameters for safety.`,
          context: { evaluation, validation },
          sentiment: 'cautionary'
        });
      } catch (error) {
        console.error('[Goal Live Engine] Failed to log recommendation rejection conversation:', error);
      }

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
    try {
      await supabase.from('goal_ai_conversations').insert({
        goal_session_id: this.activeSession,
        user_id: this.config.userId,
        role: 'ai',
        message: actionMessage,
        context: {
          evaluation,
          trade_id: trade.id,
          recommendation: evaluation.recommendation,
          confidence: evaluation.confidence,
          new_sl: trade.stopLoss,
          new_tp: trade.takeProfit
        },
        sentiment: evaluation.recommendation === 'EXIT_IMMEDIATELY' ? 'cautionary' : 'neutral'
      });
    } catch (error) {
      console.error('[Goal Live Engine] Failed to log mid-trade action conversation:', error);
    }

    logger.info(LogCategory.AI_TRADING, `Mid-trade action: ${evaluation.recommendation}`);
  }

  /**
   * Send mid-trade trigger notification
   */
  private async sendMidTradeTriggerMessage(trigger: any, trade: SimulatedTrade, candle: any): Promise<void> {
    if (!this.config || !this.activeSession) return;

    const message = `⚠️ Mid-Trade Event: ${trigger.triggerReason}. Requesting LLM evaluation...`;

    try {
      await supabase.from('goal_ai_conversations').insert({
        goal_session_id: this.activeSession,
        user_id: this.config.userId,
        role: 'ai',
        message,
        context: {
          trigger,
          trade_id: trade.id,
          trigger_type: trigger.triggerType,
          confidence: trigger.confidence,
          current_price: candle.close
        },
        sentiment: 'neutral'
      });
    } catch (error) {
      console.error('[Goal Live Engine] Failed to log mid-trade trigger conversation:', error);
    }
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

    try {
      await supabase.from('goal_ai_conversations').insert({
        goal_session_id: this.activeSession,
        user_id: this.config.userId,
        role: 'ai',
        message,
        context: {
          evaluation,
          trade_id: trade.id,
          recommendation: evaluation.recommendation,
          confidence: evaluation.confidence,
          cost_usd: evaluation.costUsd,
          tokens_used: evaluation.tokensUsed
        },
        sentiment: 'neutral'
      });
    } catch (error) {
      console.error('[Goal Live Engine] Failed to log mid-trade evaluation conversation:', error);
    }
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

    try {
      await supabase.from('goal_ai_conversations').insert({
        goal_session_id: this.activeSession,
        user_id: this.config.userId,
        role: 'ai',
        message,
        context: {
          trade_id: trade.id,
          time_open: timeOpen,
          current_pnl: pnl,
          current_price: currentPrice,
          entry_price: trade.entryPrice,
          stop_loss: trade.stopLoss,
          take_profit: trade.takeProfit,
          pnl,
          pips,
          distance_to_tp: distanceToTP,
          distance_to_sl: distanceToSL
        },
        sentiment
      });
    } catch (error) {
      console.error('[Goal Live Engine] Failed to log trade monitoring conversation:', error);
    }
  }

  /**
   * Calculate optimal lot size based on account balance and risk parameters
   * Ensures lot sizes are meaningful for the account balance and goal target
   */
  private async calculateOptimalLotSize(
    accountBalance: number,
    entryPrice: number,
    stopLoss: number,
    riskMode: 'low' | 'medium' | 'high'
  ): Promise<number> {
    // Risk percentage based on risk mode
    const riskPercent = riskMode === 'high' ? 2.0 : riskMode === 'medium' ? 1.0 : 0.5;

    // Calculate risk amount in dollars
    const riskAmount = accountBalance * (riskPercent / 100);

    // Calculate stop loss distance in pips
    const stopLossPips = Math.abs(entryPrice - stopLoss) / 0.0001;

    // Calculate lot size: Risk Amount / (Stop Loss Pips * $10 per pip per lot)
    const calculatedLotSize = riskAmount / (stopLossPips * 10);

    // Round to 2 decimal places and apply limits
    let lotSize = Math.round(calculatedLotSize * 100) / 100;

    // Apply sensible limits based on account size
    const minLotSize = accountBalance > 10000 ? 0.05 : 0.01;
    const maxLotSize = Math.min(
      accountBalance / 1000, // Max 1 lot per $1000
      10.0 // Absolute max of 10 lots
    );

    lotSize = Math.max(minLotSize, Math.min(lotSize, maxLotSize));

    logger.debug(LogCategory.AI_TRADING, `Lot Size: ${lotSize} (Balance: $${accountBalance}, Risk: ${riskPercent}%, SL: ${stopLossPips.toFixed(1)} pips)`);

    return lotSize;
  }

  /**
   * Monitor open positions only without scanning for new trades
   * Used when max trades reached to save tokens/credits
   */
  private async monitorOpenPositionsOnly(symbol: string): Promise<void> {
    const dbTimeframe = normalizeTimeframeToDb(this.config.timeframe);

    const { data: candles, error } = await supabase
      .from('forex_candles')
      .select('*')
      .eq('symbol', symbol)
      .eq('timeframe', dbTimeframe)
      .order('open_time', { ascending: false })
      .limit(10);

    if (error || !candles || candles.length === 0) {
      return;
    }

    const latestCandle = candles[0];

    // Update open trades status
    this.openTrades = eventBasedLLMEngine.updateOpenTrades(this.openTrades, latestCandle);

    // Handle closed trades
    const closedTrades = this.openTrades.filter(t => t.outcome !== 'open');
    for (const trade of closedTrades) {
      await this.handleTradeClosure(trade);
    }
    this.openTrades = this.openTrades.filter(t => t.outcome === 'open');

    // Update progress after trade closures
    await this.updateGoalProgress();

    logger.debug(LogCategory.AI_TRADING, `Monitoring ${this.openTrades.length} open trades...`);
  }

  /**
   * Update goal session progress tracking
   * Updates progress bar and profit tracking in real-time
   */
  private async updateGoalProgress(): Promise<void> {
    if (!this.activeSession || !this.config) return;

    try {
      // Calculate total P&L from closed trades
      const { data: closedTrades } = await supabase
        .from('goal_session_trades')
        .select('profit_loss')
        .eq('goal_session_id', this.activeSession)
        .in('status', ['closed', 'win', 'loss']);

      const totalProfit = closedTrades?.reduce((sum, t) => sum + (parseFloat(t.profit_loss) || 0), 0) || 0;

      // Get goal target
      const { data: session } = await supabase
        .from('goal_sessions')
        .select('target_amount')
        .eq('id', this.activeSession)
        .single();

      const targetAmount = parseFloat(session?.target_amount || '0');
      const progressPercent = targetAmount > 0 ? (totalProfit / targetAmount) * 100 : 0;

      // Update goal_sessions with current progress
      await supabase
        .from('goal_sessions')
        .update({
          progress_amount: totalProfit,
          progress_percent: Math.min(progressPercent, 100)
        })
        .eq('id', this.activeSession);

      logger.debug(LogCategory.AI_TRADING, `Progress: $${totalProfit.toFixed(2)} / $${targetAmount.toFixed(2)} (${progressPercent.toFixed(1)}%)`);

    } catch (error) {
      console.error('[Progress Update] Error:', error);
    }
  }
}

export const goalSessionLiveEngine = new GoalSessionLiveEngine();
