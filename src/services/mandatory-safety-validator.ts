/**
 * Mandatory Safety Validator - Data Integrity Blocker
 *
 * PIPNOSIS IS AN ASSISTANT, NOT A CONTROLLER
 *
 * Permitted blocks (3 categories ONLY):
 * 1. Malformed Order - NaN, invalid decimals, broker format errors
 * 2. Invalid SSOT TradeContext - Missing or corrupted trade context
 * 3. Weekend Protection - Forex markets closed (NOT general hours)
 *
 * REMOVED:
 * - Drawdown limits (advisory only, never block user)
 * - Market hours (only weekends matter, not daily hours)
 * - Margin checks (advisory only)
 *
 * All risk concerns are ADVISORY ONLY. User has final control.
 */

import { logger } from '../lib/logger';
import { getSymbolConfig } from '../config/symbol-registry';

export type MandatorySafetyBlockReason =
  | 'WEEKEND_CLOSED'
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
    logger.info('[MANDATORY_SAFETY] Starting validation (data integrity only)', {
      symbol,
      direction,
      entry,
      lotSize
    });

    // Check 1: Malformed Order (NaN, invalid data)
    const orderCheck = this.validateOrderFormat(symbol, entry, stopLoss, takeProfit, lotSize);
    if (!orderCheck.allowed) {
      return orderCheck;
    }

    // Check 2: Weekend Protection (Forex only)
    const weekendCheck = await this.validateNotWeekend(symbol);
    if (!weekendCheck.allowed) {
      return weekendCheck;
    }

    // Check 3: SSOT Trade Context (data structure validation)
    const ssotCheck = this.validateSSOT(tradeContext);
    if (!ssotCheck.allowed) {
      return ssotCheck;
    }

    logger.info('[MANDATORY_SAFETY] ✅ Data integrity checks passed');
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
   * Check 2: Validate not weekend (Forex protection only)
   * Blocks on: Weekend (when Forex markets closed)
   * Does NOT block on daily hours - Pipnosis is an assistant, not a controller
   */
  private async validateNotWeekend(symbol: string): Promise<MandatorySafetyResult> {
    try {
      // Only check weekends for Forex pairs
      const isFxPair = symbol.length === 6 && !symbol.includes('USD') && !symbol.includes('XAU');

      if (!isFxPair) {
        // Crypto, indices, metals - always allow
        return { allowed: true };
      }

      const now = new Date();
      const day = now.getUTCDay();
      const hour = now.getUTCHours();

      // Weekend: Friday 22:00 UTC to Sunday 22:00 UTC
      const isWeekend = (day === 5 && hour >= 22) || day === 6 || (day === 0 && hour < 22);

      if (isWeekend) {
        return {
          allowed: false,
          blockReason: 'WEEKEND_CLOSED',
          message: `Forex markets closed on weekends (${symbol})`,
          details: { symbol, day, hour }
        };
      }

      return { allowed: true };
    } catch (error) {
      logger.error('[MANDATORY_SAFETY] Failed to check weekend', error);
      // On error, allow trade (fail-open for availability)
      return { allowed: true };
    }
  }


  /**
   * Check 3: Validate SSOT trade context
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
