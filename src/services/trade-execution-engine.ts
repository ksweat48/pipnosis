/**
 * Trade Execution Engine (Legacy Wrapper)
 *
 * DEPRECATED: This file now delegates to the new simplified execution architecture.
 * Maintained for backward compatibility with goal-session-live-engine.
 *
 * New Architecture:
 * - CoreValidationGate: Omega + Geometry validation
 * - UnifiedRiskAuthority: Risk assessment + PCVL
 * - AlphaTradeExecutor: Unified execution
 *
 * This wrapper will be removed in a future update once goal-session-live-engine is refactored.
 */

import { supabase } from '../lib/supabase';
import { alphaTradeExecutor, type ExecutionMode } from './alpha-trade-executor';
import { coreValidationGate } from './core-validation-gate';
import { unifiedRiskAuthority } from './unified-risk-authority';
import { goalSessionManager } from './goal-session-manager';
import { positionService } from './position-service';
import { getCurrencyPipInfo, roundLotSize, roundPnL, calculatePipDistance, convertLotToPositionSize } from '../utils/currencyHelpers';
import { getRegimeBucket } from './regime-bucketing';
import { prodLogger } from '../lib/production-logger';
import { globalDialogManager } from './global-dialog-manager';
import { getMinConfidenceThreshold } from '../config/risk-levels';
import { priceCoordinator } from './coordinators/price-coordinator';
import type { TradeContext } from '../types/trade-context';
import { toDirectionDB } from '../utils/direction-converter';

interface LivePriceResult {
  price: number;
  source: string;
  timestamp: Date;
}

/**
 * Safely extract Omega8 data from alpha decision with fallback values
 * Prevents errors if alpha decision is missing or malformed
 *
 * Handles both nested and top-level Omega8 data structures:
 * - Top-level: alphaDecision.omega8_liquidity_bias (from coordinator-alpha)
 * - Nested: alphaDecision.omega_votes.omega8.* (from omega council votes)
 */
function extractOmega8Data(alphaDecision: TradeSignal['alphaDecision']) {
  if (!alphaDecision) {
    return {};
  }

  try {
    // Try top-level fields first (coordinator-alpha structure)
    const liquidityBias = alphaDecision.omega8_liquidity_bias;
    const directionSupport = alphaDecision.omega8_direction_support;

    // Then try nested omega_votes.omega8 (council votes structure)
    const omega8FromVotes = alphaDecision.omega_votes?.omega8;

    return {
      // Use top-level if available, fall back to nested
      omega8_liquidity_bias: liquidityBias ?? omega8FromVotes?.liquidity_bias ?? null,
      omega8_direction_support: directionSupport ?? omega8FromVotes?.direction_support ?? null,

      // Nested fields (always from omega_votes)
      omega8_confidence: omega8FromVotes?.confidence ?? null,
      omega8_reasoning: omega8FromVotes?.reasoning ?? null,
      omega8_used_llm: omega8FromVotes?.used_llm ?? false,
      omega8_deterministic_bias: omega8FromVotes?.deterministic_bias ?? null,
      omega8_deterministic_confidence: omega8FromVotes?.deterministic_confidence ?? null,
      omega8_llm_reason: omega8FromVotes?.llm_reason ?? null,
      omega8_patterns: omega8FromVotes?.patterns ?? null
    };
  } catch (err) {
    console.warn('[Trade Execution] ⚠️ Failed to extract Omega8 data - using fallback', err);
    // Return safe defaults instead of empty object
    return {
      omega8_liquidity_bias: null,
      omega8_direction_support: null,
      omega8_confidence: null,
      omega8_reasoning: null,
      omega8_used_llm: false,
      omega8_deterministic_bias: null,
      omega8_deterministic_confidence: null,
      omega8_llm_reason: null,
      omega8_patterns: null
    };
  }
}

/**
 * Safely extract Omega9 data from alpha decision with fallback values
 * Prevents errors if alpha decision is missing or malformed
 */
function extractOmega9Data(alphaDecision: TradeSignal['alphaDecision']) {
  if (!alphaDecision?.omega9_validation) {
    return {};
  }

  try {
    return {
      omega9_pass: alphaDecision.omega9_validation.pass,
      omega9_flags: alphaDecision.omega9_validation.flags ?? null,
      omega9_confidence_adjustment: alphaDecision.omega9_validation.confidence_adjustment ?? null,
      omega9_corrections: alphaDecision.omega9_validation.corrections ?? null,
      omega9_reasoning: alphaDecision.omega9_validation.reasoning ?? null
    };
  } catch (err) {
    console.warn('[Trade Execution] ⚠️ Failed to extract Omega9 data - using fallback', err);
    return {};
  }
}

export interface TradeSignal {
  sessionId: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  positionSize: number;
  confidence: number;
  setupType: string;
  reasoning: string;
  riskReward: number;
  expectedProfit: number;
  // Dual TP system
  tp1Price?: number;
  tp2Price?: number;
  tp1Confidence?: number;
  tp1Reasoning?: string;
  tp2Reasoning?: string;
  // Playbook tracking context
  regimeSnapshot?: any;
  adversarialState?: any;
  // SSOT Snapshot metadata (Issue #2 fix)
  snapshotTimestamp: number;  // When snapshot was created
  snapshotPrice: number;      // Price at snapshot time
  snapshotHash: string;       // Hash for validation
  // Duration/Style tracking (ALPHA AUTHORITY MODEL)
  alphaStyle?: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY'; // ✅ IMMUTABLE: Alpha's chosen style
  durationBand?: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY' | 'EXTENDED'; // ✅ Expected duration (advisory)
  durationDeviation?: 'WITHIN_BAND' | 'SLIGHTLY_OVER' | 'SIGNIFICANTLY_OVER' | 'VERY_EXTENDED'; // ✅ Duration classification
  confidencePenalty?: number; // ✅ Penalty amount for duration deviation
  expectedDurationHours?: number;
  durationPenaltyApplied?: boolean;
  durationRewardApplied?: boolean;
  // Alpha Identity entry spec (new)
  entryMode?: 'immediate' | 'wait_pullback' | 'wait_confirmation';
  entryQualityScore?: number;
  tradeConfidence?: number;
  // SSOT ENFORCEMENT: TradeContext MUST be present for all executions
  tradeContext?: TradeContext;
  // Alpha Decision Metadata - For governance audit trail
  alphaDecision?: {
    omega8_liquidity_bias?: string | null;
    omega8_direction_support?: boolean | null;
    omega_votes?: Record<string, any>;
    omega9_validation?: {
      pass: boolean;
      flags?: string[] | null;
      confidence_adjustment?: number | null;
      corrections?: string[] | null;
      reasoning?: string | null;
    } | null;
  };
}

export interface TradeExecutionResult {
  success: boolean;
  tradeId?: string;
  error?: string;
  message: string;
  isMonitoring?: boolean;
}

function normalizeEntryMode(mode: string | undefined): 'immediate' | 'wait_pullback' | 'wait_confirmation' {
  if (!mode) return 'immediate';

  const normalized = mode.toLowerCase().trim();

  if (normalized === 'immediate' || normalized === 'execute_now') return 'immediate';
  if (normalized === 'pullback' || normalized === 'wait_pullback' || normalized === 'wait_entry') return 'wait_pullback';
  if (normalized === 'continuation' || normalized === 'wait_confirmation' || normalized === 'wait_higher_edge') return 'wait_confirmation';

  return 'immediate';
}

/**
 * SSOT Geometry Validation - Single authority for TP/SL placement validation
 *
 * Validates that TP and SL are on the correct side of entry price based on direction:
 * - BUY: SL must be BELOW entry, TP must be ABOVE entry
 * - SELL: SL must be ABOVE entry, TP must be BELOW entry
 *
 * This validation runs BEFORE database insertion to catch errors early.
 * Mirrors alpha-geometry-validator logic for consistency.
 *
 * @returns Object with valid status, error type, and error message if invalid
 */
function validateTradeGeometry(
  direction: 'buy' | 'sell',
  entryPrice: number,
  stopLoss: number,
  takeProfit: number,
  tp1Price?: number,
  tp2Price?: number
): { valid: boolean; errorType?: string; errorMessage?: string } {
  const isBuy = direction === 'buy';

  if (isBuy) {
    // BUY trades: SL below entry, TP above entry
    if (stopLoss >= entryPrice) {
      return {
        valid: false,
        errorType: 'SL_WRONG_SIDE',
        errorMessage: `Stop Loss on wrong side for BUY trade: Entry=${entryPrice.toFixed(5)}, SL=${stopLoss.toFixed(5)} (SL must be below entry)`
      };
    }

    if (takeProfit <= entryPrice) {
      return {
        valid: false,
        errorType: 'TP_WRONG_SIDE',
        errorMessage: `Take Profit on wrong side for BUY trade: Entry=${entryPrice.toFixed(5)}, TP=${takeProfit.toFixed(5)} (TP must be above entry)`
      };
    }

    if (tp1Price !== undefined && tp1Price <= entryPrice) {
      return {
        valid: false,
        errorType: 'TP_WRONG_SIDE',
        errorMessage: `TP1 on wrong side for BUY trade: Entry=${entryPrice.toFixed(5)}, TP1=${tp1Price.toFixed(5)} (TP1 must be above entry)`
      };
    }

    if (tp2Price !== undefined && tp2Price <= entryPrice) {
      return {
        valid: false,
        errorType: 'TP_WRONG_SIDE',
        errorMessage: `TP2 on wrong side for BUY trade: Entry=${entryPrice.toFixed(5)}, TP2=${tp2Price.toFixed(5)} (TP2 must be above entry)`
      };
    }
  } else {
    // SELL trades: SL above entry, TP below entry
    if (stopLoss <= entryPrice) {
      return {
        valid: false,
        errorType: 'SL_WRONG_SIDE',
        errorMessage: `Stop Loss on wrong side for SELL trade: Entry=${entryPrice.toFixed(5)}, SL=${stopLoss.toFixed(5)} (SL must be above entry)`
      };
    }

    if (takeProfit >= entryPrice) {
      return {
        valid: false,
        errorType: 'TP_WRONG_SIDE',
        errorMessage: `Take Profit on wrong side for SELL trade: Entry=${entryPrice.toFixed(5)}, TP=${takeProfit.toFixed(5)} (TP must be below entry)`
      };
    }

    if (tp1Price !== undefined && tp1Price >= entryPrice) {
      return {
        valid: false,
        errorType: 'TP_WRONG_SIDE',
        errorMessage: `TP1 on wrong side for SELL trade: Entry=${entryPrice.toFixed(5)}, TP1=${tp1Price.toFixed(5)} (TP1 must be below entry)`
      };
    }

    if (tp2Price !== undefined && tp2Price >= entryPrice) {
      return {
        valid: false,
        errorType: 'TP_WRONG_SIDE',
        errorMessage: `TP2 on wrong side for SELL trade: Entry=${entryPrice.toFixed(5)}, TP2=${tp2Price.toFixed(5)} (TP2 must be below entry)`
      };
    }
  }

  return { valid: true };
}

class TradeExecutionEngine {
  /**
   * Fetch the CURRENT live price for a symbol at execution time
   * Uses Price Coordinator (SSOT) for consistent price access with staleness detection
   */
  private async fetchLivePrice(symbol: string): Promise<LivePriceResult | null> {
    try {
      const result = await priceCoordinator.getPrice(symbol, {
        allowStale: true,
        useCacheFirst: false // Always fetch fresh for execution
      });

      if (!result.success || !result.price) {
        console.warn(`[Trade Execution] Could not fetch live price for ${symbol}:`, result.error);
        return null;
      }

      const price = result.price;

      if (price.isCriticallyStale) {
        console.warn(`[Trade Execution] Price critically stale for ${symbol} (age: ${price.ageSeconds}s)`);
      }

      return {
        price: price.mid, // Use mid price for execution
        source: price.source,
        timestamp: price.timestamp
      };
    } catch (error) {
      console.error(`[Trade Execution] Error fetching live price for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get maximum allowed price slippage for a symbol type
   * Indices like NAS100 are much more volatile than forex pairs
   */
  private getMaxAllowedSlippage(symbol: string): number {
    const pipInfo = getCurrencyPipInfo(symbol);

    if (pipInfo.symbolType === 'index') {
      return 30 * pipInfo.pipValue;
    } else if (pipInfo.symbolType === 'crypto') {
      return 50 * pipInfo.pipValue;
    } else {
      return 5 * pipInfo.pipValue;
    }
  }

  /**
   * Apply realistic slippage to entry price
   * Adjusted for symbol type - indices have higher slippage than forex
   */
  private applySlippage(symbol: string, entryPrice: number, direction: 'buy' | 'sell'): number {
    const pipInfo = getCurrencyPipInfo(symbol);

    let slippagePips: number;
    if (pipInfo.symbolType === 'index') {
      slippagePips = 1 + Math.random() * 3;
    } else if (pipInfo.symbolType === 'crypto') {
      slippagePips = 2 + Math.random() * 5;
    } else {
      slippagePips = 0.5 + Math.random() * 0.5;
    }

    const slippagePrice = slippagePips * pipInfo.pipValue;

    if (direction === 'buy') {
      return entryPrice + slippagePrice;
    } else {
      return entryPrice - slippagePrice;
    }
  }

  /**
   * Adjust SL and TP relative to a new entry price while maintaining pip distances
   */
  private adjustLevelsForNewEntry(
    symbol: string,
    originalEntry: number,
    newEntry: number,
    originalSL: number,
    originalTP: number,
    direction: 'buy' | 'sell'
  ): { stopLoss: number; takeProfit: number } {
    const pipInfo = getCurrencyPipInfo(symbol);

    const slPips = Math.abs(originalEntry - originalSL) / pipInfo.pipValue;
    const tpPips = Math.abs(originalTP - originalEntry) / pipInfo.pipValue;

    let newSL: number;
    let newTP: number;

    if (direction === 'buy') {
      newSL = newEntry - (slPips * pipInfo.pipValue);
      newTP = newEntry + (tpPips * pipInfo.pipValue);
    } else {
      newSL = newEntry + (slPips * pipInfo.pipValue);
      newTP = newEntry - (tpPips * pipInfo.pipValue);
    }

    return { stopLoss: newSL, takeProfit: newTP };
  }

  /**
   * Validate position contract using PCVL (Position Contract Validation Layer)
   *
   * CRITICAL: Last-line defense against 10-100× risk violations
   * Validates that: trueRisk = lot_size × pip_value × stop_pips = intended_risk
   *
   * @returns Validation result with approval status and audit trail
   */
  private async validatePCVL(
    symbol: string,
    lotSize: number,
    entryPrice: number,
    stopLoss: number,
    intendedRiskDollars: number,
    userId: string,
    sessionId: string
  ): Promise<{ approved: boolean; blockReason?: string }> {
    // Check if PCVL is enabled (kill switch)
    if (!isPCVLEnabled()) {
      prodLogger.warn('[PCVL] ⚠️ PCVL disabled - skipping validation');
      return { approved: true };
    }

    // Calculate stop distance in pips
    const stopPips = calculatePipDistance(symbol, entryPrice, stopLoss);

    // Run PCVL validation
    const pcvlResult = validatePositionContract({
      symbol,
      lot_size: lotSize,
      stop_pips: stopPips,
      intended_risk_dollars: intendedRiskDollars,
      entry_price: entryPrice,
      stop_loss: stopLoss,
    });

    // Log audit trail to database
    await this.logPCVLAudit(userId, sessionId, pcvlResult.audit);

    // If blocked, log detailed error
    if (!pcvlResult.approved) {
      prodLogger.error(`[PCVL] 🚫 TRADE BLOCKED: ${pcvlResult.block_reason}`);
      prodLogger.error(`[PCVL] Symbol: ${symbol}, Lot size: ${lotSize}, Stop: ${stopPips.toFixed(1)} pips`);
      prodLogger.error(`[PCVL] Intended risk: $${intendedRiskDollars.toFixed(2)}, Actual risk: $${pcvlResult.true_risk_dollars.toFixed(2)}`);
      prodLogger.error(`[PCVL] Variance: ${pcvlResult.risk_variance_percent.toFixed(2)}%`);
      prodLogger.error(`[PCVL] Pip value: ${pcvlResult.pip_value_used}, Dollar/pip: $${pcvlResult.dollar_per_pip.toFixed(2)}`);
    }

    return {
      approved: pcvlResult.approved,
      blockReason: pcvlResult.block_reason,
    };
  }

  /**
   * Log PCVL audit trail to database
   */
  private async logPCVLAudit(
    userId: string,
    sessionId: string,
    audit: any
  ): Promise<void> {
    try {
      await supabase.from('pcvl_audit_log').insert({
        user_id: userId,
        session_id: sessionId,
        symbol: audit.symbol,
        lot_size: audit.lot_size,
        stop_pips: audit.stop_pips,
        intended_risk_dollars: audit.intended_risk,
        calculated_risk_dollars: audit.calculated_risk,
        risk_variance_percent: audit.risk_variance,
        pip_value: audit.pip_value,
        dollar_per_pip: audit.dollar_per_pip,
        approved: audit.approved,
        block_reason: audit.block_reason,
      });
    } catch (error) {
      prodLogger.error('[PCVL] Failed to log audit trail:', error);
      // Don't block trade if audit logging fails - validation is what matters
    }
  }

  async executeSignal(
    signal: TradeSignal,
    userId: string,
    autoExecute: boolean = false,
    alphaDecision?: any
  ): Promise<TradeExecutionResult> {
    try {
      console.log(`[Trade Execution] Delegating to AlphaTradeExecutor for ${signal.symbol}...`);

      // Map old signal format to new AlphaDecision format
      const decision = alphaDecision || {
        symbol: signal.symbol,
        action: signal.direction === 'buy' ? 'BUY' : 'SELL',
        direction: signal.direction === 'buy' ? 'LONG' : 'SHORT',
        entry_price: signal.entryPrice,
        stop_loss: signal.stopLoss,
        take_profit: signal.takeProfit,
        tp1_price: signal.tp1Price,
        tp2_price: signal.tp2Price,
        confidence: signal.confidence,
        reasoning: signal.reasoning,
        // Extract Omega data if available
        omega8_liquidity_bias: alphaDecision?.omega8_liquidity_bias,
        omega8_direction_support: alphaDecision?.omega8_direction_support,
        omega9_validation: alphaDecision?.omega9_validation,
        omega_votes: alphaDecision?.omega_votes
      };

      // Fetch session data
      const { data: session } = await supabase
        .from('goal_sessions')
        .select('*')
        .eq('id', signal.sessionId)
        .single();

      if (!session) {
        return {
          success: false,
          error: 'Session not found'
        };
      }

      // Determine execution mode
      const mode: ExecutionMode = autoExecute ? 'IMMEDIATE' : 'PENDING';

      // Delegate to new simplified executor
      const result = await alphaTradeExecutor.execute({
        decision,
        tradeContext: signal.tradeContext!,
        userId,
        sessionId: signal.sessionId,
        session,
        mode,
        autoExecute,
        snapshotTimestamp: new Date(signal.snapshotTimestamp),
        regimeSnapshot: (signal as any).regimeSnapshot,
        adversarialState: (signal as any).adversarialState
      });

      return result;
    } catch (error) {
      console.error('[Trade Execution] Error executing signal:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Failed to execute trade signal'
      };
    }
  }

  // Legacy methods below (kept for backward compatibility)

  async validateSignal(signal: TradeSignal, session: any): Promise<{ valid: boolean; reason?: string }> {
    // Delegate to AlphaTradeExecutor's capacity check
    return { valid: true }; // Validation now handled in AlphaTradeExecutor
  }

  async createPendingTrade(
    signal: TradeSignal,
    userId: string,
    session: any
  ): Promise<TradeExecutionResult> {
    // Delegate to new executor
    return this.executeSignal(signal, userId, false);
  }

  async executeLiveTrade(
    signal: TradeSignal,
    userId: string,
    session: any
  ): Promise<TradeExecutionResult> {
    // Delegate to new executor
    return this.executeSignal(signal, userId, true);
  }

  async confirmPendingTrade(
    tradeId: string,
    userId: string
  ): Promise<TradeExecutionResult> {
    try {
      const { data: trade, error: fetchError } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('id', tradeId)
        .eq('status', 'pending')
        .single();

      if (fetchError || !trade) {
        return {
          success: false,
          error: 'Trade not found or already confirmed',
          message: 'Could not find pending trade'
        };
      }

      const { error: updateError } = await supabase
        .from('goal_session_trades')
        .update({
          status: 'open',
          order_type: 'market',
          current_price: trade.entry_price,
          current_pnl: 0,
          opened_at: new Date().toISOString()
        })
        .eq('id', tradeId);

      if (updateError) {
        return {
          success: false,
          error: updateError.message,
          message: 'Failed to confirm trade'
        };
      }

      await supabase
        .from('goal_sessions')
        .update({ status: 'in_trade' })
        .eq('id', trade.goal_session_id);

      return {
        success: true,
        tradeId: trade.id,
        message: `Trade confirmed and opened on ${trade.symbol}`
      };
    } catch (error) {
      console.error('[Trade Execution] Error confirming trade:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Failed to confirm trade'
      };
    }
  }

  async rejectPendingTrade(
    tradeId: string,
    userId: string,
    reason?: string
  ): Promise<TradeExecutionResult> {
    try {
      const { data: trade, error: fetchError } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('id', tradeId)
        .eq('status', 'pending')
        .single();

      if (fetchError || !trade) {
        return {
          success: false,
          error: 'Trade not found',
          message: 'Could not find pending trade'
        };
      }

      const { error: updateError } = await supabase
        .from('goal_session_trades')
        .update({ status: 'rejected' })
        .eq('id', tradeId);

      if (updateError) {
        return {
          success: false,
          error: updateError.message,
          message: 'Failed to reject trade'
        };
      }

      await supabase
        .from('goal_sessions')
        .update({ status: 'scanning' })
        .eq('id', trade.goal_session_id);

      await goalSessionManager.addAIMessage(
        trade.goal_session_id,
        userId,
        `Trade signal on ${trade.symbol} rejected${reason ? `: ${reason}` : ''}. Continuing market scan.`,
        { trade, reason },
        'neutral'
      );

      return {
        success: true,
        tradeId: trade.id,
        message: `Trade on ${trade.symbol} rejected. Continuing scan.`
      };
    } catch (error) {
      console.error('[Trade Execution] Error rejecting trade:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Failed to reject trade'
      };
    }
  }
}

export const tradeExecutionEngine = new TradeExecutionEngine();
