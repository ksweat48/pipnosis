/**
 * POSITION MONITORING AUTHORITY - Single Source of Truth (SSOT)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AUTHORITY: This is the SOLE authority for position monitoring decisions.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ALL position monitoring MUST go through this authority:
 * - realtime-sltp-monitor MUST delegate SL/TP checks here
 * - position-monitor MUST delegate SL/TP checks here
 * - mid-trade wellness checks MUST use this for position fetching
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RESPONSIBILITIES:
 * ═══════════════════════════════════════════════════════════════════════════
 * 1. Position Access Control (who can monitor what)
 * 2. SL/TP Condition Checking (when to close)
 * 3. TP1/TP2 Milestone Detection (dual TP system)
 * 4. Price Validation & Freshness
 * 5. Closure Decision Making
 *
 * DOES NOT:
 * - Execute closures (delegates to tradeClosureCoordinator)
 * - Fetch prices (uses MarketDataService)
 * - Send notifications (delegates to notificationCoordinator)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CCIP COMPLIANCE:
 * ═══════════════════════════════════════════════════════════════════════════
 * - System Map: Documented all monitoring entry points
 * - Logic Contract: Defined single authority for monitoring
 * - Compatibility: Works with existing coordinators
 * - Fail-Hard: Returns explicit results, no silent fallbacks
 */

import { supabase } from '@/lib/supabase';
import { calculatePnL } from '@/types/position';
import type { CloseReason } from '@/types/position';
import { priceFreshnessGate } from '@/governance/price-freshness-gate';
import { calculateTP1BreakevenSL } from '@/utils/currencyHelpers';
import { isIndex } from '@/utils/currencyHelpers';

/**
 * MAX LOSS OVERRUN MULTIPLIERS — SSOT
 *
 * CCIP-2026-0323B: Prevent catastrophic loss overruns when SL is gapped through.
 *
 * When price has traveled beyond the SL by a factor of MAX_LOSS_MULTIPLIER, the
 * position is force-closed with reason 'risk_limit' regardless of SL price.
 * This is a catastrophic loss prevention backstop — it activates only when the
 * normal SL check has already failed (price gapped past SL without triggering closure).
 *
 * RATIONALE: SL checks run every 500ms for critical positions. In extreme volatility
 * (news spikes, gap opens), price can skip through the SL level entirely. Without this
 * guard, the position bleeds indefinitely. The multiplier gives breathing room for normal
 * SL hit scenarios while catching runaway losses.
 *
 * INDEX instruments (US30, NAS100) get a tighter ceiling (1.5x) because index moves
 * are faster and index pip values are larger — the same overrun in price units represents
 * a proportionally larger monetary loss.
 *
 * GOVERNANCE: This constant is the ONLY place overrun multipliers are defined.
 * position-monitoring-authority.ts is the sole authority for overrun closure decisions.
 */
export const MAX_LOSS_OVERRUN = {
  DEFAULT: 1.75,  // 1.75x intended risk — applies to FOREX, CRYPTO, METAL
  INDEX: 1.5,     // 1.5x intended risk — applies to US30, NAS100, SPX500 (faster moves, larger pip value)
} as const;

/**
 * Position data structure for monitoring
 */
export interface MonitoredPosition {
  id: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  tp1_price?: number | null;
  tp2_price?: number | null;
  tp1_hit?: boolean;
  tp2_hit?: boolean;
  tp1_breakeven_price?: number | null;
  partial_close_pct?: number | null;
  position_size: number;
  lot_size?: number;
  user_id: string;
  goal_session_id: string;
  status: string;
  current_price?: number;
  opened_at: string;
}

/**
 * Price data for monitoring
 */
export interface PriceData {
  bid: number;
  ask: number;
  timestamp?: Date;
}

/**
 * Closure decision result
 */
export interface ClosureDecision {
  shouldClose: boolean;
  reason: CloseReason;
  price: number;
  metadata?: {
    slProximity?: number;
    riskRatio?: number;
    milestone?: 'tp1' | 'tp2';
  };
}

/**
 * TP milestone result
 */
export interface TPMilestoneResult {
  milestone: 'tp1' | 'tp2';
  price: number;
  shouldContinue: boolean; // true for TP1 (keep monitoring), false for TP2 (close)
}

/**
 * Position fetch result with authorization
 */
export interface PositionFetchResult {
  success: boolean;
  positions: MonitoredPosition[];
  error?: string;
  accessDenied?: boolean;
}

class PositionMonitoringAuthority {
  private positionCache: Map<string, { positions: MonitoredPosition[]; fetchedAt: number }> = new Map();
  private cacheTTLMs = 1000;

  async getMonitorablePositions(
    userId: string,
    isAdmin: boolean = false,
    targetUserId?: string
  ): Promise<PositionFetchResult> {
    try {
      const monitoringUserId = targetUserId && isAdmin ? targetUserId : userId;

      if (targetUserId && targetUserId !== userId && !isAdmin) {
        return {
          success: false,
          positions: [],
          error: 'Access denied: Cannot monitor other users\' positions',
          accessDenied: true,
        };
      }

      const cached = this.positionCache.get(monitoringUserId);
      if (cached && Date.now() - cached.fetchedAt < this.cacheTTLMs) {
        return { success: true, positions: cached.positions };
      }

      const { data: positions, error } = await supabase
        .from('goal_session_trades')
        .select('id, symbol, direction, entry_price, stop_loss, take_profit, tp1_price, tp2_price, tp1_hit, tp2_hit, tp1_breakeven_price, partial_close_pct, position_size, lot_size, user_id, goal_session_id, status, current_price, opened_at')
        .eq('status', 'open')
        .eq('user_id', monitoringUserId);

      if (error) {
        return { success: false, positions: [], error: error.message };
      }

      const result = (positions || []) as MonitoredPosition[];
      this.positionCache.set(monitoringUserId, { positions: result, fetchedAt: Date.now() });

      return { success: true, positions: result };
    } catch (error) {
      return {
        success: false,
        positions: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  invalidateCache(userId?: string): void {
    if (userId) {
      this.positionCache.delete(userId);
    } else {
      this.positionCache.clear();
    }
  }

  /**
   * Check if position should close at SL/TP
   *
   * AUTHORITY: This is the ONLY place that decides closure logic
   *
   * Priority order (CCIP Race Condition Protection):
   * 1. Stop Loss (HIGHEST PRIORITY - risk management)
   * 2. TP2 (second target in dual TP system)
   * 3. TP1 (first target in dual TP system)
   * 4. Legacy Single TP (fallback)
   *
   * If SL and TP are both triggered (price gap), SL wins.
   */
  checkSLTP(position: MonitoredPosition, currentPrice: PriceData): ClosureDecision | TPMilestoneResult | null {
    // Use correct price based on direction
    const price = position.direction === 'buy' ? currentPrice.bid : currentPrice.ask;

    // PRIORITY 0: Max Loss Overrun Guard (CCIP-2026-0323B)
    // Catastrophic backstop — fires when price has gapped past SL by more than the
    // overrun multiplier. Catches runaway losses that slip through normal SL polling.
    // Uses 'risk_limit' close reason (already in DB constraint — no migration needed).
    const intendedRisk = Math.abs(position.entry_price - position.stop_loss);
    if (intendedRisk > 0) {
      const overrunMultiplier = isIndex(position.symbol) ? MAX_LOSS_OVERRUN.INDEX : MAX_LOSS_OVERRUN.DEFAULT;
      const overrunThreshold = intendedRisk * overrunMultiplier;
      const isLong = position.direction === 'buy';
      // How far has price moved AGAINST us?
      const adverseMove = isLong
        ? position.entry_price - price           // long position: price fell below entry
        : price - position.entry_price;          // short position: price rose above entry

      if (adverseMove >= overrunThreshold) {
        console.warn(
          `[PositionMonitoringAuthority] CCIP-2026-0323B: MAX LOSS OVERRUN on ${position.symbol} ${position.direction.toUpperCase()} ` +
          `id=${position.id}. AdverseMove=${adverseMove.toFixed(5)} >= Threshold=${overrunThreshold.toFixed(5)} ` +
          `(${overrunMultiplier}x intended risk of ${intendedRisk.toFixed(5)}). Force-closing at risk_limit.`
        );
        return {
          shouldClose: true,
          reason: 'risk_limit' as CloseReason,
          price,
          metadata: {
            slProximity: 0,
          },
        };
      }
    }

    // PRIORITY 1: Check Stop Loss (ALWAYS HIGHEST PRIORITY)
    const shouldCloseAtStopLoss = position.direction === 'buy'
      ? price <= position.stop_loss
      : price >= position.stop_loss;

    if (shouldCloseAtStopLoss) {
      return {
        shouldClose: true,
        reason: 'stop_loss',
        price,
        metadata: {
          slProximity: 0, // At stop loss
        },
      };
    }

    // PRIORITY 2: Check Dual TP System (if configured)
    const hasDualTP = position.tp1_price && position.tp2_price;

    if (hasDualTP) {
      // Check TP1 (ADVISORY MILESTONE ONLY - NO PARTIAL CLOSE)
      // TP1 is used for Alpha learning and progress tracking only
      // Position stays 100% open and continues to TP2
      const shouldHitTP1 = !position.tp1_hit && (position.direction === 'buy'
        ? price >= position.tp1_price!
        : price <= position.tp1_price!);

      if (shouldHitTP1) {
        return {
          milestone: 'tp1',
          price,
          shouldContinue: true, // Keep monitoring for TP2 with full position (100%)
        };
      }

      // Check TP2 (second milestone - FULL CLOSE at 100%)
      // TP2 closes the entire position (not just remaining 30%)
      const shouldHitTP2 = position.tp1_hit && !position.tp2_hit && (position.direction === 'buy'
        ? price >= position.tp2_price!
        : price <= position.tp2_price!);

      if (shouldHitTP2) {
        return {
          shouldClose: true,
          reason: 'take_profit_2',
          price,
          metadata: {
            milestone: 'tp2',
          },
        };
      }

      // Neither TP1 nor TP2 triggered
      return null;
    }

    // PRIORITY 3: Legacy Single TP System
    const shouldCloseAtTakeProfit = position.direction === 'buy'
      ? price >= position.take_profit
      : price <= position.take_profit;

    if (shouldCloseAtTakeProfit) {
      return {
        shouldClose: true,
        reason: 'take_profit',
        price,
      };
    }

    // No closure conditions met
    return null;
  }

  /**
   * Calculate risk metrics for position
   */
  calculateRiskMetrics(position: MonitoredPosition, currentPrice: number): {
    pnl: number;
    riskRatio: number;
    slProximity: number;
    drawdownPercent: number;
  } {
    const lotSize = position.lot_size || position.position_size;
    const pnl = calculatePnL(
      position.direction,
      position.entry_price,
      currentPrice,
      lotSize,
      position.symbol
    );

    const risk = Math.abs(position.entry_price - position.stop_loss);
    const isLong = position.direction === 'buy';
    const priceDiff = isLong
      ? (currentPrice - position.entry_price)
      : (position.entry_price - currentPrice);
    const riskRatio = risk > 0 ? priceDiff / risk : 0;

    const distanceToSL = Math.abs(currentPrice - position.stop_loss);
    const slProximity = risk > 0 ? distanceToSL / risk : 1;

    const drawdownPercent = Math.max(0, (-riskRatio) * 100);

    return {
      pnl,
      riskRatio,
      slProximity,
      drawdownPercent,
    };
  }

  /**
   * Validate price data freshness and reasonableness
   *
   * GOVERNANCE: Prevents trading on stale or invalid data
   * SSOT: Delegates freshness validation to priceFreshnessGate
   */
  validatePriceData(
    symbol: string,
    priceData: PriceData
  ): {
    valid: boolean;
    reason?: string;
  } {
    // Check if prices are positive
    if (priceData.bid <= 0 || priceData.ask <= 0) {
      return {
        valid: false,
        reason: `Invalid prices for ${symbol}: bid=${priceData.bid}, ask=${priceData.ask}`,
      };
    }

    // Check if bid < ask (normal market condition)
    if (priceData.bid >= priceData.ask) {
      return {
        valid: false,
        reason: `Inverted spread for ${symbol}: bid=${priceData.bid} >= ask=${priceData.ask}`,
      };
    }

    // Use SSOT price freshness gate for timestamp validation
    if (priceData.timestamp) {
      const isFresh = priceFreshnessGate.isTimestampFresh(
        priceData.timestamp,
        'monitoring',
        symbol
      );

      if (!isFresh) {
        const ageData = priceFreshnessGate.getTimestampAge(
          priceData.timestamp,
          'monitoring',
          symbol
        );
        return {
          valid: false,
          reason: `Stale price data for ${symbol}: ${ageData.ageSeconds}s old (max: ${ageData.maxAgeSeconds}s)`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Determine if position is critical (near SL/TP)
   * Used to prioritize high-frequency monitoring
   */
  isCriticalPosition(position: MonitoredPosition, currentPrice: number): boolean {
    const distanceToSL = Math.abs(currentPrice - position.stop_loss);
    const distanceToTP = Math.abs(currentPrice - position.take_profit);
    const priceRange = Math.abs(position.take_profit - position.stop_loss);

    if (priceRange === 0) return false;

    // CRITICAL: Within 30% of SL or TP
    const isNearSLorTP = (distanceToSL / priceRange < 0.30) || (distanceToTP / priceRange < 0.30);

    return isNearSLorTP;
  }

  /**
   * Mark TP1 milestone in database (ADVISORY ONLY)
   * CRITICAL: Position size NEVER changes - only flag is set for Alpha learning
   * TP1 is NOT a closure event - it's a progress tracking milestone
   * Position continues 100% open to TP2
   *
   * CCIP FIX (2026-03-04 TP1-ONCE-PER-TRADE): Optimistic lock via .eq('tp1_hit', false).
   * Both position-monitor and realtime-sltp-monitor call this method. Without the lock,
   * both could read tp1_hit=false from their in-memory copy simultaneously and both
   * proceed. The WHERE tp1_hit=false ensures only the first writer wins; subsequent
   * callers get already_processed=true and must skip their downstream logic.
   */
  async markTP1Hit(positionId: string, userId: string, tp1Price: number): Promise<{ success: boolean; already_processed?: boolean; error?: string }> {
    try {
      // CCIP-2026-BE001: Do NOT set tp1_action_taken here.
      // The trigger (check_and_close_positions_on_price_update) is the primary authority
      // and sets tp1_action_taken atomically alongside the BE SL move.
      // This UPDATE only wins the optimistic lock race when the trigger hasn't fired yet;
      // in that case autoMoveSLAfterTP1 (called by the backup path) sets tp1_action_taken.
      const { data: updatedRows, error: updateError } = await supabase
        .from('goal_session_trades')
        .update({
          tp1_hit: true,
          tp1_hit_at: new Date().toISOString(),
        })
        .eq('id', positionId)
        .eq('user_id', userId)
        .eq('tp1_hit', false)
        .select('id');

      if (updateError) {
        return {
          success: false,
          error: updateError.message,
        };
      }

      if (!updatedRows || updatedRows.length === 0) {
          return { success: false, already_processed: true };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Auto-move SL to entry + ATR buffer after TP1 is hit.
   *
   * SSOT AUTHORITY: This is the ONLY place that moves the SL after a TP1 event.
   * No other service or trigger may set stop_loss for a TP1-hit position.
   *
   * ATR is passed in from the caller (realtime-sltp-monitor) which already has the
   * price context. This keeps this method synchronous-safe and testable.
   *
   * CCIP 2026-03-02: tp1_action_taken updated to 'sl_moved_to_breakeven' on success,
   * 'sl_moved_to_breakeven_fallback' when the caller used a fallback ATR estimate.
   * Previous value 'advisory_only' was misleading — it implied nothing happened.
   *
   * @param positionId    Trade record UUID
   * @param userId        Trade owner (for RLS enforcement)
   * @param direction     Trade direction ('buy' | 'sell')
   * @param entryPrice    Original entry price
   * @param atr           Current ATR for the symbol (price units)
   * @param isFallbackATR When true, logs that a fallback ATR was used (audit trail)
   */
  async autoMoveSLAfterTP1(
    positionId: string,
    userId: string,
    direction: 'buy' | 'sell',
    entryPrice: number,
    atr: number,
    isFallbackATR = false
  ): Promise<{ success: boolean; newSL?: number; error?: string }> {
    try {
      const newSL = calculateTP1BreakevenSL(direction, entryPrice, atr);
      const now = new Date().toISOString();
      const actionTaken = isFallbackATR ? 'sl_moved_to_breakeven_fallback' : 'sl_moved_to_breakeven';

      const { error: updateError } = await supabase
        .from('goal_session_trades')
        .update({
          stop_loss: newSL,
          tp1_breakeven_price: newSL,
          sl_moved_to_breakeven_at: now,
          tp1_action_taken: actionTaken,
        })
        .eq('id', positionId)
        .eq('user_id', userId)
        .eq('status', 'open');

      if (updateError) {
        return { success: false, error: updateError.message };
      }

      return { success: true, newSL };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Mark TP2 milestone in database
   * CRITICAL: This triggers full position closure
   */
  async markTP2Hit(positionId: string, userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // SSOT COMPLIANCE: Use RPC for TP2 milestone
      const { data: result, error: rpcError } = await supabase
        .rpc('mark_tp2_milestone', { trade_id: positionId });

      if (rpcError || !result?.success) {
        return {
          success: false,
          error: rpcError?.message || result?.error || 'TP2 milestone RPC failed',
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

/**
 * Singleton instance - ensures single source of truth
 */
export const positionMonitoringAuthority = new PositionMonitoringAuthority();
