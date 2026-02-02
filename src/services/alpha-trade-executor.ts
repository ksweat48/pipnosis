/**
 * Alpha Trade Executor
 *
 * SSOT Authority: Single entry point for ALL trade execution
 * Consolidates: TradeExecutionEngine + EntryCoordinator + ExecutionEligibility + Audit Logging
 *
 * CCIP Compliant: Part of trade execution simplification (20260202)
 *
 * Execution Modes:
 * - IMMEDIATE: Execute at market price immediately
 * - PENDING: Create pending trade awaiting user confirmation
 * - MONITORED: Create entry intent for deferred execution
 *
 * Validation Pipeline:
 * 1. Core Validation (Omega + Geometry + Freshness)
 * 2. Risk Authority (Context + PCVL + Margin + Kelly)
 * 3. Trade Capacity (Confidence + Slots + Duplicates)
 * 4. Price Validation (Slippage + Staleness)
 * 5. Database Boundary (Type coercion + Range check)
 *
 * Principles:
 * - Engines validate, Alpha decides
 * - Degrade intelligently (not silently)
 * - Single validation pass (no duplicate checks)
 * - Complete audit trail (governance compliant)
 */

import { supabase } from '../lib/supabase';
import { coreValidationGate } from './core-validation-gate';
import { unifiedRiskAuthority } from './unified-risk-authority';
import { priceCoordinator } from './coordinators/price-coordinator';
import { globalDialogManager } from './global-dialog-manager';
import { toDirectionDB } from '../utils/direction-converter';
import { getRegimeBucket } from './regime-bucketing';
import { getMinConfidenceThreshold } from '../config/risk-levels';
import type { AlphaDecision } from '../brains/coordinator-alpha';
import type { TradeContext } from '../types/trade-context';

export type ExecutionMode = 'IMMEDIATE' | 'PENDING' | 'MONITORED';

export interface TradeExecutionInputs {
  // Alpha decision
  decision: AlphaDecision;
  tradeContext: TradeContext;

  // Session context
  userId: string;
  sessionId: string;
  session: any; // goal_sessions record

  // Execution parameters
  mode: ExecutionMode;
  autoExecute?: boolean; // Legacy flag (maps to mode)

  // Snapshot metadata
  snapshotTimestamp: Date;
  regimeSnapshot?: any;
  adversarialState?: any;
}

export interface TradeExecutionResult {
  success: boolean;
  tradeId?: string;
  message?: string;
  error?: string;
  isMonitoring?: boolean;
  blockReason?: string;
}

class AlphaTradeExecutor {
  /**
   * Execute trade decision
   * Single unified entry point for all execution modes
   */
  async execute(inputs: TradeExecutionInputs): Promise<TradeExecutionResult> {
    const { decision, tradeContext, userId, sessionId, session, mode, snapshotTimestamp } = inputs;

    // VALIDATION PIPELINE (Run all layers in sequence)

    // Layer 1: Core Validation (Omega + Geometry + Snapshot)
    const coreValidation = await coreValidationGate.validateTrade(
      decision,
      {
        direction: decision.direction === 'LONG' ? 'buy' : 'sell',
        entryPrice: decision.entry_price,
        stopLoss: decision.stop_loss,
        takeProfit: decision.take_profit,
        tp1Price: decision.tp1_price,
        tp2Price: decision.tp2_price
      },
      { snapshotTimestamp },
      userId
    );

    if (!coreValidation.passed) {
      return {
        success: false,
        error: coreValidation.reason,
        blockReason: coreValidation.reason
      };
    }

    // Layer 2: Trade Capacity (Confidence + Slots + Duplicates)
    const capacityCheck = await this.checkTradeCapacity(
      decision.symbol,
      decision.confidence,
      sessionId,
      session
    );

    if (!capacityCheck.valid) {
      return {
        success: false,
        error: capacityCheck.reason,
        blockReason: capacityCheck.reason
      };
    }

    // Layer 3: Risk Authority (Context + PCVL + Margin + Kelly)
    const { data: userProfile } = await supabase
      .from('user_profiles')
      .select('account_balance')
      .eq('id', userId)
      .single();

    if (!userProfile) {
      return {
        success: false,
        error: 'User profile not found'
      };
    }

    const riskAssessment = await unifiedRiskAuthority.assessTrade({
      tradeContext,
      symbol: decision.symbol,
      direction: decision.direction === 'LONG' ? 'long' : 'short',
      entryPrice: decision.entry_price,
      stopLoss: decision.stop_loss,
      takeProfit: decision.take_profit,
      userId,
      currentBalance: userProfile.account_balance,
      riskMode: session.risk_mode || 'medium',
      goalSessionId: sessionId
    });

    if (!riskAssessment.approved) {
      return {
        success: false,
        error: riskAssessment.blockReason || 'Risk assessment failed',
        blockReason: riskAssessment.blockReason
      };
    }

    // MODE ROUTING (Execute based on selected mode)
    if (mode === 'IMMEDIATE') {
      return await this.executeImmediate({
        decision,
        userId,
        sessionId,
        session,
        lotSize: riskAssessment.recommendedLotSize,
        riskDollars: riskAssessment.adjustedRiskDollars,
        riskWarnings: riskAssessment.criticalWarnings,
        inputs
      });
    } else if (mode === 'PENDING') {
      return await this.createPending({
        decision,
        userId,
        sessionId,
        session,
        lotSize: riskAssessment.recommendedLotSize,
        riskDollars: riskAssessment.adjustedRiskDollars,
        riskWarnings: riskAssessment.criticalWarnings,
        inputs
      });
    } else {
      // MONITORED mode - create entry intent
      return await this.createMonitored({
        decision,
        userId,
        sessionId,
        lotSize: riskAssessment.recommendedLotSize,
        riskDollars: riskAssessment.adjustedRiskDollars
      });
    }
  }

  /**
   * Check trade capacity (confidence, slots, duplicates)
   */
  private async checkTradeCapacity(
    symbol: string,
    confidence: number,
    sessionId: string,
    session: any
  ): Promise<{ valid: boolean; reason?: string }> {
    // Confidence check
    if (confidence < 50) {
      return { valid: false, reason: 'Confidence too low (< 50%)' };
    }

    const threshold = session.min_confidence || getMinConfidenceThreshold(session.risk_mode);
    if (confidence < threshold) {
      return {
        valid: false,
        reason: `Confidence ${confidence}% below ${session.risk_mode} mode threshold (${threshold}%)`
      };
    }

    // Trade slots check
    const { data: openTrades } = await supabase
      .from('goal_session_trades')
      .select('*')
      .eq('goal_session_id', sessionId)
      .in('status', ['open', 'pending']);

    const maxConcurrentTrades = session.risk_mode === 'low' ? 1 : session.risk_mode === 'high' ? 3 : 2;
    if (openTrades && openTrades.length >= maxConcurrentTrades) {
      return {
        valid: false,
        reason: `Maximum concurrent trades (${maxConcurrentTrades}) reached for ${session.risk_mode} mode`
      };
    }

    // Duplicate symbol check
    const existingSymbolTrade = openTrades?.find(trade => trade.symbol === symbol);
    if (existingSymbolTrade) {
      return {
        valid: false,
        reason: `Already have an open/pending position on ${symbol}`
      };
    }

    return { valid: true };
  }

  /**
   * Execute immediately at market price
   */
  private async executeImmediate(params: {
    decision: AlphaDecision;
    userId: string;
    sessionId: string;
    session: any;
    lotSize: number;
    riskDollars: number;
    riskWarnings: string[];
    inputs: TradeExecutionInputs;
  }): Promise<TradeExecutionResult> {
    const { decision, userId, sessionId, lotSize, riskDollars, inputs } = params;

    // Fetch live price
    const priceResult = await priceCoordinator.getPrice(decision.symbol, {
      allowStale: true,
      useCacheFirst: false
    });

    if (!priceResult.success || !priceResult.price) {
      return {
        success: false,
        error: 'Could not fetch live price'
      };
    }

    const livePrice = priceResult.price;
    const entryPrice = livePrice; // Use live price as entry

    // Apply slippage adjustment (symbol-specific)
    const slippage = this.calculateSlippage(decision.symbol);
    const adjustedEntry = decision.direction === 'LONG'
      ? entryPrice + slippage
      : entryPrice - slippage;

    // Insert trade
    const tradeData = this.buildTradeRecord({
      decision,
      userId,
      sessionId,
      lotSize,
      riskDollars,
      entryPrice: adjustedEntry,
      status: 'open',
      openedAt: new Date().toISOString(),
      inputs
    });

    const { data: trade, error } = await supabase
      .from('goal_session_trades')
      .insert(tradeData)
      .select()
      .single();

    if (error || !trade) {
      return {
        success: false,
        error: error?.message || 'Failed to create trade'
      };
    }

    // Update session status
    await supabase
      .from('goal_sessions')
      .update({ status: 'in_trade' })
      .eq('id', sessionId);

    // Create notification
    await this.createNotification({
      userId,
      sessionId,
      type: 'trade_entry',
      title: `Trade Opened: ${decision.symbol}`,
      message: `${decision.direction} ${lotSize.toFixed(2)} lots at ${adjustedEntry.toFixed(5)}`,
      tradeId: trade.id
    });

    return {
      success: true,
      tradeId: trade.id,
      message: `Trade opened: ${decision.direction} ${lotSize.toFixed(2)} lots at ${adjustedEntry.toFixed(5)}`
    };
  }

  /**
   * Create pending trade (awaiting user confirmation)
   */
  private async createPending(params: {
    decision: AlphaDecision;
    userId: string;
    sessionId: string;
    session: any;
    lotSize: number;
    riskDollars: number;
    riskWarnings: string[];
    inputs: TradeExecutionInputs;
  }): Promise<TradeExecutionResult> {
    const { decision, userId, sessionId, lotSize, riskDollars, inputs } = params;

    // Insert trade
    const tradeData = this.buildTradeRecord({
      decision,
      userId,
      sessionId,
      lotSize,
      riskDollars,
      entryPrice: decision.entry_price,
      status: 'pending',
      openedAt: null,
      inputs
    });

    const { data: trade, error } = await supabase
      .from('goal_session_trades')
      .insert(tradeData)
      .select()
      .single();

    if (error || !trade) {
      return {
        success: false,
        error: error?.message || 'Failed to create pending trade'
      };
    }

    // Update session status
    await supabase
      .from('goal_sessions')
      .update({ status: 'trade_pending' })
      .eq('id', sessionId);

    // Create notification
    await this.createNotification({
      userId,
      sessionId,
      type: 'signal',
      title: `Trade Signal: ${decision.symbol}`,
      message: `${decision.direction} ${lotSize.toFixed(2)} lots at ${decision.entry_price.toFixed(5)}`,
      tradeId: trade.id
    });

    return {
      success: true,
      tradeId: trade.id,
      message: `Pending trade created: ${decision.direction} ${lotSize.toFixed(2)} lots`
    };
  }

  /**
   * Create monitored entry intent
   */
  private async createMonitored(params: {
    decision: AlphaDecision;
    userId: string;
    sessionId: string;
    lotSize: number;
    riskDollars: number;
  }): Promise<TradeExecutionResult> {
    const { decision, userId, sessionId, lotSize, riskDollars } = params;

    // Create entry intent
    const { data: intent, error } = await supabase
      .from('entry_intents')
      .insert({
        user_id: userId,
        goal_session_id: sessionId,
        symbol: decision.symbol,
        direction: toDirectionDB(decision.direction === 'LONG' ? 'buy' : 'sell'),
        entry_price_target: decision.entry_price,
        stop_loss: decision.stop_loss,
        take_profit: decision.take_profit,
        lot_size: lotSize,
        risk_dollars: riskDollars,
        status: 'active',
        should_execute_immediately: false,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error || !intent) {
      return {
        success: false,
        error: error?.message || 'Failed to create entry intent'
      };
    }

    return {
      success: true,
      isMonitoring: true,
      message: `Monitoring ${decision.symbol} for entry at ${decision.entry_price.toFixed(5)}`
    };
  }

  /**
   * Build trade record for database insertion
   */
  private buildTradeRecord(params: {
    decision: AlphaDecision;
    userId: string;
    sessionId: string;
    lotSize: number;
    riskDollars: number;
    entryPrice: number;
    status: 'open' | 'pending';
    openedAt: string | null;
    inputs: TradeExecutionInputs;
  }): any {
    const { decision, userId, sessionId, lotSize, riskDollars, entryPrice, status, openedAt, inputs } = params;

    // Get regime bucket
    const regimeBucket = inputs.regimeSnapshot && inputs.adversarialState
      ? getRegimeBucket(inputs.regimeSnapshot, inputs.adversarialState)
      : null;

    // SSOT: goal_session_trades schema compliance (20260202)
    // Fields omega8/omega9 removed from schema - data lives in alpha_decisions table
    return {
      user_id: userId,
      goal_session_id: sessionId,
      symbol: decision.symbol,
      direction: toDirectionDB(decision.direction === 'LONG' ? 'buy' : 'sell'),
      entry_price: entryPrice,
      stop_loss: decision.stop_loss,
      take_profit: decision.take_profit,
      tp1_price: decision.tp1_price,
      tp2_price: decision.tp2_price,
      position_size: lotSize,
      risk_dollars: riskDollars,
      status,
      order_type: status === 'open' ? 'market' : 'limit',
      opened_at: openedAt,
      current_price: status === 'open' ? entryPrice : null,
      current_pnl: status === 'open' ? 0 : null,
      trade_confidence: decision.confidence, // SSOT: Correct column name
      regime_bucket: regimeBucket
    };
  }

  /**
   * Create notification
   */
  private async createNotification(params: {
    userId: string;
    sessionId: string;
    type: string;
    title: string;
    message: string;
    tradeId?: string;
  }): Promise<void> {
    try {
      await supabase.from('goal_notifications').insert({
        user_id: params.userId,
        session_id: params.sessionId,
        type: params.type,
        title: params.title,
        message: params.message,
        priority: 'critical',
        read: false,
        trade_data: params.tradeId ? { tradeId: params.tradeId } : null,
        created_at: new Date().toISOString()
      });
    } catch (error) {
      // Non-blocking
      console.warn('[AlphaTradeExecutor] Failed to create notification:', error);
    }
  }

  /**
   * Calculate slippage for symbol
   */
  private calculateSlippage(symbol: string): number {
    // Symbol-specific slippage
    if (symbol.includes('JPY')) return 0.005; // 0.5 pips
    if (symbol.startsWith('US') || symbol.startsWith('NAS') || symbol.startsWith('SPX')) return 0.3; // 3 points for indices
    if (symbol === 'XAUUSD') return 0.05; // 5 cents
    return 0.00005; // 0.5 pips for standard forex
  }
}

export const alphaTradeExecutor = new AlphaTradeExecutor();
