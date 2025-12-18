/**
 * Risk Profile Validator
 *
 * Pre-trade validation to ensure execution matches the user's selected risk mode
 *
 * CRITICAL: Prevents mismatches like "aggressive goal with conservative execution"
 */

import { validateTradeMatchesProfile, getRiskStrategyProfile } from '../config/risk-strategy-profiles';
import { calculatePipDistance } from '../utils/currencyHelpers';
import { riskAwareStopCalculator } from './risk-aware-stop-calculator';
import { riskAwareTimeframeSelector } from './risk-aware-timeframe-selector';

export interface TradeValidationResult {
  approved: boolean;
  overallScore: number; // 0-100
  warnings: string[];
  errors: string[];
  recommendations: string[];
  breakdown: {
    riskPercentScore: number;
    stopWidthScore: number;
    riskRewardScore: number;
    timeframeScore?: number;
  };
}

export interface TradeValidationInputs {
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  accountBalance: number;
  riskMode: 'low' | 'medium' | 'high';
  timeframe?: string;
  durationMinutes?: number; // How long trade has been open
}

class RiskProfileValidator {
  /**
   * Validate if a proposed trade matches the risk profile
   */
  validateTrade(inputs: TradeValidationInputs): TradeValidationResult {
    const {
      symbol,
      direction,
      entryPrice,
      stopLoss,
      takeProfit,
      lotSize,
      accountBalance,
      riskMode,
      timeframe,
      durationMinutes
    } = inputs;

    console.log(`[Risk Profile Validator] Validating ${symbol} ${direction} trade for ${riskMode.toUpperCase()} mode`);

    const warnings: string[] = [];
    const errors: string[] = [];
    const recommendations: string[] = [];

    // Calculate actual metrics
    const stopPips = calculatePipDistance(symbol, entryPrice, stopLoss);
    const takeProfitPips = calculatePipDistance(symbol, entryPrice, takeProfit);
    const riskRewardRatio = takeProfitPips / stopPips;

    // Calculate actual risk percent
    const pipValue = this.estimatePipValue(symbol, lotSize);
    const dollarRisk = stopPips * pipValue;
    const actualRiskPercent = (dollarRisk / accountBalance) * 100;

    console.log(`  Stop: ${stopPips.toFixed(1)} pips | TP: ${takeProfitPips.toFixed(1)} pips | R:R: ${riskRewardRatio.toFixed(2)}:1`);
    console.log(`  Risk: $${dollarRisk.toFixed(2)} (${actualRiskPercent.toFixed(2)}%) | Lot: ${lotSize.toFixed(2)}`);

    // 1. Validate against risk profile using centralized function
    const profileMatch = validateTradeMatchesProfile(
      riskMode,
      actualRiskPercent,
      stopPips,
      riskRewardRatio,
      durationMinutes || 0
    );

    warnings.push(...profileMatch.warnings);

    // 2. Validate stop loss width
    const stopValidation = riskAwareStopCalculator.validateStopLoss(stopPips, riskMode);
    warnings.push(...stopValidation.warnings);

    // 3. Validate timeframe if provided
    let timeframeScore = 100;
    if (timeframe) {
      const timeframeValidation = riskAwareTimeframeSelector.validateTimeframe(timeframe, riskMode);
      warnings.push(...timeframeValidation.warnings);
      timeframeScore = timeframeValidation.score;
    }

    // 4. Check for critical mismatches
    const profile = getRiskStrategyProfile(riskMode);

    // CRITICAL: Aggressive mode with swing-trade characteristics
    if (riskMode === 'high' && (stopPips > 25 || actualRiskPercent < 1.0)) {
      errors.push(`❌ AGGRESSIVE mode mismatch: Using swing-trade execution (${stopPips.toFixed(1)} pips, ${actualRiskPercent.toFixed(2)}% risk)`);
      errors.push(`   Expected: Scalp-style (10-20 pips, 1.5-2.0% risk)`);
      recommendations.push('Increase lot size and tighten stops for aggressive scalp execution');
    }

    // CRITICAL: Conservative mode with scalp characteristics
    if (riskMode === 'low' && stopPips < 20) {
      errors.push(`⚠️ CONSERVATIVE mode mismatch: Using scalp stops (${stopPips.toFixed(1)} pips)`);
      errors.push(`   Expected: Swing-style (30-50 pips)`);
      recommendations.push('Widen stops and reduce lot size for conservative swing execution');
    }

    // 5. Check for extremely long durations
    if (durationMinutes && durationMinutes > profile.durationWarningThreshold) {
      warnings.push(`Trade duration (${Math.floor(durationMinutes / 60)}h) exceeds ${profile.displayName} mode expectation (${Math.floor(profile.durationWarningThreshold / 60)}h)`);
      recommendations.push(`Consider if ${profile.tradingStyle} strategy is appropriate for this timeframe`);
    }

    // Calculate overall score
    const riskPercentScore = this.scoreRiskPercent(actualRiskPercent, riskMode);
    const stopWidthScore = stopValidation.score;
    const riskRewardScore = this.scoreRiskReward(riskRewardRatio, riskMode);

    const overallScore = (
      riskPercentScore * 0.35 +
      stopWidthScore * 0.35 +
      riskRewardScore * 0.20 +
      timeframeScore * 0.10
    );

    // Determine approval
    const approved = errors.length === 0 && overallScore >= 60;

    if (!approved && errors.length === 0) {
      errors.push(`Overall score (${overallScore.toFixed(0)}/100) below approval threshold (60)`);
    }

    console.log(`  Validation Score: ${overallScore.toFixed(0)}/100 | Approved: ${approved}`);
    console.log(`  Warnings: ${warnings.length} | Errors: ${errors.length}`);

    return {
      approved,
      overallScore,
      warnings,
      errors,
      recommendations,
      breakdown: {
        riskPercentScore,
        stopWidthScore,
        riskRewardScore,
        timeframeScore
      }
    };
  }

  /**
   * Score risk percent against profile
   */
  private scoreRiskPercent(actualRiskPercent: number, riskMode: 'low' | 'medium' | 'high'): number {
    const profile = getRiskStrategyProfile(riskMode);
    const { min, max } = profile.riskPercentRange;

    if (actualRiskPercent >= min && actualRiskPercent <= max) {
      return 100; // Perfect
    }

    if (actualRiskPercent < min) {
      const deviation = (min - actualRiskPercent) / min;
      return Math.max(0, 100 - (deviation * 150)); // Penalty for being too conservative
    }

    if (actualRiskPercent > max) {
      const deviation = (actualRiskPercent - max) / max;
      return Math.max(0, 100 - (deviation * 200)); // Larger penalty for being too aggressive
    }

    return 50;
  }

  /**
   * Score R:R ratio against profile
   */
  private scoreRiskReward(rr: number, riskMode: 'low' | 'medium' | 'high'): number {
    const profile = getRiskStrategyProfile(riskMode);
    const { min, max } = profile.riskRewardRange;

    if (rr >= min && rr <= max) {
      return 100; // Perfect
    }

    if (rr < min) {
      const deviation = (min - rr) / min;
      return Math.max(0, 100 - (deviation * 100)); // Penalty for low R:R
    }

    if (rr > max) {
      // Slightly above max is okay, just not optimal
      const deviation = (rr - max) / max;
      return Math.max(70, 100 - (deviation * 50));
    }

    return 50;
  }

  /**
   * Estimate pip value for risk calculation
   */
  private estimatePipValue(symbol: string, lotSize: number): number {
    // Simplified pip value calculation
    const isGold = symbol.includes('XAU');
    const isJPY = symbol.includes('JPY');

    if (isGold) {
      return lotSize * 100; // Gold: $100 per pip per full lot
    }

    if (isJPY) {
      return lotSize * 1000; // JPY: $10 per pip per 0.01 lot
    }

    return lotSize * 100; // Standard forex: $10 per pip per 0.1 lot
  }

  /**
   * Get validation summary for logging
   */
  getValidationSummary(result: TradeValidationResult): string {
    let summary = `Score: ${result.overallScore.toFixed(0)}/100 | ${result.approved ? '✅ APPROVED' : '❌ REJECTED'}`;

    if (result.errors.length > 0) {
      summary += `\nErrors: ${result.errors.join('; ')}`;
    }

    if (result.warnings.length > 0 && result.warnings.length <= 2) {
      summary += `\nWarnings: ${result.warnings.join('; ')}`;
    } else if (result.warnings.length > 2) {
      summary += `\n${result.warnings.length} warnings detected`;
    }

    if (result.recommendations.length > 0) {
      summary += `\nRecommendations: ${result.recommendations[0]}`;
    }

    return summary;
  }
}

export const riskProfileValidator = new RiskProfileValidator();
