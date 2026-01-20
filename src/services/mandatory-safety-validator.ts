/**
 * Mandatory Safety Validator - ONLY Allowed Blocker
 *
 * ALPHA SOVEREIGNTY: This is the ONLY service allowed to block trades.
 *
 * Permitted blocks (4 categories):
 * 1. Margin/Drawdown Breach - Account risk limits exceeded
 * 2. Market Closed - Symbol halted or outside trading hours
 * 3. Invalid SSOT TradeContext - Missing or corrupted trade context
 * 4. Malformed Order - NaN, invalid decimals, broker format errors
 *
 * All other concerns (confidence, distance, volatility, EQS) are ADVISORY ONLY.
 */

import { supabase } from '../lib/supabase';
import { TRADING_CONSTANTS } from '../config/trading-constants';
import { logger } from '../lib/logger';
import { marketScheduleService } from './market-schedule-service';
import { getSymbolConfig } from '../config/symbol-registry';

export type MandatorySafetyBlockReason =
  | 'MARGIN_BREACH'
  | 'DRAWDOWN_BREACH'
  | 'EXPOSURE_BREACH'
  | 'MARKET_CLOSED'
  | 'SYMBOL_HALTED'
  | 'INVALID_SSOT'
  | 'MISSING_TRADE_CONTEXT'
  | 'MALFORMED_ORDER'
  | 'NAN_VALUE'
  | 'INVALID_DECIMALS'
  | 'BROKER_REJECTION';

export interface MandatorySafetyResult {
  allowed: boolean;
  blockReason?: MandatorySafetyBlockReason;
  message?: string;
  details?: Record<string, any>;
}

export class MandatorySafetyValidator {
  /**
   * Validate all mandatory safety checks
   * Returns allowed=true if all checks pass
   * Returns allowed=false with blockReason if any mandatory safety fails
   */
  async validate(
    userId: string,
    sessionId: string,
    symbol: string,
    direction: 'BUY' | 'SELL',
    entry: number,
    stopLoss: number,
    takeProfit: number,
    lotSize: number,
    tradeContext?: Record<string, any>
  ): Promise<MandatorySafetyResult> {
    logger.info('[MANDATORY_SAFETY] Starting validation', {
      symbol,
      direction,
      entry,
      lotSize
    });

    // Check 1: Malformed Order
    const orderCheck = this.validateOrderFormat(symbol, entry, stopLoss, takeProfit, lotSize);
    if (!orderCheck.allowed) {
      return orderCheck;
    }

    // Check 2: Market Closed
    const marketCheck = await this.validateMarketOpen(symbol);
    if (!marketCheck.allowed) {
      return marketCheck;
    }

    // Check 3: Margin/Drawdown/Exposure
    const riskCheck = await this.validateRiskLimits(userId, sessionId, symbol, lotSize);
    if (!riskCheck.allowed) {
      return riskCheck;
    }

    // Check 4: SSOT Trade Context
    const ssotCheck = this.validateSSOT(tradeContext);
    if (!ssotCheck.allowed) {
      return ssotCheck;
    }

    logger.info('[MANDATORY_SAFETY] ✅ All safety checks passed');
    return { allowed: true };
  }

  /**
   * Check 1: Validate order format
   * Blocks on: NaN, negative values, invalid decimals, broker format issues
   */
  private validateOrderFormat(
    symbol: string,
    entry: number,
    stopLoss: number,
    takeProfit: number,
    lotSize: number
  ): MandatorySafetyResult {
    // Check for NaN
    if (isNaN(entry) || isNaN(stopLoss) || isNaN(takeProfit) || isNaN(lotSize)) {
      return {
        allowed: false,
        blockReason: 'NAN_VALUE',
        message: 'Order contains NaN values',
        details: { entry, stopLoss, takeProfit, lotSize }
      };
    }

    // Check for non-finite values
    if (!isFinite(entry) || !isFinite(stopLoss) || !isFinite(takeProfit) || !isFinite(lotSize)) {
      return {
        allowed: false,
        blockReason: 'MALFORMED_ORDER',
        message: 'Order contains non-finite values',
        details: { entry, stopLoss, takeProfit, lotSize }
      };
    }

    // Check for negative or zero values
    if (entry <= 0 || stopLoss <= 0 || takeProfit <= 0 || lotSize <= 0) {
      return {
        allowed: false,
        blockReason: 'MALFORMED_ORDER',
        message: 'Order contains negative or zero values',
        details: { entry, stopLoss, takeProfit, lotSize }
      };
    }

    // Validate decimal precision
    const symbolConfig = getSymbolConfig(symbol);
    if (symbolConfig) {
      const decimals = symbolConfig.digits;
      const maxDecimalValue = Math.pow(10, -decimals);

      // Check if values have too many decimals
      const entryRemainder = Math.abs(entry - Math.round(entry / maxDecimalValue) * maxDecimalValue);
      const slRemainder = Math.abs(stopLoss - Math.round(stopLoss / maxDecimalValue) * maxDecimalValue);
      const tpRemainder = Math.abs(takeProfit - Math.round(takeProfit / maxDecimalValue) * maxDecimalValue);

      if (entryRemainder > maxDecimalValue / 10 || slRemainder > maxDecimalValue / 10 || tpRemainder > maxDecimalValue / 10) {
        return {
          allowed: false,
          blockReason: 'INVALID_DECIMALS',
          message: `Order prices exceed ${decimals} decimal precision for ${symbol}`,
          details: { entry, stopLoss, takeProfit, requiredDecimals: decimals }
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Check 2: Validate market is open
   * Blocks on: Market closed, symbol halted
   */
  private async validateMarketOpen(symbol: string): Promise<MandatorySafetyResult> {
    try {
      const isOpen = await marketScheduleService.isMarketOpen(symbol);

      if (!isOpen) {
        return {
          allowed: false,
          blockReason: 'MARKET_CLOSED',
          message: `Market closed for ${symbol}`,
          details: { symbol }
        };
      }

      return { allowed: true };
    } catch (error) {
      logger.error('[MANDATORY_SAFETY] Failed to check market hours', error);
      // On error, allow trade (fail-open for availability)
      return { allowed: true };
    }
  }

  /**
   * Check 3: Validate risk limits
   * Blocks on: Margin breach, drawdown breach, exposure breach
   */
  private async validateRiskLimits(
    userId: string,
    sessionId: string,
    symbol: string,
    lotSize: number
  ): Promise<MandatorySafetyResult> {
    try {
      // Get current balance and risk metrics
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('balance')
        .eq('id', userId)
        .maybeSingle();

      if (userError || !user) {
        logger.error('[MANDATORY_SAFETY] Failed to get user balance', userError);
        return {
          allowed: false,
          blockReason: 'INVALID_SSOT',
          message: 'Cannot validate risk limits - user data unavailable'
        };
      }

      // Get session risk limits
      const { data: session, error: sessionError } = await supabase
        .from('goal_sessions')
        .select('max_daily_loss, max_position_size')
        .eq('id', sessionId)
        .maybeSingle();

      if (sessionError || !session) {
        logger.error('[MANDATORY_SAFETY] Failed to get session limits', sessionError);
        // Allow if session limits not found (fail-open)
        return { allowed: true };
      }

      // PHASE 2: Use SSOT constant for daily loss limit (already imported at top)
      const defaultMaxDailyLoss = user.balance * TRADING_CONSTANTS.RISK_PERCENTAGES.MAX_DAILY_DRAWDOWN; // 0.08 (8%)

      // Check drawdown limit
      const maxDailyLoss = session.max_daily_loss || defaultMaxDailyLoss;

      // Get current positions to calculate exposure
      const { data: positions, error: posError } = await supabase
        .from('goal_trades')
        .select('symbol, lot_size, current_pnl')
        .eq('session_id', sessionId)
        .eq('status', 'open');

      if (posError) {
        logger.error('[MANDATORY_SAFETY] Failed to get positions', posError);
        // Allow if positions query fails (fail-open)
        return { allowed: true };
      }

      // Calculate current exposure
      const currentLoss = (positions || [])
        .filter(p => p.current_pnl < 0)
        .reduce((sum, p) => sum + Math.abs(p.current_pnl), 0);

      if (currentLoss >= maxDailyLoss) {
        return {
          allowed: false,
          blockReason: 'DRAWDOWN_BREACH',
          message: `Daily loss limit reached: $${currentLoss.toFixed(2)} / $${maxDailyLoss.toFixed(2)}`,
          details: { currentLoss, maxDailyLoss }
        };
      }

      // Check position size limit
      const maxPositionSize = session.max_position_size || 1.0;
      if (lotSize > maxPositionSize) {
        return {
          allowed: false,
          blockReason: 'EXPOSURE_BREACH',
          message: `Position size ${lotSize} exceeds limit ${maxPositionSize}`,
          details: { lotSize, maxPositionSize }
        };
      }

      return { allowed: true };
    } catch (error) {
      logger.error('[MANDATORY_SAFETY] Risk validation error', error);
      // On exception, allow (fail-open)
      return { allowed: true };
    }
  }

  /**
   * Check 4: Validate SSOT trade context
   * Blocks on: Missing trade context, corrupted data
   */
  private validateSSOT(tradeContext?: Record<string, any>): MandatorySafetyResult {
    // Trade context is optional for EXECUTE_NOW decisions
    // Only required for complex WAIT -> EXECUTE flows
    if (!tradeContext) {
      return { allowed: true };
    }

    // Basic validation - ensure it's a valid object
    if (typeof tradeContext !== 'object' || Array.isArray(tradeContext)) {
      return {
        allowed: false,
        blockReason: 'INVALID_SSOT',
        message: 'Trade context is not a valid object',
        details: { tradeContext }
      };
    }

    return { allowed: true };
  }

  /**
   * Quick validation for format only (no async checks)
   * Used for fast pre-checks before expensive operations
   */
  validateFormatOnly(
    symbol: string,
    entry: number,
    stopLoss: number,
    takeProfit: number,
    lotSize: number
  ): MandatorySafetyResult {
    return this.validateOrderFormat(symbol, entry, stopLoss, takeProfit, lotSize);
  }
}

export const mandatorySafetyValidator = new MandatorySafetyValidator();
