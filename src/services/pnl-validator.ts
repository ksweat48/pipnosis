/**
 * P&L Validator Service
 *
 * Validates P&L calculations to prevent catastrophic errors like the $93,551 bug.
 * Implements circuit breakers and sanity checks on all P&L calculations.
 */

import { calculatePipDistance, calculateDollarPerPip, getCurrencyPipInfo } from '../utils/currencyHelpers';
import { prodLogger } from '../lib/production-logger';

export interface PnLValidationResult {
  isValid: boolean;
  pnl: number;
  errors: string[];
  warnings: string[];
  details: {
    pipDistance: number;
    dollarPerPip: number;
    expectedRange: { min: number; max: number };
    suspiciousFactors: string[];
  };
}

class PnLValidator {
  /**
   * Validate P&L calculation for a trade
   * Returns false if P&L appears incorrect or suspiciously large
   */
  validatePnL(
    symbol: string,
    entryPrice: number,
    exitPrice: number,
    positionSize: number,
    direction: 'buy' | 'sell',
    accountBalance: number = 100000
  ): PnLValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suspiciousFactors: string[] = [];

    // Calculate P&L using correct formula
    const pipDistance = calculatePipDistance(symbol, entryPrice, exitPrice);
    const dollarPerPip = calculateDollarPerPip(symbol, positionSize);
    const calculatedPnL = direction === 'buy'
      ? pipDistance * dollarPerPip
      : -pipDistance * dollarPerPip;

    // Validate position size is in LOTS (0.01-100) not UNITS (100,000+)
    if (positionSize > 100) {
      errors.push(`Position size ${positionSize} is suspiciously large. Should be in LOTS (0.01-100), not UNITS.`);
      suspiciousFactors.push('position_size_too_large');
    }

    if (positionSize < 0.001) {
      errors.push(`Position size ${positionSize} is suspiciously small. Minimum should be 0.01 lots.`);
      suspiciousFactors.push('position_size_too_small');
    }

    // Validate P&L doesn't exceed reasonable percentage of account balance
    const pnlPercentOfBalance = (Math.abs(calculatedPnL) / accountBalance) * 100;
    if (pnlPercentOfBalance > 50) {
      errors.push(`P&L of $${calculatedPnL.toFixed(2)} is ${pnlPercentOfBalance.toFixed(1)}% of account balance. This is suspicious for a single trade.`);
      suspiciousFactors.push('pnl_exceeds_50_percent_balance');
    } else if (pnlPercentOfBalance > 25) {
      warnings.push(`P&L of $${calculatedPnL.toFixed(2)} is ${pnlPercentOfBalance.toFixed(1)}% of account balance. This is unusually high.`);
      suspiciousFactors.push('pnl_exceeds_25_percent_balance');
    }

    // Validate pip distance is reasonable
    const pipInfo = getCurrencyPipInfo(symbol);
    if (Math.abs(pipDistance) > 10000) {
      errors.push(`Pip distance of ${pipDistance.toFixed(1)} pips is suspiciously large. Check price values.`);
      suspiciousFactors.push('pip_distance_too_large');
    }

    // Validate entry and exit prices are in reasonable ranges
    if (entryPrice === 0 || exitPrice === 0) {
      errors.push('Entry or exit price is zero. Invalid price data.');
      suspiciousFactors.push('zero_price');
    }

    // Calculate expected P&L range based on typical pip movements
    const typicalPipRange = 100; // Most trades are < 100 pips
    const maxReasonablePnL = typicalPipRange * dollarPerPip;
    const expectedRange = {
      min: -maxReasonablePnL,
      max: maxReasonablePnL
    };

    if (Math.abs(calculatedPnL) > maxReasonablePnL * 2) {
      warnings.push(`P&L of $${calculatedPnL.toFixed(2)} exceeds typical range of ±$${maxReasonablePnL.toFixed(2)} for this position size.`);
      suspiciousFactors.push('exceeds_typical_range');
    }

    // Validate against common error patterns
    // Check if P&L looks like it was calculated using raw price difference (US30 bug pattern)
    const rawPriceDiff = Math.abs(exitPrice - entryPrice);
    const suspiciousRawCalculation = rawPriceDiff * positionSize;
    if (Math.abs(suspiciousRawCalculation - Math.abs(calculatedPnL)) > Math.abs(calculatedPnL) * 10) {
      warnings.push('P&L calculation appears to be using raw price difference instead of pip-based calculation.');
      suspiciousFactors.push('possible_raw_price_bug');
    }

    const isValid = errors.length === 0;

    if (!isValid) {
      prodLogger.error('pnl_validation', 'P&L validation failed', {
        symbol,
        entryPrice,
        exitPrice,
        positionSize,
        direction,
        calculatedPnL,
        errors,
        warnings,
        suspiciousFactors
      });
    } else if (warnings.length > 0) {
      prodLogger.warn('pnl_validation', 'P&L validation warnings', {
        symbol,
        calculatedPnL,
        warnings,
        suspiciousFactors
      });
    }

    return {
      isValid,
      pnl: calculatedPnL,
      errors,
      warnings,
      details: {
        pipDistance,
        dollarPerPip,
        expectedRange,
        suspiciousFactors
      }
    };
  }

  /**
   * Recalculate and validate P&L for an existing trade record
   * Use this to audit/fix corrupted P&L values in the database
   */
  recalculatePnL(trade: {
    symbol: string;
    entry_price: number;
    exit_price: number;
    position_size: number;
    direction: 'buy' | 'sell';
    profit_loss?: number;
  }): {
    originalPnL: number;
    correctedPnL: number;
    wasCorrupted: boolean;
    correctionReason: string;
  } {
    const originalPnL = trade.profit_loss || 0;

    // Recalculate using correct formula
    const pipDistance = calculatePipDistance(trade.symbol, trade.entry_price, trade.exit_price);
    const dollarPerPip = calculateDollarPerPip(trade.symbol, trade.position_size);
    const correctedPnL = trade.direction === 'buy'
      ? pipDistance * dollarPerPip
      : -pipDistance * dollarPerPip;

    // Check if original P&L was corrupted
    const pnlDifference = Math.abs(originalPnL - correctedPnL);
    const percentageDiff = Math.abs(pnlDifference / correctedPnL) * 100;

    let wasCorrupted = false;
    let correctionReason = '';

    // If difference is > 10% and > $10, consider it corrupted
    if (pnlDifference > 10 && percentageDiff > 10) {
      wasCorrupted = true;
      correctionReason = `Original P&L of $${originalPnL.toFixed(2)} differs from correct value by ${percentageDiff.toFixed(1)}% ($${pnlDifference.toFixed(2)})`;

      prodLogger.warn('pnl_correction', 'Corrupted P&L detected and corrected', {
        symbol: trade.symbol,
        originalPnL,
        correctedPnL,
        difference: pnlDifference,
        percentageDiff,
        entryPrice: trade.entry_price,
        exitPrice: trade.exit_price,
        positionSize: trade.position_size
      });
    }

    return {
      originalPnL,
      correctedPnL,
      wasCorrupted,
      correctionReason
    };
  }

  /**
   * Circuit breaker: Halt trading if P&L calculation appears broken
   */
  checkCircuitBreaker(
    recentPnLs: number[],
    accountBalance: number
  ): { shouldHalt: boolean; reason: string } {
    if (recentPnLs.length === 0) {
      return { shouldHalt: false, reason: '' };
    }

    // Check for impossible P&L values
    const suspiciouslyLargePnLs = recentPnLs.filter(
      pnl => Math.abs(pnl) > accountBalance * 0.5
    );

    if (suspiciouslyLargePnLs.length > 0) {
      return {
        shouldHalt: true,
        reason: `Detected ${suspiciouslyLargePnLs.length} trade(s) with P&L exceeding 50% of account balance. Possible calculation error. Trading halted for safety.`
      };
    }

    // Check for pattern of all large P&Ls (possible systematic error)
    const avgPnL = recentPnLs.reduce((sum, pnl) => sum + Math.abs(pnl), 0) / recentPnLs.length;
    if (avgPnL > accountBalance * 0.2) {
      return {
        shouldHalt: true,
        reason: `Average P&L of $${avgPnL.toFixed(2)} is unusually high (>20% of balance). Possible systematic calculation error.`
      };
    }

    return { shouldHalt: false, reason: '' };
  }
}

export const pnlValidator = new PnLValidator();
