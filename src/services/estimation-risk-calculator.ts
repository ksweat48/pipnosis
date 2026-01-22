/**
 * EstimationRiskCalculator - Fast position size estimation service
 *
 * ✅ PHASE 3.1 SECTION 3: SSOT for pre-trade estimations
 *
 * PURPOSE:
 * - Fast, synchronous position size calculations for feasibility checks
 * - Does NOT replace ProfessionalRiskManager (which is for actual execution)
 * - Separated from execution path to avoid architectural confusion
 *
 * AUTHORITY:
 * - SSOT for all estimation/feasibility calculations
 * - Used by: goal-feasibility-resolver, goal-session-live-engine
 * - NOT used for: actual trade execution (use ProfessionalRiskManager)
 *
 * KEY DIFFERENCES FROM ProfessionalRiskManager:
 * - Synchronous (no database calls)
 * - Simplified calculations (no Kelly, EV, correlation)
 * - Fast performance for UI feedback
 * - Conservative defaults
 *
 * USAGE:
 * ```typescript
 * const estimator = new EstimationRiskCalculator();
 * const estimate = estimator.estimatePositionSize({
 *   balance: 10000,
 *   riskPercent: 0.01,
 *   symbol: 'EURUSD',
 *   entryPrice: 1.1000,
 *   stopLossPrice: 1.0950
 * });
 * // Returns: { lotSize: 0.04, riskAmount: 100, pipsRisked: 50 }
 * ```
 */

import { calculateDollarPerPip, calculatePipDistance } from '../utils/currencyHelpers';
import { logger, LogCategory, LogLevel } from '../lib/logger';

export interface EstimationInputs {
  balance: number;
  riskPercent: number; // 0.01 = 1%
  symbol: string;
  entryPrice: number;
  stopLossPrice: number;
  isEstimation?: boolean; // Flag for logging context
}

export interface PositionSizeEstimate {
  lotSize: number;
  riskAmount: number;
  pipsRisked: number;
  estimationMethod: 'standard' | 'conservative_fallback';
  warnings: string[];
}

/**
 * EstimationRiskCalculator - SSOT for pre-trade position size estimations
 *
 * Responsibilities:
 * - Fast position size calculations for UI/feasibility
 * - Synchronous operation (no async dependencies)
 * - Conservative estimates for safety
 * - Clear warnings when estimates may be inaccurate
 *
 * Non-Responsibilities:
 * - Actual trade execution (use ProfessionalRiskManager)
 * - Kelly Criterion optimization
 * - EV gating
 * - Correlation checks
 * - Market condition adjustments
 */
export class EstimationRiskCalculator {
  private readonly MIN_LOT_SIZE = 0.01;
  private readonly MAX_LOT_SIZE = 100.0;
  private readonly MIN_PIPS_RISKED = 5; // Minimum distance for realistic estimates

  /**
   * Estimate position size based on risk parameters
   *
   * @param inputs - Risk parameters for estimation
   * @returns Position size estimate with warnings
   */
  estimatePositionSize(inputs: EstimationInputs): PositionSizeEstimate {
    const { balance, riskPercent, symbol, entryPrice, stopLossPrice, isEstimation = true } = inputs;
    const warnings: string[] = [];

    // Validation
    if (balance <= 0 || riskPercent <= 0) {
      warnings.push('Invalid balance or risk percent - using minimum lot size');
      return {
        lotSize: this.MIN_LOT_SIZE,
        riskAmount: 0,
        pipsRisked: 0,
        estimationMethod: 'conservative_fallback',
        warnings
      };
    }

    if (entryPrice <= 0 || stopLossPrice <= 0) {
      warnings.push('Invalid price - using minimum lot size');
      return {
        lotSize: this.MIN_LOT_SIZE,
        riskAmount: 0,
        pipsRisked: 0,
        estimationMethod: 'conservative_fallback',
        warnings
      };
    }

    // Calculate risk amount
    const riskAmount = balance * riskPercent;

    // Calculate pip distance
    const pipsRisked = Math.abs(calculatePipDistance(symbol, entryPrice, stopLossPrice));

    // Check minimum pip distance
    if (pipsRisked < this.MIN_PIPS_RISKED) {
      warnings.push(`SL too close (${pipsRisked.toFixed(1)} pips) - estimation may be inaccurate`);
    }

    // Calculate dollar per pip for 1 standard lot
    const dollarPerPipPerLot = calculateDollarPerPip(symbol, 1.0);

    if (dollarPerPipPerLot === 0) {
      warnings.push('Unable to calculate dollar per pip - using minimum lot size');
      return {
        lotSize: this.MIN_LOT_SIZE,
        riskAmount,
        pipsRisked,
        estimationMethod: 'conservative_fallback',
        warnings
      };
    }

    // Calculate required lot size
    // Formula: lotSize = riskAmount / (pipsRisked * dollarPerPipPerLot)
    const calculatedLotSize = riskAmount / (pipsRisked * dollarPerPipPerLot);

    // Apply bounds
    let lotSize = Math.max(this.MIN_LOT_SIZE, Math.min(calculatedLotSize, this.MAX_LOT_SIZE));

    // Round to 2 decimal places
    lotSize = Math.round(lotSize * 100) / 100;

    // Warning if lot size capped
    if (calculatedLotSize > this.MAX_LOT_SIZE) {
      warnings.push(`Calculated lot size (${calculatedLotSize.toFixed(2)}) exceeds maximum`);
    }

    if (calculatedLotSize < this.MIN_LOT_SIZE) {
      warnings.push(`Calculated lot size (${calculatedLotSize.toFixed(2)}) below minimum`);
    }

    if (isEstimation) {
      logger.info('[EstimationRiskCalculator] Estimated position size', LogCategory.RISK, {
        symbol,
        balance,
        riskPercent: (riskPercent * 100).toFixed(2) + '%',
        riskAmount: riskAmount.toFixed(2),
        pipsRisked: pipsRisked.toFixed(1),
        lotSize: lotSize.toFixed(2),
        warnings: warnings.length > 0 ? warnings : 'none'
      });
    }

    return {
      lotSize,
      riskAmount,
      pipsRisked,
      estimationMethod: warnings.length > 0 ? 'conservative_fallback' : 'standard',
      warnings
    };
  }

  /**
   * Estimate position size from dollar risk amount
   *
   * Convenience method for when risk amount is already calculated
   *
   * @param symbol - Trading symbol
   * @param riskAmount - Dollar amount to risk
   * @param entryPrice - Entry price
   * @param stopLossPrice - Stop loss price
   * @returns Position size estimate
   */
  estimateFromDollarRisk(
    symbol: string,
    riskAmount: number,
    entryPrice: number,
    stopLossPrice: number
  ): PositionSizeEstimate {
    // Calculate balance and risk percent that would result in this risk amount
    // (This is a reverse calculation for convenience)
    const balance = riskAmount * 100; // Assume 1% risk
    const riskPercent = 0.01;

    return this.estimatePositionSize({
      balance,
      riskPercent,
      symbol,
      entryPrice,
      stopLossPrice,
      isEstimation: true
    });
  }

  /**
   * Estimate position size from ATR-based targets
   *
   * Used for goal feasibility calculations where exact prices aren't known
   *
   * @param targetProfit - Target profit in dollars
   * @param atrValue - ATR value in price units
   * @param currentPrice - Current market price
   * @returns Simplified lot size estimate
   */
  estimateFromATR(
    targetProfit: number,
    atrValue: number,
    currentPrice: number
  ): number {
    if (atrValue === 0 || targetProfit <= 0) {
      return this.MIN_LOT_SIZE;
    }

    // Simplified estimation: lotSize ≈ targetProfit / (ATR * 10)
    // This assumes roughly 1 ATR = 10 pips and $1/pip per 0.01 lot
    const estimatedLotSize = Math.max(
      this.MIN_LOT_SIZE,
      (targetProfit / (atrValue * 10)) * 0.01
    );

    // Round to 2 decimals
    return Math.round(estimatedLotSize * 100) / 100;
  }
}

// Singleton instance for easy import
export const estimationRiskCalculator = new EstimationRiskCalculator();

/**
 * ARCHITECTURAL NOTES:
 *
 * WHY THIS SERVICE EXISTS:
 * - ProfessionalRiskManager is async and requires database access
 * - Estimations need to be fast and synchronous for UI responsiveness
 * - Separating estimation from execution prevents architectural confusion
 * - Allows different calculation methods appropriate for each use case
 *
 * WHEN TO USE EstimationRiskCalculator:
 * - Goal feasibility checks (before scanning)
 * - UI feedback (projected lot sizes)
 * - Quick calculations (no database needed)
 * - Conservative estimates (for planning)
 *
 * WHEN TO USE ProfessionalRiskManager:
 * - Actual trade execution
 * - Final position sizing before order placement
 * - Kelly Criterion optimization
 * - Full risk assessment with all factors
 *
 * SSOT COMPLIANCE:
 * ✅ Single authority for estimation calculations
 * ✅ Clear separation from execution path
 * ✅ Documented usage guidelines
 * ✅ No duplicate logic allowed
 */
