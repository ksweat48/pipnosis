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

// CCIP-2026-04-21 (LIVE-ATR SOVEREIGNTY): getTypicalStopPipsRange removed.
// Stop width is always live-ATR-derived. No static pip floor clamp is applied.
import { getRiskStrategyProfile, getStopLossMultiplierRange, STYLE_ATR_TIMEFRAME_MAP } from '../config/risk-strategy-profiles';
import { getCurrencyPipInfo, isXAUUSD, isJPYPair, isIndex } from '../utils/currencyHelpers';
import { type ATRValue, type ATRTimeframe } from '../types/atr';

export interface StopLossCalculation {
  stopLossPips: number;
  stopLossPrice: number;
  atrMultiplier: number;
  reasoning: string;
  // CCIP-2026-04-21: withinProfileRange/profileMinPips/profileMaxPips retained for
  // sweep-aware cap audit only. No longer reflect static pip floor enforcement.
  withinProfileRange: boolean;
  profileMinPips: number;
  profileMaxPips: number;
  atrTimeframe?: ATRTimeframe; // Track which timeframe ATR was from
  noiseFloorPips?: number;      // Statistical minimum for survival
  noiseFloorReasoning?: string; // Explanation of noise floor
  /**
   * Set when a sweep in the OPPOSITE direction has a liquidity cluster near
   * the calculated stop. This does not adjust the stop — it surfaces the
   * proximity as advisory data for Alpha to reason about.
   *
   * Example: A HIGH sweep (price spiked up and rejected) with a BUY entry.
   * The sweep-aware system does not move the SL for this case. But if the
   * nearest_cluster_price from that high sweep sits within 2 pips of the
   * BUY's SL, Alpha should know — his SL may be sitting inside a liquidity
   * magnet zone from the opposite side of the market.
   */
  crossDirectionClusterWarning?: {
    clusterPrice: number;
    clusterPipsFromStop: number;
    sweepType: 'high' | 'low';
    direction: 'buy' | 'sell';
  };
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
  /** Trade style — used to calibrate sweep buffer depth per style.
   * CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform; only MICRO_INTRADAY remains. */
  tradeStyle?: 'MICRO_INTRADAY';
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

    const profile = getRiskStrategyProfile(riskMode);
    const pipInfo = getCurrencyPipInfo(symbol);
    // CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform.
    // MICRO_INTRADAY uses M5 ATR; multiplier ranges are pre-calibrated for M5.
    const atrMultiplierRange = getStopLossMultiplierRange(riskMode, inputs.tradeStyle);

    const styleLabel = inputs.tradeStyle ? ` [${inputs.tradeStyle}]` : '';
    console.log(`[Stop Calculator] ${symbol} ${riskMode.toUpperCase()} mode${styleLabel}:`);
    console.log(`  ATR: ${atrValue.toFixed(5)}${atrTimeframe ? ` (${atrTimeframe})` : ''} | Risk: ${profile.riskPercentRange.min}-${profile.riskPercentRange.max}%`);
    console.log(`  ATR Multiplier Range: ${atrMultiplierRange.min}x - ${atrMultiplierRange.max}x${inputs.tradeStyle ? ` (style-calibrated for ${inputs.tradeStyle})` : ''}`);

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

    // CCIP-2026-04-21 (LIVE-ATR SOVEREIGNTY): Stop is pure ATR × multiplier. No pip floor clamp.
    const stopPips = atrPips * atrMultiplier;

    // Calculate stop loss price
    const stopDistance = stopPips * pipInfo.pipValue;
    const stopLossPrice = direction === 'buy'
      ? entryPrice - stopDistance
      : entryPrice + stopDistance;

    const reasoning = `${profile.displayName} (${profile.riskPercentRange.min}-${profile.riskPercentRange.max}%): ${stopPips.toFixed(1)} pips (${atrMultiplier.toFixed(2)}x ATR)${marketVolatility !== 'normal' ? ` - adjusted for ${marketVolatility} volatility` : ''}`;

    console.log(`  Final Stop: ${stopPips.toFixed(1)} pips at ${stopLossPrice.toFixed(pipInfo.decimalPlaces)}`);
    console.log(`  Reasoning: ${reasoning}`);

    // SWEEP-AWARE STOP PLACEMENT
    // When Omega-8 detects a liquidity sweep and provides the sweep extreme price,
    // the stop must be placed BEYOND that extreme — not inside the sweep zone.
    // This prevents stops being placed inside the liquidity pool where they become
    // targets for the next sweep. Applies to all 3 trade styles.
    // CCIP-2026-04-21: profileMaxPips for sweep cap uses ATR × max multiplier (no static floor).
    const profileMaxPips = atrPips * atrMultiplierRange.max * 2; // generous cap for sweep zone clearance
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
      profileMaxPips
    });

    return {
      stopLossPips: sweepResult.stopPips,
      stopLossPrice: sweepResult.stopPrice,
      atrMultiplier,
      reasoning: sweepResult.reasoning,
      withinProfileRange: true,
      profileMinPips: 0,
      profileMaxPips,
      atrTimeframe,
      sweepAwareAdjustment: sweepResult.adjustment,
      crossDirectionClusterWarning: sweepResult.crossDirectionClusterWarning,
    };
  }

  /**
   * Validate if a proposed stop loss matches the risk profile
   */
  // CCIP-2026-04-21 (LIVE-ATR SOVEREIGNTY): Stop validation no longer checks static pip ranges.
  // Validation is advisory only — R:R and risk percent are the meaningful checks.
  validateStopLoss(
    stopPips: number,
    riskMode: 'low' | 'medium' | 'high'
  ): {
    valid: boolean;
    warnings: string[];
    score: number;
  } {
    getRiskStrategyProfile(riskMode); // retain profile lookup for future use
    const warnings: string[] = [];
    const score = 100;
    // No pip-range enforcement. Alpha's live-ATR stop is always valid structurally.
    return {
      valid: warnings.length === 0,
      warnings,
      score: Math.max(0, score)
    };
  }

  /**
   * Get recommended stop width explanation for a risk mode
   */
  // CCIP-2026-04-21: Recommendation shows ATR-derived range only, no static pip floor.
  getRecommendation(riskMode: 'low' | 'medium' | 'high', atr?: number, symbol: string = 'EURUSD'): string {
    const profile = getRiskStrategyProfile(riskMode);
    const atrRange = getStopLossMultiplierRange(riskMode);

    let recommendation = `${profile.displayName} mode: ${atrRange.min}x-${atrRange.max}x ATR | ${profile.riskPercentRange.min}-${profile.riskPercentRange.max}% risk`;

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
    // CCIP-2026-0427E-STYLE-CONSOLIDATION: Single style (MICRO_INTRADAY).
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
   * SWEEP-AWARE STOP PLACEMENT — SSOT (CCIP-2026-0427E-STYLE-CONSOLIDATION: single style)
   *
   * When a liquidity sweep is detected, the ATR-calculated stop may land INSIDE
   * the swept zone — exactly where smart money targets retail stops for the next run.
   * This method computes whether the calculated stop is inside the sweep zone and,
   * if so, relocates it beyond the sweep extreme with a calibrated buffer.
   *
   * Buffer depth: 0.30 ATR (MICRO_INTRADAY default) — moderate buffer, M5 structure awareness.
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
    tradeStyle?: 'MICRO_INTRADAY';
    atrValue: number;
    profileMaxPips: number;
  }): {
    stopPrice: number;
    stopPips: number;
    reasoning: string;
    adjustment?: StopLossCalculation['sweepAwareAdjustment'];
    crossDirectionClusterWarning?: StopLossCalculation['crossDirectionClusterWarning'];
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
      // CCIP-2026-0310-OMEGA8-BIDIRECTIONAL:
      // Sweep is cross-directional — we do NOT move the stop. However, if the
      // sweep's nearest_cluster_price is within a proximity threshold of the
      // calculated stop, surface it as advisory data. Alpha can see the cluster
      // is near his SL and factor it into his reasoning.
      // Proximity threshold: 2x pip floor for the instrument class.
      const proximityThresholdPips = isXAUUSD(inputs.symbol) ? 4 : isJPYPair(inputs.symbol) ? 3 : 2;

      const clusterPrice = sweepContext.nearest_cluster_price ?? sweepContext.sweep_extreme_price;
      const clusterPipsFromStop = Math.abs(clusterPrice - calculatedStopPrice) / pipInfo.pipValue;

      const crossDirectionClusterWarning: StopLossCalculation['crossDirectionClusterWarning'] =
        clusterPipsFromStop <= proximityThresholdPips
          ? {
              clusterPrice,
              clusterPipsFromStop,
              sweepType: sweepContext.type as 'high' | 'low',
              direction,
            }
          : undefined;

      if (crossDirectionClusterWarning) {
        console.log(
          `[Sweep-Cluster Advisory] ${inputs.symbol} ${direction.toUpperCase()}: ` +
          `Cross-direction ${sweepContext.type} sweep cluster @ ${clusterPrice.toFixed(pipInfo.decimalPlaces)} ` +
          `is ${clusterPipsFromStop.toFixed(1)}p from calculated SL @ ${calculatedStopPrice.toFixed(pipInfo.decimalPlaces)} ` +
          `(threshold: ${proximityThresholdPips}p) — surfaced as advisory for Alpha`
        );
      }

      return {
        stopPrice: calculatedStopPrice,
        stopPips: calculatedStopPips,
        reasoning: crossDirectionClusterWarning
          ? `ATR-based stop — cross-direction ${sweepContext.type} sweep cluster @ ${clusterPrice.toFixed(pipInfo.decimalPlaces)} is ${clusterPipsFromStop.toFixed(1)}p from SL (advisory)`
          : `ATR-based stop (sweep type ${sweepContext.type} does not align with ${direction} direction)`,
        crossDirectionClusterWarning,
      };
    }

    // CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform.
    // MICRO_INTRADAY buffer = 0.30 ATR.
    void tradeStyle;
    const bufferMultiplier = 0.30;
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
      ? `Sweep-aware stop capped at profile max (${profileMaxPips.toFixed(1)}p). Sweep extreme @ ${sweepContext.sweep_extreme_price.toFixed(pipInfo.decimalPlaces)} + ${bufferPips.toFixed(1)}p buffer [${tradeStyle ?? 'MICRO_INTRADAY'}]`
      : `Stop relocated beyond sweep ${sweepContext.type} extreme @ ${sweepContext.sweep_extreme_price.toFixed(pipInfo.decimalPlaces)} + ${bufferPips.toFixed(1)}p buffer [${tradeStyle ?? 'MICRO_INTRADAY'}, BOS:${sweepContext.has_bos}]`;

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
