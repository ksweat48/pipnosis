/**
 * Continuation Entry Strategy
 *
 * PHILOSOPHY: When pullback is unlikely, trade into momentum.
 *
 * This strategy is used when:
 * - Price is > 2.5x ATR from pullback zone
 * - Strong momentum is present
 * - Setup is aging (Phase B)
 * - Alpha determines pullback wait time unacceptable
 *
 * DIFFERENCES FROM PULLBACK:
 * - Entry: Current price (trade into move)
 * - Stop: Structure-based (swing low/high), not zone-based
 * - Target: Reduced to 1.5x (instead of 2x)
 * - Requires: Clean orderflow + momentum confirmation
 */

import { logger } from '../lib/logger';
import { getCurrencyPipInfo } from '../utils/currencyHelpers';
import type { RankedSymbol } from './fallback-orchestrator';

export interface ContinuationEntry {
  symbol: string;
  direction: 'BUY' | 'SELL';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  reasoning: string;
  confidence: number;
  style: 'MICRO_INTRADAY' | 'INTRADAY';
  riskReward: number;
  distanceFromOriginalZone: number; // ATR multiple
  momentumStrength: number; // 0-100
}

export interface ContinuationValidation {
  isValid: boolean;
  reason: string;
  momentumStrength: number;
  orderflowQuality: number;
  structureQuality: number;
}

class ContinuationEntryStrategy {

  /**
   * Create continuation entry from original pullback setup
   *
   * Adapts the original pullback trade into a momentum entry
   */
  createContinuationEntry(
    symbol: RankedSymbol,
    currentPrice: number,
    atr: number,
    distanceATR: number
  ): ContinuationEntry | null {
    try {
      const pipInfo = getCurrencyPipInfo(symbol.symbol);

      // Calculate structure-based stop loss
      // For continuation, use wider stop to account for volatility
      const stopDistance = atr * 1.5; // 1.5x ATR for structure stop
      const stopLoss = symbol.direction === 'BUY'
        ? currentPrice - stopDistance
        : currentPrice + stopDistance;

      // Calculate conservative take profit
      // Reduced target (1.5x instead of 2x) for continuation
      const targetDistance = atr * 1.5;
      const takeProfit = symbol.direction === 'BUY'
        ? currentPrice + targetDistance
        : currentPrice - targetDistance;

      // Calculate R:R
      const riskPips = Math.abs(currentPrice - stopLoss) / pipInfo.pipValue;
      const rewardPips = Math.abs(takeProfit - currentPrice) / pipInfo.pipValue;
      const riskReward = rewardPips / riskPips;

      // Validate minimum R:R (0.8 for continuation entries)
      if (riskReward < 0.8) {
        logger.warn('[CONTINUATION_STRATEGY] R:R too low for continuation', {
          symbol: symbol.symbol,
          riskReward: riskReward.toFixed(2),
          minimum: 0.8
        });
        return null;
      }

      // Build reasoning
      const reasoning = this.buildReasoning(
        symbol,
        distanceATR,
        riskReward,
        currentPrice
      );

      // Reduce confidence for continuation (less ideal than pullback)
      const adjustedConfidence = Math.max(symbol.confidence * 0.85, 60);

      logger.info('[CONTINUATION_STRATEGY] Continuation entry created', {
        symbol: symbol.symbol,
        direction: symbol.direction,
        entry: currentPrice.toFixed(5),
        stopLoss: stopLoss.toFixed(5),
        takeProfit: takeProfit.toFixed(5),
        riskReward: riskReward.toFixed(2),
        distanceATR: distanceATR.toFixed(2),
        confidence: adjustedConfidence
      });

      return {
        symbol: symbol.symbol,
        direction: symbol.direction,
        entry: currentPrice,
        stopLoss,
        takeProfit,
        reasoning,
        confidence: adjustedConfidence,
        style: 'MICRO_INTRADAY',
        riskReward,
        distanceFromOriginalZone: distanceATR,
        momentumStrength: this.estimateMomentumStrength(distanceATR)
      };

    } catch (error) {
      logger.error('[CONTINUATION_STRATEGY] Failed to create continuation entry', {
        symbol: symbol.symbol,
        error
      });
      return null;
    }
  }

  /**
   * Validate if continuation entry is viable
   *
   * Checks momentum, orderflow, and structure quality
   */
  validateContinuation(
    symbol: RankedSymbol,
    currentPrice: number,
    distanceATR: number
  ): ContinuationValidation {
    // Estimate momentum strength based on distance moved
    const momentumStrength = this.estimateMomentumStrength(distanceATR);

    // Estimate orderflow quality (placeholder - would need actual data)
    const orderflowQuality = this.estimateOrderflowQuality(symbol, momentumStrength);

    // Estimate structure quality (placeholder - would need actual data)
    const structureQuality = this.estimateStructureQuality(symbol);

    // Validation criteria
    const hasStrongMomentum = momentumStrength >= 60;
    const hasCleanOrderflow = orderflowQuality >= 60;
    const hasGoodStructure = structureQuality >= 50;

    const isValid = hasStrongMomentum && hasCleanOrderflow && hasGoodStructure;

    let reason = '';
    if (!isValid) {
      const failures: string[] = [];
      if (!hasStrongMomentum) failures.push(`weak momentum (${momentumStrength})`);
      if (!hasCleanOrderflow) failures.push(`choppy orderflow (${orderflowQuality})`);
      if (!hasGoodStructure) failures.push(`poor structure (${structureQuality})`);
      reason = `Continuation rejected: ${failures.join(', ')}`;
    } else {
      reason = `Continuation valid: Strong momentum (${momentumStrength}), clean orderflow (${orderflowQuality})`;
    }

    logger.info('[CONTINUATION_STRATEGY] Validation result', {
      symbol: symbol.symbol,
      isValid,
      momentumStrength,
      orderflowQuality,
      structureQuality,
      reason
    });

    return {
      isValid,
      reason,
      momentumStrength,
      orderflowQuality,
      structureQuality
    };
  }

  /**
   * Estimate momentum strength based on price movement
   *
   * Higher ATR distance = stronger momentum
   */
  private estimateMomentumStrength(distanceATR: number): number {
    // 2.5 ATR = 60 strength
    // 4.0 ATR = 80 strength
    // 7.0 ATR = 95 strength

    if (distanceATR <= 2.5) return 60;
    if (distanceATR <= 4.0) return 60 + ((distanceATR - 2.5) / 1.5) * 20; // 60-80
    if (distanceATR <= 7.0) return 80 + ((distanceATR - 4.0) / 3.0) * 15; // 80-95

    return 95;
  }

  /**
   * Estimate orderflow quality
   *
   * Placeholder - would analyze candle patterns, volume, wick ratios
   */
  private estimateOrderflowQuality(
    symbol: RankedSymbol,
    momentumStrength: number
  ): number {
    // For now, use confidence as proxy
    // Higher confidence + strong momentum = cleaner orderflow
    const baseQuality = symbol.confidence;
    const momentumBonus = momentumStrength >= 70 ? 10 : 0;

    return Math.min(baseQuality + momentumBonus, 100);
  }

  /**
   * Estimate structure quality
   *
   * Placeholder - would check if price at key level, support/resistance
   */
  private estimateStructureQuality(symbol: RankedSymbol): number {
    // For now, use confidence as baseline
    // Continuation entries generally have decent structure if setup was valid
    return Math.max(symbol.confidence * 0.7, 50);
  }

  /**
   * Build human-readable reasoning for continuation entry
   */
  private buildReasoning(
    symbol: RankedSymbol,
    distanceATR: number,
    riskReward: number,
    entry: number
  ): string {
    return `Continuation entry: Price moved ${distanceATR.toFixed(1)}x ATR from pullback zone, indicating strong momentum. Trading into the move at ${entry.toFixed(5)} with structure-based stop (1.5x ATR) and conservative target (R:R ${riskReward.toFixed(2)}). ${symbol.reasoning}`;
  }

  /**
   * Compare continuation vs pullback options
   *
   * Helps Alpha decide between waiting for pullback or taking continuation
   */
  compareToPullback(
    continuationEntry: ContinuationEntry,
    pullbackEstimatedWaitSeconds: number | null,
    urgencyPhase: 'PHASE_A' | 'PHASE_B'
  ): {
    recommendation: 'CONTINUATION' | 'PULLBACK' | 'EITHER';
    reasoning: string;
  } {
    // Phase A (fresh): Prefer pullback unless wait is very long
    if (urgencyPhase === 'PHASE_A') {
      if (!pullbackEstimatedWaitSeconds || pullbackEstimatedWaitSeconds > 600) {
        return {
          recommendation: 'CONTINUATION',
          reasoning: 'Phase A but pullback wait time exceeds 10 minutes - continuation preferred'
        };
      }
      return {
        recommendation: 'PULLBACK',
        reasoning: 'Phase A (fresh setup) - pullback preferred for better entry'
      };
    }

    // Phase B (aging): More flexible
    if (urgencyPhase === 'PHASE_B') {
      // If continuation has strong momentum, prefer it
      if (continuationEntry.momentumStrength >= 75) {
        return {
          recommendation: 'CONTINUATION',
          reasoning: 'Phase B with strong momentum - continuation captures move before reversal'
        };
      }

      // If pullback wait is short, wait
      if (pullbackEstimatedWaitSeconds && pullbackEstimatedWaitSeconds < 180) {
        return {
          recommendation: 'PULLBACK',
          reasoning: 'Phase B but pullback expected within 3 minutes - worth waiting'
        };
      }

      // Otherwise, either is acceptable
      return {
        recommendation: 'EITHER',
        reasoning: 'Phase B - both continuation and pullback viable, Alpha discretion'
      };
    }

    return {
      recommendation: 'EITHER',
      reasoning: 'Both strategies viable'
    };
  }
}

export const continuationEntryStrategy = new ContinuationEntryStrategy();
