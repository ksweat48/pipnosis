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
  /** Set when stop was adjusted to clear a detected liquidity sweep zone */
  sweepAwareAdjustment?: {
    applied: boolean;
    originalStopPrice: number;
    originalStopPips: number;
    sweepExtremePrice: number;
    bufferPips: number;
    reason: string;
  };
}

/**
 * Liquidity sweep context passed by Omega-8 for sweep-aware stop placement.
 * SSOT: This is the only path through which sweep price data enters stop calculations.
 */
export interface SweepContext {
  type: 'high' | 'low' | 'none';
  has_bos: boolean;
  sweep_extreme_price: number;
  nearest_cluster_price?: number;
  candles_ago: number;
  liquidity_bias: 'stoprun_risk' | 'stoprun_entry' | 'clean' | 'reaccumulation' | 'distribution';
}

export interface StopCalculatorInputs {
  symbol: string;
  entryPrice: number;
  direction: 'buy' | 'sell';
  riskMode: 'low' | 'medium' | 'high';
  atr: number | ATRValue; // Accepts both for backward compatibility during migration
  marketVolatility?: 'low' | 'normal' | 'high';
  /** Optional: Liquidity sweep context from Omega-8. When present, enables sweep-aware stop placement. */
  sweepContext?: SweepContext;
  /** Trade style — used to calibrate sweep buffer depth per style */
  tradeStyle?: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY';
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

    // SWEEP-AWARE STOP PLACEMENT
    // When Omega-8 detects a liquidity sweep and provides the sweep extreme price,
    // the stop must be placed BEYOND that extreme — not inside the sweep zone.
    // This prevents stops being placed inside the liquidity pool where they become
    // targets for the next sweep. Applies to all 3 trade styles.
    const sweepResult = this.applySweepAwareAdjustment({
      symbol,
      direction,
      entryPrice,
      calculatedStopPrice: stopLossPrice,
      calculatedStopPips: stopPips,
      pipInfo,
      sweepContext: inputs.sweepContext,
      tradeStyle: inputs.tradeStyle,
      atrValue,
      profileMaxPips: maxPips
    });

    return {
      stopLossPips: sweepResult.stopPips,
      stopLossPrice: sweepResult.stopPrice,
      atrMultiplier,
      reasoning: sweepResult.reasoning,
      withinProfileRange,
      profileMinPips: minPips,
      profileMaxPips: maxPips,
      atrTimeframe,
      sweepAwareAdjustment: sweepResult.adjustment
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

    const profileMaxPipsCrypto = (entryPrice * maxPercent / 100) / pipInfo.pipValue;

    // Apply sweep-aware adjustment for crypto as well
    const sweepResultCrypto = this.applySweepAwareAdjustment({
      symbol,
      direction,
      entryPrice,
      calculatedStopPrice: stopLossPrice,
      calculatedStopPips: stopLossPips,
      pipInfo,
      sweepContext: inputs.sweepContext,
      tradeStyle: inputs.tradeStyle,
      atrValue,
      profileMaxPips: profileMaxPipsCrypto
    });

    return {
      stopLossPips: sweepResultCrypto.stopPips,
      stopLossPrice: sweepResultCrypto.stopPrice,
      atrMultiplier: atrValue > 0 ? stopPercent / ((atrValue / entryPrice) * 100) : 1.5,
      reasoning: sweepResultCrypto.reasoning,
      withinProfileRange,
      profileMinPips: (entryPrice * minPercent / 100) / pipInfo.pipValue,
      profileMaxPips: profileMaxPipsCrypto,
      atrTimeframe,
      sweepAwareAdjustment: sweepResultCrypto.adjustment
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
  getRecommendation(riskMode: 'low' | 'medium' | 'high', atr?: number, symbol: string = 'EURUSD'): string {
    const profile = getRiskStrategyProfile(riskMode);
    const stopRange = getTypicalStopPipsRange(riskMode);
    const atrRange = getStopLossMultiplierRange(riskMode);

    let recommendation = `${profile.displayName} mode: ${stopRange.min}-${stopRange.max} pips`;
    recommendation += ` | ${atrRange.min}x-${atrRange.max}x ATR | ${profile.riskPercentRange.min}-${profile.riskPercentRange.max}% risk`;

    if (atr) {
      const pipValue = getCurrencyPipInfo(symbol).pipValue;
      const atrMultiplier = (atrRange.min + atrRange.max) / 2;
      const suggestedPips = (atr / pipValue) * atrMultiplier;
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
  calculateNoiseFloor(symbol: string, entryPrice: number, atr: number | ATRValue, _tradeStyle?: string): {
    noiseFloorPips: number;
    reasoning: string;
  } {
    const pipInfo = getCurrencyPipInfo(symbol);

    const atrValue = typeof atr === 'number' ? atr : atr.value;
    const atrTimeframe = typeof atr === 'number' ? undefined : atr.timeframe;

    let minPercentOfPrice: number;
    let assetClassName: string;

    if (isIndex(symbol)) {
      minPercentOfPrice = 0.15;
      assetClassName = 'INDEX';
    } else if (isCrypto(symbol)) {
      minPercentOfPrice = 0.20;
      assetClassName = 'CRYPTO';
    } else if (isXAUUSD(symbol)) {
      minPercentOfPrice = 0.20;
      assetClassName = 'GOLD';
    } else {
      minPercentOfPrice = 0.05;
      assetClassName = 'FOREX';
    }

    const minATRMultiplier = 1.15;

    const percentFloorPips = (entryPrice * minPercentOfPrice / 100) / pipInfo.pipValue;
    const atrInPips = atrValue / pipInfo.pipValue;
    const atrFloorPips = atrInPips * minATRMultiplier;

    // CCIP (2026-02-17): Noise floor is now advisory-only market intelligence.
    // Envelope percentage bounds are the sole style wall authority.
    // Style-aware ATR caps (SCALP 3x, MICRO 4x) removed -- they were bandaids
    // to prevent the noise floor from triggering constraint sandwiches.
    // With noise floor no longer acting as a wall, the caps serve no purpose.
    const noiseFloorPips = Math.max(percentFloorPips, atrFloorPips);
    const controllingMethod = percentFloorPips > atrFloorPips ? 'price-based' : 'volatility-based';

    const reasoning =
      `${assetClassName} noise floor: ${noiseFloorPips.toFixed(1)} pips ` +
      `(${controllingMethod}: ${minPercentOfPrice}% of price = ${percentFloorPips.toFixed(1)} pips OR ` +
      `${minATRMultiplier}x ATR${atrTimeframe ? `[${atrTimeframe}]` : ''} = ${atrFloorPips.toFixed(1)} pips)`;

    console.log(`[Noise Floor] ${symbol} @ ${entryPrice.toFixed(pipInfo.decimalPlaces)}: ${reasoning}`);

    return {
      noiseFloorPips,
      reasoning
    };
  }

  /**
   * SWEEP-AWARE STOP PLACEMENT — SSOT for all 3 trade styles
   *
   * When a liquidity sweep is detected, the ATR-calculated stop may land INSIDE
   * the swept zone — exactly where smart money targets retail stops for the next run.
   * This method computes whether the calculated stop is inside the sweep zone and,
   * if so, relocates it beyond the sweep extreme with a style-calibrated buffer.
   *
   * Buffer depth by trade style:
   *   SCALP:          0.2 ATR — tight buffer, M5 precision
   *   MICRO_INTRADAY: 0.3 ATR — moderate buffer, M15 structure awareness
   *   INTRADAY:       0.4 ATR — wider buffer, H1 structure tolerance
   *
   * The stop is only adjusted when:
   *   1. A sweep context is provided with a valid sweep extreme price
   *   2. The trade direction aligns with the post-sweep bias (buy after low sweep, sell after high sweep)
   *   3. The calculated stop is INSIDE the sweep zone (between entry and sweep extreme + buffer)
   *   4. The adjusted stop does not exceed the profile maximum
   *
   * CCIP compliance: This is a QUANTITATIVE adjustment, not advisory text. The result is
   * logged via sweepAwareAdjustment for governance audit.
   */
  private applySweepAwareAdjustment(inputs: {
    symbol: string;
    direction: 'buy' | 'sell';
    entryPrice: number;
    calculatedStopPrice: number;
    calculatedStopPips: number;
    pipInfo: { pipValue: number; decimalPlaces: number };
    sweepContext?: SweepContext;
    tradeStyle?: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY';
    atrValue: number;
    profileMaxPips: number;
  }): {
    stopPrice: number;
    stopPips: number;
    reasoning: string;
    adjustment?: StopLossCalculation['sweepAwareAdjustment'];
  } {
    const {
      direction, entryPrice, calculatedStopPrice, calculatedStopPips,
      pipInfo, sweepContext, tradeStyle, atrValue, profileMaxPips
    } = inputs;

    // No sweep context — return original stop unchanged
    if (!sweepContext || sweepContext.type === 'none' || !sweepContext.sweep_extreme_price) {
      return {
        stopPrice: calculatedStopPrice,
        stopPips: calculatedStopPips,
        reasoning: inputs.calculatedStopPips > 0
          ? `ATR-based stop (no sweep context)`
          : 'ATR-based stop'
      };
    }

    // Only adjust when direction aligns with the post-sweep intent:
    // Low sweep → predator direction is long → only adjust BUY stops
    // High sweep → predator direction is short → only adjust SELL stops
    const sweepAlignsBuy = sweepContext.type === 'low' && direction === 'buy';
    const sweepAlignsSell = sweepContext.type === 'high' && direction === 'sell';

    if (!sweepAlignsBuy && !sweepAlignsSell) {
      return {
        stopPrice: calculatedStopPrice,
        stopPips: calculatedStopPips,
        reasoning: `ATR-based stop (sweep type ${sweepContext.type} does not align with ${direction} direction)`
      };
    }

    // Style-calibrated buffer depth in ATR units
    const bufferByStyle: Record<string, number> = {
      SCALP:          0.20,
      MICRO_INTRADAY: 0.30,
      INTRADAY:       0.40
    };
    const bufferMultiplier = bufferByStyle[tradeStyle ?? 'SCALP'] ?? 0.25;
    let bufferPips = (atrValue / pipInfo.pipValue) * bufferMultiplier;

    // SWEEP BUFFER MINIMUM PIP FLOOR (CCIP 2026-03-02)
    // ATR-based buffers can fall below meaningful protection on certain instruments.
    // XAUUSD M15 ATR ~8 pips × 0.30 = 2.4 pips — insufficient to clear an engineered sweep zone.
    // JPY pairs M15 ATR ~10 pips × 0.30 = 3 pips — same issue.
    // Minimum floors ensure the buffer actually clears the swept liquidity pool.
    // SSOT: Symbol classification from currencyHelpers — single authority for symbol type.
    const minimumSweepBufferPips: number = isXAUUSD(inputs.symbol)
      ? 8
      : isJPYPair(inputs.symbol)
        ? 5
        : 3;

    if (bufferPips < minimumSweepBufferPips) {
      console.log(
        `[Sweep Buffer] Floor applied: ${inputs.symbol} ATR-buffer=${bufferPips.toFixed(1)}p ` +
        `→ floored to ${minimumSweepBufferPips}p (min for symbol class)`
      );
      bufferPips = minimumSweepBufferPips;
    }

    const bufferPrice = bufferPips * pipInfo.pipValue;

    // Compute the safe stop price — beyond the sweep extreme by one buffer
    let sweepAwareStopPrice: number;
    if (direction === 'buy') {
      // For a BUY, SL goes BELOW entry. Safe stop = sweep low - buffer
      sweepAwareStopPrice = sweepContext.sweep_extreme_price - bufferPrice;
    } else {
      // For a SELL, SL goes ABOVE entry. Safe stop = sweep high + buffer
      sweepAwareStopPrice = sweepContext.sweep_extreme_price + bufferPrice;
    }

    const sweepAwareStopPips = Math.abs(entryPrice - sweepAwareStopPrice) / pipInfo.pipValue;

    // Only apply if the sweep-aware stop is WIDER than the calculated stop
    // (it should always be, but guard against edge cases)
    const sweepStopIsWider = direction === 'buy'
      ? sweepAwareStopPrice < calculatedStopPrice  // lower price = wider stop for longs
      : sweepAwareStopPrice > calculatedStopPrice; // higher price = wider stop for shorts

    if (!sweepStopIsWider) {
      console.log(`[Sweep-Aware Stop] ${inputs.symbol}: Calculated stop already clears sweep extreme. No adjustment needed.`);
      return {
        stopPrice: calculatedStopPrice,
        stopPips: calculatedStopPips,
        reasoning: `ATR-based stop already clears sweep extreme @ ${sweepContext.sweep_extreme_price.toFixed(pipInfo.decimalPlaces)}`
      };
    }

    // Cap to profile maximum to prevent runaway stops
    const cappedStopPips = Math.min(sweepAwareStopPips, profileMaxPips);
    const cappedStopPrice = direction === 'buy'
      ? entryPrice - (cappedStopPips * pipInfo.pipValue)
      : entryPrice + (cappedStopPips * pipInfo.pipValue);

    const wasCapped = cappedStopPips < sweepAwareStopPips;

    const reason = wasCapped
      ? `Sweep-aware stop capped at profile max (${profileMaxPips.toFixed(1)}p). Sweep extreme @ ${sweepContext.sweep_extreme_price.toFixed(pipInfo.decimalPlaces)} + ${bufferPips.toFixed(1)}p buffer [${tradeStyle ?? 'SCALP'}]`
      : `Stop relocated beyond sweep ${sweepContext.type} extreme @ ${sweepContext.sweep_extreme_price.toFixed(pipInfo.decimalPlaces)} + ${bufferPips.toFixed(1)}p buffer [${tradeStyle ?? 'SCALP'}, BOS:${sweepContext.has_bos}]`;

    console.log(`[Sweep-Aware Stop] ${inputs.symbol} ${direction.toUpperCase()}: ATR stop ${calculatedStopPips.toFixed(1)}p → Sweep-aware ${cappedStopPips.toFixed(1)}p (extreme: ${sweepContext.sweep_extreme_price.toFixed(pipInfo.decimalPlaces)}, buffer: ${bufferPips.toFixed(1)}p)`);

    return {
      stopPrice: cappedStopPrice,
      stopPips: cappedStopPips,
      reasoning: reason,
      adjustment: {
        applied: true,
        originalStopPrice: calculatedStopPrice,
        originalStopPips: calculatedStopPips,
        sweepExtremePrice: sweepContext.sweep_extreme_price,
        bufferPips,
        reason
      }
    };
  }
}

export const riskAwareStopCalculator = new RiskAwareStopCalculator();
