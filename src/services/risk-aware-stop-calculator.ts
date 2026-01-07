/**
 * Risk-Aware Stop Loss Calculator
 *
 * Calculates appropriate stop loss widths based on:
 * - Risk mode strategy (aggressive = tight stops, conservative = wide stops)
 * - ATR (Average True Range) with EXPLICIT timeframe tracking
 * - Symbol type (forex, metals, indices)
 * - Market volatility
 *
 * CRITICAL: Stop width is a STRATEGY characteristic, not just risk management
 *
 * ATR SSOT COMPLIANCE:
 * - Accepts typed ATRValue with explicit timeframe
 * - Validates timeframe matches expected context (H1 for strategic stops)
 * - Logs ATR source for transparency
 */

import { getRiskStrategyProfile, getStopLossMultiplierRange, getTypicalStopPipsRange } from '../config/risk-strategy-profiles';
import { getCurrencyPipInfo, isXAUUSD, isJPYPair, isIndex, isCrypto } from '../utils/currencyHelpers';
import { type ATRValue, type ATRTimeframe } from '../types/atr';

export interface StopLossCalculation {
  stopLossPips: number;
  stopLossPrice: number;
  atrMultiplier: number;
  reasoning: string;
  withinProfileRange: boolean;
  profileMinPips: number;
  profileMaxPips: number;
  atrTimeframe?: ATRTimeframe; // Track which timeframe ATR was from
  noiseFloorPips?: number;      // Statistical minimum for survival
  noiseFloorReasoning?: string; // Explanation of noise floor
}

export interface StopCalculatorInputs {
  symbol: string;
  entryPrice: number;
  direction: 'buy' | 'sell';
  riskMode: 'low' | 'medium' | 'high';
  atr: number | ATRValue; // Accepts both for backward compatibility during migration
  marketVolatility?: 'low' | 'normal' | 'high';
}

class RiskAwareStopCalculator {
  /**
   * Calculate appropriate stop loss based on risk profile and market conditions
   */
  calculateStopLoss(inputs: StopCalculatorInputs): StopLossCalculation {
    const { symbol, entryPrice, direction, riskMode, marketVolatility = 'normal' } = inputs;

    // Extract ATR value and timeframe (handle both typed and legacy formats)
    const atrValue = typeof inputs.atr === 'number' ? inputs.atr : inputs.atr.value;
    const atrTimeframe = typeof inputs.atr === 'number' ? undefined : inputs.atr.timeframe;

    if (typeof inputs.atr !== 'number') {
      console.log(`[Stop Calculator] Using ${inputs.atr.timeframe} ATR (${inputs.atr.period}-period)`);

      // Warn if not using expected timeframe for strategic stops
      if (inputs.atr.timeframe !== 'H1') {
        console.warn(
          `[Stop Calculator] ⚠️ Using ${inputs.atr.timeframe} ATR for stop calculation. ` +
          `Strategic stops typically use H1 ATR. This may result in suboptimal stop widths.`
        );
      }
    }

    // CRYPTO SPECIAL HANDLING: Use percentage-based stops instead of pip-based
    if (isCrypto(symbol)) {
      return this.calculateCryptoStopLoss(inputs);
    }

    const profile = getRiskStrategyProfile(riskMode);
    const pipInfo = getCurrencyPipInfo(symbol);
    const atrMultiplierRange = getStopLossMultiplierRange(riskMode);
    const typicalPipsRange = getTypicalStopPipsRange(riskMode);

    console.log(`[Stop Calculator] ${symbol} ${riskMode.toUpperCase()} mode:`);
    console.log(`  ATR: ${atrValue.toFixed(5)}${atrTimeframe ? ` (${atrTimeframe})` : ''} | Risk: ${profile.riskPercentRange.min}-${profile.riskPercentRange.max}%`);
    console.log(`  ATR Multiplier Range: ${atrMultiplierRange.min}x - ${atrMultiplierRange.max}x`);
    console.log(`  Typical Pips Range: ${typicalPipsRange.min} - ${typicalPipsRange.max}`);

    // Calculate ATR in pips
    const atrPips = atrValue / pipInfo.pipValue;
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
    let reasoning = `${profile.displayName} (${profile.riskPercentRange.min}-${profile.riskPercentRange.max}%): ${stopPips.toFixed(1)} pips (${atrMultiplier.toFixed(2)}x ATR)`;

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
      profileMaxPips: maxPips,
      atrTimeframe
    };
  }

  /**
   * Calculate crypto-specific stop loss using PERCENTAGE instead of pips
   * This prevents microscopic stops like $20 on $90k BTC
   */
  private calculateCryptoStopLoss(inputs: StopCalculatorInputs): StopLossCalculation {
    const { symbol, entryPrice, direction, riskMode, marketVolatility = 'normal' } = inputs;

    // Extract ATR value and timeframe
    const atrValue = typeof inputs.atr === 'number' ? inputs.atr : inputs.atr.value;
    const atrTimeframe = typeof inputs.atr === 'number' ? undefined : inputs.atr.timeframe;

    const profile = getRiskStrategyProfile(riskMode);

    // Percentage-based stop ranges for crypto
    let minPercent: number;
    let maxPercent: number;

    switch (riskMode) {
      case 'high': // Aggressive/Scalp
        minPercent = 0.5;
        maxPercent = 1.5;
        break;
      case 'medium': // Balanced/Day
        minPercent = 1.0;
        maxPercent = 2.5;
        break;
      case 'low': // Conservative/Full Intraday
        minPercent = 2.0;
        maxPercent = 4.0;
        break;
    }

    console.log(`[Crypto Stop Calculator] ${symbol} ${riskMode.toUpperCase()} mode:`);
    console.log(`  Entry Price: $${entryPrice.toFixed(2)}`);
    console.log(`  Risk Profile: ${profile.displayName} (${profile.riskPercentRange.min}-${profile.riskPercentRange.max}%)`);
    console.log(`  Percentage Range: ${minPercent}% - ${maxPercent}%`);

    // Calculate stop percentage
    let stopPercent: number;

    if (atrValue && atrValue > 0) {
      // ATR-based: Convert ATR to percentage and scale
      const atrPercent = (atrValue / entryPrice) * 100;
      stopPercent = atrPercent * 1.5; // Scale ATR by 1.5x
      console.log(`  ATR: $${atrValue.toFixed(2)} (${atrPercent.toFixed(2)}%)${atrTimeframe ? ` [${atrTimeframe}]` : ''}`);
      console.log(`  ATR-based stop: ${stopPercent.toFixed(2)}%`);
    } else {
      // No ATR: Use middle of range
      stopPercent = (minPercent + maxPercent) / 2;
      console.log(`  No ATR: Using mid-range ${stopPercent.toFixed(2)}%`);
    }

    // Adjust for market volatility
    if (marketVolatility === 'high') {
      stopPercent *= 1.2; // Wider stops in high volatility
      console.log(`  High volatility: Adjusted to ${stopPercent.toFixed(2)}%`);
    } else if (marketVolatility === 'low') {
      stopPercent *= 0.9; // Tighter stops in low volatility
      console.log(`  Low volatility: Adjusted to ${stopPercent.toFixed(2)}%`);
    }

    // Clamp to min/max range
    const beforeClamp = stopPercent;
    stopPercent = Math.max(minPercent, Math.min(maxPercent, stopPercent));
    const withinProfileRange = (beforeClamp === stopPercent);

    if (!withinProfileRange) {
      console.log(`  Clamped: ${beforeClamp.toFixed(2)}% → ${stopPercent.toFixed(2)}%`);
    }

    // Calculate stop distance and price
    const stopDistance = entryPrice * (stopPercent / 100);
    const stopLossPrice = direction === 'buy'
      ? entryPrice - stopDistance
      : entryPrice + stopDistance;

    // Convert to "pips" for compatibility (for crypto, 1 pip = $1)
    const pipInfo = getCurrencyPipInfo(symbol);
    const stopLossPips = stopDistance / pipInfo.pipValue;

    // Generate reasoning
    let reasoning = `${profile.displayName} crypto: ${stopPercent.toFixed(2)}% = $${stopDistance.toFixed(2)}`;

    if (!withinProfileRange) {
      if (stopPercent === minPercent) {
        reasoning += ' - clamped to minimum';
      } else if (stopPercent === maxPercent) {
        reasoning += ' - clamped to maximum';
      }
    }

    if (marketVolatility !== 'normal') {
      reasoning += ` - ${marketVolatility} volatility`;
    }

    console.log(`  Final Stop: ${stopPercent.toFixed(2)}% at $${stopLossPrice.toFixed(2)}`);
    console.log(`  Stop Distance: $${stopDistance.toFixed(2)} (${stopLossPips.toFixed(1)} "pips")`);
    console.log(`  Reasoning: ${reasoning}`);
    console.log(`  ✅ MUCH BETTER than old 20 pip = $20 = 0.022% stop!`);

    return {
      stopLossPips,
      stopLossPrice,
      atrMultiplier: atrValue > 0 ? stopPercent / ((atrValue / entryPrice) * 100) : 1.5, // Back-calculate for compatibility
      reasoning,
      withinProfileRange,
      profileMinPips: (entryPrice * minPercent / 100) / pipInfo.pipValue,
      profileMaxPips: (entryPrice * maxPercent / 100) / pipInfo.pipValue,
      atrTimeframe
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
      warnings.push(`Stop too tight: ${stopPips.toFixed(1)} pips < ${typicalRange.min} (${riskMode} profile minimum)`);
      score -= 30;
    }

    if (stopPips > typicalRange.max) {
      warnings.push(`Stop too wide: ${stopPips.toFixed(1)} pips > ${typicalRange.max} (${riskMode} profile maximum)`);
      score -= 30;
    }

    // Aggressive mode with wide stops is a red flag
    if (riskMode === 'high' && stopPips > 25) {
      warnings.push(`AGGRESSIVE mode using WIDE stops (${stopPips.toFixed(1)} pips) - should be scalp-style (10-20 pips for 20min-2hr trades)`);
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

    let recommendation = `${profile.displayName} mode: ${stopRange.min}-${stopRange.max} pips`;
    recommendation += ` | ${atrRange.min}x-${atrRange.max}x ATR | ${profile.riskPercentRange.min}-${profile.riskPercentRange.max}% risk`;

    if (atr) {
      const atrMultiplier = (atrRange.min + atrRange.max) / 2;
      const suggestedPips = (atr * 10000) * atrMultiplier; // Convert to pips
      recommendation += ` | With current ATR: ~${suggestedPips.toFixed(0)} pips`;
    }

    return recommendation;
  }

  /**
   * Calculate noise floor - the minimum stop width needed to survive spread + volatility noise
   *
   * This prevents catastrophically tight stops like 10 pips on NAS100 ($25,491 price)
   * which equals only 0.039% - effectively noise.
   *
   * Uses TWO methods and takes the LARGER (more conservative):
   * 1. Percentage of price (prevents microscopic stops on high-value instruments)
   * 2. ATR multiplier (prevents stops inside volatility noise)
   */
  calculateNoiseFloor(symbol: string, entryPrice: number, atr: number | ATRValue): {
    noiseFloorPips: number;
    reasoning: string;
  } {
    const pipInfo = getCurrencyPipInfo(symbol);

    // Extract ATR value
    const atrValue = typeof atr === 'number' ? atr : atr.value;
    const atrTimeframe = typeof atr === 'number' ? undefined : atr.timeframe;

    // Minimum stops as percentage of price (asset-class specific)
    let minPercentOfPrice: number;
    let assetClassName: string;

    if (isIndex(symbol)) {
      minPercentOfPrice = 0.15; // 0.15% minimum for indices (e.g., 38 pips on NAS100 @ $25,491)
      assetClassName = 'INDEX';
    } else if (isCrypto(symbol)) {
      minPercentOfPrice = 0.20; // 0.20% minimum for crypto (e.g., $180 on $90k BTC)
      assetClassName = 'CRYPTO';
    } else if (isXAUUSD(symbol)) {
      minPercentOfPrice = 0.20; // 0.20% for gold (e.g., $5.20 on $2,600)
      assetClassName = 'GOLD';
    } else {
      minPercentOfPrice = 0.05; // 0.05% for forex (e.g., 5 pips on EURUSD @ 1.0000)
      assetClassName = 'FOREX';
    }

    // Minimum stops as ATR multiplier (prevents stops inside volatility)
    const minATRMultiplier = 1.25;

    // Calculate both methods
    const percentFloorPips = (entryPrice * minPercentOfPrice / 100) / pipInfo.pipValue;
    const atrInPips = atrValue / pipInfo.pipValue;
    const atrFloorPips = atrInPips * minATRMultiplier;

    // Use the LARGER of the two (more conservative = safer)
    const noiseFloorPips = Math.max(percentFloorPips, atrFloorPips);

    // Determine which method was controlling
    const controllingMethod = percentFloorPips > atrFloorPips ? 'price-based' : 'volatility-based';

    const reasoning =
      `${assetClassName} noise floor: ${noiseFloorPips.toFixed(1)} pips ` +
      `(${controllingMethod}: ${minPercentOfPrice}% of price = ${percentFloorPips.toFixed(1)} pips OR ` +
      `${minATRMultiplier}x ATR${atrTimeframe ? `[${atrTimeframe}]` : ''} = ${atrFloorPips.toFixed(1)} pips, whichever larger)`;

    console.log(`[Noise Floor] ${symbol} @ ${entryPrice.toFixed(pipInfo.decimalPlaces)}: ${reasoning}`);

    return {
      noiseFloorPips,
      reasoning
    };
  }
}

export const riskAwareStopCalculator = new RiskAwareStopCalculator();
