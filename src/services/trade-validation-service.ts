/**
 * Trade Validation Service
 *
 * CRITICAL: Validates all trade parameters before execution
 * Prevents backwards TP/SL that would cause monitoring failures
 */

import { PositionDirection } from '@/types/position';

export interface TradeValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface TradeParams {
  symbol: string;
  direction: PositionDirection;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  lotSize?: number;
}

class TradeValidationService {
  /**
   * Validate trade parameters before execution
   * Returns detailed errors if validation fails
   */
  validateTrade(params: TradeParams): TradeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate required fields
    if (!params.symbol || params.symbol.trim() === '') {
      errors.push('Symbol is required');
    }

    if (!params.direction || !['buy', 'sell'].includes(params.direction)) {
      errors.push('Direction must be "buy" or "sell"');
    }

    if (!params.entryPrice || params.entryPrice <= 0) {
      errors.push('Entry price must be greater than 0');
    }

    if (!params.stopLoss || params.stopLoss <= 0) {
      errors.push('Stop loss must be greater than 0');
    }

    if (!params.takeProfit || params.takeProfit <= 0) {
      errors.push('Take profit must be greater than 0');
    }

    // If basic validation failed, return early
    if (errors.length > 0) {
      return { isValid: false, errors, warnings };
    }

    // CRITICAL: Validate TP/SL direction logic
    if (params.direction === 'buy') {
      // BUY trades: SL must be BELOW entry, TP must be ABOVE entry
      if (params.stopLoss >= params.entryPrice) {
        errors.push(
          `INVALID BUY TRADE: Stop Loss (${params.stopLoss.toFixed(5)}) must be BELOW Entry (${params.entryPrice.toFixed(5)}). ` +
          `Currently ${((params.stopLoss - params.entryPrice) * 10000).toFixed(1)} pips ABOVE entry (should be negative).`
        );
      }

      if (params.takeProfit <= params.entryPrice) {
        errors.push(
          `INVALID BUY TRADE: Take Profit (${params.takeProfit.toFixed(5)}) must be ABOVE Entry (${params.entryPrice.toFixed(5)}). ` +
          `Currently ${((params.takeProfit - params.entryPrice) * 10000).toFixed(1)} pips BELOW entry (should be positive).`
        );
      }
    } else if (params.direction === 'sell') {
      // SELL trades: SL must be ABOVE entry, TP must be BELOW entry
      if (params.stopLoss <= params.entryPrice) {
        errors.push(
          `INVALID SELL TRADE: Stop Loss (${params.stopLoss.toFixed(5)}) must be ABOVE Entry (${params.entryPrice.toFixed(5)}). ` +
          `Currently ${((params.entryPrice - params.stopLoss) * 10000).toFixed(1)} pips BELOW entry (should be above).`
        );
      }

      if (params.takeProfit >= params.entryPrice) {
        errors.push(
          `INVALID SELL TRADE: Take Profit (${params.takeProfit.toFixed(5)}) must be BELOW Entry (${params.entryPrice.toFixed(5)}). ` +
          `Currently ${((params.takeProfit - params.entryPrice) * 10000).toFixed(1)} pips ABOVE entry (should be below).`
        );
      }
    }

    // Validate risk/reward ratio is reasonable
    const riskDistance = Math.abs(params.entryPrice - params.stopLoss);
    const rewardDistance = Math.abs(params.takeProfit - params.entryPrice);
    const riskRewardRatio = rewardDistance / riskDistance;

    if (riskRewardRatio < 0.5) {
      warnings.push(
        `Risk/Reward ratio is very low (${riskRewardRatio.toFixed(2)}:1). ` +
        `Risk: ${(riskDistance * 10000).toFixed(1)} pips, Reward: ${(rewardDistance * 10000).toFixed(1)} pips.`
      );
    }

    if (riskRewardRatio > 10) {
      warnings.push(
        `Risk/Reward ratio is extremely high (${riskRewardRatio.toFixed(2)}:1). ` +
        `This may indicate SL is too tight. Risk: ${(riskDistance * 10000).toFixed(1)} pips, Reward: ${(rewardDistance * 10000).toFixed(1)} pips.`
      );
    }

    // Validate lot size if provided
    if (params.lotSize !== undefined) {
      if (params.lotSize <= 0) {
        errors.push('Lot size must be greater than 0');
      }

      if (params.lotSize > 100) {
        warnings.push(`Lot size (${params.lotSize}) is very large. Standard range is 0.01-10 lots.`);
      }

      if (params.lotSize < 0.01) {
        warnings.push(`Lot size (${params.lotSize}) is below minimum (0.01 lots).`);
      }
    }

    // Validate price values are in reasonable forex range
    const priceValues = [params.entryPrice, params.stopLoss, params.takeProfit];
    const allPricesReasonable = priceValues.every(p => p > 0.0001 && p < 1000000);

    if (!allPricesReasonable) {
      errors.push(
        `Price values out of reasonable range. Entry: ${params.entryPrice}, SL: ${params.stopLoss}, TP: ${params.takeProfit}`
      );
    }

    const isValid = errors.length === 0;

    return { isValid, errors, warnings };
  }

  /**
   * Validate trade and throw error if invalid
   * Use this when you want to prevent invalid trades from being created
   */
  validateOrThrow(params: TradeParams): void {
    const result = this.validateTrade(params);

    if (!result.isValid) {
      const errorMessage = [
        '❌ TRADE VALIDATION FAILED:',
        ...result.errors,
        result.warnings.length > 0 ? '\nWarnings:' : '',
        ...result.warnings
      ].filter(Boolean).join('\n  ');

      throw new Error(errorMessage);
    }

    // Log warnings even if trade is valid
    if (result.warnings.length > 0) {
      console.warn('[TradeValidation] Warnings for trade:', params);
      result.warnings.forEach(warning => console.warn(`  ⚠️ ${warning}`));
    }
  }

  /**
   * Quick validation check - returns boolean only
   */
  isValid(params: TradeParams): boolean {
    return this.validateTrade(params).isValid;
  }

  /**
   * Auto-correct common mistakes in TP/SL placement
   * ONLY use this if you're confident the direction is correct
   */
  autoCorrectLevels(params: TradeParams): TradeParams {
    const corrected = { ...params };

    if (params.direction === 'buy') {
      // If SL is above entry, swap with TP (common mistake)
      if (params.stopLoss > params.entryPrice && params.takeProfit < params.entryPrice) {
        console.warn(`[TradeValidation] Auto-correcting: Swapping SL and TP for BUY trade (they were backwards)`);
        corrected.stopLoss = params.takeProfit;
        corrected.takeProfit = params.stopLoss;
      }
    } else if (params.direction === 'sell') {
      // If SL is below entry, swap with TP
      if (params.stopLoss < params.entryPrice && params.takeProfit > params.entryPrice) {
        console.warn(`[TradeValidation] Auto-correcting: Swapping SL and TP for SELL trade (they were backwards)`);
        corrected.stopLoss = params.takeProfit;
        corrected.takeProfit = params.stopLoss;
      }
    }

    return corrected;
  }
}

export const tradeValidationService = new TradeValidationService();
