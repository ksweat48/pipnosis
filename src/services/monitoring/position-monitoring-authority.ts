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
        .select('id, symbol, direction, entry_price, stop_loss, take_profit, tp1_price, tp2_price, tp1_hit, tp2_hit, position_size, lot_size, user_id, goal_session_id, status, current_price, opened_at')
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
      // Check TP1 (first milestone - 70% close, continue monitoring)
      const shouldHitTP1 = !position.tp1_hit && (position.direction === 'buy'
        ? price >= position.tp1_price!
        : price <= position.tp1_price!);

      if (shouldHitTP1) {
        return {
          milestone: 'tp1',
          price,
          shouldContinue: true, // Keep monitoring for TP2
        };
      }

      // Check TP2 (second milestone - 30% close, full close)
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
   */
  validatePriceData(
    symbol: string,
    priceData: PriceData,
    maxAgeMinutes: number = 2
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

    // Check freshness if timestamp provided
    if (priceData.timestamp) {
      const ageMinutes = (Date.now() - priceData.timestamp.getTime()) / 1000 / 60;
      if (ageMinutes > maxAgeMinutes) {
        return {
          valid: false,
          reason: `Stale price data for ${symbol}: ${ageMinutes.toFixed(1)} minutes old (max: ${maxAgeMinutes})`,
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
   * Mark TP1 milestone in database
   * CRITICAL: Position size NEVER changes - only flag is set
   */
  async markTP1Hit(positionId: string, userId: string, tp1Price: number): Promise<{ success: boolean; error?: string }> {
    try {
      const { error: updateError } = await supabase
        .from('goal_session_trades')
        .update({
          tp1_hit: true,
          tp1_hit_at: new Date().toISOString(),
          tp1_action_taken: 'continued', // Continued to TP2 with full position
        })
        .eq('id', positionId)
        .eq('user_id', userId); // Security: User can only update own trades

      if (updateError) {
        return {
          success: false,
          error: updateError.message,
        };
      }

      console.log(`[PositionMonitoringAuthority] TP1 marked for ${positionId} at ${tp1Price.toFixed(5)}`);
      return { success: true };
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

      console.log(`[PositionMonitoringAuthority] TP2 marked for ${positionId}`);
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
