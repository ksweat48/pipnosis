/**
 * Entry Advisor Service
 *
 * PHILOSOPHY: Provide options, not vetoes.
 *
 * This service replaces the blocking Entry Monitor Coordinator.
 * Instead of blocking trades when conditions aren't perfect,
 * it provides Alpha with:
 * - Viability assessment
 * - Distance and timing information
 * - Warning list
 * - Alternative strategy suggestions
 * - Only blocks for RISK_HARD_BLOCKS
 *
 * Alpha makes the final decision with full context.
 */

import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import {
  RISK_HARD_BLOCKS,
  SOFT_WARNINGS,
  POLICY_GUIDELINES,
  getEntryDistanceThresholds,
  getPreferredStrategy,
  isRiskHardBlock
} from '../config/trading-policy';
import { getCurrencyPipInfo } from '../utils/currencyHelpers';
import { MarketDataService } from './market-data-service';

export type EntryViability =
  | 'IMMEDIATE'      // Price in zone, execute now
  | 'PULLBACK'       // Wait for retracement
  | 'CONTINUATION'   // Trade into momentum
  | 'BREAKOUT'       // Wait for structure break
  | 'UNLIKELY'       // Low probability but not blocked
  | 'BLOCKED';       // Risk hard block only

export type WarningLevel = 'INFO' | 'ADVISORY' | 'STRONG_ADVISORY' | 'CRITICAL';

export interface EntryWarning {
  level: WarningLevel;
  category: string;
  message: string;
  value?: number;
  threshold?: number;
}

export interface EntryStrategy {
  strategy: 'pullback' | 'continuation' | 'breakout' | 'immediate';
  viability: 'HIGH' | 'MEDIUM' | 'LOW';
  reasoning: string;
  expectedWaitTime?: number; // seconds
  adjustedEntry?: number;
  adjustedZone?: {
    min: number;
    max: number;
  };
}

export interface EntryAdvisory {
  viability: EntryViability;
  distanceATR: number;
  distancePips: number;
  estimatedSecondsToZone: number | null;
  warnings: EntryWarning[];
  alternativeStrategies: EntryStrategy[];
  recommendedStrategy: EntryStrategy;
  hardBlockReason: string | null;
  marketContext: {
    currentPrice: number;
    atr: number;
    spread: number;
    timeActive: number; // minutes
  };
}

export interface AdvisoryRequest {
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryZoneMin: number;
  entryZoneMax: number;
  stopLoss: number;
  takeProfit: number;
  atr: number;
  confidence: number;
  timeActive?: number; // minutes since setup identified
  currentPrice?: number;
  spread?: number;
  accountBalance?: number;
  riskMode?: 'LOW' | 'MEDIUM' | 'HIGH';
}

class EntryAdvisor {

  /**
   * Generate complete entry advisory with all options
   * This is the main entry point - provides full context to Alpha
   */
  async generateAdvisory(request: AdvisoryRequest): Promise<EntryAdvisory> {
    const warnings: EntryWarning[] = [];
    const alternativeStrategies: EntryStrategy[] = [];

    // Get current market price
    const currentPrice = request.currentPrice || await this.getCurrentPrice(request.symbol);
    const spread = request.spread || await this.getCurrentSpread(request.symbol);
    const timeActive = request.timeActive || 0;

    // Calculate distance from entry zone
    const entryZoneCenter = (request.entryZoneMin + request.entryZoneMax) / 2;
    const pipInfo = getCurrencyPipInfo(request.symbol);
    const distancePips = Math.abs(currentPrice - entryZoneCenter) / pipInfo.pipValue;
    const distanceATR = distancePips / (request.atr / pipInfo.pipValue);

    // Check for RISK HARD BLOCKS first
    const hardBlockCheck = await this.checkHardBlocks(request, currentPrice, spread);
    if (hardBlockCheck) {
      return {
        viability: 'BLOCKED',
        distanceATR,
        distancePips,
        estimatedSecondsToZone: null,
        warnings: [hardBlockCheck],
        alternativeStrategies: [],
        recommendedStrategy: {
          strategy: 'immediate',
          viability: 'LOW',
          reasoning: hardBlockCheck.message
        },
        hardBlockReason: hardBlockCheck.message,
        marketContext: {
          currentPrice,
          atr: request.atr,
          spread,
          timeActive
        }
      };
    }

    // Generate soft warnings (advisory only)
    this.generateSoftWarnings(request, distanceATR, distancePips, spread, warnings);

    // Determine viability and generate strategy options
    const viability = this.determineViability(distanceATR, timeActive);
    const strategies = this.generateStrategyOptions(
      request,
      distanceATR,
      timeActive,
      currentPrice,
      entryZoneCenter
    );
    alternativeStrategies.push(...strategies);

    // Select recommended strategy
    const recommendedStrategy = strategies[0] || {
      strategy: 'pullback' as const,
      viability: 'MEDIUM' as const,
      reasoning: 'Default to pullback entry'
    };

    // Estimate time to zone (for pullback strategy)
    const estimatedSecondsToZone = this.estimateTimeToZone(
      distanceATR,
      request.atr,
      timeActive
    );

    return {
      viability,
      distanceATR,
      distancePips,
      estimatedSecondsToZone,
      warnings,
      alternativeStrategies,
      recommendedStrategy,
      hardBlockReason: null,
      marketContext: {
        currentPrice,
        atr: request.atr,
        spread,
        timeActive
      }
    };
  }

  /**
   * Check for RISK HARD BLOCKS only
   * These are the ONLY conditions that can stop execution
   */
  private async checkHardBlocks(
    request: AdvisoryRequest,
    currentPrice: number,
    spread: number
  ): Promise<EntryWarning | null> {
    // Check drawdown (if account balance provided)
    if (request.accountBalance) {
      // This would need actual drawdown data - placeholder for now
      // const drawdown = await this.getAccountDrawdown(userId);
      // if (isDrawdownBlocking(drawdown)) {
      //   return {
      //     level: 'CRITICAL',
      //     category: 'RISK_HARD_BLOCK',
      //     message: `Account drawdown exceeds 20% hard stop`,
      //     value: drawdown,
      //     threshold: RISK_HARD_BLOCKS.maxDrawdown.hardStop
      //   };
      // }
    }

    // Check position sizing
    // This would validate against maxLotsPerSymbol, maxTotalExposure
    // Placeholder for now

    // Check spread feasibility
    const entryZoneCenter = (request.entryZoneMin + request.entryZoneMax) / 2;
    const slDistance = Math.abs(request.stopLoss - entryZoneCenter);
    const spreadPercent = spread / slDistance;

    if (spreadPercent > RISK_HARD_BLOCKS.spreadFeasibility.maxSpreadToSlPercent) {
      return {
        level: 'CRITICAL',
        category: 'RISK_HARD_BLOCK',
        message: `Spread ${(spreadPercent * 100).toFixed(1)}% of SL distance exceeds 50% maximum. Trade mathematically infeasible.`,
        value: spreadPercent,
        threshold: RISK_HARD_BLOCKS.spreadFeasibility.maxSpreadToSlPercent
      };
    }

    // Check TP/SL positioning
    const tpAboveEntry = request.takeProfit > entryZoneCenter;
    const slAboveEntry = request.stopLoss > entryZoneCenter;
    const shouldTpBeAbove = request.direction === 'BUY';
    const shouldSlBeAbove = request.direction === 'SELL';

    if (tpAboveEntry !== shouldTpBeAbove) {
      return {
        level: 'CRITICAL',
        category: 'RISK_HARD_BLOCK',
        message: `Invalid TP positioning: ${request.direction} trade has TP ${tpAboveEntry ? 'above' : 'below'} entry. Would cause immediate loss.`
      };
    }

    if (slAboveEntry !== shouldSlBeAbove) {
      return {
        level: 'CRITICAL',
        category: 'RISK_HARD_BLOCK',
        message: `Invalid SL positioning: ${request.direction} trade has SL in wrong direction.`
      };
    }

    // Check R:R minimum (advisory, not block)
    const pipInfo = getCurrencyPipInfo(request.symbol);
    const riskPips = Math.abs(entryZoneCenter - request.stopLoss) / pipInfo.pipValue;
    const rewardPips = Math.abs(request.takeProfit - entryZoneCenter) / pipInfo.pipValue;
    const rrRatio = rewardPips / riskPips;

    // Only block if R:R is catastrophically bad (< 0.2)
    // This prevents "guaranteed loss" trades
    if (rrRatio < 0.2) {
      return {
        level: 'CRITICAL',
        category: 'RISK_HARD_BLOCK',
        message: `Risk:Reward ratio ${rrRatio.toFixed(2)} is catastrophically poor. Minimum 0.2 required to prevent guaranteed loss.`,
        value: rrRatio,
        threshold: 0.2
      };
    }

    return null;
  }

  /**
   * Generate soft warnings (advisory only, never block)
   */
  private generateSoftWarnings(
    request: AdvisoryRequest,
    distanceATR: number,
    distancePips: number,
    spread: number,
    warnings: EntryWarning[]
  ): void {
    const thresholds = getEntryDistanceThresholds();

    // Distance warnings
    if (distanceATR > thresholds.hardBackstop) {
      warnings.push({
        level: 'STRONG_ADVISORY',
        category: 'ENTRY_DISTANCE',
        message: `Price ${distanceATR.toFixed(2)}x ATR from zone. Setup may no longer be valid.`,
        value: distanceATR,
        threshold: thresholds.hardBackstop
      });
    } else if (distanceATR > thresholds.advisory) {
      warnings.push({
        level: 'ADVISORY',
        category: 'ENTRY_DISTANCE',
        message: `Price ${distanceATR.toFixed(2)}x ATR from zone. Consider continuation entry.`,
        value: distanceATR,
        threshold: thresholds.advisory
      });
    } else if (distanceATR > thresholds.softWarning) {
      warnings.push({
        level: 'INFO',
        category: 'ENTRY_DISTANCE',
        message: `Price ${distanceATR.toFixed(2)}x ATR from zone. Pullback may take time.`,
        value: distanceATR,
        threshold: thresholds.softWarning
      });
    }

    // Spread warnings
    const spreadThresholds = SOFT_WARNINGS.spread;
    if (spread > spreadThresholds.extreme) {
      warnings.push({
        level: 'STRONG_ADVISORY',
        category: 'SPREAD',
        message: `Spread ${spread.toFixed(1)} pips is extremely wide. High transaction cost.`,
        value: spread,
        threshold: spreadThresholds.extreme
      });
    } else if (spread > spreadThresholds.warning) {
      warnings.push({
        level: 'ADVISORY',
        category: 'SPREAD',
        message: `Spread ${spread.toFixed(1)} pips is elevated. Monitor execution cost.`,
        value: spread,
        threshold: spreadThresholds.warning
      });
    }

    // R:R warnings (advisory guidance)
    const pipInfo = getCurrencyPipInfo(request.symbol);
    const entryZoneCenter = (request.entryZoneMin + request.entryZoneMax) / 2;
    const riskPips = Math.abs(entryZoneCenter - request.stopLoss) / pipInfo.pipValue;
    const rewardPips = Math.abs(request.takeProfit - entryZoneCenter) / pipInfo.pipValue;
    const rrRatio = rewardPips / riskPips;

    const minRR = request.riskMode
      ? SOFT_WARNINGS.riskReward.professional[request.riskMode]
      : SOFT_WARNINGS.riskReward.professional.MEDIUM;

    if (rrRatio < minRR) {
      warnings.push({
        level: 'ADVISORY',
        category: 'RISK_REWARD',
        message: `R:R ${rrRatio.toFixed(2)} below professional minimum ${minRR.toFixed(2)} for ${request.riskMode || 'MEDIUM'} risk mode.`,
        value: rrRatio,
        threshold: minRR
      });
    }
  }

  /**
   * Determine overall viability assessment
   */
  private determineViability(distanceATR: number, timeActive: number): EntryViability {
    const thresholds = getEntryDistanceThresholds();

    // Immediate if very close
    if (distanceATR < 0.5) {
      return 'IMMEDIATE';
    }

    // Pullback if within reasonable distance
    if (distanceATR <= thresholds.softWarning) {
      return 'PULLBACK';
    }

    // Continuation if moderate distance
    if (distanceATR <= thresholds.advisory) {
      return 'CONTINUATION';
    }

    // Unlikely but not blocked if beyond advisory threshold
    if (distanceATR <= thresholds.hardBackstop) {
      return 'UNLIKELY';
    }

    // Still not blocked, just very unlikely
    return 'UNLIKELY';
  }

  /**
   * Generate alternative strategy options
   */
  private generateStrategyOptions(
    request: AdvisoryRequest,
    distanceATR: number,
    timeActive: number,
    currentPrice: number,
    entryZoneCenter: number
  ): EntryStrategy[] {
    const strategies: EntryStrategy[] = [];
    const thresholds = getEntryDistanceThresholds();

    // Strategy 1: Immediate entry (if very close)
    if (distanceATR < 0.5) {
      strategies.push({
        strategy: 'immediate',
        viability: 'HIGH',
        reasoning: `Price ${distanceATR.toFixed(2)}x ATR from zone - execute immediately at ${currentPrice.toFixed(5)}`,
        expectedWaitTime: 0,
        adjustedEntry: currentPrice
      });
    }

    // Strategy 2: Pullback entry (always available)
    if (distanceATR <= thresholds.hardBackstop) {
      const viability = distanceATR <= thresholds.softWarning ? 'HIGH'
                      : distanceATR <= thresholds.advisory ? 'MEDIUM'
                      : 'LOW';

      strategies.push({
        strategy: 'pullback',
        viability,
        reasoning: `Wait for price to retrace ${distanceATR.toFixed(2)}x ATR into zone ${request.entryZoneMin.toFixed(5)}-${request.entryZoneMax.toFixed(5)}`,
        expectedWaitTime: this.estimateTimeToZone(distanceATR, request.atr, timeActive),
        adjustedZone: {
          min: request.entryZoneMin,
          max: request.entryZoneMax
        }
      });
    }

    // Strategy 3: Continuation entry (if price is far)
    if (distanceATR >= thresholds.softWarning && distanceATR <= thresholds.hardBackstop) {
      const viability = distanceATR <= thresholds.advisory ? 'MEDIUM' : 'LOW';

      strategies.push({
        strategy: 'continuation',
        viability,
        reasoning: `Trade into momentum at current price ${currentPrice.toFixed(5)} - pullback unlikely soon (${distanceATR.toFixed(2)}x ATR away)`,
        expectedWaitTime: 0,
        adjustedEntry: currentPrice,
        adjustedZone: {
          min: currentPrice - request.atr * 0.2,
          max: currentPrice + request.atr * 0.2
        }
      });
    }

    // Strategy 4: Breakout entry (if near structure)
    // This would require orderflow/structure analysis - placeholder
    // strategies.push({
    //   strategy: 'breakout',
    //   viability: 'MEDIUM',
    //   reasoning: 'Wait for structure break confirmation',
    //   expectedWaitTime: 300
    // });

    // Sort by viability
    strategies.sort((a, b) => {
      const viabilityOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
      return viabilityOrder[b.viability] - viabilityOrder[a.viability];
    });

    return strategies;
  }

  /**
   * Estimate time to reach entry zone (rough heuristic)
   */
  private estimateTimeToZone(
    distanceATR: number,
    atr: number,
    timeActive: number
  ): number | null {
    if (distanceATR < 0.5) return 0;

    // Rough estimate: assume price moves 0.5 ATR per 5 minutes on average
    // This is a very rough heuristic and should be replaced with actual
    // volatility-based calculations
    const atrPerMinute = 0.5 / 5; // 0.1 ATR per minute
    const estimatedMinutes = distanceATR / atrPerMinute;

    // Cap at reasonable maximum
    return Math.min(estimatedMinutes * 60, 3600); // Max 1 hour
  }

  /**
   * Get current market price
   * ✅ PHASE 2: Use MarketDataService as SSOT
   */
  private async getCurrentPrice(symbol: string): Promise<number> {
    try {
      const marketDataService = MarketDataService.getInstance();
      const priceData = await marketDataService.getCurrentPrice(symbol);

      if (!priceData) {
        logger.warn('[ENTRY_ADVISOR] Failed to get current price', { symbol });
        return 0;
      }

      return priceData.price; // Already mid price from MarketDataService
    } catch (error) {
      logger.error('[ENTRY_ADVISOR] Exception getting current price', { symbol, error });
      return 0;
    }
  }

  /**
   * Get current spread
   * ✅ PHASE 2: Use MarketDataService as SSOT
   */
  private async getCurrentSpread(symbol: string): Promise<number> {
    try {
      const marketDataService = MarketDataService.getInstance();
      const priceData = await marketDataService.getCurrentPrice(symbol);

      if (!priceData) {
        return 2.0; // Default fallback
      }

      const pipInfo = getCurrencyPipInfo(symbol);
      return Math.abs(priceData.ask - priceData.bid) / pipInfo.pipValue;
    } catch (error) {
      return 2.0; // Default fallback
    }
  }
}

export const entryAdvisor = new EntryAdvisor();
