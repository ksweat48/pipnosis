/**
 * Smart Goal Session Manager (Refactored)
 *
 * Session management and coordination for goal-based trading.
 * Delegates all trade execution to goal-session-live-engine (live demo system).
 * NO SYNTHETIC TRADES - All trades use real price monitoring with SL/TP.
 */

import { supabase } from '../lib/supabase';
import { PIPNOSIS_CORE_RULES, PipnosisCoreRules } from '../lib/pipnosis-core-rules';
import { goalSessionLiveEngine, GoalSessionLiveConfig } from './goal-session-live-engine';
import { v4 as uuidv4 } from 'uuid';
import { getMinConfidenceThreshold } from '../config/risk-levels';
import { alphaExecutionPlanner } from './alpha-execution-planner';
import { TradeStyle } from '../config/trade-styles';
import { extractSymbolsFromPrompt, getSymbolSelectionSource } from '../utils/symbol-prompt-parser';
import { getSymbolsByAssetClass, filterWatchlistByAssetClass, type AssetClass } from '../utils/asset-class-mapper';
import { getDefaultWatchlist } from '../config/watchlist';
import { weekendProtectionService } from './weekend-protection-service';

/**
 * SSOT: Terminal (inactive) session statuses
 * These are the ONLY statuses that represent a finished/closed session
 * All other statuses are considered "active" and should be queryable
 */
export const TERMINAL_SESSION_STATUSES = [
  'completed',
  'goal_achieved',
  'expired',
  'user_stopped'
] as const;

export interface SmartGoalConfig {
  goalAmount: number;
  timeframe: string;
  riskMode?: 'low' | 'medium' | 'high'; // Legacy, optional
  tradeStyle?: TradeStyle; // New trade styles system
  dollarRisk?: number; // New dollar-based risk
  watchlist: string[];
  autoExecute: boolean;
  accountBalance: number;
  assetClassFilter?: string[]; // Asset class preferences: ['forex', 'crypto', 'indices', 'gold']
  specificSymbols?: string[]; // User-selected specific symbols
  customInstructions?: string; // Custom trading instructions (max 200 chars)
  symbolSelectionSource?: 'prompt' | 'ui' | 'asset_filter' | 'default'; // How symbols were chosen
}

export interface SmartGoalSession {
  sessionId: string;
  userId: string;
  config: SmartGoalConfig;
  status: 'initializing' | 'scanning' | 'trade_pending' | 'in_trade' | 'active' | 'goal_achieved' | 'expired' | 'user_stopped' | 'awaiting_continuation';
  strategy: {
    targetTradeCount: number;
    avgProfitPerTrade: number;
    maxProfitPerTrade: number;
    scanIntervalMinutes: number;
  };
  startTime: Date;
  nextScanTime: Date;
  lastScanTime?: Date;
  executionMode?: 'client' | 'server' | 'hybrid';
  serverHeartbeat?: string;
  serverLastCheck?: string;
  serverEnabled?: boolean;
  autonomousEnabled?: boolean;
  tp1_target?: number;
  tp2_target?: number;
  tp1_hit?: boolean;
  tp1_hit_at?: string;
  tp1_learning_awarded?: boolean;
  tp2_hit?: boolean;
  tp2_hit_at?: string;
  activePairsCount?: number; // Real-time count of scannable pairs considering market hours
  assetClassFilter?: string[]; // Asset class preferences
  specificSymbols?: string[]; // User-selected specific symbols
  customInstructions?: string; // Custom trading instructions
  symbolSelectionSource?: 'prompt' | 'ui' | 'asset_filter' | 'default'; // How symbols were chosen
  lastPairsUpdate?: string; // Timestamp of last active_pairs_count update
}

class SmartGoalSessionManager {
  private activeSessions: Map<string, SmartGoalSession> = new Map();
  private scanTimers: Map<string, NodeJS.Timeout> = new Map();

  async createSmartGoalSession(
    userId: string,
    prompt: string,
    accountBalance: number,
    multiTradeEnabled: boolean = false,
    tradeStyle?: TradeStyle,
    dollarRisk?: number,
    assetClassFilter?: string[],
    specificSymbols?: string[],
    customInstructions?: string
  ): Promise<SmartGoalSession | null> {
    // CRITICAL: Prevent multiple active sessions
    const existingSession = await this.getActiveSession(userId);
    if (existingSession) {
      console.error('[Smart Goal] ❌ Cannot create session - user already has active session:', existingSession.sessionId);
      throw new Error('You already have an active session running. Please stop it before creating a new one.');
    }

    // Use new trade styles system if provided, otherwise fall back to legacy parsing
    const config = tradeStyle && dollarRisk
      ? this.buildConfigFromStyle(prompt, accountBalance, tradeStyle, dollarRisk, assetClassFilter, specificSymbols, customInstructions)
      : this.parseGoalPrompt(prompt, accountBalance);

    const sessionId = uuidv4();

    // Use riskMode for backward compatibility, or derive from dollarRisk
    const effectiveRiskMode = config.riskMode || this.deriveRiskModeFromDollarAmount(dollarRisk || 0, accountBalance);

    const breakDown = PipnosisCoreRules.breakGoalIntoSmallTrades(
      config.goalAmount,
      accountBalance,
      effectiveRiskMode
    );

    const session: SmartGoalSession = {
      sessionId,
      userId,
      config,
      status: 'scanning',
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

    this.activeSessions.set(sessionId, session);

    const minConfidence = getMinConfidenceThreshold(effectiveRiskMode);

    // Calculate dual take profit targets
    const dualTargets = await alphaExecutionPlanner.calculateDualTargets(
      config.goalAmount,
      accountBalance,
      effectiveRiskMode
    );

    console.log('[Smart Goal] Creating session with settings:', {
      sessionId,
      multi_trade_enabled: multiTradeEnabled,
      target: config.goalAmount,
      trade_style: config.tradeStyle,
      dollar_risk: config.dollarRisk,
      risk_mode_legacy: config.riskMode,
      tp1_target: dualTargets.tp1,
      tp2_target: dualTargets.tp2,
      tp_reasoning: dualTargets.reasoning,
      min_confidence: minConfidence
    });

    const { error } = await supabase.from('goal_sessions').insert({
      id: sessionId,
      user_id: userId,
      goal_type: 'profit_target',
      target_value: config.goalAmount,
      tp1_target: dualTargets.tp1,
      tp2_target: dualTargets.tp2,
      timeframe: config.timeframe,
      risk_mode: effectiveRiskMode, // Still store for legacy compatibility
      trade_style: config.tradeStyle, // New field
      dollar_risk: config.dollarRisk, // New field
      min_confidence: minConfidence,
      status: 'scanning',
      starting_balance: accountBalance,
      current_progress: 0,
      progress_percentage: 0,
      scan_interval_minutes: session.strategy.scanIntervalMinutes,
      auto_execute: config.autoExecute,
      watchlist: config.watchlist,
      multi_trade_enabled: multiTradeEnabled,
      trades_in_session: 0,
      start_time: session.startTime.toISOString(),
      next_scan_time: session.nextScanTime.toISOString(),
      server_enabled: true,
      autonomous_enabled: true,
      execution_mode: 'server',
      scanning_started_at: session.startTime.toISOString(),
      scanning_duration_minutes: 15,
      active_pairs_count: config.watchlist.length,
      asset_class_filter: config.assetClassFilter || null,
      specific_symbols: config.specificSymbols || null,
      custom_instructions: config.customInstructions || null,
      symbol_selection_source: config.symbolSelectionSource || 'default',
      last_pairs_update: new Date().toISOString()
    });

    if (error) {
      console.error('[Smart Goal] Error creating session record:', error);
    }

    await this.startLiveEngine(sessionId, userId, config, accountBalance, multiTradeEnabled);

    const styleInfo = config.tradeStyle ? ` • Style: ${config.tradeStyle}` : '';
    const riskInfo = config.dollarRisk ? ` • Risk: $${config.dollarRisk}/trade` : ` • Risk Mode: ${effectiveRiskMode}`;
    console.log(`[Smart Goal] Created session ${sessionId}: Target $${config.goalAmount}${styleInfo}${riskInfo}`);
    console.log(`[Smart Goal] Strategy: ${breakDown.targetTradeCount === 1 ? 'ONE premium trade' : `${breakDown.targetTradeCount} trades if needed`}`);
    console.log(`[Smart Goal] ✅ LIVE DEMO MODE - All trades use real price monitoring with visible SL/TP`);

    return session;
  }

  /**
   * Build config from new trade styles system with symbol detection (SSOT)
   *
   * Priority order for symbol selection:
   * 1. Symbols detected from prompt (e.g., "trade EURUSD")
   * 2. Specific symbols from UI selection
   * 3. Asset class filter (e.g., ['forex', 'crypto'])
   * 4. Default full watchlist
   */
  private buildConfigFromStyle(
    prompt: string,
    accountBalance: number,
    tradeStyle: TradeStyle,
    dollarRisk: number,
    assetClassFilter?: string[],
    specificSymbols?: string[],
    customInstructions?: string
  ): SmartGoalConfig {
    // Extract goal amount from prompt if present, otherwise use reasonable default
    const lower = prompt.toLowerCase();
    const dollarMatch = lower.match(/\$?\s*(\d+(?:\.\d+)?)/);

    // 🛡️ INTELLIGENT ROUNDING: Round goal to nearest dollar for internal calculations
    // UI can show cents, but calculations work with whole dollars to prevent precision issues
    let goalAmount = dollarMatch ? parseFloat(dollarMatch[1]) : dollarRisk * 2; // Default to 2x the risk
    goalAmount = Math.round(goalAmount); // Round to nearest dollar

    if (dollarMatch && goalAmount !== parseFloat(dollarMatch[1])) {
      console.log(`[Smart Goal] Rounded goal from $${parseFloat(dollarMatch[1]).toFixed(2)} to $${goalAmount.toFixed(2)} for calculation stability`);
    }

    // STEP 1: Detect symbols from prompt (highest priority)
    const promptSymbols = extractSymbolsFromPrompt(prompt);

    // STEP 2: Determine watchlist based on priority order
    let watchlist: string[];
    let symbolSelectionSource: 'prompt' | 'ui' | 'asset_filter' | 'default';

    if (promptSymbols.length > 0) {
      // Priority 1: Use symbols from prompt
      watchlist = promptSymbols;
      symbolSelectionSource = 'prompt';
      console.log(`[Smart Goal] 🎯 Detected ${promptSymbols.length} symbol(s) from prompt: ${promptSymbols.join(', ')}`);
    } else if (specificSymbols && specificSymbols.length > 0) {
      // Priority 2: Use specific symbols from UI
      watchlist = specificSymbols;
      symbolSelectionSource = 'ui';
      console.log(`[Smart Goal] 🎯 Using ${specificSymbols.length} symbol(s) from UI: ${specificSymbols.join(', ')}`);
    } else if (assetClassFilter && assetClassFilter.length > 0) {
      // Priority 3: Filter by asset class
      const fullWatchlist = getDefaultWatchlist();
      watchlist = filterWatchlistByAssetClass(fullWatchlist, assetClassFilter as AssetClass[]);
      symbolSelectionSource = 'asset_filter';
      console.log(`[Smart Goal] 🎯 Filtered to ${watchlist.length} symbol(s) by asset classes: ${assetClassFilter.join(', ')}`);
    } else {
      // Priority 4: Use full default watchlist
      watchlist = getDefaultWatchlist();
      symbolSelectionSource = 'default';
      console.log(`[Smart Goal] 🎯 Using default watchlist: ${watchlist.length} symbols`);
    }

    // STEP 3: Validate that at least one market is open for selected symbols
    const marketCheck = weekendProtectionService.canScanAnySymbol(watchlist);
    if (!marketCheck.allowed) {
      throw new Error(`All selected markets are closed. Trading resumes Sunday 5:00 PM EST. Available 24/7: BTCUSD, ETHUSD`);
    }

    // If some symbols are closed, warn but continue with open symbols
    if (marketCheck.closedSymbols.length > 0) {
      console.warn(`[Smart Goal] ⚠️ ${marketCheck.closedSymbols.length} symbol(s) closed: ${marketCheck.closedSymbols.join(', ')}`);
      console.log(`[Smart Goal] ✅ Continuing with ${marketCheck.openSymbols.length} open symbol(s): ${marketCheck.openSymbols.join(', ')}`);
      watchlist = marketCheck.openSymbols;
    }

    return {
      goalAmount,
      timeframe: '1 day',
      tradeStyle,
      dollarRisk,
      watchlist,
      autoExecute: true,
      accountBalance,
      assetClassFilter,
      specificSymbols,
      customInstructions,
      symbolSelectionSource
    };
  }

  /**
   * Derive legacy risk mode from dollar amount for backward compatibility
   */
  private deriveRiskModeFromDollarAmount(dollarRisk: number, accountBalance: number): 'low' | 'medium' | 'high' {
    const percentage = (dollarRisk / accountBalance) * 100;

    if (percentage <= 1.5) return 'low';
    if (percentage <= 2.5) return 'medium';
    return 'high';
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

  private convertTimeframeToHours(timeframe: string): number {
    const lower = timeframe.toLowerCase();

    if (lower.includes('week')) {
      const weeks = parseInt(timeframe) || 1;
      return weeks * 24 * 7;
    }

    if (lower.includes('day')) {
      const days = parseInt(timeframe) || 1;
      return days * 24;
    }

    if (lower.includes('hour')) {
      return parseInt(timeframe) || 24;
    }

    return 24;
  }

  // REMOVED: All synthetic trade execution logic
  // Trade execution now handled by goal-session-live-engine.ts
  // This ensures:
  // - Real price monitoring (not random simulation)
  // - Visible SL/TP on charts
  // - Proper goal_session_trades creation
  // - 5-layer LLM pipeline validation

  async completeSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    session.status = 'goal_achieved';

    await this.stopLiveEngine(sessionId);

    await supabase
      .from('goal_sessions')
      .update({
        status: 'goal_achieved'
      })
      .eq('id', sessionId);

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

  getActiveSessionById(sessionId: string): SmartGoalSession | null {
    return this.activeSessions.get(sessionId) || null;
  }

  async getActiveSession(userId: string): Promise<SmartGoalSession | null> {
    try {
      // SSOT-compliant: Query for sessions that are NOT terminal (use negative filter)
      // This automatically includes any new active statuses without code changes
      const { data, error } = await supabase
        .from('goal_sessions')
        .select('*')
        .eq('user_id', userId)
        .not('status', 'in', `(${TERMINAL_SESSION_STATUSES.join(',')})`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[Smart Goal] Error fetching active session:', error);
        return null;
      }

      if (!data) {
        return null;
      }

      const memorySession = this.activeSessions.get(data.id);
      if (memorySession) {
        return memorySession;
      }

      const reconstructed: SmartGoalSession = {
        sessionId: data.id,
        userId: data.user_id,
        config: {
          goalAmount: data.target_value,
          timeframe: data.timeframe,
          riskMode: data.risk_mode,
          watchlist: data.watchlist || ['XAUUSD'],
          autoExecute: data.auto_execute,
          accountBalance: data.starting_balance
        },
        status: data.status,
        strategy: {
          targetTradeCount: 1,
          avgProfitPerTrade: data.target_value,
          maxProfitPerTrade: data.target_value,
          scanIntervalMinutes: data.scan_interval_minutes || 1
        },
        startTime: new Date(data.start_time),
        nextScanTime: new Date(data.next_scan_time),
        lastScanTime: data.last_scan_time ? new Date(data.last_scan_time) : undefined,
        executionMode: data.execution_mode || 'client',
        serverHeartbeat: data.server_heartbeat,
        serverLastCheck: data.server_last_check,
        serverEnabled: data.server_enabled ?? true,
        autonomousEnabled: data.autonomous_enabled ?? true,
        tp1_target: data.tp1_target,
        tp2_target: data.tp2_target,
        tp1_hit: data.tp1_hit,
        tp2_hit: data.tp2_hit,
        tp1_hit_at: data.tp1_hit_at,
        tp2_hit_at: data.tp2_hit_at,
        tp1_learning_awarded: data.tp1_learning_awarded,
        activePairsCount: data.active_pairs_count,
        lastPairsUpdate: data.last_pairs_update
      };

      this.activeSessions.set(data.id, reconstructed);
      return reconstructed;
    } catch (error) {
      console.error('[Smart Goal] Error in getActiveSession:', error);
      return null;
    }
  }

  pauseSession(sessionId: string): boolean {
    const session = this.activeSessions.get(sessionId);
    if (!session || !['scanning', 'trade_pending', 'active'].includes(session.status)) return false;

    session.status = 'user_stopped';

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
    if (!session || session.status !== 'user_stopped') return false;

    session.status = 'scanning';
    this.scheduleNextScan(sessionId);

    console.log(`[Smart Goal] Session ${sessionId} resumed`);
    return true;
  }

  /**
   * Schedule next scan for a session
   *
   * NOTE: This schedules REGULAR scans (15 minute interval).
   * IMMEDIATE restarts after abandonment are handled by:
   * - entry-monitor-coordinator.ts (30 second client-side restart)
   * - Database trigger (1 minute server-side restart on intent timeout)
   *
   * This method is for normal scheduled scanning between opportunities.
   */
  private async scheduleNextScan(sessionId: string): Promise<void> {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        console.warn('[Smart Goal] Cannot schedule scan - session not found:', sessionId);
        return;
      }

      // Calculate next scan time (15 minutes from now for regular scheduled scans)
      const scanIntervalMs = (session.strategy.scanIntervalMinutes || 15) * 60 * 1000;
      const nextScanTime = new Date(Date.now() + scanIntervalMs);

      // Update in-memory session
      session.nextScanTime = nextScanTime;
      session.lastScanTime = new Date();

      // Update database
      const { error } = await supabase
        .from('goal_sessions')
        .update({
          next_scan_time: nextScanTime.toISOString(),
          last_scan_time: new Date().toISOString(),
          status: 'scanning'
        })
        .eq('id', sessionId);

      if (error) {
        console.error('[Smart Goal] Error updating next_scan_time:', error);
        return;
      }

      console.log(`[Smart Goal] ⏰ Next scan scheduled for ${nextScanTime.toLocaleTimeString()}`, {
        sessionId: sessionId.substring(0, 8),
        intervalMinutes: session.strategy.scanIntervalMinutes || 15
      });

      // Clear any existing timer
      const existingTimer = this.scanTimers.get(sessionId);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      // Set new timer to trigger scan
      const timer = setTimeout(() => {
        console.log('[Smart Goal] 🔍 Scheduled scan triggered');
        this.scanTimers.delete(sessionId);
      }, scanIntervalMs);

      this.scanTimers.set(sessionId, timer);
    } catch (error) {
      console.error('[Smart Goal] Error in scheduleNextScan:', error);
    }
  }

  private async startLiveEngine(
    sessionId: string,
    userId: string,
    config: SmartGoalConfig,
    accountBalance: number,
    multiTradeEnabled: boolean = false
  ): Promise<void> {
    try {
      // CRITICAL: In single-trade mode, maxConcurrentTrades MUST be 1
      // Only allow 2+ concurrent trades if multi-trade is explicitly enabled
      const maxConcurrentTrades = multiTradeEnabled ? 2 : 1;

      // Calculate minimum confidence threshold based on risk mode
      const minConfidence = getMinConfidenceThreshold(config.riskMode);

      const liveConfig: GoalSessionLiveConfig = {
        goalSessionId: sessionId,
        userId,
        symbol: config.watchlist[0],
        watchlist: config.watchlist,
        timeframe: '15m',
        useLLM: true,
        riskMode: config.riskMode || 'medium',
        maxConcurrentTrades,
        initialBalance: accountBalance,
        autoExecute: config.autoExecute,
        minConfidence,
        dollarRisk: config.dollarRisk,
        tradeStyle: config.tradeStyle
      };

      const result = await goalSessionLiveEngine.startSession(liveConfig);

      if (result.success) {
        console.log('[Smart Goal] ✅ Live demo engine started successfully');
        console.log('[Smart Goal] ✅ Autonomous Pipnosis Alpha brain active');
        console.log('[Smart Goal] ✅ All trades will have visible SL/TP on charts');

        // Calculate breakdown for message
        const breakDown = PipnosisCoreRules.breakGoalIntoSmallTrades(
          config.goalAmount,
          accountBalance,
          config.riskMode
        );

        // Send comprehensive session startup message
        const effectiveRiskMode = config.riskMode || 'medium';
        const strategyMessage = `🎯 Goal Session Started!\\n` +
          `💰 Target: $${config.goalAmount} in ${config.timeframe}\\n` +
          `📊 Strategy: ${breakDown.targetTradeCount} trades averaging $${breakDown.avgProfitPerTrade.toFixed(2)} each\\n` +
          `🛡️ Risk Mode: ${effectiveRiskMode.toUpperCase()} (max $${breakDown.maxProfitPerTrade.toFixed(2)} per trade)\\n` +
          `🎯 Confidence Threshold: ${minConfidence}% (${effectiveRiskMode} risk = ${minConfidence >= 70 ? 'selective' : minConfidence >= 60 ? 'balanced' : 'aggressive'})\\n` +
          `\\n🔍 Monitoring: ${config.watchlist.join(', ')}\\n` +
          `⚡ Analyzing markets every minute for optimal entries\\n` +
          `🧠 Autonomous Pipnosis Alpha: GPT-4o-mini creating dynamic strategies\\n` +
          `📈 All trades will have visible SL/TP on charts (Live Demo Mode)\\n` +
          `\\n🤖 The AI is analyzing:\\n` +
          `   • Market structure & regime (trend/range/breakout conditions)\\n` +
          `   • Smart money concepts (BOS, ChoCh, liquidity zones)\\n` +
          `   • Adversarial patterns (stop hunts, fake breakouts)\\n` +
          `   • Its own memory & playbook of proven strategies\\n` +
          `\\n📊 Strategy plans will be shared as the AI makes decisions in real-time`;

        await supabase.from('goal_ai_conversations').insert({
          goal_session_id: sessionId,
          user_id: userId,
          role: 'ai',
          message: strategyMessage,
          context: {
            liveEngineStatus: 'started',
            target: config.goalAmount,
            trades_needed: breakDown.targetTradeCount,
            avg_per_trade: breakDown.avgProfitPerTrade
          },
          sentiment: 'encouraging',
          technical_data: {
            watchlist: config.watchlist,
            scan_interval: '15s',
            risk_mode: config.riskMode
          },
          market_snapshot: {
            protection: '5-layer-llm',
            mode: 'live-demo'
          }
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

  async getSessionProgress(sessionId: string): Promise<any> {
    try {
      const [sessionData, tradesData, snapshotsData] = await Promise.all([
        supabase.from('goal_sessions').select('*').eq('id', sessionId).maybeSingle(),
        supabase.from('goal_session_trades').select('*').eq('goal_session_id', sessionId),
        supabase.from('goal_progress_snapshots').select('*').eq('goal_session_id', sessionId).order('created_at', { ascending: false }).limit(10)
      ]);

      if (sessionData.error || !sessionData.data) {
        console.error('[Smart Goal] Error fetching session progress:', sessionData.error);
        return null;
      }

      const trades = tradesData.data || [];
      const snapshots = snapshotsData.data || [];

      const closedTrades = trades.filter(t => t.status === 'closed');
      const openTrades = trades.filter(t => t.status === 'open');
      const winningTrades = closedTrades.filter(t => t.profit_loss > 0);

      // Get current P&L from open trades (directly from goal_session_trades)
      let openTradesPnL = 0;
      if (openTrades.length > 0) {
        // Calculate unrealized P&L from open trades
        openTradesPnL = openTrades.reduce((sum, t) => {
          // If the trade has current_pnl field, use it
          if (t.current_pnl !== null && t.current_pnl !== undefined) {
            return sum + t.current_pnl;
          }
          // Otherwise calculate from profit_loss if available
          return sum + (t.profit_loss || 0);
        }, 0);
      }

      const closedProfit = closedTrades.reduce((sum, t) => sum + (t.profit_loss || 0), 0);
      const totalProfit = closedProfit + openTradesPnL;

      return {
        session: sessionData.data,
        trades,
        closedTrades,
        openTrades,
        winningTrades,
        snapshots,
        stats: {
          totalTrades: trades.length,
          closedTradesCount: closedTrades.length,
          openTradesCount: openTrades.length,
          winRate: closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0,
          totalProfit,
          closedProfit,
          openTradesPnL
        }
      };
    } catch (error) {
      console.error('[Smart Goal] Error in getSessionProgress:', error);
      return null;
    }
  }

  async getSessionConversations(sessionId: string, limit: number = 50): Promise<any[]> {
    try {
      // Try to select all columns including optional ones
      const { data, error } = await supabase
        .from('goal_ai_conversations')
        .select('*')
        .eq('goal_session_id', sessionId)
        .order('created_at', { ascending: true })
        .limit(limit);

      if (error) {
        console.error('[Smart Goal] Error fetching conversations:', error);
        console.error('[Smart Goal] Error details:', JSON.stringify(error));

        // Try fallback with only core columns if error occurs
        console.log('[Smart Goal] Attempting fallback query without optional columns...');
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('goal_ai_conversations')
          .select('id, goal_session_id, user_id, role, message, context, sentiment, created_at')
          .eq('goal_session_id', sessionId)
          .order('created_at', { ascending: true })
          .limit(limit);

        if (fallbackError) {
          console.error('[Smart Goal] Fallback query also failed:', fallbackError);
          return [];
        }

        console.log('[Smart Goal] Fallback query succeeded, returning data');
        return fallbackData || [];
      }

      return data || [];
    } catch (error) {
      console.error('[Smart Goal] Exception in getSessionConversations:', error);
      return [];
    }
  }

  async stopSession(sessionId: string, userId: string): Promise<boolean> {
    try {
      console.log(`[Smart Goal] 🛑 Attempting to stop session ${sessionId} for user ${userId}`);

      // First, verify session exists and get current status
      const { data: existingSession, error: fetchError} = await supabase
        .from('goal_sessions')
        .select('id, status, user_id')
        .eq('id', sessionId)
        .eq('user_id', userId)
        .maybeSingle();

      if (fetchError) {
        console.error('[Smart Goal] ❌ Error fetching session:', fetchError);
        return false;
      }

      if (!existingSession) {
        console.error(`[Smart Goal] ❌ Session ${sessionId} not found for user ${userId}`);
        return false;
      }

      console.log(`[Smart Goal] 📊 Current session status: ${existingSession.status}`);

      // STEP 1: Stop live engine FIRST (before database update)
      // This ensures monitoring stops immediately
      if (goalSessionLiveEngine.getActiveSessionId() === sessionId) {
        console.log(`[Smart Goal] 🔌 Stopping live engine for session ${sessionId}`);
        const stopResult = await goalSessionLiveEngine.stopSession();
        if (stopResult.success) {
          console.log('[Smart Goal] ✅ Live engine stopped successfully');
        } else {
          console.error('[Smart Goal] ⚠️ Live engine stop returned error:', stopResult.message);
        }
      } else {
        console.log('[Smart Goal] Live engine not active for this session');
      }

      // STEP 2: Cancel any active entry intents
      const { data: activeIntents } = await supabase
        .from('entry_intents')
        .select('id')
        .eq('session_id', sessionId)
        .eq('status', 'monitoring');

      if (activeIntents && activeIntents.length > 0) {
        console.log(`[Smart Goal] 🚫 Canceling ${activeIntents.length} active entry intent(s)`);
        const { error: cancelError } = await supabase
          .from('entry_intents')
          .update({
            status: 'canceled',
            canceled_at: new Date().toISOString(),
            canceled_reason: 'session_stopped'
          })
          .eq('session_id', sessionId)
          .eq('status', 'monitoring');

        if (cancelError) {
          console.error('[Smart Goal] ⚠️ Error canceling entry intents:', cancelError);
        } else {
          console.log('[Smart Goal] ✅ Entry intents canceled');
        }
      }

      // STEP 3: Check for open trades
      const { data: openTrades } = await supabase
        .from('goal_session_trades')
        .select('id, symbol, status')
        .eq('goal_session_id', sessionId)
        .eq('status', 'open');

      if (openTrades && openTrades.length > 0) {
        console.warn(`[Smart Goal] ⚠️ UNEXPECTED: Session has ${openTrades.length} open trade(s):`);
        openTrades.forEach(t => console.warn(`  - ${t.symbol} (ID: ${t.id})`));
        console.warn('[Smart Goal] ⚠️ Trades should have been closed by UI before stopSession was called!');
        console.warn('[Smart Goal] This indicates a potential ghost trade situation - manual intervention may be needed');
      }

      // STEP 4: Clean up memory and timers BEFORE database update
      // This ensures the session is immediately removed from active tracking
      const session = this.activeSessions.get(sessionId);
      if (session) {
        session.status = 'user_stopped';
        console.log('[Smart Goal] Updated session in memory');
      }

      this.activeSessions.delete(sessionId);
      console.log('[Smart Goal] Removed session from active sessions map');

      const timer = this.scanTimers.get(sessionId);
      if (timer) {
        clearTimeout(timer);
        this.scanTimers.delete(sessionId);
        console.log('[Smart Goal] Cleared scan timer');
      }

      // STEP 5: Update database status LAST
      // This ensures all cleanup is done before triggering realtime subscriptions
      const { data: updated, error: updateError } = await supabase
        .from('goal_sessions')
        .update({
          status: 'user_stopped',
          completed_at: new Date().toISOString()
        })
        .eq('id', sessionId)
        .eq('user_id', userId)
        .select()
        .single();

      if (updateError) {
        console.error('[Smart Goal] ❌ Error updating session:', updateError);
        console.error('[Smart Goal] Error details:', {
          code: updateError.code,
          message: updateError.message,
          details: updateError.details,
          hint: updateError.hint
        });
        return false;
      }

      if (!updated) {
        console.error('[Smart Goal] ❌ Update returned no data - session may not exist or update failed');
        return false;
      }

      console.log(`[Smart Goal] ✅ Session ${sessionId} database status updated to: ${updated.status}`);
      console.log(`[Smart Goal] ✅ Session ${sessionId} stopped successfully by user`);
      return true;
    } catch (error) {
      console.error('[Smart Goal] ❌ Exception in stopSession:', error);
      return false;
    }
  }
}

export const smartGoalSessionManager = new SmartGoalSessionManager();
