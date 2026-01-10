/**
 * Entry Qualification Engine - Professional Entry Quality Scoring
 *
 * ═══════════════════════════════════════════════════════════════════
 * SINGLE SOURCE OF TRUTH for entry timing quality evaluation
 * ═══════════════════════════════════════════════════════════════════
 *
 * RESPONSIBILITY:
 * Scores entry quality on technical merit (0-100 EQS), decides WHEN to enter.
 * Alpha decides IF and WHERE. EQE optimizes WHEN and HOW GOOD the entry is.
 *
 * ARCHITECTURE CHANGE:
 * NO MORE REJECTIONS. Removed REJECT_ENTRY status per architectural mandate.
 * Entry Qualification Engine evaluates quality only - Alpha has final authority.
 *
 * ENTRY QUALITY SCORE (EQS) SYSTEM:
 * - Location Score (0-30): VWAP setup, key levels, liquidity position
 * - Confirmation Score (0-30): Candle acceptance, patterns, momentum
 * - Timing Score (0-25): Pullback quality, compression/expansion, precision
 * - Friction Penalty (0 to -15): Wicks, spread, news spikes
 *
 * GRADING SYSTEM:
 * - Grade A+ (80+): Execute immediately at optimal microstructure
 * - Grade A (72-79): Execute with strong acceptance + VWAP
 * - Grade B (65-71): Wait for better entry with structured triggers
 * - Grade C (50-64): Wait tight, require confirmation candle
 * - Grade D (<50): Wait passive, monitor for improvement
 *
 * PHILOSOPHY:
 * Alpha says "BUY EURUSD". EQE says "execute now at 80 EQS" or
 * "wait for 75+ EQS at VWAP kiss". No rejections, only optimal timing.
 *
 * SSOT COMPLIANCE:
 * - Entry timing quality: THIS SERVICE
 * - Entry price monitoring: entry-execution-coordinator.ts
 * - Execution economics: execution-eligibility-gate.ts
 * - Strategy decision: coordinator-alpha.ts
 * - Risk boundaries: omega9-constraint-provider.ts
 * ═══════════════════════════════════════════════════════════════════
 */

import { calculatePipDistance } from '../utils/currencyHelpers';
import { getSymbolConfig } from '../config/symbol-registry';
import { logger } from '../lib/logger';
import { VOLATILITY_PATIENCE_CONFIG } from '../config/volatility-aware-patience-config';
import { ALPHA_IDENTITY, EQS_WEIGHTED_FACTORS } from '../config/alpha-identity';
import { getDisplayNameFromStyle, type TradeStyle } from '../config/trade-styles';
import type { ATRValue } from '../types/atr';
import type {
  EntryQualificationStatus,
  EntryActionTier,
  EQSBreakdown,
  EntryTrigger,
  StyleDisplayName
} from '../types/entry';

export interface EntryQualificationInput {
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;

  // M5 microstructure data
  m5Candles: M5Candle[];
  m5VWAP: number;
  m5EMA20: number;
  m5RSI: number;
  m5VolumeAvg20: number;

  // M15 context (for confluence)
  m15Trend: 'bullish' | 'bearish' | 'sideways';
  m15SupportResistance?: {
    nearestSupport?: number;
    nearestResistance?: number;
  };

  // Market conditions
  currentSpreadPips: number;
  averageSpreadPips: number;
  /**
   * Average True Range with explicit timeframe tracking
   * Now uses typed ATRValue for SSOT compliance
   * See /src/types/atr.ts for details
   */
  atr: number | ATRValue; // Accept both during migration period
}

export interface M5Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface EntryQualificationBlock {
  code: string;
  message: string;
  severity: 'HARD_BLOCK' | 'ADVISORY';
  suggestion: string;
}

/**
 * Enhanced Entry Acceptance Interfaces (BOLT Implementation)
 */
export interface CandleAcceptanceResult {
  accepted: boolean;
  consecutiveCloses: number;
  bodyDominance: number; // 0-1
  closeQuality: 'excellent' | 'good' | 'poor';
  expansionDetected: boolean;
  details: string;
}

export interface PullbackQualityResult {
  grade: 'A' | 'B' | 'C';
  pullbackPercent: number;
  quality: 'shallow' | 'medium' | 'deep';
  score: number; // 0-100
  recommendation: string;
}

export interface CompressionExpansionResult {
  compressionDetected: boolean;
  compressionCandles: number;
  expansionFollows: boolean;
  qualityBonus: number; // 0-20 points
  pattern: string;
}

export interface FailedMoveResult {
  failedMoveDetected: boolean;
  failureType: 'false_breakout' | 'exhaustion' | 'rejection' | 'none';
  confirmationPresent: boolean;
  entryViable: boolean;
  details: string;
}

/**
 * Entry Qualification Result - EQS-based evaluation
 * Replaces blocks/advisories with scored breakdown
 */
export interface EntryQualificationResult {
  status: EntryQualificationStatus;           // EXECUTE_NOW or WAIT_FOR_BETTER_ENTRY
  actionTier: EntryActionTier;                // Granular action decision
  eqs: number;                                // Total Entry Quality Score (0-100, can be negative)
  eqsBreakdown: EQSBreakdown;                 // Detailed scoring breakdown
  eqsGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F'; // Letter grade for EQS

  // Entry triggers (generated when WAIT_FOR_BETTER_ENTRY)
  entryTriggers?: EntryTrigger[];

  // Wait recommendation (for lower-quality setups)
  waitRecommendation?: {
    reason: string;
    estimatedImprovementMinutes: number;
    expectedQualityImprovement: number;
    whatsMissing: string[];                   // What components need improvement
  };

  // Legacy metrics for backward compatibility
  qualityScore: number;                       // Alias for eqs
  blocks: EntryQualificationBlock[];          // Deprecated: now empty array
  advisories: EntryQualificationBlock[];      // Deprecated: now empty array
  metrics: {
    vwapAlignment: boolean;
    momentumConfirmation: boolean;
    volumeConfirmation: boolean;
    rangePosition: 'top' | 'middle' | 'bottom';
    confluenceScore: number;
    microstructureGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  };

  // Enhanced acceptance metrics (preserved from existing system)
  candleAcceptance?: CandleAcceptanceResult;
  pullbackQuality?: PullbackQualityResult;
  compressionExpansion?: CompressionExpansionResult;
  failedMove?: FailedMoveResult;
}

class EntryQualificationEngine {
  /**
   * ═══════════════════════════════════════════════════════════════════
   * MAIN EVALUATION METHOD - EQS-BASED ENTRY QUALITY SCORING
   * ═══════════════════════════════════════════════════════════════════
   *
   * Returns professional entry quality score (0-100) with detailed breakdown.
   * NO REJECTIONS - only execute-now or wait-for-better-entry decisions.
   */
  evaluate(input: EntryQualificationInput): EntryQualificationResult {
    // Calculate legacy metrics for backward compatibility
    const metrics = this.calculateMetrics(input);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ENHANCED ACCEPTANCE ANALYSIS (preserved from existing system)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const candleAcceptance = this.checkCandleAcceptance(input.m5Candles, input.direction);
    const pullbackQuality = this.checkPullbackQuality(input.m5Candles, input.direction);
    const compressionExpansion = this.checkCompressionExpansion(input.m5Candles);
    const failedMove = this.checkFailedMove(input.m5Candles, input.direction);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // NEW: EQS COMPONENT SCORING
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // 1. Location Score (0-30 points)
    const locationScore = this.calculateLocationScore(input, metrics);

    // 2. Confirmation Score (0-30 points)
    const confirmationScore = this.calculateConfirmationScore(
      input,
      metrics,
      candleAcceptance,
      failedMove
    );

    // 3. Timing Score (0-25 points)
    const timingScore = this.calculateTimingScore(
      input,
      pullbackQuality,
      compressionExpansion
    );

    // 4. Friction Penalty (0 to -15 points)
    const frictionPenalty = this.calculateFrictionPenalty(input);

    // Calculate total EQS
    let totalEQS = locationScore.total + confirmationScore.total + timingScore.total + frictionPenalty.total;

    // 5. Grade A+ Pattern Bonuses (+10 to +15)
    const aplusPattern = this.detectAPlusPatterns(input, metrics, candleAcceptance, pullbackQuality);
    if (aplusPattern) {
      totalEQS += aplusPattern.bonus;
      logger.info(`[EQE] 🌟 Grade A+ Pattern Detected: ${aplusPattern.type} (+${aplusPattern.bonus} points)`);
    }

    // Build EQS breakdown with spec-compliant weights
    // Map legacy scores to new spec weights:
    // Candle acceptance: 20 (from confirmationDetails.candleAcceptance scaled)
    // Pullback quality: 15 (from timingDetails.pullbackQuality scaled)
    // VWAP interaction: 15 (from locationDetails.vwapSetup scaled)
    // EMA alignment: 10 (from confluence/momentum)
    // Liquidity reaction: 15 (from locationDetails.liquidityLocation scaled)
    // Compression/expansion: 10 (from timingDetails.compressionExpansion scaled)
    // Failed move: 10 (from pattern confirmation)
    // Timeframe alignment: 5 (from range position)

    const candleAcceptanceScore = Math.min(20, Math.round((confirmationScore.details.candleAcceptance / 15) * 20));
    const pullbackQualityScore = Math.min(15, Math.round((timingScore.details.pullbackQuality / 12) * 15));
    const vwapInteractionScore = Math.min(15, Math.round((locationScore.details.vwapSetup / 12) * 15));
    const emaAlignmentScore = Math.min(10, Math.round((confirmationScore.details.momentumAlignment / 5) * 10));
    const liquidityReactionScore = Math.min(15, Math.round((locationScore.details.liquidityLocation / 8) * 15));
    const compressionExpansionScore = Math.min(10, Math.round((timingScore.details.compressionExpansion / 8) * 10));
    const failedMoveScore = Math.min(10, Math.round((confirmationScore.details.patternConfirmation / 10) * 10));
    const timeframeAlignmentScore = Math.min(5, metrics.rangePosition !== 'middle' ? 5 : 2);

    const eqsBreakdown: EQSBreakdown = {
      candleAcceptance: candleAcceptanceScore,
      pullbackQuality: pullbackQualityScore,
      vwapInteraction: vwapInteractionScore,
      emaAlignment: emaAlignmentScore,
      liquidityReaction: liquidityReactionScore,
      compressionExpansion: compressionExpansionScore,
      failedMoveConfirmation: failedMoveScore,
      timeframeAlignment: timeframeAlignmentScore,
      totalScore: totalEQS,
      factorDetails: {
        candleAcceptance: {
          bodyDominance: Math.round(candleAcceptance.bodyDominance * 8),
          consecutiveCloses: Math.min(7, candleAcceptance.consecutiveCloses * 2),
          closeQuality: candleAcceptance.closeQuality === 'excellent' ? 5 : candleAcceptance.closeQuality === 'good' ? 3 : 1,
        },
        pullbackQuality: {
          retracementDepth: pullbackQuality.grade === 'A' ? 8 : pullbackQuality.grade === 'B' ? 5 : 2,
          impulseIdentification: pullbackQuality.quality === 'shallow' ? 7 : pullbackQuality.quality === 'medium' ? 4 : 2,
        },
        vwapInteraction: {
          distance: Math.min(6, Math.round((locationScore.details.vwapSetup / 12) * 6)),
          kissPattern: metrics.vwapAlignment ? 5 : 1,
          reclaimQuality: metrics.vwapAlignment ? 4 : 1,
        },
        emaAlignment: {
          directionMatch: metrics.momentumConfirmation ? 4 : 1,
          slopeStrength: 2,
          crossoverRecent: 2,
        },
        liquidityReaction: {
          poolResponse: Math.min(8, Math.round((locationScore.details.liquidityLocation / 8) * 8)),
          sweepReclaim: failedMove.entryViable ? 7 : 2,
        },
        compressionExpansion: {
          compressionDetected: compressionExpansion.compressionDetected ? 5 : 1,
          expansionFollows: compressionExpansion.expansionFollows ? 5 : 1,
        },
        failedMoveConfirmation: {
          failureDetected: failedMove.failedMoveDetected ? 5 : 1,
          confirmationPresent: failedMove.confirmationPresent ? 5 : 1,
        },
        timeframeAlignment: {
          m5Confirmation: metrics.momentumConfirmation ? 3 : 1,
          mtfAlignment: input.m15Trend === (input.direction === 'BUY' ? 'bullish' : 'bearish') ? 2 : 0,
        },
      },
      aplusPatternBonus: aplusPattern?.bonus,
      aplusPatternType: aplusPattern?.type,
      locationScore: locationScore.total,
      confirmationScore: confirmationScore.total,
      timingScore: timingScore.total,
      frictionPenalty: frictionPenalty.total,
      locationDetails: locationScore.details,
      confirmationDetails: confirmationScore.details,
      timingDetails: timingScore.details,
      frictionDetails: frictionPenalty.details,
    };

    // Determine action tier and status
    const actionTier = this.determineActionTier(totalEQS, eqsBreakdown);
    const status: EntryQualificationStatus = actionTier === 'EXECUTE_NOW'
      ? 'EXECUTE_NOW'
      : 'WAIT_FOR_BETTER_ENTRY';

    // Calculate EQS grade
    const eqsGrade = this.calculateEQSGrade(totalEQS);

    // Generate entry triggers if waiting
    let entryTriggers: EntryTrigger[] | undefined;
    let waitRecommendation: EntryQualificationResult['waitRecommendation'];

    if (status === 'WAIT_FOR_BETTER_ENTRY') {
      entryTriggers = this.generateEntryTriggers(input, eqsBreakdown, totalEQS);
      waitRecommendation = this.generateWaitRecommendationNew(input, eqsBreakdown, actionTier);
    }

    // Log EQS breakdown
    this.logEQSBreakdown(totalEQS, eqsGrade, actionTier, eqsBreakdown);

    return {
      status,
      actionTier,
      eqs: totalEQS,
      eqsBreakdown,
      eqsGrade,
      entryTriggers,
      waitRecommendation,
      qualityScore: totalEQS, // Alias for backward compatibility
      blocks: [], // Deprecated
      advisories: [], // Deprecated
      metrics,
      candleAcceptance,
      pullbackQuality,
      compressionExpansion,
      failedMove
    };
  }

  /**
   * Calculate all metrics upfront
   */
  private calculateMetrics(input: EntryQualificationInput): EntryQualificationResult['metrics'] {
    const { m5Candles, m5VWAP, m5EMA20, m5RSI, m5VolumeAvg20, entryPrice, direction } = input;

    // VWAP alignment
    const vwapAlignment = this.isVWAPAligned(entryPrice, m5VWAP, direction);

    // Momentum confirmation
    const momentumConfirmation = this.isMomentumConfirmed(m5Candles, direction);

    // Volume confirmation
    const currentVolume = m5Candles[m5Candles.length - 1]?.volume || 0;
    const volumeConfirmation = currentVolume >= (m5VolumeAvg20 * 0.4);

    // Range position
    const rangePosition = this.calculateRangePosition(m5Candles, entryPrice);

    // Confluence score
    const confluenceScore = this.calculateConfluenceScore(input);

    // Microstructure grade
    const microstructureGrade = this.calculateMicrostructureGrade(
      vwapAlignment,
      momentumConfirmation,
      volumeConfirmation,
      rangePosition,
      confluenceScore
    );

    return {
      vwapAlignment,
      momentumConfirmation,
      volumeConfirmation,
      rangePosition,
      confluenceScore,
      microstructureGrade
    };
  }

  /**
   * ═══════════════════════════════════════════════════════════════════
   * EQS COMPONENT SCORING METHODS
   * ═══════════════════════════════════════════════════════════════════
   */

  /**
   * 1. LOCATION SCORE (0-30 points)
   * Where you enter: VWAP setup, key levels, liquidity position
   */
  private calculateLocationScore(
    input: EntryQualificationInput,
    metrics: EntryQualificationResult['metrics']
  ): { total: number; details: EQSBreakdown['locationDetails'] } {
    let vwapSetup = 0;          // 0-12 points
    let keyLevelConfluence = 0; // 0-10 points
    let liquidityLocation = 0;  // 0-8 points

    // A. VWAP Setup (0-12 points)
    const { entryPrice, m5VWAP, atr, direction } = input;
    const atrValue = typeof atr === 'number' ? atr : atr.value;
    const vwapDistance = Math.abs(entryPrice - m5VWAP);
    const vwapDistanceATR = vwapDistance / atrValue;

    if (metrics.vwapAlignment) {
      // Correct side of VWAP
      if (vwapDistanceATR < 0.15) {
        // Perfect VWAP kiss (within 0.15 ATR)
        vwapSetup = 12;
      } else if (vwapDistanceATR < 0.3) {
        // Good proximity (within 0.3 ATR)
        vwapSetup = 10;
      } else if (vwapDistanceATR < 0.5) {
        // Acceptable (within 0.5 ATR)
        vwapSetup = 8;
      } else {
        // Too far but correct side
        vwapSetup = 4;
      }
    } else {
      // Wrong side of VWAP - penalty instead of block
      vwapSetup = Math.max(0, 4 - Math.floor(vwapDistanceATR * 2));
    }

    // B. Key Level Confluence (0-10 points)
    if (input.m15SupportResistance) {
      const { nearestSupport, nearestResistance } = input.m15SupportResistance;

      // Check proximity to key M15 levels
      const atSupport = nearestSupport &&
        Math.abs(calculatePipDistance(input.symbol, entryPrice, nearestSupport)) < 5;
      const atResistance = nearestResistance &&
        Math.abs(calculatePipDistance(input.symbol, entryPrice, nearestResistance)) < 5;

      const isAtStructure = (direction === 'BUY' && atSupport) || (direction === 'SELL' && atResistance);

      if (isAtStructure) {
        keyLevelConfluence = 10; // Perfect structure entry
      } else if (atSupport || atResistance) {
        keyLevelConfluence = 6; // Near structure but not ideal direction
      } else {
        keyLevelConfluence = 3; // Mid-range entry
      }
    } else {
      keyLevelConfluence = 5; // No structure data, neutral score
    }

    // C. Liquidity Location (0-8 points)
    // Placeholder for liquidity bias integration (will be enhanced with Omega-8 data)
    // For now, use simple logic based on range position
    if (metrics.rangePosition === 'top' || metrics.rangePosition === 'bottom') {
      liquidityLocation = 8; // Range extremes (good for entries)
    } else {
      liquidityLocation = 3; // Middle of range (choppy zone)
    }

    const total = vwapSetup + keyLevelConfluence + liquidityLocation;

    return {
      total,
      details: {
        vwapSetup,
        keyLevelConfluence,
        liquidityLocation
      }
    };
  }

  /**
   * 2. CONFIRMATION SCORE (0-30 points)
   * Why now: Candle acceptance, patterns, momentum
   */
  private calculateConfirmationScore(
    input: EntryQualificationInput,
    metrics: EntryQualificationResult['metrics'],
    candleAcceptance: CandleAcceptanceResult,
    failedMove: FailedMoveResult
  ): { total: number; details: EQSBreakdown['confirmationDetails'] } {
    let candleAcceptanceScore = 0;  // 0-15 points
    let patternConfirmation = 0;    // 0-10 points
    let momentumAlignment = 0;      // 0-5 points

    // A. Candle Acceptance (0-15 points)
    if (candleAcceptance.accepted) {
      candleAcceptanceScore = 15; // Full score for accepted candles
    } else {
      // Partial credit based on quality
      if (candleAcceptance.consecutiveCloses >= 1) {
        candleAcceptanceScore += 5;
      }
      if (candleAcceptance.bodyDominance >= 0.5) {
        candleAcceptanceScore += 4;
      }
      if (candleAcceptance.closeQuality !== 'poor') {
        candleAcceptanceScore += 3;
      }
    }

    // B. Pattern Confirmation (0-10 points)
    if (failedMove.entryViable) {
      patternConfirmation = 10; // Strong reversal pattern
    } else if (failedMove.failedMoveDetected && failedMove.confirmationPresent) {
      patternConfirmation = 7; // Pattern present, some confirmation
    } else {
      patternConfirmation = 3; // No pattern, neutral
    }

    // C. Momentum Alignment (0-5 points)
    if (metrics.momentumConfirmation) {
      momentumAlignment = 5; // Momentum confirms direction
    } else {
      momentumAlignment = 0; // Momentum against - penalty instead of block
    }

    const total = candleAcceptanceScore + patternConfirmation + momentumAlignment;

    return {
      total,
      details: {
        candleAcceptance: candleAcceptanceScore,
        patternConfirmation,
        momentumAlignment
      }
    };
  }

  /**
   * 3. TIMING SCORE (0-25 points)
   * Entry finesse: Pullback quality, compression/expansion, precision
   */
  private calculateTimingScore(
    input: EntryQualificationInput,
    pullbackQuality: PullbackQualityResult,
    compressionExpansion: CompressionExpansionResult
  ): { total: number; details: EQSBreakdown['timingDetails'] } {
    let pullbackQualityScore = 0;        // 0-12 points
    let compressionExpansionScore = 0;   // 0-8 points
    let entryPrecision = 0;              // 0-5 points

    // A. Pullback Quality (0-12 points)
    if (pullbackQuality.grade === 'A') {
      pullbackQualityScore = 12; // Perfect 38-50% pullback
    } else if (pullbackQuality.grade === 'B') {
      pullbackQualityScore = 9;  // Good 50-70% pullback
    } else if (pullbackQuality.grade === 'C') {
      pullbackQualityScore = 4;  // Deep pullback, caution
    }

    // B. Compression/Expansion (0-8 points)
    if (compressionExpansion.compressionDetected && compressionExpansion.expansionFollows) {
      compressionExpansionScore = 8; // Perfect compression → expansion
    } else if (compressionExpansion.compressionDetected) {
      compressionExpansionScore = 5; // Compression detected
    } else {
      compressionExpansionScore = 2; // No pattern, neutral
    }

    // C. Entry Precision (0-5 points)
    // Check if we're chasing (reduces score)
    const atrValue = typeof input.atr === 'number' ? input.atr : input.atr.value;
    const { m5Candles } = input;

    if (m5Candles.length >= 3) {
      const recent3 = m5Candles.slice(-3);
      const totalMove = Math.abs(recent3[recent3.length - 1].close - recent3[0].open);
      const impulseMoveThreshold = atrValue * 0.8;

      if (totalMove < impulseMoveThreshold * 0.3) {
        entryPrecision = 5; // Perfect timing, no chase
      } else if (totalMove < impulseMoveThreshold * 0.6) {
        entryPrecision = 3; // Reasonable timing
      } else if (totalMove > impulseMoveThreshold) {
        entryPrecision = 0; // Chasing impulse - penalty instead of block
      } else {
        entryPrecision = 2; // Acceptable
      }
    } else {
      entryPrecision = 3; // Neutral if not enough data
    }

    const total = pullbackQualityScore + compressionExpansionScore + entryPrecision;

    return {
      total,
      details: {
        pullbackQuality: pullbackQualityScore,
        compressionExpansion: compressionExpansionScore,
        entryPrecision
      }
    };
  }

  /**
   * 4. FRICTION PENALTY (0 to -15 points)
   * Market conditions: Wicks, spread, news spikes
   */
  private calculateFrictionPenalty(
    input: EntryQualificationInput
  ): { total: number; details: EQSBreakdown['frictionDetails'] } {
    let wickRisk = 0;         // 0 to -7 points
    let spreadPenalty = 0;    // 0 to -6 points
    let newsSpikePenalty = 0; // 0 to -8 points

    const atrValue = typeof input.atr === 'number' ? input.atr : input.atr.value;

    // A. Wick Risk (0 to -7 points)
    if (input.m5Candles.length > 0) {
      const lastCandle = input.m5Candles[input.m5Candles.length - 1];
      const body = Math.abs(lastCandle.close - lastCandle.open);
      const maxOC = Math.max(lastCandle.open, lastCandle.close);
      const minOC = Math.min(lastCandle.open, lastCandle.close);
      const wickHigh = lastCandle.high - maxOC;
      const wickLow = minOC - lastCandle.low;

      const largeWickThreshold = atrValue * 0.5;

      if (wickHigh > largeWickThreshold || wickLow > largeWickThreshold) {
        wickRisk = -7; // Large wick rejection
      } else if (wickHigh > body * 2 || wickLow > body * 2) {
        wickRisk = -4; // Moderate wick risk
      }
    }

    // B. Spread Penalty (0 to -6 points)
    const spreadRatio = input.currentSpreadPips / input.averageSpreadPips;
    if (spreadRatio > 2.5) {
      spreadPenalty = -6; // Extreme spread
    } else if (spreadRatio > 2.0) {
      spreadPenalty = -4; // High spread
    } else if (spreadRatio > 1.5) {
      spreadPenalty = -2; // Elevated spread
    }

    // C. News Spike Penalty (0 to -8 points)
    if (input.m5Candles.length >= 2) {
      const avgCandleRange = this.calculateAverageCandleRange(input.m5Candles);
      const lastCandle = input.m5Candles[input.m5Candles.length - 1];
      const lastRange = lastCandle.high - lastCandle.low;

      if (lastRange > avgCandleRange * 3.5) {
        newsSpikePenalty = -8; // Extreme spike
      } else if (lastRange > avgCandleRange * 2.5) {
        newsSpikePenalty = -5; // News spike
      }
    }

    // Cap total friction penalty at -15
    const total = Math.max(-15, wickRisk + spreadPenalty + newsSpikePenalty);

    return {
      total,
      details: {
        wickRisk,
        spreadPenalty,
        newsSpikePenalty
      }
    };
  }

  /**
   * DEPRECATED: Check VWAP alignment - now integrated into Location Score
   * Kept for backward compatibility
   */
  private checkVWAPAlignment(
    input: EntryQualificationInput,
    metrics: EntryQualificationResult['metrics'],
    blocks: EntryQualificationBlock[]
  ): void {
    // No-op: VWAP alignment is now scored in Location Score, not a hard block
  }

  /**
   * HARD BLOCK: Check momentum direction
   * No counter-trend entries on M5
   */
  private checkMomentumDirection(
    input: EntryQualificationInput,
    metrics: EntryQualificationResult['metrics'],
    blocks: EntryQualificationBlock[]
  ): void {
    if (!metrics.momentumConfirmation) {
      blocks.push({
        code: 'MOMENTUM_AGAINST',
        message: `M5 momentum does not confirm ${input.direction} direction`,
        severity: 'HARD_BLOCK',
        suggestion: 'Wait for M5 momentum to align with trade direction'
      });
    }
  }

  /**
   * HARD BLOCK: Check range position
   * Avoid choppy middle (25-75% of range)
   */
  private checkRangePosition(
    input: EntryQualificationInput,
    metrics: EntryQualificationResult['metrics'],
    blocks: EntryQualificationBlock[]
  ): void {
    if (metrics.rangePosition === 'middle') {
      blocks.push({
        code: 'CHOPPY_MIDDLE',
        message: 'Entry in middle of M5 range (choppy zone, 25-75%)',
        severity: 'HARD_BLOCK',
        suggestion: 'Wait for price to reach range extreme (top/bottom 25%)'
      });
    }
  }

  /**
   * HARD BLOCK: Check for recent false breakout
   * If last 3 M5 candles showed false breakout, avoid entry
   */
  private checkFalseBreakout(
    input: EntryQualificationInput,
    blocks: EntryQualificationBlock[]
  ): void {
    const { m5Candles, direction } = input;
    const recent3 = m5Candles.slice(-3);

    if (recent3.length < 3) return;

    const hadFalseBreakout = this.detectFalseBreakout(recent3, direction);

    if (hadFalseBreakout) {
      blocks.push({
        code: 'RECENT_FALSE_BREAKOUT',
        message: 'Recent false breakout detected in last 3 M5 candles',
        severity: 'HARD_BLOCK',
        suggestion: 'Wait for clean price action to re-establish before entry'
      });
    }
  }

  /**
   * HARD BLOCK: Check volume confirmation
   * Volume must be at least 40% of 20-period average
   */
  private checkVolumeConfirmation(
    input: EntryQualificationInput,
    metrics: EntryQualificationResult['metrics'],
    blocks: EntryQualificationBlock[]
  ): void {
    if (!metrics.volumeConfirmation) {
      const currentVolume = input.m5Candles[input.m5Candles.length - 1]?.volume || 0;
      const volumePercent = (currentVolume / input.m5VolumeAvg20) * 100;

      blocks.push({
        code: 'VOLUME_DEAD',
        message: `M5 volume too low (${volumePercent.toFixed(0)}% of average, need 40%+)`,
        severity: 'HARD_BLOCK',
        suggestion: 'Wait for volume to pick up before entering'
      });
    }
  }

  /**
   * ADVISORY: Check structure alignment
   * Best entries at M15 support/resistance retests
   */
  private checkStructureAlignment(
    input: EntryQualificationInput,
    metrics: EntryQualificationResult['metrics'],
    advisories: EntryQualificationBlock[]
  ): void {
    if (!input.m15SupportResistance) return;

    const { nearestSupport, nearestResistance } = input.m15SupportResistance;
    const { entryPrice, direction } = input;

    // Check if entering at structure (good) or mid-range (advisory)
    const atSupport = nearestSupport && Math.abs(calculatePipDistance(input.symbol, entryPrice, nearestSupport)) < 5;
    const atResistance = nearestResistance && Math.abs(calculatePipDistance(input.symbol, entryPrice, nearestResistance)) < 5;

    const isAtStructure = (direction === 'BUY' && atSupport) || (direction === 'SELL' && atResistance);

    if (!isAtStructure) {
      advisories.push({
        code: 'STRUCTURE_MISALIGNMENT',
        message: 'Entry not at key M15 support/resistance level',
        severity: 'ADVISORY',
        suggestion: 'Consider waiting for retracement to M15 structure for better R:R'
      });
    }
  }

  /**
   * ADVISORY: Check RSI extremes
   * RSI > 75 or < 25 suggests potential reversal
   */
  private checkRSIExtremes(
    input: EntryQualificationInput,
    metrics: EntryQualificationResult['metrics'],
    advisories: EntryQualificationBlock[]
  ): void {
    const { m5RSI, direction } = input;

    if (direction === 'BUY' && m5RSI > 75) {
      advisories.push({
        code: 'RSI_OVERBOUGHT',
        message: `M5 RSI overbought (${m5RSI.toFixed(1)})`,
        severity: 'ADVISORY',
        suggestion: 'Consider waiting for RSI pullback before entering long'
      });
    } else if (direction === 'SELL' && m5RSI < 25) {
      advisories.push({
        code: 'RSI_OVERSOLD',
        message: `M5 RSI oversold (${m5RSI.toFixed(1)})`,
        severity: 'ADVISORY',
        suggestion: 'Consider waiting for RSI bounce before entering short'
      });
    }
  }

  /**
   * ADVISORY: Check confluence score
   * Warn if confluence is weak
   */
  private checkConfluence(
    input: EntryQualificationInput,
    metrics: EntryQualificationResult['metrics'],
    advisories: EntryQualificationBlock[]
  ): void {
    if (metrics.confluenceScore < 60) {
      advisories.push({
        code: 'WEAK_CONFLUENCE',
        message: `Multiple timeframe confluence weak (${metrics.confluenceScore}/100)`,
        severity: 'ADVISORY',
        suggestion: 'Wait for stronger M5/M15 alignment before entering'
      });
    }
  }

  /**
   * ADVISORY: Check spread conditions
   * Warn if spread elevated
   */
  private checkSpread(
    input: EntryQualificationInput,
    advisories: EntryQualificationBlock[]
  ): void {
    const { currentSpreadPips, averageSpreadPips } = input;
    const spreadRatio = currentSpreadPips / averageSpreadPips;

    if (spreadRatio > 1.5) {
      advisories.push({
        code: 'ELEVATED_SPREAD',
        message: `Spread elevated (${currentSpreadPips.toFixed(1)} pips vs ${averageSpreadPips.toFixed(1)} avg, ${spreadRatio.toFixed(1)}x)`,
        severity: 'ADVISORY',
        suggestion: 'Consider waiting for spread to normalize'
      });
    }
  }

  /**
   * NEW STRICTER CHECK: Chase Detection
   * Block entries after strong impulse moves (> 0.8x ATR)
   * Action: WAIT_FOR_PULLBACK
   */
  private checkChaseDetection(
    input: EntryQualificationInput,
    blocks: EntryQualificationBlock[]
  ): void {
    const config = VOLATILITY_PATIENCE_CONFIG.eqe.chaseDetection;
    const { m5Candles, atr: atrInput, direction } = input;

    if (m5Candles.length < config.lookbackCandles) return;

    // Extract ATR value (support both legacy number and typed ATRValue)
    const atr = typeof atrInput === 'number' ? atrInput : atrInput.value;
    const atrTimeframe = typeof atrInput === 'number' ? undefined : atrInput.timeframe;

    // Log timeframe for debugging
    if (atrTimeframe) {
      logger.debug(`[EQE] Chase detection using ${atrTimeframe} ATR: ${atr.toFixed(5)}`);
    } else {
      logger.warn('[EQE] Chase detection using legacy raw ATR - update caller to typed ATRValue');
    }

    const recentCandles = m5Candles.slice(-config.lookbackCandles);
    const totalMove = Math.abs(recentCandles[recentCandles.length - 1].close - recentCandles[0].open);
    const impulseMoveThreshold = atr * config.impulseMoveThreshold;

    const isImpulseMove = totalMove > impulseMoveThreshold;
    const moveWithDirection = (direction === 'BUY' && recentCandles[recentCandles.length - 1].close > recentCandles[0].open) ||
                               (direction === 'SELL' && recentCandles[recentCandles.length - 1].close < recentCandles[0].open);

    if (isImpulseMove && moveWithDirection) {
      blocks.push({
        code: 'CHASING_IMPULSE',
        message: `Chasing impulse move (${totalMove.toFixed(5)} over ${config.lookbackCandles} candles, ${(totalMove/atr).toFixed(2)}x ATR)`,
        severity: 'HARD_BLOCK',
        suggestion: `Wait for pullback to VWAP or support/resistance before entering. Action: ${config.action}`
      });
    }
  }

  /**
   * NEW STRICTER CHECK: Exhaustion Detection
   * Block entries on large-body candles closing near extremes
   * Action: WAIT_FOR_CONFIRMATION
   */
  private checkExhaustionDetection(
    input: EntryQualificationInput,
    blocks: EntryQualificationBlock[]
  ): void {
    const config = VOLATILITY_PATIENCE_CONFIG.eqe.exhaustionDetection;
    const { m5Candles, direction } = input;

    if (m5Candles.length === 0) return;

    const lastCandle = m5Candles[m5Candles.length - 1];
    const range = lastCandle.high - lastCandle.low;
    const body = Math.abs(lastCandle.close - lastCandle.open);

    if (range === 0) return;

    const bodyRatio = body / range;
    const isLargeBody = bodyRatio > config.largeBodyThreshold;

    let closeNearExtreme = false;
    if (direction === 'BUY') {
      const distanceFromHigh = (lastCandle.high - lastCandle.close) / range;
      closeNearExtreme = distanceFromHigh < config.closeNearExtremeThreshold;
    } else {
      const distanceFromLow = (lastCandle.close - lastCandle.low) / range;
      closeNearExtreme = distanceFromLow < config.closeNearExtremeThreshold;
    }

    if (isLargeBody && closeNearExtreme) {
      blocks.push({
        code: 'EXHAUSTION_CANDLE',
        message: `Exhaustion detected: Large body (${(bodyRatio*100).toFixed(0)}%) closing near ${direction === 'BUY' ? 'high' : 'low'}`,
        severity: 'HARD_BLOCK',
        suggestion: `Wait for confirmation candle before entering. Action: ${config.action}`
      });
    }
  }

  /**
   * NEW STRICTER CHECK: VWAP Distance Limits
   * Block entries too far from VWAP (> 1.2x ATR)
   * Action: WAIT_FOR_PULLBACK
   */
  private checkVWAPDistanceLimits(
    input: EntryQualificationInput,
    blocks: EntryQualificationBlock[]
  ): void {
    const config = VOLATILITY_PATIENCE_CONFIG.eqe.vwapDistanceLimits;
    const { entryPrice, m5VWAP, atr: atrInput } = input;

    // Extract ATR value (support both legacy number and typed ATRValue)
    const atr = typeof atrInput === 'number' ? atrInput : atrInput.value;
    const atrTimeframe = typeof atrInput === 'number' ? undefined : atrInput.timeframe;

    // Log timeframe for debugging
    if (atrTimeframe) {
      logger.debug(`[EQE] VWAP distance check using ${atrTimeframe} ATR: ${atr.toFixed(5)}`);
    }

    const distanceFromVWAP = Math.abs(entryPrice - m5VWAP);
    const maxAllowedDistance = atr * config.maxDistanceFromVWAP;

    if (distanceFromVWAP > maxAllowedDistance) {
      blocks.push({
        code: 'TOO_FAR_FROM_VWAP',
        message: `Entry too far from M5 VWAP (${distanceFromVWAP.toFixed(5)} vs max ${maxAllowedDistance.toFixed(5)}, ${(distanceFromVWAP/atr).toFixed(2)}x ATR)`,
        severity: 'HARD_BLOCK',
        suggestion: `Wait for price to return closer to VWAP before entering. Action: ${config.action}`
      });
    }
  }

  /**
   * Helper: Check if VWAP aligned with trade direction
   */
  private isVWAPAligned(entryPrice: number, vwap: number, direction: 'BUY' | 'SELL'): boolean {
    if (direction === 'BUY') {
      // For longs, price should be near or slightly above VWAP
      return entryPrice >= vwap * 0.9995; // Allow 0.05% below for pullback entries
    } else {
      // For shorts, price should be near or slightly below VWAP
      return entryPrice <= vwap * 1.0005; // Allow 0.05% above for pullback entries
    }
  }

  /**
   * Helper: Check if momentum confirmed
   */
  private isMomentumConfirmed(candles: M5Candle[], direction: 'BUY' | 'SELL'): boolean {
    if (candles.length < 3) return false;

    const last3 = candles.slice(-3);

    if (direction === 'BUY') {
      // For longs, last 2 of 3 candles should be bullish
      const bullishCount = last3.filter(c => c.close > c.open).length;
      return bullishCount >= 2;
    } else {
      // For shorts, last 2 of 3 candles should be bearish
      const bearishCount = last3.filter(c => c.close < c.open).length;
      return bearishCount >= 2;
    }
  }

  /**
   * Helper: Calculate range position
   */
  private calculateRangePosition(candles: M5Candle[], currentPrice: number): 'top' | 'middle' | 'bottom' {
    if (candles.length < 20) return 'middle';

    const recent20 = candles.slice(-20);
    const high = Math.max(...recent20.map(c => c.high));
    const low = Math.min(...recent20.map(c => c.low));
    const range = high - low;

    if (range === 0) return 'middle';

    const position = ((currentPrice - low) / range) * 100;

    if (position > 75) return 'top';
    if (position < 25) return 'bottom';
    return 'middle';
  }

  /**
   * Helper: Detect false breakout
   */
  private detectFalseBreakout(candles: M5Candle[], direction: 'BUY' | 'SELL'): boolean {
    if (candles.length < 3) return false;

    // Look for pattern: breakout candle followed by immediate reversal
    const [first, second, third] = candles;

    if (direction === 'BUY') {
      // False bullish breakout: strong up candle, then reversal down
      const firstBullish = first.close > first.open && (first.close - first.open) > (first.high - first.low) * 0.7;
      const thirdBearish = third.close < third.open && (third.open - third.close) > (third.high - third.low) * 0.7;
      return firstBullish && thirdBearish && third.close < first.open;
    } else {
      // False bearish breakout: strong down candle, then reversal up
      const firstBearish = first.close < first.open && (first.open - first.close) > (first.high - first.low) * 0.7;
      const thirdBullish = third.close > third.open && (third.close - third.open) > (third.high - third.low) * 0.7;
      return firstBearish && thirdBullish && third.close > first.open;
    }
  }

  /**
   * Helper: Calculate confluence score
   */
  private calculateConfluenceScore(input: EntryQualificationInput): number {
    let score = 0;

    // M5/M15 trend alignment (40 points)
    const m5Bullish = input.m5EMA20 < input.entryPrice;
    const m15Bullish = input.m15Trend === 'bullish';
    const trendsAlign = (m5Bullish && m15Bullish && input.direction === 'BUY') ||
                        (!m5Bullish && !m15Bullish && input.direction === 'SELL');
    if (trendsAlign) score += 40;

    // VWAP + EMA alignment (30 points)
    const vwapEMAAlign = (input.entryPrice > input.m5VWAP && input.entryPrice > input.m5EMA20 && input.direction === 'BUY') ||
                         (input.entryPrice < input.m5VWAP && input.entryPrice < input.m5EMA20 && input.direction === 'SELL');
    if (vwapEMAAlign) score += 30;

    // RSI alignment (30 points)
    const rsiAligned = (input.m5RSI > 50 && input.direction === 'BUY') ||
                       (input.m5RSI < 50 && input.direction === 'SELL');
    if (rsiAligned) score += 30;

    return score;
  }

  /**
   * Helper: Calculate microstructure grade
   */
  private calculateMicrostructureGrade(
    vwap: boolean,
    momentum: boolean,
    volume: boolean,
    range: 'top' | 'middle' | 'bottom',
    confluence: number
  ): 'A' | 'B' | 'C' | 'D' | 'F' {
    let points = 0;

    if (vwap) points += 25;
    if (momentum) points += 25;
    if (volume) points += 20;
    if (range !== 'middle') points += 15;
    points += (confluence / 100) * 15;

    if (points >= 85) return 'A';
    if (points >= 70) return 'B';
    if (points >= 55) return 'C';
    if (points >= 40) return 'D';
    return 'F';
  }

  /**
   * Helper: Calculate quality score
   */
  private calculateQualityScore(
    metrics: EntryQualificationResult['metrics'],
    blocks: EntryQualificationBlock[],
    advisories: EntryQualificationBlock[]
  ): number {
    let score = 100;

    // Hard blocks = immediate 0
    if (blocks.length > 0) return 0;

    // Deduct for missing core confirmations
    if (!metrics.vwapAlignment) score -= 25;
    if (!metrics.momentumConfirmation) score -= 25;
    if (!metrics.volumeConfirmation) score -= 20;
    if (metrics.rangePosition === 'middle') score -= 15;

    // Deduct for advisories
    score -= advisories.length * 5;

    // Add for confluence
    score += (metrics.confluenceScore / 100) * 15;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Generate wait recommendation
   */
  private generateWaitRecommendation(
    input: EntryQualificationInput,
    metrics: EntryQualificationResult['metrics'],
    advisories: EntryQualificationBlock[]
  ): EntryQualificationResult['waitRecommendation'] {
    const primaryIssue = advisories[0];

    let estimatedMinutes = 15; // Default wait time
    let expectedImprovement = 15; // Expected quality score improvement

    // Adjust based on primary issue
    if (primaryIssue?.code === 'RSI_OVERBOUGHT' || primaryIssue?.code === 'RSI_OVERSOLD') {
      estimatedMinutes = 10;
      expectedImprovement = 20;
    } else if (primaryIssue?.code === 'ELEVATED_SPREAD') {
      estimatedMinutes = 5;
      expectedImprovement = 10;
    } else if (primaryIssue?.code === 'WEAK_CONFLUENCE') {
      estimatedMinutes = 20;
      expectedImprovement = 25;
    }

    return {
      reason: primaryIssue?.message || 'Entry timing suboptimal',
      estimatedImprovementMinutes: estimatedMinutes,
      expectedQualityImprovement: expectedImprovement
    };
  }

  /**
   * Format result for user display
   */
  formatForUser(result: EntryQualificationResult): string {
    if (result.status === 'ACCEPT_ENTRY') {
      return `✅ Entry timing: ${result.metrics.microstructureGrade} grade (${result.qualityScore}/100)\n` +
             `M5 microstructure: ${result.metrics.vwapAlignment ? '✓' : '✗'} VWAP | ${result.metrics.momentumConfirmation ? '✓' : '✗'} Momentum | ${result.metrics.volumeConfirmation ? '✓' : '✗'} Volume`;
    }

    if (result.status === 'WAIT_FOR_BETTER' && result.waitRecommendation) {
      return `⏳ Entry timing suboptimal (${result.qualityScore}/100)\n` +
             `${result.waitRecommendation.reason}\n` +
             `Recommendation: Wait ${result.waitRecommendation.estimatedImprovementMinutes}min for better entry`;
    }

    if (result.status === 'REJECT_ENTRY' && result.blocks.length > 0) {
      const primaryBlock = result.blocks[0];
      return `❌ Entry rejected: ${primaryBlock.message}\n` +
             `${primaryBlock.suggestion}`;
    }

    return `Entry qualification: ${result.status} (${result.qualityScore}/100)`;
  }

  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * ENHANCED ENTRY ACCEPTANCE LOGIC (BOLT IMPLEMENTATION)
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   *
   * A. Candle Acceptance Logic
   * B. Pullback Quality Grading
   * C. Compression & Expansion Detection
   * D. Failed Move Confirmation
   * E. Confidence-Weighted Entry Aggression
   */

  /**
   * A. CANDLE ACCEPTANCE LOGIC (HIGH PRIORITY)
   *
   * Validates that the most recent candles show genuine acceptance
   * of the trade direction, not just weak attempts.
   *
   * REQUIREMENTS:
   * - ≥2 consecutive closes in trade direction
   * - Body dominance (body ≥60% of candle range)
   * - Closes near high (BUY) or low (SELL) - within 20% of extreme
   * - Range expansion OR controlled compression → expansion
   *
   * @param candles - Recent M5 candles (minimum 5)
   * @param direction - Trade direction (BUY/SELL)
   * @returns CandleAcceptanceResult with acceptance decision and quality metrics
   */
  checkCandleAcceptance(candles: M5Candle[], direction: 'BUY' | 'SELL'): CandleAcceptanceResult {
    if (candles.length < 2) {
      return {
        accepted: false,
        consecutiveCloses: 0,
        bodyDominance: 0,
        closeQuality: 'poor',
        expansionDetected: false,
        details: 'Insufficient candle data (need at least 2 candles)'
      };
    }

    const recentCandles = candles.slice(-5); // Last 5 candles

    // DEBUG: Verify candle order and direction checking
    console.log('[EQS] 🔍 CANDLE ACCEPTANCE CHECK:', {
      direction,
      totalCandles: candles.length,
      using: 'LAST 5 candles',
      candleOrder: recentCandles.map((c, idx) => {
        const isDoji = c.open === c.close;
        const range = c.high - c.low;
        const bodySize = Math.abs(c.close - c.open);
        const bodyPercent = range > 0 ? (bodySize / range * 100).toFixed(1) : '0.0';

        return {
          index: idx,
          position: idx === recentCandles.length - 1 ? 'NEWEST' : `${recentCandles.length - 1 - idx} older`,
          time: c.time,
          open: c.open.toFixed(2),
          close: c.close.toFixed(2),
          isDOJI: isDoji,
          bodySize: bodySize.toFixed(4),
          bodyPercent: bodyPercent + '%',
          movement: isDoji ? '⚪ DOJI' : (c.close > c.open ? '🟢 BULL' : '🔴 BEAR'),
          matchesDirection: isDoji ? '⚪ DOJI (skipped)' : (direction === 'BUY' ? (c.close > c.open ? '✅' : '❌') : (c.close < c.open ? '✅' : '❌'))
        };
      }),
      note: 'Loop checks from NEWEST backward - breaks on first non-match or DOJI'
    });

    let consecutiveCloses = 0;
    let totalBodyDominance = 0;
    let closeQualitySum = 0;

    // Check consecutive closes in direction
    // IMPORTANT: This loops BACKWARD from newest candle (index 4) to oldest (index 0)
    let rejectionReason = '';
    for (let i = recentCandles.length - 1; i >= 0; i--) {
      const candle = recentCandles[i];
      const range = candle.high - candle.low;
      const bodySize = Math.abs(candle.close - candle.open);

      // Check if this is a DOJI candle (open === close)
      const isDoji = candle.open === candle.close;
      if (isDoji) {
        rejectionReason = `Stopped at DOJI candle (open=${candle.open.toFixed(4)}, close=${candle.close.toFixed(4)}, bodySize=0)`;
        console.log(`[EQS] ⚪ DOJI detected at index ${i} - stopping consecutive count`);
        break;
      }

      const isDirectionalClose = direction === 'BUY'
        ? candle.close > candle.open
        : candle.close < candle.open;

      if (isDirectionalClose) {
        consecutiveCloses++;

        // Calculate body dominance
        const bodyDominance = range > 0 ? bodySize / range : 0;
        totalBodyDominance += bodyDominance;

        // Calculate close quality (distance from extreme)
        let closeNearExtreme = 0;
        if (direction === 'BUY') {
          closeNearExtreme = range > 0 ? (candle.close - candle.low) / range : 0;
        } else {
          closeNearExtreme = range > 0 ? (candle.high - candle.close) / range : 0;
        }
        closeQualitySum += closeNearExtreme;

        console.log(`[EQS] ✅ Candle ${i} counts: body=${(bodyDominance * 100).toFixed(1)}%, quality=${(closeNearExtreme * 100).toFixed(1)}%`);
      } else {
        rejectionReason = `Stopped at opposite-direction candle (${candle.close > candle.open ? 'BULL' : 'BEAR'} when expecting ${direction})`;
        console.log(`[EQS] ❌ Candle ${i} breaks streak: wrong direction (${candle.close > candle.open ? 'BULL' : 'BEAR'} vs ${direction})`);
        break; // Stop counting if streak breaks
      }
    }

    // Calculate averages
    const avgBodyDominance = consecutiveCloses > 0 ? totalBodyDominance / consecutiveCloses : 0;
    const avgCloseQuality = consecutiveCloses > 0 ? closeQualitySum / consecutiveCloses : 0;

    // Determine close quality grade
    let closeQuality: 'excellent' | 'good' | 'poor';
    if (avgCloseQuality >= 0.8) {
      closeQuality = 'excellent';
    } else if (avgCloseQuality >= 0.6) {
      closeQuality = 'good';
    } else {
      closeQuality = 'poor';
    }

    // Check for range expansion
    const expansionDetected = this.detectRangeExpansion(recentCandles);

    // Acceptance decision
    const accepted =
      consecutiveCloses >= 2 &&
      avgBodyDominance >= 0.6 &&
      avgCloseQuality >= 0.6;

    const details = `${consecutiveCloses} consecutive ${direction} closes | ` +
                   `Body: ${(avgBodyDominance * 100).toFixed(0)}% | ` +
                   `Close quality: ${closeQuality} (${(avgCloseQuality * 100).toFixed(0)}%) | ` +
                   `Expansion: ${expansionDetected ? 'Yes' : 'No'}`;

    // DEBUG: Show final decision
    console.log('[EQS] ✅ CANDLE ACCEPTANCE RESULT:', {
      accepted: accepted ? '✅ YES' : '❌ NO',
      consecutiveCloses,
      avgBodyDominance: (avgBodyDominance * 100).toFixed(1) + '%',
      avgCloseQuality: (avgCloseQuality * 100).toFixed(1) + '%',
      closeQuality,
      expansionDetected,
      rejectionReason: consecutiveCloses === 0 ? rejectionReason : undefined,
      criteria: {
        needConsecutive: '≥2',
        needBodyDominance: '≥60%',
        needCloseQuality: '≥60%',
        actual: `${consecutiveCloses} consecutive, ${(avgBodyDominance * 100).toFixed(0)}% body, ${(avgCloseQuality * 100).toFixed(0)}% quality`
      }
    });

    return {
      accepted,
      consecutiveCloses,
      bodyDominance: avgBodyDominance,
      closeQuality,
      expansionDetected,
      details
    };
  }

  /**
   * B. PULLBACK QUALITY GRADING
   *
   * Grades the quality of a pullback relative to the prior impulse move.
   * Better pullbacks = better risk/reward entries.
   *
   * GRADING SCALE:
   * - Grade A: 30-50% pullback (shallow, ideal)
   * - Grade B: 50-70% pullback (medium, acceptable)
   * - Grade C: >70% pullback (deep, caution)
   *
   * @param candles - Recent M5 candles (minimum 10)
   * @param direction - Trade direction (BUY/SELL)
   * @returns PullbackQualityResult with grade and recommendation
   */
  checkPullbackQuality(candles: M5Candle[], direction: 'BUY' | 'SELL'): PullbackQualityResult {
    if (candles.length < 10) {
      return {
        grade: 'C',
        pullbackPercent: 0,
        quality: 'deep',
        score: 0,
        recommendation: 'Insufficient data to grade pullback quality'
      };
    }

    const recent10 = candles.slice(-10);

    // Find the impulse move (largest directional move in recent 10)
    let impulseStart = 0;
    let impulseEnd = 0;
    let maxImpulse = 0;

    for (let i = 0; i < recent10.length - 3; i++) {
      for (let j = i + 2; j < recent10.length; j++) {
        const move = direction === 'BUY'
          ? recent10[j].high - recent10[i].low
          : recent10[i].high - recent10[j].low;

        if (move > maxImpulse) {
          maxImpulse = move;
          impulseStart = i;
          impulseEnd = j;
        }
      }
    }

    // Calculate pullback from impulse high/low to current price
    const currentPrice = recent10[recent10.length - 1].close;
    let pullbackAmount = 0;

    if (direction === 'BUY') {
      const impulseHigh = recent10[impulseEnd].high;
      const impulseLow = recent10[impulseStart].low;
      pullbackAmount = impulseHigh - currentPrice;
      maxImpulse = impulseHigh - impulseLow;
    } else {
      const impulseLow = recent10[impulseEnd].low;
      const impulseHigh = recent10[impulseStart].high;
      pullbackAmount = currentPrice - impulseLow;
      maxImpulse = impulseHigh - impulseLow;
    }

    const pullbackPercent = maxImpulse > 0 ? (pullbackAmount / maxImpulse) * 100 : 0;

    // Grade the pullback
    let grade: 'A' | 'B' | 'C';
    let quality: 'shallow' | 'medium' | 'deep';
    let score: number;
    let recommendation: string;

    if (pullbackPercent <= 50 && pullbackPercent >= 30) {
      grade = 'A';
      quality = 'shallow';
      score = 100;
      recommendation = 'Excellent entry - shallow pullback with strong R:R';
    } else if (pullbackPercent <= 70) {
      grade = 'B';
      quality = 'medium';
      score = 75;
      recommendation = 'Good entry - medium pullback, acceptable R:R';
    } else {
      grade = 'C';
      quality = 'deep';
      score = 50;
      recommendation = 'Caution - deep pullback may indicate trend weakening';
    }

    return {
      grade,
      pullbackPercent,
      quality,
      score,
      recommendation
    };
  }

  /**
   * C. COMPRESSION & EXPANSION DETECTION
   *
   * Detects price compression followed by expansion, which often
   * indicates the start of a new directional move.
   *
   * PATTERN:
   * - Compression: 3+ consecutive narrow-range candles
   * - Expansion: Candle with range >1.5x average compression range
   *
   * Quality bonus: +20 points if pattern present
   *
   * @param candles - Recent M5 candles (minimum 5)
   * @returns CompressionExpansionResult with pattern details
   */
  checkCompressionExpansion(candles: M5Candle[]): CompressionExpansionResult {
    if (candles.length < 5) {
      return {
        compressionDetected: false,
        compressionCandles: 0,
        expansionFollows: false,
        qualityBonus: 0,
        pattern: 'Insufficient data for compression/expansion detection'
      };
    }

    const recent = candles.slice(-7); // Last 7 candles
    const ranges = recent.map(c => c.high - c.low);
    const avgRange = ranges.reduce((sum, r) => sum + r, 0) / ranges.length;

    // Detect compression phase (3+ narrow candles)
    let compressionStart = -1;
    let compressionCandles = 0;

    for (let i = 0; i < recent.length - 1; i++) {
      const range = ranges[i];
      const isNarrow = range < avgRange * 0.6; // Narrow = <60% of avg

      if (isNarrow) {
        if (compressionStart === -1) {
          compressionStart = i;
        }
        compressionCandles++;
      } else {
        if (compressionCandles >= 3) {
          break; // Found compression phase
        }
        compressionStart = -1;
        compressionCandles = 0;
      }
    }

    const compressionDetected = compressionCandles >= 3;

    // Check if expansion follows compression
    let expansionFollows = false;
    if (compressionDetected && compressionStart >= 0) {
      const compressionEndIndex = compressionStart + compressionCandles - 1;
      if (compressionEndIndex < recent.length - 1) {
        const nextCandle = recent[compressionEndIndex + 1];
        const nextRange = nextCandle.high - nextCandle.low;
        const compressionAvgRange = ranges.slice(compressionStart, compressionEndIndex + 1)
          .reduce((sum, r) => sum + r, 0) / compressionCandles;

        expansionFollows = nextRange > compressionAvgRange * 1.5;
      }
    }

    // Calculate quality bonus
    const qualityBonus = (compressionDetected && expansionFollows) ? 20 : 0;

    const pattern = compressionDetected
      ? `Compression (${compressionCandles} candles) ${expansionFollows ? '→ Expansion ✓' : 'detected'}`
      : 'No compression pattern detected';

    return {
      compressionDetected,
      compressionCandles,
      expansionFollows,
      qualityBonus,
      pattern
    };
  }

  /**
   * D. FAILED MOVE CONFIRMATION
   *
   * Detects failed directional attempts and confirms the counter-move
   * is valid for entry.
   *
   * FAILED MOVE TYPES:
   * - False breakout: Break above/below level, then immediate rejection
   * - Exhaustion: Large candle closes mid-range with no follow-through
   * - Rejection: Strong move hits resistance/support and reverses
   *
   * @param candles - Recent M5 candles (minimum 5)
   * @param direction - Trade direction (opposite of failed move)
   * @returns FailedMoveResult with failure details
   */
  checkFailedMove(candles: M5Candle[], direction: 'BUY' | 'SELL'): FailedMoveResult {
    if (candles.length < 5) {
      return {
        failedMoveDetected: false,
        failureType: 'none',
        confirmationPresent: false,
        entryViable: false,
        details: 'Insufficient data for failed move detection'
      };
    }

    const recent5 = candles.slice(-5);
    let failureType: 'false_breakout' | 'exhaustion' | 'rejection' | 'none' = 'none';
    let confirmationPresent = false;

    // Check for false breakout (already has method)
    const oppositeDirection = direction === 'BUY' ? 'SELL' : 'BUY';
    const falseBreakout = this.detectFalseBreakout(recent5.slice(-3), oppositeDirection);

    if (falseBreakout) {
      failureType = 'false_breakout';

      // Check for confirmation candle in our direction
      const lastCandle = recent5[recent5.length - 1];
      confirmationPresent = direction === 'BUY'
        ? lastCandle.close > lastCandle.open && (lastCandle.close - lastCandle.open) > (lastCandle.high - lastCandle.low) * 0.6
        : lastCandle.close < lastCandle.open && (lastCandle.open - lastCandle.close) > (lastCandle.high - lastCandle.low) * 0.6;
    }

    // Check for exhaustion
    if (!falseBreakout) {
      const prevCandle = recent5[recent5.length - 2];
      const range = prevCandle.high - prevCandle.low;
      const body = Math.abs(prevCandle.close - prevCandle.open);
      const bodyRatio = range > 0 ? body / range : 0;

      // Large body but closes in middle (not at extreme)
      if (bodyRatio > 0.7) {
        const closedNearMiddle = oppositeDirection === 'BUY'
          ? (prevCandle.high - prevCandle.close) / range > 0.3 && (prevCandle.high - prevCandle.close) / range < 0.7
          : (prevCandle.close - prevCandle.low) / range > 0.3 && (prevCandle.close - prevCandle.low) / range < 0.7;

        if (closedNearMiddle) {
          failureType = 'exhaustion';

          // Check current candle for reversal confirmation
          const lastCandle = recent5[recent5.length - 1];
          confirmationPresent = direction === 'BUY'
            ? lastCandle.close > prevCandle.close
            : lastCandle.close < prevCandle.close;
        }
      }
    }

    // Check for rejection at level
    if (failureType === 'none') {
      const last3 = recent5.slice(-3);
      const highestHigh = Math.max(...last3.map(c => c.high));
      const lowestLow = Math.min(...last3.map(c => c.low));
      const currentClose = last3[last3.length - 1].close;

      // Price tested extreme and rejected back
      if (oppositeDirection === 'BUY') {
        const testedHigh = last3.some(c => c.high === highestHigh);
        const rejectedDown = currentClose < highestHigh * 0.995;
        if (testedHigh && rejectedDown) {
          failureType = 'rejection';
          confirmationPresent = direction === 'SELL';
        }
      } else {
        const testedLow = last3.some(c => c.low === lowestLow);
        const rejectedUp = currentClose > lowestLow * 1.005;
        if (testedLow && rejectedUp) {
          failureType = 'rejection';
          confirmationPresent = direction === 'BUY';
        }
      }
    }

    const failedMoveDetected = failureType !== 'none';
    const entryViable = failedMoveDetected && confirmationPresent;

    const details = failedMoveDetected
      ? `${failureType.replace('_', ' ')} detected | Confirmation: ${confirmationPresent ? 'Yes ✓' : 'No'}`
      : 'No failed move pattern detected';

    return {
      failedMoveDetected,
      failureType,
      confirmationPresent,
      entryViable,
      details
    };
  }

  /**
   * E. CONFIDENCE-WEIGHTED ENTRY AGGRESSION
   *
   * Adjusts entry timing requirements based on Alpha's confidence level.
   * Higher confidence = more aggressive entry at first signal.
   * Lower confidence = wait for stronger confirmation.
   *
   * CONFIDENCE TIERS:
   * - High (85%+): Accept entry at first directional signal
   * - Medium (70-85%): Wait for 2nd confirmation candle
   * - Low (<70%): Wait for full retest or skip
   *
   * @param confidence - Alpha's confidence (0-100)
   * @param candleAcceptance - Candle acceptance result
   * @returns Adjusted quality score and recommendation
   */
  applyConfidenceWeightedAggression(
    confidence: number,
    candleAcceptance: CandleAcceptanceResult
  ): { adjustedScore: number; recommendation: string; aggressionLevel: 'aggressive' | 'moderate' | 'conservative' } {

    let aggressionLevel: 'aggressive' | 'moderate' | 'conservative';
    let scoreAdjustment = 0;
    let recommendation = '';

    if (confidence >= 85) {
      // High confidence - aggressive entry
      aggressionLevel = 'aggressive';

      if (candleAcceptance.consecutiveCloses >= 1) {
        scoreAdjustment = +15;
        recommendation = 'High confidence: Enter aggressively at first signal';
      } else {
        scoreAdjustment = +5;
        recommendation = 'High confidence: Accept entry despite weak confirmation';
      }
    } else if (confidence >= 70) {
      // Medium confidence - moderate entry
      aggressionLevel = 'moderate';

      if (candleAcceptance.consecutiveCloses >= 2) {
        scoreAdjustment = +10;
        recommendation = 'Medium confidence: Enter after 2nd confirmation';
      } else {
        scoreAdjustment = -10;
        recommendation = 'Medium confidence: Wait for 2nd confirmation candle';
      }
    } else {
      // Low confidence - conservative entry
      aggressionLevel = 'conservative';

      if (candleAcceptance.consecutiveCloses >= 2 && candleAcceptance.closeQuality === 'excellent') {
        scoreAdjustment = 0;
        recommendation = 'Low confidence: Requires full retest and excellent quality';
      } else {
        scoreAdjustment = -20;
        recommendation = 'Low confidence: Skip or wait for stronger confirmation';
      }
    }

    return {
      adjustedScore: scoreAdjustment,
      recommendation,
      aggressionLevel
    };
  }

  /**
   * Helper: Detect range expansion in recent candles
   */
  private detectRangeExpansion(candles: M5Candle[]): boolean {
    if (candles.length < 3) return false;

    const ranges = candles.map(c => c.high - c.low);
    const avgRange = ranges.slice(0, -1).reduce((sum, r) => sum + r, 0) / (ranges.length - 1);
    const lastRange = ranges[ranges.length - 1];

    return lastRange > avgRange * 1.3; // 30% larger than average
  }

  /**
   * ═══════════════════════════════════════════════════════════════════
   * GRADE A+ PATTERN DETECTION & EQS DECISION LOGIC
   * ═══════════════════════════════════════════════════════════════════
   */

  /**
   * 5. GRADE A+ PATTERN DETECTION (+10 to +15 bonus)
   * Exceptional setups that deserve immediate execution
   */
  private detectAPlusPatterns(
    input: EntryQualificationInput,
    metrics: EntryQualificationResult['metrics'],
    candleAcceptance: CandleAcceptanceResult,
    pullbackQuality: PullbackQualityResult
  ): { bonus: number; type: string } | null {
    const atrValue = typeof input.atr === 'number' ? input.atr : input.atr.value;
    const vwapDistance = Math.abs(input.entryPrice - input.m5VWAP);
    const vwapDistanceATR = vwapDistance / atrValue;

    // Pattern 1: VWAP Kiss + Acceptance Candle (+15)
    if (vwapDistanceATR < 0.15 && metrics.vwapAlignment && candleAcceptance.accepted) {
      return { bonus: 15, type: 'VWAP Kiss + Acceptance' };
    }

    // Pattern 2: Perfect Pullback + Compression → Expansion (+12)
    if (pullbackQuality.grade === 'A' && candleAcceptance.expansionDetected) {
      return { bonus: 12, type: 'Perfect Pullback + Expansion' };
    }

    // Pattern 3: Structure Level + Acceptance + VWAP (+13)
    if (input.m15SupportResistance) {
      const { nearestSupport, nearestResistance } = input.m15SupportResistance;
      const atStructure =
        (input.direction === 'BUY' && nearestSupport &&
          Math.abs(calculatePipDistance(input.symbol, input.entryPrice, nearestSupport)) < 3) ||
        (input.direction === 'SELL' && nearestResistance &&
          Math.abs(calculatePipDistance(input.symbol, input.entryPrice, nearestResistance)) < 3);

      if (atStructure && candleAcceptance.accepted && metrics.vwapAlignment) {
        return { bonus: 13, type: 'Structure + Acceptance + VWAP' };
      }
    }

    // Pattern 4: Tight Compression → Strong Breakout (+10)
    if (input.m5Candles.length >= 5) {
      const recent5 = input.m5Candles.slice(-5);
      const ranges = recent5.map(c => c.high - c.low);
      const avgRange = ranges.slice(0, -1).reduce((sum, r) => sum + r, 0) / (ranges.length - 1);
      const lastRange = ranges[ranges.length - 1];

      if (avgRange < atrValue * 0.5 && lastRange > avgRange * 2.0 && candleAcceptance.accepted) {
        return { bonus: 10, type: 'Compression Breakout' };
      }
    }

    return null;
  }

  /**
   * Calculate EQS letter grade
   */
  private calculateEQSGrade(eqs: number): 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' {
    if (eqs >= 80) return 'A+';
    if (eqs >= 72) return 'A';
    if (eqs >= 65) return 'B';
    if (eqs >= 50) return 'C';
    if (eqs >= 30) return 'D';
    return 'F';
  }

  /**
   * Determine action tier based on EQS, style, and component breakdown
   * Uses ALPHA_IDENTITY thresholds for style-specific decisions
   */
  private determineActionTier(eqs: number, breakdown: EQSBreakdown, style?: StyleDisplayName): EntryActionTier {
    const styleKey = style || 'MICRO_INTRADAY';
    const thresholds = ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS[styleKey];

    if (eqs >= thresholds.EXECUTE_IMMEDIATELY) {
      return 'EXECUTE_NOW';
    }

    if (eqs >= thresholds.WAIT_PULLBACK.min) {
      return 'WAIT_FOR_BETTER_ENTRY';
    }

    if (eqs >= 50) {
      return 'WAIT_TIGHT';
    }

    return 'WAIT_PASSIVE';
  }

  /**
   * Get style-specific EQS thresholds
   */
  getStyleThresholds(style: StyleDisplayName): {
    executeThreshold: number;
    waitPullbackMin: number;
    waitPullbackMax: number;
  } {
    const thresholds = ALPHA_IDENTITY.STYLE_EQS_THRESHOLDS[style];
    return {
      executeThreshold: thresholds.EXECUTE_IMMEDIATELY,
      waitPullbackMin: thresholds.WAIT_PULLBACK.min,
      waitPullbackMax: thresholds.WAIT_PULLBACK.max,
    };
  }

  /**
   * Evaluate with style awareness - recommended entry point
   */
  evaluateWithStyle(input: EntryQualificationInput, style: StyleDisplayName): EntryQualificationResult {
    const result = this.evaluate(input);
    result.actionTier = this.determineActionTier(result.eqs, result.eqsBreakdown, style);
    result.status = result.actionTier === 'EXECUTE_NOW' ? 'EXECUTE_NOW' : 'WAIT_FOR_BETTER_ENTRY';
    return result;
  }

  /**
   * Generate entry triggers for wait scenarios
   * Returns specific conditions to monitor for entry execution
   */
  private generateEntryTriggers(
    input: EntryQualificationInput,
    breakdown: EQSBreakdown,
    currentEQS: number
  ): EntryTrigger[] {
    const triggers: EntryTrigger[] = [];
    const atrValue = typeof input.atr === 'number' ? input.atr : input.atr.value;

    // Determine what's missing based on component scores
    const vwapSetupWeak = breakdown.locationDetails.vwapSetup < 8;
    const acceptanceWeak = breakdown.confirmationDetails.candleAcceptance < 12;
    const pullbackWeak = breakdown.timingDetails.pullbackQuality < 9;

    // Trigger 1: VWAP Kiss (if VWAP setup is weak)
    if (vwapSetupWeak) {
      triggers.push({
        type: 'vwap_kiss',
        description: 'Wait for price to return closer to VWAP',
        targetConditions: {
          priceLevel: input.m5VWAP,
          vwapDistance: 0.2, // Within 0.2 ATR of VWAP
          candleRequirement: 'Body dominance 60%+',
          volumeRequirement: 'Above 40% of 20-period average'
        },
        monitoringParams: {
          maxWaitMinutes: 30,
          recheckInterval: 60, // Check every 60 seconds
          invalidationPrice: input.direction === 'BUY'
            ? input.m5VWAP - (atrValue * 1.5)
            : input.m5VWAP + (atrValue * 1.5)
        }
      });
    }

    // Trigger 2: Acceptance Candle (if candle acceptance is weak)
    if (acceptanceWeak) {
      triggers.push({
        type: 'acceptance_candle',
        description: 'Wait for strong acceptance candle in trade direction',
        targetConditions: {
          candleRequirement: `2+ consecutive ${input.direction === 'BUY' ? 'bullish' : 'bearish'} closes`,
          volumeRequirement: 'Above average',
          patternType: 'engulfing or strong body candle'
        },
        monitoringParams: {
          maxWaitMinutes: 20,
          recheckInterval: 300, // Check every M5 candle close
          invalidationPrice: input.direction === 'BUY'
            ? input.entryPrice - (atrValue * 2.0)
            : input.entryPrice + (atrValue * 2.0)
        }
      });
    }

    // Trigger 3: Pullback Complete (if pullback quality is weak)
    if (pullbackWeak && breakdown.timingDetails.entryPrecision === 0) {
      triggers.push({
        type: 'pullback_complete',
        description: 'Wait for 38-50% pullback to complete',
        targetConditions: {
          priceLevel: input.entryPrice - (input.direction === 'BUY' ? atrValue * 0.5 : -atrValue * 0.5),
          candleRequirement: 'Pullback candles with small bodies',
          patternType: '38-50% retracement'
        },
        monitoringParams: {
          maxWaitMinutes: 45,
          recheckInterval: 300,
          invalidationPrice: input.direction === 'BUY'
            ? input.stopLoss - (atrValue * 0.3)
            : input.stopLoss + (atrValue * 0.3)
        }
      });
    }

    return triggers;
  }

  /**
   * Generate wait recommendation with actionable guidance
   */
  private generateWaitRecommendationNew(
    input: EntryQualificationInput,
    breakdown: EQSBreakdown,
    actionTier: EntryActionTier
  ): EntryQualificationResult['waitRecommendation'] {
    const whatsMissing: string[] = [];
    let estimatedMinutes = 15;
    let expectedImprovement = 0;

    // Analyze what's missing
    if (breakdown.locationDetails.vwapSetup < 8) {
      whatsMissing.push(`Better VWAP setup (need ${12 - breakdown.locationDetails.vwapSetup} more points)`);
      estimatedMinutes = Math.max(estimatedMinutes, 25);
      expectedImprovement += 12 - breakdown.locationDetails.vwapSetup;
    }

    if (breakdown.confirmationDetails.candleAcceptance < 12) {
      whatsMissing.push(`Stronger acceptance (need ${15 - breakdown.confirmationDetails.candleAcceptance} more points)`);
      estimatedMinutes = Math.max(estimatedMinutes, 15);
      expectedImprovement += 15 - breakdown.confirmationDetails.candleAcceptance;
    }

    if (breakdown.timingDetails.pullbackQuality < 9) {
      whatsMissing.push(`Better pullback quality (need ${12 - breakdown.timingDetails.pullbackQuality} more points)`);
      estimatedMinutes = Math.max(estimatedMinutes, 30);
      expectedImprovement += 12 - breakdown.timingDetails.pullbackQuality;
    }

    if (breakdown.frictionPenalty < -5) {
      whatsMissing.push(`Market conditions to improve (${Math.abs(breakdown.frictionPenalty)} friction penalty)`);
      estimatedMinutes = Math.max(estimatedMinutes, 10);
      expectedImprovement += Math.abs(breakdown.frictionPenalty);
    }

    // Generate reason based on action tier
    let reason = '';
    if (actionTier === 'WAIT_FOR_BETTER_ENTRY') {
      reason = `Entry quality: ${breakdown.totalScore}/100 (Grade B) - waiting for better setup`;
    } else if (actionTier === 'WAIT_TIGHT') {
      reason = `Entry quality: ${breakdown.totalScore}/100 (Grade C) - requires confirmation candle`;
    } else {
      reason = `Entry quality: ${breakdown.totalScore}/100 (Grade D) - significant improvement needed`;
    }

    return {
      reason,
      estimatedImprovementMinutes: estimatedMinutes,
      expectedQualityImprovement: expectedImprovement,
      whatsMissing
    };
  }

  /**
   * Log EQS breakdown for observability
   */
  private logEQSBreakdown(
    eqs: number,
    grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F',
    actionTier: EntryActionTier,
    breakdown: EQSBreakdown
  ): void {
    console.log('%c[EQS] ENTRY QUALITY SCORE', 'color: #2196f3; font-weight: bold; font-size: 14px');
    console.log(`  Total: ${eqs}/100 | Grade: ${grade} | Action: ${actionTier}`);
    console.log(`  Candle Acceptance: ${breakdown.candleAcceptance}/20`);
    console.log(`  Pullback Quality: ${breakdown.pullbackQuality}/15`);
    console.log(`  VWAP Interaction: ${breakdown.vwapInteraction}/15`);
    console.log(`  EMA Alignment: ${breakdown.emaAlignment}/10`);
    console.log(`  Liquidity Reaction: ${breakdown.liquidityReaction}/15`);
    console.log(`  Compression/Expansion: ${breakdown.compressionExpansion}/10`);
    console.log(`  Failed Move: ${breakdown.failedMoveConfirmation}/10`);
    console.log(`  Timeframe Alignment: ${breakdown.timeframeAlignment}/5`);

    if (breakdown.aplusPatternBonus) {
      console.log(`  A+ Bonus: +${breakdown.aplusPatternBonus} (${breakdown.aplusPatternType})`);
    }

    if (actionTier === 'EXECUTE_NOW') {
      console.log('%c  EXECUTE NOW', 'color: #4caf50; font-weight: bold');
    } else {
      console.log('%c  WAIT FOR BETTER ENTRY', 'color: #ff9800; font-weight: bold');
    }
  }

  /**
   * Helper: Calculate average candle range for comparison
   */
  private calculateAverageCandleRange(candles: M5Candle[]): number {
    if (candles.length === 0) return 0;
    const ranges = candles.map(c => c.high - c.low);
    return ranges.reduce((sum, r) => sum + r, 0) / ranges.length;
  }
}

export const entryQualificationEngine = new EntryQualificationEngine();
