/**
 * Goal Session Live Trading Engine
 *
 * Real-time trading engine for Goal Mode using event-based LLM architecture
 * Streams live candles, detects triggers with Flow V2, evaluates with LLM
 * Manages positions and executes trades based on goal session configuration
 */

import { supabase } from '../lib/supabase';
import SystemTableRPCWrapper from './system-table-rpc-wrapper';
import { TRADING_CONSTANTS } from '../config/trading-constants';
import { eventBasedLLMEngine, EventBasedEngineConfig, SimulatedTrade } from './event-based-llm-engine';
import { localSessionMemory } from './local-session-memory';
import { PIPNOSIS_CORE_RULES } from '../lib/pipnosis-core-rules';
import { alphaTradeExecutor } from './alpha-trade-executor';
import { midTradeTriggerDetector, type MarketConditions } from './mid-trade-trigger-detector';
import { llmMidTradeEvaluator } from './llm-mid-trade-evaluator';
import { logger, LogCategory, LogLevel } from '../lib/logger';
import { openAIClient } from './openai-client';
import { normalizeTimeframeToDb, generateTimeframe, type Timeframe } from '../utils/timeframe-utils';
import { multiSymbolScanner } from './multi-symbol-scanner';
import { multiSymbolSnapshotBuilder, type SymbolSnapshot } from './multi-symbol-snapshot-builder';
import { alphaOmegaOrchestrator, type FullMarketState } from './alpha-omega-orchestrator';
import { bestSymbolSelector } from './best-symbol-selector';
import { getDefaultWatchlist } from '../config/watchlist';
import { TraderScore } from './ai-identity';
import { calculateDollarPerPip, calculatePipDistance, calculateGoalAwareLotSize, calculateLotSizeFromDollarRisk, calculateAndValidateRR, getCurrencyPipInfo, formatCurrencyPrice } from '../utils/currencyHelpers';
import { createTradeContext, roundAlphaDecisionPrices } from '../utils/tradeMath';
import { getRiskPercentage, getMinConfidenceThreshold } from '../config/risk-levels';
import { postTradeAnalyzer } from './post-trade-analyzer';
import { hasAnyOpenMarket, isSymbolMarketOpen, getEstimationReferenceSymbol, calculateSessionContext } from '../utils/marketHours';
import { scanResultsManager, type ScanCandidate } from './scan-results-manager';
import { weekendProtectionService } from './weekend-protection-service';
import { marketScheduleService } from './market-schedule-service';
import { goalIntelligenceClassifier, GoalClassification } from './goal-intelligence-classifier';
import { timeToFillCalculator } from './time-to-fill-calculator';
import type { TradingMode } from '../config/execution-eligibility';
import { executionStyleResolver } from './execution-style-resolver';
import { GoalFeasibilityResolver } from './goal-feasibility-resolver';
import { AlphaDownshiftEvaluator } from './alpha-downshift-evaluator';
import type { DownshiftProposal } from '../types/goal-feasibility';
// alphaExecutionPlanner REMOVED (CCIP 2026-02-16): Alpha is sole TP authority
// Goal session engine no longer computes its own TP1/TP2 values.
import { getActiveEntryIntent, type EntryIntentData } from './entry-intent-monitor-mode';
import { entryThesisMemoryService } from './entry-thesis-memory-service';
import { alphaThoughtStream } from './alpha-thought-stream';
import { MarketDataService } from './market-data-service';
import { CCIPTradeExecutionTracker } from './ccip-trade-execution-tracker';
import { CCIPConfidenceGateAdjustment } from './ccip-confidence-gate-adjustment';
// goalAdvisoryCoordinator import removed - dual TP calculation removed (CCIP 2026-02-16)
// CCIP (2026-02-17): detectConstraintSandwich, getViableStyles imports removed.
// Envelope bounds are the sole style wall authority. Noise floor is advisory only.
import { safeExtractATRValue } from '../types/atr';
import { alphaLearningTracker } from './alpha-learning-tracker';
import { computeTPS } from './trade-priority-score';
import type { TPSCandidate } from '../types/tps';


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
  dollarRisk?: number; // Fixed dollar risk for Trade Styles system
  tradeStyle?: string; // Trade style (Sniper, Scalper, Day Trader, Swing Trader)
  specificSymbols?: string[]; // Runtime override: narrow scan to this subset of watchlist symbols
  cardSignal?: Record<string, unknown>; // Pre-selected IM card signal to inject into Alpha reasoning
  // CCIP-MULTI-TRADE-TOP-N: mirrors goal_sessions.max_concurrent_trades > 1.
  // When true: early-exit is suppressed in orchestrator, top N pairs are executed
  // in a single cycle instead of one-per-cycle. SSOT: set from maxConcurrentTrades.
  multiTradeMode?: boolean;
}

export interface NoTradeRejectionContext {
  currentStyle: string;
  constraintSandwichSymbols: { symbol: string; noiseFloor: number; slMax: number }[];
  suggestedStyles: string[];
  hasWeakConsensus: boolean;
  symbolReasons: { symbol: string; action: string; reasoning: string; confidence: number }[];
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
  private monitoringModeMessageSent = false;
  private lastAIMessageContent = '';
  private lastMarketState = { price: 0, trend: '', rsi: 0 };
  private timeframeExpired = false;
  private allowNewTrades = true;
  private tradesOpenAtExpiration = 0;
  private goalClassification: GoalClassification | null = null;
  private isStopping = false; // RACE CONDITION FIX: Track session shutdown state
  private scanCompleteNoTrade = false; // SSOT: Halt polling after full scan finds no executable trades
  private tradeExecutedInSession = false; // GOVERNANCE: Once a trade executes, no more scanning allowed

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

      // 🎯 GOAL INTELLIGENCE: Classify goal before session start
      logger.info(LogCategory.AI_TRADING, '🎯 Classifying goal with Intelligence Layer...');

      // Get user balance from user_profiles table
      const { data: userData } = await supabase
        .from('user_profiles')
        .select('account_balance')
        .eq('id', config.userId)
        .maybeSingle();

      const currentBalance = userData?.account_balance || config.initialBalance;

      this.goalClassification = goalIntelligenceClassifier.classify({
        goalAmount: goalSession.target_value,
        accountBalance: currentBalance,
        timeframe: goalSession.timeframe
      });

      logger.info(
        LogCategory.AI_TRADING,
        `🎯 Goal Classification: ${this.goalClassification.mode.toUpperCase()} mode (${this.goalClassification.goalRatioPercent.toFixed(1)}% of balance)`
      );
      logger.info(LogCategory.AI_TRADING, `🎯 Psychology: ${this.goalClassification.executionPsychology}`);
      logger.info(LogCategory.AI_TRADING, `🎯 Expected trades: ${this.goalClassification.expectedTradeCount}`);

      // Block execution if goal is in Growth Mode
      if (this.goalClassification.shouldBlockExecution) {
        logger.warn(LogCategory.AI_TRADING, `🚫 Goal blocked: ${this.goalClassification.reasoning}`);

        const { goalSessionStateMachine } = await import('./coordinators/goal-session-state-machine');
        await goalSessionStateMachine.forceTransition(config.goalSessionId, 'stopped', {
          reason: `Goal blocked: ${this.goalClassification.reasoning}`,
          triggeredBy: 'goal-session-live-engine',
        });

        return {
          success: false,
          message: `Goal exceeds safe execution limits (${this.goalClassification.goalRatioPercent.toFixed(1)}% of balance). ${this.goalClassification.alternativeApproach ? this.goalClassification.alternativeApproach.reasoning : 'Please reduce goal amount.'}`
        };
      }

      // Update goal session with classification
      await supabase
        .from('goal_sessions')
        .update({
          goal_mode: this.goalClassification.mode,
          goal_ratio_percent: this.goalClassification.goalRatioPercent,
          execution_psychology: this.goalClassification.executionPsychology,
          goal_efficient_risk_pct: this.goalClassification.maxRiskPerTradePct
        })
        .eq('id', config.goalSessionId);

      // CCIP: Validate and normalize timeframe from config using centralized authority
      const validatedTimeframe = generateTimeframe(config.timeframe, 'M15');
      this.config = {
        ...config,
        timeframe: validatedTimeframe
      };
      this.activeSession = config.goalSessionId;
      this.sessionStartTime = new Date();
      this.openTrades = [];
      this.timeframeExpired = false;
      this.allowNewTrades = true;
      this.tradesOpenAtExpiration = 0;
      this.monitoringModeMessageSent = false;
      this.isStopping = false; // RACE CONDITION FIX: Reset stopping flag for new session
      this.scanCompleteNoTrade = false; // SSOT: Reset scan-halt flag for new session
      this.tradeExecutedInSession = false; // GOVERNANCE: Reset trade-executed flag for new session

      logger.setCategoryLevel(LogCategory.AI_TRADING, LogLevel.INFO);

      CCIPTradeExecutionTracker.initialize().catch(() => {});
      CCIPConfidenceGateAdjustment.initialize().catch(() => {});

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

      const { goalSessionStateMachine } = await import('./coordinators/goal-session-state-machine');
      await goalSessionStateMachine.transition(config.goalSessionId, 'scanning', {
        reason: 'Session started - beginning market scan',
        triggeredBy: 'goal-session-live-engine',
      });
      await supabase
        .from('goal_sessions')
        .update({
          last_scan_time: new Date().toISOString(),
          execution_mode: 'client',
          client_last_seen: new Date().toISOString()
        })
        .eq('id', config.goalSessionId);

      // Entry monitoring is now handled by entry-intent-monitor-mode directly

      this.startPolling();

      // Insert session started notification for push
      await supabase.from('goal_notifications').insert({
        goal_session_id: config.goalSessionId,
        user_id: config.userId,
        type: 'session_started',
        priority: 'medium',
        title: '🚀 Smart Goal Session Started',
        message: `Scanning ${config.watchlist?.join(', ') || config.symbol} for ${config.riskMode} risk opportunities. Target: $${config.initialBalance}`,
        metadata: {
          watchlist: config.watchlist,
          symbol: config.symbol,
          timeframe: config.timeframe,
          risk_mode: config.riskMode,
          target: config.initialBalance
        },
        channels: ['in_app']
      });

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
      // SSOT: CRITICAL null safety check
      // Prevents id=eq.null queries if activeSession was already cleared
      if (!this.activeSession) {
        logger.info(LogCategory.AI_TRADING, 'No active session to stop (already cleared)');
        return {
          success: false,
          message: 'No active session to stop'
        };
      }

      // Capture session ID before any async operation
      const sessionId = this.activeSession;
      const userId = this.config?.userId;

      // RACE CONDITION FIX: Set stopping flag BEFORE stopping polling
      // This prevents new operations from starting while cleanup is in progress
      this.isStopping = true;

      logger.info(LogCategory.AI_TRADING, `Stopping goal session: ${sessionId}`);

      this.stopPolling();

      if (this.openTrades.length > 0) {
        logger.info(LogCategory.AI_TRADING, `Closing ${this.openTrades.length} open trades...`);
        await this.closeAllPositions('session_stopped');
      }

      const summary = localSessionMemory.generateSessionSummary(`live-${sessionId}`);
      if (summary) {
        await this.saveLiveSessionSummary(summary);
      }

      // SSOT COMPLIANCE: Fetch session data SAFELY with null check
      // Use maybeSingle() to handle not found gracefully
      const { data: sessionData, error: sessionError } = await supabase
        .from('goal_sessions')
        .select('created_at, target_value, current_progress')
        .eq('id', sessionId)
        .maybeSingle();

      if (sessionError) {
        logger.error(LogCategory.AI_TRADING, `Failed to fetch session data: ${sessionError.message}`);
      }

      const { data: tradesData = [] } = await supabase
        .from('goal_session_trades')
        .select('id')
        .eq('goal_session_id', sessionId)
        .in('status', ['open', 'closed']);

      const durationMinutes = sessionData?.created_at
        ? (Date.now() - new Date(sessionData.created_at).getTime()) / (1000 * 60)
        : 0;

      // Insert session ended notification for push (non-critical, wrapped in try-catch)
      if (this.config && sessionData) {
        try {
          await supabase.from('goal_notifications').insert({
            goal_session_id: sessionId,
            user_id: this.config.userId,
            type: 'session_ended',
            priority: 'medium',
            title: '✋ Session Closed',
            message: `Your session ended after ${Math.round(durationMinutes)} minutes. ${tradesData?.length || 0} trade${tradesData?.length !== 1 ? 's' : ''} completed. Final: $${(sessionData?.current_progress || 0).toFixed(2)}`,
            metadata: {
              close_reason: 'user_stopped',
              duration_minutes: durationMinutes,
              trades_in_session: tradesData?.length || 0,
              current_progress: sessionData?.current_progress || 0,
              target_value: sessionData?.target_value || 0
            },
            channels: ['in_app']
          });
        } catch (notifError) {
          logger.warn(LogCategory.AI_TRADING, `Failed to insert session_ended notification: ${notifError}`);
          // Continue - notification failure doesn't block session close
        }
      }

      // Note: Database update of goal_sessions is handled by atomic_close_goal_session() RPC
      // in SmartGoalSessionManager.stopSession(). This function is FALLBACK cleanup only.

      // Entry intent cleanup is now handled automatically by entry-intent-monitor-mode

      localSessionMemory.closeSession(`live-${sessionId}`);

      // CRITICAL: Clear state AFTER all operations using sessionId
      this.activeSession = null;
      this.config = null;
      this.openTrades = [];
      this.sessionStartTime = null;
      this.isStopping = false;

      logger.info(LogCategory.AI_TRADING, 'Live trading session stopped successfully');

      return {
        success: true,
        message: 'Live trading session stopped'
      };
    } catch (error) {
      logger.error(LogCategory.AI_TRADING, `Error stopping session: ${error}`);
      this.isStopping = false;
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
    if (this.isStopping || !this.config || !this.activeSession) {
      return;
    }

    if (this.scanCompleteNoTrade) {
      logger.debug(LogCategory.AI_TRADING, 'Scan already completed with no trades - polling halted');
      return;
    }

    // CCIP-FIX (2026-03-02 MULTI-TRADE-GOVERNANCE-SSOT):
    // tradeExecutedInSession must NOT permanently block scanning when the session
    // authorises more than one concurrent trade (max_concurrent_trades > 1 or
    // multi_trade_enabled = true).  The DB-backed guard at processMultiSymbolCycle
    // (db trade count >= maxConcurrentTrades) is the SSOT for concurrency limits and
    // is always evaluated regardless.  This flag is only a hard gate in single-trade
    // mode where maxConcurrentTrades === 1.
    if (this.tradeExecutedInSession && this.config.maxConcurrentTrades <= 1) {
      logger.info(LogCategory.AI_TRADING, 'GOVERNANCE: Single-trade mode - trade already executed, scanning permanently halted. Start new session to scan again.');
      return;
    }

    if (this.processingLock) {
      logger.debug(LogCategory.AI_TRADING, 'Polling already in progress, skipping...');
      return;
    }

    this.processingLock = true;

    try {
      // SSOT: Database triggers handle continuation timeout enforcement
      // Client processes candles autonomously - no continuation modal needed at client level
      // Timeout enforcement is database-driven for consistency across all clients

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
    let tradeExecuted = false;
    // ✅ SSOT FIX: Declare at function scope so catch block can access for diagnostics
    let tradeableSnapshots: any[] | undefined;
    // ✅ SSOT FIX: Declare at function scope for error handler access
    let activeSession: string | null = null;

    try {
      // 🔍 RACE CONDITION FIX: Early exit if session is stopping or config is null
      if (this.isStopping || !this.config || !this.activeSession) {
        console.log('%c[PROCESS_MULTI_SYMBOL] ⏹️ ABORT: Session stopping or config null', 'color: #ff9800; font-weight: bold', {
          isStopping: this.isStopping,
          hasConfig: !!this.config,
          hasSession: !!this.activeSession
        });
        return;
      }

      // 🔒 CRITICAL: Create local copy of config to prevent race condition
      // this.config can be set to null by stop() while async operations are running
      // Using a local copy ensures we have stable references throughout execution
      const config = this.config;
      activeSession = this.activeSession;

      // 🔍 CRITICAL: Log entry to processMultiSymbolCycle for debugging
      console.log('%c[PROCESS_MULTI_SYMBOL] 🚀 Entered processMultiSymbolCycle', 'color: #9c27b0; font-weight: bold', {
        activeSession: activeSession,
        watchlistLength: watchlist.length,
        openTradesCount: this.openTrades.length
      });

      // 💭 THOUGHT STREAM: Clear old thoughts
      try {
        await alphaThoughtStream.clearScanThoughts(activeSession);
      } catch (error) {
        logger.error(LogCategory.AI_TRADING, '[AlphaThoughts] Failed to clear old thoughts', { error });
      }

      // 🧹 SCAN RESET: Clear in-memory thesis cache for this session before each scan
      // Prevents expired thesis fingerprints from prior scans contaminating current scan
      // DB-backed entry_thesis_memory records have TTLs and self-expire; this clears the memory layer only
      if (activeSession) {
        entryThesisMemoryService.clearSessionCache(activeSession);
      }

      // ✅ ENTRY MONITOR: Block global rescans during ENTRY_MONITOR mode
      // Monitor state NO LONGER blocks Alpha from scanning - Alpha decides
      if (activeSession) {
        console.log('%c[PROCESS_MULTI_SYMBOL] ✅ activeSession exists:', 'color: #4caf50; font-weight: bold', activeSession);

        if (false) {  // This condition is always false - monitor state doesn't block scanning
          // This should never happen now, but log if it does
          logger.warn(
            LogCategory.AI_TRADING,
            `[ENTRY_MONITOR] scanCheck returned false (unexpected) - ${scanCheck.reason}`
          );
        }

        // 🔥 SSOT FIX: Active intents are visual/advisory only - NEVER block Alpha from scanning
        // Alpha decides: execute now OR keep scanning. Entry Monitor does not control this.
        console.log('%c[AUTONOMOUS ENGINE] ✅ Alpha always scans - monitor state is advisory only', 'color: #10b981; font-weight: bold');
      } else {
        console.log('%c[PROCESS_MULTI_SYMBOL] ⚠️ activeSession is NULL/UNDEFINED - skipping intent check', 'color: #ff0000; font-weight: bold');
      }

      // 🔍 AGGRESSIVE LOGGING: Entry point
      if (import.meta.env.DEV) {
        console.log('[MULTI-SYMBOL] Watchlist:', watchlist, 'Open:', this.openTrades.length);
      }

      // CRYPTO FIX: Check if ANY market is open BEFORE any LLM calls (crypto trades 24/7)
      const anyMarketOpen = hasAnyOpenMarket(watchlist);
      if (!anyMarketOpen) {
        console.log('%c[MULTI-SYMBOL] 🛑 ALL MARKETS CLOSED - Aborting scan to preserve LLM credits', 'color: #ff0000; font-weight: bold; font-size: 14px');
        logger.info(LogCategory.AI_TRADING, '🛑 All markets closed - skipping scan to preserve LLM credits');
        await this.sendAIMessage('Markets closed - Scanning paused until reopen');
        return;
      }

      // Filter to only trade symbols with open markets
      const openMarketSymbols = watchlist.filter(symbol => isSymbolMarketOpen(symbol));
      const closedSymbols = watchlist.filter(symbol => !isSymbolMarketOpen(symbol));

      if (openMarketSymbols.length < watchlist.length) {
        if (import.meta.env.DEV) {
          console.log(`[MULTI-SYMBOL] Markets open: ${openMarketSymbols.length}/${watchlist.length}`);
        }

        const cryptoOnly = openMarketSymbols.every(s => ['BTCUSD', 'ETHUSD'].includes(s));

        let marketMessage = '';
        if (cryptoOnly && closedSymbols.length > 0) {
          const marketStatus = await marketScheduleService.getMarketStatus();
          const holiday = await marketScheduleService.isHoliday();

          if (marketStatus.status === 'holiday' && holiday) {
            marketMessage = `📊 Forex markets closed for ${holiday.name}. Scanning crypto markets only (${openMarketSymbols.join(', ')}). Note: Crypto has wider spreads and higher volatility.`;
          } else if (marketStatus.status === 'early_close' && holiday) {
            marketMessage = `📊 Forex markets closed early - ${holiday.name}. Scanning crypto markets only (${openMarketSymbols.join(', ')}). Note: Crypto has wider spreads and higher volatility.`;
          } else {
            marketMessage = `📊 Forex markets closed for weekend. Scanning crypto markets only (${openMarketSymbols.join(', ')}). Note: Crypto has wider spreads and higher volatility during forex closed hours.`;
          }
        } else if (closedSymbols.length > 0) {
          marketMessage = `📊 Scanning ${openMarketSymbols.length} open markets. ${closedSymbols.length} symbols temporarily unavailable (${closedSymbols.join(', ')}).`;
        }

        if (marketMessage) {
          if (import.meta.env.DEV) {
            console.log(`[MULTI-SYMBOL] Market status: ${marketMessage}`);
          }
          await this.sendAIMessage(marketMessage);
        }
      }

      // Check weekend protection - pass first open market symbol to allow crypto trading 24/7
      // If we have any open market symbols (already filtered above), check if we can trade them
      const canTrade = await (openMarketSymbols.length > 0
        ? weekendProtectionService.canOpenNewTrade(openMarketSymbols[0])
        : weekendProtectionService.canOpenNewTrade());

      if (!canTrade.allowed) {
        console.log('%c[MULTI-SYMBOL] 🛑 Trading DISABLED - ' + canTrade.reason, 'color: #ff0000; font-weight: bold');
        logger.info(LogCategory.AI_TRADING, `🛑 Trading disabled: ${canTrade.reason}`);
        await this.sendAIMessage(`⏸️ ${canTrade.reason}`);
        return;
      }


      // CRITICAL: Verify with DB before expensive operations (prevents memory desync bugs)
      const { count: dbCount, error: countError } = await supabase
        .from('goal_session_trades')
        .select('*', { count: 'exact', head: true })
        .eq('goal_session_id', activeSession!)
        .eq('status', 'open');

      if (countError) {
        logger.error(LogCategory.AI_TRADING, 'Error querying trade count:', countError);
      }

      const tradeCount = dbCount || 0;

      console.log('%c[MULTI-SYMBOL] 🔐 Trade count verification:', 'color: #ff9800; font-weight: bold', {
        memory: this.openTrades.length,
        database: tradeCount,
        maxAllowed: config.maxConcurrentTrades
      });

      // Use DB as source of truth
      if (tradeCount >= config.maxConcurrentTrades) {
        console.log('%c[MULTI-SYMBOL] ⏸️ BLOCKED: Max trades reached (DB verified)', 'color: #ff9800; font-weight: bold');
        logger.debug(LogCategory.AI_TRADING, `⏸️ Max trades (${config.maxConcurrentTrades}) reached - skipping expensive scan`);
        return;
      }

      console.log('%c[MULTI-SYMBOL] ✅ Lock already held by parent - proceeding', 'color: #00ff00; font-weight: bold');
      logger.debug(LogCategory.AI_TRADING, `📊 Building snapshots for ${openMarketSymbols.length} symbols with open markets...`);

      console.log('%c[MULTI-SYMBOL] 📊 Building market snapshots for open markets...', 'color: #2196f3; font-weight: bold');
      const snapshotStartTime = Date.now();

      // SSOT PRICE FRESHNESS: Invoke autonomous price poller to ensure realtime_prices table is fresh
      // Server polling keeps data fresh independently of client polling cycle
      // This ensures execution freshness gate (30s) is always satisfied
      try {
        const pollerUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/autonomous-price-poller`;
        const pollerResponse = await fetch(pollerUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
          },
          body: JSON.stringify({ symbols: openMarketSymbols })
        });

        if (!pollerResponse.ok) {
          logger.warn(LogCategory.AI_TRADING, '[Price Poller] Polling failed', {
            status: pollerResponse.status
          });
        } else {
          const pollerResult = await pollerResponse.json();
          logger.debug(LogCategory.AI_TRADING, '[Price Poller] ✅ Price freshness updated', {
            polledCount: pollerResult.polledCount
          });
        }
      } catch (pollerError) {
        logger.warn(LogCategory.AI_TRADING, '[Price Poller] Failed to invoke', { error: pollerError });
        // Non-fatal: Continue with snapshot building
      }

      // CCIP-STYLE-TF-2026: Pass tradeStyle as the SSOT for timeframe selection.
      // riskMode controls financial exposure only — snapshot builder derives timeframe from style.
      const snapshotResult = await multiSymbolSnapshotBuilder.buildSnapshots(openMarketSymbols, config?.tradeStyle);
      console.log('%c[MULTI-SYMBOL] ✅ Snapshots built in ' + (Date.now() - snapshotStartTime) + 'ms', 'color: #4caf50; font-weight: bold');
      console.log('[MULTI-SYMBOL] Snapshot result:', {
        totalSnapshots: snapshotResult.snapshots.length,
        tradeableCount: snapshotResult.tradeableSymbols.length,
        blockedCount: snapshotResult.blockedSymbols.size
      });

      if (snapshotResult.snapshots.length === 0) {
        console.log('%c[MULTI-SYMBOL] ❌ FAILED: No snapshot data', 'color: #f44336; font-weight: bold');
        logger.debug(LogCategory.AI_TRADING, '⚠️ No symbol data available');
        return;
      }

      logger.debug(LogCategory.AI_TRADING, `✅ ${snapshotResult.tradeableSymbols.length}/${snapshotResult.snapshots.length} symbols tradeable`);

      if (snapshotResult.blockedSymbols.size > 0) {
        snapshotResult.blockedSymbols.forEach((reason, symbol) => {
          logger.debug(LogCategory.AI_TRADING, `❌ ${symbol}: Blocked (${reason})`);
        });
      }

      // ✅ SSOT FIX: Assign to function-scoped variable (no const redeclaration)
      tradeableSnapshots = snapshotResult.snapshots.filter(s => s.tradeable);

      // 💭 THOUGHT STREAM: Emit filtering results
      try {
        const qualitySymbols = tradeableSnapshots.map(s => s.symbol);
        await alphaThoughtStream.emitFiltering(
          activeSession,
          config.userId,
          tradeableSnapshots.length,
          snapshotResult.snapshots.length,
          qualitySymbols
        );
      } catch (error) {
        logger.error(LogCategory.AI_TRADING, '[AlphaThoughts] Failed to emit filtering', { error });
      }

      if (tradeableSnapshots.length === 0) {
        console.log('%c[MULTI-SYMBOL] 🚫 No tradeable opportunities', 'color: #ff9800; font-weight: bold');
        logger.debug(LogCategory.AI_TRADING, '🚫 No tradeable opportunities - WAIT mode');

        const marketCount = openMarketSymbols.length;
        const blockedSymbols = Array.from(snapshotResult.blockedSymbols.entries());
        const blockedCount = blockedSymbols.length;
        const passedCount = snapshotResult.snapshots.length;

        let contextMsg = `Scanned ${marketCount} open markets — all ${blockedCount > 0 ? blockedCount + ' blocked before analysis' : 'pairs screened'}.`;

        if (blockedCount > 0) {
          const topBlockReason = blockedSymbols.slice(0, 2).map(([sym, reason]) => `${sym} (${reason})`).join(', ');
          contextMsg += ` Blocked: ${topBlockReason}.`;
        }

        if (passedCount === 0) {
          contextMsg += ` No symbols had sufficient price data. System will retry next cycle.`;
        } else {
          const avgAtr = snapshotResult.snapshots.reduce((sum, s) => {
            const atrVal = typeof s.atr === 'number' ? s.atr : (s.atr as any)?.value ?? 0;
            return sum + atrVal;
          }, 0) / passedCount;
          const currentHour = new Date().getUTCHours();
          const isAsianSession = currentHour >= 0 && currentHour < 8;
          const isLondonOpen = currentHour >= 7 && currentHour < 9;
          const isNYOpen = currentHour >= 13 && currentHour < 15;

          if (isAsianSession) {
            contextMsg += ` Asian session typically has lower volatility — setups emerge during London open (08:00 UTC).`;
          } else if (avgAtr < 0.0005) {
            contextMsg += ` ATR is low across all pairs — market is consolidating. High-probability setups require expanded ranges.`;
          } else if (isLondonOpen || isNYOpen) {
            contextMsg += ` Session open detected — volatility should expand shortly.`;
          } else {
            contextMsg += ` Monitoring for structural setups. Will scan again next cycle.`;
          }
        }

        await this.sendAIMessage(contextMsg);
        return;
      }

      if (import.meta.env.DEV) {
        console.log(`[MULTI-SYMBOL] Tradeable: ${tradeableSnapshots.length}`);
      }

      const marketStates: FullMarketState[] = tradeableSnapshots.map(snapshot => ({
        symbol: snapshot.symbol,
        price: snapshot.price,
        ema20: snapshot.ema20,
        ema50: snapshot.ema50,
        ema200: snapshot.ema200,
        rsi: snapshot.rsi,
        stochRsi: snapshot.stochRsi,
        atr: safeExtractATRValue(snapshot.atr, `FullMarketState.${snapshot.symbol}`),
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
        riskTolerance: config.riskMode === 'high' ? 0.8 : config.riskMode === 'medium' ? 0.5 : 0.3,
        preferredTimeframe: config.timeframe,
        learningProgress: 0
      };

      // 🎯 BUILD GOAL CONTEXT for Alpha's awareness
      const { data: sessionData } = await supabase
        .from('goal_sessions')
        .select('target_value, starting_balance')
        .eq('id', activeSession)
        .single();

      const { data: closedTrades } = await supabase
        .from('goal_session_trades')
        .select('profit_loss')
        .eq('goal_session_id', activeSession)
        .eq('status', 'closed');

      const currentProgress = closedTrades?.reduce((sum, t) => sum + (t.profit_loss || 0), 0) || 0;
      const targetGoal = sessionData?.target_value || 200;
      const remainingGoal = targetGoal - currentProgress;
      const goalPercentage = (remainingGoal / config.initialBalance) * 100;

      // ═══════════════════════════════════════════════════════════════════
      // CCIP COMPLIANT: Market-Aware Goal Feasibility Estimation (SSOT)
      // ═══════════════════════════════════════════════════════════════════
      //
      // ✅ GOAL FEASIBILITY ESTIMATION ONLY - NOT REAL TRADE PRICES
      // ⚠️ CRITICAL: These reference prices are for estimation ONLY
      // They should NEVER be used in actual trade execution
      // Real trades use actual market prices from snapshot data
      //
      // Purpose: Estimate "how many pips needed" to reach goal
      // Method: Use market-aware reference symbol (SSOT: getEstimationReferenceSymbol)
      //   - Forex OPEN → EURUSD (most liquid, best reference)
      //   - Forex CLOSED → BTCUSD (24/7 availability, prevents misleading logs)
      //
      // This provides context for Alpha's decision-making, but Alpha ALWAYS
      // uses real market prices, real symbol data, and real opportunity analysis

      const riskPercent = getRiskPercentage(config.riskMode);
      const estimationRef = getEstimationReferenceSymbol();

      const ESTIMATION_REFERENCE_ENTRY = estimationRef.referenceEntry;
      const refPipInfo = getCurrencyPipInfo(estimationRef.symbol);
      const ESTIMATION_REFERENCE_STOP = ESTIMATION_REFERENCE_ENTRY - (estimationRef.referenceStopPips * refPipInfo.pipValue);

      if (import.meta.env.DEV) {
        console.log(`[Goal Estimation] Using ${estimationRef.symbol} - ${estimationRef.reason}`);
      }

      // ✅ PHASE 3.1 SECTION 3: Use EstimationRiskCalculator (SSOT for estimations)
      // Fast, synchronous estimation for goal amount calculations
      const { estimationRiskCalculator } = await import('./estimation-risk-calculator');
      const estimate = estimationRiskCalculator.estimatePositionSize({
        balance: config.initialBalance,
        riskPercent,
        symbol: estimationRef.symbol,  // Market-aware reference symbol
        entryPrice: ESTIMATION_REFERENCE_ENTRY,  // NOT REAL PRICE - estimation only
        stopLossPrice: ESTIMATION_REFERENCE_STOP,  // NOT REAL PRICE - estimation only
        isEstimation: true  // Suppress misleading logs
      });
      const estimatedLotSize = estimate.lotSize;

      // Calculate dollar per pip for this lot size
      const estimatedDollarPerPip = calculateDollarPerPip(estimationRef.symbol, estimatedLotSize);
      const pipsNeededEstimate = Math.abs(remainingGoal / estimatedDollarPerPip);

      const goalContext: import('../brains/coordinator-alpha').GoalContext = {
        hasGoal: true,
        currentBalance: config.initialBalance,
        targetGoal,
        currentProgress,
        remainingGoal,
        goalPercentage,
        pipsNeededEstimate,
        riskMode: config.riskMode,
        riskPercent: getRiskPercentage(config.riskMode),
        sessionId: this.activeSession ?? undefined,
        tradeStyle: config.tradeStyle,
        // CCIP-MULTI-TRADE-TOP-N: propagate multi-trade intent to orchestrator so
        // the early-exit optimisation is suppressed and all symbols are evaluated.
        multiTradeMode: config.multiTradeMode ?? (config.maxConcurrentTrades > 1),
      };

      if (import.meta.env.DEV) {
        console.log(`[GOAL] Balance: $${goalContext.currentBalance.toFixed(2)}, Remaining: $${goalContext.remainingGoal.toFixed(2)} (${goalContext.goalPercentage.toFixed(1)}%)`);
      }

      logger.debug(LogCategory.AI_TRADING, `🧠 Running Omega Council for ${marketStates.length} symbols...`);
      if (import.meta.env.DEV) {
        console.log(`[MULTI-SYMBOL] AI Orchestrator: ${marketStates.length} markets`);
      }
      const orchestratorStartTime = Date.now();

      // ═══════════════════════════════════════════════════════════════════
      // IM SIGNAL MAP: Query session_intelligence_data for pre-computed
      // per-symbol signals. Keyed by symbol for O(1) lookup in orchestrator.
      // Non-blocking: empty map on failure, scan continues normally.
      // specificSymbols filter applied here if present.
      // ═══════════════════════════════════════════════════════════════════
      const imSignalMap = new Map<string, Record<string, unknown>>();
      try {
        const { data: intelligenceRow } = await supabase
          .from('session_intelligence_data')
          .select('all_pair_scores, top_pairs, heating_pairs')
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (intelligenceRow?.all_pair_scores && Array.isArray(intelligenceRow.all_pair_scores)) {
          const activeSymbols = config.specificSymbols && config.specificSymbols.length > 0
            ? new Set(config.specificSymbols)
            : null;

          for (const entry of intelligenceRow.all_pair_scores as Record<string, unknown>[]) {
            const sym = entry.symbol as string | undefined;
            if (!sym) continue;
            if (activeSymbols && !activeSymbols.has(sym)) continue;
            imSignalMap.set(sym, entry);
          }

          if (import.meta.env.DEV) {
            console.log(`[IM Signal] Loaded ${imSignalMap.size} symbol signals from session_intelligence_data`);
          }
        }
      } catch (imErr) {
        console.warn('[IM Signal] Failed to load session_intelligence_data — proceeding without IM signals:', imErr);
      }

      // CCIP GOVERNANCE: If user launched this session via "Analyze with Alpha" card button,
      // inject the card signal directly into imSignalMap for the selected symbol.
      // This overrides/enriches the DB entry so Alpha receives the exact pre-computed
      // intelligence (direction, scalpSubMode, scalpPattern, momentumPhase) the user saw.
      if (config.cardSignal && typeof config.cardSignal === 'object') {
        const cardSymbol = config.cardSignal.symbol as string | undefined;
        if (cardSymbol) {
          const existing = imSignalMap.get(cardSymbol) || {};
          imSignalMap.set(cardSymbol, { ...existing, ...config.cardSignal });
          if (import.meta.env.DEV) {
            console.log(`[IM Signal] Card signal injected for ${cardSymbol}:`, config.cardSignal);
          }
        }
      }

      // Run Full Omega Council (Alpha Scout system removed for simplicity)
      const councilPromise = alphaOmegaOrchestrator.evaluateMultipleSymbols(
        marketStates,
        traderScore,
        config.userId,
        goalContext,
        imSignalMap
      );

      // INCREASED TIMEOUT: 180s for multi-symbol evaluation (9 symbols * ~20s average)
      // Previous 60s timeout was too aggressive and caused premature failures
      const timeoutPromise = new Promise<any>((_, reject) => {
        setTimeout(() => reject(new Error('Council timeout after 180s')), 180000);
      });

      let omegaDecisions: Map<string, any>;
      try {
        omegaDecisions = await Promise.race([councilPromise, timeoutPromise]);
      } catch (error) {
        // If timeout occurs, log detailed diagnostic info
        logger.error(LogCategory.AI_TRADING, 'Omega Council evaluation timed out', {
          symbolCount: marketStates.length,
          elapsed: Date.now() - orchestratorStartTime,
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        // Send user notification about timeout
        await this.sendAIMessage(
          `⚠️ Market analysis timed out after 3 minutes while evaluating ${marketStates.length} symbols. ` +
          `This may indicate LLM rate limiting or network issues. Skipping this scan cycle.`
        );

        return; // Skip this scanning cycle
      }

      const orchestratorDuration = Date.now() - orchestratorStartTime;
      if (import.meta.env.DEV) {
        console.log(`[MULTI-SYMBOL] Full Council: ${omegaDecisions.size} decisions in ${orchestratorDuration}ms`);
      }

      // ═══════════════════════════════════════════════════════════════════
      // MANDATORY DECISION LOGGING (SSOT + CCIP REQUIREMENT)
      // ═══════════════════════════════════════════════════════════════════
      // ALL decisions must be logged to alpha_decisions table IMMEDIATELY
      // If logging fails, the scan must STOP (not continue silently)
      // This is critical for forensic analysis and Alpha learning
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`[MANDATORY LOGGING] Logging ${omegaDecisions.size} Alpha decisions...`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

      try {
        for (const [symbol, decision] of omegaDecisions.entries()) {
          // Log every decision (BUY, SELL, WAIT, NO_TRADE)
          const marketState = marketStates.find(ms => ms.symbol === symbol);
          if (!marketState) {
            console.warn(`[MANDATORY LOGGING] ⚠️ No market state found for ${symbol} - skipping log`);
            continue;
          }

          const actualOmegaVotes = decision.omega_votes || {};
          const voteEntries = Object.values(actualOmegaVotes).filter(Boolean);
          const buyVotes = voteEntries.filter((v: any) => v?.vote === 'BUY' || v?.direction === 'BUY' || v?.bias === 'BUY').length;
          const sellVotes = voteEntries.filter((v: any) => v?.vote === 'SELL' || v?.direction === 'SELL' || v?.bias === 'SELL').length;
          const majorityDirection = buyVotes > sellVotes ? 'BUY' : sellVotes > buyVotes ? 'SELL' : 'MIXED';
          const agreementCount = Math.max(buyVotes, sellVotes);

          // ✅ CCIP 2026-02-14: Extract real conflict data from decision
          // SSOT: Orchestrator is the authority for conflict detection
          const conflictInfo = decision.conflictInfo || {
            detected: false,
            type: 'NONE' as const
          };

          console.log(`[CONFLICT TRACKING] ${symbol}: Logging decision with conflict_detected=${conflictInfo.detected}, type=${conflictInfo.type}`);
          if (conflictInfo.detected) {
            console.log(`[CONFLICT TRACKING] ${symbol}: Conflict severity=${conflictInfo.severity}, penalty=${conflictInfo.penalty}`);
          }

          const decisionId = await alphaLearningTracker.logDecision(
            config.userId,
            decision,
            actualOmegaVotes as any,
            {
              direction: (majorityDirection as 'BUY' | 'SELL' | 'MIXED'),
              confidence: decision.confidence || 0,
              agreement_count: agreementCount,
              total_votes: voteEntries.length,
            },
            conflictInfo, // ✅ Real conflict data from orchestrator (not hardcoded)
            {
              symbol,
              timeframe: config.timeframe,
              currentPrice: marketState.currentPrice,
              atr: marketState?.atr ?? 0,
              session: marketState.regime?.session || 'unknown',
            },
            traderScore,
            config.goalSessionId
          );

          if (decisionId) {
            console.log(`[MANDATORY LOGGING] ✅ ${symbol}: Logged decision ${decisionId} (${decision.action} @ ${decision.confidence}%)`);
          } else {
            console.error(`[MANDATORY LOGGING] ❌ ${symbol}: Failed to get decision ID from logger`);
          }
        }

        console.log(`\n[MANDATORY LOGGING] ✅ All ${omegaDecisions.size} decisions logged successfully\n`);
      } catch (loggingError) {
        // CRITICAL: If logging fails, stop the scan cycle
        console.error(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.error(`[MANDATORY LOGGING] ❌ CRITICAL: Decision logging failed`);
        console.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.error(loggingError);

        logger.error(LogCategory.AI_TRADING, '❌ CRITICAL: Mandatory decision logging failed', {
          error: loggingError instanceof Error ? loggingError.message : 'Unknown error',
          symbolCount: omegaDecisions.size,
        });

        await this.sendAIMessage(
          `🚨 CRITICAL ERROR: Failed to log trading decisions to database.\n\n` +
          `This is a mandatory requirement for system integrity and Alpha learning.\n` +
          `Scan cycle stopped to prevent data loss.\n\n` +
          `Error: ${loggingError instanceof Error ? loggingError.message : 'Unknown error'}`
        );

        // STOP SCANNING - do not continue without decision logging
        return;
      }

      // 🔒 THESIS FILTER: Remove symbols with expired theses (Infinite Loop Fix)
      // This prevents rescanning the same symbol after it was abandoned due to runaway price
      logger.info(LogCategory.AI_TRADING, `[THESIS_FILTER] Checking ${tradeableSnapshots.length} symbols for expired theses...`);

      const filteredSnapshots: typeof tradeableSnapshots = [];
      const filteredDecisions = new Map<string, any>();
      let expiredThesisCount = 0;

      for (const snapshot of tradeableSnapshots) {
        const decision = omegaDecisions.get(snapshot.symbol);
        if (!decision) {
          continue;
        }

        // Only filter if decision is actionable (BUY/SELL/WAIT)
        if (['BUY', 'SELL', 'WAIT'].includes(decision.action)) {
          const direction: 'BUY' | 'SELL' = decision.action === 'SELL' ? 'SELL' : 'BUY';
          const entryZoneCenter = decision.entry || snapshot.price;

          // Check if thesis is expired for this symbol/direction combination
          const thesisCheck = await entryThesisMemoryService.shouldCreateIntent(
            config.userId,
            config.goalSessionId,
            snapshot.symbol,
            direction,
            entryZoneCenter,
            'M15'
          );

          if (!thesisCheck.allowed) {
            logger.warn(LogCategory.AI_TRADING, `[THESIS_FILTER] ❌ Filtered ${snapshot.symbol} ${direction}`, {
              reason: thesisCheck.reason,
              fingerprint: thesisCheck.fingerprint,
            });

            console.log(
              '%c[THESIS_FILTER] ❌ FILTERED SYMBOL',
              'color: #ff9800; font-weight: bold',
              {
                symbol: snapshot.symbol,
                direction,
                action: decision.action,
                reason: thesisCheck.reason,
                fingerprint: thesisCheck.fingerprint,
              }
            );

            expiredThesisCount++;
            continue;
          }
        }

        // Symbol passed filter
        filteredSnapshots.push(snapshot);
        filteredDecisions.set(snapshot.symbol, decision);
      }

      logger.info(LogCategory.AI_TRADING, `[THESIS_FILTER] Filtered ${expiredThesisCount} expired theses. ${filteredSnapshots.length}/${tradeableSnapshots.length} symbols remain.`);

      console.log(
        '%c[THESIS_FILTER] ✅ Filter complete',
        'color: #4caf50; font-weight: bold',
        {
          totalSymbols: tradeableSnapshots.length,
          expiredFiltered: expiredThesisCount,
          remainingSymbols: filteredSnapshots.length,
        }
      );

      // If all symbols were filtered, return early
      if (filteredSnapshots.length === 0) {
        logger.info(LogCategory.AI_TRADING, `[THESIS_FILTER] All symbols have expired theses. Waiting for new opportunities.`);
        await this.sendAIMessage(
          `🔒 All detected opportunities have recently been abandoned. Waiting for market structure to evolve before reassessing.`
        );
        return;
      }

      // 💭 THOUGHT STREAM: Emit comparing candidates
      try {
        const candidates = filteredSnapshots.map(snapshot => {
          const decision = filteredDecisions.get(snapshot.symbol);
          return {
            symbol: snapshot.symbol,
            confidence: decision?.confidence || 0,
            action: (decision?.action || 'WAIT') as 'BUY' | 'SELL' | 'WAIT' | 'NO_TRADE',
            score: decision?.confidence || 0
          };
        });
        await alphaThoughtStream.emitComparing(
          activeSession,
          config.userId,
          candidates
        );
      } catch (error) {
        logger.error(LogCategory.AI_TRADING, '[AlphaThoughts] Failed to emit comparing', { error });
      }

      // ═══════════════════════════════════════════════════════════════════
      // CALCULATE TPS SCORES FOR TIE-BREAKING (CONFIDENCE-DOMINANT FIX)
      // ═══════════════════════════════════════════════════════════════════
      // TPS scores are used ONLY for tie-breaking when confidence difference ≤5 points
      // Alpha's confidence remains the PRIMARY score
      const tpsScores = new Map<string, number>();

      try {
        for (const snapshot of filteredSnapshots) {
          const decision = filteredDecisions.get(snapshot.symbol);
          if (!decision || decision.action === 'NO_TRADE') {
            continue;
          }

          // Build TPS candidate from Alpha decision
          const candidate: TPSCandidate = {
            symbol: snapshot.symbol,
            direction: decision.action === 'SELL' ? 'SELL' : 'BUY',
            style: decision.style || 'INTRADAY',
            tradeConfidence: decision.confidence || 0,
            eqsNow: decision.entryQualityScore || 40,
            eqsRequired: 40,
            entryMode: decision.entryMode === 'immediate' ? 'EXECUTE_NOW' : 'WAIT_ENTRY',
            minutesSinceSignal: 0,
            momentumState: 'NEUTRAL' as const,
            eqsProjected: undefined,
            projectionConfidence: undefined,
          };

          const evaluation = computeTPS(candidate);
          tpsScores.set(snapshot.symbol, evaluation.scores.total);

          if (import.meta.env.DEV) {
            console.log(`[TPS] ${snapshot.symbol}: ${evaluation.scores.total.toFixed(1)} (Conf: ${evaluation.scores.confidence.toFixed(1)}, Ready: ${evaluation.scores.readiness.toFixed(1)}, Urgency: ${evaluation.scores.urgency.toFixed(1)})`);
          }
        }

        console.log(`[TPS] Calculated scores for ${tpsScores.size} candidates`);
      } catch (tpsError) {
        logger.warn(LogCategory.AI_TRADING, 'Failed to calculate TPS scores, proceeding without tie-breaker enhancement', { error: tpsError });
        // Non-critical: Continue with confidence-only selection
      }

      // ═══════════════════════════════════════════════════════════════════
      // CCIP-MULTI-TRADE-TOP-N: Symbol selection
      // Single-trade mode → selectBestSymbol (single winner, unchanged)
      // Multi-trade mode  → selectTopNSymbols (up to N winners, same cycle)
      //
      // SSOT: config.multiTradeMode drives the branching.
      // Excluded symbols = symbols already open so we never double-trade a pair.
      // ═══════════════════════════════════════════════════════════════════
      const isMultiTradeMode = config.multiTradeMode ?? (config.maxConcurrentTrades > 1);
      const slotsAvailable = config.maxConcurrentTrades - tradeCount;

      let selectedWinners: Array<{ symbol: string; evaluation: import('./best-symbol-selector').SymbolEvaluation; rank: number }> = [];
      let allEvaluations: import('./best-symbol-selector').SymbolEvaluation[] = [];

      if (isMultiTradeMode && slotsAvailable > 1) {
        const openSymbolsInSession = new Set(this.openTrades.map(t => t.symbol));
        const topNResult = bestSymbolSelector.selectTopNSymbols(
          filteredSnapshots,
          filteredDecisions,
          slotsAvailable,
          tpsScores,
          openSymbolsInSession
        );
        selectedWinners = topNResult.winners;
        allEvaluations = topNResult.allEvaluations;

        console.log(`[MULTI-TRADE TOP-N] Slots available: ${slotsAvailable} | Winners selected: ${topNResult.selectionMetadata.actualN}`);
        console.log(`[MULTI-TRADE TOP-N] ${topNResult.selectionMetadata.forensics}`);
      } else {
        const bestSymbolResult = bestSymbolSelector.selectBestSymbol(
          filteredSnapshots,
          filteredDecisions,
          tpsScores
        );
        bestSymbolSelector.logEvaluationDetails(bestSymbolResult);
        allEvaluations = bestSymbolResult.allEvaluations;
        if (bestSymbolResult.selected && bestSymbolResult.symbol && bestSymbolResult.evaluation) {
          selectedWinners = [{ symbol: bestSymbolResult.symbol, evaluation: bestSymbolResult.evaluation, rank: 1 }];
        }
      }

      // 📊 SCAN RESULTS: Store scan outcome for user visibility
      const scanEndTime = Date.now();
      const scanDurationMs = scanEndTime - orchestratorStartTime;
      try {
        const eligibleEvaluations = allEvaluations;

        const allCandidates: ScanCandidate[] = eligibleEvaluations.length > 0
          ? eligibleEvaluations.map(evaluation => ({
              symbol: evaluation.symbol,
              action: evaluation.omegaDecision?.action === 'WAIT'
                ? 'WAIT'
                : (evaluation.omegaDecision?.action || 'WAIT') as 'BUY' | 'SELL' | 'WAIT',
              confidence: evaluation.primaryScore || 0,
              score: evaluation.primaryScore || 0,
              reasoning: evaluation.reasoning?.join('. ') || '',
              trend: evaluation.snapshot?.trend,
              volatility: evaluation.snapshot?.volatility,
              adversarialLevel: evaluation.snapshot?.adversarial?.level
            }))
          : Array.from(filteredDecisions.entries())
              .filter(([, dec]) => dec?.action && dec.action !== 'NO_TRADE')
              .map(([symbol, dec]) => {
                const snapshot = filteredSnapshots.find(s => s.symbol === symbol);
                return {
                  symbol,
                  action: dec?.action === 'WAIT'
                    ? 'WAIT'
                    : (dec?.action || 'WAIT') as 'BUY' | 'SELL' | 'WAIT',
                  confidence: dec?.confidence || 0,
                  score: dec?.confidence || 0,
                  reasoning: dec?.reasoning || '',
                  trend: snapshot?.trend,
                  volatility: snapshot?.volatility,
                  adversarialLevel: snapshot?.adversarial?.level
                };
              });

        const topCandidate = allCandidates[0] || null;
        const topCandidateDecision = topCandidate ? filteredDecisions.get(topCandidate.symbol) : null;
        const rejectionReason = selectedWinners.length === 0
          ? 'No symbols passed selection criteria'
          : (topCandidateDecision && topCandidateDecision.confidence < (config.minConfidence || 70)
            ? `Confidence ${topCandidateDecision.confidence}% below threshold ${config.minConfidence || 70}%`
            : null);

        await scanResultsManager.storeScanResult({
          sessionId: activeSession!,
          scanTimestamp: new Date(scanEndTime),
          scanDurationMs,
          symbolsEvaluated: filteredSnapshots.length,
          topCandidate,
          rejectionReason,
          allCandidates,
          userId: config.userId
        });

        console.log('[SCAN RESULTS] ✅ Scan result stored', {
          topCandidate: topCandidate?.symbol,
          action: topCandidate?.action,
          confidence: topCandidate?.confidence,
          rejectionReason
        });

        // 💭 THOUGHT STREAM: Emit per-symbol reasoning before final decision
        try {
          for (const [sym, dec] of filteredDecisions.entries()) {
            if (dec?.reasoning) {
              await alphaThoughtStream.emitSymbolReasoning(
                activeSession,
                config.userId,
                sym,
                dec.action || 'WAIT',
                dec.confidence || 0,
                dec.reasoning
              );
            }
          }
        } catch (error) {
          logger.error(LogCategory.AI_TRADING, '[AlphaThoughts] Failed to emit per-symbol reasoning', { error });
        }

        // 💭 THOUGHT STREAM: Emit final decision (use top winner or no-trade)
        try {
          if (selectedWinners.length > 0) {
            const topWinner = selectedWinners[0];
            const topDecision = topWinner.evaluation.omegaDecision;
            await alphaThoughtStream.emitFinalDecision(
              activeSession,
              config.userId,
              {
                selected: true,
                symbol: topWinner.symbol,
                action: topDecision.action as 'BUY' | 'SELL' | 'WAIT' | 'NO_TRADE',
                confidence: topDecision.confidence,
                entry: topDecision.entry,
                reasoning: `${selectedWinners.length > 1 ? `Top-${selectedWinners.length} multi-trade: ` : ''}${topWinner.symbol} selected with ${topDecision.confidence}% confidence`
              }
            );
          } else {
            const perSymbolSummary = Array.from(filteredDecisions.entries())
              .map(([sym, dec]) => `${sym}: ${dec?.action || 'WAIT'} ${dec?.confidence || 0}% - ${dec?.reasoning || 'no reasoning'}`)
              .join(' | ');
            await alphaThoughtStream.emitFinalDecision(
              activeSession,
              config.userId,
              {
                selected: false,
                symbol: null,
                reasoning: perSymbolSummary || 'No quality setups found'
              }
            );
          }
        } catch (error) {
          logger.error(LogCategory.AI_TRADING, '[AlphaThoughts] Failed to emit final decision', { error });
        }
      } catch (error) {
        logger.error(LogCategory.AI_TRADING, '[SCAN RESULTS] Failed to store scan result', { error });
      }

      if (selectedWinners.length === 0) {
        logger.debug(LogCategory.AI_TRADING, '🚫 No symbols passed selection criteria');

        const snapshotsBySymbol = new Map<string, SymbolSnapshot>();
        snapshotResult.snapshots.forEach(snapshot => {
          snapshotsBySymbol.set(snapshot.symbol, snapshot);
        });

        const detailedMessage = this.buildDetailedEvaluationMessage(
          snapshotsBySymbol,
          omegaDecisions
        );

        await this.sendAIMessage(detailedMessage);
        const rejectionContext = this.buildRejectionContext(omegaDecisions, snapshotResult.snapshots);
        this.emitNoTradeEvent(rejectionContext);
        return;
      }

      // ═══════════════════════════════════════════════════════════════════
      // CCIP-MULTI-TRADE-TOP-N: Audit log — record which pairs were selected
      // and how many slots were available. Non-blocking (never stops execution).
      // ═══════════════════════════════════════════════════════════════════
      try {
        await supabase.from('multi_trade_execution_audit').insert({
          session_id: activeSession!,
          user_id: config.userId,
          slots_available: slotsAvailable,
          eligible_count: allEvaluations.length,
          selected_symbols: selectedWinners.map(w => w.symbol),
          selected_confidences: selectedWinners.map(w => w.evaluation.primaryScore),
          trades_executed: 0,
          early_exit_suppressed: isMultiTradeMode,
          notes: `Top-${selectedWinners.length} of ${allEvaluations.length} eligible`
        });
      } catch (auditError) {
        logger.warn(LogCategory.AI_TRADING, '[Multi-Trade Audit] Failed to insert audit row (non-blocking)', { error: auditError });
      }

      // ITERATE over selected winners — in multi-trade mode execute all of them,
      // in single-trade mode the array has exactly one element (no behaviour change).
      const sessionRecord = await (async () => {
        const { data, error } = await supabase
          .from('goal_sessions')
          .select('*')
          .eq('id', activeSession!)
          .single();
        if (error || !data) {
          logger.error(LogCategory.AI_TRADING, '[Trade Execution] Failed to fetch goal_session record', { error, sessionId: activeSession });
          await this.sendAIMessage('⚠️ System error: Could not load session data. Trade execution blocked to protect account.');
          return null;
        }
        return data;
      })();

      if (!sessionRecord) return;

      for (const winner of selectedWinners) {
        // Re-verify DB trade count before each execution in the loop (prevents
        // race condition if a prior iteration in this same cycle already wrote).
        const { count: currentDbCount } = await supabase
          .from('goal_session_trades')
          .select('*', { count: 'exact', head: true })
          .eq('goal_session_id', activeSession!)
          .eq('status', 'open');

        if ((currentDbCount || 0) >= config.maxConcurrentTrades) {
          logger.debug(LogCategory.AI_TRADING, `[TOP-N LOOP] Max trades (${config.maxConcurrentTrades}) reached mid-loop — stopping`);
          break;
        }

        const selectedSymbol = winner.symbol;
        let decision = winner.evaluation.omegaDecision;

      // ✅ SSOT PRECISION FIX: Round all prices to correct decimal places
      // This prevents "SL/TP precision exceeds X decimal places" validation errors
      const priceContextResult = createTradeContext(selectedSymbol);
      if (priceContextResult.success && priceContextResult.context) {
        decision = roundAlphaDecisionPrices(decision, priceContextResult.context);
        logger.debug(LogCategory.AI_TRADING, `✅ SSOT: Rounded prices for ${selectedSymbol} (${priceContextResult.context.decimalPlaces} decimals)`);
      } else {
        logger.warn(LogCategory.AI_TRADING, `⚠️ Could not round prices for ${selectedSymbol}: ${priceContextResult.error}`);
      }

      logger.debug(LogCategory.AI_TRADING, `🎯 SELECTED: ${selectedSymbol} | ${decision.action} @ ${decision.confidence}%`);

      if (decision.action === 'NO_TRADE') {
        logger.debug(
          LogCategory.AI_TRADING,
          `Alpha returned NO_TRADE for ${selectedSymbol}. Setup not ready — skipping to next winner.`
        );
        continue;
      }

      if (this.openTrades.length >= config.maxConcurrentTrades) {
        logger.debug(LogCategory.AI_TRADING, 'Max concurrent trades reached');
        break;
      }

      if (!this.allowNewTrades) {
        logger.debug(LogCategory.AI_TRADING, '⏸️ Timeframe expired - not opening new trades');
        break;
      }

      const minConfidence = config.minConfidence || 70;
      if (decision.confidence < minConfidence) {
        const rejectionMessage = `⚠️ Trade opportunity found but rejected:\n\n` +
          `🎯 Symbol: ${selectedSymbol}\n` +
          `📊 Direction: ${decision.action}\n` +
          `🔍 Confidence: ${decision.confidence}%\n` +
          `⛔ Required: ${minConfidence}%\n\n` +
          `Waiting for stronger signals (${config.riskMode.toUpperCase()} risk mode).`;

        await this.sendAIMessage(rejectionMessage);
        logger.info(LogCategory.AI_TRADING, `Trade rejected: ${selectedSymbol} ${decision.action} @ ${decision.confidence}% < ${minConfidence}%`);
        continue;
      }

      const snapshot = winner.evaluation.snapshot;

      // DEFENSIVE: Validate snapshot has candle data
      if (!snapshot.recentCandles || snapshot.recentCandles.length === 0) {
        logger.error(LogCategory.AI_TRADING, `❌ Snapshot missing candle data for ${selectedSymbol}`);
        console.error('[MULTI-SYMBOL] Invalid snapshot - missing recentCandles:', snapshot);
        continue;
      }

      const latestCandle = snapshot.recentCandles[snapshot.recentCandles.length - 1];

      // FINAL CHECK: Ensure we're not exceeding max trades (prevents race conditions)
      if (this.openTrades.length >= config.maxConcurrentTrades) {
        logger.debug(LogCategory.AI_TRADING, `BLOCKED: Already at max trades (${config.maxConcurrentTrades})`);
        await this.sendAIMessage(`Max trades (${config.maxConcurrentTrades}) limit reached. Pausing new trade scans to preserve credits. Monitoring open positions only.`);
        break;
      }

      // ✅ PHASE 2 REFACTOR: Use ProfessionalRiskManager (SSOT for position sizing)
      // Replaces direct calculateLotSizeFromDollarRisk() and calculateGoalAwareLotSize() calls
      // This ensures Kelly Criterion, EV Gating, volatility adjustments, correlation checks,
      // market condition risk, and progressive risk scaling are ALL applied consistently
      console.log(`%c[Phase 2] Using ProfessionalRiskManager for comprehensive risk evaluation...`, 'color: #00ff00; font-weight: bold');

      const { professionalRiskManager } = await import('./professional-risk-manager');
      const pipInfo = getCurrencyPipInfo(selectedSymbol);
      const stopPips = calculatePipDistance(selectedSymbol, decision.entry, decision.stopLoss);
      const takeProfitPips = calculatePipDistance(selectedSymbol, decision.entry, decision.takeProfit);

      // Determine base risk percent (either from dollar risk or risk mode)
      let baseRiskPercent: number;
      if (config.dollarRisk) {
        // Convert dollar risk to percentage of account
        baseRiskPercent = (config.dollarRisk / config.initialBalance) * 100;
        console.log(`[ProfessionalRiskManager] Dollar risk: $${config.dollarRisk} = ${baseRiskPercent.toFixed(2)}% of $${config.initialBalance}`);
      } else {
        baseRiskPercent = getRiskPercentage(config.riskMode);
        console.log(`[ProfessionalRiskManager] Risk mode: ${config.riskMode} = ${baseRiskPercent}%`);
      }

      const riskAssessment = await professionalRiskManager.evaluateTrade({
        userId: this.config!.userId,
        symbol: selectedSymbol,
        direction: decision.action === 'BUY' ? 'long' : 'short',
        currentBalance: config.initialBalance,
        baseRiskPercent: baseRiskPercent / 100, // Convert to decimal (1% = 0.01)
        stopLossPips: stopPips,
        takeProfitPips: takeProfitPips,
        currentATR: snapshot.atr.value,
        goalSessionId: this.activeSession,
        riskMode: config.riskMode
      });

      if (!riskAssessment.approved) {
        console.warn(`[ProfessionalRiskManager] Trade REJECTED:`, riskAssessment.criticalWarnings);
        await this.sendAIMessage(
          `⚠️ Trade opportunity on ${selectedSymbol} rejected by risk management:\n\n` +
          riskAssessment.criticalWarnings.join('\n') + '\n\n' +
          `Recommendations:\n` + riskAssessment.recommendations.join('\n')
        );
        logger.info(LogCategory.AI_TRADING, `Trade rejected by ProfessionalRiskManager: ${selectedSymbol}`);
        continue;
      }

      // Extract approved position size from ProfessionalRiskManager
      const lotSize = riskAssessment.recommendedLotSize;
      const adjustedRiskPercent = riskAssessment.adjustedRiskPercent * 100; // Convert back to percentage

      console.log(`%c[ProfessionalRiskManager] ✅ APPROVED`, 'color: #00ff00; font-weight: bold');
      console.log(`  Lot Size: ${(lotSize ?? 0).toFixed(2)} lots`);
      console.log(`  Adjusted Risk: ${(adjustedRiskPercent ?? 0).toFixed(2)}% (from ${(baseRiskPercent ?? 0).toFixed(2)}%)`);
      console.log(`  Risk Score: ${riskAssessment.riskScore ?? 0}/100`);
      console.log(`  Confidence Score: ${riskAssessment.confidenceScore ?? 0}/100`);
      console.log(`  Kelly Edge: ${riskAssessment.detailedBreakdown?.kelly?.edgeStrength ?? 'N/A'}`);
      console.log(`  EV: ${(riskAssessment.detailedBreakdown?.evGate?.expectedValue ?? 0).toFixed(1)} pips/trade`);

      // Calculate expected profit at Alpha's TP
      const alphaTPPips = takeProfitPips;
      const dollarPerPip = calculateDollarPerPip(selectedSymbol, lotSize);
      const expectedProfitAtCommonMove = takeProfitPips * dollarPerPip;

      // Estimate trades needed to reach goal (remainingGoal already declared above)
      const estimatedTradesNeeded = Math.ceil(remainingGoal / expectedProfitAtCommonMove);

      // ✅ SSOT FIX: Defensive null checks in reasoning string
      const reasoning = `ProfessionalRiskManager approved: ${(lotSize ?? 0).toFixed(2)} lots (${(adjustedRiskPercent ?? 0).toFixed(2)}% risk). ` +
        `Kelly Edge: ${riskAssessment.detailedBreakdown?.kelly?.edgeStrength ?? 'N/A'}. ` +
        `EV: ${(riskAssessment.detailedBreakdown?.evGate?.expectedValue ?? 0).toFixed(1)} pips/trade. ` +
        `Expected profit at TP: $${(expectedProfitAtCommonMove ?? 0).toFixed(2)}.`;

      // Log if any warnings were issued (but not blocking)
      if (riskAssessment.criticalWarnings.length > 0) {
        console.warn(`[ProfessionalRiskManager] Warnings (non-blocking):`, riskAssessment.criticalWarnings);
      }

      // ✅ SSOT FIX: Add defensive null checks before toFixed() calls
      // Calculate profit expectations (alphaTPPips already calculated above in takeProfitPips)
      const dollarPerPipAtLotSize = calculateDollarPerPip(selectedSymbol, lotSize);
      const expectedProfitAtAlphaTP = (takeProfitPips || 0) * (dollarPerPipAtLotSize || 0);
      const progressPercent = remainingGoal > 0 ? (expectedProfitAtAlphaTP / remainingGoal) * 100 : 0;

      if (import.meta.env.DEV) {
        // ✅ SSOT FIX: Defensive null checks to prevent "Cannot read toFixed of undefined"
        const safeLotSize = lotSize ?? 0;
        const safeTakeProfitPips = takeProfitPips ?? 0;
        const safeExpectedProfit = expectedProfitAtAlphaTP ?? 0;
        console.log(`[Trade] ${decision.symbol} ${safeLotSize.toFixed(3)} lots, TP: ${safeTakeProfitPips.toFixed(1)}p ($${safeExpectedProfit.toFixed(2)})`);
      }

      const { currentSession } = calculateSessionContext();

      // ✅ CRITICAL FIX: Convert ATR from price units to pips
      // snapshot.atr is ATRValue type with .value property in price units (e.g., 0.04370 for USDJPY)
      // Must convert to pips before passing to timeToFillCalculator
      // pipInfo already declared above in refactoring code
      const atrPips = (snapshot.atr.value || (10 * pipInfo.pipValue)) / pipInfo.pipValue;
      const spreadPips = (snapshot.spread || 0) / pipInfo.pipValue;

      // DEBUG: Log ATR conversion
      console.log(`[ATR DEBUG] ${selectedSymbol}:`, {
        snapshotAtr: snapshot.atr.value,
        pipValue: pipInfo.pipValue,
        atrPips,
        reconvertedATR: atrPips * pipInfo.pipValue
      });

      const timeToFillResult = timeToFillCalculator.calculate({
        tpDistancePips: alphaTPPips,
        atrPips,
        currentSession,
        symbol: selectedSymbol
      });

      // Resolve Alpha's style intent to executable trading mode
      const atrPercent = snapshot.atr.value / snapshot.price;
      const sessionTypeMap: Record<string, 'asian' | 'london' | 'nyse'> = {
        'london': 'london',
        'ny': 'nyse',
        'overlap': 'london',
        'asian': 'asian',
        'sydney': 'asian',
        'closed': 'asian'
      };

      const styleResolution = executionStyleResolver.resolve({
        requestedStyle: decision.resolvedStyle || 'INTRADAY',
        riskMode: goalContext.riskMode?.toUpperCase() as 'LOW' | 'MEDIUM' | 'HIGH',
        atrPercent,
        sessionType: sessionTypeMap[currentSession]
      });

      const tradingMode: TradingMode = styleResolution.executionMode;

      // ✅ ALPHA AUTHORITY MODEL: Log the immutable style
      console.log(`[Style Resolution] ✅ Alpha Style: ${styleResolution.immutableStyle} (IMMUTABLE) | Execution Mode: ${styleResolution.executionMode}${styleResolution.advisory ? ' | ' + styleResolution.advisory : ''}`);


      // 🎯 GOAL FEASIBILITY CHECK - Prevents forcing trades in low volatility / unrealistic goals
      console.log('%c[Goal Feasibility] 🔍 Analyzing goal feasibility before execution...', 'color: #3b82f6; font-weight: bold');

      const { typicalATR, dailyATR } = await this.calculateHistoricalATR(selectedSymbol);
      const currentATRValue = snapshot.atr.value;

      const feasibilityInput = {
        userId: config.userId,
        sessionId: activeSession!,
        goalAmount: goalContext.targetGoal,
        currentProgress: goalContext.currentProgress,
        accountBalance: goalContext.currentBalance,
        symbol: selectedSymbol,
        currentATR: currentATRValue,
        typicalATR,
        dailyATR,
        currentSpread: snapshot.spread,
        currentPrice: decision.entry,
        // CRITICAL FIX: Pass user's Trade Style risk selection for accurate feasibility calculation
        dollarRisk: config.dollarRisk,
        tradeStyle: config.tradeStyle,
      };

      const feasibilityResult = await GoalFeasibilityResolver.analyzeFeasibility(feasibilityInput);

      // Handle BLOCK tier - Goal exceeds safe limits
      if (!feasibilityResult.feasible && feasibilityResult.tier === 'BLOCK_WITH_ALTERNATIVES') {
        console.log('%c[Goal Feasibility] 🚫 BLOCKED - Goal not feasible', 'color: #ef4444; font-weight: bold');
        await this.sendAIMessage(
          `🚫 Goal Not Feasible\n\n` +
          `${feasibilityResult.blockReason}\n\n` +
          `💡 Suggestions:\n${feasibilityResult.alternativeSuggestions?.map(s => `  • ${s}`).join('\n') || ''}`
        );
        continue;
      }

      // Handle WAIT tier - Market too quiet or opportunity not meaningful
      if (!feasibilityResult.feasible && feasibilityResult.tier === 'WAIT_FOR_VOLATILITY') {
        console.log('%c[Goal Feasibility] ⏸️ WAITING - Conditions not optimal', 'color: #f59e0b; font-weight: bold');
        await this.sendAIMessage(`⏸️ ${feasibilityResult.waitReason}`);
        continue;
      }

      // ✅ ARCHITECTURAL FIX: Feasibility is ADVISORY ONLY - Alpha has final authority
      // Philosophy: "Reduced profit > NO_TRADE" means Alpha can proceed with ANY feasible setup
      // Auto-reduction logic REMOVED per CCIP - no silent TP/SL mutation allowed
      let downshiftedProposal: DownshiftProposal | undefined;
      let adjustedTakeProfit = decision.takeProfit; // Keep Alpha's original TP
      let adjustedExpectedProfit = expectedProfitAtAlphaTP; // Keep Alpha's original profit estimate

      if (feasibilityResult.feasible && feasibilityResult.tier === 'EXECUTE_REDUCED' && feasibilityResult.proposal) {
        // CHANGED: Log advisory but DO NOT auto-reduce
        console.log('%c[Goal Feasibility] ℹ️ EXECUTE_REDUCED advisory (NOT applied)', 'color: #3b82f6; font-weight: bold');

        const reducedProposal = feasibilityResult.proposal as any;

        // Send ADVISORY message only - no execution changes
        await this.sendAIMessage(
          `ℹ️ Feasibility Advisory\n\n` +
          `${reducedProposal.advisoryMessage}\n\n` +
          `📊 Reason: ${reducedProposal.reason}\n` +
          `📉 Suggested goal: $${reducedProposal.reducedGoal.toFixed(2)}\n` +
          `📈 Retention: ${(reducedProposal.retentionPercent * 100).toFixed(0)}%\n\n` +
          `🎯 Alpha's Decision: Proceeding with original TP (Alpha has FINAL AUTHORITY)`
        );

        console.log('%c[Goal Feasibility] ✅ Advisory logged - Alpha TP preserved', 'color: #10b981; font-weight: bold');
      }
      // ✅ ARCHITECTURAL FIX: DOWNSHIFT tier is now ADVISORY ONLY
      // Alpha already chose the TP - downshift suggestions are informational
      else if (feasibilityResult.feasible && feasibilityResult.proposal) {
        console.log('%c[Goal Feasibility] ℹ️ Downshift advisory detected (INFORMATIONAL)', 'color: #8b5cf6; font-weight: bold');

        downshiftedProposal = feasibilityResult.proposal;

        // Log advisory but DO NOT ask Alpha to re-confirm or modify TP
        await this.sendAIMessage(
          `ℹ️ Feasibility Advisory\n\n` +
          `Feasibility suggests adjusted goal: $${downshiftedProposal.adjustedGoal.toFixed(2)} (${(downshiftedProposal.retentionPercent * 100).toFixed(0)}% retention)\n\n` +
          `Reasons:\n${downshiftedProposal.reasonsForDownshift.map(r => `  • ${r}`).join('\n')}\n\n` +
          `🎯 Alpha's Decision: Proceeding with original TP (Alpha sovereignty preserved)`
        );

        console.log('%c[Goal Feasibility] ✅ Advisory logged - Alpha TP preserved (no downshift applied)', 'color: #10b981; font-weight: bold');
      } else if (feasibilityResult.feasible) {
        console.log('%c[Goal Feasibility] ✅ Goal is feasible without adjustments', 'color: #10b981; font-weight: bold');
      }

      const gateInput: ExecutionEligibilityInput = {
        symbol: selectedSymbol,
        direction: decision.action.toLowerCase() as 'buy' | 'sell',
        entryPrice: decision.entry,
        stopLoss: decision.stopLoss,
        takeProfit: adjustedTakeProfit,
        lotSize: lotSize,
        expectedProfitUSD: adjustedExpectedProfit,
        estimatedTradesRequired: estimatedTradesNeeded,
        remainingGoal: goalContext.remainingGoal,
        accountBalance: config.initialBalance,
        currentATR: atrPips * pipInfo.pipValue,
        spreadPips,
        timeToFillResult,
        tradingMode
      };

      // Eligibility checking is now handled by alpha-trade-executor (unified-risk-authority)

      let calculatedLotSize = lotSize;

      // Build comprehensive reasoning that explains the trade plan
      const tradeReasoningAddendum = `\n\n💰 GOAL PROGRESS CONTEXT:\n` +
        `Remaining to Goal: $${goalContext.remainingGoal.toFixed(2)}\n` +
        `This Trade Target: $${adjustedExpectedProfit.toFixed(2)} (${((adjustedExpectedProfit / goalContext.remainingGoal) * 100).toFixed(0)}% progress)\n` +
        `${downshiftedProposal ? `🔄 Goal Adjusted: ${(downshiftedProposal.retentionPercent * 100).toFixed(0)}% retention (Alpha approved)\n` : ''}` +
        `${estimatedTradesNeeded > 1 ?
          `Multi-Trade Strategy: Estimated ${estimatedTradesNeeded} trades needed at realistic market-based TPs` :
          `Single-Trade Strategy: Goal achievable in this trade if TP is reached`}\n` +
        `\nTP Strategy: ${decision.reasoning.includes('liquidity') ? 'Liquidity-based placement' : 'Market structure-based placement'}`;

      // 🚨 CRITICAL PRE-EXECUTION SAFETY CHECK
      // stopPips already declared above in refactoring code
      const dollarPerPipCalc = calculateDollarPerPip(selectedSymbol, calculatedLotSize);
      const calculatedRisk = stopPips * dollarPerPipCalc;

      // PHASE 2: Use SSOT constant for maximum risk (already imported at top)
      const maxSafeRisk = config.initialBalance * TRADING_CONSTANTS.RISK_PERCENTAGES.MAX_PER_TRADE; // 0.10 (10%)

      if (import.meta.env.DEV) {
        console.log(`[Validation] Risk: $${calculatedRisk.toFixed(2)}/$${maxSafeRisk.toFixed(2)}, ${stopPips.toFixed(1)}p`);
      }

      if (calculatedRisk > maxSafeRisk) {
        console.error('%c🚨 EXECUTION BLOCKED: RISK TOO HIGH!', 'color: #ff0000; font-weight: bold; font-size: 16px');
        console.error(`  Risk: $${calculatedRisk.toFixed(2)} > Max: $${maxSafeRisk.toFixed(2)}`);

        // ✅ FIX: Use asset-specific dollarPerPipPerLot (NOT hardcoded * 10)
        const pipInfo = getCurrencyPipInfo(selectedSymbol);
        const safeLotSize = maxSafeRisk / (stopPips * pipInfo.dollarPerPipPerLot);
        calculatedLotSize = Math.max(0.01, Math.round(safeLotSize * 100) / 100);

        console.error(`  🛡️ SAFETY OVERRIDE: Reducing to ${calculatedLotSize.toFixed(2)} lots`);

        await this.sendAIMessage(
          `⚠️ Position size safety override activated!\n\n` +
          `Original calculation would risk $${calculatedRisk.toFixed(2)} (too high).\n` +
          `Reduced to ${calculatedLotSize.toFixed(2)} lots for safe risk of ~$${maxSafeRisk.toFixed(2)}.`
        );
      } else {
      }

      // ✅ DEFENSIVE VALIDATION: Ensure only valid trade directions reach execution
      if (decision.action !== 'BUY' && decision.action !== 'SELL') {
        logger.error(
          LogCategory.AI_TRADING,
          `🚨 CRITICAL: Invalid trade direction '${decision.action}' reached execution flow. This should never happen!`
        );
        await this.sendAIMessage(
          `⚠️ System Error: Invalid trade direction detected. ` +
          `This has been logged and execution was blocked to protect your account.`
        );
        return;
      }

      const tradeDirection = decision.action.toLowerCase() as 'buy' | 'sell';

      const trade: SimulatedTrade = {
        id: `trade-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        symbol: selectedSymbol,
        timeframe: config.timeframe,
        direction: tradeDirection,
        entryTime: new Date(),
        entryPrice: decision.entry,
        stopLoss: decision.stopLoss,
        takeProfit: adjustedTakeProfit, // ✅ Uses adjusted TP if goal was downshifted
        positionSize: calculatedLotSize,
        confidence: decision.confidence,
        reasoning: decision.reasoning + tradeReasoningAddendum, // Include goal progress context
        triggerType: 'multi_symbol_best_opportunity',
        maxHoldMinutes: 240,
        pnl: 0,
        outcome: 'open'
      };

      // Calculate R:R for proper trade signal with validation
      const rrValidation = calculateAndValidateRR(
        selectedSymbol,
        trade.entryPrice,
        trade.stopLoss,
        trade.takeProfit,
        trade.direction
      );

      const { riskReward, riskPips, rewardPips } = rrValidation;
      // dollarPerPip already used above - calculate fresh for this position size
      const dollarPerPipForProfit = calculateDollarPerPip(selectedSymbol, trade.positionSize);
      const expectedProfit = rewardPips * dollarPerPipForProfit;

      // Log any validation warnings
      if (!rrValidation.validation.isValid) {
        logger.warn(LogCategory.AI_TRADING, `R:R validation warnings for ${selectedSymbol}:`);
        rrValidation.validation.warnings.forEach(w => logger.warn(LogCategory.AI_TRADING, `  - ${w}`));
      }

      // CCIP GOVERNANCE (2026-02-16): Alpha is SOLE AUTHORITY for all TP values.
      // TP1/TP2 are set by Alpha in coordinator-alpha.ts and passed through decision object.
      // The goal session engine does NOT compute or override TP values.
      // decision.tp1Price and decision.tp2Price are Alpha's choices.
      logger.info(
        LogCategory.AI_TRADING,
        `[Alpha TP Authority] ${selectedSymbol}: TP1=${decision.tp1Price ? formatCurrencyPrice(selectedSymbol, decision.tp1Price) : 'N/A'} | TP2=${decision.tp2Price ? formatCurrencyPrice(selectedSymbol, decision.tp2Price) : 'N/A (SCALP)'} | takeProfit=${formatCurrencyPrice(selectedSymbol, decision.takeProfit)}`
      );

      // ✅ SSOT FIX: Create TradeContext before execution
      const tradeContextResult = createTradeContext(selectedSymbol);
      if (!tradeContextResult.success || !tradeContextResult.context) {
        logger.error(LogCategory.AI_TRADING, `[SSOT] Failed to create TradeContext for ${selectedSymbol}: ${tradeContextResult.error}`);
        throw new Error(`TradeContext creation failed: ${tradeContextResult.error}`);
      }
      const tradeContext = tradeContextResult.context;
      logger.info(LogCategory.AI_TRADING, `[SSOT] TradeContext created for ${selectedSymbol} (hash: ${tradeContext.profileHash})`);

      // ✅ SSOT: Execute trade using alphaTradeExecutor (unified execution authority)
      // alphaTradeExecutor provides:
      // - Multi-layer validation (Core + Capacity + Risk + Price + Database)
      // - CCIP-compliant audit logging
      // - Consistent error handling across all execution modes
      const alphaEntryMode = decision.entry_mode;
      const requiresMonitoring =
        alphaEntryMode === 'WAIT_ENTRY' || alphaEntryMode === 'WAIT_HIGHER_EDGE';
      const executionMode = requiresMonitoring ? 'MONITORED' : 'IMMEDIATE';

      logger.info(
        LogCategory.AI_TRADING,
        `[Trade Execution] Alpha entry_mode="${alphaEntryMode ?? 'unset'}" -> mode=${executionMode}`,
        { symbol: selectedSymbol, alphaEntryMode, executionMode }
      );

      const executionResult = await alphaTradeExecutor.execute({
        decision,
        tradeContext,
        userId: config.userId,
        sessionId: activeSession!,
        session: sessionRecord,
        mode: executionMode,
        snapshotTimestamp: new Date(),
        regimeSnapshot: snapshot.regime,
        adversarialState: snapshot.adversarial
      });

      if (executionResult.success) {
        if (executionResult.isMonitoring) {
          logger.info(LogCategory.AI_TRADING, `🎯 Entry monitoring started for ${selectedSymbol}. Waiting for optimal entry conditions.`);

          await this.sendAIMessage(
            `🎯 Setup confirmed! Monitoring ${selectedSymbol} for optimal entry.\n\n` +
            `Entry will execute automatically when conditions align perfectly. ` +
            `I'll keep scanning for other opportunities while monitoring this setup.`
          );

          continue;
        }

        tradeExecuted = true;
        this.tradeExecutedInSession = true;
        // CRITICAL: Update trade ID to match database UUID before tracking
        trade.id = executionResult.tradeId!;
        this.openTrades.push(trade);
        logger.debug(LogCategory.AI_TRADING, `Trade ${this.openTrades.length}/${config.maxConcurrentTrades} added with DB ID: ${trade.id}`);
        logger.info(LogCategory.AI_TRADING, `✅ Trade executed: ${selectedSymbol} ${trade.direction} @ ${trade.entryPrice} (confidence: ${trade.confidence}%)`);
        logger.info(LogCategory.AI_TRADING, 'GOVERNANCE: tradeExecutedInSession=true - no further scanning allowed in this session');

        // Track goal feasibility decision for analytics
        if (downshiftedProposal) {
          try {
            // Ensure retention_percent is within valid range [0, 1]
            const clampedRetention = Math.max(0, Math.min(1, downshiftedProposal.retentionPercent));

            // Handle both DownshiftProposal and ReducedGoalProposal types
            const isDownshiftProposal = 'adjustedGoal' in downshiftedProposal;
            const isReducedGoalProposal = 'reducedGoal' in downshiftedProposal;

            const adjustedGoal = isDownshiftProposal
              ? (downshiftedProposal as any).adjustedGoal
              : isReducedGoalProposal
              ? (downshiftedProposal as any).reducedGoal
              : 0;

            const originalGoal = isDownshiftProposal
              ? (downshiftedProposal as any).originalGoal
              : config.goalAmount;

            const reasonsForDownshift = isDownshiftProposal
              ? (downshiftedProposal as any).reasonsForDownshift
              : isReducedGoalProposal
              ? [(downshiftedProposal as any).reason]
              : ['Unknown downshift reason'];

            const { data, error } = await supabase.from('goal_feasibility_tracking').insert({
              user_id: config.userId,
              session_id: activeSession!,
              trade_id: trade.id,
              original_goal: originalGoal,
              adjusted_goal: adjustedGoal,
              retention_percent: clampedRetention,
              reasons_for_downshift: reasonsForDownshift,
              alpha_affirmed: true,
              market_context: {
                symbol: selectedSymbol,
                currentATR: currentATRValue,
                typicalATR,
                dailyATR,
                spread: snapshot.spread,
                volatilityContext: feasibilityResult.volatilityContext
              }
            });

            if (error) {
              logger.error(LogCategory.AI_TRADING, '❌ Feasibility tracking insert failed:', {
                error,
                errorMessage: error.message,
                errorDetails: error.details,
                errorHint: error.hint,
                proposalData: {
                  original_goal: originalGoal,
                  adjusted_goal: adjustedGoal,
                  retention_percent: clampedRetention,
                  user_id: config.userId,
                  session_id: activeSession,
                  trade_id: trade.id,
                  proposalType: isDownshiftProposal ? 'DownshiftProposal' : 'ReducedGoalProposal'
                }
              });
            } else {
              logger.debug(LogCategory.AI_TRADING, '📊 Feasibility tracking recorded successfully');
            }
          } catch (error) {
            logger.error(LogCategory.AI_TRADING, 'Failed to record feasibility tracking (exception)', { error });
          }
        }

        // Increment trade counter in database
        try {
          const { data: sessionData, error: fetchError } = await supabase
            .from('goal_sessions')
            .select('trades_in_session, multi_trade_enabled')
            .eq('id', activeSession)
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
              .eq('id', activeSession);

            if (updateError) {
              logger.error(LogCategory.AI_TRADING, 'Failed to update trade counter', { updateError });
            } else {
              logger.debug(LogCategory.AI_TRADING, `✅ Trade counter updated: ${newTradeCount} (multi-trade: ${multiTradeEnabled})`);
            }

            // If max trades reached AND multi-trade is DISABLED, just monitor (don't show dialog yet)
            if (this.openTrades.length >= config.maxConcurrentTrades && !multiTradeEnabled) {
              logger.info(LogCategory.AI_TRADING, '🛑 Max trades reached in single-trade mode - monitoring position');

              const entryMessage = `✅ Trade executed successfully!\n\n` +
                `🎯 Position opened: ${selectedSymbol} ${decision.action}\n` +
                `💰 Entry: ${decision.entry.toFixed(5)} | SL: ${decision.stopLoss.toFixed(5)} | TP: ${decision.takeProfit.toFixed(5)}\n` +
                `📊 Expected R:R = ${riskReward.toFixed(2)}:1 ($${expectedProfit.toFixed(2)})\n\n` +
                `👀 Now monitoring this position until it hits TP or SL.\n` +
                `I'll let you know when it closes and we can decide on next steps.`;

              await this.sendAIMessage(entryMessage);

              // Log notification for audit trail
              await this.logNotification(
                'signal',
                `Trade Opened: ${selectedSymbol} ${decision.action}`,
                entryMessage,
                'urgent',
                {
                  trade_id: trade.id,
                  symbol: selectedSymbol,
                  direction: decision.action,
                  entry: decision.entry,
                  stop_loss: decision.stopLoss,
                  take_profit: decision.takeProfit,
                  position_size: trade.positionSize,
                  confidence: decision.confidence,
                  risk_reward: riskReward,
                  expected_profit: expectedProfit
                }
              );

              continue; // Skip summary message for single-trade mode max-reached path
            }
          }
        } catch (error) {
          logger.error(LogCategory.AI_TRADING, 'Error updating trade counter', { error });
        }
      } else {
        // ✅ SSOT: Trade execution blocked by validation layer - log and provide feedback
        const blockReason = executionResult.blockReason || executionResult.error || 'Unknown reason';
        logger.warn(LogCategory.AI_TRADING, `⚠️ Trade execution blocked: ${blockReason}`, {
          symbol: selectedSymbol,
          confidence: decision.confidence,
          action: decision.action,
          reason: blockReason
        });

        // Send user notification about why trade was blocked
        await this.sendAIMessage(
          `⚠️ Trade opportunity on ${selectedSymbol} was blocked:\n\n` +
          `Reason: ${blockReason}\n\n` +
          `Continuing to scan for other opportunities...`
        ).catch(e => {
          logger.warn(LogCategory.AI_TRADING, 'Failed to send execution block notification', { error: e });
        });

        // Continue to next winner on execution failure
        continue;
      }

      const selectionSummary = (allEvaluations || [])
        .slice(0, 3)
        .map((e, i) => {
          const score = e.overallScore ?? 0;
          return `${i + 1}. ${e.symbol} (${typeof score === 'number' ? score.toFixed(1) : '0.0'})`;
        })
        .join('\n');

      // Defensive checks for decision object and numeric fields
      const entry = decision?.entry ?? 0;
      const stopLoss = decision?.stopLoss ?? 0;
      const takeProfit = decision?.takeProfit ?? 0;
      const action = decision?.action ?? 'UNKNOWN';
      const decisionReasoning = decision?.reasoning ?? 'No reasoning available';

      const multiTradeMessage = `🎯 Trade Signal: ${selectedSymbol}\n\n` +
        `Direction: ${action}\n` +
        `Entry: ${typeof entry === 'number' ? entry.toFixed(5) : 'N/A'}\n` +
        `SL: ${typeof stopLoss === 'number' ? stopLoss.toFixed(5) : 'N/A'} | TP: ${typeof takeProfit === 'number' ? takeProfit.toFixed(5) : 'N/A'}\n` +
        `📊 Expected R:R = ${typeof riskReward === 'number' ? riskReward.toFixed(2) : 'N/A'}:1 ($${typeof expectedProfit === 'number' ? expectedProfit.toFixed(2) : 'N/A'})\n` +
        `Confidence: ${decision?.confidence || 0}%\n\n` +
        `Why ${selectedSymbol}?\n${decisionReasoning}\n\n` +
        `Symbol Rankings:\n${selectionSummary}`;

      await this.sendAIMessage(multiTradeMessage);

      // CRITICAL: Also log notification for multi-trade mode (not just single-trade!)
      await this.logNotification(
        'signal',
        `Trade Executed: ${selectedSymbol} ${action}`,
        multiTradeMessage,
        'urgent',
        {
          trade_id: trade.id,
          symbol: selectedSymbol,
          direction: action,
          entry: entry,
          stop_loss: stopLoss,
          take_profit: takeProfit,
          position_size: trade.positionSize,
          confidence: decision?.confidence || 0,
          risk_reward: riskReward,
          expected_profit: expectedProfit
        }
      );

      } // end for (const winner of selectedWinners)

    } catch (error) {
      console.log('%c[MULTI-SYMBOL] ❌ ERROR CAUGHT', 'color: #f44336; font-weight: bold; font-size: 18px');
      console.error('[MULTI-SYMBOL] Error details:', error);
      console.error('[MULTI-SYMBOL] Error stack:', error instanceof Error ? error.stack : 'No stack');

      // ✅ ENHANCED DIAGNOSTICS: Detect common error patterns
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      // Check for specific error patterns
      const isConstraintError = errorMessage.includes('violates check constraint');
      const isReferenceError = errorMessage.includes('is not defined') || errorMessage.includes('Cannot read');
      const isDatabaseError = errorMessage.includes('error code') || errorMessage.includes('PGRST');

      // Build diagnostic context
      const diagnosticContext = {
        errorType: error instanceof Error ? error.constructor.name : 'Unknown',
        errorMessage,
        isConstraintError,
        isReferenceError,
        isDatabaseError,
        symbolsEvaluated: tradeableSnapshots?.length || 0,
        activeSessionId: activeSession,
        timestamp: new Date().toISOString()
      };

      // Log to governance system if critical
      if (isConstraintError || isReferenceError) {
        console.error('[MULTI-SYMBOL] 🚨 CRITICAL ERROR DETECTED - Logging to governance system');
        try {
          await supabase.from('ssot_violations').insert({
            violation_type: isConstraintError ? 'database_constraint_violation' : 'javascript_reference_error',
            severity: 'high',
            system_component: 'goal_session_live_engine',
            details: {
              ...diagnosticContext,
              stack: errorStack,
              errorName: error instanceof Error ? error.name : 'UnknownError'
            },
            user_id: config?.userId || null
          }).catch(govError => {
            console.error('[MULTI-SYMBOL] Failed to log to governance:', govError);
          });
        } catch (govError) {
          // Silent fail - don't break on governance logging
        }
      }

      logger.error(LogCategory.AI_TRADING, 'Multi-symbol cycle error', {
        error,
        diagnostics: diagnosticContext
      });

      // Send error notification to user
      await this.sendAIMessage(`⚠️ Error during market scan: ${error instanceof Error ? error.message : 'Unknown error'}. Will retry on next cycle.`).catch(e => {
        console.error('[MULTI-SYMBOL] Failed to send error message:', e);
      });
    } finally {
    }
    // NOTE: Parent function manages the lock - do not modify it here
  }

  /**
   * Check if there's an active entry intent being monitored
   * If found, the UnifiedEntryMonitor is handling it via setInterval
   * This method just detects its presence and logs monitoring status
   *
   * @returns EntryIntentData if monitoring in progress, null if should proceed with fresh scan
   */
  private async checkAndHandleActiveEntryIntent(): Promise<EntryIntentData | null> {
    if (!this.activeSession) {
      return null;
    }

    try {
      // Check for active entry intent
      const activeIntent = await getActiveEntryIntent(this.activeSession);

      if (!activeIntent) {
        console.log('%c[ENTRY_MONITOR] ✅ No active entry intent found', 'color: #10b981; font-weight: bold');
        return null;
      }

      // Calculate time remaining
      const now = new Date();
      const timeoutAt = new Date(activeIntent.timeout_at);
      const secondsRemaining = Math.max(0, Math.floor((timeoutAt.getTime() - now.getTime()) / 1000));
      const createdAt = new Date((activeIntent as any).created_at || now);
      const secondsElapsed = Math.floor((now.getTime() - createdAt.getTime()) / 1000);

      console.log('%c[ENTRY_MONITOR] 👁️ Active intent detected - monitoring in progress', 'color: #2196f3; font-weight: bold; font-size: 14px');
      console.log('%c[ENTRY_MONITOR] 📊 Intent details:', 'color: #2196f3; font-weight: bold', {
        intentId: activeIntent.id,
        symbol: activeIntent.symbol,
        direction: activeIntent.direction,
        status: (activeIntent as any).status,
        entryZone: `${activeIntent.entry_zone_min.toFixed(5)} - ${activeIntent.entry_zone_max.toFixed(5)}`,
        style: activeIntent.style,
        maxWaitSeconds: activeIntent.max_wait_seconds,
        secondsElapsed,
        secondsRemaining,
        percentComplete: Math.round((secondsElapsed / activeIntent.max_wait_seconds) * 100)
      });

      // Log EQS information if available
      const marketContext = activeIntent.market_context as any;
      if (marketContext?.current_eqs !== undefined) {
        console.log('%c[ENTRY_MONITOR] 📈 EQS tracking:', 'color: #9c27b0; font-weight: bold', {
          currentEQS: marketContext.current_eqs,
          requiredEQS: marketContext.required_eqs || 'N/A',
          confidence: marketContext.confidence || 'N/A'
        });
      }

      logger.info(
        LogCategory.AI_TRADING,
        `[ENTRY_MONITOR] Monitoring ${activeIntent.symbol} ${activeIntent.direction} - ` +
        `${secondsElapsed}s/${activeIntent.max_wait_seconds}s elapsed (${secondsRemaining}s remaining)`
      );

      return activeIntent;
    } catch (error) {
      logger.error(LogCategory.AI_TRADING, '[ENTRY_MONITOR] Error checking active intent:', error);
      console.error('%c[ENTRY_MONITOR] ❌ Error checking intent:', 'color: #f44336; font-weight: bold', error);
      return null;
    }
  }

  /**
   * Main autonomous candle processing logic (Multi-Symbol Mode)
   */
  private async processCandleAutonomous(): Promise<void> {
    let tradeExecuted = false;

    try {
      // 🚨 EMERGENCY DIAGNOSTICS
      if (import.meta.env.DEV) {
        console.log(`[AUTONOMOUS] Cycle: ${this.openTrades.length}/${this.config.maxConcurrentTrades} trades`);
      }

      // 🔍 DEFENSIVE: Log trade array contents for desync detection

      // GOVERNANCE GATE: Check if ANY trade has been executed or closed in this session.
      // If so, scanning is permanently halted. User must start a new session.
      const { count: totalTradesInSession } = await supabase
        .from('goal_session_trades')
        .select('id', { count: 'exact', head: true })
        .eq('goal_session_id', this.activeSession!);

      if (totalTradesInSession && totalTradesInSession > 0) {
        this.tradeExecutedInSession = true;
        logger.info(LogCategory.AI_TRADING, `GOVERNANCE: ${totalTradesInSession} trade(s) found in session - scanning permanently halted. User must start new session.`);
        await this.monitorOpenPositionsOnly();
        return;
      }

      // Sync with database before checking max trades
      const { data: dbPositions, error: dbSyncError } = await supabase
        .from('goal_session_trades')
        .select('id, symbol, direction, entry_price, stop_loss, take_profit, position_size, opened_at, created_at')
        .eq('goal_session_id', this.activeSession!)
        .eq('status', 'open');

      if (!dbSyncError && dbPositions) {
        const dbCount = dbPositions.length;
        const memoryCount = this.openTrades.length;

        console.log('%c[AUTONOMOUS ENGINE] 📊 Position counts:', 'color: #9c27b0; font-weight: bold', {
          database: dbCount,
          memory: memoryCount,
          match: dbCount === memoryCount
        });

        // If database has more positions than memory, we have desync!
        if (dbCount > memoryCount) {
          console.error('%c[AUTONOMOUS ENGINE] 🚨 MEMORY DESYNC!', 'color: #f44336; font-weight: bold; font-size: 16px');
          console.error(`[AUTONOMOUS ENGINE] Database has ${dbCount} positions but memory has ${memoryCount}. Resyncing...`);

          // Reconstruct missing trades
          const memoryTradeIds = new Set(this.openTrades.map(t => t.id));
          const missingPositions = dbPositions.filter(p => !memoryTradeIds.has(p.id));

          for (const pos of missingPositions) {
            this.openTrades.push({
              id: pos.id,
              symbol: pos.symbol,
              direction: pos.direction as 'buy' | 'sell',
              entryPrice: pos.entry_price,
              entryTime: new Date(pos.opened_at || pos.created_at),
              stopLoss: pos.stop_loss,
              takeProfit: pos.take_profit,
              positionSize: pos.position_size,
              outcome: 'open' as const,
              confidence: 0,
              reasoning: 'Resynced from database',
              triggerType: 'resync',
              maxHoldMinutes: 240,
              pnl: 0
            });
          }

          console.log('%c[AUTONOMOUS ENGINE] ✅ Resynced ' + missingPositions.length + ' missing positions',
            'color: #4caf50; font-weight: bold');
        }
      }

      // STOP SCANNING if max trades reached (saves tokens/credits)
      // 🚨 CRITICAL: Always verify with database before scanning (prevents desync bugs)
      // 🔒 USER ISOLATION: Query filters by goal_session_id, which is unique per user
      //    RLS policies ensure users can only see their own session's trades
      // ✅ FIX: Reuse dbPositions array already fetched above (lines 819-823)
      //    The duplicate query with { count: 'exact', head: true } was buggy and always returned 0
      const dbOpenTradeCount = dbPositions ? dbPositions.length : 0;
      const memoryOpenTradeCount = this.openTrades.length;

      // 🔍 AUDIT: Log user_id for verification that sessions are isolated
      console.log('%c[AUTONOMOUS ENGINE] 🔐 Scan authorization check:', 'color: #ff9800; font-weight: bold', {
        userId: this.config.userId,
        sessionId: this.activeSession,
        memoryTrades: memoryOpenTradeCount,
        dbTrades: dbOpenTradeCount,
        maxAllowed: this.config.maxConcurrentTrades,
        scanAllowed: dbOpenTradeCount < this.config.maxConcurrentTrades
      });

      // Use DB count as source of truth (memory can desync)
      if (dbOpenTradeCount >= this.config.maxConcurrentTrades) {
        // CRITICAL: Verify these are actual valid open positions, not stale records
        const validOpenPositions = dbPositions?.filter(p =>
          p.entry_price > 0 &&
          p.stop_loss > 0 &&
          p.take_profit > 0 &&
          p.position_size > 0
        ) || [];

        const validOpenCount = validOpenPositions.length;

        if (validOpenCount === 0 && dbOpenTradeCount > 0) {
          console.error('%c[AUTONOMOUS ENGINE] 🚨 STALE DATABASE RECORDS DETECTED!', 'color: #f44336; font-weight: bold; font-size: 16px');
          console.error(`[AUTONOMOUS ENGINE] Database shows ${dbOpenTradeCount} "open" trades but 0 are valid. This is a data integrity issue!`);
          console.log('%c[AUTONOMOUS ENGINE] ✅ Allowing scan to continue (no valid open positions)', 'color: #4caf50; font-weight: bold');
        } else if (validOpenCount < this.config.maxConcurrentTrades) {
          console.warn('%c[AUTONOMOUS ENGINE] ⚠️ Some database records are invalid', 'color: #ff9800; font-weight: bold');
          console.log(`[AUTONOMOUS ENGINE] ${validOpenCount} valid positions out of ${dbOpenTradeCount} total - allowing scan`);
        } else {
          logger.debug(LogCategory.AI_TRADING, `⏸️ Max trades (${this.config.maxConcurrentTrades}) reached - PAUSING scanning to save credits`);
          console.log('%c[AUTONOMOUS ENGINE] ⏸️ SCAN BLOCKED: DB confirms max trades reached', 'color: #f44336; font-weight: bold');
          // Still monitor open positions but don't scan for new trades
          await this.monitorOpenPositionsOnly();
          return;
        }
      }

      const watchlist = this.config.watchlist || getDefaultWatchlist();
      const useMultiSymbolMode = watchlist.length > 1;


      if (useMultiSymbolMode) {
        // Double-check before expensive multi-symbol scan (use DB count as already verified above)
        if (dbOpenTradeCount >= this.config.maxConcurrentTrades) {
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

      // 🔐 SINGLE-SYMBOL MODE: Check max trades BEFORE expensive operations
      // Uses same DB count as multi-symbol mode for consistency
      if (dbOpenTradeCount >= this.config.maxConcurrentTrades) {
        logger.debug(LogCategory.AI_TRADING, `⏸️ Max trades (${this.config.maxConcurrentTrades}) reached - PAUSING scanning to save credits`);
        console.log('%c[AUTONOMOUS ENGINE] ⏸️ SCAN BLOCKED: Max trades reached (single-symbol mode)', 'color: #f44336; font-weight: bold');
        // Still monitor open positions but don't scan for new trades
        await this.monitorOpenPositionsOnly();
        return;
      }

      // ✅ PHASE 2: Use MarketDataService as SSOT
      const marketDataService = MarketDataService.getInstance();
      const candles = await marketDataService.getCandles(symbol, dbTimeframe, 300);

      if (!candles || candles.length < 50) {
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
      // 🛡️ CRITICAL: Log current price vs SL/TP before updating
      for (const trade of this.openTrades) {
        if (trade.outcome === 'open') {
          const currentPrice = latestCandle.close;
          const isBuy = trade.direction === 'buy';

          console.log(`[SL/TP CHECK] ${trade.symbol} ${trade.direction.toUpperCase()}:`);
          console.log(`  Current: ${currentPrice.toFixed(5)}`);
          console.log(`  Entry: ${trade.entryPrice.toFixed(5)}`);
          console.log(`  SL: ${trade.stopLoss.toFixed(5)}`);
          console.log(`  TP: ${trade.takeProfit.toFixed(5)}`);

          // Check if SL or TP hit
          const slHit = isBuy ? currentPrice <= trade.stopLoss : currentPrice >= trade.stopLoss;
          const tpHit = isBuy ? currentPrice >= trade.takeProfit : currentPrice <= trade.takeProfit;

          if (slHit) {
            console.warn(`%c⚠️ STOP LOSS HIT! Price: ${currentPrice.toFixed(5)} vs SL: ${trade.stopLoss.toFixed(5)}`, 'color: #ff9800; font-weight: bold');
          }
          if (tpHit) {
            console.log(`%c✅ TAKE PROFIT HIT! Price: ${currentPrice.toFixed(5)} vs TP: ${trade.takeProfit.toFixed(5)}`, 'color: #4caf50; font-weight: bold');
          }
        }
      }

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

      const { data: goalSession, error: goalSessionError } = await supabase
        .from('goal_sessions')
        .select('*')
        .eq('id', this.activeSession)
        .single();

      if (goalSessionError || !goalSession) {
        logger.error(LogCategory.AI_TRADING, '[Autonomous Engine] Failed to load goal session — blocking all trade execution', {
          error: goalSessionError,
          sessionId: this.activeSession,
        });
        return;
      }

      if (!goalSession.target_value || !Number.isFinite(goalSession.target_value) || goalSession.target_value <= 0) {
        logger.error(LogCategory.AI_TRADING, '[Autonomous Engine] Goal session has no valid target_value — blocking trade execution', {
          sessionId: this.activeSession,
          targetValue: goalSession.target_value,
        });
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
        tradeStyle: this.config.tradeStyle,
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
        logger.debug(LogCategory.AI_TRADING, `🎯 Trade decision: ${result.trade.direction} @ ${result.trade.entryPrice}`);
        logger.debug(LogCategory.AI_TRADING, `SL: ${result.trade.stopLoss} | TP: ${result.trade.takeProfit} | R:R 1:${((result.trade.takeProfit - result.trade.entryPrice) / (result.trade.entryPrice - result.trade.stopLoss)).toFixed(2)}`);

        tradeExecuted = await this.handleNewTradeSignal(result.trade, goalSession, sortedCandles);

        if (tradeExecuted) {
          console.log(`[AUTONOMOUS ENGINE] ✅ Trade successfully executed - system will manage appropriately`);
        } else {
          console.log(`[AUTONOMOUS ENGINE] ⚠️ Trade rejected by validation - continuing to scan for next opportunity`);
        }
      }

      if (!result.trade && !result.trigger && this.openTrades.length === 0) {
        logger.info(LogCategory.AI_TRADING, `Single-symbol scan complete for ${symbol} - no qualifying trade found. Showing no-trade dialog.`);
        await this.sendAIMessage(`Scanned ${symbol} - no qualifying trade setup found in current market conditions. Try again in 15 minutes or choose a different trade style.`);
        this.emitNoTradeEvent();
        return;
      }

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
   * Handle new trade signal - SSOT-compliant execution via alphaTradeExecutor
   *
   * Routes SimulatedTrade (from eventBasedLLMEngine) through the unified trade execution authority.
   * Maps autonomous engine trade to AlphaDecision contract and executes through validation pipeline.
   *
   * SSOT Authority: alphaTradeExecutor is the sole entry point for all trade creation
   * CCIP Compliance: Registered as trade execution refactor (20260203)
   * Governance: All validation layers maintained (Core + Risk + Capacity + Price)
   *
   * @param trade - SimulatedTrade from eventBasedLLMEngine analysis
   * @param goalSession - goal_sessions record for context
   * @param candles - Historical candles for market context
   * @returns true if trade was successfully executed, false if rejected by validation
   */
  private async handleNewTradeSignal(
    trade: SimulatedTrade,
    goalSession: any,
    candles: any[]
  ): Promise<boolean> {
    try {
      logger.info(
        LogCategory.AI_TRADING,
        '[Trade Execution] SSOT: Routing through alphaTradeExecutor',
        {
          symbol: trade.symbol,
          direction: trade.direction,
          confidence: trade.confidence,
          entryPrice: trade.entryPrice,
          source: 'eventBasedLLMEngine (autonomous)',
          executionAuthority: 'alphaTradeExecutor'
        }
      );

      // ✅ SSOT: Build AlphaDecision from SimulatedTrade
      // This adapts autonomous engine's trade signal to unified execution contract
      const alphaDecision = {
        action: (trade.direction === 'buy' ? 'BUY' : 'SELL') as 'BUY' | 'SELL',
        decision: (trade.direction === 'buy' ? 'BUY' : 'SELL') as 'BUY' | 'SELL',
        entry: trade.entryPrice,
        stopLoss: trade.stopLoss,
        takeProfit: trade.takeProfit,
        tp2Price: trade.takeProfit,
        confidence: trade.confidence,
        reasoning: trade.reasoning,
        omega_summary: `Autonomous: ${trade.triggerType} (${trade.confidence}% confidence)`,
        symbol: trade.symbol,
        timestamp: new Date(),
        regime_advisory: trade.regimeSnapshot,
        adversarial_advisory: trade.adversarialSignal
      };

      // ✅ SSOT: Build TradeContext from market data
      const tradeContext = createTradeContext(
        trade.symbol,
        trade.direction === 'buy' ? 'buy' : 'sell',
        trade.entryPrice,
        trade.stopLoss,
        trade.takeProfit,
        {
          pipValue: calculateDollarPerPip(trade.symbol),
          slDistance: calculatePipDistance(
            trade.symbol,
            trade.entryPrice,
            trade.stopLoss
          ),
          tpDistance: calculatePipDistance(
            trade.symbol,
            trade.entryPrice,
            trade.takeProfit
          )
        }
      );

      // ✅ GOVERNANCE: Ensure we have valid session record
      if (!goalSession || !this.activeSession) {
        logger.error(
          LogCategory.AI_TRADING,
          '[Trade Execution] BLOCKED: Invalid session context',
          {
            symbol: trade.symbol,
            hasGoalSession: !!goalSession,
            hasActiveSession: !!this.activeSession,
            severity: 'CRITICAL'
          }
        );
        return false;
      }

      // ✅ CCIP: SSOT - Execute through unified authority (alphaTradeExecutor)
      // All validation layers run through this single point of entry
      const alphaEntryMode2 = alphaDecision.entry_mode;
      const requiresMonitoring2 =
        alphaEntryMode2 === 'WAIT_ENTRY' || alphaEntryMode2 === 'WAIT_HIGHER_EDGE';
      const executionMode2 = requiresMonitoring2 ? 'MONITORED' : 'IMMEDIATE';

      logger.info(
        LogCategory.AI_TRADING,
        `[Trade Execution] Alpha entry_mode="${alphaEntryMode2 ?? 'unset'}" -> mode=${executionMode2}`,
        { symbol: trade.symbol, alphaEntryMode: alphaEntryMode2, executionMode: executionMode2 }
      );

      const executionResult = await alphaTradeExecutor.execute({
        decision: alphaDecision,
        tradeContext,
        userId: this.config.userId,
        sessionId: this.activeSession,
        session: goalSession,
        mode: executionMode2,
        snapshotTimestamp: new Date(),
        regimeSnapshot: trade.regimeSnapshot,
        adversarialState: trade.adversarialSignal
      });

      if (executionResult.success) {
        logger.info(
          LogCategory.AI_TRADING,
          '[Trade Execution] ✅ SUCCESS - Trade created via alphaTradeExecutor',
          {
            tradeId: executionResult.tradeId,
            symbol: trade.symbol,
            direction: trade.direction,
            entryPrice: trade.entryPrice,
            stopLoss: trade.stopLoss,
            takeProfit: trade.takeProfit,
            confidence: trade.confidence,
            isMonitoring: executionResult.isMonitoring
          }
        );

        // Add to memory state for immediate access
        const dbTradeRecord: SimulatedTrade = {
          ...trade,
          id: executionResult.tradeId || trade.id,
          outcome: 'open'
        };
        this.openTrades.push(dbTradeRecord);

        return true;
      } else {
        logger.warn(
          LogCategory.AI_TRADING,
          '[Trade Execution] ❌ REJECTED - Validation failed',
          {
            symbol: trade.symbol,
            direction: trade.direction,
            confidence: trade.confidence,
            blockReason: executionResult.blockReason,
            error: executionResult.error,
            confidence_vs_threshold: `${trade.confidence}% vs ${getMinConfidenceThreshold(
              this.config.riskMode
            )}%`
          }
        );

        return false;
      }
    } catch (error) {
      logger.error(
        LogCategory.AI_TRADING,
        '[Trade Execution] 🔥 CRITICAL ERROR - Execution fault',
        {
          symbol: trade.symbol,
          direction: trade.direction,
          confidence: trade.confidence,
          error,
          source: 'handleNewTradeSignal'
        }
      );

      // Safety: Never silently fail - log and return false to allow continued scanning
      return false;
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
      // Removed continuation prompt system (2026-01-30) - no longer pauses for user confirmation
      // Update trade counter only
      await supabase
        .from('goal_sessions')
        .update({
          last_trade_id: tradeId,
          trades_in_session: (session.trades_in_session || 0) + 1
        })
        .eq('id', this.activeSession);

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
   * Called when user decides to continue or stop after a trade closes
   */
  async handleUserContinuationResponse(
    response: 'continue' | 'stop'
  ): Promise<{ success: boolean; message: string }> {
    if (!this.activeSession || !this.config) {
      return {
        success: false,
        message: 'No active session'
      };
    }

    try {
      switch (response) {
        case 'continue': {
          const { goalSessionStateMachine: sm } = await import('./coordinators/goal-session-state-machine');
          await sm.transition(this.activeSession!, 'scanning', {
            reason: 'User chose to continue - resuming scan',
            triggeredBy: 'goal-session-live-engine',
          });

          logger.info(LogCategory.AI_TRADING, '✅ User chose to continue - resuming scan');

          try {
            await SystemTableRPCWrapper.createGoalAIConversation(
              this.config.userId,
              this.activeSession!,
              'ai',
              '✅ Resuming scan for next opportunity... I\'ll monitor your open position and look for another high-quality setup.',
              0,
              'gpt-4',
              { sentiment: 'encouraging' }
            );
          } catch (error) {
            console.error('[Goal Live Engine] Failed to log continuation response:', error);
          }

          return {
            success: true,
            message: 'Scanning resumed'
          };
        }

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

    /**
     * SSOT ENFORCEMENT: PNL calculation handled by RPC
     *
     * REMOVED: Client-side PNL recalculation logic (2026-02-11)
     * The close_goal_session_trade RPC is the SINGLE SOURCE OF TRUTH for PNL.
     * It uses calculate_pnl_universal() which is the canonical formula.
     *
     * Previous bug: Client calculated PNL here, which could differ from server.
     * This caused 10,000x errors and balance discrepancies.
     *
     * Trade object PNL is only used for display purposes below.
     * The authoritative PNL comes from the RPC response.
     */
    const finalPnL = trade.pnl;

    // 🔍 USER ISOLATION AUDIT: Log user_id to verify trades are per-user
    logger.info(LogCategory.AI_TRADING,
      `Trade closing: ${trade.outcome.toUpperCase()} - Estimated PNL: $${finalPnL.toFixed(2)} | ` +
      `User: ${this.config.userId.substring(0, 8)} | Session: ${this.activeSession.substring(0, 8)}`
    );

    // CRITICAL: Update trader score via autonomous brain
    await eventBasedLLMEngine.onTradeClose(trade);

    // Clear mid-trade triggers for this trade
    midTradeTriggerDetector.clearTriggers(trade.id);

    localSessionMemory.recordTradeClosure(`live-${this.activeSession}`, trade);

    /**
     * SSOT ENFORCEMENT: Use close_goal_session_trade RPC
     *
     * CRITICAL FIX (2026-02-11): Previously used direct database UPDATE
     * This caused multiple bugs:
     * 1. Balance was NOT updated (user lost profit)
     * 2. PNL calculation was incorrect (10,000x error)
     * 3. No trade_closure_events created (missing audit trail)
     * 4. Violated SSOT principle (multiple closure paths)
     *
     * The RPC ensures:
     * - Correct PNL calculation via calculate_pnl_universal()
     * - Atomic balance update
     * - Trade closure event creation
     * - CCIP governance tracking
     * - Single source of truth
     */
    const { data: closureResult, error } = await supabase.rpc('close_goal_session_trade', {
      p_trade_id: trade.id,
      p_close_price: trade.exitPrice!,
      p_close_reason: trade.outcome === 'win' ? 'take_profit' : 'stop_loss',
      p_goal_session_id: this.activeSession,
      p_force_close: false,
      p_closed_at: trade.exitTime?.toISOString() || new Date().toISOString()
    });

    if (error) {
      console.error('[Goal Live Engine] ❌ Error closing trade via RPC:', error);
      logger.error(LogCategory.AI_TRADING, 'Trade closure RPC failed', {
        tradeId: trade.id,
        error: error.message
      });

      // Log governance violation
      console.error('[Goal Live Engine] 🚨 SSOT VIOLATION: RPC closure failed, trade may be in inconsistent state');
    } else {
      logger.info(LogCategory.AI_TRADING,
        `✅ Trade closed via SSOT RPC | PNL: $${closureResult.profit_loss} | Balance: $${closureResult.balance_after}`
      );
    }

    // CRITICAL FIX: Write journal entry for this trade closure
    try {
      await postTradeAnalyzer.analyzeClosedTrade({
        id: trade.id,
        userId: this.config!.userId,
        symbol: trade.symbol,
        direction: trade.direction,
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice!,
        stopLoss: trade.stopLoss,
        takeProfit: trade.takeProfit,
        pnl: finalPnL,
        entryTime: trade.entryTime,
        exitTime: trade.exitTime!
      });
      logger.info(LogCategory.AI_TRADING, `✅ Journal entry created for trade ${trade.id}`);
    } catch (journalError) {
      console.error('[Goal Live Engine] Failed to create journal entry:', journalError);
      logger.error(LogCategory.AI_TRADING, 'Journal entry creation failed', { journalError });
    }

    // Calculate trade duration
    const tradeDuration = Math.floor((trade.exitTime!.getTime() - trade.entryTime.getTime()) / 60000);
    const durationText = tradeDuration < 60
      ? `${tradeDuration}m`
      : `${Math.floor(tradeDuration / 60)}h ${tradeDuration % 60}m`;

    // Calculate pips using symbol-specific pip value
    const pipInfo = getCurrencyPipInfo(trade.symbol);
    const isLong = trade.direction === 'buy';
    const priceDiff = isLong
      ? (trade.exitPrice! - trade.entryPrice)
      : (trade.entryPrice - trade.exitPrice!);
    const pips = priceDiff / pipInfo.pipValue;
    const pointsLabel = pipInfo.symbolType === 'index' ? 'points' : 'pips';

    // Determine exit reason and emoji
    const isWin = trade.outcome === 'win';
    const emoji = isWin ? '✅' : '❌';
    const exitReason = trade.exitReason || (isWin ? 'Take profit hit' : 'Stop loss hit');

    // Send trade closure message with proper decimal formatting
    const closureMessage = `${emoji} Trade Closed: ${trade.symbol} ${trade.direction.toUpperCase()}\n` +
      `📊 Exit: ${formatCurrencyPrice(trade.symbol, trade.exitPrice!)} | Reason: ${exitReason}\n` +
      `⏱️ Duration: ${durationText}\n` +
      `💰 P&L: ${finalPnL >= 0 ? '+' : ''}$${finalPnL.toFixed(2)} (${pips >= 0 ? '+' : ''}${pips.toFixed(1)} ${pointsLabel})`;

    try {
      await SystemTableRPCWrapper.createGoalAIConversation(
        this.config!.userId,
        this.activeSession!,
        'ai',
        closureMessage,
        0,
        'gpt-4',
        {
          context: {
            trade_id: trade.id,
            outcome: trade.outcome,
            duration_minutes: tradeDuration,
            entry_price: trade.entryPrice,
            exit_price: trade.exitPrice,
            pnl: finalPnL,
            pips,
            duration: durationText,
            exit_reason: exitReason
          },
          sentiment: isWin ? 'encouraging' : 'educational'
        }
      );

      // Log notification for audit trail
      await this.logNotification(
        trade.outcome === 'win' ? 'completion' : 'alert',
        `Trade Closed: ${isWin ? 'WIN' : 'LOSS'}`,
        closureMessage,
        trade.outcome === 'loss' ? 'urgent' : 'medium',
        {
          trade_id: trade.id,
          symbol: trade.symbol,
          direction: trade.direction,
          outcome: trade.outcome,
          entry_price: trade.entryPrice,
          exit_price: trade.exitPrice,
          pnl: trade.pnl,
          pips,
          duration_minutes: tradeDuration,
          exit_reason: exitReason
        }
      );
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
        `📊 Session Stats: ${stats.totalTrades} trades | ${stats.winningTrades} wins | ${((stats.winningTrades / stats.totalTrades) * 100).toFixed(0)}% win rate`;

      try {
        await SystemTableRPCWrapper.createGoalAIConversation(
          this.config!.userId,
          this.activeSession!,
          'ai',
          llmAnalysis + progressMessage,
          0,
          'gpt-4',
          {
            context: {
              stats,
              trade_id: trade.id,
              llm_analysis: true,
              total_pnl: stats.totalPnL,
              win_rate: (stats.winningTrades / stats.totalTrades) * 100,
              total_trades: stats.totalTrades
            },
            sentiment: 'neutral'
          }
        );
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

      // GOVERNANCE (2026-02-18): Even multi-trade mode stops after trade closure.
      // No auto-scanning is permitted after any trade closes.
      // User must explicitly start a new session to scan again.

      // Check if goal is met
      const currentProgress = session.current_progress || 0;
      const targetValue = session.target_value || 0;
      const goalMet = currentProgress >= targetValue;

      if (goalMet) {
        // Goal achieved! Celebrate and close session
        logger.info(LogCategory.AI_TRADING, '🎉 GOAL ACHIEVED! Stopping session');

        const { goalSessionStateMachine: gsm } = await import('./coordinators/goal-session-state-machine');
        await gsm.transition(this.activeSession!, 'goal_achieved', {
          reason: 'Goal target reached',
          triggeredBy: 'goal-session-live-engine',
        });

        // Calculate session stats for celebration message
        const stats = localSessionMemory.getSessionStatistics(`live-${this.activeSession}`);
        const duration = stats ? Math.floor((Date.now() - Date.parse(stats.startTime)) / 60000) : 0;
        const durationText = duration < 60
          ? `${duration} minutes`
          : `${Math.floor(duration / 60)}h ${duration % 60}m`;

        await this.sendAIMessage(
          `🎉 🎯 🎉 GOAL ACHIEVED! 🎉 🎯 🎉\n\n` +
          `✨ Congratulations! You've successfully reached your goal!\n\n` +
          `💰 Target: $${targetValue.toFixed(2)}\n` +
          `✅ Achieved: $${currentProgress.toFixed(2)}\n` +
          `📊 Total Trades: ${stats?.totalTrades || 0}\n` +
          `🎯 Win Rate: ${stats ? ((stats.winningTrades / stats.totalTrades) * 100).toFixed(0) : 0}%\n` +
          `⏱️ Duration: ${durationText}\n\n` +
          `🏆 This achievement has been logged in your records!\n` +
          `💪 Session complete - great trading!`
        );

        // Stop the session
        this.stopSession();
        return;
      }

      // GOVERNANCE (2026-02-18): After trade closure, session MUST stop.
      // Scanning can only be re-initiated by user starting a new session.
      // This prevents unauthorized auto-trading after SL/TP/manual close.
      const remainingAmount = targetValue - currentProgress;
      const isWin = trade.outcome === 'win';
      const outcome = isWin ? 'WIN' : 'LOSS';
      const emoji = isWin ? '✅' : '❌';

      logger.info(LogCategory.AI_TRADING, `GOVERNANCE: Trade closed (${outcome}). Stopping session - user must start new session to scan again.`);

      await this.sendAIMessage(
        `${emoji} Trade closed: ${trade.symbol} ${trade.direction?.toUpperCase() || ''}\n\n` +
        `💰 P&L: ${trade.pnl >= 0 ? '+' : ''}$${trade.pnl.toFixed(2)}\n` +
        `📊 Progress: $${currentProgress.toFixed(2)} / $${targetValue.toFixed(2)}\n` +
        `🎯 Remaining: $${remainingAmount.toFixed(2)} to goal\n\n` +
        `Session complete. Start a new session when you're ready to trade again.`
      );

      const { goalSessionStateMachine: gsm } = await import('./coordinators/goal-session-state-machine');
      await gsm.transition(this.activeSession!, 'stopped', {
        reason: `Trade closed (${trade.outcome}) - session auto-stopped per governance policy`,
        triggeredBy: 'goal-session-live-engine:checkContinuationAfterTradeClose',
      });

      this.stopSession();

    } catch (error) {
      console.error('[Goal Live Engine] Error checking continuation after trade close:', error);
      logger.error(LogCategory.AI_TRADING, 'Error in checkContinuationAfterTradeClose', { error });
    }
  }

  /**
   * Force-close all open positions via RPC.
   * GOVERNANCE (2026-02-18): When session stops, ALL trades must close immediately.
   * Uses close_goal_session_trade RPC as SSOT -- does NOT depend on LLM outcome state.
   */
  private async closeAllPositions(reason: string): Promise<void> {
    if (!this.config || !this.activeSession) {
      return;
    }

    const sessionId = this.activeSession;

    const { data: dbOpenTrades } = await supabase
      .from('goal_session_trades')
      .select('id, symbol, current_price, entry_price')
      .eq('goal_session_id', sessionId)
      .eq('status', 'open');

    if (!dbOpenTrades || dbOpenTrades.length === 0) {
      this.openTrades = [];
      return;
    }

    for (const dbTrade of dbOpenTrades) {
      try {
        let closePrice = dbTrade.current_price;

        if (!closePrice) {
          const { data: priceData } = await supabase
            .from('realtime_prices')
            .select('bid')
            .eq('symbol', dbTrade.symbol)
            .order('timestamp', { ascending: false })
            .limit(1)
            .maybeSingle();

          closePrice = priceData?.bid || dbTrade.entry_price;
        }

        await supabase.rpc('close_goal_session_trade', {
          p_trade_id: dbTrade.id,
          p_close_price: closePrice,
          p_close_reason: 'session_ended',
          p_goal_session_id: sessionId,
          p_force_close: true,
          p_closed_at: new Date().toISOString()
        });
      } catch (err) {
        logger.error(LogCategory.AI_TRADING, `Failed to force-close trade ${dbTrade.id}`, { error: err });
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
        await SystemTableRPCWrapper.createGoalAIConversation(
          this.config!.userId,
          this.activeSession!,
          'ai',
          learningSummary,
          0,
          'gpt-4',
          {
            context: {
              ...summary.statistics,
              learningInsights,
              sessionType: 'live_goal_mode'
            },
            sentiment: stats.totalPnL > 0 ? 'celebratory' : 'educational'
          }
        );
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
      await SystemTableRPCWrapper.createGoalAIConversation(
        this.config.userId,
        this.activeSession!,
        'ai',
        message,
        0,
        'gpt-4',
        {
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
        }
      );

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
      await SystemTableRPCWrapper.createGoalAIConversation(
        this.config.userId,
        this.activeSession!,
        'ai',
        message,
        0,
        'gpt-4',
        {
          context: {
            scanCount: this.scanCount,
            hasOpenTrades: this.openTrades.length > 0,
            price,
            symbol: this.config.symbol,
            time,
            trigger: trigger?.type || null
          },
          sentiment: trigger ? 'encouraging' : 'neutral'
        }
      );
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
    let totalConfidence = 0;
    let confidenceCount = 0;
    let weakConsensusCount = 0;
    let lowAtrCount = 0;

    for (const [symbol, snapshot] of snapshots) {
      if (!snapshot.tradeable) {
        blockedCount++;
        const reason = snapshot.blockReason || 'Unknown';
        parts.push(`${symbol}: BLOCKED - ${reason}`);

        if (snapshot.adversarial && snapshot.adversarial.stop_run_classification) {
          const stopRun = snapshot.adversarial.stop_run_classification;
          if (stopRun.type !== 'none') {
            parts.push(`   -> ${stopRun.reasoning}`);
          }
        }
        continue;
      }

      const decision = decisions.get(symbol);
      if (!decision || decision.action === 'NO_TRADE') {
        noTradeCount++;

        if (decision) {
          const conf = decision.confidence || 0;
          totalConfidence += conf;
          confidenceCount++;

          const atrVal = typeof snapshot.atr === 'number' ? snapshot.atr : (snapshot.atr as any)?.value ?? 0;
          if (atrVal > 0 && atrVal < 0.0004) lowAtrCount++;

          if (decision.omega_votes) {
            const votes = decision.omega_votes;
            const buyVotes = [votes.trend, votes.scalper, votes.reversal, votes.volatility, votes.omega8]
              .filter(v => v?.vote === 'BUY').length;
            const sellVotes = [votes.trend, votes.scalper, votes.reversal, votes.volatility, votes.omega8]
              .filter(v => v?.vote === 'SELL').length;

            if (Math.abs(buyVotes - sellVotes) <= 1) weakConsensusCount++;

            const councilSummary = buyVotes > 0 || sellVotes > 0
              ? ` [Council: ${buyVotes}B/${sellVotes}S]`
              : '';
            const reasoning = decision.reasoning
              ? ` — ${decision.reasoning.substring(0, 120)}${decision.reasoning.length > 120 ? '...' : ''}`
              : '';
            parts.push(`${symbol}: Alpha ${conf}%${councilSummary}${reasoning}`);

            if (votes.risk && votes.risk.confidence < 30) {
              parts.push(`   -> Risk signal weak (${votes.risk.confidence}%): ${votes.risk.reasoning}`);
            }
          } else {
            const reasoning = decision.reasoning
              ? ` — ${decision.reasoning.substring(0, 120)}${decision.reasoning.length > 120 ? '...' : ''}`
              : '';
            parts.push(`${symbol}: Alpha ${conf}%${reasoning}`);
          }
        } else {
          parts.push(`${symbol}: No decision returned`);
        }
      }
    }

    parts.push('');

    if (blockedCount + noTradeCount === evaluated.length) {
      const avgConf = confidenceCount > 0 ? Math.round(totalConfidence / confidenceCount) : 0;
      const currentHour = new Date().getUTCHours();
      const isAsianSession = currentHour >= 0 && currentHour < 8;
      const isPreLondon = currentHour >= 6 && currentHour < 8;

      if (blockedCount === evaluated.length) {
        parts.push('All pairs blocked by data quality or adversarial checks. System will retry when clean price data is available.');
      } else if (lowAtrCount >= Math.ceil(confidenceCount * 0.6)) {
        parts.push(`Low volatility environment detected across ${lowAtrCount}/${confidenceCount} pairs. Alpha requires sufficient ATR to place valid SL/TP levels. Setups typically emerge during session opens or volatility spikes.`);
      } else if (weakConsensusCount >= Math.ceil(confidenceCount * 0.5)) {
        parts.push(`Omega Council shows divided signals on most pairs (${weakConsensusCount}/${confidenceCount} with split direction votes). Alpha declines to trade without directional clarity. Market may be in a consolidation phase.`);
      } else if (isAsianSession && !isPreLondon) {
        parts.push(`Asian session is typically range-bound with lower follow-through. Average confidence this cycle: ${avgConf}%. London open (08:00 UTC) often produces the clearest structural setups.`);
      } else if (avgConf > 0 && avgConf < 50) {
        parts.push(`Average Alpha confidence across all pairs: ${avgConf}% — below execution threshold. No single pair showed sufficient directional conviction. Continuing to monitor for setup development.`);
      } else {
        parts.push('No high-quality setups found across all pairs. System will scan again next cycle.');
      }
    }

    return parts.join('\n');
  }

  private buildRejectionContext(
    omegaDecisions: Map<string, any>,
    _snapshots: SymbolSnapshot[]
  ): NoTradeRejectionContext {
    const currentStyle = this.config?.tradeStyle?.toUpperCase() || 'SCALP';
    let hasWeakConsensus = false;
    const symbolReasons: { symbol: string; action: string; reasoning: string; confidence: number }[] = [];

    for (const [symbol, decision] of omegaDecisions) {
      const reasoning = (decision?.reasoning || '').toLowerCase();

      if (reasoning.includes('conflict') || reasoning.includes('disagree') || reasoning.includes('weak consensus')) {
        hasWeakConsensus = true;
      }

      if (decision) {
        const rawReasoning: string = decision.reasoning || decision.marketThesis || 'No details available';
        const truncated = rawReasoning.length > 500 ? rawReasoning.substring(0, 500).trim() + '...' : rawReasoning;
        symbolReasons.push({
          symbol,
          action: decision.action || 'NO_TRADE',
          reasoning: truncated,
          confidence: decision.confidence || decision.trade_confidence || 0,
        });
      }
    }

    symbolReasons.sort((a, b) => b.confidence - a.confidence);

    // CCIP (2026-02-17): Constraint sandwich is no longer a blocker.
    // Envelope bounds define style walls. Noise floor is advisory intelligence.
    // No symbols are "sandwiched" -- all styles are always viable.
    return {
      currentStyle,
      constraintSandwichSymbols: [],
      suggestedStyles: [],
      hasWeakConsensus,
      symbolReasons,
    };
  }

  private emitNoTradeEvent(rejectionContext?: NoTradeRejectionContext): void {
    this.scanCompleteNoTrade = true;
    this.stopPolling();
    logger.info(LogCategory.AI_TRADING, 'Full scan complete - no executable trades found. Polling halted.');

    // SSOT FIX (CCIP 2026-02-25): The database is the authoritative source of truth for
    // session state. Previously only no_trade_found_at was written and a browser event
    // was dispatched. If the event was missed (tab backgrounded, component unmounted),
    // the session stayed in 'scanning' status indefinitely — appearing stuck in the admin.
    // Now we atomically set status='user_stopped' AND no_trade_found_at in a single write.
    // The browser event remains as a UI hint but is no longer the authority on session state.
    if (this.activeSession) {
      const now = new Date().toISOString();
      supabase
        .from('goal_sessions')
        .update({
          status: 'user_stopped',
          no_trade_found_at: now,
          completed_at: now,
          updated_at: now
        })
        .eq('id', this.activeSession)
        .eq('status', 'scanning')
        .then(({ error }) => {
          if (error) {
            logger.warn(LogCategory.AI_TRADING, `[emitNoTradeEvent] Failed to close session in DB: ${error.message}`);
          } else {
            logger.info(LogCategory.AI_TRADING, `[emitNoTradeEvent] Session ${this.activeSession} closed in DB (status=user_stopped, no_trade_found_at set).`);
          }
        });
    }

    if (typeof window !== 'undefined' && this.activeSession) {
      window.dispatchEvent(new CustomEvent('alpha-scan-no-trade', {
        detail: {
          sessionId: this.activeSession,
          timestamp: Date.now(),
          rejectionContext: rejectionContext || null
        }
      }));
    }
  }

  private async sendAIMessage(message: string): Promise<void> {
    if (!this.activeSession || !this.config) {
      return;
    }

    try {
      await SystemTableRPCWrapper.createGoalAIConversation(
        this.config.userId,
        this.activeSession,
        'ai',
        message,
        0,
        'gpt-4',
        { sentiment: 'neutral' }
      );
    } catch (error) {
      console.error('[Goal Live Engine] Failed to send AI message:', error);
    }
  }

  /**
   * Log notification to goal_notifications table for audit trail
   * This creates a permanent record of all trade-related events
   */
  private async logNotification(
    type: 'forecast' | 'signal' | 'progress' | 'alert' | 'completion',
    title: string,
    message: string,
    priority: 'low' | 'medium' | 'high' | 'critical' = 'medium',
    data?: any
  ): Promise<void> {
    if (!this.activeSession || !this.config) {
      console.warn('[Goal Live Engine] Cannot log notification - missing session or config');
      return;
    }

    try {
      const validatedPriority = this.validatePriority(priority);
      const validatedType = this.validateNotificationType(type);

      // Validate required fields before attempting insert
      if (!this.activeSession || typeof this.activeSession !== 'string') {
        console.error('[Goal Live Engine] Notification validation: Invalid goal_session_id', {
          value: this.activeSession,
          type: typeof this.activeSession
        });
        return;
      }

      if (!this.config.userId || typeof this.config.userId !== 'string') {
        console.error('[Goal Live Engine] Notification validation: Invalid user_id', {
          value: this.config.userId,
          type: typeof this.config.userId
        });
        return;
      }

      if (!validatedType || typeof validatedType !== 'string') {
        console.error('[Goal Live Engine] Notification validation: Invalid notification type', {
          value: type,
          validated: validatedType
        });
        return;
      }

      if (!title || typeof title !== 'string') {
        console.error('[Goal Live Engine] Notification validation: Invalid title', {
          value: title,
          type: typeof title
        });
        return;
      }

      if (!message || typeof message !== 'string') {
        console.error('[Goal Live Engine] Notification validation: Invalid message', {
          value: message,
          type: typeof message
        });
        return;
      }

      // Ensure metadata is a valid object
      const notificationMetadata = data && typeof data === 'object' ? data : {};

      const { error } = await supabase.from('goal_notifications').insert({
        goal_session_id: this.activeSession.trim(),
        user_id: this.config.userId.trim(),
        type: validatedType,
        priority: validatedPriority,
        title: title.trim(),
        message: message.trim(),
        metadata: notificationMetadata,
        delivered_at: new Date().toISOString(),
        channels: ['in_app']
      });

      if (error) {
        console.error('[Goal Live Engine] CRITICAL: Notification insert failed', {
          errorMessage: error.message,
          errorCode: (error as any).code,
          errorDetails: (error as any).details,
          failedRecord: {
            type: validatedType,
            priority: validatedPriority,
            title,
            goal_session_id: this.activeSession
          }
        });
        logger.error(LogCategory.AI_TRADING, 'Failed to insert notification', { error, title, type: validatedType, priority: validatedPriority });
      } else {
        console.log(`[Notification Logged] ✅ ${validatedType.toUpperCase()}: ${title}`);
      }
    } catch (error) {
      console.error('[Goal Live Engine] Failed to log notification (exception)', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        context: {
          title,
          type,
          priority
        }
      });
      logger.error(LogCategory.AI_TRADING, 'Notification logging exception', { error, title, type });
    }
  }

  private validatePriority(priority: any): 'low' | 'medium' | 'high' | 'critical' {
    const validPriorities = ['low', 'medium', 'high', 'critical'];
    if (validPriorities.includes(priority)) {
      return priority;
    }
    if (priority === 'urgent') {
      return 'critical';
    }
    console.warn(`[Priority Validation] Invalid priority "${priority}", defaulting to "medium"`);
    return 'medium';
  }

  /**
   * Validate notification type against database constraint
   * SSOT: Must match valid_notification_type CHECK constraint in goal_notifications table
   * Source: 20251227093949_fix_notification_type_constraint_final.sql
   */
  private validateNotificationType(type: any): string | null {
    const validTypes = [
      'forecast', 'signal', 'progress', 'alert', 'completion',
      'mid_trade_trigger', 'mid_trade_evaluation', 'mid_trade_action', 'mid_trade_alert',
      'session_ended', 'session_started', 'continuation_required', 'scanning_timeout',
      'trade_entry', 'trade_closed', 'goal_achieved',
      'price_alert', 'sl_triggered', 'tp_triggered',
      'system_alert', 'warning', 'info'
    ];

    if (validTypes.includes(type)) {
      return type;
    }

    // Fallback mapping for common variations
    const typeMap: Record<string, string> = {
      'entry': 'trade_entry',
      'closed': 'trade_closed',
      'achieved': 'goal_achieved',
      'timeout': 'scanning_timeout',
      'sl': 'sl_triggered',
      'tp': 'tp_triggered',
      'mid_trade': 'mid_trade_alert'
    };

    if (typeMap[type]) {
      console.warn(`[Notification Type Validation] Mapped "${type}" to "${typeMap[type]}"`);
      return typeMap[type];
    }

    console.error(`[Notification Type Validation] Invalid notification type "${type}", will be rejected by database`);
    return null;
  }

  private async sendTriggerDetectedMessage(trigger: any, latestCandle: any): Promise<void> {
    if (!this.config || !this.activeSession) return;

    const message = `🎯 Potential setup detected on ${this.config.symbol}! Type: ${trigger.type} | Confidence: ${trigger.confidence}% | Initiating 5-layer validation...`;

    try {
      await SystemTableRPCWrapper.createGoalAIConversation(
        this.config.userId,
        this.activeSession,
        'ai',
        message,
        0,
        'gpt-4',
        {
          context: {
            trigger,
            price: latestCandle.close,
            trigger_type: trigger.type,
            confidence: trigger.confidence
          },
          sentiment: 'neutral'
        }
      );
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

    // Fetch goal session data for goal-aware triggers
    const { data: goalSession } = await supabase
      .from('goal_sessions')
      .select('target_value')
      .eq('id', this.activeSession)
      .single();

    // Calculate current progress from closed trades
    const { data: closedTrades } = await supabase
      .from('goal_session_trades')
      .select('profit_loss')
      .eq('goal_session_id', this.activeSession)
      .eq('status', 'closed');

    const currentProgress = closedTrades?.reduce((sum, t) => sum + (t.profit_loss || 0), 0) || 0;
    const targetValue = goalSession?.target_value || 100;

    // Check for triggers (goal feasibility is determined at execution time, not during trade)
    const triggerResult = midTradeTriggerDetector.checkForTriggers(
      trade,
      marketConditions
    );

    if (triggerResult.triggered && triggerResult.shouldCallLLM) {
      logger.debug(LogCategory.AI_TRADING, `Mid-trade trigger: ${triggerResult.triggerType} - ${triggerResult.triggerReason}`);

      // Send trigger notification to AI conversation
      await this.sendMidTradeTriggerMessage(triggerResult, trade, latestCandle);

      // Insert mid-trade trigger notification
      await this.insertMidTradeNotification('mid_trade_trigger', trade, latestCandle, {
        trigger_type: triggerResult.triggerType,
        trigger_reason: triggerResult.triggerReason,
        confidence: triggerResult.confidence
      }, 'high');

      // Call LLM for evaluation (goal context not included - goal feasibility determined at execution time)
      const evaluation = await llmMidTradeEvaluator.evaluateTrade(
        {
          trade,
          marketConditions,
          trigger: triggerResult
        },
        this.config.userId
      );

      logger.info(LogCategory.AI_TRADING, `Mid-trade LLM: ${evaluation.recommendation} (${evaluation.confidence}% confidence)`);
      logger.debug(LogCategory.AI_TRADING, `Reasoning: ${evaluation.reasoning}`);
      logger.debug(LogCategory.AI_TRADING, `Cost: $${evaluation.costUsd.toFixed(4)} | Tokens: ${evaluation.tokensUsed}`);

      // Send LLM evaluation to AI conversation
      await this.sendMidTradeEvaluationMessage(evaluation, trade, latestCandle);

      // Insert mid-trade evaluation notification
      await this.insertMidTradeNotification('mid_trade_evaluation', trade, latestCandle, {
        trigger_type: triggerResult.triggerType,
        trigger_reason: triggerResult.triggerReason,
        llm_recommendation: evaluation.recommendation,
        llm_reasoning: evaluation.reasoning,
        confidence: evaluation.confidence
      }, evaluation.recommendation === 'EXIT_IMMEDIATELY' ? 'urgent' : 'medium');

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
        await SystemTableRPCWrapper.createGoalAIConversation(
          this.config.userId,
          this.activeSession,
          'ai',
          `⚠️ LLM recommendation rejected: ${validation.violations.join('. ')}. Keeping current parameters for safety.`,
          0,
          'gpt-4',
          {
            context: { evaluation, validation },
            sentiment: 'cautionary'
          }
        );
      } catch (error) {
        console.error('[Goal Live Engine] Failed to log recommendation rejection conversation:', error);
      }

      return;
    }

    // Determine if this recommendation requires user alert
    const requiresUserAlert = evaluation.recommendation === 'EXIT_IMMEDIATELY' ||
                              evaluation.recommendation === 'TAKE_PROFIT_EARLY';

    // Apply recommendation with smart routing
    let actionMessage = '';

    if (requiresUserAlert) {
      // Critical action - create alert notification with countdown
      const latestPrice = evaluation.suggestedActions?.exitPrice || trade.entryPrice;

      actionMessage = `🎯 LLM Evaluation (${evaluation.processingTimeMs}ms): "${evaluation.reasoning}"\n\nRecommendation: ${evaluation.recommendation} | Confidence: ${evaluation.confidence}%`;

      // Create alert notification (will trigger popup modal)
      const autoExecuteAt = new Date(Date.now() + 30000); // 30 seconds from now

      await supabase.from('goal_notifications').insert({
        user_id: this.config.userId,
        goal_session_id: this.activeSession,
        type: 'mid_trade_alert',
        title: evaluation.recommendation === 'EXIT_IMMEDIATELY' ? 'Emergency Exit Required' : 'Take Profit Early',
        message: actionMessage,
        priority: 'critical',
        requires_user_alert: true,
        auto_execute_at: autoExecuteAt.toISOString(),
        executed: false,
        viewed: false,
        trade_context: {
          trade_id: trade.id,
          symbol: trade.symbol,
          direction: trade.direction,
          entry_price: trade.entryPrice,
          current_price: latestPrice,
          stop_loss: trade.stopLoss,
          take_profit: trade.takeProfit,
          current_pnl: (latestPrice - trade.entryPrice) * trade.positionSize * 10
        },
        recommendation_data: {
          recommendation: evaluation.recommendation,
          confidence: evaluation.confidence,
          reasoning: evaluation.reasoning,
          suggestedActions: evaluation.suggestedActions,
          processingTimeMs: evaluation.processingTimeMs,
          costUsd: evaluation.costUsd
        },
        trigger_type: trigger.triggerType
      });

      // Log to AI conversation (informational only - execution will happen after countdown)
      await SystemTableRPCWrapper.createGoalAIConversation(
        this.config.userId,
        this.activeSession!,
        'ai',
        actionMessage,
        0,
        'gpt-4',
        {
          context: {
            evaluation,
            trade_id: trade.id,
            recommendation: evaluation.recommendation,
            confidence: evaluation.confidence,
            auto_execute_in_seconds: 30,
            alert_created: true
          },
          sentiment: evaluation.recommendation === 'EXIT_IMMEDIATELY' ? 'cautionary' : 'neutral'
        }
      );

      logger.info(LogCategory.AI_TRADING, `Mid-trade alert created: ${evaluation.recommendation} (auto-execute in 30s)`);
    } else {
      // Non-critical action - execute immediately
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

        default:
          actionMessage = `✓ LLM Decision: ${evaluation.recommendation}`;
      }

      // Send action message to AI conversation
      try {
        await SystemTableRPCWrapper.createGoalAIConversation(
          this.config.userId,
          this.activeSession!,
          'ai',
          actionMessage,
          0,
          'gpt-4',
          {
            context: {
              evaluation,
              trade_id: trade.id,
              recommendation: evaluation.recommendation,
              confidence: evaluation.confidence,
              new_sl: trade.stopLoss,
              new_tp: trade.takeProfit
            },
            sentiment: 'neutral'
          }
        );
      } catch (error) {
        console.error('[Goal Live Engine] Failed to log mid-trade action conversation:', error);
      }

      // Insert standard notification (no popup)
      const latestPrice = evaluation.suggestedActions?.exitPrice || trade.entryPrice;
      await this.insertMidTradeNotification('mid_trade_action', trade, { close: latestPrice }, {
        trigger_type: 'Action Applied',
        trigger_reason: actionMessage,
        llm_recommendation: evaluation.recommendation,
        llm_reasoning: evaluation.reasoning,
        action_taken: evaluation.recommendation,
        confidence: evaluation.confidence
      }, 'medium');

      logger.info(LogCategory.AI_TRADING, `Mid-trade action executed: ${evaluation.recommendation}`);
    }
  }

  /**
   * Send mid-trade trigger notification
   */
  private async sendMidTradeTriggerMessage(trigger: any, trade: SimulatedTrade, candle: any): Promise<void> {
    if (!this.config || !this.activeSession) return;

    let message = '';
    let sentiment: 'encouraging' | 'neutral' | 'warning' = 'neutral';

    // Customize message based on trigger type
    if (trigger.triggerType === 'goal_50_percent') {
      message = `🎯 Halfway Milestone! ${trigger.triggerReason}\n\nAlpha is evaluating momentum and market conditions to optimize this position for the best chance of reaching your goal.`;
      sentiment = 'encouraging';
    } else if (trigger.triggerType === 'goal_70_percent') {
      message = `🔥 70% Progress! ${trigger.triggerReason}\n\nAlpha is analyzing whether to:\n• Move stop loss to breakeven for protection\n• Let it run to full TP\n• Consider early profit capture\n\nEvaluating now...`;
      sentiment = 'encouraging';
    } else if (trigger.triggerType === 'goal_90_percent') {
      message = `🚀 90% to Goal! ${trigger.triggerReason}\n\nAlpha is making a critical decision:\n• Close now and secure the goal?\n• Let it run for full profit?\n• Protect with tighter stop loss?\n\nLLM evaluation in progress...`;
      sentiment = 'encouraging';
    } else {
      message = `⚠️ Mid-Trade Event: ${trigger.triggerReason}. Requesting LLM evaluation...`;
      sentiment = 'neutral';
    }

    try {
      await SystemTableRPCWrapper.createGoalAIConversation(
        this.config.userId,
        this.activeSession!,
        'ai',
        message,
        0,
        'gpt-4',
        {
          context: {
            trigger,
            trade_id: trade.id,
            trigger_type: trigger.triggerType,
            confidence: trigger.confidence,
            current_price: candle.close,
            goal_metadata: trigger.metadata
          },
          sentiment
        }
      );
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
      await SystemTableRPCWrapper.createGoalAIConversation(
        this.config.userId,
        this.activeSession!,
        'ai',
        message,
        0,
        'gpt-4',
        {
          context: {
            evaluation,
            trade_id: trade.id,
            recommendation: evaluation.recommendation,
            confidence: evaluation.confidence,
            cost_usd: evaluation.costUsd,
            tokens_used: evaluation.tokensUsed
          },
          sentiment: 'neutral'
        }
      );
    } catch (error) {
      console.error('[Goal Live Engine] Failed to log mid-trade evaluation conversation:', error);
    }
  }

  /**
   * Insert mid-trade notification for real-time alerts
   */
  private async insertMidTradeNotification(
    type: 'mid_trade_trigger' | 'mid_trade_evaluation' | 'mid_trade_action',
    trade: SimulatedTrade,
    candle: any,
    recommendationData: any,
    priority: 'urgent' | 'high' | 'medium' | 'low'
  ): Promise<void> {
    if (!this.config || !this.activeSession) return;

    const currentPrice = candle.close;
    const pnl = trade.direction === 'buy'
      ? (currentPrice - trade.entryPrice) * trade.positionSize
      : (trade.entryPrice - currentPrice) * trade.positionSize;
    const pnlPercentage = ((pnl / (trade.entryPrice * trade.positionSize)) * 100);
    const dollarPerPip = calculateDollarPerPip(trade.symbol, trade.positionSize);
    const pipInfo = getCurrencyPipInfo(trade.symbol);
    const pipsToRisk = Math.abs(trade.entryPrice - trade.stopLoss) / pipInfo.pipValue;
    const riskAmount = dollarPerPip * pipsToRisk;
    const rMultiple = riskAmount > 0 ? pnl / riskAmount : 0;
    const timeInTrade = Date.now() - new Date(trade.entryTime).getTime();
    const timeInTradeMinutes = Math.floor(timeInTrade / 60000);

    const notification = {
      user_id: this.config.userId,
      goal_session_id: this.activeSession,
      type,
      message: recommendationData.trigger_reason || recommendationData.llm_recommendation || 'Mid-trade update',
      viewed: false,
      priority,
      trade_context: {
        trade_id: trade.id,
        symbol: trade.symbol,
        direction: trade.direction,
        entry_price: trade.entryPrice,
        current_price: currentPrice,
        stop_loss: trade.stopLoss,
        take_profit: trade.takeProfit,
        pnl: parseFloat(pnl.toFixed(2)),
        pnl_percentage: parseFloat(pnlPercentage.toFixed(2)),
        r_multiple: parseFloat(rMultiple.toFixed(2)),
        time_in_trade_minutes: timeInTradeMinutes
      },
      recommendation_data: {
        trigger_type: recommendationData.trigger_type,
        trigger_reason: recommendationData.trigger_reason,
        llm_recommendation: recommendationData.llm_recommendation || 'Evaluating',
        llm_reasoning: recommendationData.llm_reasoning || '',
        action_taken: recommendationData.action_taken || 'Pending',
        confidence: recommendationData.confidence || 0
      },
      trigger_type: recommendationData.trigger_type
    };

    try {
      const { data, error } = await supabase.from('goal_notifications').insert(notification).select().single();
      if (error) {
        console.error(`[Goal Live Engine] Failed to insert ${type} notification:`, error);
        console.error('[Goal Live Engine] Notification data:', notification);
      } else {
        logger.debug(LogCategory.AI_TRADING, `✓ Inserted ${type} notification for trade ${trade.id}`, data);
      }
    } catch (error) {
      console.error(`[Goal Live Engine] Exception inserting ${type} notification:`, error);
      console.error('[Goal Live Engine] Notification data:', notification);
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

      const response = await openAIClient.chat([
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

      return `💡 ${response.choices[0]?.message?.content || ''}`;

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
    const pipInfo = getCurrencyPipInfo(trade.symbol);

    // Calculate current P&L using proper pip value and dollar per pip
    const priceDiff = isLong
      ? (currentPrice - trade.entryPrice)
      : (trade.entryPrice - currentPrice);
    const pips = priceDiff / pipInfo.pipValue;
    const dollarPerPip = calculateDollarPerPip(trade.symbol, trade.positionSize);
    const pnl = pips * dollarPerPip;

    // Calculate time open
    const timeOpen = Math.floor((Date.now() - trade.entryTime.getTime()) / 60000);

    // Calculate distance to TP and SL using proper pip value
    const distanceToTP = isLong
      ? ((trade.takeProfit - currentPrice) / pipInfo.pipValue)
      : ((currentPrice - trade.takeProfit) / pipInfo.pipValue);
    const distanceToSL = isLong
      ? ((currentPrice - trade.stopLoss) / pipInfo.pipValue)
      : ((trade.stopLoss - currentPrice) / pipInfo.pipValue);

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

    const pointsLabel = pipInfo.symbolType === 'index' ? 'points' : 'pips';
    const message = `${emoji} ${statusText}: ${trade.symbol} ${trade.direction.toUpperCase()} (${timeOpen}m) | Price: ${formatCurrencyPrice(trade.symbol, currentPrice)} | P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pips >= 0 ? '+' : ''}${pips.toFixed(1)} ${pointsLabel})`;

    try {
      await SystemTableRPCWrapper.createGoalAIConversation(
        this.config.userId,
        this.activeSession!,
        'ai',
        message,
        0,
        'gpt-4',
        {
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
        }
      );
    } catch (error) {
      console.error('[Goal Live Engine] Failed to log trade monitoring conversation:', error);
    }
  }

  /**
   * Calculate historical ATR for goal feasibility analysis
   * Returns median ATR from last 20 candles for stable baseline
   */
  private async calculateHistoricalATR(symbol: string): Promise<{ typicalATR: number; dailyATR: number }> {
    try {
      // ✅ PHASE 2: Use MarketDataService as SSOT
      const marketDataService = MarketDataService.getInstance();
      const candles = await marketDataService.getCandles(symbol, '15m', 20);

      if (!candles || candles.length < 10) {
        console.warn(`[Historical ATR] Insufficient data for ${symbol}, using fallback`);
        const pipInfo = getCurrencyPipInfo(symbol);
        const fallbackATR = pipInfo.pipValue * 10;
        return { typicalATR: fallbackATR, dailyATR: fallbackATR * 24 };
      }

      const atrValues = candles.map(c => Math.max(
        Math.abs(c.high - c.low),
        Math.abs(c.high - c.close),
        Math.abs(c.low - c.close)
      ));

      atrValues.sort((a, b) => a - b);
      const medianATR = atrValues[Math.floor(atrValues.length / 2)];
      const dailyATR = medianATR * 24;

      return { typicalATR: medianATR, dailyATR };
    } catch (error) {
      console.error(`[Historical ATR] Error calculating for ${symbol}:`, error);
      const pipInfo = getCurrencyPipInfo(symbol);
      const fallbackATR = pipInfo.pipValue * 10;
      return { typicalATR: fallbackATR, dailyATR: fallbackATR * 24 };
    }
  }

  /**
   * Monitor open positions only without scanning for new trades
   * Used when max trades reached to save tokens/credits
   *
   * CRITICAL FIX: Fetches candles for ALL symbols with open positions
   */
  private async monitorOpenPositionsOnly(): Promise<void> {
    // 🔍 DEFENSIVE: Log memory state for diagnostics
    console.log('%c[MONITORING MODE] 🔍 Memory state:', 'color: #9c27b0; font-weight: bold', {
      openTradesInMemory: this.openTrades.length,
      tradeSymbols: this.openTrades.map(t => `${t.symbol}:${t.id.substring(0, 8)}`),
      sessionId: this.activeSession
    });

    // 🚨 CRITICAL: Sync with database to prevent memory loss
    const { data: dbPositions, error: dbError } = await supabase
      .from('goal_session_trades')
      .select('id, symbol, direction, entry_price, stop_loss, take_profit, position_size, status, opened_at, created_at')
      .eq('goal_session_id', this.activeSession!)
      .eq('status', 'open');

    if (dbError) {
      console.error('[MONITORING MODE] ❌ Database sync failed:', dbError);
      return;
    }

    const dbOpenCount = dbPositions?.length || 0;
    console.log('%c[MONITORING MODE] 📊 Database shows ' + dbOpenCount + ' open positions',
      'color: #2196f3; font-weight: bold');

    // 🚨 CRITICAL: If database has positions but memory doesn't, resync!
    if (dbOpenCount > 0 && this.openTrades.length === 0) {
      console.error('%c[MONITORING MODE] 🚨 MEMORY DESYNC DETECTED!', 'color: #f44336; font-weight: bold; font-size: 16px');
      console.error('[MONITORING MODE] Database has positions but memory array is empty. Resyncing...');

      // Reconstruct openTrades from database
      this.openTrades = dbPositions.map(pos => ({
        id: pos.id,
        symbol: pos.symbol,
        direction: pos.direction as 'buy' | 'sell',
        entryPrice: pos.entry_price,
        entryTime: new Date(pos.opened_at || pos.created_at),
        stopLoss: pos.stop_loss,
        takeProfit: pos.take_profit,
        positionSize: pos.position_size,
        outcome: 'open' as const,
        confidence: 0, // Unknown
        reasoning: 'Resynced from database',
        triggerType: 'resync',
        maxHoldMinutes: 240,
        pnl: 0
      }));

      console.log('%c[MONITORING MODE] ✅ Resynced ' + this.openTrades.length + ' positions from database',
        'color: #4caf50; font-weight: bold');
    }

    // CRITICAL: If no open positions after resync, exit immediately (don't block scanning)
    if (this.openTrades.length === 0) {
      console.warn('%c[MONITORING MODE] ⚠️ No open positions after resync!', 'color: #ff9800; font-weight: bold; font-size: 14px');
      console.warn('[MONITORING MODE] Database had "open" records but they were stale/invalid.');
      console.log('%c[MONITORING MODE] ✅ Exiting monitoring mode - scan can proceed', 'color: #4caf50; font-weight: bold');
      this.monitoringModeMessageSent = false; // Reset flag to allow normal operation
      return;
    }

    // Send status update to UI on first call to monitoring mode
    // CRITICAL: Only send message if there are ACTUALLY open positions after resync
    if (!this.monitoringModeMessageSent && this.openTrades.length > 0) {
      console.log('%c[MONITORING MODE] 👁️ Switched to position monitoring only', 'color: #2196f3; font-weight: bold; font-size: 16px');
      await this.sendAIMessage(
        `👁️ Position Monitoring Active\n\n` +
        `Max trades (${this.config.maxConcurrentTrades}) reached - scanning paused to preserve credits.\n\n` +
        `Currently monitoring ${this.openTrades.length} open position(s). Will resume scanning after positions close.`
      );
      this.monitoringModeMessageSent = true;
    }

    // 🚨 CRITICAL FIX: Get unique symbols from ACTUAL open trades, not config
    const tradeSymbols = [...new Set(this.openTrades.map(t => t.symbol))];
    console.log('%c[MONITORING MODE] 📡 Fetching candles for symbols:', 'color: #ff9800; font-weight: bold', tradeSymbols);

    if (tradeSymbols.length === 0) {
      console.log('%c[MONITORING MODE] ⚠️ No symbols to monitor (empty array)', 'color: #ff9800; font-weight: bold');
      this.monitoringModeMessageSent = false;
      return;
    }

    const dbTimeframe = normalizeTimeframeToDb(this.config.timeframe);

    // ✅ PHASE 2: Use MarketDataService as SSOT
    const marketDataService = MarketDataService.getInstance();

    // Fetch latest candle for each symbol with open positions
    for (const symbol of tradeSymbols) {
      const candles = await marketDataService.getCandles(symbol, dbTimeframe, 10);

      if (!candles || candles.length === 0) {
        console.warn(`[MONITORING MODE] ⚠️ No candles for ${symbol} - skipping`);
        continue;
      }

      const latestCandle = candles[0];
      console.log(`[MONITORING MODE] 🕯️ ${symbol} latest: ${latestCandle.close} @ ${latestCandle.open_time}`);

      // Update trades for this symbol only
      const tradesForSymbol = this.openTrades.filter(t => t.symbol === symbol);
      for (const trade of tradesForSymbol) {
        const updatedTrades = eventBasedLLMEngine.updateOpenTrades([trade], latestCandle);

        // 🚨 DEFENSIVE: Check for undefined before accessing properties
        if (!updatedTrades || updatedTrades.length === 0) {
          console.error(`[MONITORING MODE] ❌ updateOpenTrades returned empty for ${symbol} trade ${trade.id.substring(0, 8)}`);
          continue;
        }

        const updatedTrade = updatedTrades[0];
        if (!updatedTrade) {
          console.error(`[MONITORING MODE] ❌ updatedTrade is undefined for ${symbol} trade ${trade.id.substring(0, 8)}`);
          continue;
        }

        if (updatedTrade.outcome !== 'open') {
          console.log(`[MONITORING MODE] 🎯 ${symbol} trade ${trade.id.substring(0, 8)} closed: ${updatedTrade.outcome}`);

          // Update in main array
          const idx = this.openTrades.findIndex(t => t.id === trade.id);
          if (idx !== -1) {
            this.openTrades[idx] = updatedTrade;
          }
        }
      }
    }

    // Handle closed trades
    const closedTrades = this.openTrades.filter(t => t.outcome !== 'open');
    for (const trade of closedTrades) {
      await this.handleTradeClosure(trade);
    }
    this.openTrades = this.openTrades.filter(t => t.outcome === 'open');

    // 🚨 CRITICAL FIX: Only reset monitoring flag if BOTH memory AND database confirm zero positions
    if (this.openTrades.length === 0) {
      // Double-check database before resetting
      const { data: finalCheck } = await supabase
        .from('goal_session_trades')
        .select('id', { count: 'exact', head: true })
        .eq('goal_session_id', this.activeSession!)
        .eq('status', 'open');

      const dbStillHasPositions = (finalCheck as any)?.count > 0;

      if (dbStillHasPositions) {
        console.error('%c[MONITORING MODE] 🚨 BLOCKED RESET: Database still has open positions!',
          'color: #f44336; font-weight: bold; font-size: 16px');
      } else {
        console.log('%c[MONITORING MODE] ✅ All positions closed (verified with DB) - will resume scanning',
          'color: #4caf50; font-weight: bold');
        this.monitoringModeMessageSent = false;
      }
    }

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
        .select('target_value')
        .eq('id', this.activeSession)
        .single();

      const targetAmount = parseFloat(session?.target_value || '0');
      const progressPercent = targetAmount > 0 ? (totalProfit / targetAmount) * 100 : 0;

      // Update goal_sessions with current progress
      await supabase
        .from('goal_sessions')
        .update({
          current_progress: totalProfit,
          progress_percentage: Math.min(progressPercent, 100)
        })
        .eq('id', this.activeSession);

      logger.debug(LogCategory.AI_TRADING, `Progress: $${totalProfit.toFixed(2)} / $${targetAmount.toFixed(2)} (${progressPercent.toFixed(1)}%)`);

    } catch (error) {
      console.error('[Progress Update] Error:', error);
    }
  }
}

export const goalSessionLiveEngine = new GoalSessionLiveEngine();
