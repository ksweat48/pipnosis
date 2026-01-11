/**
 * PATTERN LIQUIDITY ADAPTER
 *
 * Converts pattern-identified liquidity targets into LiquidityZone format
 * for use with profit target calculator.
 *
 * Bridges pattern intelligence with execution planning.
 */

import type { PatternIntelligenceResult } from './multi-timeframe-pattern-intelligence';
import type { LiquidityZone } from './profit-target-calculator';
import { getCurrencyPipInfo } from '../utils/currencyHelpers';

export class PatternLiquidityAdapter {
  /**
   * Convert pattern liquidity targets to LiquidityZone format
   */
  convertToLiquidityZones(
    patternResult: PatternIntelligenceResult,
    symbol: string,
    currentPrice: number
  ): LiquidityZone[] {
    const zones: LiquidityZone[] = [];
    const pipInfo = getCurrencyPipInfo(symbol);

    // Add pattern-identified liquidity targets
    for (const target of patternResult.liquidityTargets) {
      const distance_pips = Math.abs(target - currentPrice) / pipInfo.pipValue;

      // Determine type and strength based on pattern source
      const { type, strength } = this.assessLiquidityZoneQuality(
        target,
        patternResult,
        currentPrice
      );

      zones.push({
        price: target,
        type,
        strength,
        distance_pips,
      });
    }

    // Add pattern key levels as additional liquidity zones
    this.addPatternKeyLevels(zones, patternResult, currentPrice, pipInfo.pipValue);

    return zones;
  }

  /**
   * Assess quality of liquidity zone based on pattern analysis
   */
  private assessLiquidityZoneQuality(
    targetPrice: number,
    patternResult: PatternIntelligenceResult,
    currentPrice: number
  ): { type: 'psychological' | 'structural' | 'order_cluster'; strength: 'weak' | 'moderate' | 'strong' } {
    // Check if target aligns with HTF pattern (strongest)
    const htfTargets = patternResult.htfScan.primaryPattern?.liquidityTargets || [];
    if (htfTargets.some(t => Math.abs(t - targetPrice) < targetPrice * 0.001)) {
      return {
        type: 'structural',
        strength: 'strong',
      };
    }

    // Check if target aligns with MTF pattern (moderate)
    const mtfTargets = patternResult.mtfScan.primaryPattern?.liquidityTargets || [];
    if (mtfTargets.some(t => Math.abs(t - targetPrice) < targetPrice * 0.001)) {
      return {
        type: 'order_cluster',
        strength: 'moderate',
      };
    }

    // LTF targets (weaker but useful for timing)
    return {
      type: 'order_cluster',
      strength: 'weak',
    };
  }

  /**
   * Add pattern key levels (support/resistance) as liquidity zones
   */
  private addPatternKeyLevels(
    zones: LiquidityZone[],
    patternResult: PatternIntelligenceResult,
    currentPrice: number,
    pipValue: number
  ): void {
    // Add HTF key levels
    if (patternResult.htfScan.primaryPattern) {
      const htfLevels = patternResult.htfScan.primaryPattern.keyLevels;

      if (htfLevels.resistance && htfLevels.resistance !== currentPrice) {
        const distance_pips = Math.abs(htfLevels.resistance - currentPrice) / pipValue;
        zones.push({
          price: htfLevels.resistance,
          type: 'structural',
          strength: 'strong',
          distance_pips,
        });
      }

      if (htfLevels.support && htfLevels.support !== currentPrice) {
        const distance_pips = Math.abs(htfLevels.support - currentPrice) / pipValue;
        zones.push({
          price: htfLevels.support,
          type: 'structural',
          strength: 'strong',
          distance_pips,
        });
      }
    }

    // Add MTF key levels
    if (patternResult.mtfScan.primaryPattern) {
      const mtfLevels = patternResult.mtfScan.primaryPattern.keyLevels;

      if (mtfLevels.resistance && mtfLevels.resistance !== currentPrice) {
        // Check if not duplicate
        const isDuplicate = zones.some(z => Math.abs(z.price - mtfLevels.resistance!) < mtfLevels.resistance! * 0.001);
        if (!isDuplicate) {
          const distance_pips = Math.abs(mtfLevels.resistance - currentPrice) / pipValue;
          zones.push({
            price: mtfLevels.resistance,
            type: 'structural',
            strength: 'moderate',
            distance_pips,
          });
        }
      }

      if (mtfLevels.support && mtfLevels.support !== currentPrice) {
        const isDuplicate = zones.some(z => Math.abs(z.price - mtfLevels.support!) < mtfLevels.support! * 0.001);
        if (!isDuplicate) {
          const distance_pips = Math.abs(mtfLevels.support - currentPrice) / pipValue;
          zones.push({
            price: mtfLevels.support,
            type: 'structural',
            strength: 'moderate',
            distance_pips,
          });
        }
      }
    }
  }

  /**
   * Get stop-loss recommendation based on pattern invalidation
   */
  getPatternInvalidationStop(
    patternResult: PatternIntelligenceResult,
    direction: 'long' | 'short',
    entryPrice: number
  ): number | null {
    const invalidation = patternResult.invalidationPoint;
    if (!invalidation) return null;

    // Verify invalidation is in correct direction
    const isValid = direction === 'long'
      ? invalidation.price < entryPrice
      : invalidation.price > entryPrice;

    return isValid ? invalidation.price : null;
  }
}

export const patternLiquidityAdapter = new PatternLiquidityAdapter();
