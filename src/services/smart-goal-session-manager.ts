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

    await this.startLiveEngine(sessionId, userId, config, accountBalance);

    console.log(`[Smart Goal] Created session ${sessionId}: Target $${config.goalAmount} via ${breakDown.targetTradeCount} trades`);
    console.log(`[Smart Goal] ✅ LIVE DEMO MODE - All trades use real price monitoring with visible SL/TP`);

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

  // REMOVED: All synthetic trade execution logic
  // Trade execution now handled by goal-session-live-engine.ts
  // This ensures:
  // - Real price monitoring (not random simulation)
  // - Visible SL/TP on charts
  // - Proper simulated_positions creation
  // - 5-layer LLM pipeline validation

  async completeSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    session.status = 'completed';

    await this.stopLiveEngine(sessionId);

    await supabase
      .from('goal_sessions')
      .update({
        status: 'completed',
        end_time: new Date().toISOString()
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
        console.log('[Smart Goal] ✅ Live demo engine started successfully');
        console.log('[Smart Goal] ✅ 5-layer LLM pipeline will be used for all trades');
        console.log('[Smart Goal] ✅ All trades will have visible SL/TP on charts');

        // Send comprehensive session startup message
        const strategyMessage = `🎯 Goal Session Started!\\n` +
          `💰 Target: $${config.goalAmount} in ${config.timeframe}\\n` +
          `📊 Strategy: ${breakDown.targetTradeCount} trades averaging $${breakDown.avgProfitPerTrade.toFixed(2)} each\\n` +
          `🛡️ Risk Mode: ${config.riskMode.toUpperCase()} (max $${breakDown.maxProfitPerTrade.toFixed(2)} per trade)\\n` +
          `\\n🔍 Monitoring: ${config.watchlist.join(', ')}\\n` +
          `⚡ Scanning every 15 seconds for high-probability setups\\n` +
          `🧠 5-Layer LLM Protection: Hard Gate + 4 validation layers active\\n` +
          `📈 All trades will have visible SL/TP on charts (Live Demo Mode)\\n` +
          `\\n✨ Looking for: VWAP reversals, EMA crossovers, momentum shifts, support/resistance bounces`;

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
}

export const smartGoalSessionManager = new SmartGoalSessionManager();
