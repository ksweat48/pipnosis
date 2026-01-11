/**
 * Entry Monitor Coordinator
 *
 * SSOT for the two-mode lifecycle:
 * 1. DISCOVERY_SCANNING - Multi-symbol evaluation with LLM allowed
 * 2. ENTRY_MONITOR - Single-symbol execution waiting with ZERO LLM
 *
 * This coordinator:
 * - Manages state transitions between modes
 * - Prevents global rescans during ENTRY_MONITOR
 * - Handles WAIT decisions from Alpha
 * - Integrates with goal-session-live-engine
 */

import { supabase } from '../lib/supabase';
import {
  EntryIntentData,
  EntryMonitorState,
  AbandonReason,
  MonitorCheckResult,
  createEntryIntentWithMonitoring,
  getActiveEntryIntent,
  cancelEntryIntent,
  markIntentExecuted,
  calculateAbandonZone,
  getEntryIntentById
} from './entry-intent-monitor-mode';
import { unifiedEntryMonitor, type MonitoringCallbacks } from './unified-entry-monitor';
import { TradeStyle } from './entry-monitor-quality-scorer';
import { entryMonitoringNotifications } from './entry-monitoring-notifications';
import { calculateEQSGrade } from '../utils/eqsHelpers';
import { tradeStyleRegistry } from './trade-style-registry';
import { logger } from '../lib/logger';
import { EntryPreFlightValidator } from './entry-preflight-validator';

export interface WaitDecisionData {
  symbol: string;
  direction: 'BUY' | 'SELL';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  reasoning: string;
  entryZone?: {
    min: number;
    max: number;
  };
  style?: TradeStyle;
  atr: number;
  maxWaitSeconds?: number;
  marketContext?: Record<string, any>;
}

export interface MonitorStateInfo {
  state: EntryMonitorState;
  lockedSymbol: string | null;
  lockedDirection: string | null;
  monitorStartedAt: Date | null;
  activeIntentId: string | null;
  secondsInMonitor: number;
  canScan: boolean;
  canCallLLM: boolean;
}

export interface ExecuteTradeCallback {
  (
    symbol: string,
    direction: 'BUY' | 'SELL',
    entry: number,
    stopLoss: number,
    takeProfit: number,
    lotSize: number,
    intentId: string
  ): Promise<{ success: boolean; tradeId?: string; error?: string }>;
}

class EntryMonitorCoordinator {
  private activeMonitors: Map<string, string> = new Map(); // Maps sessionId -> intentId
  private executeTradeCallback: ExecuteTradeCallback | null = null;
  private onRescanRequested: ((sessionId: string) => void) | null = null;
  private monitoringFailureCount: Map<string, number> = new Map(); // Track failures per session
  private lastFailureTime: Map<string, number> = new Map(); // Track last failure timestamp
  private abandonmentCount: Map<string, number> = new Map(); // Track abandonments per session for throttling
  private lastAbandonmentTime: Map<string, number> = new Map(); // Track last abandonment timestamp

  setExecuteTradeCallback(callback: ExecuteTradeCallback): void {
    this.executeTradeCallback = callback;
  }

  setRescanCallback(callback: (sessionId: string) => void): void {
    this.onRescanRequested = callback;
  }

  async getMonitorState(sessionId: string): Promise<MonitorStateInfo> {
    try {
      const { data, error } = await supabase.rpc('get_entry_monitor_state', {
        p_session_id: sessionId
      });

      if (error || !data || data.length === 0) {
        return {
          state: 'DISCOVERY_SCANNING',
          lockedSymbol: null,
          lockedDirection: null,
          monitorStartedAt: null,
          activeIntentId: null,
          secondsInMonitor: 0,
          canScan: true,
          canCallLLM: true
        };
      }

      const row = data[0];
      const state = row.state as EntryMonitorState || 'DISCOVERY_SCANNING';
      const canScan = state === 'DISCOVERY_SCANNING' || state === 'ABANDONED_RESCAN_REQUESTED';
      const canCallLLM = canScan;

      return {
        state,
        lockedSymbol: row.locked_symbol,
        lockedDirection: row.locked_direction,
        monitorStartedAt: row.monitor_started_at ? new Date(row.monitor_started_at) : null,
        activeIntentId: row.active_intent_id,
        secondsInMonitor: row.seconds_in_monitor || 0,
        canScan,
        canCallLLM
      };
    } catch (error) {
      console.error('[ENTRY_MONITOR_COORD] Failed to get state', sessionId, error);
      return {
        state: 'DISCOVERY_SCANNING',
        lockedSymbol: null,
        lockedDirection: null,
        monitorStartedAt: null,
        activeIntentId: null,
        secondsInMonitor: 0,
        canScan: true,
        canCallLLM: true
      };
    }
  }

  /**
   * Validate monitor state consistency and self-heal if needed
   *
   * Detects and fixes the deadlock scenario where:
   * - entry_monitor_state='ENTRY_MONITOR_ACTIVE' (or other non-scannable state)
   * - But no active intent exists (activeIntentId is null)
   *
   * This state inconsistency blocks all scanning permanently.
   */
  async validateAndHealState(sessionId: string): Promise<{ healed: boolean; reason?: string }> {
    try {
      const state = await this.getMonitorState(sessionId);

      // Check for the deadlock scenario
      const isInMonitorMode = state.state === 'ENTRY_MONITOR_ACTIVE' || state.state === 'EXECUTE_PENDING';
      const hasNoActiveIntent = !state.activeIntentId;

      if (isInMonitorMode && hasNoActiveIntent) {
        console.warn('[ENTRY_MONITOR_COORD] 🚨 STATE INCONSISTENCY DETECTED', {
          sessionId: sessionId.substring(0, 8),
          monitorState: state.state,
          activeIntentId: state.activeIntentId,
          lockedSymbol: state.lockedSymbol,
          canScan: state.canScan
        });

        // SELF-HEALING: Transition back to DISCOVERY_SCANNING
        await this.transitionState(sessionId, 'DISCOVERY_SCANNING');

        // Clear in-memory state if exists
        this.activeMonitors.delete(sessionId);

        console.log('[ENTRY_MONITOR_COORD] ✅ STATE HEALED - Transitioned to DISCOVERY_SCANNING', {
          sessionId: sessionId.substring(0, 8)
        });

        return {
          healed: true,
          reason: `Orphaned monitor state detected (${state.state} with no intent). Auto-corrected to DISCOVERY_SCANNING.`
        };
      }

      // State is consistent
      return { healed: false };
    } catch (error) {
      console.error('[ENTRY_MONITOR_COORD] Failed to validate/heal state:', error);
      return { healed: false, reason: `Validation failed: ${error}` };
    }
  }

  async canScanNow(sessionId: string): Promise<{ allowed: boolean; reason: string }> {
    // CRITICAL: Always validate state before checking if scan is allowed
    // This self-heals orphaned states that would otherwise block scanning forever
    const healResult = await this.validateAndHealState(sessionId);
    if (healResult.healed) {
      console.log('[ENTRY_MONITOR_COORD] 🔧 State was healed, scanning now allowed', {
        sessionId: sessionId.substring(0, 8),
        reason: healResult.reason
      });
    }

    const state = await this.getMonitorState(sessionId);

    if (state.canScan) {
      return { allowed: true, reason: 'In DISCOVERY_SCANNING mode' };
    }

    return {
      allowed: false,
      reason: `In ${state.state} mode - monitoring ${state.lockedSymbol} ${state.lockedDirection}. No global rescans allowed.`
    };
  }

  async isLLMAllowed(sessionId: string): Promise<boolean> {
    const state = await this.getMonitorState(sessionId);
    return state.canCallLLM;
  }

  async handleWaitDecision(
    sessionId: string,
    userId: string,
    decision: WaitDecisionData
  ): Promise<{ success: boolean; intentId?: string; error?: string }> {
    console.log('[ENTRY_MONITOR_COORD] Handling WAIT decision', sessionId, decision.symbol, decision.direction);

    const entryZoneMin = decision.entryZone?.min || (decision.entry - decision.atr * 0.3);
    const entryZoneMax = decision.entryZone?.max || (decision.entry + decision.atr * 0.3);

    // PRE-FLIGHT VALIDATION: Check if intent is viable before creation
    // This prevents creating intents that will be immediately abandoned (infinite loop fix)
    logger.info('[ENTRY_MONITOR_COORD] Running pre-flight validation', {
      symbol: decision.symbol,
      direction: decision.direction,
      entryZone: `${entryZoneMin.toFixed(5)} - ${entryZoneMax.toFixed(5)}`,
    });

    const preFlightResult = await EntryPreFlightValidator.validateBeforeCreation(
      userId,
      sessionId,
      decision.symbol,
      decision.direction,
      entryZoneMin,
      entryZoneMax,
      'M15'
    );

    // Handle pre-flight result (advisory system)
    if (!preFlightResult.is_viable) {
      // Only reject for data integrity issues (stale data, thesis expired, etc.)
      logger.warn('[ENTRY_MONITOR_COORD] Pre-flight REJECTED - Data integrity issue', {
        symbol: decision.symbol,
        direction: decision.direction,
        reason: preFlightResult.rejection_reason,
        message: preFlightResult.message,
      });

      console.log(
        '%c[ENTRY_MONITOR_COORD] ❌ INTENT REJECTED - Data integrity issue',
        'color: #f44336; font-weight: bold',
        {
          symbol: decision.symbol,
          direction: decision.direction,
          reason: preFlightResult.rejection_reason,
        }
      );

      return {
        success: false,
        error: `Entry intent rejected: ${preFlightResult.message}`,
      };
    }

    // Log advisory level (NOT a rejection - Alpha retains authority)
    const advisoryColor = {
      GREEN: '#4caf50',
      AMBER: '#ff9800',
      RED: '#f44336',
    }[preFlightResult.advisory_level];

    console.log(
      `%c[ENTRY_MONITOR_COORD] ${preFlightResult.advisory_level} Advisory`,
      `color: ${advisoryColor}; font-weight: bold`,
      {
        symbol: decision.symbol,
        direction: decision.direction,
        distanceATR: preFlightResult.distance_from_zone_atr?.toFixed(2),
        shouldConsultAlpha: preFlightResult.should_consult_alpha,
        message: preFlightResult.message,
      }
    );

    logger.info('[ENTRY_MONITOR_COORD] Pre-flight advisory received', {
      symbol: decision.symbol,
      advisoryLevel: preFlightResult.advisory_level,
      distanceATR: preFlightResult.distance_from_zone_atr?.toFixed(2),
      shouldConsultAlpha: preFlightResult.should_consult_alpha,
    });

    const maxWaitSeconds = decision.maxWaitSeconds ||
      this.calculateMaxWaitSeconds(decision.style || 'MICRO_INTRADAY', decision.confidence);

    const intent = await createEntryIntentWithMonitoring(
      sessionId,
      userId,
      decision.symbol,
      decision.direction === 'BUY' ? 'long' : 'short',
      entryZoneMin,
      entryZoneMax,
      decision.stopLoss,
      decision.takeProfit,
      decision.atr,
      decision.style || 'MICRO_INTRADAY',
      maxWaitSeconds,
      decision.reasoning,
      {
        ...decision.marketContext,
        confidence: decision.confidence,
        originalEntry: decision.entry
      },
      'immediate_momentum',
      preFlightResult.advisory_level  // Store advisory level for tracking and learning
    );

    if (!intent) {
      return { success: false, error: 'Failed to create entry intent' };
    }

    // CRITICAL: Update session status from 'scanning' to 'active'
    //
    // Why 'active'?
    // 1. UnifiedEntryMonitor validates session.status (not entry_monitor_state)
    // 2. Status 'active' indicates "actively monitoring for entry" (still live)
    // 3. Polling orchestrator recognizes 'active' as a protected status
    // 4. Prevents session from being terminated prematurely
    //
    // This keeps the session alive while entry monitor watches for perfect entry
    await supabase
      .from('goal_sessions')
      .update({ status: 'active' })
      .eq('id', sessionId);

    await this.transitionState(sessionId, 'ENTRY_INTENT_CREATED', decision.symbol, decision.direction);

    await this.startMonitoring(sessionId, userId, intent);

    return { success: true, intentId: intent.id };
  }

  private calculateMaxWaitSeconds(style: TradeStyle, confidence: number): number {
    const baseSeconds: Record<TradeStyle, number> = {
      SCALP: 180,
      MICRO_INTRADAY: 300,
      INTRADAY: 600
    };

    let seconds = baseSeconds[style] || 300;

    if (confidence >= 80) {
      seconds *= 0.7;
    } else if (confidence >= 70) {
      seconds *= 0.85;
    } else if (confidence < 60) {
      seconds *= 1.3;
    }

    return Math.round(seconds);
  }

  private async startMonitoring(sessionId: string, userId: string, intent: EntryIntentData): Promise<void> {
    if (this.activeMonitors.has(sessionId)) {
      console.warn('[ENTRY_MONITOR_COORD] Monitor already active for session', sessionId);
      await this.stopMonitoring(sessionId);
    }

    // Define callbacks for UnifiedEntryMonitor
    const callbacks: MonitoringCallbacks = {
      onExecute: async (intentId, price, eqs) => {
        await this.handleExecution(sessionId, userId, intentId, price, eqs);
      },
      onAbandon: async (intentId, reason) => {
        await this.handleAbandonment(sessionId, intentId, reason);
      }
    };

    // Store mapping and start monitoring via UnifiedEntryMonitor
    this.activeMonitors.set(sessionId, intent.id);
    await unifiedEntryMonitor.startMonitoring(intent.id, userId, callbacks);

    console.log('[ENTRY_MONITOR_COORD] Monitoring started via UnifiedEntryMonitor', sessionId, intent.id, intent.symbol);

    // Transition state to ENTRY_MONITOR_ACTIVE for session resumption
    await this.transitionState(sessionId, 'ENTRY_MONITOR_ACTIVE');
    console.log('[ENTRY_MONITOR_COORD] State transitioned to ENTRY_MONITOR_ACTIVE', sessionId);

    // Send monitoring started notification
    const marketContext = intent.market_context as any || {};
    const confidence = marketContext.confidence || 70;
    const currentEQS = marketContext.current_eqs || 0;
    const style = intent.style || 'MICRO_INTRADAY';
    const styleConfig = tradeStyleRegistry.getConfig(style);
    const currentGrade = calculateEQSGrade(currentEQS);
    const requiredGrade = calculateEQSGrade(styleConfig.eqsThreshold);

    await entryMonitoringNotifications.sendMonitoringStarted({
      userId,
      sessionId,
      intentId: intent.id,
      symbol: intent.symbol,
      direction: intent.direction === 'long' ? 'BUY' : 'SELL',
      entryZoneMin: intent.entry_zone_min,
      entryZoneMax: intent.entry_zone_max,
      stopLoss: intent.invalidation_price,
      takeProfit: marketContext.takeProfit || 0,
      currentEQS,
      requiredEQS: styleConfig.eqsThreshold,
      currentGrade,
      requiredGrade,
      confidence,
      style: style as TradeStyle,
      maxWaitSeconds: intent.max_wait_seconds,
      reasoning: intent.reasoning
    });
  }

  async stopMonitoring(sessionId: string): Promise<void> {
    const intentId = this.activeMonitors.get(sessionId);
    if (intentId) {
      await unifiedEntryMonitor.stopMonitoring(intentId);
      this.activeMonitors.delete(sessionId);
      console.log('[ENTRY_MONITOR_COORD] Monitoring stopped', sessionId, intentId);
    }

    // CRITICAL FIX: Always clean up database state to prevent deadlock
    // If monitor stops but database state isn't cleared, system gets stuck
    // with entry_monitor_state='ENTRY_MONITOR_ACTIVE' but no active intent
    try {
      await this.transitionState(sessionId, 'DISCOVERY_SCANNING');
      console.log('[ENTRY_MONITOR_COORD] ✓ Database state cleaned up', sessionId.substring(0, 8));
    } catch (error) {
      console.error('[ENTRY_MONITOR_COORD] Failed to clean up database state:', error);
      // Don't throw - monitoring already stopped, this is just cleanup
    }
  }

  private async handleExecution(
    sessionId: string,
    userId: string,
    intentId: string,
    price: number,
    eqs: number
  ): Promise<void> {
    console.log('[ENTRY_MONITOR_COORD] Executing trade from entry monitor', sessionId, intentId, price, eqs);

    const intent = await this.getIntentById(intentId);
    if (!intent) {
      console.error('[ENTRY_MONITOR_COORD] Intent not found for execution', intentId);
      return;
    }

    // Send EQS ready notification
    const style = intent.style || 'MICRO_INTRADAY';
    const styleConfig = tradeStyleRegistry.getConfig(style);
    const grade = calculateEQSGrade(eqs);

    await entryMonitoringNotifications.sendEQSReady({
      userId,
      sessionId,
      intentId,
      symbol: intent.symbol,
      direction: intent.direction === 'long' ? 'BUY' : 'SELL',
      eqs,
      grade,
      requiredEQS: styleConfig.eqsThreshold,
      executionPrice: price
    });

    // CRITICAL FIX: Record execution attempt BEFORE state transition
    // This allows tracking and debugging of execution flow
    const direction = intent.direction === 'long' ? 'BUY' : 'SELL';
    const stopLoss = intent.market_context?.stopLoss || intent.invalidation_price || price * 0.99;
    const takeProfit = intent.market_context?.takeProfit || price * 1.02;
    const lotSize = 0.01;

    let attemptId: string | null = null;
    try {
      const { data: attemptData, error: attemptError } = await supabase.rpc('record_execution_attempt', {
        p_session_id: sessionId,
        p_intent_id: intentId,
        p_user_id: userId,
        p_symbol: intent.symbol,
        p_direction: direction,
        p_entry_price: price,
        p_stop_loss: stopLoss as number,
        p_take_profit: takeProfit as number,
        p_lot_size: lotSize,
        p_eqs_score: eqs
      });

      if (attemptError) {
        console.warn('[ENTRY_MONITOR_COORD] Failed to record attempt', attemptError);
      } else {
        attemptId = attemptData;
      }
    } catch (error) {
      console.warn('[ENTRY_MONITOR_COORD] Exception recording attempt', error);
    }

    // CRITICAL FIX: Execute trade BEFORE transitioning to EXECUTE_PENDING
    // This prevents deadlock where EXECUTE_PENDING state blocks trade insertion
    if (this.executeTradeCallback) {
      console.log('[ENTRY_MONITOR_COORD] Calling executeTradeCallback (trade insertion)', {
        sessionId: sessionId.substring(0, 8),
        symbol: intent.symbol,
        direction,
        price,
        eqs
      });

      let result;
      let retryCount = 0;
      const maxRetries = 3;

      // Retry logic for transient failures
      while (retryCount < maxRetries) {
        try {
          result = await this.executeTradeCallback(
            intent.symbol,
            direction as 'BUY' | 'SELL',
            price,
            stopLoss as number,
            takeProfit as number,
            lotSize,
            intentId
          );

          // If successful, break retry loop
          if (result.success) {
            break;
          }

          // If not successful, check if should retry
          retryCount++;
          if (retryCount < maxRetries) {
            const isTransient = result.error?.includes('timeout') ||
                              result.error?.includes('network') ||
                              result.error?.includes('temporary');

            if (isTransient) {
              console.warn(`[ENTRY_MONITOR_COORD] Transient failure, retrying (${retryCount}/${maxRetries})`, result.error);
              await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // Exponential backoff
              continue;
            } else {
              // Non-transient error, don't retry
              break;
            }
          }
        } catch (error) {
          console.error('[ENTRY_MONITOR_COORD] Exception during execution', error);
          result = { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
          retryCount++;

          if (retryCount < maxRetries) {
            console.warn(`[ENTRY_MONITOR_COORD] Exception, retrying (${retryCount}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
          }
        }
      }

      // CRITICAL: Only transition state AFTER trade insertion succeeds or definitively fails
      if (result && result.success) {
        console.log('[ENTRY_MONITOR_COORD] ✅ Trade inserted successfully, now transitioning state', {
          sessionId: sessionId.substring(0, 8),
          tradeId: result.tradeId
        });

        // Mark intent as executed
        await markIntentExecuted(intentId, price);

        // NOW transition to TRADE_ACTIVE (after successful insertion)
        await this.transitionState(sessionId, 'TRADE_ACTIVE');

        // Complete execution attempt with success
        if (attemptId) {
          try {
            await supabase.rpc('complete_execution_attempt', {
              p_attempt_id: attemptId,
              p_success: true,
              p_trade_id: result.tradeId,
              p_state_after: 'TRADE_ACTIVE'
            });
          } catch (error) {
            console.warn('[ENTRY_MONITOR_COORD] Failed to complete attempt log', error);
          }
        }

        console.log('[ENTRY_MONITOR_COORD] Trade executed successfully', sessionId, intentId, result.tradeId);
      } else {
        console.error('[ENTRY_MONITOR_COORD] ❌ Trade execution failed after retries', {
          sessionId: sessionId.substring(0, 8),
          error: result?.error,
          retries: retryCount
        });

        // Complete execution attempt with failure
        if (attemptId) {
          try {
            await supabase.rpc('complete_execution_attempt', {
              p_attempt_id: attemptId,
              p_success: false,
              p_error_message: result?.error || 'Unknown error',
              p_state_after: 'ENTRY_MONITOR_ACTIVE' // Stay in monitoring state
            });
          } catch (error) {
            console.warn('[ENTRY_MONITOR_COORD] Failed to complete attempt log', error);
          }
        }

        await this.handleAbandonment(sessionId, intentId, 'ORDER_REJECTED');
      }
    } else {
      console.warn('[ENTRY_MONITOR_COORD] No execute trade callback configured');
      await markIntentExecuted(intentId, price);
      await this.transitionState(sessionId, 'TRADE_ACTIVE');

      // Complete execution attempt
      if (attemptId) {
        try {
          await supabase.rpc('complete_execution_attempt', {
            p_attempt_id: attemptId,
            p_success: true,
            p_state_after: 'TRADE_ACTIVE'
          });
        } catch (error) {
          console.warn('[ENTRY_MONITOR_COORD] Failed to complete attempt log', error);
        }
      }
    }
  }

  private async handleAbandonment(
    sessionId: string,
    intentId: string,
    reason: AbandonReason
  ): Promise<void> {
    console.log('[ENTRY_MONITOR_COORD] Handling abandonment', sessionId, intentId, reason);

    const intent = await this.getIntentById(intentId);

    if (intent) {
      const marketContext = intent.market_context as any || {};
      const currentEQS = marketContext.current_eqs || 0;
      const style = intent.style || 'MICRO_INTRADAY';
      const styleConfig = tradeStyleRegistry.getConfig(style);
      const currentGrade = calculateEQSGrade(currentEQS);

      const createdAt = new Date(intent.created_at);
      const now = new Date();
      const durationSeconds = Math.floor((now.getTime() - createdAt.getTime()) / 1000);

      const { data: session } = await supabase
        .from('goal_sessions')
        .select('user_id')
        .eq('id', sessionId)
        .maybeSingle();

      if (session) {
        await entryMonitoringNotifications.sendMonitoringAbandoned({
          userId: session.user_id,
          sessionId,
          intentId,
          symbol: intent.symbol,
          direction: intent.direction === 'long' ? 'BUY' : 'SELL',
          reason,
          eqs: currentEQS,
          grade: currentGrade,
          requiredEQS: styleConfig.eqsThreshold,
          durationSeconds
        });
      }
    }

    await cancelEntryIntent(intentId, `Abandoned: ${reason}`);
    await this.stopMonitoring(sessionId);

    // NEW SSOT FLOW: Request continuation decision from user
    // request_session_continuation() handles state changes:
    // - Sets status='awaiting_continuation' (pauses session)
    // - Sets entry_monitor_state='ABANDONED_RESCAN_REQUESTED'
    // - Creates modal and notification
    console.log('[ENTRY_MONITOR_COORD] 📋 Requesting continuation decision from user', {
      sessionId: sessionId.substring(0, 8),
      reason
    });

    try {
      const { data, error } = await supabase.rpc('request_session_continuation', {
        p_session_id: sessionId,
        p_reason: reason
      });

      if (error) {
        console.error('[ENTRY_MONITOR_COORD] Failed to request continuation:', error);
        // Fallback: auto-schedule rescan if continuation request fails
        await this.fallbackAutoRescan(sessionId, reason);
        return;
      }

      console.log('[ENTRY_MONITOR_COORD] ✅ Continuation modal created', {
        sessionId: sessionId.substring(0, 8),
        deadline: data.deadline,
        secondsRemaining: data.seconds_remaining
      });

      // Modal will be shown by SessionContinuationHandler component
      // User has 60 seconds to decide: continue or close
      // If no response, session auto-closes via auto_close_expired_continuations
    } catch (error) {
      console.error('[ENTRY_MONITOR_COORD] Exception requesting continuation:', error);
      // Fallback: auto-schedule rescan
      await this.fallbackAutoRescan(sessionId, reason);
    }
  }

  /**
   * Fallback auto-rescan when continuation request fails
   * Safety mechanism to prevent sessions from getting stuck
   */
  private async fallbackAutoRescan(sessionId: string, reason: AbandonReason): Promise<void> {
    console.warn('[ENTRY_MONITOR_COORD] Using fallback auto-rescan', {
      sessionId: sessionId.substring(0, 8),
      reason
    });

    // Simple 30-second rescan schedule
    const nextScanTime = new Date(Date.now() + 30000);

    // CRITICAL FIX: Transition monitor state to allow scanning
    // Without this, entry_monitor_state stays 'ENTRY_MONITOR_ACTIVE'
    // and blocks all future scans (deadlock)
    try {
      await this.transitionState(sessionId, 'DISCOVERY_SCANNING');
      console.log('[ENTRY_MONITOR_COORD] ✓ Monitor state transitioned to DISCOVERY_SCANNING');
    } catch (error) {
      console.error('[ENTRY_MONITOR_COORD] Failed to transition monitor state:', error);
      // Continue anyway - better to try scanning with potentially wrong state
      // than to be permanently stuck
    }

    await supabase
      .from('goal_sessions')
      .update({
        status: 'scanning',
        next_scan_time: nextScanTime.toISOString(),
        last_scan_time: new Date().toISOString()
      })
      .eq('id', sessionId);

    console.log('[ENTRY_MONITOR_COORD] 🚀 Fallback rescan scheduled', {
      sessionId: sessionId.substring(0, 8),
      nextScanTime: nextScanTime.toLocaleTimeString()
    });

    if (this.onRescanRequested) {
      this.onRescanRequested(sessionId);
    }
  }

  private handleMonitorLog(sessionId: string, intentId: string, log: MonitorCheckResult): void {
    if (log.decision !== 'CONTINUE_WAITING' || log.inEntryZone) {
      if (import.meta.env.DEV) {
        console.log('[ENTRY_MONITOR] Check', {
          sessionId,
          intentId,
          price: log.currentPrice,
          inZone: log.inEntryZone,
          eqs: log.eqs?.score,
          decision: log.decision
        });
      }
    }
  }

  private async transitionState(
    sessionId: string,
    newState: EntryMonitorState,
    lockedSymbol?: string,
    lockedDirection?: string
  ): Promise<void> {
    try {
      const { error } = await supabase.rpc('transition_entry_monitor_state', {
        p_session_id: sessionId,
        p_new_state: newState,
        p_locked_symbol: lockedSymbol || null,
        p_locked_direction: lockedDirection || null
      });

      if (error) {
        console.error('[ENTRY_MONITOR_COORD] State transition failed', sessionId, newState, error.message);
      } else {
        console.log('[ENTRY_MONITOR_COORD] State transitioned', sessionId, newState, lockedSymbol, lockedDirection);
      }
    } catch (error) {
      console.error('[ENTRY_MONITOR_COORD] State transition error', error);
    }
  }

  /**
   * Get intent by ID - DELEGATES TO SSOT
   * Uses getEntryIntentById from entry-intent-monitor-mode.ts
   */
  private async getIntentById(intentId: string): Promise<EntryIntentData | null> {
    return await getEntryIntentById(intentId);
  }

  /**
   * Track monitoring failure and trigger automatic fallback if needed
   * After 3 consecutive failures within 60 seconds, abandon and rescan
   */
  private async trackMonitoringFailure(sessionId: string, intentId: string): Promise<void> {
    const now = Date.now();
    const lastFailure = this.lastFailureTime.get(sessionId) || 0;
    const failureCount = this.monitoringFailureCount.get(sessionId) || 0;

    // Reset counter if last failure was more than 60 seconds ago
    if (now - lastFailure > 60000) {
      this.monitoringFailureCount.set(sessionId, 1);
      this.lastFailureTime.set(sessionId, now);
      logger.warn(`[ENTRY_MONITOR_COORD] Monitoring failure for session ${sessionId} (1/3)`);
      return;
    }

    // Increment failure count
    const newCount = failureCount + 1;
    this.monitoringFailureCount.set(sessionId, newCount);
    this.lastFailureTime.set(sessionId, now);

    logger.warn(`[ENTRY_MONITOR_COORD] Monitoring failure for session ${sessionId} (${newCount}/3)`);

    // After 3 failures, force abandonment and rescan
    if (newCount >= 3) {
      console.error(
        '%c[ENTRY_MONITOR_COORD] 🚨 MONITORING FAILED 3 TIMES',
        'color: #f44336; font-weight: bold',
        {
          sessionId,
          intentId,
          message: 'Abandoning monitoring and returning to market scan'
        }
      );

      logger.error(`[ENTRY_MONITOR_COORD] Auto-abandoning ${intentId} after 3 failures`);

      // Reset counters
      this.monitoringFailureCount.delete(sessionId);
      this.lastFailureTime.delete(sessionId);

      // Abandon and trigger rescan
      await this.handleAbandonment(sessionId, intentId, 'MANUAL_CANCEL');
    }
  }

  async resumeMonitoringIfNeeded(sessionId: string, userId: string): Promise<void> {
    const state = await this.getMonitorState(sessionId);

    if (state.state === 'ENTRY_MONITOR_ACTIVE' && state.activeIntentId) {
      const intent = await this.getIntentById(state.activeIntentId);
      if (intent && intent.status === 'monitoring') {
        console.log('[ENTRY_MONITOR_COORD] Resuming monitoring after page reload', sessionId, state.activeIntentId);
        await this.startMonitoring(sessionId, userId, intent);
      }
    }
  }

  async forceRescan(sessionId: string): Promise<void> {
    console.log('[ENTRY_MONITOR_COORD] Force rescan requested', sessionId);

    await this.stopMonitoring(sessionId);

    const activeIntent = await getActiveEntryIntent(sessionId);
    if (activeIntent) {
      await cancelEntryIntent(activeIntent.id, 'Manual force rescan');
    }

    await this.transitionState(sessionId, 'DISCOVERY_SCANNING');

    if (this.onRescanRequested) {
      this.onRescanRequested(sessionId);
    }
  }

  async cleanupSession(sessionId: string): Promise<void> {
    console.log('[ENTRY_MONITOR_COORD] Cleaning up session', sessionId);
    await this.stopMonitoring(sessionId);
    await this.transitionState(sessionId, 'DISCOVERY_SCANNING');
  }
}

export const entryMonitorCoordinator = new EntryMonitorCoordinator();
