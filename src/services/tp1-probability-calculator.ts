/**
 * TP1 Probability Calculator
 *
 * Calculates conservative TP1 targets with 80%+ probability of being hit
 * Based purely on technical factors: ATR, liquidity zones, momentum, volatility regime
 *
 * SSOT for TP1 placement logic - Alpha uses this to determine TP1 feasibility
 */

import { logger } from '../lib/logger';
import type { LiquidityZone } from './profit-target-calculator';
import { getCurrencyPipInfo } from '../utils/currencyHelpers';

export interface TP1Input {
  symbol: string;
  entryPrice: number;
  stopLoss: number;
  direction: 'long' | 'short';
  atr: number;
  atr20?: number; // Short-term ATR for volatility regime
  atr100?: number; // Long-term ATR for volatility regime
  liquidityZones: LiquidityZone[];
  recentCandles?: Array<{ high: number; low: number; close: number; volume?: number }>;
  rsi?: number;
  ema20?: number;
  ema50?: number;
}

export interface TP1Result {
  feasible: boolean;
  tp1Price: number | null;
  tp1Confidence: number; // 0-100
  tp1Reasoning: string;
  atrMultiplier: number | null;
  liquidityZoneUsed: LiquidityZone | null;
  estimatedTimeToFillMinutes: number | null;
}

class TP1ProbabilityCalculator {
  private readonly MIN_CONFIDENCE_THRESHOLD = 80;
  private readonly MIN_TP1_ATR_MULTIPLIER = 0.8;
  private readonly MAX_TP1_ATR_MULTIPLIER = 1.5;
  private readonly MIN_RR_FOR_TP1 = 0.8; // TP1 should be at least 0.8:1 R:R

  /**
   * Calculate TP1 target with 80%+ probability of being hit
   * Returns null if no high-probability target exists
   */
  calculateTP1(input: TP1Input): TP1Result {
    const pipValue = this.getPipValue(input.symbol);
    const stopDistance = Math.abs(input.entryPrice - input.stopLoss);
    const stopDistancePips = stopDistance / pipValue;

    logger.info('[TP1 Calculator] Calculating TP1', {
      symbol: input.symbol,
      entry: input.entryPrice,
      direction: input.direction,
      atr: input.atr,
      stopPips: stopDistancePips.toFixed(1)
    });

    // Step 1: Detect volatility regime
    const volatilityRegime = this.detectVolatilityRegime(input.atr, input.atr20, input.atr100);

    // Step 2: Calculate ATR-based TP1 range
    const atrRange = this.calculateATRBasedTP1Range(
      input.entryPrice,
      input.direction,
      input.atr,
      volatilityRegime
    );

    // Step 3: Find best liquidity zone within ATR range
    const liquidityZone = this.findBestLiquidityZoneForTP1(
      input.liquidityZones,
      input.entryPrice,
      input.direction,
      atrRange,
      stopDistance,
      pipValue
    );

    if (!liquidityZone) {
      logger.warn('[TP1 Calculator] No suitable liquidity zone found within TP1 ATR range');
      return {
        feasible: false,
        tp1Price: null,
        tp1Confidence: 0,
        tp1Reasoning: 'No high-probability liquidity zone within conservative ATR range (0.8-1.5x ATR)',
        atrMultiplier: null,
        liquidityZoneUsed: null,
        estimatedTimeToFillMinutes: null
      };
    }

    // Step 4: Calculate confidence score
    const confidence = this.calculateTP1Confidence(
      input,
      liquidityZone,
      stopDistance,
      volatilityRegime
    );

    if (confidence < this.MIN_CONFIDENCE_THRESHOLD) {
      logger.warn('[TP1 Calculator] Confidence below threshold', {
        confidence,
        threshold: this.MIN_CONFIDENCE_THRESHOLD
      });
      return {
        feasible: false,
        tp1Price: null,
        tp1Confidence: confidence,
        tp1Reasoning: `Confidence ${confidence.toFixed(0)}% below 80% threshold - market conditions not favorable for TP1`,
        atrMultiplier: null,
        liquidityZoneUsed: null,
        estimatedTimeToFillMinutes: null
      };
    }

    // Step 5: Calculate ATR multiplier used
    const atrMultiplier = Math.abs(liquidityZone.price - input.entryPrice) / input.atr;

    // Step 6: Estimate time to fill
    const estimatedTime = this.estimateTimeToFill(liquidityZone.distance_pips, input.atr, pipValue);

    // Step 7: Build reasoning
    const reasoning = this.buildTP1Reasoning(
      liquidityZone,
      atrMultiplier,
      confidence,
      volatilityRegime,
      estimatedTime
    );

    logger.info('[TP1 Calculator] TP1 calculated successfully', {
      tp1Price: liquidityZone.price,
      confidence,
      atrMultiplier: atrMultiplier.toFixed(2)
    });

    return {
      feasible: true,
      tp1Price: liquidityZone.price,
      tp1Confidence: confidence,
      tp1Reasoning: reasoning,
      atrMultiplier,
      liquidityZoneUsed: liquidityZone,
      estimatedTimeToFillMinutes: estimatedTime
    };
  }

  /**
   * Detect volatility regime (expanding/compressing/stable)
   */
  private detectVolatilityRegime(
    atr: number,
    atr20?: number,
    atr100?: number
  ): 'expanding' | 'compressing' | 'stable' {
    if (!atr20 || !atr100) return 'stable';

    const ratio = atr20 / atr100;

    if (ratio > 1.15) return 'expanding';
    if (ratio < 0.85) return 'compressing';
    return 'stable';
  }

  /**
   * Calculate ATR-based TP1 price range
   */
  private calculateATRBasedTP1Range(
    entryPrice: number,
    direction: 'long' | 'short',
    atr: number,
    volatilityRegime: 'expanding' | 'compressing' | 'stable'
  ): { min: number; max: number } {
    // Adjust multiplier based on volatility regime
    let minMultiplier = this.MIN_TP1_ATR_MULTIPLIER;
    let maxMultiplier = this.MAX_TP1_ATR_MULTIPLIER;

    if (volatilityRegime === 'compressing') {
      // Tighter targets in compressing volatility
      minMultiplier = 0.6;
      maxMultiplier = 1.2;
    } else if (volatilityRegime === 'expanding') {
      // Can go wider in expanding volatility
      minMultiplier = 1.0;
      maxMultiplier = 1.8;
    }

    const minDistance = atr * minMultiplier;
    const maxDistance = atr * maxMultiplier;

    if (direction === 'long') {
      return {
        min: entryPrice + minDistance,
        max: entryPrice + maxDistance
      };
    } else {
      return {
        min: entryPrice - maxDistance,
        max: entryPrice - minDistance
      };
    }
  }

  /**
   * Find best liquidity zone within TP1 ATR range that meets R:R requirement
   */
  private findBestLiquidityZoneForTP1(
    zones: LiquidityZone[],
    entryPrice: number,
    direction: 'long' | 'short',
    atrRange: { min: number; max: number },
    stopDistance: number,
    pipValue: number
  ): LiquidityZone | null {
    // Filter zones within ATR range and correct direction
    const validZones = zones.filter(zone => {
      const isCorrectDirection = direction === 'long'
        ? zone.price > entryPrice
        : zone.price < entryPrice;

      if (!isCorrectDirection) return false;

      // Check if within ATR range
      const inRange = direction === 'long'
        ? zone.price >= atrRange.min && zone.price <= atrRange.max
        : zone.price <= atrRange.min && zone.price >= atrRange.max;

      if (!inRange) return false;

      // Check R:R requirement
      const tpDistance = Math.abs(zone.price - entryPrice);
      const rr = tpDistance / stopDistance;

      return rr >= this.MIN_RR_FOR_TP1;
    });

    if (validZones.length === 0) return null;

    // Sort by quality: prioritize strong liquidity and closer distance
    validZones.sort((a, b) => {
      const strengthScore = { weak: 1, moderate: 2, strong: 3 };
      const typeScore = { order_cluster: 3, psychological: 2, structural: 1 };

      const scoreA = strengthScore[a.strength] * typeScore[a.type];
      const scoreB = strengthScore[b.strength] * typeScore[b.type];

      // If equal quality, prefer closer target
      if (scoreA === scoreB) {
        return a.distance_pips - b.distance_pips;
      }

      return scoreB - scoreA;
    });

    return validZones[0];
  }

  /**
   * Calculate TP1 confidence score (0-100)
   */
  private calculateTP1Confidence(
    input: TP1Input,
    liquidityZone: LiquidityZone,
    stopDistance: number,
    volatilityRegime: 'expanding' | 'compressing' | 'stable'
  ): number {
    let confidence = 50; // Base confidence

    // Factor 1: Liquidity zone strength (+25 points max)
    if (liquidityZone.strength === 'strong') {
      confidence += 25;
    } else if (liquidityZone.strength === 'moderate') {
      confidence += 15;
    } else {
      confidence += 5;
    }

    // Factor 2: Liquidity zone type (+15 points max)
    if (liquidityZone.type === 'order_cluster') {
      confidence += 15;
    } else if (liquidityZone.type === 'psychological') {
      confidence += 10;
    } else {
      confidence += 5;
    }

    // Factor 3: R:R ratio (+10 points for good R:R)
    const tpDistance = Math.abs(liquidityZone.price - input.entryPrice);
    const rr = tpDistance / stopDistance;
    if (rr >= 1.2) {
      confidence += 10;
    } else if (rr >= 1.0) {
      confidence += 5;
    }

    // Factor 4: Momentum alignment (+15 points if momentum supports)
    if (input.rsi && input.ema20 && input.ema50) {
      const momentumAligned = input.direction === 'long'
        ? input.rsi > 50 && input.ema20 > input.ema50
        : input.rsi < 50 && input.ema20 < input.ema50;

      if (momentumAligned) {
        confidence += 15;
      } else {
        confidence -= 5; // Penalty for momentum against
      }
    }

    // Factor 5: Volatility regime adjustment
    if (volatilityRegime === 'expanding') {
      confidence += 10; // Higher confidence in expanding volatility
    } else if (volatilityRegime === 'compressing') {
      confidence -= 5; // Lower confidence in compressing volatility
    }

    // Factor 6: Distance check (closer is more reliable)
    if (liquidityZone.distance_pips < 30) {
      confidence += 10; // Very close, high probability
    } else if (liquidityZone.distance_pips > 100) {
      confidence -= 10; // Far away, lower probability
    }

    // Clamp to 0-100
    return Math.max(0, Math.min(100, Math.round(confidence)));
  }

  /**
   * Estimate time to fill TP1 in minutes
   */
  private estimateTimeToFill(
    distancePips: number,
    atr: number,
    pipValue: number
  ): number | null {
    // Assume market moves at 50% of ATR per hour on average
    const atrPips = atr / pipValue;
    const pipsPerHour = atrPips * 0.5;

    if (pipsPerHour <= 0) return null;

    const hours = distancePips / pipsPerHour;
    return Math.round(hours * 60);
  }

  /**
   * Build human-readable reasoning for TP1 placement
   */
  private buildTP1Reasoning(
    zone: LiquidityZone,
    atrMultiplier: number,
    confidence: number,
    volatilityRegime: string,
    estimatedTime: number | null
  ): string {
    const parts: string[] = [];

    parts.push(`TP1 at ${atrMultiplier.toFixed(1)}x ATR`);
    parts.push(`${zone.strength} ${zone.type} liquidity zone`);
    parts.push(`${confidence}% confidence`);

    if (volatilityRegime !== 'stable') {
      parts.push(`${volatilityRegime} volatility`);
    }

    if (estimatedTime) {
      const hours = Math.floor(estimatedTime / 60);
      const mins = estimatedTime % 60;
      if (hours > 0) {
        parts.push(`~${hours}h ${mins}m to fill`);
      } else {
        parts.push(`~${mins}m to fill`);
      }
    }

    return parts.join(' | ');
  }

  /**
   * SSOT COMPLIANCE: Use centralized pip value from currencyHelpers
   *
   * Previously hardcoded pip values that diverged from SSOT.
   * Now delegates to getCurrencyPipInfo() - the single source of truth.
   */
  private getPipValue(symbol: string): number {
    const pipInfo = getCurrencyPipInfo(symbol);
    return pipInfo.pipValue;
  }
}

export const tp1ProbabilityCalculator = new TP1ProbabilityCalculator();
