/**
 * Risk-Aware Stop Loss Calculator
 *
 * Calculates appropriate stop loss widths based on:
 * - Risk mode strategy (aggressive = tight stops, conservative = wide stops)
 * - ATR (Average True Range)
 * - Symbol type (forex, metals, indices)
 * - Market volatility
 *
 * CRITICAL: Stop width is a STRATEGY characteristic, not just risk management
 */

import { getRiskStrategyProfile, getStopLossMultiplierRange, getTypicalStopPipsRange } from '../config/risk-strategy-profiles';
import { getCurrencyPipInfo, isXAUUSD, isJPYPair, isIndex } from '../utils/currencyHelpers';

export interface StopLossCalculation {
  stopLossPips: number;
  stopLossPrice: number;
  atrMultiplier: number;
  reasoning: string;
  withinProfileRange: boolean;
  profileMinPips: number;
  profileMaxPips: number;
}

export interface StopCalculatorInputs {
  symbol: string;
  entryPrice: number;
  direction: 'buy' | 'sell';
  riskMode: 'low' | 'medium' | 'high';
  atr: number; // Average True Range in price units
  marketVolatility?: 'low' | 'normal' | 'high';
}

class RiskAwareStopCalculator {
  /**
   * Calculate appropriate stop loss based on risk profile and market conditions
   */
  calculateStopLoss(inputs: StopCalculatorInputs): StopLossCalculation {
    const { symbol, entryPrice, direction, riskMode, atr, marketVolatility = 'normal' } = inputs;

    const profile = getRiskStrategyProfile(riskMode);
    const pipInfo = getCurrencyPipInfo(symbol);
    const atrMultiplierRange = getStopLossMultiplierRange(riskMode);
    const typicalPipsRange = getTypicalStopPipsRange(riskMode);

    console.log(`[Stop Calculator] ${symbol} ${riskMode.toUpperCase()} mode:`);
    console.log(`  ATR: ${atr.toFixed(5)} | Profile: ${profile.tradingStyle}`);
    console.log(`  ATR Multiplier Range: ${atrMultiplierRange.min}x - ${atrMultiplierRange.max}x`);
    console.log(`  Typical Pips Range: ${typicalPipsRange.min} - ${typicalPipsRange.max}`);

    // Calculate ATR in pips
    const atrPips = atr / pipInfo.pipValue;
    console.log(`  ATR in pips: ${atrPips.toFixed(1)}`);

    // Determine ATR multiplier based on volatility and risk mode
    let atrMultiplier = (atrMultiplierRange.min + atrMultiplierRange.max) / 2; // Start with average

    // Adjust for market volatility
    if (marketVolatility === 'high') {
      atrMultiplier *= 1.2; // Wider stops in high volatility
      console.log(`  High volatility: Multiplier increased to ${atrMultiplier.toFixed(2)}x`);
    } else if (marketVolatility === 'low') {
      atrMultiplier *= 0.9; // Tighter stops in low volatility
      console.log(`  Low volatility: Multiplier decreased to ${atrMultiplier.toFixed(2)}x`);
    }

    // Calculate stop distance in pips
    let stopPips = atrPips * atrMultiplier;

    // Clamp to risk profile range
    const minPips = typicalPipsRange.min;
    const maxPips = typicalPipsRange.max;
    const beforeClamp = stopPips;
    stopPips = Math.max(minPips, Math.min(maxPips, stopPips));

    const withinProfileRange = (beforeClamp === stopPips);
    if (!withinProfileRange) {
      console.log(`  Stop clamped: ${beforeClamp.toFixed(1)} → ${stopPips.toFixed(1)} pips`);
    }

    // Calculate stop loss price
    const stopDistance = stopPips * pipInfo.pipValue;
    const stopLossPrice = direction === 'buy'
      ? entryPrice - stopDistance
      : entryPrice + stopDistance;

    // Generate reasoning
    let reasoning = `${profile.tradingStyle.toUpperCase()} strategy: ${stopPips.toFixed(1)} pips (${atrMultiplier.toFixed(2)}x ATR)`;

    if (!withinProfileRange) {
      if (stopPips === minPips) {
        reasoning += ` - clamped to profile minimum`;
      } else if (stopPips === maxPips) {
        reasoning += ` - clamped to profile maximum`;
      }
    }

    if (marketVolatility !== 'normal') {
      reasoning += ` - adjusted for ${marketVolatility} volatility`;
    }

    console.log(`  Final Stop: ${stopPips.toFixed(1)} pips at ${stopLossPrice.toFixed(pipInfo.decimalPlaces)}`);
    console.log(`  Reasoning: ${reasoning}`);

    return {
      stopLossPips: stopPips,
      stopLossPrice,
      atrMultiplier,
      reasoning,
      withinProfileRange,
      profileMinPips: minPips,
      profileMaxPips: maxPips
    };
  }

  /**
   * Validate if a proposed stop loss matches the risk profile
   */
  validateStopLoss(
    stopPips: number,
    riskMode: 'low' | 'medium' | 'high'
  ): {
    valid: boolean;
    warnings: string[];
    score: number; // 0-100
  } {
    const profile = getRiskStrategyProfile(riskMode);
    const typicalRange = getTypicalStopPipsRange(riskMode);

    const warnings: string[] = [];
    let score = 100;

    if (stopPips < typicalRange.min) {
      warnings.push(`Stop too tight: ${stopPips.toFixed(1)} pips < ${typicalRange.min} (${riskMode} ${profile.tradingStyle} minimum)`);
      score -= 30;
    }

    if (stopPips > typicalRange.max) {
      warnings.push(`Stop too wide: ${stopPips.toFixed(1)} pips > ${typicalRange.max} (${riskMode} ${profile.tradingStyle} maximum)`);
      score -= 30;
    }

    // Aggressive mode with swing-trade stops is a red flag
    if (riskMode === 'high' && stopPips > 25) {
      warnings.push(`AGGRESSIVE mode using SWING stops (${stopPips.toFixed(1)} pips) - should be scalp-style (10-20 pips)`);
      score -= 40;
    }

    // Conservative mode with scalp stops is suboptimal
    if (riskMode === 'low' && stopPips < 25) {
      warnings.push(`CONSERVATIVE mode using SCALP stops (${stopPips.toFixed(1)} pips) - consider wider stops (30-50 pips)`);
      score -= 20;
    }

    return {
      valid: warnings.length === 0,
      warnings,
      score: Math.max(0, score)
    };
  }

  /**
   * Get recommended stop width explanation for a risk mode
   */
  getRecommendation(riskMode: 'low' | 'medium' | 'high', atr?: number): string {
    const profile = getRiskStrategyProfile(riskMode);
    const stopRange = getTypicalStopPipsRange(riskMode);
    const atrRange = getStopLossMultiplierRange(riskMode);

    let recommendation = `${profile.displayName} mode (${profile.tradingStyle}): ${stopRange.min}-${stopRange.max} pips`;
    recommendation += ` | ${atrRange.min}x-${atrRange.max}x ATR`;

    if (atr) {
      const atrMultiplier = (atrRange.min + atrRange.max) / 2;
      const suggestedPips = (atr * 10000) * atrMultiplier; // Convert to pips
      recommendation += ` | With current ATR: ~${suggestedPips.toFixed(0)} pips`;
    }

    return recommendation;
  }
}

export const riskAwareStopCalculator = new RiskAwareStopCalculator();
